# project-manager

`whosbuying` 게임 프로젝트의 **운영 도구 모음**.
프로젝트 본체(게임 서버, Flutter 앱)와 분리된, 운영을 감싸는 관리 레이어.

> 🌐 운영 진입점: **https://admin.nolza.org**
> 🤖 Discord: 프로젝트매니저#2209
> 🖥️ 호스트: 맥북 (`/Users/kimsubo/Desktop/game-project/`) — Cloudflare Tunnel로 외부 노출

---

## 📐 아키텍처 한눈에

```
[Browser]                                  [Discord 사용자]
   │                                              │
   ▼                                              ▼
https://admin.nolza.org                      Discord Gateway (WS)
   │ (Cloudflare Tunnel)                          │
   ▼                                              ▼
┌──────────────────────────┐         ┌────────────────────────────┐
│  management-gateway      │         │  discord-bot               │
│  :4000  (공개)           │  ◀───── │  :4040  (HTTP, 로컬)       │
│  - 로그인/세션 (12h)     │ /auth/  │  - Gateway WebSocket       │
│  - /admin/wiki 프록시    │   sso   │  - 슬래시 커맨드 8개       │
│  - SSO 토큰 발급         │ ─────▶  │  - 채널별 Claude 라우팅    │
│  - /queue 대시보드       │         │  - work-queue 폴링         │
└─────────┬────────────────┘         └──────────┬─────────────────┘
          │ (내부 only)                         │
          ▼                                     ▼
┌──────────────────────────┐         ┌────────────────────────────┐
│  docs-wiki               │         │  whosbuying/               │
│  :4050  (내부)           │         │  - CLAUDE.md (헌장)        │
│  - md → HTML 렌더링      │         │  - docs/memory-bank/       │
│  - 사이드바 검색/카테고리│         │  - .ops/context.jsonl      │
└──────────────────────────┘         │  - 게임 서버 / Flutter 앱  │
                                     └────────────────────────────┘
```

---

## 🗂️ 디렉토리 구조

```
project-manager/
├── discord-bot/             ← 슬래시 커맨드 + 채널 메시지 핸들러 (:4040)
├── docs-wiki/               ← Markdown 위키 (:4050, 내부)
├── management-gateway/      ← 인증 + 위키 프록시 + 큐 대시보드 (:4000, 공개)
├── harness-kit/             ← 신규 프로젝트 init 템플릿 (운영 외 자산)
├── docs/                    ← 운영 도구 문서 (10개)
├── start.sh                 ← 3개 동시 실행 + caffeinate
├── channel-config.json      ← 채널별 Claude 모델 매핑
├── .admin-credentials.json  ← gateway 로그인 자격증명 (gitignore)
├── work-queue.json          ← 봇 작업 큐 (런타임 파일)
└── .env / .env.example      ← 환경변수
```

---

## 🚀 빠른 시작

```bash
bash project-manager/start.sh
```

3개 서비스(`gateway:4000` + `bot:4040` + `wiki:4050`) + `caffeinate -i -s` (시스템 슬립 차단)이 함께 뜬다.
종료는 `Ctrl+C` 또는 셸 종료 — `caffeinate`도 같이 죽는다.

### 개별 실행

```bash
cd discord-bot          && bash start-local.sh
cd docs-wiki            && bash start-local.sh
cd management-gateway   && bash start-local.sh
```

### 헬스체크

```bash
curl http://127.0.0.1:4000/health    # gateway
curl http://127.0.0.1:4040/health    # bot
curl http://127.0.0.1:4050/health    # wiki
curl https://admin.nolza.org/health  # 외부 (Cloudflare 경유)
```

### macOS 재부팅 시 자동 실행 (launchd)

plist는 이미 `~/Library/LaunchAgents/com.nolza.ops.plist` 에 등록 준비됨 (nvm node 경로 포함, KeepAlive=SuccessfulExit:false, ThrottleInterval=10s).

