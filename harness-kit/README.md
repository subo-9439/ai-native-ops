# harness-kit

Claude Code 하네스(hooks + rules + `.agent/harness` 런타임)의 **기본 틀(base template)** 을 중앙에서 관리한다.

## 철학 — Init-only (base template)

- kit은 **신규 repo의 "시작 템플릿"** 이다. 설치 후 각 repo는 자유롭게 수정 가능.
- `apply.sh` 는 기존 설치를 **덮어쓰지 않는다**. 재실행은 안전.
- **업그레이드는 수동 머지**. kit은 강제 sync 하지 않는다.
- drift는 "틀린 것"이 아니라 "각 repo가 진화한 흔적"이다.

## 구조

```
harness-kit/
├── VERSION                        # kit 자체 버전
├── registry.yaml                  # 관리 대상 repo 목록 (정보용)
├── hooks-settings.json            # settings.json 의 hooks 섹션 기본값
├── hooks/                         # → 대상/.claude/hooks/
├── rules/                         # → 대상/.claude/rules/harness/
├── harness-core/                  # → 대상/.agent/harness/
├── templates/
│   └── memory-bank/               # 빈 메모리뱅크 (최초 1회만 복사)
└── scripts/
    ├── apply.sh <target>          # 신규 설치 (init-only)
    ├── apply-all.sh               # registry 전체 설치
    └── check-drift.sh <target>    # 원본 vs 대상 diff (정보성)
```

## 사용법

### 신규 repo에 하네스 최초 설치
```bash
cd project-manager/harness-kit
./scripts/apply.sh ../my-new-service
```
- 이미 하네스가 있는 repo에 재실행해도 안전 — 기존 파일은 건드리지 않고 `skip` 출력.

### 완전 초기화 (주의, 파괴적)
```bash
./scripts/apply.sh ../my-service --force
```
- 기존 `.claude/hooks/`, `.claude/rules/harness/`, `.agent/harness/` 전체를 kit 원본으로 **덮어쓴다**.
- 런타임 상태(`events.jsonl`, `lessons.current.json`, `rule_candidates.current.json`)는 보존.
- **repo별 커스터마이징이 있었다면 모두 날아감.** 실수 방지용 5초 카운트다운.

### drift 검사 (정보성)
```bash
./scripts/check-drift.sh ../whosbuying
```
- 종료코드: 0 = kit과 완전 동일, 1 = 차이 존재
- **차이 존재가 에러는 아니다.** base-template 철학상 repo별 커스터마이징은 정상.
- CI에서는 **실패가 아니라 알림용**으로 사용 권장.

### 대량 설치 (신규 repo 일괄)
```bash
./scripts/apply-all.sh              # init-only (기존 repo 안 건드림)
./scripts/apply-all.sh --dry-run    # 미리보기
./scripts/apply-all.sh --force      # 전부 초기화 (위험)
```

## 업그레이드 워크플로 (수동 머지)

kit 원본이 개선됐을 때, 각 repo 담당자가 **선택적으로** 가져간다.

1. kit 원본 수정: `harness-kit/hooks/`, `rules/`, `harness-core/`
2. `harness-kit/VERSION` bump + 변경 요약 커밋
3. 알림: 각 repo 담당자에게 "kit vX.Y.Z 나왔음, 관심 있으면 머지"
4. 각 repo에서:
   ```bash
   ./scripts/check-drift.sh ../my-repo           # 어디가 다른지 확인
   diff -r harness-kit/hooks ../my-repo/.claude/hooks   # 실제 파일 diff
   # → 필요한 부분만 골라서 수동 머지 + repo 커밋
   ```
5. 전면 재설치를 원하면 `apply.sh --force` (커스터마이징 날아감)

## 대상 repo 규약

| 경로 | 정책 |
|------|------|
| `.claude/hooks/` | kit에서 시작, repo별 수정 자유 |
| `.claude/rules/harness/` | kit에서 시작, repo별 수정 자유 |
| `.agent/harness/` | kit에서 시작, repo별 수정 자유 |
| `.claude/settings.json` hooks 섹션 | kit에서 시작, repo별 수정 자유 |
| `.claude/settings.json` 외 섹션 | repo 고유 (kit이 건드리지 않음) |
| `.agent/harness/memory/raw/events.jsonl` | **런타임 상태** — kit이 절대 건드리지 않음 |
| `.agent/harness/memory/current/*.json` | **런타임 상태** — kit이 절대 건드리지 않음 |
| `docs/memory-bank/` | kit이 최초 1회만 빈 템플릿 복사 |

## 안 다루는 것

- repo별 `CLAUDE.md` — 내용이 repo마다 다르므로 kit 범위 밖
- Claude Code 외 에이전트 (Cursor, OpenHands 등) — 현재 kit은 Claude Code 전용

## 관련

- `whosbuying/docs/OPERATIONS_SETUP.md` — 서비스 인프라/배포 가이드
- `whosbuying/.agent/harness/bootstrap/bootstrap-spec.md` — 하네스 내부 스펙
