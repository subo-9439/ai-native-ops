# 하네스 실행 보고서

## 기본 정보
- **run_id**: `{run_id}`
- **timestamp**: `{timestamp}`
- **adapter**: `{adapter}`
- **automation_level**: `{automation_level}`
- **degraded_mode**: `{degraded_mode}`

## 변경 요약
- **changes_planned**: {changes_planned}
- **changes_applied**: {changes_applied}

## 승인 이력
| 항목 | 상태 | 승인자 |
|------|------|--------|
{confirmations}

## 실패 목록
| 코드 | 메시지 | 파일 |
|------|--------|------|
{failures}

## 이벤트 통계
- **events_total**: {events_total}
- **deny_count**: {deny_count}
- **ask_count**: {ask_count}
- **allow_count**: {allow_count}

## Self-Check 결과
| # | 시나리오 | 결과 |
|---|----------|------|
| SC-01 | Bootstrap Idempotency | {sc01} |
| SC-02 | Lock Collision | {sc02} |
| SC-03 | Sensitive Path Denied | {sc03} |
| SC-04 | Dangerous Command Denied | {sc04} |
| SC-05 | Config Change Audit | {sc05} |
| SC-06 | Compaction Reinjection | {sc06} |
| SC-07 | Candidate Approval Gate | {sc07} |
| SC-08 | Schema Drift Rejection | {sc08} |

## 수동 후속 조치
{next_manual_steps}
