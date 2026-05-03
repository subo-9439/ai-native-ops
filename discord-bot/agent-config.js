// PR-OOP2 — 봇 채널/역할 SSOT
//
// 이전 상태: 같은 역할 키('ceo', 'backend-dev', ...) 가 4개 자료구조에 분산
//   - AGENT_CONTEXTS (commands/claude.js)  — 시스템 프롬프트
//   - CHANNEL_LABELS (commands/claude.js)  — 표시 라벨 (이모지 + 한글)
//   - CHANNEL_COLORS (commands/claude.js)  — Embed 색상
//   - toSyncAgent()  (commands/claude.js)  — claude-sync events 키 매핑
// 새 역할 추가 시 4곳 모두 수정 필요 → 빠뜨리기 쉬움.
//
// 이 파일은 메타(label/color/syncAgent) 의 단일 출처다.
// 시스템 프롬프트(context) 는 분량이 커서 commands/claude.js 의 AGENT_CONTEXTS
// 에 그대로 둠 — 다음 PR 에서 prompts/ 디렉토리로 이관 가능.

const AGENT_CONFIG = {
  'dev':          { label: '⚡ 개발',           color: 0xFEE75C, syncAgent: 'dev' },
  'backend-dev':  { label: '🔧 BE (디스패치)',  color: 0x5865F2, syncAgent: 'be'  },
  'frontend-dev': { label: '🎨 FE (디스패치)',  color: 0x57F287, syncAgent: 'fe'  },
  'ai-dev':       { label: '🤖 AI (디스패치)',  color: 0xEB459E, syncAgent: 'ai'  },
  'ceo':          { label: '👔 CEO 기획실',     color: 0xFFD700, syncAgent: 'ceo' },
  '잡담':         { label: '💬 잡담',           color: 0xED4245, syncAgent: 'dev' },
};

const DEFAULT_ROLE = 'dev';
const DEFAULT_COLOR = 0x99AAB5;

function getLabel(role) {
  return AGENT_CONFIG[role]?.label ?? role;
}

function getColor(role) {
  return AGENT_CONFIG[role]?.color ?? DEFAULT_COLOR;
}

function getSyncAgent(role) {
  return AGENT_CONFIG[role]?.syncAgent ?? DEFAULT_ROLE;
}

/**
 * 하위 호환을 위한 derived 자료구조.
 * 기존 임포트(`{ CHANNEL_LABELS, CHANNEL_COLORS }`) 가 그대로 동작.
 * 새 코드는 가급적 getLabel/getColor 함수를 사용.
 */
const CHANNEL_LABELS = Object.fromEntries(
  Object.entries(AGENT_CONFIG).map(([k, v]) => [k, v.label]),
);

const CHANNEL_COLORS = Object.fromEntries(
  Object.entries(AGENT_CONFIG).map(([k, v]) => [k, v.color]),
);

module.exports = {
  AGENT_CONFIG,
  DEFAULT_ROLE,
  DEFAULT_COLOR,
  getLabel,
  getColor,
  getSyncAgent,
  // 하위 호환 export
  CHANNEL_LABELS,
  CHANNEL_COLORS,
};
