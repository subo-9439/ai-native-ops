/**
 * work-queue.js — 순차 디스패치 큐 + 자동 체이닝
 *
 * 큐 파일: project-manager/work-queue.json
 * 구조:
 *   { items: [ { id, title, agent, prompt, status, startedAt, completedAt } ] }
 *
 * status: "pending" → "in_progress" → "done" | "failed"
 *
 * 체이닝 흐름:
 *   1. pickNext() → 첫 pending 아이템을 in_progress로 변경
 *   2. dispatchItem() → 해당 아이템을 에이전트 스레드로 디스패치
 *   3. onDispatchComplete() → done 처리 + 다음 아이템 자동 pick
 */

const fs = require('fs');
const path = require('path');

const QUEUE_PATH = path.resolve(__dirname, '..', 'work-queue.json');
const QUEUE_LOG_PATH = path.resolve(__dirname, '..', 'work-queue.log');

/** 큐 작업 로그 기록 (파일 append) */
function logQueueOp(op, detail = '') {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${op}${detail ? ' — ' + detail : ''}\n`;
  try {
    fs.appendFileSync(QUEUE_LOG_PATH, line, 'utf-8');
  } catch (_) {
    // 로그 실패해도 큐 동작에 영향 없도록
  }
}

/** 큐 파일 읽기 (없으면 null) */
function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return null;
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  } catch (err) {
    console.error('[WorkQueue] 큐 파일 읽기 실패:', err.message);
    return null;
  }
}

/** 큐 파일 저장 */
function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  console.log('[WorkQueue] 큐 저장 완료');
}

/**
 * stale in_progress 아이템 복구 — 봇 재시작 시 호출.
 * 비정상 종료로 in_progress 상태에 남아 있는 아이템을 failed로 전환.
 * @returns {Array} 복구된 아이템 목록
 */
function recoverStaleItems() {
  const queue = loadQueue();
  if (!queue?.items) return [];

  const stale = queue.items.filter(i => i.status === 'in_progress');
  if (stale.length === 0) return [];

  for (const item of stale) {
    item.status = 'failed';
    item.completedAt = new Date().toISOString();
    item.failReason = 'stale_on_restart';
    logQueueOp('RECOVER_STALE', `${item.id} (${item.title}) — in_progress → failed`);
    console.warn(`[WorkQueue] stale 복구: ${item.id} → failed (봇 재시작 감지)`);
  }

  saveQueue(queue);
  return stale;
}

/** 다음 pending 아이템 반환 (상태 변경 안 함) */
function peekNext() {
  const queue = loadQueue();
  if (!queue?.items) return null;
  return queue.items.find(item => item.status === 'pending') || null;
}

/** 다음 pending 아이템을 in_progress로 전환하고 반환 */
function pickNext() {
  const queue = loadQueue();
  if (!queue?.items) return null;

  const item = queue.items.find(i => i.status === 'pending');
  if (!item) {
    console.log('[WorkQueue] 큐 비어있음 — 모든 아이템 처리 완료');
    return null;
  }

  item.status = 'in_progress';
  item.startedAt = new Date().toISOString();
  saveQueue(queue);

  logQueueOp('PICK', `${item.id} (${item.title}) → in_progress`);
  console.log(`[WorkQueue] pick: ${item.id} (${item.title})`);
  return item;
}

/** 아이템 완료 처리 */
function completeItem(itemId, success = true) {
  const queue = loadQueue();
  if (!queue?.items) return null;

  const item = queue.items.find(i => i.id === itemId);
  if (!item) {
    console.error(`[WorkQueue] 아이템 없음: ${itemId}`);
    return null;
  }

  item.status = success ? 'done' : 'failed';
  item.completedAt = new Date().toISOString();
  saveQueue(queue);

  logQueueOp(success ? 'DONE' : 'FAILED', `${item.id} (${item.title})`);
  console.log(`[WorkQueue] ${success ? 'done' : 'failed'}: ${item.id} (${item.title})`);
  return item;
}

/** 현재 진행 중인 아이템 반환 */
function currentItem() {
  const queue = loadQueue();
  if (!queue?.items) return null;
  return queue.items.find(i => i.status === 'in_progress') || null;
}

/** 큐 상태 요약 텍스트 (AI가 이해하기 쉬운 자연어 형식) */
function queueSummary() {
  const queue = loadQueue();
  if (!queue?.items) return '작업 큐가 비어 있습니다.';

  const STATUS_LABELS = {
    done: '완료',
    failed: '실패',
    in_progress: '진행 중',
    pending: '대기',
  };

  const lines = queue.items.map((item, idx) => {
    const label = STATUS_LABELS[item.status] || item.status;
    return `${idx + 1}. [${label}] ${item.id} - ${item.title} (담당: ${item.agent})`;
  });

  const done = queue.items.filter(i => i.status === 'done').length;
  const pending = queue.items.filter(i => i.status === 'pending').length;
  const inProgress = queue.items.filter(i => i.status === 'in_progress').length;
  const failed = queue.items.filter(i => i.status === 'failed').length;
  const total = queue.items.length;

  const stats = [`전체 ${total}건`];
  if (done > 0)       stats.push(`완료 ${done}건`);
  if (inProgress > 0) stats.push(`진행 중 ${inProgress}건`);
  if (pending > 0)    stats.push(`대기 ${pending}건`);
  if (failed > 0)     stats.push(`실패 ${failed}건`);
  lines.push(`\n진행 현황: ${stats.join(', ')}`);

  return lines.join('\n');
}

module.exports = {
  QUEUE_PATH,
  loadQueue,
  saveQueue,
  peekNext,
  pickNext,
  completeItem,
  currentItem,
  queueSummary,
  recoverStaleItems,
};