#### ⚠️ 사전 작업 — Full Disk Access (TCC) 부여

macOS Catalina+ 부터 launchd Aqua agent는 기본적으로 `~/Desktop` 접근이 차단됨 (`Operation not permitted`). 한 번만 수동 설정 필요:

1. **시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한**
2. `+` 버튼 → `⌘ + Shift + G` → `/bin/bash` 입력 → 추가
3. (있다면) 같은 화면에서 `bash` 토글 ON

대안: 프로젝트를 `~/Desktop` 밖 (예: `~/Code/game-project`)으로 이동하면 TCC 적용 안 받음.

#### 등록 / 해제

```bash
launchctl load   ~/Library/LaunchAgents/com.nolza.ops.plist   # 등록 (RunAtLoad → 즉시 시작)
launchctl unload ~/Library/LaunchAgents/com.nolza.ops.plist   # 해제
launchctl list   com.nolza.ops                                # 상태 (LastExitStatus 0이면 OK)
```

#### 검증

```bash
tail -f /Users/kimsubo/Desktop/game-project/project-manager/ops.err.log   # 에러 모니터
curl https://admin.nolza.org/health
```

`Operation not permitted` 에러가 ops.err.log에 보이면 TCC 단계가 빠진 것. 다시 위 절차 확인.

---

## 🤖 discord-bot — 프로젝트매니저#2209

### 슬래시 커맨드 (9개)

`discord-bot/register-commands.js`에서 정의, 슬래시 커맨드 등록 1회 또는 변경 시 다시 실행.

| 커맨드 | 설명 | 구현 |
|---|---|---|
| `/game-server-status` | 🎮 게임 서버 상태 조회 (`GAME_SERVER_URL` 호출) | `commands/status.js` |
| `/game-rooms` | 🎮 활성 방 목록 | `commands/rooms.js` |
| `/close-room <code>` | 🎮 방 강제 종료 (`ADMIN_API_KEY` 필요) | `commands/close-room.js` |
| `/deploy <web\|android>` | 🚀 GitHub Actions 배포 트리거 (`GITHUB_PAT` 필요) | `commands/deploy.js` |
| `/dev <message>` | ⚡ 통합 개발 에이전트 — 스레드 생성 + Claude CLI 실행 | `commands/claude.js` |
| `/skill <name> [target]` | 🛠️ 프리셋 스킬: `review` / `sprint` / `pr` / `test` / `explain` | `commands/claude.js` |
| `/dispatch <directive>` | 👔 BE/FE/AI 멀티에이전트 — **plan-check 후 ✅/❌ 승인 시 실행** | `commands/claude.js` |
| `/plan <task>` | 📋 **계획만 수립 (read-only, 코드 변경 없음)** — 영향 파일/단계/위험/예상 시간 양식 출력 | `commands/claude.js` (PR-PLAN1) |
| `/docs` | 📚 위키 자동 로그인 링크 (gateway에 SSO 토큰 발급 → 5분 일회용) | `commands/docs.js` |

### 🆕 Plan-first 게이트 (PR-PLAN1)

**`/plan`** — 사용자가 명시적으로 계획만 받고 싶을 때.
- Claude CLI 를 `--allowedTools "Read,Glob,Grep,WebFetch,Bash(git diff:*)..."` 로 호출 → 코드 변경 도구 차단
- system prompt 에 양식 강제: 🎯 목표 / 📂 영향 파일 / 🪜 단계 / ⚠️ 위험 / 🧪 검증 / ⏱ 예상 시간
- 결과는 별도 스레드에 출력. 실제 실행은 별도 명령으로.

**`/dispatch` plan-check 게이트** — 멀티에이전트 디스패치는 즉시 실행 대신:
1. 봇이 plan-check (read-only Claude) 한 번 실행
2. embed 출력 + `✅ 이대로 디스패치` / `❌ 취소` 버튼
3. 사용자 클릭 → 진행 또는 취소 (10분 무응답 시 자동 취소)

