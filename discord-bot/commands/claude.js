const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { buildFullPrompt, writeOpsLog, extractSummary, extractChangedFiles } = require('../context-manager');
const { appendChangelog } = require('../changelog-manager');
const { validateUserMessage } = require('../pre-tool-gate');
const { loadQueue, queueSummary: getQueueSummary } = require('../work-queue');
const { recordDiscordEvent, readRecentContext } = require('../sync-writer');

/**
 * channelName(claude.js 내부 키) → claude-sync agent (ceo|dev|be|fe|ai|user)
 */
function toSyncAgent(channelName) {
  switch (channelName) {
    case 'ceo':           return 'ceo';
    case 'backend-dev':   return 'be';
    case 'frontend-dev':  return 'fe';
    case 'ai-dev':        return 'ai';
    case 'dev':
    case '잡담':
    default:              return 'dev';
  }
}

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

[Flutter UI/UX 품질 게이트 — FE 작업 시 필수]
Flutter 코드(game_project_app/, game_project_web/)를 수정할 때 반드시 적용한다:

1. 작업 시작 전 docs/DESIGN_SYSTEM.md를 읽는다.
2. 색상/타이포/스페이싱은 DesignTokens 상수만 사용. Color(0xFF...) 리터럴, 숫자 fontSize, 직접 EdgeInsets 금지.
3. 기존 공통 위젯(AppButton, AppSnackBar, EmptyStateView 등)을 먼저 확인하고 재사용.
4. 화면 진입 애니메이션(FadeTransition+SlideTransition 200~300ms), 버튼 피드백(AnimatedContainer 150ms), 로딩(Shimmer) 적용.
5. 빈 상태/에러 상태 화면 반드시 구현.
6. 시각적 계층: displaySmall(제목) → headlineMedium(섹션) → bodyMedium(본문) → labelMedium(캡션).
7. 섹션 간격 spacing6(24px) 이상, 화면 가장자리 spacing4(16px) 이상.
8. 게임 화면은 ladder_neon_tokens.dart 네온 테마 사용.

