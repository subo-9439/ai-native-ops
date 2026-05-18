# Project: project-manager (game-project 운영 허브)

## 역할
- Discord 봇 / 큐 / 디스패치 / 감사 / 자동 복구 등 game-project 의 **운영 인프라**를 담는다.
- 게임 자체 코드는 `../whosbuying/` 에 있고, 본 디렉터리는 그 운영을 보조한다.
- harness-kit/ 는 신규 repo 에 운영 정책을 1회 설치하는 **템플릿**이다 (운영 도구 아님).

## 주요 모듈
- `discord-bot/` — Discord 운영 봇 (페르소나: ceo/dev/codex/design-director/backend-dev-delta/frontend-dev-delta/ai-dev-delta)
- `discord-bot/prompts/` — 각 페르소나 시스템 프롬프트 SSOT
- `management-gateway/` — 운영 API 게이트웨이
- `scripts/` — 헬스 체크 / 자동 복구 / launchd 설치
- `harness-kit/` — 신규 repo 부트스트랩 템플릿
- `docs/`, `docs-wiki/` — 운영/디스패치/큐/플레이북 문서
- `.claude/rules/harness/` — 하네스 게이트 규칙 (whosbuying SSOT 복제본)
- `.claude/hooks/` — PreToolUse/SessionStart/PostCompact 런타임 게이트
- `.claude/handover/SESSION_HANDOVER.md` — 운영 세션 인계 SSOT

## 작업 원칙
- 답변은 항상 한글, 직설적으로 작성한다.
- **간결 응답 의무 (Standing Rule, 2026-05-12)**: 장황 금지. 기본 5줄 이하. diff dump / 같은 내용 반복 금지. 코드 변경은 "파일:줄 — 무엇" 한 줄. 의무 검증 표현(있을 경우)만 한 줄씩 유지. 사용자가 "자세히/풀어서/디테일" 명시 시에만 expand. 동일 규칙이 Discord 봇 모든 페르소나에도 적용되어 있다. SSOT: `.claude/rules/harness/concise-response-gate.md`.
- **거짓 단정 금지 (2026-05-19)**: 검증 안 한 결과를 완료/성공/배포됨/가동중으로 보고 금지. "될 것"≠"됐다". 배포·push·잡상태는 실제 확인 명령 결과를 본 뒤에만 단정하고 그 결과를 첨부. 상세: `.claude/rules/harness/no-false-claim-gate.md`.
- 변경 제안은 `문제점 → 개선안 → 기대효과` 한 줄씩.
- whosbuying 코드 (`../whosbuying/**`) 직접 수정 금지. 운영 도구 수정만 본 디렉터리에서 수행한다.

## Discord 봇 페르소나 SSOT
`discord-bot/prompts/` 의 모든 페르소나 (ceo / dev / codex / design-director / backend-dev-delta / frontend-dev-delta / ai-dev-delta) 에 간결 응답 의무가 직접 박혀 있다. 페르소나 추가 시 동일 블록을 같이 추가한다 (`[간결 응답 의무 — Standing Rule (2026-05-12)]`).

## 안전 규칙
- `.env`, secrets/, *.pem, *.key 등 민감 경로 접근 금지.
- `rm -rf`, `git reset --hard`, `git push --force` 등 파괴 명령 금지.
- launchd plist 수정은 사용자 승인 후에만.

## 하네스 SSOT 원칙 (PR-HARNESS-PARITY)

- **SSOT = `whosbuying/.claude`**. 본 PM `.claude/rules/harness/` 는 그 복제본이다.
- 복제 목적: 운영 진입점(CLI claudew / Discord 봇 / Desktop Bridge)에서 game 과 **동일한 하네스 검증**을 적용하기 위함.
- **규칙 내용 변경은 whosbuying 에서만** 한다. PM 은 그 결과를 동기화만 한다 (PM 에서 직접 규칙 본문을 고치지 않는다).
- game 전용 3 게이트(`responsive-gate.md` / `polish-pass-gate.md` / `asset-first-gate.md`)는 PM=운영 인프라(Node/스크립트, Flutter UI 없음)이므로 **본 규칙 강제 대상 아님**. SSOT 일관성 위해 복제만 하고 파일 상단에 `[PM 적용 제외]` 인용블록을 둔다.
- 동기화 절차: whosbuying 게이트 추가/변경 시 → `cp ../whosbuying/.claude/rules/harness/*.md .claude/rules/harness/` → game 전용 3개에 PM 적용제외 1줄 재부착 → commit.

## 하네스 실행 계약 (Harness Execution Contract)

이 저장소(운영 인프라)에서 Claude가 반드시 따라야 할 최상위 실행 규칙이다. 규칙 본문 SSOT 는 `whosbuying/CLAUDE.md` "하네스 실행 계약" + `.claude/rules/harness/*.md`.

