/**
 * Docker Health Alerts Watcher
 *
 * 역할
 * - `docker events --filter event=health_status` 를 로컬 CLI로 stream
 * - unhealthy/healthy 전환을 감지해 Discord `#alerts` 채널에 알림 푸시
 * - 채널이 없으면 자동 생성 (봇이 서버 관리자 권한 보유)
 *
 * 환경변수
 * - ALERTS_CHANNEL_NAME : 기본 '🚨-alerts'
 * - ALERTS_GUILD_ID    : 기본 '1491466936863821857' (nolza 서버)
 *
 * 참고
 * - autoheal 컨테이너가 unhealthy → 자동 재시작 → healthy 순서로 이벤트를 발생시킨다.
 * - 본 watcher 는 "관찰 + 알림" 전담이며 복구 액션은 수행하지 않는다 (C안).
 */

const { spawn } = require('child_process');

const DEFAULT_CHANNEL_NAME = process.env.ALERTS_CHANNEL_NAME || '🚨-alerts';
const GUILD_ID = process.env.ALERTS_GUILD_ID || '1491466936863821857';

/**
 * #alerts 채널을 확인하고 없으면 생성한다.
 * @param {import('discord.js').Client} client
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
async function ensureAlertsChannel(client) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(
      (c) => c.name === DEFAULT_CHANNEL_NAME && c.type === 0 /* GUILD_TEXT */,
    );

    if (channel) {
      console.log(`[Alerts] 채널 확인: #${channel.name} (id=${channel.id})`);
      return channel;
    }

    channel = await guild.channels.create({
      name: DEFAULT_CHANNEL_NAME,
      type: 0,
      topic: '🚨 인프라 헬스 알림. docker health_status 전환(unhealthy/healthy) 자동 푸시',
      reason: 'alerts-watcher 자동 생성',
    });
    console.log(`[Alerts] 채널 생성: #${channel.name} (id=${channel.id})`);
    await channel.send(
      '🚨 **alerts 채널이 준비되었습니다.**\n' +
        'docker `health_status: unhealthy` / `health_status: healthy` 전환이 발생하면 이 채널로 자동 푸시됩니다.',
    );
    return channel;
  } catch (err) {
    console.error('[Alerts] 채널 확보 실패:', err.message);
    return null;
  }
}

/**
 * docker events stream 을 파싱해 health_status 라인만 추출한다.
 * @param {(evt: {status: string, container: string, image: string, time: string}) => void} onEvent
 * @returns {import('child_process').ChildProcessWithoutNullStreams}
 */
function streamDockerHealthEvents(onEvent) {
  const proc = spawn(
    'docker',
    [
      'events',
      '--filter',
      'event=health_status',
      '--format',
      '{{.Time}}|{{.Status}}|{{.Actor.Attributes.name}}|{{.Actor.Attributes.image}}',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const [time, status, container, image] = line.split('|');
      if (!status || !container) continue;
      onEvent({ time, status, container, image });
    }
  });

  proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString('utf8').trim();
    if (msg) console.error('[Alerts][docker events stderr]', msg);
  });

  proc.on('exit', (code, signal) => {
    console.warn(`[Alerts] docker events 종료 code=${code} signal=${signal}`);
  });

  return proc;
}

/**
 * Watcher 시작. 실패해도 봇 본체는 죽지 않는다 (degraded mode 허용).
 * @param {import('discord.js').Client} client
 */
async function startAlertsWatcher(client) {
  const channel = await ensureAlertsChannel(client);
  if (!channel) {
    console.warn('[Alerts] 채널 확보 실패 → watcher 미가동');
    return;
  }

  // 중복 이벤트 억제 (10초 내 동일 container+status 무시)
  const recent = new Map();
  const DEDUP_WINDOW_MS = 10_000;

  let backoffMs = 1_000;
  const MAX_BACKOFF = 60_000;

  const start = () => {
    const proc = streamDockerHealthEvents((evt) => {
      const key = `${evt.container}:${evt.status}`;
      const now = Date.now();
      const last = recent.get(key) || 0;
      if (now - last < DEDUP_WINDOW_MS) return;
      recent.set(key, now);

      const isUnhealthy = evt.status === 'health_status: unhealthy';
      const emoji = isUnhealthy ? '🔴' : evt.status === 'health_status: healthy' ? '🟢' : '⚪';
      const ts = new Date(Number(evt.time) * 1000).toISOString().replace('T', ' ').slice(0, 19);

      const msg = [
        `${emoji} **${evt.status}**`,
        `• container: \`${evt.container}\``,
        `• image: \`${evt.image || 'unknown'}\``,
        `• at: \`${ts} UTC\``,
      ].join('\n');

      channel.send(msg).catch((err) => console.error('[Alerts] send 실패:', err.message));
      backoffMs = 1_000; // 정상 수신이면 backoff 리셋
    });

    proc.on('exit', () => {
      // docker daemon 재시작/끊김 시 자동 재연결
      const wait = backoffMs;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      console.log(`[Alerts] ${wait}ms 후 재연결 시도`);
      setTimeout(start, wait);
    });
  };

  start();
  console.log(`[Alerts] watcher 시작 → #${channel.name}`);
}

module.exports = { startAlertsWatcher, ensureAlertsChannel };
