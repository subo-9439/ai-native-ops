/**
 * queue-watchdog.js — in_progress 큐 아이템 stale 감시
 *
 * 문제:
 *   work-queue.js 의 recoverStaleItems 는 봇 재시작 시점에만 동작한다.
 *   봇이 살아있는데 dev 에이전트가 30~60분 무응답으로 멈추면 운영자는
 *   디스코드를 새로고침해 가며 직접 확인해야 한다.
 *
 * 해결:
 *   봇 기동 후 startQueueWatchdog 가 5분마다 큐를 폴링한다.
 *   in_progress 아이템의 startedAt 을 기준으로 elapsed 계산.
 *
 *   - elapsed >= 15분 && !warnedAt   → #alerts 에 경고 1회 + warnedAt 기록
 *   - elapsed >= 30분 && !escalatedAt → #alerts 에 critical 1회 + escalatedAt 기록
 *
 *   auto-fail 은 하지 않는다. 정상이지만 오래 걸리는 작업도 있어 사람이
 *   판단해야 한다. CEO 는 알림을 받으면 `!큐중지` 또는 단건 디스패치로 잇는다.
 *
 * 환경변수:
 *   - QUEUE_WATCHDOG_INTERVAL_MS (기본 5분, 60_000~600_000 권장)
 *   - QUEUE_WATCHDOG_WARN_MS     (기본 15분)
 *   - QUEUE_WATCHDOG_CRIT_MS     (기본 30분)
 *   - ALERTS_CHANNEL_NAME        (alerts-watcher 와 공유, 기본 '🚨-alerts')
 *   - ALERTS_GUILD_ID            (alerts-watcher 와 공유)
 *
 * 트레이드오프:
 *   - 큐 파일에 warnedAt/escalatedAt 필드를 추가해 saveQueue 한다. 다른
 *     코드(work-queue.js) 는 이 필드를 무시한다 (extra property).
 *   - 봇이 죽었다 살아나면 warnedAt 은 유지되므로 같은 in_progress 에
 *     중복 알림이 가지 않는다 — 의도된 동작.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const QUEUE_PATH = path.resolve(__dirname, '..', 'work-queue.json');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_WARN_MS = 15 * 60 * 1000;
const DEFAULT_CRIT_MS = 30 * 60 * 1000;

const ALERTS_CHANNEL_NAME = process.env.ALERTS_CHANNEL_NAME || '🚨-alerts';
const ALERTS_GUILD_ID = process.env.ALERTS_GUILD_ID || '1491466936863821857';

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return null;
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
}

async function findAlertsChannel(client) {
  try {
    const guild = await client.guilds.fetch(ALERTS_GUILD_ID);
    await guild.channels.fetch();
    return guild.channels.cache.find(
      (c) => c.name === ALERTS_CHANNEL_NAME && c.type === 0,
    ) || null;
  } catch (err) {
    console.error('[QueueWatchdog] alerts 채널 탐색 실패:', err.message);
    return null;
  }
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}분 ${s}초`;
}

function buildAlertEmbed(level, item, elapsedMs, thresholdMs) {
  const isCrit = level === 'critical';
  return new EmbedBuilder()
    .setTitle(isCrit ? '🛑 큐 아이템 무응답 (critical)' : '⏰ 큐 아이템 지연 감지')
    .setColor(isCrit ? 0xe74c3c : 0xf1c40f)
    .setDescription(
      isCrit
        ? '에이전트가 30분 이상 응답이 없습니다. CEO 결정이 필요합니다.'
        : '에이전트가 15분 이상 응답이 없습니다. 정상이지만 오래 걸리는 작업이거나 무응답일 수 있습니다.',
    )
    .addFields(
      { name: 'PR', value: `**${item.id}** — ${item.title}`, inline: false },
      { name: '담당', value: item.agent || 'unknown', inline: true },
      { name: '경과', value: formatElapsed(elapsedMs), inline: true },
      { name: 'threshold', value: formatElapsed(thresholdMs), inline: true },
      { name: 'startedAt', value: item.startedAt || 'unknown', inline: false },
      {
        name: '대응',
        value: [
          '• 정상 진행 중이면 무시',
          '• 무응답이면 `!큐중지` 후 단건 재디스패치',
          '• 즉시 다음 큐 아이템으로 넘기려면 work-queue.json 에서 status `failed` 처리',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'queue-watchdog — 자동 감시 (auto-fail 하지 않음)' });
}

/**
 * 큐 1회 점검. setInterval 콜백 + 외부 테스트 진입점.
 * @param {import('discord.js').Client} client
 * @param {{warnMs: number, critMs: number}} thresholds
 */
