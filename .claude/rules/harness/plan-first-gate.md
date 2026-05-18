# Plan-First 게이트 (plan-first-gate)

> **사용자 지시 (2026-05-16)**: "내가 환경을 옮겨도 거기서 AI로 개발이 진행되어야 하니"
> 매 PR 은 `docs/product/<feature>-plan.md` 동봉 의무. 새 환경 clone 시 기획 의도 그대로 이어가야 함.

## 원칙

모든 PR (PR-XXX) 은 다음 중 하나를 만족해야 commit 인정:

1. `docs/product/<feature>-plan.md` 신규/갱신 commit 에 포함
2. **간단 PR 예외** — commit 메시지 첫 줄에 `[plan-skip: <사유>]` 명시 (1줄 fix / 의존성 bump / docs 갱신 같은 trivial 케이스만)

## plan.md 표준 형식

```
# PR-XXX — <feature 이름>

## Context
사용자 지시 / 보고 / 의도 (원문 + 날짜)

## 작업 분할
- 파일별 변경 (영향 매트릭스 N개)
- 변경 유형 (edit/new/del)

## 검증
- analyze / test / golden / 시각

## 후속 (별 PR)
- 본 PR 범위 외 항목
```

## 환경 이동 시나리오

새 환경 clone → `docs/product/*.md` 전수 읽기 → AI agent 가 즉시 누적 PR 의도 파악 + 미완 후보 진입.

## 다른 게이트와의 관계

| Cross-link | 관계 |
|------------|------|
| `evidence-gate` | plan.md 본문에 근거 (이전 결정 / 메모리 / 코드) 명시 |
| `codex-review-gate` | Codex 가 plan.md ↔ 구현 일치 자동 검토 |
| `concise-response-gate` | 답변은 5줄 이하 — plan.md 자체는 구조화 허용 (적용 제외) |
| `connected-work-gate` | plan.md "작업 분할" 항목에 영향 매트릭스 6단계 포함 |

## 위반 시

- L1: Claude 자발적으로 plan.md 누락 시 즉시 작성 후 amend
- L2: post-commit hook 이 plan.md 없으면 warning (후속 PR 에서 자동화)
- L3: 사용자 사후 발견 시 plan.md 회고 작성 + 본 게이트 갱신

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 | Claude 자발적 plan.md 동봉 |
| L2 — Hook (후속) | post-commit hook plan.md 검출 | warning 송신 |
| L3 — Codex | codex-review-gate 가 plan.md ↔ diff 일치 평가 | 누락 시 ⚠️ 표시 |
