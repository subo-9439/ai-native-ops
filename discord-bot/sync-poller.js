/**
 * sync-poller — 등록된 모든 프로젝트의 events.jsonl을 주기적으로 읽고
 * 임계치 도달 시 claude CLI로 digest(일 단위 요약) 생성.
 *
 * 동작:
 *   1. loadProjects() → 각 slug별로 순회
 *   2. reader id = 'discord-bot:digest' 오프셋 이후 events 파싱
 *   3. (새 이벤트 수 ≥ digestTriggerCount) OR (마지막 digest로부터 digestIntervalMs 경과)
 *      → digest 생성
 *   4. digest = claude --print --dangerously-skip-permissions 호출
 *      프롬프트: 다음 이벤트 N건을 읽고 docs/memory-bank/activeContext.md의
 *               "## 최근 활동" 섹션 갱신(없으면 추가)
 *      cwd = project root (projects.json의 첫 roots[0])
 *   5. 원본 digest는 ~/.claude-sync/<slug>/digests/<yyyy-mm-dd>.md 에 append
 *   6. 오프셋 저장
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SCHEMA_PATH = path.join(os.homedir(), '.claude-sync', 'lib', 'schema.js');

let schema = null;
try {
  schema = require(SCHEMA_PATH);
} catch (err) {
  console.error('[sync-poller] schema.js 로드 실패 (poller 비활성):', err.message);
}

const READER_ID = 'discord-bot:digest';
const LAST_DIGEST_TS = Object.create(null); // slug → epoch ms
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000; // 10분

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * claude CLI를 서브프로세스로 호출하여 digest 생성.
 * stdout 전체 텍스트를 resolve. 타임아웃/에러 시 reject.
 *
 * @param {string} cwd
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function runClaudeDigest(cwd, prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      ['--print', '--dangerously-skip-permissions'],
      { cwd, env: process.env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let out = '';
    let err = '';

    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });

    const t = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      reject(new Error(`claude digest 타임아웃 (${CLAUDE_TIMEOUT_MS}ms)`));
    }, CLAUDE_TIMEOUT_MS);

    proc.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });

    proc.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0 && !out.trim()) {
        reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`));
        return;
      }
      resolve(out);
    });

    try {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } catch (e) {
      clearTimeout(t);
      reject(e);
    }
  });
}

/**
 * 한 슬러그에 대해 digest 처리.
 * @param {{slug:string,roots:string[]}} project
 * @param {Object} opts
 */
async function processProject(project, opts) {
  const { slug, roots } = project;
  if (!slug || !Array.isArray(roots) || roots.length === 0) return;

  const offsets = schema.loadOffsets(slug);
  const currentOffset = offsets[READER_ID] || 0;

  const { events, newOffset } = schema.readEventsSince(slug, currentOffset);
  if (events.length === 0) return;

  const now = Date.now();
  const lastDigest = LAST_DIGEST_TS[slug] || 0;
  const countHit = events.length >= opts.digestTriggerCount;
  const timeHit = lastDigest > 0 && now - lastDigest >= opts.digestIntervalMs;
  const firstRun = lastDigest === 0 && events.length >= opts.digestTriggerCount;

  if (!countHit && !timeHit && !firstRun) {
    // 아직 digest 임계에 못 미침 — 오프셋도 진전시키지 않음(나중에 누적해서 요약)
    return;
  }

  const projectRoot = roots[0];
  if (!fs.existsSync(projectRoot)) {
    console.error(`[sync-poller] ${slug}: project root 없음 ${projectRoot}`);
    // 오프셋은 진전시켜서 같은 이벤트로 계속 시도하지 않게
    schema.saveOffsets(slug, READER_ID, newOffset);
    LAST_DIGEST_TS[slug] = now;
    return;
  }

  const header =
    `다음 이벤트 ${events.length}건은 최근 이 프로젝트에서 발생한 ` +
    `Discord 봇/터미널 Claude 작업 로그입니다.\n\n` +
    `이 로그를 읽고 docs/memory-bank/activeContext.md 파일의 ` +
    `"## 최근 활동" 섹션을 갱신하세요. 섹션이 없으면 파일 끝에 추가하세요.\n` +
    `- 날짜별로 정리하고, 핵심 변경만 3~6줄로 요약.\n` +
    `- 파일 경로(artifacts)가 있으면 괄호로 표시.\n` +
    `- 중복되는 내용은 합쳐서 기록.\n` +
    `- 기존 섹션을 확장하되 오래된 항목은 간결화.\n\n` +
    `작업 완료 후 "요약: <한 줄>" 형태로 stdout에 요약만 출력하세요.\n\n` +
    `[이벤트 JSON lines]\n`;

  const eventsBody = events.map(e => JSON.stringify(e)).join('\n');
  const prompt = header + eventsBody + '\n';

  console.log(`[sync-poller] ${slug}: digest 실행 (${events.length}건, cwd=${projectRoot})`);

  try {
    const digest = await runClaudeDigest(projectRoot, prompt);

    const digestsDir = schema.digestsDir(slug);
    schema.ensureDir(digestsDir);
    const digestFile = path.join(digestsDir, `${todayStamp()}.md`);

    const block =
      `\n## ${new Date().toISOString()} — ${events.length} events\n\n` +
      digest.trim() + '\n';
    fs.appendFileSync(digestFile, block);

    schema.saveOffsets(slug, READER_ID, newOffset);
    LAST_DIGEST_TS[slug] = now;

    console.log(`[sync-poller] ${slug}: digest 저장 완료 → ${digestFile}`);
  } catch (err) {
    console.error(`[sync-poller] ${slug}: digest 실패:`, err.message);
    // 실패 시 오프셋 유지(다음 주기 재시도)
  }
}

/**
 * 폴러 시작. 반환값은 { stop() } — 테스트/종료용.
 *
 * @param {Object} opts
 * @param {import('discord.js').Client} [opts.client] - 현재 미사용, 향후 확장 여지
 * @param {number} [opts.intervalMs=30000]
 * @param {number} [opts.digestTriggerCount=10]
 * @param {number} [opts.digestIntervalMs=1800000]
 * @returns {{ stop: () => void }}
 */
function startPoller(opts = {}) {
  const intervalMs = opts.intervalMs || 30 * 1000;
  const digestTriggerCount = opts.digestTriggerCount || 10;
  const digestIntervalMs = opts.digestIntervalMs || 30 * 60 * 1000;

  if (!schema) {
    console.error('[sync-poller] schema 미로드 — 폴러 시작 스킵');
    return { stop() {} };
  }

  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const projects = schema.loadProjects();
      if (projects.length === 0) return;
      for (const proj of projects) {
        if (stopped) break;
        try {
          await processProject(proj, { digestTriggerCount, digestIntervalMs });
        } catch (err) {
          console.error(`[sync-poller] ${proj.slug} 처리 중 예외:`, err.message);
        }
      }
    } catch (err) {
      console.error('[sync-poller] tick 예외:', err.message);
    } finally {
      running = false;
    }
  };

  console.log(
    `[sync-poller] 시작 (interval=${intervalMs}ms, ` +
    `trigger=${digestTriggerCount}건, digestInterval=${digestIntervalMs}ms)`
  );

  const handle = setInterval(tick, intervalMs);
  // 첫 tick은 약간 지연 (봇 부팅 완료 후)
  setTimeout(tick, 5000);

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}

module.exports = {
  startPoller,
  // 테스트용 노출
  _processProject: processProject,
};
