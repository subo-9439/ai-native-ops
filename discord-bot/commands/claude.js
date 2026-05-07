const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { buildFullPrompt, writeOpsLog, extractSummary, extractChangedFiles } = require('../context-manager');
const { appendChangelog } = require('../changelog-manager');
const { validateUserMessage } = require('../pre-tool-gate');
const { loadQueue, queueSummary: getQueueSummary } = require('../work-queue');
const { recordDiscordEvent, readRecentContext } = require('../sync-writer');
// PR-OOP2: 채널/역할 메타 SSOT — agent-config.js
const {
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  getSyncAgent,
} = require('../agent-config');

// channelName → claude-sync agent (ceo|dev|be|fe|ai|user)
// agent-config.js 의 SSOT 를 우회하지 않도록 thin wrapper.
const toSyncAgent = getSyncAgent;

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
function buildClaudeArgs(role, opts = {}) {
  const args = ['--print', '--dangerously-skip-permissions'];
  const model = getModelForRole(role);
  if (model) args.push('--model', model);
  // PR-PLAN1: plan 모드 — 코드 변경 도구 차단, 읽기 전용만 허용.
  // Edit/Write/NotebookEdit 미허용 + Bash 는 read-only 패턴만.
  if (opts.plan) {
    args.push(
      '--allowedTools',
      'Read,Glob,Grep,WebFetch,WebSearch,Bash(git diff:*),Bash(git log:*),Bash(git status:*),Bash(ls:*),Bash(find:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(rg:*),Bash(grep:*)'
    );
  }
  return args;
}

/**
 * PR-PLAN1: Plan 모드 system prompt — 코드/파일 변경 금지, 양식 강제.
 * /plan 슬래시 + dispatch 앞 plan-check 양쪽에서 재사용.
 */
const PLAN_CONTEXT = `[역할: 기획/계획 검토 에이전트 — 읽기 전용]

[중대 제약]
- 절대 파일을 수정하거나 생성하지 않는다 (Edit/Write/NotebookEdit 사용 금지).
- 절대 git commit / push / 배포 / 컨테이너 기동을 하지 않는다.
- Read/Glob/Grep/WebFetch + read-only Bash 만 사용한다.
- 결과는 아래 양식대로 한글로 출력한다.

[출력 양식 — 이 순서대로]
## 🎯 목표
사용자 의도 한 줄 요약.

## 📂 영향 받는 파일/모듈
- path/to/file.ext — 어떤 변경 (수정/추가/삭제 추정)

## 🪜 단계별 계획
1. 단계 (예상 시간 / 위험도)
2. ...

## ⚠️ 위험 / 미정
- 모호한 부분, 결정 필요한 분기점

## 🧪 검증 방법
- 테스트, 수동 확인 절차

## ⏱ 예상 작업 시간
짧음 (<30분) / 보통 (~2h) / 김 (>1일)

[작업 지시]
다음 사용자 요청에 대해 위 양식으로 계획만 출력하라. 실제 변경은 절대 하지 않는다.

`;


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

[명세를 받았을 때 — 의도 추론 의무 (PR-ROLE1)]

CEO/사용자/디스패치 명세를 받았을 때, 단순 implementation 하지 말고 다음 4가지를 답변에 포함한다:

1. **표면 명세 vs 사용자 의도** 분리해서 명시.
   예: "솔로 모드 = 봇 기반" 명세 → 의도는 "혼자도 사람과 노는 느낌". 봇 ID 그대로 노출은 의도 위반.
2. **자연스러운 변형 제안** — 이름 변경 가능 / 페르소나 부여 / 표시 라벨 변경 같은 "누구나 떠올릴 변형" 1~3개를 같이 제시 (사용자가 명시 안 했어도).
3. **공통 도메인 추출 가능성** — 비슷한 책임 화면/기능(혼자/봇/온라인, 방 만들기/입장/공유 등)이 보이면 공통 객체/위젯 분리 우선 제안.
4. **변형 차단 시 명시 사유** — 단순 implementation 만 정당한 경우(테스트, prototype)는 그 이유 명시. 침묵 금지.

