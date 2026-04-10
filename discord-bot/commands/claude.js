const { spawn } = require('child_process');
const { EmbedBuilder } = require('discord.js');

const MAX_LEN = 1900;
const STREAM_INTERVAL_MS = 4000;

/**
 * 에이전트 역할별 context prefix
 */
const AGENT_CONTEXTS = {
  'backend-dev': `[역할: 백엔드 에이전트]
전문 영역: Spring Boot 게임 서버
작업 경로: game_project_server/
기술 스택: Spring Boot 3, Redis, RabbitMQ, MariaDB, WebSocket/STOMP, Docker
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리 (특히 CURRENT_SPRINT.md, BUSINESS_LOGIC_AND_TABLES.md)
원칙: 기존 API 호환성 유지, 작은 단위 커밋, 테스트 코드 없으면 추가하지 않음

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,

  'frontend-dev': `[역할: 프론트엔드 에이전트]
전문 영역: Flutter Web/App
작업 경로: game_project_app/, game_project_web/
기술 스택: Flutter, Dart, flutter_riverpod, dio, stomp_dart_client
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리 (특히 CURRENT_SPRINT.md, SCREEN_API_MAPPING.md)
원칙: Web이 SSOT, Mobile은 WebView Host 우선, 작은 단위 커밋

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,

  'ai-dev': `[역할: AI 서버 에이전트]
전문 영역: AI 서버 (Spring Boot + Gemini API)
작업 경로: game_project_ai/
기술 스택: Spring Boot 3, Gemini REST API
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,

  '잡담': `[역할: 풀스택/AI 에이전트]
전체 프로젝트에 대한 작업을 수행합니다.
AI 서버 작업 시: 작업 경로 game_project_ai/ (Spring Boot + Gemini API)
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,

  '기획-백로그': `[역할: 풀스택/AI 에이전트]
기획 및 백로그 관련 작업을 수행합니다.
전체 프로젝트에 대한 분석, 설계, 우선순위 결정을 지원합니다.
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리 (CURRENT_SPRINT.md, BUSINESS_LOGIC_AND_TABLES.md)

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,

  'claude-dev': `[역할: 풀스택/AI 에이전트]
전체 프로젝트에 대한 작업을 수행합니다.
AI 서버 작업 시: 작업 경로 game_project_ai/ (Spring Boot + Gemini API)
브랜치: claude/dev
SSOT 참고: docs/ 디렉터리

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- 분석 후 "수정할까요?"라고 묻지 말고 바로 코드를 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`,
};

/** 에이전트별 표시 라벨 */
const CHANNEL_LABELS = {
  'backend-dev':  '🔧 BE (Spring Boot)',
  'frontend-dev': '🎨 FE (Flutter)',
  'ai-dev':       '🤖 AI (Gemini)',
  'claude-dev':   '⚡ 풀스택',
  '잡담':         '💬 잡담',
  '기획-백로그':  '📋 기획/백로그',
};

/** 에이전트별 Embed 색상 */
const CHANNEL_COLORS = {
  'backend-dev':  0x5865F2,  // 파랑
  'frontend-dev': 0x57F287,  // 초록
  'ai-dev':       0xEB459E,  // 보라/핑크
  'claude-dev':   0xFEE75C,  // 노랑
  '잡담':         0xED4245,  // 빨강
  '기획-백로그':  0xF47FFF,  // 라벤더
};

/**
 * 기획실 지시문을 섹션별로 파싱
 * ---BE---, ---FE---, ---AI---, ---ALL--- 구분자 지원
 *
 * 반환 예시:
 *   { all: null, be: '서버 API 추가', fe: '버튼 UI 추가', ai: null }
 *
 * 구분자 없으면: { all: '전체 지시문', be: null, fe: null, ai: null }
 */
function parseDispatchSections(content) {
  const result = { all: null, be: null, fe: null, ai: null };

  // ---TAG--- 패턴으로 분리
  const sectionRegex = /---\s*(ALL|BE|FE|AI)\s*---/gi;
  const parts = content.split(sectionRegex);

  if (parts.length === 1) {
    // 구분자 없음 → 전체를 all로
    result.all = content.trim();
    return result;
  }

  // parts = [before, TAG1, body1, TAG2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i].toUpperCase();
    const body = (parts[i + 1] || '').trim();
    if (!body) continue;
    if (tag === 'ALL') result.all = body;
    if (tag === 'BE')  result.be  = body;
    if (tag === 'FE')  result.fe  = body;
    if (tag === 'AI')  result.ai  = body;
  }

  return result;
}

/**
 * 파싱된 섹션에서 실행할 에이전트 목록 결정
 * 반환: [{ channelName, prompt }]
 */
function resolveTargets(sections) {
  const targets = [];

  if (sections.be) targets.push({ channelName: 'backend-dev',  prompt: sections.be });
  if (sections.fe) targets.push({ channelName: 'frontend-dev', prompt: sections.fe });
  if (sections.ai) targets.push({ channelName: 'ai-dev',       prompt: sections.ai });

  if (targets.length > 0) return targets;

  // 명시적 섹션 없음 → all 기반 자동 감지
  if (sections.all) {
    const channelName = resolveAgentFromContent(sections.all);
    targets.push({ channelName, prompt: sections.all });
  }

  return targets;
}

/**
 * 결과 Embed 빌드
 */
function buildResultEmbed(channelName, label, buffer, timedOut) {
  const hasError = buffer.includes('Error') || buffer.includes('[err]');
  const status = timedOut ? '⏰ 타임아웃' : (hasError ? '⚠️ 완료(오류 포함)' : '✅ 완료');
  const preview = (buffer.slice(-1400) || '(출력 없음)').replace(/`/g, "'");

  return new EmbedBuilder()
    .setTitle(`${label} — ${status}`)
    .setDescription(`\`\`\`\n${preview}\n\`\`\``)
    .setColor(CHANNEL_COLORS[channelName] || 0x99AAB5)
    .setTimestamp();
}

