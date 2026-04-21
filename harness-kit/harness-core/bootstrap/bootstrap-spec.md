# 하네스 부트스트랩 계약 (Bootstrap Specification)

버전: 1.0.0

## 1. Environment Detect

부트스트랩은 다음을 감지한다:
- **product**: 저장소 루트의 프로젝트 유형 (Flutter/Spring Boot/Monorepo)
- **adapter**: Claude Code / Cursor / OpenHands 등 실행 환경
- **capabilities**: hooks, file_read, file_write, shell, git, network, schema_validate, lock, atomic_write, report_write, confirm_ui

감지 실패 시 `degraded` 모드로 전환한다 (`adapter-contract.yaml` 참조).

## 2. Idempotency

- 부트스트랩은 몇 번이든 재실행해도 동일한 결과를 보장한다.
- 이미 존재하는 파일은 덮어쓰지 않는다 (VERSION 비교 후 업그레이드만 수행).
- 디렉토리 생성은 `mkdir -p` 방식으로 이미 있으면 무시한다.
- 각 단계는 "존재 확인 → 없으면 생성" 패턴을 따른다.

## 3. Lock

- 부트스트랩 동시 실행 방지를 위해 `.agent/harness/.bootstrap.lock` 사용.
- lock 획득 실패 시:
  - 30초 대기 후 재시도 (1회).
  - 재시도 실패 시 `report_only` 모드로 전환 (실제 파일 변경 없이 보고서만 생성).
- lock은 부트스트랩 완료 또는 실패 시 반드시 해제한다.
- stale lock (5분 초과) 은 강제 해제 가능.

## 4. Partial Failure Handling

각 파일 생성은 독립적으로 수행한다. 하나가 실패해도 나머지는 계속 진행한다.

| 실패 유형 | 처리 |
|-----------|------|
| 디렉토리 생성 실패 | 해당 하위 파일 전체 skip, 보고서에 기록 |
| 파일 쓰기 실패 | skip, 보고서에 기록 |
| hook 등록 실패 | degraded 모드 (hooks 없이 rules만으로 동작) |
| schema 검증 실패 | 보고서에 경고, 파일은 생성 |

실패 코드는 `policies/failure-codes.yaml` 참조.

## 5. Self-Check

부트스트랩 완료 후 아래 8개 시나리오를 검증한다:

### SC-01: Bootstrap Idempotency
- 부트스트랩을 2회 실행하여 diff가 없음을 확인.

### SC-02: Lock Collision
- lock 파일이 이미 존재할 때 report_only 모드로 전환되는지 확인.

### SC-03: Sensitive Path Denied
- `pre_tool_gate.py`에 `.env` 경로를 입력하여 HG001 deny를 확인.

### SC-04: Dangerous Command Denied
- `pre_tool_gate.py`에 `rm -rf /` 명령을 입력하여 HG002 deny를 확인.

### SC-05: Config Change Audit
- ConfigChange 이벤트를 `audit_config_change.py`에 입력하여 audit log 기록을 확인.

### SC-06: Compaction Reinjection
- `reinject_after_compaction.py`를 실행하여 stdout 출력이 비어있지 않음을 확인.

### SC-07: Candidate Approval Gate
- candidate state machine에서 `proposed → applied` 직접 전이가 거부됨을 확인.
- 반드시 `proposed → approved → applied` 경로만 허용.

### SC-08: Schema Drift Rejection
- `event.schema.json`에 정의되지 않은 필드를 포함한 이벤트가 검증 실패하는지 확인.
- `additionalProperties: false` 기반.

## 6. Degraded Fallback

| 조건 | 모드 | 동작 |
|------|------|------|
| hooks 등록 불가 | `rules_only` | rules 파일만으로 동작, hook 강제 없음 |
| file_write 불가 | `manual` | 변경사항을 stdout으로 출력, 사람이 직접 적용 |
| lock 획득 실패 | `report_only` | 보고서만 생성, 파일 변경 없음 |
| schema_validate 불가 | `relaxed` | 스키마 검증 skip, 경고 기록 |

## 7. Report Generation

부트스트랩 완료 시 `.agent/harness/reports/` 아래에 실행 보고서를 생성한다.
템플릿: `RUN_REPORT.template.md`

보고서 필수 필드:
- run_id, timestamp, adapter, automation_level
- degraded_mode, changes_planned, changes_applied
- confirmations, failures
- events_total, deny_count, ask_count, allow_count
- self_check_results
