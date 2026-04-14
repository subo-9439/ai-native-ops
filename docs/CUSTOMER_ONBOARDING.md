# 고객/사용자 초기 셋업 가이드

> 이 문서는 **사람이 직접 해야만 하는 단계들**만 모은 체크리스트다.
> 한 번 완료하고 나면 이후는 AI가 `CLOUDFLARE_AUTOMATION.md` 를 참조해 자동화한다.

## 🎯 이걸 언제 해야 하나?

다음 중 하나에 해당할 때:
- 처음 서비스를 셋업할 때
- 새 운영 환경(다른 서버/다른 도메인)으로 이전할 때
- Cloudflare 계정이나 도메인을 교체할 때

---

## 사전 요구

- 신용카드 (도메인 등록비 연 $10 전후)
- 이메일 계정
- macOS 또는 Linux 서버 (여기서 봇/게이트웨이 실행)

---

## ✅ 체크리스트 (한 번만 실행)

### 1. 도메인 확보

**방식 A — Cloudflare Registrar에서 신규 구매 (권장)**
1. https://dash.cloudflare.com/ 회원가입
2. 좌측 메뉴 **Domain Registration** → 원하는 도메인 검색 → 구매
3. 자동으로 Cloudflare DNS에 연결됨 (네임서버 변경 불필요)

**방식 B — 기존 도메인을 Cloudflare로 이관**
1. Cloudflare 대시보드에서 `+ Add site` → 도메인 입력
2. Free 플랜 선택
3. 기존 등록업체(가비아, 카페24 등) 관리자페이지에서 **네임서버 변경**
   - Cloudflare가 안내한 2개의 네임서버로 교체
   - 반영까지 최대 24시간 소요
4. 반영 확인: Cloudflare 대시보드에서 도메인 상태 "Active"

### 2. `cloudflared` CLI 설치

```bash
# macOS
brew install cloudflared

# Linux (apt)
wget -q https://pkg.cloudflare.com/cloudflare-main.gpg -O - | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```

### 3. cloudflared 인증 (브라우저 필요)

```bash
cloudflared tunnel login
```

→ 브라우저가 열림 → Cloudflare 로그인 → 도메인 선택 → "Authorize"
→ `~/.cloudflared/cert.pem` 생성되면 성공

### 4. 터널 생성 (한 번만)

```bash
cloudflared tunnel create whosbuying
# 출력 예:
#   Created tunnel whosbuying with id 88f67e46-xxxx-xxxx
```

터널 ID를 기록해둔다. `~/.cloudflared/<TUNNEL_ID>.json` 파일도 자동 생성됨.

### 5. 프로젝트에 터널 자격증명 복사

```bash
PROJECT=~/Desktop/game-project/whosbuying/game_project_server
cp ~/.cloudflared/<TUNNEL_ID>.json "$PROJECT/infra/cloudflared/credentials.json"
```

### 6. config.yml 준비

`whosbuying/game_project_server/infra/cloudflared/config.yml` 작성:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: YOUR_DOMAIN
    service: http://nginx:80
  - hostname: api.YOUR_DOMAIN
    service: http://host.docker.internal:8080
  - hostname: admin.YOUR_DOMAIN
    service: http://host.docker.internal:4000
  - service: http_status:404
```

### 7. DNS 레코드 생성

각 서브도메인에 대해 한 번씩:
```bash
cloudflared tunnel route dns <TUNNEL_ID> YOUR_DOMAIN
cloudflared tunnel route dns <TUNNEL_ID> api.YOUR_DOMAIN
cloudflared tunnel route dns <TUNNEL_ID> admin.YOUR_DOMAIN
```

### 8. Discord 봇 셋업

1. https://discord.com/developers/applications → `New Application`
2. **Bot** 메뉴 → Token 복사
3. **OAuth2 URL Generator** → `bot` + `applications.commands` + Administrator 권한 체크 → 생성된 URL로 봇을 본인 서버에 초대
4. `project-manager/.env` 에 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` 입력

### 9. 관리자 자격증명 설정

`project-manager/.admin-credentials.json` 파일 생성:
```json
{
  "username": "원하는아이디",
  "password": "원하는비밀번호"
}
```

### 10. 서비스 시작

```bash
cd ~/Desktop/game-project/whosbuying/game_project_server
docker compose --profile prod up -d

cd ~/Desktop/game-project/project-manager
bash start.sh
```

---

## 🔁 이후부터는 AI 자동화

위 단계를 한 번 완료했다면, 이후 필요한 작업은 AI에게 이렇게 말하면 된다:

> "새 서브도메인 `dashboard.YOUR_DOMAIN` 을 내부 포트 4001로 연결해줘"

AI는 `CLOUDFLARE_AUTOMATION.md` 를 참조해서:
1. DNS CNAME 자동 등록 (`cloudflared tunnel route dns`)
2. `config.yml` 자동 수정
3. 컨테이너 재시작
4. 외부 접근 검증

까지 한 번에 처리한다.

---

## 💰 비용

| 항목 | 비용 |
|------|------|
| 도메인 (Cloudflare Registrar) | 연 $8~$12 |
| Cloudflare Free 플랜 (DNS/CDN/SSL/Tunnel) | $0 |
| Discord 봇 | $0 |
| 맥북/서버 운영 | 기존 전기·인터넷 |
| **월 합계** | **~$1** |

---

## 🆘 트러블슈팅

### `cloudflared tunnel login` 시 브라우저가 안 열림
- 원격 서버면 표시되는 URL을 복사해 본인 컴퓨터 브라우저에서 여세요.

### DNS 반영이 안 됨
- 네임서버 변경(방식 B) 직후면 최대 24시간 대기
- `dig YOUR_DOMAIN +short` 로 확인

### 터널은 돌지만 `502 Bad Gateway`
- 내부 서비스(nginx, 8080, 4000)가 실제로 돌고 있는지 확인
- Docker 네트워크에서 `host.docker.internal` 이 호스트를 가리키는지 확인

### 터널 상태 확인
```bash
cloudflared tunnel list
cloudflared tunnel info <TUNNEL_ID>
docker compose --profile prod logs cloudflared
```
