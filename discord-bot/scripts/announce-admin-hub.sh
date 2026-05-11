#!/bin/bash
# PR-AGENT-OPS-IMPL3 pre — admin hub 통합 링크 Discord 공지.
#
# PR-ADMIN-UNIFIED (2026-05-11) 완료 — admin_ops/admin_docs/codex-review/kill-switch
# 5 카테고리 단일 진입점 /#/admin 통합. 본 스크립트가 모든 admin URL + 카테고리
# embed 메시지로 Discord 공지 채널 송신.
#
# 사용:
#   export DISCORD_NOTICE_WEBHOOK="https://discord.com/api/webhooks/..."
#   bash project-manager/discord-bot/scripts/announce-admin-hub.sh
#
# Exit codes:
#   0 — 200/204 (성공)
#   1 — DISCORD_NOTICE_WEBHOOK 환경변수 미설정
#   2 — webhook 송신 실패

set -e

WEBHOOK="${DISCORD_NOTICE_WEBHOOK:-}"
if [ -z "$WEBHOOK" ]; then
  echo "[announce-admin-hub] FAIL — DISCORD_NOTICE_WEBHOOK 환경변수 미설정"
  echo ""
  echo "사용 예:"
  echo '  export DISCORD_NOTICE_WEBHOOK="https://discord.com/api/webhooks/.../..."'
  echo "  bash project-manager/discord-bot/scripts/announce-admin-hub.sh"
  echo ""
  echo "Webhook 생성 방법:"
  echo "  Discord 공지 채널 우클릭 → 채널 편집 → 통합 → 웹후크 → 새 웹후크 → URL 복사"
  exit 1
fi

PROD_BASE="${PROD_BASE:-https://nolza.org}"
LOCAL_BASE="${LOCAL_BASE:-http://localhost:5000}"

# Discord embed color — 0x10A37F = OpenAI 그린 (10A37F = 1090943)
PAYLOAD=$(cat <<JSON
{
  "embeds": [
    {
      "title": "🛠️ 누가살래 Admin Hub — 통합 진입점 + 카테고리",
      "description": "**Admin 페이지가 하나로 통합됐어요** (PR-ADMIN-UNIFIED). 좌측 NavigationRail / 하단 BottomNavBar 로 5 카테고리 전환.\n\n**🔗 Admin 통합 진입점**\n• prod: ${PROD_BASE}/#/admin\n• 로컬: ${LOCAL_BASE}/#/admin\n\n첫 진입 시 ADMIN_API_KEY 입력 (로컬: \`application-local.yml\` L40 참조 / prod: 배포 환경변수).",
      "color": 1090943,
      "url": "${PROD_BASE}/#/admin",
      "fields": [
        {
          "name": "📊 운영 모니터링 (ops)",
          "value": "recent-errors / recent-slow / summary (실시간 ring-buffer)\nBE: \`${PROD_BASE}/api/v1/admin/ops\` (Bearer)",
          "inline": false
        },
        {
          "name": "📖 시스템 문서 (docs)",
          "value": "Admin 전용 wiki — markdown viewer + 좌측 목록",
          "inline": false
        },
        {
          "name": "🗺️ 서비스 흐름 (services-flow)",
          "value": "Discord + 누가살래 노드 다이어그램 + 시나리오 흐름 + 5 노드 상세\n→ 좌측 목록의 \`services-flow-overview\` 클릭",
          "inline": false
        },
        {
          "name": "🔍 Codex 검수 리뷰",
          "value": "매 commit 의 Codex 자동 검수 결과 (한국어, 5항목 평가)\n→ \`docs/codex-review/<sha>.md\` 영구 기록",
          "inline": false
        },
        {
          "name": "🚨 Kill Switch",
          "value": "긴급 서비스 중단 토글 (Redis 기반)\nBE: \`${PROD_BASE}/api/v1/admin/kill-switch\` GET/POST",
          "inline": false
        },
        {
          "name": "⚙️ 부속 인프라 (BASIC AUTH 별도)",
          "value": "• Actuator: \`${PROD_BASE}/actuator/health\` (admin / ACTUATOR_PASSWORD)\n• Grafana: \`http://localhost:3001\` (admin/admin)\n• Prometheus: \`http://localhost:9090\`\n• RabbitMQ Mgmt: \`http://localhost:15672\` (guest/guest)",
          "inline": false
        }
      ],
      "footer": { "text": "PR-AGENT-OPS-IMPL3 pre · 본 메시지 우클릭 → 메시지 고정 (수동 핀)" }
    }
  ]
}
JSON
)

HTTP=$(curl -sS -o /tmp/announce-admin-hub.out -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WEBHOOK")

if [ "$HTTP" = "200" ] || [ "$HTTP" = "204" ]; then
  echo "[announce-admin-hub] OK HTTP=$HTTP — 공지 채널 송신 완료."
  echo ""
  echo "후속 (사용자 수동):"
  echo "  1. Discord 에서 방금 송신된 메시지 우클릭"
  echo "  2. '메시지 고정' 또는 '공지로 등록' 클릭"
  echo "  3. 핀 메시지로 영구 고정"
  echo ""
  echo "(향후 PR-AGENT-OPS-IMPL3 에서 자동 핀 등록 — 봇 Manage Messages 권한 필요)"
  exit 0
else
  echo "[announce-admin-hub] FAIL HTTP=$HTTP"
  echo "응답:"
  cat /tmp/announce-admin-hub.out
  exit 2
fi
