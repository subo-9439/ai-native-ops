# Desktop Bridge 정책 (desktop-bridge-policy)

> **rules만으로는 충분하지 않다.** 이 규칙은 `whosbuying-bridge` MCP 서버
> (`scripts/bridge-mcp/server.cjs`) + 30분 cron `audit_desktop_bypass.py` 와 함께 동작한다.
> rules는 Claude가 자발적으로 따르는 지침, MCP는 채널 협소화, cron 은 사후 감사.

## 원칙

Claude Desktop 은 Anthropic 측 제어로 PreToolUse hook 강제가 불가능하다.
대신 **whosbuying 프로젝트 작업은 `whosbuying-bridge` MCP 도구만 사용**하도록
채널을 좁혀 동일 보안 검증을 적용한다.

## 적용 대상

Claude Desktop 에서 whosbuying 프로젝트(`/Users/kimsubo/Desktop/game-project/whosbuying`)
관련 작업을 할 때:

- 파일 읽기 → `whosbuying-bridge.safe_read`
- 파일 편집/생성 → `whosbuying-bridge.safe_edit`
- 셸 실행 → `whosbuying-bridge.safe_bash`
- 컨텍스트 조회 → `whosbuying-bridge.get_project_context`
- 결정 기록 → `whosbuying-bridge.record_decision`

## 금지 행동

- Desktop 의 **filesystem MCP / computer-use** 로 whosbuying 코드 직접 수정 금지
- 위 도구 우회로 `git`/`rm`/`mv` 같은 셸 명령 직접 실행 금지
- `safe_*` 도구가 `isError:true` 로 차단했을 때 우회 시도 금지

## 우회 발견 시 자가 보고

만약 위 규칙을 어기고 직접 fs 를 만졌다면, 다음 응답에서 즉시 사용자에게 보고한다:

```
[자가 보고] desktop-bridge 우회 발생 — <어떤 도구로> <어떤 파일을> 수정했음. 사후 감사 기록.
```

## 사후 감사 메커니즘

`.agent/harness/scripts/audit_desktop_bypass.py` 가 30분 cron 으로 실행:

1. `.ops/context.jsonl` 에서 Desktop source 활동 시간대 식별
2. 같은 시간대에 git working tree dirty 변화 (`git status --porcelain`) 탐지
3. 변화는 있는데 `safe_*` 호출 기록이 없으면 **HG008: desktop bypass suspected** 보고

본 규칙 위반은 **차단되지 않고 보고만 된다** (best effort).

## 한계 (정직히 명시)

- Desktop 에서 사용자가 직접 컴퓨터를 조작하면 감지 불가
- MCP 등록을 끄거나 다른 도구로 우회하는 것은 막을 수 없음
- 본 규칙은 "신뢰 기반" — 동일 보안 등급은 CLI / Discord 봇 만 보장

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 + `bridge-mcp/instructions.md` | Claude 자발적 준수 (Desktop 시스템 프롬프트로 흡수) |
| L2 — MCP | `whosbuying-bridge` MCP 서버 | 도구 호출 시점에 HG001/HG002 검증 |
| L3 — Cron | `audit_desktop_bypass.py` (30분) | 사후 감지 + 보고 |

## 진입점 동등성 매트릭스 (PR0~PR5 결과)

| 항목 | CLI(claudew) | Discord 봇 | Desktop |
|------|:-:|:-:|:-:|
| CLAUDE.md / rules / agents | ✅ 자동 | ✅ buildFullPrompt | ✅ Bridge MCP `get_project_context` |
| Memory-Bank 4파일 | ✅ | ✅ | ✅ |
| HG001/HG002 (정책 SSOT yaml) | ✅ pre_tool_gate.py | ✅ pre-tool-gate.js | ✅ Bridge MCP safe_* |
| MCP 서버 (chrome-devtools/dart/figma/whosbuying-bridge) | ✅ ~/.claude.json | ✅ 서브프로세스 상속 | ✅ Desktop config |
| Sub-agent 자동 라우팅 | ✅ router.cjs | ✅ 동일 SSOT | ✅ get_project_context role=auto |
| Thread / sync events / 첨부 | ✅ wrapper | ✅ Discord native | ✅ Desktop native |

세 계층 중 하나라도 거부하면 해당 작업은 수행하지 않는다.