이 규칙은 BE 전용 작업에는 적용하지 않는다. Flutter 파일을 한 줄이라도 건드리면 적용한다.

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
  'backend-dev':  DEV_CONTEXT.replace('[작업 지시]', `[이번 작업 영역: 백엔드 game_project_server/]

[백엔드 품질 기준 — 필수]

1. **패키지 구조**: 도메인별 수직 패키지 (room/, game/, admin/, ai/). 각 도메인 안에 api/, service/, domain/, dto/, repo/, exception/, ws/, event/ 하위 구조.
2. **API 설계**: REST는 /api/v1/{도메인} 경로. 컨트롤러에 @Tag, @Operation, @ApiResponses Swagger 어노테이션 필수. 요청 DTO에 @Valid 적용.
3. **응답 래핑**: 컨트롤러는 raw 객체 또는 AppResponse를 반환. ApiResponseAdvice가 자동으로 AppResponse.ok()/okList()/okEmpty()로 래핑한다. ResponseEntity를 직접 쓸 필요 없음.
4. **에러 응답**: DomainException(errorCode, message, httpStatus)을 상속한 커스텀 예외 사용 (예: RoomNotFoundException, RoomJoinForbiddenException). ApiExceptionHandler가 AppResponse.fail(status, code, message) 형태로 변환.
5. **에러 코드 관례**: 대문자 스네이크 (GAME_NOT_FOUND, ALREADY_IN_ROOM, INVALID_STATE 등). 프론트엔드가 code 필드로 분기하므로 변경 시 클라이언트 영향 확인.
6. **게임 상태**: Redis(GameStateStore) + RedisLock으로 관리. 게임별 로직은 GameRoundHandler 인터페이스 구현체 (LadderRoundHandler, BombBoxRoundHandler, LiarGameRoundHandler, BlindBidRoundHandler).
7. **WebSocket**: STOMP 기반. ws/ 패키지에 컨트롤러, @MessageMapping 사용. RoomEventPublisher로 방/게임 이벤트 브로드캐스트.
8. **인프라**: MariaDB + Redis + RabbitMQ. docker-compose.yml로 로컬 실행. application.yml 설정 참조.
9. **커밋 메시지**: 한글 사용, 변경 이유와 내용을 간결하게. memory-bank 갱신을 같은 커밋에 포함.

[작업 지시]`),
  'frontend-dev': DEV_CONTEXT.replace('[작업 지시]', `[이번 작업 영역: 프론트엔드 game_project_app/, game_project_web/]

[UI/UX 품질 기준 — 필수]
작업 전 docs/DESIGN_SYSTEM.md를 반드시 읽는다. 이 문서가 UI 구현의 SSOT다.

1. **디자인 토큰 강제**: 색상/타이포/스페이싱은 반드시 DesignTokens 상수만 사용. 하드코딩된 Color(0xFF...), fontSize, EdgeInsets 숫자 리터럴 금지.
2. **시각적 계층**: 화면에 displaySmall(제목) → headlineMedium(섹션) → bodyMedium(본문) → labelMedium(캡션) 계층이 명확해야 한다.
3. **여백 설계**: 콘텐츠를 빽빽하게 채우지 않는다. 섹션 간 spacing6(24px) 이상, 화면 가장자리 spacing4(16px) 이상.
4. **애니메이션**: 화면 진입 시 FadeTransition+SlideTransition(200~300ms), 버튼 피드백 AnimatedContainer(150ms), 로딩 시 Shimmer 적용. 의미 없는 장식 애니메이션 금지.
5. **컴포넌트 재사용**: AppButton.primary/tonal/outline, AppSnackBar, EmptyStateView 등 기존 공통 위젯을 반드시 먼저 확인하고 사용.
6. **반응형**: 기본 모바일(360px), 웹은 ConstrainedBox(maxWidth: 600)으로 컨텐츠 제한.
7. **빈 상태/에러 상태**: 데이터가 없거나 에러일 때의 화면도 반드시 구현. EmptyStateView 패턴 사용.
8. **게임 화면**: ladder_neon_tokens.dart의 네온 테마 사용. 일반 화면과 시각적으로 구분.
9. **기존 mockup 참조**: docs/mockups/ 에 HTML 프로토타입이 있다. 새 화면의 시각적 톤을 맞춘다.

[작업 지시]`),
  'ai-dev':       DEV_CONTEXT.replace('[작업 지시]', `[이번 작업 영역: AI 서버 game_project_ai/]

[AI 서버 품질 기준 — 필수]

1. **구조**: Spring Boot 앱. 패키지는 기능별 (liar/, gemini/, config/). Controller + Service 2계층. 도메인 엔티티/DB 없음 (stateless).
2. **외부 AI 호출**: GeminiClient (RestClient 기반)로 Gemini REST API 호출. AiProperties (@ConfigurationProperties prefix="ai")로 provider/model/apiKey 관리. 새 AI 기능 추가 시 동일 GeminiClient.generate(prompt) 사용.
3. **프롬프트 설계**: 프롬프트는 Service 클래스에서 buildPrompt() 메서드로 구성. JSON 배열 응답을 요구하고, 정규식으로 파싱 (JSON_ARRAY_PATTERN). 파싱 실패 시 IllegalStateException.
4. **에러 처리**: GlobalExceptionHandler가 Map.of("error", message) 형태로 반환 (게임 서버의 AppResponse와 다름). IllegalStateException은 503, 일반 예외는 500.
5. **DTO**: record 사용 (HintRequest, HintResponse). @Valid + jakarta.validation 적용.
6. **API 경로**: /ai/{게임명}/{기능} 형태 (예: /ai/liar-game/hints). 게임 서버 /api/v1과 구분된 별도 서버.
7. **포트**: 게임 서버(8080)와 다른 포트에서 실행. 게임 서버가 AI 서버를 내부 호출.

[작업 지시]`),

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

[작업 큐 시스템]
project-manager/work-queue.json에 순차 디스패치 큐가 있을 수 있다.
아래 [현재 큐 상태]가 제공되면 이를 인식하라.

🔥 큐 적재의 유일한 방법 (이 규칙을 어기면 사일런트 실패한다):
- 큐에 아이템을 넣는 유일한 방법은 Bash 툴로 project-manager/work-queue.json을 직접 편집하는 것이다.
- 채팅 텍스트에 ---BE---/---FE---/---AI--- 블록을 나열하거나 "큐에 적재했다"고 서술하는 것은 **큐 적재가 아니다**.
- 파일에 append 하지 않고 <<START_QUEUE>> 태그만 붙이면 봇은 pending 0을 감지하고 경고 reply 후 no-op 처리한다.
- 상세 런북: project-manager/docs/INCIDENT_QUEUE_APPEND_MISSING.md

CEO가 "진행해", "시작해", "ㄱㄱ", "응", "해줘", "돌려", "큐 시작" 등
작업 진행을 승인/지시하는 의도를 보이면:
1. [현재 큐 상태]의 pending 수를 먼저 확인한다
2. pending ≥ 1이면 자연스럽게 큐 진행을 설명하고 마지막에 <<START_QUEUE>> 태그를 붙인다
3. pending 0이고 CEO가 새 PR을 논의 중이었다면:
   (a) Bash 툴로 work-queue.json을 편집해 pending 아이템을 append하고,
   (b) 그 다음에 <<START_QUEUE>> 태그를 붙인다
   — (a) 없이 (b)만 하면 안 된다.
