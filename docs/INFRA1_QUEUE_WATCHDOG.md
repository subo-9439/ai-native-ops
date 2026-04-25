# PR-INFRA1 — Queue Watchdog 런북

> Discord 봇이 `work-queue.json` 의 `in_progress` 아이템을 5분마다 폴링해
> stale(무응답) 상태를 자동 감지·알림한다. **auto-fail 은 하지 않는다**(human-in-loop).

## 배경

`work-queue.js::recoverStaleItems` 는 봇 재시작 시점에만 stale 을 복구한다.
봇이 살아있는 동안 dev 에이전트가 30~60분 무응답으로 멈추면 운영자는
디스코드를 새로고침해 가며 직접 확인해야 했다 (2026-04-25 OBS1a/1b 사고).

CEO 결정(2026-04-25 decisions.md): "장기적으로 시스템적으로 고치고 싶다" → PR-INFRA1.

## 모듈

| 파일 | 역할 |
|------|------|
| `discord-bot/queue-watchdog.js` | 5분 인터벌, 큐 폴링, alerts embed 전송 |
| `discord-bot/index.js` (clientReady) | 기동 시 watchdog 시작 |

## 설정

환경변수로 임계값을 조정한다 (없으면 기본값).

| 변수 | 기본 | 설명 |
|------|------|------|
| `QUEUE_WATCHDOG_INTERVAL_MS` | 300_000 (5분) | 폴링 주기 |
| `QUEUE_WATCHDOG_WARN_MS` | 900_000 (15분) | 1차 경고 임계값 |
| `QUEUE_WATCHDOG_CRIT_MS` | 1_800_000 (30분) | critical 알림 임계값 |
| `ALERTS_CHANNEL_NAME` | `🚨-alerts` | 알림 채널 이름 (`alerts-watcher` 와 공유) |
| `ALERTS_GUILD_ID` | nolza guild | 길드 ID |

## 알림 동작

각 `in_progress` 아이템에 대해 `elapsed = now - startedAt`:

1. `elapsed >= 15분` && `!warnedAt` → 노란색 embed 1회 + `warnedAt` 기록
2. `elapsed >= 30분` && `!escalatedAt` → 빨간색 embed 1회 + `escalatedAt` 기록

같은 아이템은 각 단계당 1회만 알림이 간다(`warnedAt`/`escalatedAt` 으로 dedup).
필드는 `work-queue.json` 의 아이템 객체에 추가 저장된다 — 다른 코드는 무시한다.

## 운영자 대응 가이드

알림이 오면:

| 상태 | 판단 | 액션 |
|------|------|------|
| 정상이지만 오래 걸리는 작업 | 무시 | 그대로 둠 |
| dev 에이전트 무응답 | 큐 중지 | `!큐중지` → 단건 디스패치로 잇거나 어드바이저 직접 작성 |
| 즉시 다음 아이템으로 진행 | failed 처리 | `work-queue.json` 의 status `in_progress → failed` 후 `!큐시작` |

## auto-fail 을 하지 않는 이유

- 정상 빌드/테스트/배포가 30분 넘기는 케이스가 실제로 존재 (BE 통합테스트 + 도커 부팅 포함 시).
- auto-fail 하면 정상 진행 중인 작업이 강제 종료된다 — 데이터 손실 위험.
- 알림은 cheap, 종료는 expensive. 사람이 결정한다.

## 검증

로컬에서 dry-run:

```bash
cd project-manager/discord-bot
node -e "
const w = require('./queue-watchdog');
const fakeClient = { guilds: { fetch: async () => ({ channels: { fetch: async () => {}, cache: { find: () => null } } }) } };
w.checkOnce(fakeClient, { warnMs: 15*60*1000, critMs: 30*60*1000 });
"
```

`work-queue.json` 에 35분 전 startedAt 인 in_progress 아이템을 잠시 추가하고
실행하면 `escalatedAt` 필드가 자동 기록된다 (검증 후 원복 필수).

봇 재시작 후 `clientReady` 로그에서 `[QueueWatchdog] 시작 — interval=...` 라인
확인되면 정상.

## 관련 결정

- 2026-04-25 decisions.md: PR-INFRA1 (A안: 어드바이저 직접 작성)
- 2026-04-26 decisions.md: PR-OBS1c 어드바이저 직접 작성 + 그 다음 PR-INFRA1
