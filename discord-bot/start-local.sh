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

# 기존 봇 프로세스 grace kill (재시작 신뢰성 보장)
# 원인 사고: 2026-04-20 OPS3~6 코드 수정 후 start.sh 재실행했으나
# 기존 PID가 죽지 않아 새 코드가 메모리에 안 올라옴 (50시간 stale)
# (1) macOS ko_KR.UTF-8에서 pgrep이 "illegal byte sequence"로 실패 → LC_ALL=C 강제
# (2) 이 스크립트는 `cd $SCRIPT_DIR && exec node index.js` 구조라
#     ps 상의 command가 "node index.js"로만 보여 경로 매칭(-f "discord-bot/index\.js")에
#     걸리지 않음. 포트 4040(BOT_HTTP_PORT) 기반 보조 탐색으로 커버.
EXISTING_PID="$(LC_ALL=C pgrep -f "discord-bot/index\.js$" 2>/dev/null || true)"
if [ -z "$EXISTING_PID" ]; then
  # 포트로 재탐색 (가장 확실한 방법 — 포트 점유자 = 봇 본체)
  EXISTING_PID="$(lsof -iTCP:${BOT_HTTP_PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
fi
if [ -n "$EXISTING_PID" ]; then
  echo "[Bot] 기존 PID $EXISTING_PID 종료 (SIGTERM)"
  kill -TERM $EXISTING_PID 2>/dev/null || true
  for i in 1 2 3 4 5; do
    sleep 1
    kill -0 $EXISTING_PID 2>/dev/null || break
  done
  if kill -0 $EXISTING_PID 2>/dev/null; then
    echo "[Bot] 응답 없음 → SIGKILL"
    kill -KILL $EXISTING_PID 2>/dev/null || true
    sleep 1
  fi
fi

echo "[Bot] 새 인스턴스 기동"
exec node index.js
