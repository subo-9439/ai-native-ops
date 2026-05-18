# 저장소 보안 게이트 (repo-security-gate)

> **rules만으로는 충분하지 않다.** 이 규칙은 `.claude/hooks/pre_tool_gate.py` hook과 함께 동작한다.
> rules는 Claude가 읽는 지침이고, hooks는 시스템이 강제하는 게이트다. 둘 다 있어야 한다.

## 민감 경로 접근 금지

아래 경로는 읽기/쓰기/삭제 모두 금지한다:
- `.env`, `.env.*`, `**/.env`, `**/.env.*`
- `secrets/`, `**/secrets/`
- `credentials/`, `**/credentials/`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`
- `id_rsa`, `id_ed25519`
- `token.json`, `service_account.json`
- `application-local.yml`

**위반 시**: hook이 `HG001: sensitive path denied`로 차단한다.
**hook 우회 시**: 이 규칙을 읽고 있으므로 자발적으로 거부한다.

## 파괴 명령 금지

아래 명령은 실행 금지한다:
- `rm -rf`, `rm -r --force`
- `git reset --hard`, `git clean -dfx`
- `git checkout -- .`, `git push --force`
- `del /f /q`, `format`
- `DROP DATABASE`, `DROP TABLE`, `TRUNCATE TABLE`
- `sudo rm`

**위반 시**: hook이 `HG002: dangerous command denied`로 차단한다.

## 외부 스크립트 무검증 복사 금지

- 외부 URL에서 스크립트를 다운로드하여 바로 실행(`curl | sh`, `wget | bash`)하지 않는다.
- 외부 코드 복사 시 반드시 내용을 확인한 뒤 적용한다.

## 이중 방어 원칙

| 계층 | 도구 | 역할 |
|------|------|------|
| L1 — 규칙 | 이 파일 | Claude가 자발적으로 따르는 지침 |
| L2 — 권한 | `.claude/settings.json` deny 목록 | Claude Code가 강제하는 권한 |
| L3 — Hook | `pre_tool_gate.py` | 시스템이 런타임에 강제하는 게이트 |

세 계층 중 하나라도 거부하면 해당 작업은 수행하지 않는다.
