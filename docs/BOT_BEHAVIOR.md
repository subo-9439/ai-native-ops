# 봇 자가 동작 명세 (BOT_BEHAVIOR)

> 프로젝트매니저#2209 봇이 **무엇을, 언제, 어떻게** 스스로 동작하는지의 단일 출처(SSOT).
> 슬래시 커맨드 사양은 `DISCORD_BOT.md`, 운영 전체 그림은 `OPS_OVERVIEW.md` 참조.

## 1. 기동 체인

```
CEO 입력
  └─ project-manager/start.sh                     (caffeinate + 3 백그라운드)
        ├─ discord-bot/start-local.sh              ← 본 문서 대상
        │     ├─ env 로드 (project-manager/.env > whosbuying/.env)
        │     ├─ pgrep -f "discord-bot/index.js$"  → 기존 PID grace kill (TERM 5s → KILL)
        │     └─ exec node index.js
        ├─ docs-wiki/start-local.sh
        └─ management-gateway/start-local.sh
```

**중요 — 재기동 신뢰성 (2026-04-20 OPS8)**
`start-local.sh`가 기존 PID를 직접 종료한다. 이전엔 kill 로직이 없어 `start.sh` 재실행해도 stale 봇이 살아남는 사고가 있었다(50시간 stale, OPS3~6 수정이 메모리 미반영).
재기동 후 새 PID 확인: `pgrep -f "discord-bot/index.js$"`.

## 2. 부팅 직후 동작 (clientReady)

순서대로:

1. `recoverStaleItems()` — work-queue.json에서 in_progress 상태로 남은 stale 항목을 failed로 복구. 복구 ID는 콘솔 + #alerts embed에 표시.
2. `loadQueue()` — 큐 통계(total/done/in_progress/pending) 계산.
3. `sendOnlineNotice()` — `#🚨-alerts` 채널에 🟢 **프로젝트매니저 온라인** embed 발사.
   - 필드: 커밋 SHA(dirty 여부), 큐 통계, stale 복구 건수+ID, 시각(KST).
   - 실패해도 본체 동작 유지 (try/catch).
4. 슬래시 커맨드 등록은 별도(`register-commands.js`) — 자동 안 함.

**진단 신호**
- `#alerts`에 embed가 안 뜨면 → `index.js`가 로드 실패했거나 봇이 안 떠 있음.
- 떠 있는데 stale 복구 건수가 0이 아니면 → 직전 종료가 비정상.

## 3. 이벤트 핸들러 (런타임)

| 이벤트 | 위치 | 트리거 조건 | 동작 |
|---|---|---|---|
| `interactionCreate` | index.js:180 | 슬래시 커맨드 호출 | `/dev`, `/dispatch` 등 라우팅 |
| `messageCreate` | index.js:207 | DM / AGENT_CHANNELS / CEO_CHANNEL 메시지 | Claude 에이전트 실행 후 스레드/채널에 결과 embed |
| `messageReactionAdd` | index.js:443 | 🤖 이모지 추가 | 해당 메시지 재디스패치 |
| `error` / `unhandledRejection` | 756/757 | 런타임 예외 | 콘솔 로그만 (재시작 안 함) |

**채널 매핑**
- `⚡-dev` → 통합 개발 에이전트
- `💬-잡담` → 잡담 컨텍스트
- `👔-ceo기획실` (env `CEO_CHANNEL_NAME`) → CEO 기획 어드바이저 + BE/FE/AI 병렬 디스패치

## 4. `<<START_QUEUE>>` 처리

**용도**: CEO 채팅에서 큐 진행 트리거.

**동작 (index.js:280, 331)**
1. CEO 응답 텍스트에 `<<START_QUEUE>>` 포함 감지.
2. 텍스트에서 태그 제거 후 embed 표시.
3. `peekNext()` 결과:
   - **pending 아이템 있음** → `pickNext()` + 디스패치.
   - **pending 0** → ⚠️ 경고 reply ("큐에 pending 아이템 없음 — 채팅 텍스트는 append되지 않습니다") + 런북 경로 안내.

**중요한 한계 (설계 결함이 아닌 의도)**
태그는 기존 pending만 pick한다. 채팅에서 새 PR을 큐에 **append하지 않는다**.
큐에 새 아이템 넣으려면:
- (A) `project-manager/work-queue.json` Bash 직접 편집 → `<<START_QUEUE>>`
- (B) #dev 채널에 `---FE---` 블록 직접 전송 (단건 디스패치)

런북: `docs/INCIDENT_QUEUE_APPEND_MISSING.md`.

## 5. 보조 백그라운드

| 모듈 | 용도 | 갱신 주기 |
|---|---|---|
| `alerts-watcher.js` | 게임 서버 헬스체크 + #alerts 발신 | 폴링 |
| `sync-poller.js` | terminal/dev 세션 → claude-sync 이벤트 적재 | 폴링 |
| `interaction-server.js` | HTTP `/queue/start` 등 외부 트리거 | 상시 |
| `pre-tool-gate.js` | Claude Tool 실행 전 권한/민감경로 검증 | 호출 시 |

## 6. 종료 동작

- `SIGTERM` 수신 시 → discord.js 클라이언트 종료 + Node 프로세스 exit (graceful).
- `start-local.sh`의 kill 로직이 TERM 후 5초 대기 → 미응답 시 KILL.
- `caffeinate -w $$` 덕분에 `start.sh` 셸이 죽으면 슬립 방지도 함께 해제.

## 7. 알려진 사고 이력

| 날짜 | 증상 | 원인 | 영구 대응 |
|---|---|---|---|
| 2026-04-20 | OPS3~6 수정이 봇 메모리에 미반영 | start-local.sh에 기존 PID kill 로직 없음 | OPS8 — start-local.sh에 grace kill 추가 |
| 2026-04-20 | `<<START_QUEUE>>`로 새 PR 큐 적재 시도했으나 디스패치 안 됨 | 태그는 pick만 함, append 로직 없음 | OPS3(런북) + OPS4(프롬프트 규칙) + OPS5(pending 0 경고 reply) |

## 8. 검증 체크리스트

봇 코드 변경 후:
1. `bash -n discord-bot/start-local.sh` (syntax)
2. `node --check discord-bot/index.js` (syntax)
3. 기존 PID 확인: `pgrep -f "discord-bot/index.js$"`
4. `bash project-manager/start.sh` 재실행
5. `pgrep -f "discord-bot/index.js$"` → **새 PID로 바뀌었는지** 확인
6. `#alerts` 채널 → 🟢 온라인 embed 도착 확인
7. CEO 스레드에 `<<START_QUEUE>>` 트리거 → pending 0이면 ⚠️ 경고 reply 확인
