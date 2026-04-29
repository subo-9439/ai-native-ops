# Discord 봇 — 프로젝트매니저#2209

## 개요

whosbuying 프로젝트를 Discord에서 운영·개발하기 위한 봇.
게임 서버 상태 조회, Claude 에이전트 코드 작업, 배포 트리거를 Discord 안에서 수행한다.

**실행 방식**: 맥북에서 로컬 실행 (Discord Gateway WebSocket 직접 연결)

---

## 슬래시 커맨드 (8개)

| 커맨드 | 설명 | 필수 env |
|---|---|---|
| `/game-server-status` | 🎮 게임 서버 상태 조회 | `GAME_SERVER_URL`, `ADMIN_API_KEY` |
| `/game-rooms` | 🎮 활성 방 리스트 | 동일 |
| `/close-room <code>` | 🎮 특정 방 강제 종료 | 동일 |
| `/deploy <web\|android>` | 🚀 GitHub Actions workflow_dispatch | `GITHUB_PAT` |
| `/dev <message>` | ⚡ 통합 개발 에이전트 실행 | `CLAUDE_PROJECT_DIR` |
| `/skill <name>` | 🛠️ 스킬 프리셋 (review/sprint/pr/test/explain) | `CLAUDE_PROJECT_DIR` |
| `/dispatch <directive>` | 👔 BE/FE/AI 병렬 디스패치 | `CLAUDE_PROJECT_DIR` |
| `/docs` | 📚 문서 인덱스 + 위키 자동 로그인 SSO 링크 | `GATEWAY_INTERNAL_URL` |

### 커맨드 등록

슬래시 커맨드가 Discord에 안 보이면 등록 필요 (초기 1회 또는 변경 시):

```bash
cd discord-bot
set -a; source ../.env; set +a
DISCORD_GUILD_ID=1491466936863821857 node register-commands.js
```

---

## 채널 구성

```
nolza-dev/
├── #👔-ceo기획실   ← 기획 대화 + 디스패치 (메인)
├── #⚡-dev         ← 통합 개발 에이전트
├── #💬-잡담        ← 범용
├── #🔍-pr-리뷰
├── #🚀-배포-로그
└── #📢-공지
```

| 채널명 (Discord) | 내부 역할 키 | 역할 |
|---|---|---|
| `#👔-ceo기획실` | `ceo` | 기획 어드바이저 + 디스패치 |
| `#⚡-dev` | `dev` | 통합 개발 (BE/FE/AI 통합) |
| `#💬-잡담` | `잡담` | 범용 |

---

## `#👔-ceo기획실` — 두 가지 모드

### 1️⃣ 대화 모드 (기본)
일반 메시지 → Claude가 **기획 어드바이저**로 응답.
- 아이디어 검토, 기술 실현 가능성, 공수 판단, 대안 제시
- 합의된 작업은 디스패치 형식으로 정리해서 제안
- CEO 결정사항은 `decisions.md`에 자동 기록
- **이미지 첨부 지원** (2026-04-29~): 메시지에 스크린샷·이미지 첨부 시 봇이 attachment 를 로컬(`.ops/discord-attachments/`)에 다운로드해 절대 경로를 Claude 프롬프트에 주입 → Read 툴로 vision 인식. AdSense 콘솔, 에러 로그, UI 버그 스샷을 텍스트로 풀어쓸 필요 없음. (지원 형식: png/jpg/gif/webp)
- **답장(Reply) 형태 첨부 인식** (2026-04-29~): Discord 답장 기능으로 원본 메시지의 이미지에 텍스트만 답장해도 봇이 `message.reference.messageId` 를 fetch 해 원본 첨부를 합쳐서 인식. "이거 봐봐" 같은 짧은 follow-up 사용 가능.

### 2️⃣ 디스패치 모드
`---BE---` / `---FE---` / `---AI---` 섹션 포함 → 각 에이전트에 **병렬 실행**.

```
로비에 채팅 기능 추가

---BE---
WebSocket STOMP /topic/rooms/{code}/chat 구현, ChatMessage DTO 추가

---FE---
로비 화면에 채팅 위젯 추가, STOMP 구독

---AI---
(필요 없으면 이 섹션 생략)
```

### 🤖 반응 재디스패치
기존 메시지에 🤖 반응을 추가하면 **재디스패치** (지시문 수정 후 재실행 가능).

---

## `#⚡-dev` — 통합 개발 에이전트

채널에 메시지를 보내면 **스레드 생성 + Claude CLI 자동 실행**된다.

### 동작 방식

