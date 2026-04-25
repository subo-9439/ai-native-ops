// 5분 주기 봇 자가진단 watcher — runHealthCheck 결과 실패 시 #🚨-alerts 자동 푸시.
// CEO 가 Render 대시보드를 직접 보지 않아도 봇이 스스로 "나 깨졌으니 재시작해줘" 라고 말한다.
// B2B 임베드 SDK 도 동일 안전망 패턴을 차용할 수 있도록 의존을 최소화 (degraded fallback 허용).

const { EmbedBuilder } = require('discord.js');
const { runHealthCheck } = require('./lib/health-check');
const { ensureAlertsChannel } = require('./alerts-watcher');

const INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS) || 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = Number(process.env.HEALTH_FIRST_DELAY_MS) || 30_000;
const FAIL_DEDUP_MS = Number(process.env.HEALTH_FAIL_DEDUP_MS) || 10 * 60 * 1000;

async function startHealthWatcher(client) {
  const channel = await ensureAlertsChannel(client);
  if (!channel) {
    console.warn('[Health] alerts 채널 확보 실패 — health-watcher 미가동 (degraded)');
    return;
  }

  let lastFailKey = '';
  let lastFailReportAt = 0;

  const tick = async () => {
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
      lastFailKey = '';
      lastFailReportAt = 0;
      return;
    }

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
