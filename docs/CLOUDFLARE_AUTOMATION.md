# Cloudflare 자동화 가이드 (AI용)

> 이 문서는 **AI 에이전트가 읽고 그대로 실행하면 되는 절차**를 적어둔다.
> 사람 개입이 필수인 단계는 `CUSTOMER_ONBOARDING.md` 참조.

## 전제 조건 (이미 갖춰진 상태에서만 자동화 가능)

아래가 모두 준비되어 있어야 AI가 자동으로 실행할 수 있다:

| 항목 | 확인 명령 | 준비 상태 |
|------|-----------|-----------|
| `cloudflared` CLI 설치 | `which cloudflared` | `/usr/local/bin/cloudflared` |
| Cloudflare 인증 cert | `ls ~/.cloudflared/cert.pem` | 존재 |
| 터널 자격증명 | `ls ~/.cloudflared/<TUNNEL_ID>.json` | 존재 |
| 터널 ID | `cat ~/Desktop/game-project/whosbuying/game_project_server/infra/cloudflared/config.yml | head -1` | `tunnel: 88f67e46-b58a-47f2-bd76-f8d157bf6df0` |
| docker compose `prod` 프로필 | `docker compose ps cloudflared` | 실행 중 |

**이 중 하나라도 없으면** → `CUSTOMER_ONBOARDING.md` 순서대로 사람이 먼저 셋업해야 한다.

---

## 자동화 시나리오

### 시나리오 A — 새 서브도메인 추가 (예: `dashboard.nolza.org`)

```bash
TUNNEL_ID=88f67e46-b58a-47f2-bd76-f8d157bf6df0
HOSTNAME=dashboard.nolza.org
INTERNAL_URL=http://host.docker.internal:4001  # 내부 서비스 주소
CONFIG=~/Desktop/game-project/whosbuying/game_project_server/infra/cloudflared/config.yml

# 1. DNS CNAME 자동 생성 (Cloudflare API 호출, cloudflared가 래핑)
cloudflared tunnel route dns "$TUNNEL_ID" "$HOSTNAME"

# 2. config.yml에 ingress 추가 (파수꾼 404 rule 바로 위에 삽입)
# → 에이전트가 Edit 도구로 직접 수정

# 3. cloudflared 컨테이너 재시작
cd ~/Desktop/game-project/whosbuying/game_project_server
docker compose --profile prod restart cloudflared

# 4. 검증
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" "https://$HOSTNAME/"
```

**Config ingress 추가 형식**:
```yaml
  - hostname: dashboard.nolza.org
    service: http://host.docker.internal:4001
    originRequest:
      connectTimeout: 30s
```

### 시나리오 B — 기존 서브도메인 내부 포트만 변경

`config.yml` 의 해당 `hostname` 블록에서 `service:` 만 수정 → 재시작.

### 시나리오 C — 서브도메인 제거

```bash
# 1. config.yml에서 해당 block 삭제
# 2. DNS 레코드 제거 (선택, 안전을 위해 터널 라우트는 명시적 삭제)
cloudflared tunnel route dns <TUNNEL_ID> <HOSTNAME> --overwrite-dns=false
# 또는 Cloudflare 대시보드에서 수동 삭제 (API 토큰 없을 때)
# 3. cloudflared 재시작
```

---

## AI가 하면 안 되는 것 (사람이 해야 함)

| 작업 | 이유 |
|------|------|
| Cloudflare 계정 생성 | 이메일 인증 필요 |
| 도메인 등록/이전 (Registrar) | 결제 + 개인정보 필요 |
| 네임서버 변경 (도메인 등록업체 → Cloudflare) | 계정 소유 증명 |
| `cloudflared tunnel login` 초기 인증 | 브라우저 OAuth 로그인 필요 |
| 터널 최초 생성 | Cloudflare 대시보드 권한 필요 |
| Zone-wide 설정 (SSL 모드, WAF 규칙 등) | 정책 결정 사안 |

---

## 검증 체크리스트 (AI 자동 실행 가능)

```bash
# 1. 로컬 게이트웨이 살아있는지
curl -s http://localhost:4000/health

# 2. docker cloudflared 컨테이너 실행 중인지
docker compose -f ~/Desktop/game-project/whosbuying/game_project_server/docker-compose.yml \
  ps cloudflared

# 3. 외부에서 접근 가능한지 (SSL 포함)
curl -s -o /dev/null -w "%{http_code}\n" https://admin.nolza.org/admin/wiki
# → 200 (로그인 페이지) 이면 정상

# 4. DNS 레코드 해석
dig admin.nolza.org +short
# → CNAME → cfargotunnel.com 계열이면 정상
```

---

## 현재 등록된 호스트 (참고)

| 호스트 | 내부 서비스 | 포트 | 용도 |
|--------|-------------|------|------|
| `nolza.org` | nginx (Docker) | 80 | Flutter Web 정적 호스팅 |
| `api.nolza.org` | Spring Boot | 8080 | 게임 서버 REST/WS |
| `admin.nolza.org` | Management Gateway | 4000 | 운영 관리 (위키, 인증) |

`config.yml` 위치: `whosbuying/game_project_server/infra/cloudflared/config.yml`
