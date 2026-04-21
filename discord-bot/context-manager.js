/**
 * 컨텍스트 매니저 (Cline memory-bank 패턴 기반)
 *
 * 주입 계층:
 *   L0 — CLAUDE.md: Claude CLI가 cwd에서 자동 로드 (정적)
 *   L1 — Memory-Bank: docs/memory-bank/ 4파일 (공용 상태, CEO+Dev)
 *   L2 — Ops Log: .ops/context.jsonl 최근 N건 (단기 RAM)
 *   L3 — Thread Context: 스레드 내 이전 대화 (세션 연속성)
 */

const fs = require('fs');
const path = require('path');

const MAX_THREAD_MESSAGES = 15;
const MAX_THREAD_CONTEXT_CHARS = 6000; // 스레드 히스토리 전체 상한 (~1.5K 토큰)
const MAX_CONTEXT_ENTRIES = 10;
const MAX_SUMMARY_LENGTH = 500;
const MAX_MEMORY_FILE_BYTES = 3000;   // memory-bank 각 파일 최대 3KB
const CONTEXT_FILE = '.ops/context.jsonl';
const MEMORY_BANK_DIR = 'docs/memory-bank';
const MEMORY_BANK_FILES = ['activeContext.md', 'progress.md', 'decisions.md', 'systemPatterns.md'];

// ─── L1: Thread Context ──────────────────────────────────

/**
 * 스레드의 이전 메시지를 수집하여 대화 히스토리 문자열 생성
 * @param {import('discord.js').ThreadChannel} thread
 * @returns {Promise<string>} 대화 히스토리 (빈 문자열이면 히스토리 없음)
 */
async function collectThreadContext(thread) {
  try {
    const messages = await thread.messages.fetch({ limit: MAX_THREAD_MESSAGES });
    const sorted = [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    if (sorted.length === 0) return '';

    const lines = [];
    for (const msg of sorted) {
      const author = msg.author.bot ? 'Claude' : msg.author.displayName;
      // embed만 있고 텍스트 없는 메시지
      if (!msg.content && msg.embeds?.length > 0) {
        lines.push(`${author}: [작업 결과 embed]`);
        continue;
      }
      const content = msg.content?.substring(0, 800);
      if (!content) continue;
      lines.push(`${author}: ${content}`);
    }

    if (lines.length === 0) return '';

    // 토큰 예산 초과 시 오래된 메시지부터 제거하고 요약 표시
    let joined = lines.join('\n');
    if (joined.length > MAX_THREAD_CONTEXT_CHARS) {
      const totalMessages = lines.length;
      // 최근 메시지를 우선 유지 — 뒤에서부터 예산 내로 채운다
      const kept = [];
      let budget = MAX_THREAD_CONTEXT_CHARS - 80; // 말줄임 표시 여유
      for (let i = lines.length - 1; i >= 0; i--) {
        if (budget - lines[i].length - 1 < 0) break;
        budget -= lines[i].length + 1;
        kept.unshift(lines[i]);
      }
      const skipped = totalMessages - kept.length;
      joined = `(이전 메시지 ${skipped}건 생략)\n${kept.join('\n')}`;
    }

    return `\n[이전 대화 히스토리 — 이 스레드에서 진행된 작업 맥락]\n${joined}\n[히스토리 끝]\n\n`;
  } catch (err) {
    console.error('[Context] 스레드 히스토리 수집 실패:', err.message);
    return '';
  }
}

// ─── L2: Ops Context Log ─────────────────────────────────

/**
 * 에이전트 실행 결과를 공유 로그에 기록
 * @param {string} projectDir  CLAUDE_PROJECT_DIR
 * @param {object} entry       { agent, task, summary, files?, timestamp? }
 */
function writeOpsLog(projectDir, entry) {
  if (!projectDir) return;
  const logPath = path.join(projectDir, CONTEXT_FILE);
  const dir = path.dirname(logPath);

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const record = {
      timestamp: new Date().toISOString(),
      agent: entry.agent || 'unknown',
      task: (entry.task || '').substring(0, 200),
      summary: (entry.summary || '').substring(0, MAX_SUMMARY_LENGTH),
      files: entry.files || [],
    };

    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (err) {
    console.error('[Context] ops log 기록 실패:', err.message);
  }
}

function formatKstMMDDHHmm(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  return s.substring(5, 16);
}

/**
 * 최근 ops log 항목을 읽어서 컨텍스트 문자열 생성
 * @param {string} projectDir
 * @returns {string}
 */
function readOpsContext(projectDir) {
  if (!projectDir) return '';
  const logPath = path.join(projectDir, CONTEXT_FILE);

  try {
    if (!fs.existsSync(logPath)) return '';

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    const recent = lines.slice(-MAX_CONTEXT_ENTRIES);

    if (recent.length === 0) return '';

    const entries = recent
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);

    if (entries.length === 0) return '';

    const formatted = entries.map(e => {
      const time = formatKstMMDDHHmm(e.timestamp);
      const files = e.files?.length ? ` [${e.files.join(', ')}]` : '';
      return `  [${time}] ${e.agent}: ${e.task}${files}\n    → ${e.summary}`;
    }).join('\n');

    return `\n[최근 작업 기록 — 다른 에이전트 포함 최근 ${entries.length}건]\n${formatted}\n[기록 끝]\n\n`;
  } catch (err) {
    console.error('[Context] ops log 읽기 실패:', err.message);
    return '';
  }
}

