# project-manager — 운영 세션 핸드오버 (SSOT)

> 본 파일은 PM(운영 인프라) 세션 인계 SSOT 다. 새 세션은 첫 행동으로 이 파일을 Read 한다.
> game(whosbuying) 핸드오버 SSOT 는 `../whosbuying/.claude/handover/SESSION_HANDOVER.md` (별개).

## 1. 마지막 세션 정보 (2026-05-19)

- 작업: **PR-HARNESS-PARITY** — project-manager 에 `.claude/` 하네스 전수 신설.
- 배경: 사용자(하네스 전문가 지시, 2026-05-19) — PM 은 운영 인프라(Discord 봇/게이트웨이/스크립트)인데 `.claude/` 자체가 없었음(규칙 -12, hook -7). whosbuying 의 하네스 게이트 전체를 PM 에 복제. 사용자 선택 = "전체 복제".
- 병렬 작업: Sub-agent A 가 whosbuying 에 신규 2게이트(`simplicity-first-gate.md` / `surgical-change-gate.md`) 추가 + Discord 봇 prompts 갱신. Sub-agent B(본 세션) 가 PM `.claude/` 신설.

## 2. 완료된 운영 작업 (PR-HARNESS-PARITY)

- `project-manager/.claude/rules/harness/` 신설 — whosbuying SSOT 게이트 **16개 전부 복제** (Sub-agent A 가 작업 중 신규 2게이트 완료 → 16개 동기화 성공).
  - 16개: asset-first / auto-recovery / codex-review / concise-response / connected-work / desktop-bridge-policy / evidence / intent-inference / no-false-claim / operational-workflow / plan-first / polish-pass / repo-security / responsive / simplicity-first / surgical-change.
  - game 전용 3개(`responsive-gate` / `polish-pass-gate` / `asset-first-gate`)는 파일 상단에 `[PM 적용 제외]` 인용블록 1줄 추가 (SSOT 일관성 위해 복제만, 본 규칙은 game 에만 강제).
- `project-manager/.claude/hooks/` 마이그레이션 — 7개 복제: `pre_tool_gate.py` / `audit_loop_guard.py` / `dispatch_sla_check.py` / `event_logger.py` / `audit_config_change.py` / `reinject_after_compaction.py` / `sync_mcp_on_session_start.sh`.
  - 하드코딩 경로 없음 — 모든 hook 이 repo-root 상대탐지(`Path(__file__).parents[2]` / `dirname x3`) 사용 → PM 에서 그대로 동작.
  - `sync_mcp_on_session_start.sh` 는 PM 에 `scripts/sync-mcp-config.mjs` 부재 → 정상 skip(exit 0). 주석을 PM 맥락으로 갱신.
  - syntax: 6개 `python3 -m py_compile` 전부 OK, 1개 `bash -n` OK.
- `project-manager/CLAUDE.md` 확장 — 기존 28줄 + 하네스 실행 계약 13조 + 세션 핸드오버 의무 섹션 + 하네스 SSOT 원칙(whosbuying=원본, PM=동기화) 추가.
- `project-manager/.claude/handover/SESSION_HANDOVER.md` 신규(본 파일).
- `project-manager/.gitignore` 갱신 — `.claude/settings.local.json` / `.claude/**/__pycache__/` 무시 추가. rules·hooks·CLAUDE.md·handover 는 tracked.

## 3. 미완 / 후속

- 없음 — whosbuying 신규 2게이트가 작업 중 완료되어 16개 전체 동기화 성공. 재동기화 TODO 불필요.
- 향후: whosbuying 게이트 추가/변경 시 PM 동기화 절차(CLAUDE.md "하네스 SSOT 원칙") 따라 재복제.

## 4. 운영 규칙 재고지

- whosbuying 코드는 PM 에서 직접 수정 금지 (운영 도구만 본 디렉터리에서).
- 하네스 규칙 본문 변경은 whosbuying(SSOT)에서만. PM 은 동기화.
- PM 에는 post-commit hook 미설치 → commit 후 push 는 수동(`git push`) 필요(이번 PR 본인 처리).

## 5. Git 상태 (세션 종료 시점)

- repo: `subo-9439/ai-native-ops` (origin), branch `main`.
- 본 PR 커밋 + push 완료(상세 sha 는 commit 로그 참조).

## 6. 새 세션 시작 명령 예시

```
# PM 운영 세션 시작 시
cat project-manager/.claude/handover/SESSION_HANDOVER.md   # 본 파일 인계
cat project-manager/CLAUDE.md                              # 하네스 계약 확인
```

## 7. 다음 세션 종료 시 의무

- 본 파일 §1~§6 갱신 (날짜, 누적 운영 작업, git 상태, 미완).
- commit message 에 `핸드오버 갱신` 포함.

## 8. 다음 액션

- 신규 운영 작업 진입 시: 본 파일 §3 미완 확인 → 없으면 사용자 신규 지시 대기.