**Bypass** — 메시지에 `auto:` prefix 또는 `[no-plan]` 키워드 포함 시 plan-check 스킵하고 즉시 실행. 긴급 디스패치용.

**적용 안 되는 곳** — 큐 자동 체이닝, `/dev` 단일 명령, `/skill` 프리셋 (이미 좁은 작업 범위라 plan 불필요).

### 채널 구성

```
nolza-dev/
├── #👔-ceo기획실   ← 기획 대화 + 디스패치
├── #⚡-dev          ← 통합 개발 에이전트
├── #💬-잡담         ← 범용
├── #🔍-pr-리뷰
├── #🚀-배포-로그
└── #📢-공지
```

**`#👔-ceo기획실` 두 가지 모드**

- **대화 모드** — 일반 메시지 → Claude가 기획 어드바이저로 응답 (`sonnet`)
- **디스패치 모드** — `---BE---` / `---FE---` / `---AI---` 섹션 포함 시 병렬 작업 명령

```
로비에 채팅 기능 추가

---BE---
WebSocket STOMP /topic/rooms/{code}/chat 구현

---FE---
로비 화면에 채팅 위젯 추가
```

**`#⚡-dev` 통합 개발 에이전트** — 메시지 → 스레드 자동 생성 → Claude CLI 실행 → 결과 포스팅. 스레드 안 follow-up 시 이전 대화 자동 컨텍스트 포함.

### 채널별 Claude 모델 (`channel-config.json`)

```json
{
  "defaults": { "model": "sonnet" },
  "roles": {
    "dev":          { "model": "opus",   "note": "통합 개발 — 복잡한 코드" },
    "ceo":          { "model": "sonnet", "note": "기획 어드바이저" },
    "backend-dev":  { "model": "opus" },
    "frontend-dev": { "model": "opus" },
    "ai-dev":       { "model": "opus" },
    "잡담":         { "model": "haiku",  "note": "가벼운 대화" }
  }
}
```

지원 모델: `opus` (claude-opus-4-6) · `sonnet` (claude-sonnet-4-6) · `haiku` (claude-haiku-4-5).
파일 수정 즉시 다음 실행부터 반영 (봇 재시작 불필요). 결과 메시지에 사용 모델 표시.

### 메모리 시스템 (5-Layer)

| Layer | 위치 | 역할 |
|---|---|---|
| L0 — CLAUDE.md | `whosbuying/CLAUDE.md` | 정적 헌장 (Claude CLI 자동 로드) |
| L1 — Memory-Bank | `whosbuying/docs/memory-bank/` | 🔥 공용 화이트보드 (CEO+Dev 양방향) |
| L2 — Ops Log | `whosbuying/.ops/context.jsonl` | 단기 RAM (최근 10건) |
| L3 — Thread Context | Discord API | 스레드 follow-up 히스토리 (최근 15) |
| L4 — CHANGELOG | `whosbuying/docs/CHANGELOG.md` | 영구 인간 가독 기록 |

**L1 memory-bank 4파일**:
- `activeContext.md` — 현재 포커스, 다음 단계
- `progress.md` — 기능별 진행 상태
- `decisions.md` — CEO 결정사항 (append-only)
- `systemPatterns.md` — 코드 패턴

### `discord-bot/` 파일 구조

```
discord-bot/
├── index.js                  ← 메인 (Gateway + HTTP :4040, ~39KB)
├── interaction-server.js     ← Cloudflare Worker 포워딩 수신 (HTTP)
├── context-manager.js        ← 5-Layer 컨텍스트 조립
├── changelog-manager.js      ← CHANGELOG.md 자동 갱신
├── setup-channels.js         ← 채널 토픽/핀 일괄 셋업 스크립트
├── commands/
│   ├── claude.js             ← /dev, /skill, /dispatch
│   ├── status.js             ← /game-server-status
│   ├── rooms.js              ← /game-rooms
│   ├── close-room.js         ← /close-room
│   ├── deploy.js             ← /deploy (GitHub Actions)
│   └── docs.js               ← /docs (SSO 자동 로그인 링크)
├── register-commands.js      ← 슬래시 커맨드 등록 (초기 1회/변경 시)
├── start-local.sh
└── Dockerfile
```

