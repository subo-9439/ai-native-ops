# project-manager

whosbuying 게임 프로젝트의 운영 도구 모음.

## 구성

```
project-manager/
├── discord-bot/             ← 프로젝트매니저#2209 봇 (로컬 :4040)
├── docs-wiki/               ← 문서 위키 (내부 :4050, 게이트웨이만 접근)
├── management-gateway/      ← 통합 관리 게이트웨이 (공개 :4000)
├── wol-service/             ← (예전) Wake-on-LAN 릴레이 — 미사용
└── start.sh                 ← 셋 동시 실행
```

## 서비스 흐름

```
사용자 브라우저
    └─→ https://admin.nolza.org/admin/wiki
            ↓ (Cloudflare Tunnel)
        management-gateway (:4000)
            ├── 로그인 페이지 (admin/password)
            ├── /admin/wiki  → docs-wiki (:4050, 내부)
            └── /auth/sso    → Discord 봇 자동 로그인용

Discord 봇 (:4040)
    ├── Gateway WebSocket → Discord
    ├── 슬래시 커맨드 처리
    └── /docs 명령 시 게이트웨이 SSO 토큰 발급 → 자동 로그인 링크
```

---

## 실행

```bash
bash start.sh
```

또는 개별 실행:
```bash
cd discord-bot          && bash start-local.sh   # 봇 :4040
cd docs-wiki            && bash start-local.sh   # 위키 :4050
cd management-gateway   && bash start-local.sh   # 게이트웨이 :4000
```

`.env` 파일이 `project-manager/.env`에 있어야 함.

### macOS 재부팅 후 자동 실행 (launchd)

`~/Library/LaunchAgents/com.nolza.discord-bot.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nolza.ops</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/kimsubo/Desktop/game-project/project-manager/start.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/kimsubo/Desktop/game-project/project-manager</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/Users/kimsubo/Desktop/game-project/project-manager/ops.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/kimsubo/Desktop/game-project/project-manager/ops.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.nolza.ops.plist     # 등록
launchctl unload ~/Library/LaunchAgents/com.nolza.ops.plist   # 해제
```

---

## Discord 봇 — 프로젝트매니저#2209

### 슬래시 커맨드 (8개)

| 커맨드 | 설명 |
|---|---|
| `/game-server-status` | 🎮 게임 서버 상태 조회 |
| `/game-rooms` | 🎮 활성 방 목록 |
| `/close-room <code>` | 🎮 방 강제 종료 |
| `/deploy <web\|android>` | 🚀 GitHub Actions 배포 트리거 |
| `/dev <message>` | ⚡ 통합 개발 에이전트 실행 |
| `/skill <name>` | 🛠️ 스킬 프리셋 (review/sprint/pr/test/explain) |
| `/dispatch <directive>` | 👔 BE/FE/AI 병렬 디스패치 |
| `/docs` | 📚 문서 인덱스 + 위키 자동 로그인 링크 |

### 채널 구성

```
nolza-dev/
├── #👔-ceo기획실   ← 기획 대화 + 디스패치
├── #⚡-dev         ← 통합 개발 에이전트
├── #💬-잡담        ← 범용
├── #🔍-pr-리뷰
├── #🚀-배포-로그
└── #📢-공지
```

#### `#👔-ceo기획실` — 두 가지 모드
- **대화 모드**: 일반 메시지 → Claude가 기획 어드바이저로 응답
- **디스패치 모드**: `---BE---` / `---FE---` / `---AI---` 섹션 포함 → 병렬 작업 명령

```
로비에 채팅 기능 추가

---BE---
WebSocket STOMP /topic/rooms/{code}/chat 구현

---FE---
로비 화면에 채팅 위젯 추가
```

#### `#⚡-dev` — 통합 개발 에이전트
메시지 → 스레드 자동 생성 → Claude CLI 실행 → 결과 포스팅. 스레드 안 follow-up 시 이전 대화 자동 포함.

### 메모리 시스템 (5-Layer)

| Layer | 위치 | 역할 |
|---|---|---|
| L0 — CLAUDE.md | `whosbuying/CLAUDE.md` | 정적 헌장 (Claude CLI 자동 로드) |
| L1 — Memory-Bank | `whosbuying/docs/memory-bank/` | 🔥 공용 화이트보드 (CEO+Dev) |
| L2 — Ops Log | `whosbuying/.ops/context.jsonl` | 단기 RAM (최근 10건) |
| L3 — Thread Context | Discord API | 스레드 follow-up 히스토리 (최근 15) |
| L4 — CHANGELOG | `whosbuying/docs/CHANGELOG.md` | 영구 인간 가독 기록 |

