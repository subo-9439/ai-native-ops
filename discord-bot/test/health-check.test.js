// runHealthCheck 단위 테스트 — Render API/Discord 외부 의존 mock.
// CI 게이트(.github/workflows/discord-bot-test.yml)에서 push 마다 자동 실행.
//
// 실행: node discord-bot/test/health-check.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runHealthCheck } = require('../lib/health-check');
const { installSafeSendGuards } = require('../lib/safe-send');

async function withTempQueue(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whosbuying-queue-'));
  const qp = path.join(tmpDir, 'work-queue.json');
  fs.writeFileSync(
    qp,
    JSON.stringify({ items: [{ id: 'A', status: 'done' }, { id: 'B', status: 'pending' }] }),
  );
  try {
    return await fn(qp);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runTests() {
  const fakeClient = { ws: { status: 0 } };
  const mockedRender = async () => ({ status: 'unknown', reason: 'mocked-no-env' });

  // 1) safe-send 가드 미설치 상태 — guarded=false 여야 함
  // (이 단위 테스트는 별도 worker 가 아니므로 install 전에 먼저 호출)
  const beforeInstall = await withTempQueue((qp) =>
    runHealthCheck({ client: fakeClient, queuePath: qp, fetchDeploy: mockedRender }),
  );
  const safeBefore = beforeInstall.checks.find((c) => c.name === 'safe-send');
  assert.ok(safeBefore, '1) safe-send check 존재');
  assert.strictEqual(safeBefore.ok, false, '1) safe-send 미설치면 ok=false');

  // 2) safe-send 가드 설치 후 — guarded=true
  installSafeSendGuards();
  const afterInstall = await withTempQueue((qp) =>
    runHealthCheck({ client: fakeClient, queuePath: qp, fetchDeploy: mockedRender }),
  );
  const safeAfter = afterInstall.checks.find((c) => c.name === 'safe-send');
  assert.strictEqual(safeAfter.ok, true, '2) safe-send 설치되면 ok=true');
  assert.match(safeAfter.detail, /guarded/, '2) detail=guarded');

  // 3) 모든 5개 check 가 결과에 포함
  const names = afterInstall.checks.map((c) => c.name).sort();
  assert.deepStrictEqual(
    names,
    ['discord-ws', 'git', 'render', 'safe-send', 'work-queue'],
    '3) 5개 check 모두 포함',
  );

  // 4) work-queue 로드 성공 + items=2 detail
  const wq = afterInstall.checks.find((c) => c.name === 'work-queue');
  assert.strictEqual(wq.ok, true, '4) work-queue ok');
  assert.match(wq.detail, /items=2/, '4) items=2 detail');
  assert.match(wq.detail, /pending=1/, '4) pending=1 detail');

  // 5) discord-ws ready
  const ws = afterInstall.checks.find((c) => c.name === 'discord-ws');
  assert.strictEqual(ws.ok, true, '5) ws ready');

  // 6) work-queue 경로 잘못된 경우 ok=false (degraded 보고)
  const badResult = await runHealthCheck({
    client: fakeClient,
    queuePath: '/nonexistent/path/work-queue.json',
    fetchDeploy: mockedRender,
  });
  const badWq = badResult.checks.find((c) => c.name === 'work-queue');
  assert.strictEqual(badWq.ok, false, '6) 잘못된 경로면 ok=false');

  // 7) Render error 면 ok=false
  const renderErr = await withTempQueue((qp) =>
    runHealthCheck({
      client: fakeClient,
      queuePath: qp,
      fetchDeploy: async () => ({ status: 'error', reason: 'HTTP 500' }),
    }),
  );
  const renderC = renderErr.checks.find((c) => c.name === 'render');
  assert.strictEqual(renderC.ok, false, '7) render error 면 ok=false');

  // 8) Render live 면 ok=true
  const renderLive = await withTempQueue((qp) =>
    runHealthCheck({
      client: fakeClient,
      queuePath: qp,
      fetchDeploy: async () => ({ status: 'live', commit: 'abcdef0' }),
    }),
  );
  const renderL = renderLive.checks.find((c) => c.name === 'render');
  assert.strictEqual(renderL.ok, true, '8) render live 면 ok=true');
  assert.match(renderL.detail, /abcdef0/, '8) commit detail');

  console.log('OK — health-check 8 케이스 PASS');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL —', err.message);
    console.error(err.stack);
    process.exit(1);
  });
