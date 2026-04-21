/**
 * sync-writer — Discord 봇이 이벤트를 claude-sync 공유 로그에 기록
 *
 * 핵심 헬퍼: recordDiscordEvent(kind, opts)
 *   - source='discord' 자동 설정
 *   - session_id는 봇 프로세스 시작 시 생성된 UUID 재사용
 *   - slug는 CLAUDE_PROJECT_DIR 기반으로 projects.json에서 조회
 *
 * projects.json이 없거나 slug 매칭 실패 시 → no-op (로그만 남김)
 */

'use strict';

const path = require('path');

// claude-sync 라이브러리는 ~/.claude-sync/lib 에 있다. 심볼릭 링크 없이 절대 경로로 require.
const SCHEMA_PATH = path.join(
  require('os').homedir(),
  '.claude-sync',
  'lib',
  'schema.js'
);

let schema = null;
try {
  schema = require(SCHEMA_PATH);
} catch (err) {
  console.error('[sync-writer] schema.js 로드 실패 (sync 비활성):', err.message);
}

// 봇 프로세스 시작 시 한 번 생성 — 봇이 재시작되면 새 session_id
const BOT_SESSION_ID = schema ? schema.newSessionId() : 'no-schema';

// slug는 프로세스 수명 내 고정 — CLAUDE_PROJECT_DIR이 안 바뀌므로 캐시
let _cachedSlug;
let _slugResolved = false;

function getSlug() {
  if (_slugResolved) return _cachedSlug;
  _slugResolved = true;

  if (!schema) {
    _cachedSlug = null;
    return null;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    console.error('[sync-writer] CLAUDE_PROJECT_DIR 없음 — sync 비활성');
    _cachedSlug = null;
    return null;
  }
  _cachedSlug = schema.resolveProjectSlug(projectDir);
  if (!_cachedSlug) {
    console.error(`[sync-writer] ${projectDir} 에 매칭되는 projects.json 엔트리 없음 — sync 비활성`);
  } else {
    console.log(`[sync-writer] slug=${_cachedSlug} session=${BOT_SESSION_ID.slice(0, 8)}`);
  }
  return _cachedSlug;
}

/**
 * Discord 이벤트 기록 헬퍼.
 * 모든 에러는 throw하지 않고 console.error로 소비.
 *
 * @param {'user_msg'|'assistant_reply'|'tool_call'|'file_write'|'decision'|'session_end'} kind
 * @param {Object} opts
 * @param {'ceo'|'dev'|'be'|'fe'|'ai'|'user'} [opts.agent='dev']
 * @param {string|null} [opts.threadId]
 * @param {string} [opts.summary]
 * @param {string[]} [opts.artifacts]
 * @param {{in?:number,out?:number}} [opts.tokens]
 * @param {string} [opts.sessionId] - override (예: 디스패치 하위 세션)
 */
function recordDiscordEvent(kind, opts = {}) {
  try {
    if (!schema) return;
    const slug = getSlug();
    if (!slug) return;

    schema.writeEvent(slug, {
      source: 'discord',
      agent: opts.agent || 'dev',
      session_id: opts.sessionId || BOT_SESSION_ID,
      thread_id: opts.threadId || null,
      kind,
      summary: opts.summary || '',
      artifacts: opts.artifacts || [],
      tokens: {
        in: opts.tokens?.in || 0,
        out: opts.tokens?.out || 0,
      },
    });
  } catch (err) {
    console.error('[sync-writer] recordDiscordEvent 실패:', err.message);
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
 * 최근 N건의 이벤트를 읽어서 사용자 프롬프트에 주입할 문자열 생성.
 * 기존 .ops/context.jsonl 주입 로직의 대체.
 * @param {number} [limit=20]
 * @returns {string} 빈 문자열이면 없음
 */
function readRecentContext(limit = 20) {
  try {
    if (!schema) return '';
    const slug = getSlug();
    if (!slug) return '';

    // 전체 파일 크기에서 뒤로 충분히 읽는 간단한 방식
    const { events } = schema.readEventsSince(slug, 0);
    if (!events.length) return '';

    const recent = events.slice(-limit);
    const lines = recent.map(e => {
      const t = formatKstMMDDHHmm(e.ts);
      const artifacts = e.artifacts?.length ? ` [${e.artifacts.slice(0, 3).join(', ')}]` : '';
      return `  [${t}] ${e.source}/${e.agent} ${e.kind}: ${e.summary}${artifacts}`;
    });

    return (
      `\n[claude-sync 최근 이벤트 — 터미널+Discord 공유, 최근 ${recent.length}건]\n` +
      lines.join('\n') +
      `\n[이벤트 끝]\n\n`
    );
  } catch (err) {
    console.error('[sync-writer] readRecentContext 실패:', err.message);
    return '';
  }
}

module.exports = {
  recordDiscordEvent,
  readRecentContext,
  BOT_SESSION_ID,
  getSlug,
};
