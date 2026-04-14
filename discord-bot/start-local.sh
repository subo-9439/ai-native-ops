#!/bin/bash
# Discord 봇 로컬 실행 스크립트
# Claude CLI 실행을 위해 로컬에서만 동작
# 다른 프로젝트로 전환 시 CLAUDE_PROJECT_DIR, GAME_SERVER_URL만 변경

# .env 우선순위:
#   1) project-manager/.env (운영 도구 전용)
#   2) ../../whosbuying/.env (fallback — 기존 프로젝트 공유)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PM_ENV="$SCRIPT_DIR/../.env"
FALLBACK_ENV="$SCRIPT_DIR/../../whosbuying/.env"

set -a
if [ -f "$PM_ENV" ]; then
  source "$PM_ENV"
  echo "[Bot] env source: project-manager/.env"
elif [ -f "$FALLBACK_ENV" ]; then
  source "$FALLBACK_ENV"
  echo "[Bot] env source: whosbuying/.env (fallback)"
else
  echo "[Bot] [WARN] .env not found at $PM_ENV or $FALLBACK_ENV"
fi
set +a

export GAME_SERVER_URL="${GAME_SERVER_URL:-http://localhost:8080}"
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../whosbuying" && pwd)}"
export BOT_HTTP_PORT="${BOT_HTTP_PORT:-4040}"

echo "[Bot] 프로젝트: $CLAUDE_PROJECT_DIR"
echo "[Bot] 게임서버: $GAME_SERVER_URL"
echo "[Bot] HTTP 포트: $BOT_HTTP_PORT"

cd "$SCRIPT_DIR"
node index.js