---

## 🔐 management-gateway — 관리 게이트웨이

운영 도구 단일 진입점 + 인증.

### 라우트 (실제)

| Method | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET  | `/`                  | -      | `/admin/wiki` 로 리디렉션 |
| GET  | `/admin/login`       | -      | 로그인 폼 |
| POST | `/admin/login`       | -      | 자격증명 검증 → 세션 쿠키 발급 (12h) |
| GET  | `/admin/logout`      | 세션   | 세션 폐기 |
| GET  | `/admin/wiki/*`      | 세션   | 위키 프록시 (`X-Forwarded-Prefix` 헤더 주입) |
| POST | `/auth/sso`          | 시크릿 | Discord 봇 → SSO 토큰 발급 (5분 일회용) |
| GET  | `/admin/sso?token=…` | 토큰   | SSO 토큰 → 세션 교환 |
| GET  | `/queue`             | -      | 큐 대시보드 페이지 |
| GET  | `/queue/data`        | -      | 큐 JSON (대시보드 폴링용) |
| GET  | `/health`            | -      | 헬스체크 |

### 인증 흐름

- **브라우저** — `https://admin.nolza.org/admin/wiki` → 로그인 폼 → `.admin-credentials.json` (해시) 검증 → 세션 쿠키 (12시간)
- **Discord** — `/docs` 슬래시 커맨드 → 봇이 `POST /auth/sso` 호출 → 5분짜리 일회용 토큰 받음 → `https://admin.nolza.org/admin/sso?token=…` 링크 발급 → 클릭 시 세션 교환 후 위키로 진입

### 자격증명 파일

`.admin-credentials.json` (project-manager/ 루트, **gitignore + chmod 600**):

```jsonc
{
  "username": "admin",
  "passwordHash": "$2b$12$..."   // bcrypt cost=12
}
```

검증 로직(`management-gateway/index.js` `verifyCredentials`):
- `passwordHash`가 있으면 `bcrypt.compareSync` 사용 (권장)
- `passwordHash`가 없고 `password`(평문)만 있으면 fallback + 경고 로그
  → **마이그레이션 권장**

#### 비밀번호 변경 / 재발급

```bash
node -e "
const bcrypt = require('/Users/kimsubo/Desktop/game-project/project-manager/management-gateway/node_modules/bcryptjs');
const fs = require('fs');
const path = '/Users/kimsubo/Desktop/game-project/project-manager/.admin-credentials.json';
const newPw = process.argv[1];                // ← 인자로 전달
const data = { username: 'admin', passwordHash: bcrypt.hashSync(newPw, 12) };
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
fs.chmodSync(path, 0o600);
console.log('updated, length:', data.passwordHash.length);
" 'NEW_PASSWORD_HERE'
```

> ⚠️ 명령줄 인자는 `ps`/셸 히스토리에 잠시 노출됨. 업무 PC라면 충분하지만, 다인 환경이면 stdin 입력 방식 권장.

게이트웨이는 자격증명을 매 요청마다 파일에서 읽으므로 **재기동 불필요**.

---

## 📚 docs-wiki — 문서 위키 (내부)

`whosbuying/docs/` + `project-manager/docs/` 마크다운을 **하나의 위키**로 브라우징.

- **직접 접속 불가** — 게이트웨이 경유만 (`https://admin.nolza.org/admin/wiki`)
- **내부 포트** — `127.0.0.1:4050` (gateway 전용)
- **카테고리 분리** — 프로젝트 / 🧠 Memory Bank / 운영 도구
- **사이드바 검색**, 최신순/이름순 정렬, 코드 하이라이팅 (highlight.js)
- **prefix 자동 적용** — 게이트웨이가 주입하는 `X-Forwarded-Prefix` 헤더로 모든 내부 링크 prepend

