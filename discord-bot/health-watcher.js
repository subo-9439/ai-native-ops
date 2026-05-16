// 5분 주기 봇 자가진단 watcher — runHealthCheck 결과 실패 시 #🚨-alerts 자동 푸시.
// CEO 가 Render 대시보드를 직접 보지 않아도 봇이 스스로 "나 깨졌으니 재시작해줘" 라고 말한다.
// B2B 임베드 SDK 도 동일 안전망 패턴을 차용할 수 있도록 의존을 최소화 (degraded fallback 허용).

const fs = require('fs');
const { EmbedBuilder } = require('discord.js');
const { runHealthCheck } = require('./lib/health-check');
const { ensureAlertsChannel } = require('./alerts-watcher');

const INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS) || 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = Number(process.env.HEALTH_FIRST_DELAY_MS) || 30_000;
const FAIL_DEDUP_MS = Number(process.env.HEALTH_FAIL_DEDUP_MS) || 10 * 60 * 1000;

// PR-BOT-HEARTBEAT (2026-05-17): 단일 메시지 edit 로 "살아있음" 가시화.
// 사용자 지시(4회 반복): "멈춘건지 돌아가고 있는건지 알게 점검시간 계속 남겨줘".
// 메시지 1개를 매 tick edit → 채널 도배 X. 시각이 안 올라가면 = 봇 멈춤.
const HEARTBEAT_STATE = '/tmp/discord-heartbeat-msg.txt';
const BOT_BOOT_AT = new Date();

function kst(d) {
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}시간 ${m}분`;
}

async function startHealthWatcher(client) {
  const channel = await ensureAlertsChannel(client);
  if (!channel) {
    console.warn('[Health] alerts 채널 확보 실패 — health-watcher 미가동 (degraded)');
    return;
  }

  let lastFailKey = '';
  let lastFailReportAt = 0;
  let tickCount = 0;

  // heartbeat 메시지 1개 확보 (재시작해도 같은 메시지 이어 edit) → 채널 도배 방지.
  async function upsertHeartbeat(ok, result) {
    try {
      const now = new Date();
      const statusLine = ok
        ? `🟢 정상 동작 중`
        : `🔴 일부 항목 실패 (${result.checks.filter((c) => !c.ok).map((c) => c.name).join(',')})`;
      const embed = new EmbedBuilder()
        .setTitle('💓 봇 Heartbeat — 살아있음 확인')
        .setColor(ok ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `${statusLine}\n\n` +
          `**마지막 점검**: ${kst(now)} (KST)\n` +
          `**봇 기동**: ${kst(BOT_BOOT_AT)} (uptime ${fmtDur(now - BOT_BOOT_AT)})\n` +
          `**점검 횟수**: ${tickCount}회 (5분 주기)\n` +
          `**다음 점검**: 약 5분 후\n\n` +
          `⏱ 이 시각이 5분 넘게 안 올라가면 봇이 멈춘 것.`,
        )
        .setFooter({ text: 'PR-BOT-HEARTBEAT · 매 5분 자동 갱신 (단일 메시지 edit)' });

      let msgId = '';
      try { msgId = fs.readFileSync(HEARTBEAT_STATE, 'utf8').trim(); } catch (_) {}
      if (msgId) {
        try {
          const m = await channel.messages.fetch(msgId);
          await m.edit({ embeds: [embed] });
          return;
        } catch (_) { /* 메시지 삭제됨 → 새로 생성 */ }
      }
      const sent = await channel.send({ embeds: [embed] });
      fs.writeFileSync(HEARTBEAT_STATE, sent.id);
    } catch (err) {
      console.error('[Health] heartbeat upsert 실패:', err.message);
    }
  }

  const tick = async () => {
    tickCount += 1;
    let result;
    try {
      result = await runHealthCheck({ client });
    } catch (err) {
      console.error('[Health] runHealthCheck 예외:', err.message);
      return;
    }

    const failed = result.checks.filter((c) => !c.ok);
    if (failed.length === 0) {
      console.log(`[Health] OK ${result.ts} (${result.checks.map((c) => c.name).join(',')})`);
      await upsertHeartbeat(true, result);
      lastFailKey = '';
      lastFailReportAt = 0;
      return;
    }

    await upsertHeartbeat(false, result);

    const failKey = failed.map((c) => c.name).sort().join(',');
    const now = Date.now();
    if (failKey === lastFailKey && now - lastFailReportAt < FAIL_DEDUP_MS) {
      const remainSec = Math.round((FAIL_DEDUP_MS - (now - lastFailReportAt)) / 1000);
      console.log(`[Health] 동일 실패 ${failKey} (dedup ${remainSec}s 남음)`);
      return;
    }
    lastFailKey = failKey;
    lastFailReportAt = now;

    const embed = new EmbedBuilder()
      .setTitle('🚨 봇 자가진단 실패')
      .setColor(0xe74c3c)
      .setDescription(`5분 주기 health-check 에서 ${failed.length}개 항목 실패.`)
      .addFields(
        ...result.checks.map((c) => ({
          name: `${c.ok ? '🟢' : '🔴'} ${c.name}`,
          value: '`' + (c.detail || '').toString().slice(0, 200) + '`',
          inline: false,
        })),
        { name: '시각 (UTC)', value: result.ts, inline: false },
      )
      .setFooter({ text: 'Render 재시작 또는 코드 수정이 필요할 수 있음' });

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[Health] alert 전송 실패:', err.message);
    }
  };

  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
  console.log(
    `[Health] watcher 시작 (interval=${INTERVAL_MS}ms, first=${FIRST_RUN_DELAY_MS}ms, dedup=${FAIL_DEDUP_MS}ms)`,
  );
}

module.exports = { startHealthWatcher };