```
사용자 메시지 → 봇이 ⏳ 반응
  → 스레드 생성 (메시지 첫 80자가 제목)
  → claude --print --dangerously-skip-permissions 실행
    (cwd: CLAUDE_PROJECT_DIR, 통합 dev 컨텍스트 + memory-bank 자동 주입)
  → 스레드에 진행 상황 스트리밍
  → 완료 시 결과 Embed + ✅ 반응
  → docs/CHANGELOG.md, .ops/context.jsonl 자동 갱신
  → memory-bank/activeContext.md, progress.md 갱신 (Claude가 직접)
```

### 작업 영역
- 게임 서버: `game_project_server/` (Spring Boot 3, MariaDB, Redis, RabbitMQ, WebSocket/STOMP)
- Flutter 앱: `game_project_app/` / `game_project_web/`
- AI 서버: `game_project_ai/` (Gemini)

### 후속 지시 (스레드 follow-up)
스레드 안에서 추가 메시지 → **이전 대화 컨텍스트 자동 포함**. "아까 그거", "위에서 말한 것" 같은 참조 동작.

---

## HTTP Interaction 서버

봇은 Gateway 연결 외에 HTTP 서버(포트 4040)도 운영.

| 엔드포인트 | 용도 |
|---|---|
| `GET /` | 헬스체크 |
| `GET /health` | 상세 헬스체크 (uptime) |
| `POST /interaction` | Cloudflare Worker → 봇 명령 포워딩 (현재 미사용) |

현재는 **Gateway 전용** (맥북 직통). Discord Interactions Endpoint URL 비워둠.

---

## 환경 변수

`.env` 파일 위치: `project-manager/.env`

| 변수 | 필수 | 설명 | 기본값 |
|---|---|---|---|
| `DISCORD_TOKEN` | O | Bot Token | - |
| `DISCORD_CLIENT_ID` | O | Application ID | - |
| `DISCORD_PUBLIC_KEY` | - | Interaction 서명 검증용 | - |
| `DISCORD_GUILD_ID` | - | 특정 서버 등록 | 전역 |
| `DISCORD_ALERTS_WEBHOOK` | - | `#🚨-alerts` 배포 알림 웹훅 (deploy-web.sh가 참조) | `~/.claude-sync/discord-alerts-webhook` 파일 |
| `CEO_CHANNEL_NAME` | - | CEO 채널명 | `👔-ceo기획실` |
| `CLAUDE_PROJECT_DIR` | - | Claude 작업 디렉터리 | `whosbuying/` |
| `GAME_SERVER_URL` | - | 게임 서버 주소 | `http://localhost:8080` |
| `ADMIN_API_KEY` | - | Bearer 토큰 | - |
| `GITHUB_PAT` | - | Actions write PAT | - |
| `GITHUB_REPO` | - | 배포 대상 레포 | `subo-9439/whosbuying` |
| `BOT_HTTP_PORT` | - | HTTP 포트 | `4040` |
| `GATEWAY_INTERNAL_URL` | - | 게이트웨이 내부 주소 | `http://127.0.0.1:4000` |
| `PUBLIC_BASE_URL` | - | 공개 URL (SSO 링크 생성) | `https://admin.nolza.org` |
| `GATEWAY_SSO_SECRET` | - | 게이트웨이↔봇 공유 시크릿 | - |

---

## 관련 도구 — Chrome 디버그 프로필 (MCP 자동화 연결)

봇이 실행하는 Claude CLI가 Chrome MCP(`mcp__Claude_in_Chrome__*`, `mcp__chrome-devtools__*`)를 사용하려면 별도 디버그 프로필 Chrome이 필요하다.

**핵심**: MCP가 붙는 Chrome ≠ 평소 쓰는 Chrome. 두 프로세스/프로필은 완전히 분리됨.

| 항목 | 값 |
|---|---|
| 디버그 프로필 | `~/.chrome-debug-profile` |
| 디버그 포트 | `9222` |
| 검증 | `curl -s http://127.0.0.1:9222/json/version` → 200 OK |