async function checkOnce(client, thresholds) {
  const queue = readQueue();
  if (!queue?.items) return;

  const now = Date.now();
  let mutated = false;
  const alerts = [];

  for (const item of queue.items) {
    if (item.status !== 'in_progress') continue;
    if (!item.startedAt) continue;
    const startedMs = new Date(item.startedAt).getTime();
    if (Number.isNaN(startedMs)) continue;
    const elapsed = now - startedMs;

    if (elapsed >= thresholds.critMs && !item.escalatedAt) {
      item.escalatedAt = new Date(now).toISOString();
      alerts.push({ level: 'critical', item, elapsed, threshold: thresholds.critMs });
      mutated = true;
      continue;
    }
    if (elapsed >= thresholds.warnMs && !item.warnedAt) {
      item.warnedAt = new Date(now).toISOString();
      alerts.push({ level: 'warn', item, elapsed, threshold: thresholds.warnMs });
      mutated = true;
    }
  }

  if (mutated) writeQueue(queue);

  if (alerts.length === 0) return;

  const channel = await findAlertsChannel(client);
  if (!channel) {
    console.warn('[QueueWatchdog] alerts 채널 없음 — 알림 스킵 (mutated 만 기록)');
    return;
  }

  for (const a of alerts) {
    try {
      await channel.send({ embeds: [buildAlertEmbed(a.level, a.item, a.elapsed, a.threshold)] });
      console.log(`[QueueWatchdog] ${a.level} 알림 전송: ${a.item.id} elapsed=${formatElapsed(a.elapsed)}`);
    } catch (err) {
      console.error('[QueueWatchdog] 알림 전송 실패:', err.message);
    }
  }
}

/**
 * 봇 기동 시 1회 호출. setInterval 핸들을 반환하지만 봇 lifecycle 내내 살아있도록 둔다.
 * 실패해도 봇은 계속 동작해야 하므로 외부에서 try/catch.
 */
function startQueueWatchdog(client, opts = {}) {
  const intervalMs = Number(process.env.QUEUE_WATCHDOG_INTERVAL_MS) || opts.intervalMs || DEFAULT_INTERVAL_MS;
  const warnMs = Number(process.env.QUEUE_WATCHDOG_WARN_MS) || opts.warnMs || DEFAULT_WARN_MS;
  const critMs = Number(process.env.QUEUE_WATCHDOG_CRIT_MS) || opts.critMs || DEFAULT_CRIT_MS;

  if (warnMs >= critMs) {
    console.warn(`[QueueWatchdog] warnMs(${warnMs}) >= critMs(${critMs}) — 설정 확인 필요`);
  }

  const thresholds = { warnMs, critMs };
  console.log(
    `[QueueWatchdog] 시작 — interval=${formatElapsed(intervalMs)}, ` +
      `warn=${formatElapsed(warnMs)}, crit=${formatElapsed(critMs)}`,
  );

  // 첫 점검은 인터벌 1회분 후. 봇 기동 직후 in_progress 가 있으면 어차피
  // recoverStaleItems 가 failed 처리하므로 즉시 점검은 불필요.
  const timer = setInterval(() => {
    checkOnce(client, thresholds).catch((err) => {
      console.error('[QueueWatchdog] checkOnce 실패:', err.message);
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { startQueueWatchdog, checkOnce };
