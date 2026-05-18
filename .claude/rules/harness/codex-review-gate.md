# Codex 리뷰 게이트 (codex-review-gate)

> **rules만으로는 충분하지 않다.** 이 규칙은 `scripts/codex-review.sh` + `bin/codexw` +
> post-commit hook 과 함께 동작한다. rules는 Claude가 읽는 지침, hook 은 시스템이
> 매 commit 후 자동 호출하는 검수자.

## 원칙

Claude 가 작성한 코드는 **Codex (외부 검수자)** 가 매 commit 후 자동 점검한다.

- **Claude** = 기획 + 구현 + 자가 검증
- **Codex** = 외부 검증 + 회귀 분석 + 기획↔구현 일치 검토 + 코드 품질

자가 검증만으로는 confirmation bias 발생. 2-agent 이중 검증 (PR-AGENT-OPS-IMPL1).

## 트리거 (자동 + 수동)

| 트리거 | 동작 |
|--------|------|
| **post-commit hook** (자동) | 매 commit 후 `scripts/codex-review.sh` 백그라운드 호출 |
| `---CODEX---` 디스패치 (수동) | Discord 봇에서 명시 요청 (claude.js routing) |
| `bin/codexw review --commit HEAD` (수동) | 사용자가 직접 CLI 호출 |

## 입력 (Codex 에 전달)

1. **git diff HEAD~1..HEAD** — 이번 commit 변경
2. **commit 메시지** (PR-XXX 매칭용)
3. **기획서** (`docs/product/<feature>-plan.md` — 자동 매칭)
4. **영향 매트릭스** (commit 메시지의 "영향 화면 N개" 자동 추출)

## 출력 (3-tier)

| Tier | 위치 | 용도 |
|------|------|------|
| **영구** | `docs/codex-review/<short-sha>.md` | git tracked + history |
| **즉시** | Discord webhook 1줄 (옵션 — `DISCORD_CODEX_WEBHOOK` 환경변수) | 채널 알림 |
| **조회** | `.agent/harness/memory/codex_reviews.jsonl` | 누적 로그 (검색용) |

## Codex 리뷰 5항목 (필수 평가)

매 리뷰는 다음 5 항목을 ✓/⚠️/❌ 평가 + 한 줄 사유:

1. **기획 일치** — 기획서 6 결정사항 모두 구현됐는가?
2. **회귀 위험** — 영향 매트릭스 누락 또는 후속 화면 영향 X 했나?
3. **DoD 7항목** — 통과 증거 (analyze + test) 첨부됐나?
4. **의도 추론** — 표면 vs 사용자 의도 분리 명시됐나?
5. **코드 품질** — 네이밍 / 중복 / SSOT 준수 적정한가?

## 답변 검증 표현 (필수)

Codex 응답에 다음 한 줄 명시 의무 (마지막 줄):

```
코덱스 검수 완료: 기획 일치 X / 회귀 X / DoD X / 의도 X / 품질 X / 보강 필요=<항목 또는 X>
```

→ 누락 시 Claude 가 자가 보고 + 다음 응답에서 보강.

## 한국어 강제

Codex 응답은 **반드시 한국어**.

- `bin/codexw` wrapper 가 prompt 끝에 "모든 답변은 한국어로 작성하세요" 자동 append
- 영문 응답 시 hook 에서 경고 + Claude 가 재호출 (후속 PR)

## 적용 대상

다음 commit 에 자동 발동:

- ✅ feat / fix / refactor / docs / chore 모두
- ❌ skip: `docs: update work log [skip ci]` (post-commit 자동 갱신)
- ❌ skip: `chore(handover):` (핸드오버 자동 갱신)

## 실패 처리 (운영 가능성 우선)

- Codex CLI 미설치 → warning + skip (commit 통과)
- Codex 호출 오류 → warning + skip
- node 버전 미달 (v16 미만) → warning + skip
- Codex 응답 한국어 X → warning + 재호출 (후속 PR)

**원칙**: Codex 검수 실패로 commit 자체 차단 X (operational-workflow-gate 6조 "운영 가능성 우선").

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 | Claude 자발적 인지 + Codex 응답 검증 표현 강제 |
| L2 — Hook | `scripts/git-hooks/post-commit` | 매 commit 후 자동 codex-review.sh 호출 |
| L3 — Codex CLI | `bin/codexw` wrapper + `codex review --commit HEAD` | 외부 검수자 호출 |

세 계층 중 하나라도 실패 시 warning 로그 + commit 통과 (운영 가능성).

## 적용 제외

- 메모리/문서/handover 자동 갱신 commit (위 "적용 대상" 참조)
- `~/.claude/` 글로벌 설정 변경 (사용자 직접 작업, repo 외부)

## 위반 시

- L1: Claude 자발적으로 다음 응답에서 Codex 리뷰 결과 read + 보강
- 사후 발견 시: `docs/codex-review/<sha>.md` 의 ⚠️/❌ 항목별 후속 PR

## 후속 PR 후보

- **PR-AGENT-OPS-IMPL2** — Admin 노드 그래프 (현재 게이트도 노드로 시각화)
- **PR-AGENT-OPS-IMPL3** — Discord 공지 자동 고정
- **PR-CODEX-REVIEW-DASHBOARD** (선택) — `docs/codex-review/*.md` 통계 대시보드
