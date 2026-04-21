# 하네스 상태 요약

버전: 1.0.0
갱신일: 2026-04-08

## 핵심 정책
- 증거 없는 심볼/API 추천 금지 (evidence-gate)
- 승인 전 자동 반영 금지 (confirmation-gate)
- 민감 경로 접근 금지 (repo-security-gate + pre_tool_gate.py)
- 변경 전 스캔, 변경 후 self-check
- 설명보다 파일/패치/검증 우선
- degraded/manual fallback 허용

## 활성 hooks (7 이벤트)
- PreToolUse: pre_tool_gate.py, event_logger.py
- PostToolUse: event_logger.py
- PostToolUseFailure: event_logger.py
- ConfigChange: audit_config_change.py, event_logger.py
- PreCompact: event_logger.py
- PostCompact: reinject_after_compaction.py
- SessionStart: event_logger.py, reinject_after_compaction.py

## 상태 머신
draft → evidence_checked → proposed → approved → applied → monitored → stable

## 실패 코드
- HG001: 민감 경로 거부
- HG002: 파괴 명령 거부
- HB001~005: 부트스트랩 실패
- HS001: 스키마 drift
- HR001: compaction 필요
