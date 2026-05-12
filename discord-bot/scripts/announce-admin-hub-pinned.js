#!/usr/bin/env node
/**
 * announce-admin-hub-pinned.js — Admin Hub 공지 + 자동 핀 등록 (PR-AGENT-OPS-IMPL3 partial).
 *
 * 동작:
 *   1. 채널 last 50 pinned 메시지 중 본 봇이 보낸 옛 admin-hub embed 자동 unpin
 *   2. 새 embed 메시지 send (5 카테고리 + 부속 인프라 + ADMIN_API_KEY 안내)
 *   3. 새 메시지 .pin() — Manage Messages 권한 필요
 *
 * 환경변수:
 *   DISCORD_TOKEN              — 봇 토큰 (기존 .env 또는 launchd 환경에서 상속)
 *   DISCORD_NOTICE_CHANNEL_ID  — 공지 채널 Discord ID (예: 1234567890123456789)
 *   PROD_BASE (옵션)           — default: https://nolza.org
 *   LOCAL_BASE (옵션)          — default: http://localhost:5000
 *
 * 사용:
 *   export DISCORD_TOKEN="..."
 *   export DISCORD_NOTICE_CHANNEL_ID="..."
 *   node project-manager/discord-bot/scripts/announce-admin-hub-pinned.js
 *
 * Exit codes:
 *   0 — 송신 + 핀 등록 성공
 *   1 — 환경변수 미설정
 *   2 — Discord 로그인/권한 실패
 *   3 — 채널 미발견 또는 채널 권한 부족
 *   4 — 메시지 send/pin 실패
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_TOKEN || '';
const CHANNEL_ID = process.env.DISCORD_NOTICE_CHANNEL_ID || '';
const PROD_BASE = process.env.PROD_BASE || 'https://nolza.org';
const LOCAL_BASE = process.env.LOCAL_BASE || 'http://localhost:5000';
const REPO_BASE = process.env.REPO_BASE || 'https://github.com/kws3363/whosbuying';

if (!BOT_TOKEN) {
  console.error('[announce-admin-hub-pinned] FAIL — DISCORD_TOKEN 환경변수 미설정');
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error('[announce-admin-hub-pinned] FAIL — DISCORD_NOTICE_CHANNEL_ID 환경변수 미설정');
  console.error('');
  console.error('채널 ID 확인: Discord 개발자 모드 ON → 공지 채널 우클릭 → "ID 복사"');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const ADMIN_HUB_MARKER = '🛠️ 누가살래 Admin Hub';

function buildEmbed() {
  return new EmbedBuilder()
    .setTitle('🛠️ 누가살래 Admin Hub — 모든 페이지 직접 링크')
    .setURL(`${PROD_BASE}/#/admin`)
    .setColor(0x10A37F)
    .setDescription(
      `**Admin 5 카테고리 모두 직접 URL 진입 가능** (PR-ADMIN-DEEPLINK). 첫 진입 시 ADMIN_API_KEY 입력 (로컬: \`application-local.yml\` L40 / prod: 배포 환경변수).\n\n` +
      `**🔗 통합 진입점**\n` +
      `• prod: ${PROD_BASE}/#/admin\n` +
      `• 로컬: ${LOCAL_BASE}/#/admin`
    )
    .addFields(
      {
        name: '📊 운영 모니터링 (ops)',
        value:
          `실시간 ring-buffer (recent-errors / recent-slow / summary)\n` +
          `• prod: ${PROD_BASE}/#/admin/ops\n` +
          `• 로컬: ${LOCAL_BASE}/#/admin/ops\n` +
          `• BE: \`${PROD_BASE}/api/v1/admin/ops\` (Bearer)`,
      },
      {
        name: '📖 시스템 문서 (docs)',
        value:
          `Admin 전용 wiki — markdown viewer\n` +
          `• prod: ${PROD_BASE}/#/admin/docs\n` +
          `• 로컬: ${LOCAL_BASE}/#/admin/docs`,
      },
      {
        name: '🗺️ 서비스 흐름 — 노드 다이어그램 페이지',
        value:
          `Discord + 누가살래 전체 시스템을 **노드 형태로 보는 페이지**. 시나리오 흐름 + 5 노드 상세\n` +
          `• prod: ${PROD_BASE}/#/admin/flow\n` +
          `• 로컬: ${LOCAL_BASE}/#/admin/flow\n\n` +
          `**5 노드 상세 (overview 안에서 클릭):**\n` +
          `• \`services-flow-overview\` — 전체 다이어그램 + 시나리오 2종\n` +
          `• \`services/whosbuying-frontend\` — Flutter Web 노드\n` +
          `• \`services/whosbuying-backend\` — Spring Boot 노드\n` +
          `• \`services/whosbuying-data-layer\` — MariaDB / Redis / RabbitMQ\n` +
          `• \`services/discord-bot\` — Discord 봇 노드\n` +
          `• \`services/admin-tools\` — Admin 도구 노드`,
      },
      {
        name: '🔍 Codex 검수 리뷰',
        value:
          `매 commit Codex 자동 검수 결과 (한국어, 5항목 평가)\n` +
          `• Admin UI: ${PROD_BASE}/#/admin/codex\n` +
          `• 영구 기록: ${REPO_BASE}/tree/main/docs/codex-review (sha 단위)`,
      },
      {
        name: '🚨 Kill Switch',
        value:
          `긴급 서비스 중단 토글 (Redis 기반)\n` +
          `• prod: ${PROD_BASE}/#/admin/kill\n` +
          `• 로컬: ${LOCAL_BASE}/#/admin/kill\n` +
          `• BE: \`${PROD_BASE}/api/v1/admin/kill-switch\` GET/POST`,
      },
      {
        name: '⚙️ 부속 인프라 (BASIC AUTH 별도)',
        value:
          `• Actuator (헬스/메트릭): \`${PROD_BASE}/actuator/health\` (admin / ACTUATOR_PASSWORD)\n` +
          `• Swagger UI: \`http://localhost:8080/swagger-ui.html\`\n` +
          `• Grafana: \`http://localhost:3001\` (admin/admin)\n` +
          `• Prometheus: \`http://localhost:9090\`\n` +
          `• RabbitMQ 관리: \`http://localhost:15672\` (guest/guest)`,
      },
      {
        name: '🤖 자동 복구 시스템 (L1/L2/L3)',
        value:
          `PR-OPS-AUTO-RECOVERY-FULL (2026-05-12) — 영구 사고 자동 진단/복구\n` +
          `• L1 launchd: 봇 crash 시 10초 후 자동 재시작\n` +
          `• L2 Codex: 5분 cron, 15분 연속 다운 시 자동 진단 → \`#ops-errors\` / \`#game-errors\` 알림\n` +
          `• L3 Claude: Codex 진단 후 자동 fix PR (sub-agent 위임)\n` +
          `• 무한루프 차단: 같은 패턴 3회 반복 시 stop\n` +
          `• 정책 SSOT: \`.claude/rules/harness/auto-recovery-gate.md\``,
      }
    )
    .setFooter({ text: `PR-ADMIN-DEEPLINK · 자동 핀 등록 (Discord API .pin())` });
}

client.once('ready', async () => {
  console.log(`[announce-admin-hub-pinned] 로그인 OK — ${client.user.tag}`);

  let channel;
  try {
    channel = await client.channels.fetch(CHANNEL_ID);
  } catch (err) {
    console.error(`[announce-admin-hub-pinned] FAIL — 채널 fetch (${CHANNEL_ID}): ${err.message}`);
    process.exit(3);
  }

  if (!channel || !channel.isTextBased()) {
    console.error(`[announce-admin-hub-pinned] FAIL — 채널이 텍스트 채널 아님 (${CHANNEL_ID})`);
    process.exit(3);
  }

  // (1) 옛 admin-hub 핀 메시지 자동 unpin
  try {
    const pinned = await channel.messages.fetchPinned();
    let unpinCount = 0;
    for (const msg of pinned.values()) {
      const isMine = msg.author?.id === client.user.id;
      const isAdminHub =
        msg.embeds?.[0]?.title?.includes(ADMIN_HUB_MARKER) ||
        msg.content?.includes(ADMIN_HUB_MARKER);
      if (isMine && isAdminHub) {
        await msg.unpin().catch(() => null);
        unpinCount++;
      }
    }
    if (unpinCount > 0) {
      console.log(`[announce-admin-hub-pinned] 옛 admin-hub 핀 unpin: ${unpinCount}건`);
    }
  } catch (err) {
    console.warn(`[announce-admin-hub-pinned] WARN — fetchPinned 실패 (Manage Messages 권한?): ${err.message}`);
  }

  // (2) 새 embed send
  let sent;
  try {
    sent = await channel.send({ embeds: [buildEmbed()] });
    console.log(`[announce-admin-hub-pinned] 메시지 send OK — message id=${sent.id}`);
  } catch (err) {
    console.error(`[announce-admin-hub-pinned] FAIL — 메시지 send: ${err.message}`);
    process.exit(4);
  }

  // (3) 새 메시지 자동 핀 등록
  try {
    await sent.pin();
    console.log(`[announce-admin-hub-pinned] 핀 등록 OK — https://discord.com/channels/${channel.guildId}/${channel.id}/${sent.id}`);
  } catch (err) {
    console.error(`[announce-admin-hub-pinned] FAIL — pin: ${err.message}`);
    console.error(`  → 봇 권한 'Manage Messages' 부여 필요 (서버 설정 → 역할 → 봇 역할 → Manage Messages ON)`);
    process.exit(4);
  }

  await client.destroy();
  process.exit(0);
});

client.on('error', (err) => {
  console.error(`[announce-admin-hub-pinned] client error: ${err.message}`);
});

client.login(BOT_TOKEN).catch((err) => {
  console.error(`[announce-admin-hub-pinned] FAIL — login: ${err.message}`);
  process.exit(2);
});