기동·SSOT 가이드: [`whosbuying/docs/AI_OPS.md` § Chrome 디버그 프로필](../../whosbuying/docs/AI_OPS.md#chrome-디버그-프로필-mcp자동화-도구-연결용)

**주의**: Default 프로필 경로(`~/Library/Application Support/Google/Chrome`)로 띄우면 Chrome 136+ 보안 정책에 의해 디버그 포트가 무시됨. 반드시 비-Default `--user-data-dir` 사용.

---

## 메모리 시스템 (5-Layer, Cline Memory-Bank 패턴)

매번 Claude CLI를 새 프로세스로 실행하므로, 5계층으로 세션 연속성과 공용 상태를 유지.

### L0 — CLAUDE.md (정적 헌장)
`whosbuying/CLAUDE.md` — Claude CLI가 `cwd`에서 자동 로드.

### L1 — Memory-Bank (🔥 공용 상태)
`whosbuying/docs/memory-bank/` 의 4개 파일 — **모든 에이전트(CEO + Dev) 공용 화이트보드**.

| 파일 | 내용 | 갱신 주체 |
|------|------|-----------|
| `activeContext.md` | 🔥 현재 포커스, 최근 변경, 다음 단계 | Dev, CEO |
| `progress.md` | 기능별 완료 상태, 알려진 이슈 | Dev |
| `decisions.md` | CEO 합의 결정사항 (append-only) | CEO |
| `systemPatterns.md` | 재사용 코드 패턴, 명명 규칙 | Dev |

**원칙** (에이전트 프롬프트로 강제):
> "모든 작업 전 memory-bank 4파일을 반드시 읽는다. 이는 선택이 아니다."

자동 주입(`readMemoryBank()`) + Claude가 도구로도 읽음 (벨트+멜빵).

### L2 — Ops Context Log (claude-sync)
`~/.claude-sync/<slug>/events.jsonl` — **claude-sync 공용 이벤트 로그**. 다음 실행 시 **최근 20건** 주입.

> 기존 `whosbuying/.ops/context.jsonl` 방식에서 마이그레이션 완료 (2026-04-18).  
> 원본은 `.ops/context.jsonl.pre-sync-backup`으로 보존.

```jsonl
{"ts":"2026-04-18T08:00:00Z","source":"terminal","agent":"dev","kind":"file_write","summary":"AdminController 생성, GET /api/v1/admin/status 구현","artifacts":[{"type":"file","path":"game_project_server/src/.../AdminController.java"}],"tokens":null}
```

**양방향 sync (터미널 Claude Code 훅)**:
- **터미널 → 로그**: 세션 종료 시 Stop Hook(`~/.claude/hooks/stop`)이 자동으로 `events.jsonl`에 `session_end` 이벤트 기록
- **Discord → 로그**: 봇 슬래시 커맨드 실행 시 `events.jsonl`에 이벤트 append
- **조회**: Discord에서 `/sync-recent`로 최근 20건 다이제스트 확인 가능

`.gitignore` 됨 (로컬 전용). 참고: [`~/.claude-sync/README.md`](~/.claude-sync/README.md)

### L3 — Thread Context
스레드 follow-up 시 Discord API로 **최근 15개 메시지** 수집해 주입.

### L4 — CHANGELOG.md
`whosbuying/docs/CHANGELOG.md` — 인간 가독 영구 기록. 자동 주입은 안 함.

### 주입 순서
```
[역할 prefix]
+ L1: memory-bank 4파일
+ L2: claude-sync events.jsonl 최근 20건
+ L3: 스레드 히스토리
+ [사용자 지시]
```

---

## 위키 접근

`#⚡-dev`, `#👔-ceo기획실` 채널에서 `/docs` 입력:
- 봇이 게이트웨이에서 SSO 토큰 발급
- 자동 로그인 링크 embed 표시 (5분 일회용)
- 클릭 시 `https://admin.nolza.org/admin/wiki` 즉시 진입

직접 접속 (브라우저): `https://admin.nolza.org/admin/wiki` → admin / password

---

## 변경 이력 (Versions)

운영봇 주요 버전업. 최근순.

| 날짜 | 커밋 | 변경 |
|------|------|------|
| 2026-04-29 | `3180ea7` | 답장(Reply) 형태 메시지의 원본 첨부 자동 fetch — `message.reference.messageId` 로 원본 가져와 attachments 병합 |
| 2026-04-29 | `c0580ba` | Discord 이미지 첨부 → 로컬 다운로드 후 절대경로를 Claude 프롬프트에 주입 (Read 툴 vision 인식) |
| 2026-04-29 | `60f75c3` | Discord 2000자 초과 reply 자동 split 전송 (`safeSend` / `safeReply` 헬퍼) |
| 2026-04-28 | `cfcd258` | PR-INFRA3 봇 자가진단 — 5분 cron + Render 상태 + CI 게이트 |
| 2026-04-28 | `99fcf9b` | PR-INFRA2 Discord 2000자 한도 전역 가드 (`MessagePayload.makeContent` 패치) |
| 2026-04-28 | `c131355` | PR-INFRA1 큐 watchdog — 15분 warn / 30분 critical 자동 알림 |
| 2026-04-27 | `c19012f` | `alerts-watcher` — `#🚨-alerts` 자동 생성 + docker health 알림 |
| 2026-04-27 | `c1cc175` | Discord 봇 권한 강화 — 정책 검증 모듈 도입 |

세부 변경은 `project-manager/` 레포 `git log discord-bot/` 참조.