/**
 * Claude subprocess → 스레드에 직접 결과 포스팅
 * 기획실 병렬 dispatch에서 사용
 * @returns Promise<{ channelName, label, buffer, timedOut }>
 */
async function runClaudeToThread(thread, userMessage, channelName) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) throw new Error('CLAUDE_PROJECT_DIR 환경변수 없음');

  const contextPrefix = AGENT_CONTEXTS[channelName] || AGENT_CONTEXTS['claude-dev'];
  const fullMessage = contextPrefix + userMessage;
  const label = CHANNEL_LABELS[channelName] || channelName;

  const statusMsg = await thread.send(`⏳ **${label}** 작업 시작...`);
  let buffer = '';
  let lastUpdate = Date.now();

  const flushStatus = async () => {
    const preview = buffer.slice(-1200).replace(/`/g, "'");
    try {
      await statusMsg.edit(`⏳ **${label}** 진행 중...\n\`\`\`\n${preview}\n\`\`\``);
    } catch (_) {}
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      ['--print', '--dangerously-skip-permissions'],
      { cwd: projectDir, env: process.env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    proc.stdin.write(fullMessage);
    proc.stdin.end();

    proc.stdout.on('data', async (data) => {
      buffer += data.toString();
      if (Date.now() - lastUpdate > STREAM_INTERVAL_MS) {
        lastUpdate = Date.now();
        await flushStatus();
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('no stdin data received')) buffer += `[err] ${msg}`;
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ channelName, label, buffer, timedOut: true });
    }, 30 * 60 * 1000);

    proc.on('close', () => {
      clearTimeout(timeout);
      // 진행 중 메시지 삭제 (결과 embed로 대체)
      statusMsg.delete().catch(() => {});
      resolve({ channelName, label, buffer, timedOut: false });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Claude subprocess 실행 + Discord 실시간 스트리밍
 * 기존 채널 직접 메시지용 (에이전트 채널 messageCreate)
 */
async function runClaude(interaction, userMessage, opts = {}) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    await interaction.editReply('`CLAUDE_PROJECT_DIR` 환경변수가 없습니다.');
    return;
  }

  const contextPrefix = AGENT_CONTEXTS[opts.channelName] || AGENT_CONTEXTS['claude-dev'];
  const fullMessage = contextPrefix + userMessage;

  const title = opts.taskTitle ? `**[${opts.taskTitle}]**\n` : '';
  const roleLabel = opts.channelName ? ` (${opts.channelName})` : '';
  await interaction.editReply(
    `${title}⏳ Claude 에이전트${roleLabel} 실행 중...\n\`\`\`\n${userMessage.substring(0, 120)}${userMessage.length > 120 ? '...' : ''}\n\`\`\``
  );

  let buffer = '';
  let lastUpdate = Date.now();

  const flush = async (final = false) => {
    if (!buffer.trim() && !final) return;
    const status = final ? (buffer.includes('Error') ? '⚠️ 완료(오류 포함)' : '✅ 완료') : '⏳ 진행 중...';
    const preview = buffer.slice(-MAX_LEN + 80);
    const content = `${title}${status}${roleLabel}\n\`\`\`\n${preview}\n\`\`\``;
    try {
      await interaction.editReply(content);
    } catch (_) {}
  };

  const proc = spawn(
    'claude',
    ['--print', '--dangerously-skip-permissions'],
    { cwd: projectDir, env: process.env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  proc.stdin.write(fullMessage);
  proc.stdin.end();

  proc.stdout.on('data', async (data) => {
    buffer += data.toString();
    if (Date.now() - lastUpdate > STREAM_INTERVAL_MS || buffer.length > 3000) {
      lastUpdate = Date.now();
      await flush(false);
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('no stdin data received')) return;
    buffer += `[err] ${msg}`;
  });

  const timeout = setTimeout(() => {
    proc.kill();
    interaction.followUp('⏰ 타임아웃 (30분)');
  }, 30 * 60 * 1000);

  proc.on('close', async () => {
    clearTimeout(timeout);
    await flush(true);
  });

  proc.on('error', async (err) => {
    clearTimeout(timeout);
    await interaction.editReply(`❌ \`claude\` CLI 실행 실패: ${err.message}\nclaude CLI가 PATH에 설치되어 있어야 합니다.`);
  });
}

/**
 * 메시지 내용 기반 에이전트 자동 라우팅
 */
function resolveAgentFromContent(userMessage, override) {
  if (override) return override;

  const msg = (userMessage || '').toLowerCase();

  const BE_KEYWORDS = [
    'spring', 'springboot', 'spring boot',
    '백엔드', 'backend', 'be ',
    '서버', 'server', 'api ', '/api',
    'game_project_server',
    'java', 'kotlin',
    'redis', 'rabbitmq', 'mariadb', 'mysql',
    'websocket', 'stomp', 'rest',
    '컨트롤러', 'controller',
    '서비스 레이어', 'service layer',
    '레포지토리', 'repository',
    'jpa', 'entity', '엔티티', 'dto',
    'docker', 'gradle', 'maven',
    '로비', 'lobby', '방 생성', '방생성', '게임서버',
    '데이터베이스', 'database', 'db ',
    '배포', 'deploy', 'endpoint', '엔드포인트',
  ];

  const FE_KEYWORDS = [
    'flutter', 'dart',
    '프론트', 'frontend', 'fe ',
    '화면', 'screen', '페이지', 'page',
    'ui ', 'ux ',
    '앱', ' app', '위젯', 'widget',
    'game_project_app', 'game_project_web',
    'riverpod', 'provider',
    '버튼', 'button',
    '레이아웃', 'layout',
    '애니메이션', 'animation',
    '스타일', 'style', '색상', 'color', '폰트', 'font',
    '뷰', 'view', '탭', 'tab',
    '로딩', 'loading', '스피너', 'spinner',
    '다이얼로그', 'dialog', '모달', 'modal',
    '스크롤', 'scroll', '리스트', 'listview',
  ];

  const beScore = BE_KEYWORDS.filter(kw => msg.includes(kw)).length;
  const feScore = FE_KEYWORDS.filter(kw => msg.includes(kw)).length;

  if (beScore > feScore && beScore > 0) return 'backend-dev';
  if (feScore > beScore && feScore > 0) return 'frontend-dev';
  return 'claude-dev';
}

function resolveChannelName(interaction, override) {
  if (override) return override;
  const ch = interaction.channel?.name || '';
  if (AGENT_CONTEXTS[ch]) return ch;
  return 'claude-dev';
}

const SKILLS = {
  review: (target) => `현재 변경된 파일(git diff HEAD)을 코드 리뷰해줘.${target ? ` 대상: ${target}` : ''}\n- 버그 가능성, 성능 이슈, 코드 스타일 순으로 정리\n- 심각도(High/Med/Low)를 붙여서 3줄 이내로 요약\n- 수정 제안은 diff 형태로`,
  sprint:  ()       => `docs/CURRENT_SPRINT.md 와 docs/DECISIONS.md 를 읽고:\n1. 현재 스프린트 진행 상태 요약\n2. 완료된 항목 / 남은 항목\n3. 다음 우선순위 3가지 제안`,
  pr:      (title)  => `현재 claude/dev 브랜치의 변경사항으로 main 대상 PR을 생성해줘.\n제목: ${title || '(변경 내용 기반으로 자동 생성)'}\n- PR 본문: 변경 이유, 주요 변경점, 테스트 방법 포함`,
  test:    (file)   => `${file ? `${file} 파일` : '최근 변경된 파일'}에 대한 유닛 테스트를 작성해줘.\n- 기존 테스트 스타일/프레임워크 따르기\n- 정상 케이스 + 엣지 케이스 포함`,
  explain: (file)   => `${file ? `${file}` : '현재 작업 중인 핵심 파일'}을 읽고 설명해줘.\n- 목적, 주요 로직, 의존성을 한글로\n- 처음 보는 사람도 이해할 수 있는 수준`,
};

module.exports = {
  runClaude,
  runClaudeToThread,
  parseDispatchSections,
  resolveTargets,
  buildResultEmbed,
  CHANNEL_LABELS,
  SKILLS,
  resolveChannelName,
  resolveAgentFromContent,

  async execute(interaction) {
    const message = interaction.options.getString('message');
    await interaction.deferReply();
    const channelName = resolveAgentFromContent(message);
    await runClaude(interaction, message, { channelName });
  },

  async executeBackend(interaction) {
    const message = interaction.options.getString('message');
    await interaction.deferReply();
    await runClaude(interaction, message, { channelName: 'backend-dev' });
  },

  async executeFrontend(interaction) {
    const message = interaction.options.getString('message');
    await interaction.deferReply();
    await runClaude(interaction, message, { channelName: 'frontend-dev' });
  },

  async executeSkill(interaction) {
    const skill  = interaction.options.getString('skill');
    const target = interaction.options.getString('target') || '';
    const skillFn = SKILLS[skill];
    if (!skillFn) {
      await interaction.reply({ content: `❌ 알 수 없는 스킬: ${skill}`, ephemeral: true });
      return;
    }
    const skillMessage = skillFn(target);
    await interaction.deferReply();
    const channelName = resolveAgentFromContent(target || skillMessage);
    await runClaude(interaction, skillMessage, { channelName });
  },
};
