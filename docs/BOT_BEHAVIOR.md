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
| 2026-05-04~05 | `/plan`, plan-check, agent-config.js 등 신규 코드가 봇에 미반영 | `lsof -ti :4040 \| xargs kill -9` 가 빈 결과 시 사일런트 실패 → 옛 봇이 40h 살아남 | PR-OPS-RESTART1 — `restart-local.sh` 신설 + post-commit hook 자동 호출 |

## 8. 검증 체크리스트

봇 코드 변경 후:
1. `bash -n discord-bot/start-local.sh` (syntax)
2. `node --check discord-bot/index.js` (syntax)
3. **재기동**: `bash discord-bot/restart-local.sh` (PID 검증 + 헬스 200 대기까지 자동)
4. 새 PID 확인: `lsof -ti :4040`
5. `#🚨-alerts` 채널 → 🟢 온라인 embed 도착 확인
6. CEO 스레드에 `<<START_QUEUE>>` 트리거 → pending 0이면 ⚠️ 경고 reply 확인

## 9. 코드 변경 → 봇 반영 자동 워크플로 (PR-OPS-RESTART1)

### 9.1 핵심 원칙

봇 코드(`.js`, `start-local.sh`, `restart-local.sh`)를 변경했다면 **반드시 안전 재기동**한다.

> **절대 금지**: 단순 `lsof | xargs kill` 패턴. 빈 결과 시 사일런트 실패하여 옛 봇이 살아남는다.
> 2026-05-04~05 사고: 옛 봇이 40h 떠있어 신규 슬래시 명령(`/plan`)이 반영 안 된 채 사용자 보고 발생.

### 9.2 안전 재기동 — `restart-local.sh`

```bash
bash discord-bot/restart-local.sh
```

| 단계 | 동작 | 실패 시 |
|---|---|---|
| 1 | `lsof -ti :4040` 로 PID 조회 + uptime 출력 | 봇 미기동 시 (free) 메시지 후 정상 진행 |
| 2 | `kill -9 PID` 후 max 5초 종료 검증 | exit 1 (옛 PID 안 죽음) |
| 3 | `start-local.sh` 백그라운드 기동 | — |
| 4 | `/health 200` 까지 max 15초 대기 | exit 2 (부팅 timeout) |
| 5 | 새 PID + 소요 시간 보고 | — |

환경변수: `BOT_HTTP_PORT=4040`, `BOT_LOG_FILE=/tmp/discord-bot.log`,
`BOT_KILL_TIMEOUT=5`, `BOT_BOOT_TIMEOUT=15`.

### 9.3 자동화 — git post-commit hook

**1회 설치** (사용자 직접 실행 필요 — 자동 install 차단됨):
```bash
bash scripts/install-hooks.sh
```

`git config core.hooksPath = scripts/git-hooks` 설정. 이후 `git commit` 시점에
`scripts/git-hooks/post-commit` 가 실행되어:

- 마지막 commit 변경 파일에 `discord-bot/*.js` 또는 `*.sh` 가 있으면 `restart-local.sh` 자동 호출
- `*.md` / `docs/` / `package-lock.json` 만 변경된 경우 skip
- 봇이 미기동 상태(port 4040 free)면 skip — 자동 기동 부담 없게
- 우회 (긴급): `SKIP_BOT_RESTART=1 git commit ...`
- 영구 해제: `git config --unset core.hooksPath`

### 9.4 Claude/AI 에이전트 행동 규칙

이 저장소에서 봇 코드를 수정하는 Claude/AI 에이전트는 다음을 자발적으로 따른다:

1. `discord-bot/*.js` 또는 `start-local.sh`/`restart-local.sh` 를 변경 후 commit 했다면
2. **반드시 `bash discord-bot/restart-local.sh` 를 호출**하여 새 코드 반영을 확인
3. exit 0 (헬스 200) 이 아니면 그 commit 의 변경이 운영에 반영 안 된 것 — 사용자에게 즉시 보고
4. post-commit hook 가 설치되어 있다면 자동 실행되지만, hook 미설치 환경에서도 위 호출은 의무

### 9.5 검증 명령

```bash
# 자동 hook 동작 확인 (변경 0 → skip)
git commit --allow-empty -m "test hook noop"

# 수동 확인 (현재 떠있는 봇 검증)
lsof -ti :4040                          # PID 1개 출력
ps -p $(lsof -ti :4040) -o etime=       # uptime — 코드 변경 후 짧아야 정상
```
