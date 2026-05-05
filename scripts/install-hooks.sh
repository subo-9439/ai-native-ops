#!/bin/bash
# PR-OPS-RESTART1 — git hooks 설치 스크립트.
#
# git config core.hooksPath 를 scripts/git-hooks/ 로 설정한다. .git/hooks/ 직접
# 복사 대신 core.hooksPath 를 쓰는 이유: hook 파일을 repo 에 commit 가능, 팀원
# 간 자동 동기화. 한 번만 실행하면 됨.
#
# 사용:
#   bash scripts/install-hooks.sh
#
# 해제:
#   git config --unset core.hooksPath

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/scripts/git-hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "[install-hooks] ❌ $HOOKS_DIR 없음" >&2
  exit 1
fi

# 모든 hook 파일에 +x 부여
for f in "$HOOKS_DIR"/*; do
  [ -f "$f" ] && chmod +x "$f"
done

git config core.hooksPath "scripts/git-hooks"

echo "[install-hooks] ✅ core.hooksPath = scripts/git-hooks"
echo "[install-hooks] 설치된 hook:"
ls -1 "$HOOKS_DIR" | sed 's/^/  • /'
echo ""
echo "[install-hooks] 우회 (1회) : SKIP_BOT_RESTART=1 git commit ..."
echo "[install-hooks] 영구 해제   : git config --unset core.hooksPath"