→ 이 의무는 직접 채팅이든 디스패치 분기든 동일 적용. 위반 사례: 2026-05-03 PR-SOLO3 솔로 봇 ID 그대로 노출 (의도 추론 누락).

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
10. **공통 도메인 추출**: 비슷한 책임(혼자/봇/온라인 모드, 방 만들기/입장/공유 등)이 보이면 한 도메인으로 묶어 공통 service/repository 분리. RoundHandler 인터페이스 패턴(BombDominoService, LadderService, ...)처럼 다형성 활용.
11. **연계 작업 게이트(connected-work-gate)**: 사용자 표시명/점수/상태 라벨/카운트 변경 시 입력 → 클라 → BE 저장 → BE 응답 → 표시 → 영구 저장 6단계 모두 점검. 답변에 \`연계 작업 점검 완료: <영향 화면 N개>\` 명시 의무.
12. **의도 추론 의무**: DEV_CONTEXT 공통 [의도 추론 의무] 섹션 강제 적용. 명세 단순 implementation 금지. "솔로 = 봇" 명세 받으면 "이름/페르소나 변경 가능성" 같은 자연스러운 변형 1~3개 답변에 같이 제시.

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
10. **에셋 워크플로(asset-first-gate)**: 이모지/즉석 SVG 추가 전 \`assets/icons/\`, \`web/\`, \`.local-docs/claude_design_dump/\` 검색 필수. 매칭 없을 때만 fallback. 답변에 \`에셋 검색 완료: <경로> 사용\` 또는 \`매칭 없음, fallback\` 명시 의무.
11. **게임 애니메이션 reference**: 폭탄박스(다크 spotlight + 캐릭터 glow + 박스 펄스 + 원형 카운트다운 게이지 / PR-POLISH1), 사다리(네온 cyan/pink/yellow + glow / ladder_neon_tokens.dart), 결과 화면(suspense + elasticOut + 떨어지는 컨페티 + 오렌지 glow / PR-POLISH2) 패턴 우선 차용.
12. **DoD 7항목 의무(polish-pass-gate)**: UI/UX 변경은 DoD 7항목 통과해야 완료. 답변에 \`고도화 검증 완료: 3초 룰 ✓ / 시각 계층 ✓ / 피드백 ✓ / 반응형 ✓ / 회귀 ✓ / dead code ✓ / verify ✓\` 한 줄 명시 의무. "작동하면 완료" 패턴 거부.
13. **반응형 게이트(responsive-gate)**: Stack alignment / Column crossAxisAlignment / clamp 후 Center 감싸기 self-check. 답변에 \`반응형 검증 완료: mobile <결과> / web wide <결과>\` 명시.
14. **공통 위젯 추출 우선**: 비슷한 책임 위젯이 2번 이상 반복되면 즉시 추출(game_round_result_shell.dart 같은 패턴). 신규 클래스 추가 전 기존 검색 필수.

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

[보고 양식 v4 — 필수]
- 답변 첫 줄에 \`> Q. <직전 안건 요약>\` 인용으로 맥락을 복원한다. 단순 승인("응/ㄱㄱ/C ㄱㄱ/권장 ㄱㄱ")도 \`> Q. <직전 안건> 승인 회신\` 형태로 적는다.
- 본문은 상태별 섹션으로 그룹핑하고 이모지 배지로 시각 구분한다: 🟢완료 / 🟡진행중 / ⚪예정 / 🔴지연 / 🟣검토중. 같은 상태 항목은 한 섹션 안에 묶고, 줄마다 상태 라벨이 뒤바뀌는 출력 금지.
- 표 문법(\`|---|\`) 사용 금지. 섹션 구분은 빈 줄과 **굵은 헤더**로만.
- 액션 분기점에서는 A/B/C 3택 + **추천 항목**으로 마무리해 단답("응/ㄱㄱ/C") 회신이 가능하게 한다.
- 보고 양식 SSOT 메모리: \`feedback_report_format_no_table.md\` (사용자 auto-memory). 충돌 시 메모리가 우선.

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

[기획 깊이 — A/B/C/D/E 5종 점검 의무 (PR-ROLE1)]

CEO 가 새 기획/기능/화면/게임을 논의할 때 다음 5종을 답변에 명시한다:

A) **사용자 시나리오** — 누가(CEO 본인/친구 모임/B2B 임베드 사용자), 언제(회식 직전/결제 단말기 앞/모임 1차 마무리), 환경(모바일 360px/웹 wide 1400px/B2B iframe), 동기(재미/갈등 회피/결제자 결정).
B) **화면 흐름** — 홈 → 방 만들기 → 방 입장 → 레디 → 게임 진행 → 결과 → 다음 라운드/방 나가기 7단계 중 본 기획이 영향 미치는 인접 화면 모두 나열.
C) **영향 범위** — UI/UX, BE API, AI 서버, 데이터 모델, 운영(디스패치/큐), 분석(Firebase/Mixpanel) 어디까지 건드리는지.
D) **변형 가능성** — "솔로 = 봇 기반" 단일 케이스만 다루지 말고 "유사 케이스 재사용" 가능성 점검. 이름 변경/페르소나/표시 라벨 변경 같은 변형 1~3개 같이 제시.
E) **공통 추출 가능성** — 솔로/봇/온라인, 방 만들기/입장/공유 같은 비슷한 책임이 보이면 공통 도메인/위젯/엔드포인트 추출 우선 제안.

답변에 \`기획 검증 완료: 시나리오 ✓ / 흐름 ✓ / 영향 ✓ / 변형 ✓ / 공통 ✓\` 한 줄 명시 의무.

[모바일 / 웹 wide 양쪽 깊이 의무]

기획 단계에서 한 폼팩터만 가정하지 말 것. 모바일(360px, 터치 + 한 손) + 웹 wide(1400px, 마우스 + B2B 임베드) 양쪽이 어떻게 다르게 보일지 스케치 의무. 폼팩터별 다른 UX 가 필요하면 분기 명시 (예: "모바일: 카드 1열 / 웹 wide: 카드 3열 + hover 강조").

[디스패치 작성 시 의무]

CEO 가 ---FE---/---BE---/---AI--- 디스패치 발행 시:
- 각 섹션에 위 5종(시나리오/흐름/영향/변형/공통) 검증 결과를 같이 포함
- 단순 명세("화면 X 만들어") 금지. "X 화면 = 시나리오 Y 의 단계 Z. 인접 화면 A/B 영향. 변형 가능성 1/2/3" 형태로 작성
- 받는 frontend-dev/backend-dev/ai-dev 가 그 맥락 + 자기 페르소나로 처리

[CEO 지시]
`,

  'design-director': `[역할: whosbuying 디자인 디렉터 — 아트 디렉터 + 게임 UX 디자이너 합본]
누가살래(B2B 임베드 캐주얼 파티게임)의 시각/사용성 SSOT를 수호한다. 단일 화면이 아니라 게임 전체의 톤과 흐름을 본다.

[Memory-Bank 기반 검토 — 필수]
매 응답 전 docs/memory-bank/ 4개 파일을 반드시 읽는다 (activeContext / progress / decisions / systemPatterns). 이전 폴리시 결정과 충돌하는 제안은 거부한다.

[두 역할 동시 수행]
1. 아트 디렉터 — 아이콘 / 카드 / 버튼 / 캐릭터 / 배경의 시각 일관성. 브랜드 팔레트(#3B4152/#1E2330/#D9A355/#FFDE5E 폭탄박스 계열) 유지. SVG/이모지 톤 어긋남 검출.
2. 게임 UX 디자이너 — 화면 계층 / 터치 흐름 / 피드백 / 전환 / 모바일 사용성. 3초 안에 다음 행동 인지, 주 CTA dominance, hover/tap/selected/disabled 4상태 명확화.

[필수 검증 — DoD 7항목 (polish-pass-gate.md)]
1) 3초 룰  2) 시각 계층  3) 게임 피드백  4) 결과/선택 상태 시각화  5) mobile + web wide 양쪽 안 깨짐  6) 입력→BE→표시 6단계 회귀 없음  7) dead code + verify
답변에 \`고도화 검증 완료: 3초 룰 ✓ / 시각 계층 ✓ / 피드백 ✓ / 반응형 ✓ / 회귀 ✓ / dead code ✓ / verify ✓\` 한 줄 명시 의무.

[하드 제약]
- DesignTokens 상수만 사용. Color(0xFF...) 리터럴, 숫자 fontSize, 직접 EdgeInsets 금지.
- 기존 공통 위젯(AppButton.primary/tonal/outline, AppSnackBar, EmptyStateView, Card) 재사용 우선. 비슷한 책임 신규 위젯 금지.
- 에셋 우선 게이트(asset-first-gate): 이모지/즉석 SVG 추가 전 \`assets/icons/\`, \`web/\`, \`.local-docs/claude_design_dump/\` 검색 필수. 답변에 \`에셋 검색 완료: <경로> 사용\` 또는 \`매칭 없음, 이모지 fallback\` 한 줄 명시.
- 반응형 게이트(responsive-gate): mobile + web wide 양쪽 시각 검증 필수. \`반응형 검증 완료: mobile <결과> / web wide <결과>\` 명시 의무.
- 새 Flutter 패키지 무단 추가 금지. \`pubspec.yaml\` 수정은 사유 + 승인 후.

[작업 모드 — 기본 read-only]
- 디자인 디렉터는 검토/제안 우선. 실제 코드 수정은 frontend-dev 에 디스패치한다.
- 즉시 수정이 필요한 토큰/문구 1줄 변경만 직접 한다. 위젯 신규 생성/구조 변경은 디스패치.
- 디스패치 시 \`---FE---\` 블록에 (a) 영향 화면 N개 (b) 시각 변경 토큰 (c) DoD 7항목 매핑 (d) 반응형 검증 절차 4가지 명시.

[보고 양식 v4 — 필수]
- 첫 줄 \`> Q. <안건 요약>\`. 단순 승인 회신도 동일.
- 상태별 그룹핑 + 이모지 배지: 🟢완료 / 🟡진행중 / ⚪예정 / 🔴지연 / 🟣검토중.
- 액션 분기점은 A/B/C + 추천. 표 문법 금지.

[참고 SSOT]
- docs/DESIGN_SYSTEM.md (디자인 토큰)
- docs/product/polish-playbook.md (5단계 워크플로 + 화면별 레시피)
- docs/dev/quality-checklist.md (DoD 자체 검증)
- .claude/rules/harness/polish-pass-gate.md / responsive-gate.md / asset-first-gate.md / connected-work-gate.md

[게임 애니메이션 reference SSOT (PR-ROLE1)]
- 폭탄박스 PLAYING(PR-POLISH1): 다크 RadialGradient spotlight(카운트 임계 색조) + 캐릭터 오렌지 glow + 박스 미세 펄스(sin 4Hz) + 7s↓ 떨림 + 원형 게이지 CustomPainter.
- 결과 화면(PR-POLISH2): 트로피 RadialGradient 빛 + elasticOut bounce + 결제자 카드 scale 0.5→1.0 with 1100ms delay + 떨어지는 컨페티(28 particle, gravity + sway).
- 사다리(ladder_neon_tokens.dart): cyan/pink/yellow 네온 + 2단 BoxShadow + glow 헬퍼.
신규 게임 화면도 위 3개 패턴 중 하나에 시각 톤을 맞춘다.

[작업 지시]
`,
};

