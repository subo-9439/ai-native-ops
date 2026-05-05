#!/bin/bash
# PR-OPS-RESTART1 — Discord 봇 안전 재기동.
#
# 배경: 2026-05-04~05 사고 — `lsof | xargs kill -9` 가 빈 결과 시 사일런트 실패하여
# 새 코드 반영 안 된 채 옛 봇이 40시간 떠있었음. PID 명시 + 종료 검증 + 부팅 대기로
# "재기동했다고 생각했지만 실제로는 안 됐다" 패턴 차단.
#
# 동작:
#   1) BOT_HTTP_PORT(기본 4040) 점유 PID 조회
#   2) PID 있으면 kill -9 후 종료 검증 (max 5초)
#   3) start-local.sh 백그라운드 기동
#   4) /health 200 응답까지 대기 (max 15초)
#   5) 결과 보고 (새 PID, 소요 시간) — 실패 시 exit 1/2
#
# 사용:
#   bash discord-bot/restart-local.sh
#
# Exit codes:
#   0 — 재기동 + 헬스 200 확인
#   1 — 옛 PID 5초 안에 안 죽음 (강제 fix 필요)
#   2 — 15초 안에 헬스 200 못 받음 (로그 확인 필요)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${BOT_HTTP_PORT:-4040}"
LOG_FILE="${BOT_LOG_FILE:-/tmp/discord-bot.log}"
KILL_TIMEOUT="${BOT_KILL_TIMEOUT:-5}"
BOOT_TIMEOUT="${BOT_BOOT_TIMEOUT:-15}"

echo "[restart] === Discord 봇 재기동 ==="
echo "[restart] port=$PORT log=$LOG_FILE"

# ── 1. 기존 봇 PID 검증 + 종료 ──────────────────────────────
PID="$(lsof -ti :$PORT 2>/dev/null || true)"
if [ -n "$PID" ]; then
  ETIME="$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ' || echo '?')"
  echo "[restart] 기존 봇 PID $PID (uptime $ETIME) 종료 시도"
  kill -9 "$PID" 2>/dev/null || true

  KILLED=0
  for i in $(seq 1 "$KILL_TIMEOUT"); do
    sleep 1
    if [ -z "$(lsof -ti :$PORT 2>/dev/null || true)" ]; then
      echo "[restart] ✅ PID $PID 종료 확인 (${i}초)"
      KILLED=1
      break
    fi
  done

  if [ "$KILLED" != "1" ]; then
    echo "[restart] ❌ PID $PID 가 ${KILL_TIMEOUT}초 안에 안 죽음. 수동 점검 필요." >&2
    echo "[restart] $ ps -p $PID -o pid,etime,comm,args" >&2
    ps -p "$PID" -o pid,etime,comm,args 2>&1 >&2 || true
    exit 1
  fi
else
  echo "[restart] 기존 봇 없음 (포트 $PORT free)"
fi

# ── 2. 새 봇 백그라운드 기동 ────────────────────────────────
echo "[restart] start-local.sh 백그라운드 기동 → $LOG_FILE"
cd "$SCRIPT_DIR"
nohup bash start-local.sh > "$LOG_FILE" 2>&1 &
NEW_BG_PID="$!"
disown -a 2>/dev/null || true

# ── 3. 헬스 200 까지 대기 ──────────────────────────────────
for i in $(seq 1 "$BOOT_TIMEOUT"); do
  sleep 1
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo '000')"
  if [ "$CODE" = "200" ]; then
    NEW_PID="$(lsof -ti :$PORT 2>/dev/null || echo '?')"
    echo "[restart] ✅ 부팅 완료 — PID $NEW_PID (소요 ${i}초)"
    echo "[restart] /health: $(curl -sS --max-time 1 http://127.0.0.1:$PORT/health 2>/dev/null || echo 'n/a')"
    exit 0
  fi
done

echo "[restart] ⚠️ ${BOOT_TIMEOUT}초 안에 /health 200 못 받음 (현재: $CODE)" >&2
echo "[restart] 로그 확인: tail -50 $LOG_FILE" >&2
echo "[restart] 봇 백그라운드 PID 추적: $NEW_BG_PID" >&2
exit 2
