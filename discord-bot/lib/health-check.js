// 봇 자가진단 — 부팅 시 1회 + 5분 주기 cron 으로 실행.
// 검사 항목 (모두 외부 의존 실패 시 degraded 로 보고):
//   1. safe-send 가드 설치 여부 (BASE_TYPE_MAX_LENGTH 회귀 차단)
//   2. Discord WebSocket READY 여부
//   3. work-queue.json 로드 가능 여부
//   4. git HEAD SHA 조회 가능 여부 (재시작 후 코드 반영 검증용)
//   5. Render 최근 디플로이 상태 (env 있을 때만)
//
// 호출 측은 결과의 ok=false 또는 checks[].ok=false 항목을 사람에게 보고하면 된다.
// 외부 시스템(Render, Discord)에 의존하지 않는 단위 테스트가 가능하도록 client/queuePath/render
// 모두 주입 가능.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let _renderStatus;
function getRenderStatus() {
  if (!_renderStatus) _renderStatus = require('./render-status');
  return _renderStatus;
}

const DEFAULT_QUEUE_PATH = path.resolve(__dirname, '..', '..', 'work-queue.json');
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

async function runHealthCheck({
  client,
  queuePath = DEFAULT_QUEUE_PATH,
  repoRoot = DEFAULT_REPO_ROOT,
  fetchDeploy,
} = {}) {
  const checks = [];

  // 1. safe-send 가드 — MessagePayload.prototype.makeContent 가 patch 되었는지
  try {
    const { MessagePayload } = require('discord.js');
    const fnSrc = MessagePayload?.prototype?.makeContent?.toString?.() || '';
    const guarded = /patchedMakeContent|safe-send|truncate/.test(fnSrc);
    checks.push({
      name: 'safe-send',
      ok: guarded,
      detail: guarded ? 'guarded' : '미설치 — BASE_TYPE_MAX_LENGTH 회귀 위험',
    });
  } catch (err) {
    checks.push({ name: 'safe-send', ok: false, detail: `import 실패: ${err.message}` });
  }

  // 2. Discord WebSocket READY (status === 0)
  const wsStatus = client?.ws?.status;
  checks.push({
    name: 'discord-ws',
    ok: wsStatus === 0,
    detail: wsStatus === 0 ? 'READY' : `status=${wsStatus ?? 'no-client'}`,
  });

  // 3. work-queue 로드
  try {
    const stat = fs.statSync(queuePath);
    const raw = fs.readFileSync(queuePath, 'utf8');
    const json = JSON.parse(raw);
    const items = json.items || [];
    const inProg = items.filter((i) => i.status === 'in_progress').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    checks.push({
      name: 'work-queue',
      ok: true,
      detail: `items=${items.length}, in_progress=${inProg}, pending=${pending}, mtime=${stat.mtime.toISOString()}`,
    });
  } catch (err) {
    checks.push({ name: 'work-queue', ok: false, detail: err.message });
  }

  // 4. git SHA
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    checks.push({ name: 'git', ok: Boolean(sha), detail: sha || 'empty' });
  } catch (err) {
    checks.push({ name: 'git', ok: false, detail: err.message });
  }

  // 5. Render 최근 디플로이
  try {
    const fn = fetchDeploy || getRenderStatus().fetchLatestDeploy;
    const render = await fn({ timeoutMs: 5000 });
    // unknown(env 미설정)/live = degraded ok, 그 외(error/build_failed/update_failed)는 fail
    const okStatuses = new Set(['unknown', 'live']);
    const ok = okStatuses.has(render.status);
    const parts = [render.status];
    if (render.commit) parts.push(render.commit);
    if (render.reason) parts.push(render.reason);
    checks.push({ name: 'render', ok, detail: parts.join(' ') });
  } catch (err) {
    checks.push({ name: 'render', ok: false, detail: err.message });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    ts: new Date().toISOString(),
  };
}

module.exports = { runHealthCheck };
