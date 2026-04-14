#!/bin/bash
# 운영 도구 전체 시작
#   Gateway (4000, 공개)  ← 로그인 + 프록시
#   Discord 봇 (4040, 로컬)
#   Wiki (4050, 로컬)      ← 게이트웨이만 접근
#
# caffeinate 옵션:
#   -i  idle sleep 방지 (시스템 슬립 차단)
#   -s  AC 전원 시 시스템 슬립 차단
#   -d  는 일부러 안 씀 → 화면은 꺼져서 전력 절감
#   -w  $$ → 이 셸이 죽으면 caffeinate도 같이 종료

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== project-manager 시작 ==="

# 슬립 방지 (화면은 꺼져도 OK, 시스템만 깨어있음)
caffeinate -i -s -w $$ &
CAFFEINATE_PID=$!
echo "☕ 슬립 방지 활성 (PID $CAFFEINATE_PID, 화면은 꺼질 수 있음)"

cd "$SCRIPT_DIR/discord-bot"         && bash start-local.sh &
cd "$SCRIPT_DIR/docs-wiki"            && bash start-local.sh &
cd "$SCRIPT_DIR/management-gateway"   && bash start-local.sh &

echo ""
echo "🌐 사용자 접속: https://admin.nolza.org/admin/wiki"
echo "🤖 Discord 봇: /docs 명령으로 자동 로그인 링크 발급"
echo "💡 이 스크립트 종료 시 caffeinate도 함께 종료 (Ctrl+C)"
echo ""

wait
