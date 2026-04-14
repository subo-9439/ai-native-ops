# 운영 환경 구성

## 개요

whosbuying 프로젝트를 **관리**하기 위한 운영 도구 레이어.
프로젝트 자체(게임 서버, Flutter 앱)와 분리된, 프로젝트를 프록시로 감싸는 관리 도구들.

```
[사용자 브라우저]                  [Discord 사용자]
       │                                  │
       ▼                                  ▼
https://admin.nolza.org              Discord Gateway
       │                                  │
       ↓ (Cloudflare Tunnel)              ↓
┌─────────────────────────────┐  ┌────────────────────┐
│ Management Gateway (:4000)  │  │ Discord Bot (:4040)│
│  - 로그인/세션              │  │  - 슬래시 커맨드   │
│  - /admin/wiki 프록시       │  │  - 채널 메시지 처리│
│  - SSO 토큰 발급 ←──────────│──│ /docs → SSO 발급   │
└────────┬───────────────────-┘  │  - Claude CLI 호출 │
         │                        └─────────┬──────────┘
         ▼ (내부)                            │
┌─────────────────────────────┐              │
│ docs-wiki (:4050, 내부)     │              │
│  - 마크다운 → HTML          │              │
└─────────────────────────────┘              │
                                              ▼
                                      ┌──────────────┐
                                      │ whosbuying/  │
                                      │  - CLAUDE.md │
                                      │  - memory-bank/
                                      │  - .ops/     │
                                      │  - 게임 서버 │
                                      │  - Flutter   │
                                      └──────────────┘
```

---

## 구성 요소

| 도구 | 위치 | 포트 | 외부 노출 | 역할 |
|------|------|------|-----------|------|
| **Management Gateway** | `management-gateway/` | 4000 | ✅ `admin.nolza.org` | 인증 + 통합 진입점 |
| **Discord 봇** | `discord-bot/` | 4040 (내부) | ❌ Gateway WS만 | 운영 명령 인터페이스 |
| **문서 위키** | `docs-wiki/` | 4050 (내부) | ❌ 게이트웨이 경유만 | 문서 브라우징 |
| **wol-service** | `wol-service/` | - | (미사용) | 이전 WoL 릴레이 |

---

## 프로젝트 문서 vs 운영 도구 문서

| 구분 | 위치 | 내용 |
|------|------|------|
| **프로젝트 문서** | `whosbuying/docs/` | PRD, 아키텍처, DB설계, 인프라, 게임설계, 개발가이드, memory-bank |
| **운영 도구 문서** | `project-manager/docs/` | Discord 봇 사용법, 게이트웨이, 위키, Cloudflare 자동화, 고객 셋업 가이드 |

**원칙**:
- **프로젝트 자체** (어떻게 만들었고 배포하는가) → `whosbuying/docs/`
- **운영 프록시** (어떻게 관리하고 어떤 채널에서 뭘 하는가) → `project-manager/docs/`

---

## 실행

### 전체 시작
```bash
bash project-manager/start.sh
```

봇(4040) + 위키(4050) + 게이트웨이(4000) 동시 실행.

### 개별 시작
```bash
cd project-manager/discord-bot         && bash start-local.sh
cd project-manager/docs-wiki           && bash start-local.sh
cd project-manager/management-gateway  && bash start-local.sh
```

### 헬스체크
```bash
curl http://127.0.0.1:4000/health         # 게이트웨이
curl http://127.0.0.1:4040/health         # 봇
curl http://127.0.0.1:4050/health         # 위키
curl https://admin.nolza.org/health       # 외부 (Cloudflare 경유)
```

---

## 사용자 흐름

### Discord 사용자
```
1. /game-server-status          → 게임 서버 상태 조회
2. /dev <message>               → 통합 개발 에이전트 작업
3. /docs                        → SSO 자동 로그인 위키 링크
4. #👔-ceo기획실 메시지         → 기획 대화 또는 디스패치
5. #⚡-dev 메시지                → 단일 작업 (스레드 + Claude 실행)
6. 스레드 follow-up             → 이전 대화 컨텍스트 포함 재실행
```

### 브라우저 사용자
```
1. https://admin.nolza.org/admin/wiki   → 로그인 페이지
2. admin / password 입력                → 세션 발급 (12시간)
3. 위키 사이드바/카드로 문서 탐색
```

---

## 새 운영 환경 셋업 (다른 서버, 다른 도메인)

`CUSTOMER_ONBOARDING.md` 참조. 한 번만 사람이 직접 해야 하는 단계:
1. 도메인 확보 (Cloudflare Registrar 권장)
2. `cloudflared` CLI 설치 + `tunnel login` (브라우저 OAuth)
3. 터널 생성 + credentials 복사
4. `config.yml` 작성
5. Discord 봇 만들기 + 서버 초대
6. `.admin-credentials.json` 작성

이후 모든 작업(새 서브도메인 추가, 설정 변경)은 Discord에서 명령하면 AI가 `CLOUDFLARE_AUTOMATION.md` 참조해 자동 처리.
