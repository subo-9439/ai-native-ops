#!/bin/bash
# Discord 봇 로컬 실행 스크립트
# Claude CLI 실행을 위해 로컬에서만 동작
# 다른 프로젝트로 전환 시 CLAUDE_PROJECT_DIR, GAME_SERVER_URL만 변경

set -a
source "$(dirname "$0")/../.env"
set +a

export GAME_SERVER_URL="${GAME_SERVER_URL:-http://localhost:8080}"
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "[Bot] 프로젝트: $CLAUDE_PROJECT_DIR"
echo "[Bot] 게임서버: $GAME_SERVER_URL"

cd "$(dirname "$0")"
node index.js
