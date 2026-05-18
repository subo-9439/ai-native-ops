# 자동 복구 게이트 (auto-recovery-gate)

> **rules만으로는 충분하지 않다.** 이 규칙은 `scripts/audit-bot-health.sh` +
> `scripts/audit-game-health.sh` + `scripts/auto-fix-dispatcher.sh` + launchd plist
> 3개 (`com.nolza.discord-bot` / `audit-bot` / `audit-game`) 와 함께 동작한다.
> rules는 Claude가 자발적으로 따르는 지침, scripts/launchd 는 시스템이 강제하는 자동 복구.

## 원칙

운영 / 게임 서비스가 다운되면 **3-layer 자동 복구** 로 대응한다.

- **L1 (launchd, cost 0)**: 봇/서비스 단순 crash → `KeepAlive` + `ThrottleInterval=10` 으로 10초 후 자동 재시작.
- **L2 (Codex 진단, ChatGPT 구독)**: 영구 사고 (3 cycle = 15분 연속 다운) → `audit-bot-health.sh` 가 로그 tail + `bin/codexw exec` 호출 → ops-errors / game-errors Discord 채널 송신.
- **L3 (Claude 자동 fix, Anthropic API)**: L2 진단이 fix 가능 판단 → `auto-fix-dispatcher.sh` 가 sub-agent 위임 → commit + push.

## 채널 분리 (PR-CHANNEL-SPLIT)

| 채널 | 영역 | 환경변수 | Fallback |
|------|------|----------|----------|
| `#ops-errors` | Discord 봇 / 배포 / launchd / 인프라 | `DISCORD_OPS_ERRORS_WEBHOOK` | `DISCORD_ALERTS_WEBHOOK` |
| `#game-errors` | BE actuator / nolza.org / client-error | `DISCORD_GAME_ERRORS_WEBHOOK` | `DISCORD_ALERTS_WEBHOOK` |
| `#🚨-alerts` (legacy) | 분류 안 된 알림 | `DISCORD_ALERTS_WEBHOOK` | (없음 — skip) |

운영 webhook 변수 부재 시 자동으로 alerts 로 fallback → backward compat.

## 무한 루프 차단 (필수)

같은 사고 패턴 (log signature SHA-1) 이 **3회 연속** 진단되면 자동 복구 **stop**:

- `audit-bot-health.sh` / `audit-game-health.sh` 가 state 파일에 `last_pattern_hash` + `pattern_repeat_count` 저장
- repeat == 3 → 사용자 escalation 알림 1회 + 다음 cycle 부터 진단 skip (healthy 로 회복 시 자동 리셋)
- `auto-fix-dispatcher.sh` 도 동일 — 같은 fix 시도 3회 실패 시 stop

State 파일 (gitignored):

- `.agent/harness/memory/auto-recovery-bot-state.json`
- `.agent/harness/memory/auto-recovery-game-state.json`
- `.agent/harness/memory/auto-recovery-fix-state.json`
- `.agent/harness/memory/auto-recovery-cost.jsonl` (Codex / Claude 호출 누적)

## L1 정책 (launchd 자동 재가동)

- 적용 대상: Discord 봇 (`com.nolza.discord-bot.plist`)
- `KeepAlive.SuccessfulExit=false` + `NetworkState=true`
- `ThrottleInterval=10` (영구 사고 시 10초 간격 throttle 로 무한 루프 자동 차단)
- 셋업: `bash project-manager/scripts/install-launchd.sh discord-bot`

## L2 정책 (Codex 진단 + 채널 알림)

- 적용 대상: 봇 + 게임 서비스
- 트리거: 5분 cron (launchd StartInterval=300)
- 진단 조건: `consecutive_fail >= 3` (= 15분 연속 다운)
- Codex 호출: `bin/codexw exec` — 한국어 5항목 강제 (codexw wrapper)
- 비용 추적: 매 호출 시 `auto-recovery-cost.jsonl` append
- Cost limit: **없음 (사용자 명시)**. 단 같은 패턴 3회 차단으로 무한 루프 방지.
- 실패 처리: Codex 호출 실패 시 graceful skip + warning (fatal X)

