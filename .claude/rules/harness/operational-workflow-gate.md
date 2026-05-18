# 운영 워크플로 게이트 (operational-workflow-gate)

> **rules만으로는 충분하지 않다.** 이 규칙은 `.claude/hooks/audit_loop_guard.py` + `.claude/hooks/dispatch_sla_check.py` hook과 함께 동작한다.
> rules는 Claude가 읽는 지침이고, hooks는 시스템이 강제하는 게이트다. 둘 다 있어야 한다.

## 원칙

운영 워크플로(디스패치, 감사 루프, 자동 푸시, 큐 적재)는 evidence-gate / confirmation-gate / asset-first-gate 와 동일 계층의 하네스 게이트다. 본 게이트는 메모리 지침(L1)·Hook 강제(L2)·외부 cron(L3) 3중 방어로 운영 사고 재발을 차단한다.

정책 SSOT: `.agent/harness/policies/operational-workflow.yaml`

## 1) 디스패치 SLA (HG005)

디스패치(`---FE---/---BE---/---AI---`)를 발행한 시각부터 시계가 시작된다.

| 임계 | 기준 | 동작 |
|------|------|------|
| **warn** | 30분 | CEO 보고 1회 + A/B/C 3택 제시 (A 대기 / B 직접 구현 / C 재시도) |
| **fallback** | 4시간 | 승인 없이 Claude 가 Bash 로 직접 구현 진입 (push + deploy 까지 한 묶음) |

- pending 항목 timestamp 는 `.agent/harness/memory/dispatch_state.json` 에 기록한다.
- `dispatch_sla_check.py` 를 cron/CLI 로 호출 시 exit 2 → 위반 감지.
- 임계값은 `customer_override` 키로 B2B 고객별 변경 가능하다.

**위반 사례 (2026-04-28~29)**: PR-ADS1 FE 디스패치 16h 30m 무응답. CEO 가 5회 폴링해서야 인지. SLA 미설정이 근본 원인.

## 2) 감사 루프 책무 (HG003)

30분 주기 감사 cron 잡은 운영 신호만 점검한다. **체인 해시 정합 줄 신규 append 금지.**

표준 체크리스트 (`audit_loop` 섹션 참조):

1. **AL-001 SLA 시계** — pending 디스패치 timestamp 비교 → `dispatch_sla` 로 escalate.
2. **AL-002 Dirty tree** — `git status --porcelain` 비어있지 않으면 1줄 보고 + 자동 커밋·푸시.
3. **AL-003 큐 적체** — `work-queue.json` pending >= 1 인데 1h 이상 진행 신호 없으면 보고.
4. **AL-004 클라이언트 에러 자율 모니터링 (HG007)** — `.agent/harness/scripts/audit_client_error.py` 실행. 최근 30분 `game_project_server/logs/client-error.log` 신규 ≥5건 또는 동일 errorType ≥3회 반복 시 exit 2 + JSONL 보고. state 파일은 `.agent/harness/memory/client_error_audit_state.json`. 제외 errorType: `ws_recovered`, `ws_reconnect_attempt`.
5. **신호 없음** — 1줄 ("운영 신호 없음. 다음 잡 30분 후.") 만 남기고 종료.

**noop-skip 강제**: 직전 감사 이후 HEAD + dirty hash 동일하면 `activeContext.md` append 시도를 hook 이 차단한다 (`HG003: audit loop noop denied`).

**위반 사례 (2026-04-29)**: 30분 cron 잡 8회가 "체인 해시 정합 확인 완료" 줄만 누적. 운영 신호 감지 0.

## 3) 디스패치 자동 푸시

디스패치 검증(테스트/analyze) 통과 즉시 커밋·푸시·배포까지 한 묶음으로 자동 실행한다.

- 사용자 추가 승인 대기 금지. "사용자 승인 시 푸시" 패턴 금지.
- 예외: HG001(민감 경로) / main force push / CEO 명시 보류 지시.
- 검증 실패 시 dirty tree 유지 + 1줄 사고 보고.

## 4) 큐 적재 무결성 (HG004)

큐(`project-manager/work-queue.json`) 적재는 **파일 직접 편집만** 인정한다.

- `<<START_QUEUE>>` 태그만 단독으로 붙이는 행위 금지.
- pending 0 상태에서 태그만 부착 시 봇이 사일런트 실패 처리한다.
- 적재 절차: 1) Bash 로 work-queue.json append, 2) `<<START_QUEUE>>` 태그 부착.
- 단건 PR 은 큐 우회, 디스패치 채널에 직접 블록 송신이 빠르다.

런북: `project-manager/docs/INCIDENT_QUEUE_APPEND_MISSING.md`

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 + 메모리(`feedback_dispatch_*`, `feedback_audit_loop_*`) | Claude 자발적 준수 |
| L2 — Hook | `audit_loop_guard.py` (PreToolUse) | 런타임 차단 (HG003) |
| L3 — Cron | `dispatch_sla_check.py` (외부 cron/CLI) | 주기 감사 (HG005) |

세 계층 중 하나라도 거부하면 해당 작업은 수행하지 않는다.

## 제품화 (B2B SaaS 후보)

운영 디스코드를 B2B SaaS 로 외판할 때 본 게이트는 그대로 고객 SLO 템플릿이 된다.

- `dispatch_sla.thresholds` — 고객별 warn/fallback 임계 override.
- `audit_loop.responsibilities` — 고객 도메인 맞춤 체크리스트 추가.
- `dispatch_autopush.exceptions` — 고객 컴플라이언스 예외 등록.

자세한 키는 `operational-workflow.yaml#productization` 참조.