L1 memory-bank 4파일:
- `activeContext.md` — 현재 포커스, 다음 단계
- `progress.md` — 기능별 진행 상태
- `decisions.md` — CEO 결정사항 (append-only)
- `systemPatterns.md` — 코드 패턴

### 파일 구조

```
discord-bot/
├── index.js                  ← 메인 (Gateway + HTTP :4040)
├── interaction-server.js     ← Cloudflare Worker 포워딩 수신 (현재 미사용)
├── context-manager.js        ← 5-Layer 컨텍스트 조립
├── changelog-manager.js      ← CHANGELOG.md 자동 갱신
├── setup-channels.js         ← 채널 토픽/핀 일괄 셋업
├── commands/
│   ├── claude.js             ← /dev + 멀티에이전트 디스패치
│   ├── status.js             ← /game-server-status
│   ├── rooms.js              ← /game-rooms
│   ├── close-room.js         ← /close-room
│   ├── deploy.js             ← /deploy (GitHub Actions)
│   └── docs.js               ← /docs (SSO 자동 로그인 링크)
├── register-commands.js      ← 슬래시 커맨드 등록 (초기 1회/변경 시)
├── start-local.sh
└── Dockerfile
```

### 채널별 모델 설정

`project-manager/channel-config.json` — 각 채널(역할)별로 다른 Claude 모델 지정.

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

**지원 모델**:
- `opus` (claude-opus-4-6) — 가장 강력, 느리고 비쌈
- `sonnet` (claude-sonnet-4-6) — 균형, 빠르고 정확
- `haiku` (claude-haiku-4-5) — 빠르고 저렴

파일 수정 즉시 다음 실행부터 반영 (봇 재시작 불필요). 실행 시 Discord 결과 메시지에 사용된 모델 표시됨.

### 환경 변수 (`.env`)

| 변수 | 필수 | 설명 |
|---|---|---|
| `DISCORD_TOKEN` | O | 봇 토큰 |
| `DISCORD_CLIENT_ID` | O | Application ID |
| `CEO_CHANNEL_NAME` | - | 기본 `👔-ceo기획실` |
| `CLAUDE_PROJECT_DIR` | - | 기본 `whosbuying/` |
| `GAME_SERVER_URL` | - | 기본 `http://localhost:8080` |
| `ADMIN_API_KEY` | - | 게임 서버 admin API 키 |
| `GITHUB_PAT` | - | GitHub Actions 배포용 |
| `BOT_HTTP_PORT` | - | 기본 4040 |
| `GATEWAY_INTERNAL_URL` | - | 기본 `http://127.0.0.1:4000` |
| `PUBLIC_BASE_URL` | - | 기본 `https://admin.nolza.org` |
| `GATEWAY_SSO_SECRET` | - | 게이트웨이 SSO 인증 |

---

## docs-wiki — 문서 위키 (내부)

`whosbuying/docs/` + `project-manager/docs/` 마크다운을 웹으로 브라우징.

**직접 접속 불가**: 게이트웨이를 통해서만 접근 (`https://admin.nolza.org/admin/wiki`).

내부 포트 `127.0.0.1:4050`은 게이트웨이만 사용.

### 기능
- 카테고리 분리: 프로젝트 / 🧠 Memory Bank / 운영 도구
- 최신순/이름순 정렬, 사이드바 검색
- 코드 하이라이팅 (highlight.js)
- 게이트웨이 prefix 자동 적용 (`X-Forwarded-Prefix` 헤더)

---

## management-gateway — 관리 게이트웨이

운영 도구 단일 진입점 + 인증.

### URL

| 경로 | 인증 | 설명 |
|------|------|------|
| `/admin/wiki/*` | 세션 | 위키 프록시 |
| `/admin/login` | - | 로그인 페이지 |
| `/admin/sso?token=...` | 토큰 | SSO 토큰 → 세션 교환 |
| `/auth/sso` (POST) | 시크릿 | Discord 봇 전용 SSO 발급 |
| `/health` | - | 헬스체크 |

### 인증
- **브라우저**: 아이디/비번 (`.admin-credentials.json` 파일, gitignore)
- **Discord**: `/docs` → 봇이 SSO 토큰 발급 → 자동 로그인 링크 (5분 일회용)

자세한 설정 변경/도메인 추가는 `docs/CLOUDFLARE_AUTOMATION.md` 참조.

---

## wol-service (미사용)

이전 Wake-on-LAN 릴레이. 현재 맥북 전용 운영으로 전환되어 비활성.
필요 시 `render.yaml`로 Render.com 배포 가능.
