#!/bin/bash
# 관리 게이트웨이 로컬 실행
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PM_ENV="$SCRIPT_DIR/../.env"

set -a
[ -f "$PM_ENV" ] && source "$PM_ENV"
set +a

export GATEWAY_PORT="${GATEWAY_PORT:-4000}"
export WIKI_INTERNAL_URL="${WIKI_INTERNAL_URL:-http://127.0.0.1:4050}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://localhost:$GATEWAY_PORT}"

echo "[Gateway] port: $GATEWAY_PORT"
echo "[Gateway] public: $PUBLIC_BASE_URL"

cd "$SCRIPT_DIR"
node index.js