`DOCS_DIR` 환경변수로 다른 프로젝트 docs를 가리킬 수도 있음 (기본: `whosbuying/docs`).

---

## 🌍 환경변수 (`.env`)

`.env`는 `project-manager/.env`에 위치, 모든 컴포넌트가 같은 파일을 source.
`.env.example`에 카논 형태 보존.

| 변수 | 컴포넌트 | 설명 |
|---|---|---|
| `DISCORD_TOKEN` | bot | 봇 토큰 (필수) |
| `DISCORD_CLIENT_ID` | bot | Application ID (필수) |
| `DISCORD_GUILD_ID` | bot | 길드 ID — 슬래시 커맨드 등록 대상 |
| `DISCORD_ALERTS_WEBHOOK` | bot | `#🚨-alerts` 웹훅 (배포/사고 알림). SSOT는 `~/.claude-sync/discord-alerts-webhook` |
| `CEO_CHANNEL_NAME` | bot | 기본 `👔-ceo기획실` |
| `CLAUDE_PROJECT_DIR` | bot, wiki | Claude CLI 작업 디렉토리. 기본 `whosbuying/` |
| `GAME_SERVER_URL` | bot | 게임 서버 베이스 URL. 기본 `http://localhost:8080` |
| `ADMIN_API_KEY` | bot | 게임 서버 admin API 키 |
| `GITHUB_PAT` | bot | GitHub Actions 디스패치용 |
| `GITHUB_REPO` | bot | `owner/repo` 형식 |
| `BOT_HTTP_PORT` | bot | 기본 4040 |
| `BOT_FORWARD_SECRET` | bot | Worker → 봇 포워딩 인증 |
| `GATEWAY_PORT` | gateway | 기본 4000 |
| `WIKI_INTERNAL_URL` | gateway | 기본 `http://127.0.0.1:4050` |
| `BOT_INTERNAL_URL` | gateway | 큐 데이터 폴링용. 기본 `http://127.0.0.1:4040` |
| `PUBLIC_BASE_URL` | gateway, bot | 기본 `https://admin.nolza.org` |
| `GATEWAY_SSO_SECRET` | gateway, bot | `/auth/sso` 인증 시크릿 (양쪽 동일해야 함) |
| `WIKI_PORT` | wiki | 기본 4050 |
| `DOCS_DIR` | wiki | 렌더링 대상 docs 루트. 기본 `$CLAUDE_PROJECT_DIR/docs` |
| `WOL_SECRET` / `WOL_TARGETS` / `PC_MAC` / `PC_PUBLIC_IP` | Cloudflare Worker | Wake-on-LAN. 봇/게이트웨이는 사용 안 함, **Worker가 직접 처리** |

---

## 📖 운영 문서 인덱스 (`docs/`)

| 문서 | 내용 |
|---|---|
| [`OPS_OVERVIEW.md`](docs/OPS_OVERVIEW.md) | 전체 운영 환경 개요 (메인) |
| [`DISCORD_BOT.md`](docs/DISCORD_BOT.md) | 봇 명령어/채널/모델 매핑 상세 |
| [`MANAGEMENT_GATEWAY.md`](docs/MANAGEMENT_GATEWAY.md) | 게이트웨이 라우트/인증 상세 |
| [`DOCS_WIKI.md`](docs/DOCS_WIKI.md) | 위키 동작/카테고리 규칙 |
| [`CLOUDFLARE_AUTOMATION.md`](docs/CLOUDFLARE_AUTOMATION.md) | Tunnel 설정 + 도메인 추가 자동화 |
| [`POWER_MANAGEMENT.md`](docs/POWER_MANAGEMENT.md) | `caffeinate`/슬립 정책 |
| [`CUSTOMER_ONBOARDING.md`](docs/CUSTOMER_ONBOARDING.md) | 새 운영 환경(다른 도메인/서버) 셋업 |
| [`BOT_BEHAVIOR.md`](docs/BOT_BEHAVIOR.md) | 봇 자가 동작 SSOT — 기동 체인, 이벤트 핸들러, 사고 이력 |
| [`INFRA1_QUEUE_WATCHDOG.md`](docs/INFRA1_QUEUE_WATCHDOG.md) | work-queue 워치독 |
| [`INCIDENT_QUEUE_APPEND_MISSING.md`](docs/INCIDENT_QUEUE_APPEND_MISSING.md) | 큐 append 누락 사고 런북 |

