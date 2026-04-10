/**
 * 공지 전송: ai-native-ops 아키텍처 전환 (2026-04-10)
 *
 * 실행:
 *   cd C:\Users\kws33\Desktop\projects\whosbuying
 *   bash -c 'set -a; source .env; set +a; node send-notice-ops.js'
 * 또는 .env 가 이미 export 된 상태면:
 *   node send-notice-ops.js
 */
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const CHANNEL_ID = '1491475306626678895';

client.once('clientReady', async () => {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const msg = `━━━━━━━━━━━━━━━━━━━━━━━
📢 **운영 아키텍처 전환 공지** (2026-04-10)
━━━━━━━━━━━━━━━━━━━━━━━

**🏗️ 프로젝트 구조 정리**

이제 프로젝트는 **서비스** + **운영 도구** 로 명확히 분리됐습니다.

\`\`\`
projects/
├── whosbuying/          → 게임 서비스 (프로덕트)
└── ai-native-ops/       → 운영 자동화 (메타, 프로젝트 교체 가능)
    ├── discord-bot/     → Discord Bot (Gateway + HTTP)
    └── wol-service/     → Render.com WoL 중계 (분리됨)
\`\`\`

\`ai-native-ops\` 는 \`CLAUDE_PROJECT_DIR\`, \`GAME_SERVER_URL\` 환경변수만 바꾸면 **다른 프로젝트에도 그대로 붙습니다**.

**🖥️ \`/wakeup\` — PC 꺼진 상태에서도 동작!**

Discord Interactions Endpoint URL을 **Cloudflare Worker**로 직접 연결했습니다. 이제 PC가 완전히 꺼진 상태에서도 \`/wakeup\` 이 동작합니다.

\`\`\`
Discord /wakeup
  → Cloudflare Worker (항상 켜짐)
    → Render.com wol-service
      → UDP 매직패킷 → 공유기 → PC 부팅
\`\`\`

**🔀 다른 명령들 — 로컬 Bot HTTP 포워딩 준비 완료**

\`/status\`, \`/claude\`, \`/rooms\`, \`/deploy\` 등은 Worker가 **로컬 Bot HTTP 서버 (port 4040)** 로 포워딩합니다.
- PC 켜짐: 기존처럼 정상 동작
- PC 꺼짐: "⚠️ PC가 꺼져있습니다. \`/wakeup\` 먼저 실행하세요"

**⚙️ 자동 시작 설정**

- \`Startup\` 폴더에 \`discord-bot.lnk\` 등록 완료 → 로그인 시 자동 Bot 시작
- \`start_all.bat\` 경로도 \`ai-native-ops/discord-bot\`으로 전환

**⚠️ 미완 — 다음 단계 (수동 작업)**

1. **Cloudflare 영구 Tunnel 생성** — \`bot.nolza.org\`, \`pc.nolza.org\`
   \`cloudflared tunnel login\` → \`create\` → \`route dns\` → \`config.yml\` → \`service install\`
2. **BIOS WoL 활성화** — \`Power On By PCI-E: Enabled\`, \`ErP: Disabled\`
3. **Worker \`LOCAL_BOT_URL\` 환경변수 설정** — Tunnel URL 확정 후

**📚 문서**
- \`docs/AI_NATIVE_OPS_ARCH.md\` — 전체 운영 아키텍처
- \`docs/CLOUDFLARE_TUNNEL_SETUP.md\` — Tunnel 생성 단계별 가이드
- \`docs/WOL_PC_REMOTE_BOOT.md\` — WoL 상세 설정 (업데이트됨)

━━━━━━━━━━━━━━━━━━━━━━━`;

  await channel.send(msg);
  console.log('[Notice] 공지 전송 완료');
  client.destroy();
});

client.on('error', (err) => {
  console.error('[Notice] 클라이언트 오류:', err);
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN);