4. pending 0이고 새 PR도 없으면 태그를 절대 붙이지 말고 현재 상태를 요약 + 다음 액션(새 아이템 추가/단건 디스패치/재시도)을 제안한다.

단건 PR(1건)은 큐를 우회해 디스패치 채널에 ---BE---/---FE---/---AI--- 블록을 직접 보내는 편이 가장 빠르다. 큐는 2건 이상을 순차 실행할 때만 사용한다.

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

  let contextPrefix = AGENT_CONTEXTS[channelName] || AGENT_CONTEXTS['dev'];

  // CEO 역할일 때 큐 상태 동적 주입
  if (channelName === 'ceo') {
    const queue = loadQueue();
    if (queue?.items?.length > 0) {
      const qStatus = getQueueSummary();
      contextPrefix = contextPrefix.replace(
        '[CEO 지시]',
        `[현재 큐 상태]\n${qStatus}\n\n[CEO 지시]`
      );
    }
  }

  const builtPrompt = await buildFullPrompt({
    projectDir,
    thread: opts.injectThreadContext ? thread : null,
    agentContext: contextPrefix,
    userMessage,
  });

  // claude-sync: 최근 이벤트(터미널+Discord 공유) 주입
  const syncContext = readRecentContext(20);
  const fullMessage = syncContext
    ? builtPrompt.replace('[사용자 지시]', syncContext + '[사용자 지시]')
    : builtPrompt;

  const label = CHANNEL_LABELS[channelName] || channelName;
  const model = getModelForRole(channelName);
  const modelTag = model ? ` · model: ${model}` : '';

  // claude-sync: user_msg 이벤트 기록
  const syncAgent = toSyncAgent(channelName);
  const threadId = thread?.id || null;
  recordDiscordEvent('user_msg', {
    agent: syncAgent,
    threadId,
    summary: userMessage.substring(0, 180),
  });

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
      recordDiscordEvent('session_end', {
        agent: syncAgent,
        threadId,
        summary: `${label} 타임아웃 — ${userMessage.substring(0, 80)}`,
      });
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

      // claude-sync: assistant_reply + session_end 이벤트 기록
      recordDiscordEvent('assistant_reply', {
        agent: syncAgent,
        threadId,
        summary: summary.substring(0, 240),
        artifacts: files,
      });
      recordDiscordEvent('session_end', {
        agent: syncAgent,
        threadId,
        summary: `${label} 완료 — ${userMessage.substring(0, 80)}`,
        artifacts: files,
      });

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
// SSOT: whosbuying/.claude/agents/_router.json
// CLI(claudew) / Bridge MCP 와 동일 라우팅. fallback 시 인라인 키워드 사용.
let _routerCache = null;
function _loadRouter() {
  if (_routerCache) return _routerCache;
  try {
    const path = require('path');
    const fs = require('fs');
    const routerPath = path.resolve(
      __dirname,
      '../../../whosbuying/.claude/agents/_router.json'
    );
    _routerCache = require(routerPath);
  } catch (exc) {
    process.stderr.write(`[bot/router] SSOT load failed (${exc.message}); using inline fallback\n`);
    _routerCache = {
      default: 'claude-dev',
      agents: {
        'backend-dev': {
          keywords: ['spring', 'backend', '백엔드', 'server', '서버', 'api', 'java', 'kotlin', 'redis', 'rabbitmq', 'mariadb', 'websocket', 'stomp', 'controller', 'jpa', 'entity', 'dto', 'docker', 'gradle', '로비', 'lobby', '데이터베이스', 'database', '배포', 'deploy', 'endpoint', 'game_project_server'],
          globs: [],
        },
        'frontend-dev': {
          keywords: ['flutter', 'dart', '프론트', 'frontend', '화면', 'screen', '페이지', 'page', 'ui', 'ux', '앱', '위젯', 'widget', 'riverpod', '버튼', 'button', '레이아웃', 'layout', '애니메이션', 'animation', '스타일', 'style', '색상', 'color', 'game_project_app', 'game_project_web'],
          globs: [],
        },
      },
    };
  }
  return _routerCache;
}

function resolveAgentFromContent(userMessage, override) {
  if (override) return override;

  const router = _loadRouter();
  const msg = (userMessage || '').toLowerCase();
  const scores = {};

  for (const [agent, def] of Object.entries(router.agents || {})) {
    let score = 0;
    for (const kw of def.keywords || []) {
      if (msg.includes(kw.toLowerCase())) score += 1;
    }
    if (score > 0) scores[agent] = score;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  // 봇 기존 동작 보존: 매칭 없거나 동률이면 'claude-dev'
  if (ranked.length === 0) return 'claude-dev';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return 'claude-dev';
  return ranked[0][0];
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
  // CLI 어댑터(whosbuying/bin/claudew) 가 동일 컨텍스트 주입에 사용
  AGENT_CONTEXTS,

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
