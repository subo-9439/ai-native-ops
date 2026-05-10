#!/bin/bash
# PR-SERVICES-FLOW-WIKI — admin wiki 링크 Discord 공지 송신.
#
# 배경: 사용자 지시 (2026-05-10) — 서비스 흐름 wiki 완성 후 Discord 공지 채널에
# 링크 송신 + 핀 등록. Discord API 의 "Pin Message" 권한은 봇에 별도 부여 필요하므로
# 본 스크립트는 webhook 송신까지만 자동화하고, **사용자가 메시지 우클릭 → "공지로 등록"
# 또는 "메시지 고정" 수동 처리** 한다.
#
# 사용:
#   export DISCORD_NOTICE_WEBHOOK="https://discord.com/api/webhooks/..."
#   bash project-manager/discord-bot/scripts/announce-services-flow.sh
#
# Exit codes:
#   0 — 200 또는 204 응답 (성공)
#   1 — DISCORD_NOTICE_WEBHOOK 환경변수 미설정
#   2 — webhook 송신 실패 (HTTP 4xx/5xx)

set -e

WEBHOOK="${DISCORD_NOTICE_WEBHOOK:-}"
if [ -z "$WEBHOOK" ]; then
  echo "[announce] FAIL — DISCORD_NOTICE_WEBHOOK 환경변수 미설정"
  echo "[announce] 사용 예: export DISCORD_NOTICE_WEBHOOK=\"https://discord.com/api/webhooks/...\""
  exit 1
fi

WIKI_URL="${WIKI_URL:-https://nolza.org/admin/docs}"
LOCAL_URL="${LOCAL_URL:-http://localhost:5000/admin/docs}"

# Discord 색상 코드 — 5814783 = #58A6FF (블루)
PAYLOAD=$(cat <<JSON
{
  "embeds": [
    {
      "title": "📚 서비스 흐름 wiki — Discord + 누가살래 노드 다이어그램",
      "description": "**시나리오 흐름** 한눈에 보기 + 노드별 **관련 파일 / 통신 / 데이터** 상세.\n\n• prod: ${WIKI_URL}\n• 로컬: ${LOCAL_URL}\n\nADMIN_API_KEY 입력 후 'services-flow-overview' 클릭.\n\n**필독 노드** (overview 안의 [상세 보기] 클릭):\n• whosbuying-frontend\n• whosbuying-backend\n• whosbuying-data-layer\n• discord-bot\n• admin-tools",
      "color": 5814783,
      "url": "${WIKI_URL}",
      "footer": { "text": "PR-SERVICES-FLOW-WIKI · 핀 등록은 수동 (메시지 우클릭 → 메시지 고정)" }
    }
  ]
}
JSON
)

HTTP=$(curl -sS -o /tmp/announce-services-flow.out -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WEBHOOK")

if [ "$HTTP" = "200" ] || [ "$HTTP" = "204" ]; then
  echo "[announce] OK HTTP=$HTTP — 공지 채널 송신 완료."
  echo "[announce] 후속: Discord 에서 메시지 우클릭 → \"메시지 고정\" 수동 처리 필요."
  exit 0
else
  echo "[announce] FAIL HTTP=$HTTP"
  echo "[announce] 응답:"
  cat /tmp/announce-services-flow.out
  exit 2
fi