---

## 🔧 트러블슈팅

### `https://admin.nolza.org` 502 Bad Gateway

Cloudflare Tunnel이 살아있지만 로컬 게이트웨이가 죽은 상태. 점검:

```bash
# 어느 포트가 죽었는지
for p in 4000 4040 4050; do echo -n "$p: "; curl -sS -o /dev/null -w "%{http_code}\n" --max-time 3 "http://127.0.0.1:$p/health"; done

# 모두 다시 띄우기
bash project-manager/start.sh
```

`launchctl`로 `com.nolza.ops`가 등록돼 있다면 `unload` 후 다시 `load`하면 자동 재기동.

### launchd 자동 시작이 작동 안 함 (`ops.err.log: Operation not permitted`)

macOS TCC가 `/bin/bash`의 `~/Desktop` 접근을 차단한 상태. 위 [자동 실행](#macos-재부팅-시-자동-실행-launchd) 섹션의 **Full Disk Access** 단계 다시 확인.

### launchd 등록은 됐는데 health 응답 없음 (`LastExitStatus != 0`)

```bash
launchctl list com.nolza.ops              # LastExitStatus 확인
tail -50 /Users/kimsubo/Desktop/game-project/project-manager/ops.err.log
```

흔한 원인:
- `node: command not found` → plist의 `EnvironmentVariables → PATH`에 nvm 경로 누락 (현재 plist는 `~/.nvm/versions/node/v20.20.2/bin` 포함)
- 포트 점유 (`EADDRINUSE`) → 수동 기동된 프로세스가 살아있음. `lsof -ti :4000 | xargs kill -9` 후 `launchctl unload && launchctl load`

### Discord `/docs` 클릭 → 로그인 페이지로 떨어짐

SSO 토큰 만료(5분 일회용) 또는 `GATEWAY_SSO_SECRET`이 봇/게이트웨이 양쪽에서 다른 경우. `.env` 일치 확인 후 양쪽 재기동.

### 슬래시 커맨드가 Discord에 안 보임

```bash
cd discord-bot && node register-commands.js
```

`DISCORD_GUILD_ID`가 비어 있으면 글로벌 등록 (반영까지 최대 1시간), 설정돼 있으면 해당 길드만 즉시 반영.

### 봇 코드 수정 후 동작 안 바뀜

`docs/BOT_BEHAVIOR.md` §1 재기동 신뢰성 + §8 검증 체크리스트 참조. 핵심: 봇 프로세스가 정말 새 코드로 재시작됐는지 PID/로그로 확인.

---

## 🧰 부록: harness-kit

`harness-kit/`은 **운영 도구가 아님**. 신규 프로젝트 repo를 초기화할 때 쓰는 템플릿 자산 (`.claude/hooks/`, `.claude/rules/harness/` 등의 원본). 봇/게이트웨이/위키와 무관하므로 운영 중 손댈 일 없음.

---

## 📦 정리/제거 이력

- **`wol-service/`** — Cloudflare Worker가 wakeup을 직접 처리하도록 이관됨. 디렉토리 자체는 남아있을 수 있으니 수동으로 제거(`rm -rf project-manager/wol-service`).
- **`render.yaml`** — wol-service 전용 설정만 있었으므로 비움 (`services: []`). Render.com 콘솔에 잔여 인스턴스가 있다면 별도 삭제 필요.
- **`work-queue.json.bak.20260425`** — 과거 백업, 제거됨.
