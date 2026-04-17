const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { buildFullPrompt, writeOpsLog, extractSummary, extractChangedFiles } = require('../context-manager');
const { appendChangelog } = require('../changelog-manager');
const { validateUserMessage } = require('../pre-tool-gate');

const MAX_LEN = 1900;
const STREAM_INTERVAL_MS = 4000;

// ─── 채널별 모델 설정 로더 ───────────────────────────────
const CHANNEL_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'channel-config.json');

/**
 * 채널/역할에 맞는 모델 반환. 파일을 매번 읽어서 재시작 없이 변경 반영.
 * 파일 없거나 파싱 실패 시 → null (Claude CLI 기본값 사용)
 */
function getModelForRole(role) {
  try {
    if (!fs.existsSync(CHANNEL_CONFIG_PATH)) return null;
    const cfg = JSON.parse(fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf-8'));
    const roleCfg = cfg.roles?.[role];
    return roleCfg?.model || cfg.defaults?.model || null;
  } catch (err) {
    console.error('[Model] channel-config 읽기 실패:', err.message);
    return null;
  }
}

/** Claude CLI args 배열 생성 (모델 플래그 포함) */
function buildClaudeArgs(role) {
  const args = ['--print', '--dangerously-skip-permissions'];
  const model = getModelForRole(role);
  if (model) args.push('--model', model);
  return args;
}

/**
 * 통합 개발 에이전트 컨텍스트 — 모든 dev 작업이 동일한 컨텍스트를 사용
 * 디스패치 섹션(BE/FE/AI)은 작업 영역만 명시하여 동일 컨텍스트에 추가
 */
const DEV_CONTEXT = `[역할: whosbuying 통합 개발 에이전트]
백엔드/프론트엔드/AI 서버 모두 다룰 수 있는 풀스택 에이전트.

[작업 영역]
- 게임 서버: game_project_server/ (Spring Boot 3, Java 21, MariaDB, Redis, RabbitMQ, WebSocket/STOMP)
- Flutter 앱: game_project_app/ (riverpod, dio, stomp_dart_client)
- Flutter 웹: game_project_web/ (앱 모듈 재사용)
- AI 서버: game_project_ai/ (Spring Boot + Gemini REST)

[원칙]
- Web = SSOT, Mobile은 WebView Host 우선
- 기존 API 호환성 유지, 작은 단위 커밋
- 브랜치: claude/dev
- 테스트가 없는 모듈에는 새로 추가하지 않음

[Memory-Bank 갱신 의무 — Cline 원칙 (필수)]
당신은 매 작업 전 docs/memory-bank/ 의 4개 파일을 반드시 읽는다. 이는 선택이 아니다.
- activeContext.md: 현재 포커스, 최근 변경, 다음 단계
- progress.md: 기능별 완료 상태, 알려진 이슈
- systemPatterns.md: 코드 패턴/관례
- decisions.md: CEO 합의된 결정사항

작업 완료 후 관련 파일을 즉시 업데이트한다:
- activeContext.md: 방금 한 작업을 "최근 변경"으로 이동, "다음 단계" 기록
- progress.md: 완료 항목 이동, 새 이슈 발견 시 추가
- systemPatterns.md: 새 재사용 패턴 발견 시에만 추가

파일 크기 ~3KB 초과 시 오래된 내용은 docs/CHANGELOG.md 로 이동한다.
메모리-뱅크 갱신은 코드 변경과 같은 커밋에 포함한다.

[문서 동기화 의무]
- API 변경 시 docs/API_REFERENCE.md 갱신
- 인프라 변경 시 docs/INFRASTRUCTURE.md 갱신
- 코드 변경과 문서 갱신은 같은 커밋에 포함

[SSOT 참고 문서]
- docs/PRD.md, docs/ARCHITECTURE.md
- docs/BUSINESS_LOGIC_AND_TABLES.md
- docs/API_REFERENCE.md, docs/SCREEN_API_MAPPING.md
- docs/INFRASTRUCTURE.md
- docs/CHANGELOG.md (최근 변경 확인용)

[실행 원칙]
- 확인 질문 없이 즉시 작업을 수행한다.
- "수정할까요?"라고 묻지 말고 바로 수정한다.
- 작업 완료 후 변경 내용을 요약한다.

[작업 지시]
`;

const AGENT_CONTEXTS = {
  'dev':          DEV_CONTEXT,
  '잡담':         DEV_CONTEXT,
  // 디스패치 섹션 — 컨텍스트는 동일, 작업 영역만 명시
  'backend-dev':  DEV_CONTEXT.replace('[작업 지시]', '[이번 작업 영역: 백엔드 game_project_server/]\n\n[작업 지시]'),
  'frontend-dev': DEV_CONTEXT.replace('[작업 지시]', '[이번 작업 영역: 프론트엔드 game_project_app/, game_project_web/]\n\n[작업 지시]'),
  'ai-dev':       DEV_CONTEXT.replace('[작업 지시]', '[이번 작업 영역: AI 서버 game_project_ai/]\n\n[작업 지시]'),

  'ceo': `[역할: CEO 기획 어드바이저]
당신은 whosbuying 게임 프로젝트의 기획/전략 어드바이저입니다.
CEO와 프로젝트 방향, 기능 기획, 우선순위를 논의합니다.

[Memory-Bank 기반 대화 — 필수]
매 응답 전 docs/memory-bank/ 의 4개 파일을 반드시 읽는다:
- activeContext.md: 현재 진행 중인 작업, 최근 변경, 다음 단계
- progress.md: 기능별 진행 상태, 알려진 이슈
- decisions.md: 이전에 합의된 결정사항
- systemPatterns.md: 반복되는 패턴/관례

이를 기반으로 이전 맥락과 일관되게 응답한다.

[Memory-Bank 갱신 의무]
- CEO와 새로운 결정을 합의하면 decisions.md 에 "## YYYY-MM-DD" 섹션으로 append
  형식: 결정 제목 + 핵심 요점 + "Reasoning: 이유"
- 디스패치 지시문 작성 시 activeContext.md 의 "다음 단계"를 갱신
- 새 계획 발견 시 progress.md 의 "🚧 진행 중" 에 추가

[프로젝트 참고 문서]
- docs/PRD.md, docs/ARCHITECTURE.md, docs/GAME_DESIGN.md
- docs/BUSINESS_LOGIC_AND_TABLES.md, docs/INFRASTRUCTURE.md
- docs/CHANGELOG.md (최근 변경 기록)

[응답 원칙]
- CEO의 아이디어에 대해 기술적 실현 가능성과 공수를 판단한다.
- memory-bank의 현재 상태를 근거로 답변한다 (이미 있는 것을 또 하자고 하지 않음).
- 필요하면 대안을 제시한다.
- 합의된 작업은 디스패치 형식(---BE---/---FE---/---AI---)으로 정리하여 제안한다.
- 답변은 한글, 간결하게.
- Discord 포맷 필수: ##, ###, --- 사용 금지. 제목은 **굵게**, 구분은 빈 줄로만 표현한다.

[CEO 지시]
`,
};

/** 채널/역할별 표시 라벨 */
const CHANNEL_LABELS = {
  'dev':          '⚡ 개발',
  'backend-dev':  '🔧 BE (디스패치)',
  'frontend-dev': '🎨 FE (디스패치)',
  'ai-dev':       '🤖 AI (디스패치)',
  'ceo':          '👔 CEO 기획실',
  '잡담':         '💬 잡담',
};

/** 채널/역할별 Embed 색상 */
const CHANNEL_COLORS = {
  'dev':          0xFEE75C,  // 노랑
  'backend-dev':  0x5865F2,  // 파랑
  'frontend-dev': 0x57F287,  // 초록
  'ai-dev':       0xEB459E,  // 보라/핑크
  'ceo':          0xFFD700,  // 금색
  '잡담':         0xED4245,  // 빨강
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
  const preview = buffer.slice(-1400) || '(출력 없음)';

  return new EmbedBuilder()
    .setTitle(`${label} — ${status}`)
    .setDescription(preview)
    .setColor(CHANNEL_COLORS[channelName] || 0x99AAB5)
    .setTimestamp();
}

/**
 * Claude subprocess → 스레드에 직접 결과 포스팅
 * 기획실 병렬 dispatch에서 사용
 * @returns Promise<{ channelName, label, buffer, timedOut }>
 */
async function runClaudeToThread(thread, userMessage, channelName, opts = {}) {
  // ── 메시지 정책 검증 (HG001/HG002) ──
  const validation = validateUserMessage(userMessage);
  if (validation.decision === 'deny') {
    const label = CHANNEL_LABELS[channelName] || channelName;
    const embed = new EmbedBuilder()
      .setTitle(`${label} — ❌ 차단됨`)
      .setDescription(`**정책 위반**: ${validation.reason}`)
      .setColor(0xFF0000)
      .setTimestamp();
    await thread.send({ embeds: [embed] });
    return { channelName, label, buffer: validation.reason, timedOut: false };
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) throw new Error('CLAUDE_PROJECT_DIR 환경변수 없음');

  const contextPrefix = AGENT_CONTEXTS[channelName] || AGENT_CONTEXTS['dev'];
  const fullMessage = await buildFullPrompt({
    projectDir,
    thread: opts.injectThreadContext ? thread : null,
    agentContext: contextPrefix,
    userMessage,
  });
  const label = CHANNEL_LABELS[channelName] || channelName;
  const model = getModelForRole(channelName);
  const modelTag = model ? ` · model: ${model}` : '';

  const statusMsg = await thread.send(`⏳ **${label}** 작업 시작...${modelTag}`);
  let buffer = '';
  let lastUpdate = Date.now();

  const flushStatus = async () => {
    const preview = buffer.slice(-1200);
    try {
      await statusMsg.edit(`⏳ **${label}** 진행 중...${modelTag}\n${preview}`);
    } catch (_) {}
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      buildClaudeArgs(channelName),
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

      // L2: ops context log + changelog에 작업 결과 기록
      const summary = extractSummary(buffer);
      const files = extractChangedFiles(buffer);
      writeOpsLog(projectDir, { agent: label, task: userMessage.substring(0, 200), summary, files });
      appendChangelog(projectDir, { agent: label, task: userMessage.substring(0, 200), summary, files });

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
  // ── 메시지 정책 검증 (HG001/HG002) ──
  const validation = validateUserMessage(userMessage);
  if (validation.decision === 'deny') {
    await interaction.editReply(
      `❌ **정책 위반**: ${validation.reason}\n\n` +
      `**이유**: 민감한 경로나 파괴 명령은 Discord 봇을 통해 실행할 수 없습니다.\n` +
      `로컬 개발 환경에서 직접 실행하거나, CEO 기획실의 승인이 필요합니다.`
    );
    return;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    await interaction.editReply('`CLAUDE_PROJECT_DIR` 환경변수가 없습니다.');
    return;
  }

  const contextPrefix = AGENT_CONTEXTS[opts.channelName] || AGENT_CONTEXTS['dev'];
  const fullMessage = contextPrefix + userMessage;
  const model = getModelForRole(opts.channelName);
  const modelTag = model ? ` · ${model}` : '';

  const title = opts.taskTitle ? `**[${opts.taskTitle}]**\n` : '';
  const roleLabel = opts.channelName ? ` (${opts.channelName}${modelTag})` : modelTag;
  await interaction.editReply(
    `${title}⏳ Claude 에이전트${roleLabel} 실행 중...\n\`\`\`\n${userMessage.substring(0, 120)}${userMessage.length > 120 ? '...' : ''}\n\`\`\``
  );

  let buffer = '';
  let lastUpdate = Date.now();

  const flush = async (final = false) => {
    if (!buffer.trim() && !final) return;
    const status = final ? (buffer.includes('Error') ? '⚠️ 완료(오류 포함)' : '✅ 완료') : '⏳ 진행 중...';
    const preview = buffer.slice(-MAX_LEN + 80);
    const content = `${title}${status}${roleLabel}\n${preview}`;
    try {
      await interaction.editReply(content);
    } catch (_) {}
  };

  const proc = spawn(
    'claude',
    buildClaudeArgs(opts.channelName),
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
  review:   (target) => `현재 변경된 파일(git diff HEAD)을 코드 리뷰해줘.${target ? ` 대상: ${target}` : ''}\n- 버그 가능성, 성능 이슈, 코드 스타일 순으로 정리\n- 심각도(High/Med/Low)를 붙여서 3줄 이내로 요약\n- 수정 제안은 diff 형태로`,
  sprint:   ()       => `docs/CURRENT_SPRINT.md 와 docs/DECISIONS.md 를 읽고:\n1. 현재 스프린트 진행 상태 요약\n2. 완료된 항목 / 남은 항목\n3. 다음 우선순위 3가지 제안`,
  pr:       (title)  => `현재 claude/dev 브랜치의 변경사항으로 main 대상 PR을 생성해줘.\n제목: ${title || '(변경 내용 기반으로 자동 생성)'}\n- PR 본문: 변경 이유, 주요 변경점, 테스트 방법 포함`,
  test:     (file)   => `${file ? `${file} 파일` : '최근 변경된 파일'}에 대한 유닛 테스트를 작성해줘.\n- 기존 테스트 스타일/프레임워크 따르기\n- 정상 케이스 + 엣지 케이스 포함`,
  explain:  (file)   => `${file ? `${file}` : '현재 작업 중인 핵심 파일'}을 읽고 설명해줘.\n- 목적, 주요 로직, 의존성을 한글로\n- 처음 보는 사람도 이해할 수 있는 수준`,
  'doc-sync': ()     => `API 문서 동기화 작업을 수행해줘.
1. game_project_server의 모든 Controller를 스캔해서 현재 엔드포인트 목록을 추출한다.
2. docs/API_REFERENCE.md의 내용과 비교한다.
3. 추가/변경/삭제된 엔드포인트가 있으면 docs/API_REFERENCE.md를 갱신한다.
4. WebSocket @MessageMapping도 확인한다.
5. 클라이언트(game_project_app)의 API client도 확인해서 파일:라인 참조를 업데이트한다.
6. 변경 사항을 요약하고, 변경이 없으면 "문서 최신 상태"라고 보고한다.`,
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
    await runClaude(interaction, message, { channelName: 'dev' });
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
