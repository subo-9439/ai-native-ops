# 관리 게이트웨이

운영 도구(위키, 향후 대시보드)에 **인증된 단일 진입점**을 제공하는 게이트웨이.

## 왜 필요한가

이전에는 위키가 `127.0.0.1:4050`으로 로컬에 그대로 노출되어 있었다. 외부에서 접근하려면 IP/포트를 직접 노출해야 해서:
- 인증이 없음
- URL 구조가 매번 다른 포트로 변함 (위키 4050, 대시보드 X)
- 나중에 Cloudflare Tunnel 뒤에 숨길 때 경로가 일관되지 않음

이를 해결하기 위해 **단일 게이트웨이**가 모든 관리 UI의 앞에 서고, 내부 서비스는 localhost 전용으로 유지.

## 아키텍처

```
사용자 브라우저
    │
    ↓ http://localhost:4000/admin/wiki
┌──────────────────────────┐
│  Management Gateway      │  (포트 4000, 공개)
│                          │
│  /admin/login            │
│  /admin/wiki/*  ──┐      │
│  /admin/state/* ─┐│      │  ← 향후 추가
│  /auth/sso       ││      │  ← Discord 봇 전용
└──────────────────┼┼──────┘
                   ││
        ┌──────────┘│
        ↓           │
   docs-wiki        │
   (127.0.0.1:4050) │
   (내부만)         │
                    │
              (future dashboard)
```

## 인증 방식

### 1. 브라우저 직접 접속 (아이디/비번)

1. `http://localhost:4000/admin/wiki` 접속
2. 로그인 페이지로 리다이렉트
3. 아이디(`admin`) + 비밀번호(`password`) 입력
4. 세션 쿠키 발급 (12시간 유효)
5. 위키 접근

자격 증명은 `project-manager/.admin-credentials.json` 파일에 저장됨 (gitignore됨):

```json
{
  "username": "admin",
  "password": "password"
}
```

**변경 방법**: 파일 내용만 수정하면 다음 로그인부터 적용.

### 2. Discord 봇 자동 로그인 (SSO)

1. Discord에서 `/docs` 입력
2. 봇이 게이트웨이 `/auth/sso` 호출 → 1회용 토큰 발급 (5분 유효)
3. 봇이 embed에 자동 로그인 링크 표시
4. 링크 클릭 → 게이트웨이가 토큰 → 세션 교환
5. 위키 즉시 접근 (아이디/비번 입력 없이)

> 토큰은 **일회용**. 한 번 쓰면 즉시 폐기.

## URL 구조

| URL | 설명 | 인증 |
|-----|------|------|
| `/` | `/admin/wiki`로 리다이렉트 | - |
| `/admin/login` | 로그인 페이지 | - |
| `/admin/logout` | 로그아웃 | 세션 |
| `/admin/wiki/*` | 위키 프록시 | 세션 필요 |
| `/admin/sso?token=...` | SSO 토큰 → 세션 교환 | 토큰 |
| `/auth/sso` (POST) | SSO 토큰 발급 (Discord 봇용) | 공유 시크릿 |
| `/health` | 헬스체크 | - |

## 환경 변수 (`project-manager/.env`)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GATEWAY_PORT` | `4000` | 게이트웨이 포트 |
| `PUBLIC_BASE_URL` | `http://localhost:4000` | 외부에서 접근하는 URL (Discord 링크 생성에 사용) |
| `WIKI_INTERNAL_URL` | `http://127.0.0.1:4050` | 위키 내부 주소 |
| `ADMIN_CREDENTIALS_FILE` | `../.admin-credentials.json` | 자격 증명 JSON 파일 |
| `GATEWAY_SSO_SECRET` | (비움) | Discord 봇 ↔ 게이트웨이 공유 시크릿 |

## 중간 서비스 교체 시 유지되는 맥락

이 구조의 핵심은 **URL 경로가 공개 계약**이라는 점.

- `{PUBLIC_BASE_URL}/admin/wiki` ← 위키 위치 (변하지 않음)
- `{PUBLIC_BASE_URL}/admin/state` ← 향후 대시보드 위치 (예약)

실제 내부 구현(위키 서버, 대시보드)이 바뀌거나 포트가 달라져도, 공개 URL은 그대로. 나중에:

- **Cloudflare Tunnel 뒤로 숨기기**: `PUBLIC_BASE_URL=https://admin.nolza.org` 만 바꾸면 됨
- **위키를 정적 사이트로 교체**: `WIKI_INTERNAL_URL` 만 바꾸면 됨
- **대시보드 추가**: 게이트웨이 `/admin/state` 라우트만 추가

## 실행

전체 시작:
```bash
bash project-manager/start.sh
```

개별 시작:
```bash
cd management-gateway && bash start-local.sh
```

## 검증

```bash
# 헬스체크 (credentialsLoaded: true 확인)
curl http://127.0.0.1:4000/health

# 로그인 페이지
open http://localhost:4000/admin/wiki

# SSO 토큰 발급 테스트
curl -X POST http://127.0.0.1:4000/auth/sso \
  -H "x-sso-secret: local-dev-sso-secret" \
  -H "Content-Type: application/json" \
  -d '{"target":"/admin/wiki"}'
```
