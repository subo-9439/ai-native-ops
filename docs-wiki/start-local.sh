#!/bin/bash
# 문서 위키 서버 로컬 실행

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PM_ENV="$SCRIPT_DIR/../.env"
FALLBACK_ENV="$SCRIPT_DIR/../../whosbuying/.env"

set -a
if [ -f "$PM_ENV" ]; then
  source "$PM_ENV"
elif [ -f "$FALLBACK_ENV" ]; then
  source "$FALLBACK_ENV"
fi
set +a

export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../whosbuying" && pwd)}"
export DOCS_DIR="${DOCS_DIR:-$CLAUDE_PROJECT_DIR/docs}"
export WIKI_PORT="${WIKI_PORT:-4050}"

echo "[Wiki] docs: $DOCS_DIR"
echo "[Wiki] port: $WIKI_PORT"

cd "$SCRIPT_DIR"
node index.js
