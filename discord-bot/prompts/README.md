# Discord 봇 페르소나 SSOT (PR-ROLE2)

`commands/claude.js` 의 `AGENT_CONTEXTS` 가 require 하는 페르소나 .md 파일들. 본 디렉토리가 페르소나 SSOT.

## 구조

| 파일 | 역할 | 적용 대상 |
|------|------|----------|
| `dev.md` | 풀스택 개발 base + 의도 추론 의무 | `dev`, `잡담` (default), 그리고 backend/frontend/ai delta 의 base |
| `backend-dev-delta.md` | 백엔드 12항목 품질 기준 (delta) | `---BE---` 디스패치 |
| `frontend-dev-delta.md` | 프론트 14항목 + 게임 애니 reference + DoD 7항목 (delta) | `---FE---` 디스패치 |
| `ai-dev-delta.md` | AI 서버 7항목 (delta) | `---AI---` 디스패치 |
| `ceo.md` | 기획 어드바이저 + 5종 점검 + 모바일/웹 깊이 + 디스패치 의무 | `#기획실` |
| `design-director.md` | 아트 디렉터 + 게임 UX (5-역할 합본) + 게임 애니 reference SSOT | `#design-director` 또는 별도 호출 |
| `plan.md` | 읽기 전용 계획 검토 (Edit/Write/git 금지) | `--plan` 옵션 |

## delta 패턴 (base + delta)

`backend-dev` / `frontend-dev` / `ai-dev` 는 dev.md 의 `[작업 지시]` 를 각 delta 파일 내용으로 대체:

```js
const AGENT_CONTEXTS = {
  'backend-dev':  DEV_CONTEXT.replace('[작업 지시]', BE_DELTA),
  // ...
};
```

→ DRY 유지. dev.md 의 공통 의무 (Memory-Bank, 의도 추론, Flutter 게이트) 가 모든 delta 에 자동 상속.

## 변경 시 워크플로

1. 본 디렉토리 .md 파일 수정 (페르소나 변경)
2. `node -e "require('./commands/claude.js'); console.log('ok')"` syntax check
3. `bin/claudew --role <X> --dry-run "테스트"` 출력 확인
4. commit + push (post-commit hook 이 봇 자동 재기동)
5. Discord 다음 메시지부터 강화된 페르소나 적용

## 4 entry point 동시 적용

| Entry point | 페르소나 로딩 |
|-------------|--------------|
| CLI (`bin/claudew`) | `scripts/context-loader/cli.cjs` → `commands/claude.js` AGENT_CONTEXTS |
| Discord 봇 | `claude.js` 자체 |
| Bridge MCP (Desktop) | `whosbuying-bridge` MCP → `claude.js` 동일 |
| 디스패치 분기 (`---BE/FE/AI---`) | `resolveTargets` → channelName 별 페르소나 자동 라우팅 |

→ 본 디렉토리 한 번 수정하면 4 경로 동시 적용.