1. **증거 없는 심볼/API 추천 금지** — declaration/callsite/docs/tests 중 하나 이상 근거 없이 확정하지 않는다. 근거 없으면 "추정" 라벨링. (`evidence-gate`)
2. **승인 전 자동 반영 금지** — proposed → approved 없이 applied 금지. 단, 운영 디스패치 자동 푸시(8조)는 검증 통과 시 예외.
3. **민감 경로 접근 금지** — `.env`, `secrets/`, `*.pem`, `*.key`, `credentials/` 등. hook(HG001 `pre_tool_gate.py`)이 강제 차단. (`repo-security-gate`)
4. **변경 전 스캔, 변경 후 self-check** — 기존 파일 확인 → 변경 → 결과 검증의 3단계를 생략하지 않는다.
5. **설명보다 파일/패치/검증 우선** — 긴 설명 대신 실제 파일 변경, 패치, 검증 결과를 제시한다.
6. **degraded/manual fallback 허용** — hooks/lock/schema 검증이 불가하면 degraded 모드로 전환하여 최소한의 기능은 유지한다 (운영 가능성 우선).
7. **에셋 우선 사용 금지** — [PM 적용 제외 — Flutter UI 없음] SSOT 일관성 위해 게이트 복제, game(whosbuying)에만 강제. (`asset-first-gate`)
8. **운영 워크플로 게이트** — 감사 루프 noop-skip(HG003 `audit_loop_guard.py`), 디스패치 SLA(warn 30m / fallback 4h, HG005 `dispatch_sla_check.py`), 자동 푸시 의무, 큐 적재 무결성(HG004). 상세는 `.claude/rules/harness/operational-workflow-gate.md`.
9. **반응형 게이트** — [PM 적용 제외 — Flutter UI 없음] SSOT 일관성 위해 게이트 복제, game(whosbuying)에만 강제. (`responsive-gate`)
10. **연계 작업 게이트** — 운영 데이터(큐/디스패치/페르소나 SSOT 등) 변경 시 그 데이터가 흐르는 후속 진입점(봇/게이트웨이/CLI)을 함께 점검한다. (`connected-work-gate`)
11. **고도화 게이트** — [PM 적용 제외 — Flutter UI 없음] SSOT 일관성 위해 게이트 복제, game(whosbuying)에만 강제. (`polish-pass-gate`)
12. **간결 구현 게이트** — 완전히 동작하는 가장 단순한 방법으로 푼다. 코드는 적을수록 좋다. 추측 기능 0 / 불필요 추상화 0 / 과설계 0. 코드 수정 PR 답변에 `간결 구현 검증: 최소범위 ✓ / 추측기능 0 ✓ / 과설계 0 ✓` 한 줄 명시. 상세는 `.claude/rules/harness/simplicity-first-gate.md`.
13. **수술적 변경 게이트** — 요청한 것만 수정한다. 인접 코드·주석·포맷 "개선" 금지, 안 깨진 코드 리팩터 금지, 기존 스타일 매칭, 본인 변경으로 생긴 orphan 만 정리. 코드 수정 PR 답변에 `수술적 변경 검증: 요청범위만 ✓ / 인접개선 0 ✓ / 스타일매칭 ✓` 한 줄 명시. 상세는 `.claude/rules/harness/surgical-change-gate.md`.

추가 게이트: `concise-response-gate`(답변 길이), `no-false-claim-gate`(거짓 단정 금지), `plan-first-gate`(PR plan.md 동봉), `codex-review-gate`(commit 후 Codex 검수), `intent-inference-gate`(의도 추론), `auto-recovery-gate`(3-layer 자동 복구), `desktop-bridge-policy`(Desktop 채널 협소화).

참조: `.claude/hooks/` (런타임 게이트), `.claude/rules/harness/` (규칙 16개 — whosbuying SSOT 복제본)

## 세션 핸드오버 의무 (Standing Rule — 항상 적용)

> 운영 세션도 새 세션에서 누적 운영 작업/미완 항목을 정확히 인계받아야 한다.

**SSOT 파일**: `.claude/handover/SESSION_HANDOVER.md`

### 새 세션 시작 시
1. **첫 행동 = `.claude/handover/SESSION_HANDOVER.md` Read**. 이전 운영 세션 누적 작업 / 미완 / 다음 액션을 본 파일에서 인계받는다.
2. 본 파일이 없거나 stale (7일 이상) 이면 사용자에게 보고 + 작업 진입 보류.

### 세션 종료 직전 의무 (Claude 자가 트리거)
컨텍스트 무거움 / 압축 임박 / 사용자가 "새 세션 권장?" 질의 시:
1. `.claude/handover/SESSION_HANDOVER.md` 의 §1~§8 갱신 (날짜, 누적 운영 작업, git 상태)
2. 미완 작업을 §3 에 정확히 기록
3. 다음 세션 시작 명령 예시를 §8 에 갱신
4. commit message 에 `핸드오버 갱신` 포함 (운영 PR 과 분리 가능)
