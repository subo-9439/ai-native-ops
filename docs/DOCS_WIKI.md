# 문서 위키 사이트

## 개요

`whosbuying/docs/` (memory-bank 포함) + `project-manager/docs/` 의 마크다운을 웹으로 브라우징하는 위키.

**공개 접속**: https://admin.nolza.org/admin/wiki (인증 필요)
**내부 포트**: `127.0.0.1:4050` (게이트웨이 전용, 직접 접근 불가)

---

## 인증 방식

위키는 게이트웨이 뒤에 있어 인증 없이는 접근 불가.

| 방식 | 절차 |
|------|------|
| **브라우저 직접** | https://admin.nolza.org/admin/wiki → 로그인 페이지 → admin / password |
| **Discord 자동 로그인** | `/docs` 명령 → 봇이 발급한 SSO 링크 클릭 → 즉시 진입 (5분 일회용) |

자세한 인증 구조는 `MANAGEMENT_GATEWAY.md` 참조.

---

## 기능

- **카테고리 필터**: 프로젝트 / 🧠 Memory Bank / 운영 도구
- **정렬**: 최신순(수정일) / 이름순
- **검색**: 사이드바 실시간 필터
- **코드 하이라이팅**: highlight.js (github-dark)
- **게이트웨이 prefix 자동 적용**: `X-Forwarded-Prefix` 헤더로 모든 링크 자동 prefix

---

## 문서 구조

### 프로젝트 문서 (whosbuying/docs/)

| 문서 | 내용 |
|------|------|
| PRD.md | 프로젝트 개요, 화면 현황, 수익 모델 |
| ARCHITECTURE.md | 아키텍처, 채널 구분, 브릿지, 임베드 |
| BUSINESS_LOGIC_AND_TABLES.md | DB 스키마, 비즈니스 로직 |
| GAME_DESIGN.md | 미니게임 설계 |
| INFRASTRUCTURE.md | 인프라, CI/CD, Cloudflare Tunnel |
| TROUBLESHOOTING.md | 에러 추적, 버그 픽스 |
| DEV_GUIDE.md | UI 규칙, SQL 로깅 |
| AI_OPS.md | Cursor↔Claude 동기화 |
| API_REFERENCE.md | API 레퍼런스 |
| OPERATIONS_SETUP.md | 운영 환경 세팅 |
| CHANGELOG.md | 변경 이력 (자동 갱신) |
| WORK_LOG.md | 자동 생성 커밋 로그 |

### Memory-Bank (whosbuying/docs/memory-bank/)
| 파일 | 용도 |
|------|------|
| activeContext.md | 현재 작업 포커스 |
| progress.md | 기능별 진행 상태 |
| decisions.md | CEO 결정 로그 |
| systemPatterns.md | 코드 패턴 |

### 운영 도구 문서 (project-manager/docs/)
| 문서 | 내용 |
|------|------|
| DISCORD_BOT.md | 봇 커맨드, 채널 세션, 메모리 |
| DOCS_WIKI.md | (이 문서) |
| MANAGEMENT_GATEWAY.md | 인증 게이트웨이 |
| OPS_OVERVIEW.md | 운영 환경 전체 구성도 |
| CLOUDFLARE_AUTOMATION.md | AI 자동화 가이드 |
| CUSTOMER_ONBOARDING.md | 사람 1회 셋업 |

---

## API (Discord 봇/외부 연동용)

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/docs` | 전체 문서 목록 (`?cat=` 카테고리 필터) |
| `GET /api/docs/:slug` | 개별 문서 내용 (마크다운 원문) |
| `GET /health` | 헬스체크 |

> API는 인증 없이 호출 가능 (내부 포트 4050만 노출되므로).
> 게이트웨이를 통하면 `/admin/wiki/api/docs` 형태로 인증 필요.

---

## 환경 변수

| 변수 | 필수 | 설명 | 기본값 |
|---|---|---|---|
| `WIKI_PORT` | - | 포트 | `4050` |
| `DOCS_DIR` | - | docs 경로 | `CLAUDE_PROJECT_DIR/docs` |
| `OPS_DOCS_DIR` | - | 운영 도구 docs 경로 | `../docs` |
| `WIKI_BASE_PATH` | - | 기본 base path | (빈 값) |

런타임에는 게이트웨이가 보낸 `X-Forwarded-Prefix` 헤더가 우선 적용됨.

---

## 실행

```bash
# 위키만
cd project-manager/docs-wiki
bash start-local.sh

# 전체 (게이트웨이 포함)
bash project-manager/start.sh
```

위키만 단독 실행해도 동작하지만, 외부 접근 시에는 게이트웨이 경유 필수.