/**
 * Claude 실행 결과에서 요약 추출 (마지막 몇 줄)
 * @param {string} buffer  Claude 전체 출력
 * @returns {string} 요약
 */
function extractSummary(buffer) {
  if (!buffer) return '(출력 없음)';
  const lines = buffer.trim().split('\n').filter(l => l.trim());
  // 마지막 5줄 또는 전체 (짧으면)
  const tail = lines.slice(-5).join('\n');
  return tail.substring(0, MAX_SUMMARY_LENGTH);
}

/**
 * Claude 출력에서 변경된 파일 목록 추출
 * @param {string} buffer
 * @returns {string[]}
 */
function extractChangedFiles(buffer) {
  if (!buffer) return [];
  const files = new Set();
  // 일반적인 Claude 출력 패턴: "Edit file.js", "Write file.js", "Created file.js"
  const patterns = [
    /(?:Edit|Write|Created?|Modified|Updated)\s+[`"]?([^\s`"]+\.\w+)/gi,
    /파일[:\s]+[`"]?([^\s`"]+\.\w+)/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(buffer)) !== null) {
      files.add(m[1]);
    }
  }
  return [...files].slice(0, 10);
}

// ─── L1: Memory-Bank (Cline 패턴) ────────────────────────

/**
 * docs/memory-bank/ 의 4개 파일을 읽어서 컨텍스트 문자열 생성
 * 각 파일 3KB 상한, 초과 시 뒷부분 truncate
 * @param {string} projectDir
 * @returns {string}
 */
function readMemoryBank(projectDir) {
  if (!projectDir) return '';
  const bankDir = path.join(projectDir, MEMORY_BANK_DIR);
  if (!fs.existsSync(bankDir)) return '';

  const parts = [];
  for (const fname of MEMORY_BANK_FILES) {
    const fpath = path.join(bankDir, fname);
    if (!fs.existsSync(fpath)) continue;
    try {
      let content = fs.readFileSync(fpath, 'utf-8');
      if (content.length > MAX_MEMORY_FILE_BYTES) {
        content = content.substring(0, MAX_MEMORY_FILE_BYTES) + '\n...(truncated)';
      }
      parts.push(`=== ${fname} ===\n${content.trim()}`);
    } catch (err) {
      console.error(`[Context] memory-bank ${fname} 읽기 실패:`, err.message);
    }
  }

  if (parts.length === 0) return '';

  return `\n[Memory-Bank — 공용 프로젝트 상태 (CEO + Dev 공유)]\n${parts.join('\n\n')}\n[Memory-Bank 끝]\n\n`;
}

// ─── 풀 컨텍스트 조립 ────────────────────────────────────

/**
 * 에이전트 실행 전 컨텍스트 조립
 *
 * 주입 순서:
 *   [역할 prefix] + [memory-bank 4파일] + [ops log 최근 10건] + [스레드 히스토리] + [사용자 지시]
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {import('discord.js').ThreadChannel} [opts.thread]  스레드 (있으면 히스토리 수집)
 * @param {string} opts.agentContext  에이전트 역할 prefix
 * @param {string} opts.userMessage   사용자 메시지
 * @returns {Promise<string>} Claude에 보낼 전체 프롬프트
 */
async function buildFullPrompt({ projectDir, thread, agentContext, userMessage }) {
  const memoryBank = readMemoryBank(projectDir);
  const opsContext = readOpsContext(projectDir);
  const threadContext = thread ? await collectThreadContext(thread) : '';

  return agentContext + memoryBank + opsContext + threadContext + '[사용자 지시]\n' + userMessage;
}

module.exports = {
  collectThreadContext,
  writeOpsLog,
  readOpsContext,
  readMemoryBank,
  extractSummary,
  extractChangedFiles,
  buildFullPrompt,
};