## L3 정책 (Claude 자동 fix PR)

- 적용 대상: L2 가 fix 가능 판단한 사고
- Heuristic: Codex 진단에 "fix" / "수정" / "추가" + 파일 경로 명시 키워드 포함
- 호출: `bin/claudew` sub-agent (general-purpose) 위임
- 결과: sub-agent 가 fix commit + push → 새 commit 의 post-commit hook 이 Codex 재검수
- 차단: 같은 사고 같은 fix 패턴 3회 시도 실패 시 stop

## L4 정책 (자동 배포 — PR-DEPLOY-AUTO-PULL)

- 적용 대상: **배포 머신 (이 Mac) 전용**. 다른 개발 환경엔 미설치.
- 트리거: 5분 cron (launchd `com.nolza.auto-deploy`, StartInterval=300)
- 동작: `git ls-remote origin main` 1줄 비교 → 로컬과 다르면 `git pull --ff-only` → `deploy-web.sh`
- idle 비용 ≈ 0 (commit 없으면 ls-remote 1요청 후 종료)
- 안전: `/tmp/nolza-auto-deploy.lock` PID 락 + dirty tree 시 pull 보류 + 같은 sha 배포 3회 실패 시 stop
- state: `.agent/harness/memory/auto-deploy-state.json` (gitignored)
- 알림: ops-errors webhook (없으면 alerts fallback) — 성공/실패/stop
- 끄기: `launchctl unload ~/Library/LaunchAgents/com.nolza.auto-deploy.plist` 또는 `install-launchd.sh auto-deploy-off`
- 원칙: 작업 환경은 어디든 / 배포 환경은 이 Mac 고정 (사용자 지시 2026-05-16)

## 답변 검증 표현

자동 복구 작업 변경 시:

- ✅ `자동 복구 검증 완료: L1 ✓ / L2 무한루프 차단 ✓ / L3 fix 패턴 차단 ✓ / 채널 분리 ✓ / cost 추적 ✓`
- ⚠️ `자동 복구 일부 보류: <항목> 사유 + 후속 PR`

## 사용자 손 차단 (사전 1회)

1. Discord 채널 2개 신규 (`#ops-errors` + `#game-errors`)
2. 각 webhook URL 2개 생성 → `.env` 또는 `~/.claude-sync/discord-{ops|game}-errors-webhook` 저장
3. GitHub repo Secrets 에 `DISCORD_OPS_ERRORS_WEBHOOK` / `DISCORD_GAME_ERRORS_WEBHOOK` 등록 (health-check.yml 용)
4. launchd 설치: `bash project-manager/scripts/install-launchd.sh discord-bot audit`

위 4개 처리되면 L1/L2/L3 자동 동작.

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 | Claude 자발적 인지 + 정책 SSOT |
| L2 — Scripts | `scripts/audit-{bot,game}-health.sh` + `auto-fix-dispatcher.sh` | 실행 + 무한 루프 차단 |
| L3 — Launchd | `~/Library/LaunchAgents/com.nolza.{discord-bot,audit-bot,audit-game}.plist` | OS 레벨 자동 트리거 |

세 계층 중 하나라도 실패 시 graceful warning (운영 가능성 우선 — operational-workflow-gate 6조).

## 비용 누적 보고 (매시간)

`auto-recovery-cost.jsonl` 의 누적 출력 길이를 매시간 ops-errors 채널에 embed 송신.
구체 메커니즘은 L3 dispatcher 의 `--report-cost` flag 또는 별 cron 잡으로 후속.

## 위반 시

- L1: Claude 자발적으로 다음 응답에 자가 보고 + 무한 루프 차단 누락 fix
- 사후 발견 시: state 파일에 같은 hash 4회 이상 발견 시 인시던트 보고
