/**
 * pre-tool-gate.js — Discord 봇 PreExecute 게이트
 *
 * 정책 SSOT: whosbuying/.agent/harness/policies/sensitive-paths.yaml
 * Python(pre_tool_gate.py) 과 동일 yaml 을 로드하여 패턴 fork 를 방지한다.
 *
 * 실패 코드:
 *   HG001: sensitive path denied
 *   HG002: dangerous command denied
 *
 * yaml 로드 실패 시 fail-open(degraded) — 인라인 fallback 패턴 사용.
 * 운영 차단보다 운영 가능성 우선 (CLAUDE.md 6조).
 */

const fs = require('fs');
const path = require('path');

// ── SSOT 로더 (의존성 없는 minimal yaml list 파서) ────────────
const POLICY_PATH = path.resolve(
  __dirname,
  '../../whosbuying/.agent/harness/policies/sensitive-paths.yaml'
);

function _extractYamlList(text, section) {
  // 라인 단위 파싱: section 헤더(`<section>:`)부터 다음 top-level key(또는 EOF)까지의
  // '- ...' 라인을 수집. 들여쓰기 있는 '- '만 항목으로 인정.
  const lines = text.split('\n');
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    if (raw.match(new RegExp(`^${section}:\\s*$`))) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // 다음 top-level key (들여쓰기 없는 'key:') 만나면 종료
    if (/^[a-zA-Z_][a-zA-Z0-9_]*:\s*/.test(raw)) break;
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (!t.startsWith('- ') && t !== '-') continue;
    let val = t.slice(1).trim();
    // PR-GATE-EXCEPTIONS-JS — inline comment 처리 (quote 안의 # 는 보존)
    const m = val.match(/^(['"])(.*?)\1\s*(#.*)?$/);
    if (m) {
      val = m[2];
    } else {
      // 무 quote: # 이전까지만
      const hashIdx = val.indexOf('#');
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    if (val) out.push(val);
  }
  return out.length ? out : null;
}

/**
 * PR-GATE-EXCEPTIONS-JS — nested yaml list 파서
 * 'parent:' 안의 'child:' 의 - 항목 수집.
 * 예: exceptions.sensitive_paths
 */
function _extractNestedYamlList(text, parent, child) {
  const lines = text.split('\n');
  const subLines = [];
  let inParent = false;
  for (const raw of lines) {
    if (raw.match(new RegExp(`^${parent}:\\s*$`))) {
      inParent = true;
      continue;
    }
    if (!inParent) continue;
    // 다음 top-level key 만나면 종료
    if (/^[a-zA-Z_][a-zA-Z0-9_]*:\s*$/.test(raw)) break;
    subLines.push(raw);
  }
  if (!subLines.length) return [];

  const out = [];
  let inChild = false;
  for (const raw of subLines) {
    // child key (들여쓰기 있는 'child:') 매칭
    if (raw.match(new RegExp(`^\\s+${child}:\\s*$`))) {
      inChild = true;
      continue;
    }
    if (!inChild) continue;
    // 같은/다른 nested key 만나면 종료
    if (
      /^\s+[a-zA-Z_][a-zA-Z0-9_]*:\s*$/.test(raw) &&
      !raw.match(new RegExp(`^\\s+${child}:`))
    ) {
      break;
    }
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (!t.startsWith('- ') && t !== '-') continue;
    let val = t.slice(1).trim();
    // PR-GATE-EXCEPTIONS-JS — inline comment 처리 (quote 안의 # 는 보존)
    const m = val.match(/^(['"])(.*?)\1\s*(#.*)?$/);
    if (m) {
      val = m[2];
    } else {
      // 무 quote: # 이전까지만
      const hashIdx = val.indexOf('#');
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    if (val) out.push(val);
  }
  return out;
}

function _loadPolicy() {
  const fallback = {
    sensitive: [
      /\.env($|\.)/i,
      /secrets[/\\]/i,
      /credentials?[/\\]/i,
      /\.pem$/i,
      /\.key$/i,
      /id_rsa/i,
      /id_ed25519/i,
    ],
    dangerous: [
      /\brm\s+-rf\b/i,
      /\bgit\s+reset\s+--hard\b/i,
      /\bgit\s+push\s+.*--force\b/i,
      /\bsudo\s+rm\b/i,
    ],
    exceptions: [], // PR-GATE-EXCEPTIONS-JS — fallback 시 빈 리스트 (기존 동작)
  };
  try {
    const text = fs.readFileSync(POLICY_PATH, 'utf8');
    const sensitive = _extractYamlList(text, 'sensitive_paths');
    const dangerous = _extractYamlList(text, 'dangerous_commands');
    // PR-GATE-EXCEPTIONS-JS — exceptions.sensitive_paths nested 추출
    const exceptions = _extractNestedYamlList(text, 'exceptions', 'sensitive_paths');
    if (!sensitive || !dangerous) throw new Error('empty policy lists');
    return {
      sensitive: sensitive.map((p) => new RegExp(p, 'i')),
      dangerous: dangerous.map((p) => new RegExp(p, 'i')),
      exceptions: exceptions.map((p) => new RegExp(p, 'i')),
    };
  } catch (exc) {
    process.stderr.write(
      `[pre-tool-gate] policy load failed (${exc.message}); using fallback patterns\n`
    );
    return fallback;
  }
}

const _policy = _loadPolicy();
const SENSITIVE_PATTERNS = _policy.sensitive;
const DANGEROUS_PATTERNS = _policy.dangerous;
const EXCEPTION_PATTERNS = _policy.exceptions;

/**
 * PR-GATE-EXCEPTIONS-JS — false-positive 차단
 * @param {string} path
 * @returns {boolean}
 */
function _isException(path) {
  if (!path) return false;
  for (const pat of EXCEPTION_PATTERNS) {
    if (pat.test(path)) return true;
  }
  return false;
}

/**
 * 경로가 민감한 패턴과 일치하는지 확인
 * @param {string} path
 * @returns {boolean}
 */
function checkSensitivePath(path) {
  if (!path) return false;
  // PR-GATE-EXCEPTIONS-JS — exceptions 우선 검증
  if (_isException(path)) return false;
  for (const pat of SENSITIVE_PATTERNS) {
    if (pat.test(path)) return true;
  }
  return false;
}

/**
 * 명령이 파괴 패턴과 일치하는지 확인
 * @param {string} cmd
 * @returns {boolean}
 */
function checkDangerousCommand(cmd) {
  if (!cmd) return false;
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(cmd)) return true;
  }
  return false;
}

/**
 * 텍스트에서 경로로 보이는 부분 추출
 * @param {string} text
 * @returns {string[]}
 */
function extractPaths(text) {
  const paths = [];
  if (!text) return paths;

  // 파일 경로 패턴 추출 (예: /path/to/file, C:\path\to\file)
  const pathPatterns = [
    /[a-zA-Z]:[\w./\\-]+/g,           // Windows: C:\...
    /\/[a-zA-Z0-9._/\-]*/g,            // Unix: /path/to/...
    /\w+[\w./\-]*\.\w+/g,              // files: name.ext
  ];

  for (const pat of pathPatterns) {
    const matches = text.match(pat) || [];
    paths.push(...matches);
  }

  return paths;
}

/**
 * 사용자 메시지 검증
 * @param {string} userMessage
 * @returns {Object} { decision: 'allow'|'deny', reason: string }
 */
function validateUserMessage(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { decision: 'allow', reason: 'empty message' };
  }

  // ── 민감 경로 검사 ──
  const paths = extractPaths(userMessage);
  for (const p of paths) {
    if (checkSensitivePath(p)) {
      return {
        decision: 'deny',
        reason: `HG001: sensitive path denied — ${p}`,
      };
    }
  }

  // ── 파괴 명령 검사 ──
  if (checkDangerousCommand(userMessage)) {
    return {
      decision: 'deny',
      reason: `HG002: dangerous command denied — ${userMessage.substring(0, 120)}`,
    };
  }

  // ── 통과 ──
  return { decision: 'allow', reason: 'passed all gates' };
}

module.exports = {
  validateUserMessage,
  checkSensitivePath,
  checkDangerousCommand,
  // 패턴 노출(검증/diff 용도)
  SENSITIVE_PATTERNS,
  DANGEROUS_PATTERNS,
};
