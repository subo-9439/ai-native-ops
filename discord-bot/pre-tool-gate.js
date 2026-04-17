/**
 * pre-tool-gate.js — Discord 봇 PreExecute 게이트
 * Claude Code의 pre_tool_gate.py 정책을 JavaScript로 구현
 *
 * 민감 경로 접근과 파괴 명령을 차단한다.
 *
 * 실패 코드:
 *   HG001: sensitive path denied
 *   HG002: dangerous command denied
 */

// ── 민감 경로 패턴 ──────────────────────────────────────────
const SENSITIVE_PATTERNS = [
  /\.env($|\.)/i,
  /secrets[/\\]/i,
  /credentials?[/\\]/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /token\.json/i,
  /service\.account\.json/i,
  /application-local\.yml$/i,
];

// ── 파괴 명령 패턴 ──────────────────────────────────────────
const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w*r\w*f|--force).*\b/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[dfx]+\b/i,
  /\bgit\s+checkout\s+--\s+\./i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bdel\s+\/[fFqQsS]/i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bsudo\s+rm\b/i,
];

/**
 * 경로가 민감한 패턴과 일치하는지 확인
 * @param {string} path
 * @returns {boolean}
 */
function checkSensitivePath(path) {
  if (!path) return false;
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
};