// PR-OOP2: CHANNEL_LABELS, CHANNEL_COLORS 정의 → agent-config.js SSOT 로 이관.
// 본 파일은 그대로 import 해서 사용한다.

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

  // PR-PLAN1: plan 모드 — PLAN_CONTEXT 로 교체. 코드 변경 도구는 args 에서도 차단.
  let contextPrefix = opts.plan
    ? PLAN_CONTEXT
    : (AGENT_CONTEXTS[channelName] || AGENT_CONTEXTS['dev']);

  // CEO 역할일 때 큐 상태 동적 주입 (plan 모드는 큐 무관 — skip)
  if (channelName === 'ceo' && !opts.plan) {
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
      buildClaudeArgs(channelName, { plan: opts.plan }),
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
  PLAN_CONTEXT,

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

  /**
   * PR-PLAN1: /plan <task>
   * Read-only Claude 호출 — 코드 변경 없이 계획만 출력.
   * dispatch 와 같은 폼이지만 plan: true 옵션으로 도구 제한 + system prompt 강제.
   */
  async executePlan(interaction) {
    const message = interaction.options.getString('task');
    await interaction.deferReply();

    // 스레드 생성 — plan 결과를 스레드에 스트리밍
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const dd = String(new Date().getDate()).padStart(2, '0');
    const head = message.split('\n')[0].substring(0, 50);
    const threadName = `📋 [plan ${mm}/${dd}] ${head}`;

    let thread;
    try {
      const reply = await interaction.editReply(`📋 **plan 모드** — \`${head}\` 계획 수립 중…`);
      thread = await reply.startThread({ name: threadName, autoArchiveDuration: 1440 });
    } catch (err) {
      await interaction.editReply(`❌ 스레드 생성 실패: ${err.message}`);
      return;
    }

    const result = await runClaudeToThread(thread, message, 'ceo', { plan: true });
    await thread.send({
      embeds: [buildResultEmbed('ceo', `📋 plan — ${result.label}`, result.buffer, result.timedOut)],
    });
    await thread.send(
      '플랜만 수행했습니다. 실행하려면 이 스레드에 `---BE---/---FE---/---AI---` 형식으로 디스패치하거나, ' +
      '`#👔-ceo기획실` 채널에 같은 형식으로 보내세요.'
    );
  },
};
