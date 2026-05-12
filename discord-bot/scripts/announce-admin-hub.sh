#!/bin/bash
# PR-ADMIN-DEEPLINK (2026-05-12) — admin 통합 hub + **모든 페이지 직접 링크** Discord 공지.
#
# 변경 (PR-AGENT-OPS-IMPL3 pre → DEEPLINK):
#   - 5 카테고리 모두 직접 URL deeplink 노출 (/admin/ops .. /admin/kill)
#   - 노드형태로 보는 서비스 흐름 페이지 별도 강조 (/admin/flow + 5 노드 ID)
#   - Codex 검수 리뷰 GitHub 폴더 직접 링크
#   - 부속 인프라 (actuator/grafana/prometheus/rabbitmq) 모두 표기
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
REPO_BASE="${REPO_BASE:-https://github.com/kws3363/whosbuying}"

# Discord embed color — 0x10A37F = OpenAI 그린 (10A37F = 1090943)
PAYLOAD=$(cat <<JSON
{
  "embeds": [
    {
      "title": "🛠️ 누가살래 Admin Hub — 모든 페이지 직접 링크",
      "description": "**Admin 페이지 5 카테고리 모두 직접 URL 진입 가능** (PR-ADMIN-DEEPLINK). 첫 진입 시 ADMIN_API_KEY 입력 (로컬: \`application-local.yml\` L40 / prod: 배포 환경변수).\n\n**🔗 통합 진입점**\n• prod: ${PROD_BASE}/#/admin\n• 로컬: ${LOCAL_BASE}/#/admin",
      "color": 1090943,
      "url": "${PROD_BASE}/#/admin",
      "fields": [
        {
          "name": "📊 운영 모니터링 (ops)",
          "value": "실시간 ring-buffer (recent-errors / recent-slow / summary)\n• prod: ${PROD_BASE}/#/admin/ops\n• 로컬: ${LOCAL_BASE}/#/admin/ops\n• BE: \`${PROD_BASE}/api/v1/admin/ops\` (Bearer)",
          "inline": false
        },
        {
          "name": "📖 시스템 문서 (docs)",
          "value": "Admin 전용 wiki — markdown viewer\n• prod: ${PROD_BASE}/#/admin/docs\n• 로컬: ${LOCAL_BASE}/#/admin/docs",
          "inline": false
        },
        {
          "name": "🗺️ 서비스 흐름 — 노드 다이어그램 페이지",
          "value": "Discord + 누가살래 전체 시스템을 **노드 형태로 보는 페이지**. 시나리오 흐름 + 5 노드 상세\n• prod: ${PROD_BASE}/#/admin/flow\n• 로컬: ${LOCAL_BASE}/#/admin/flow\n\n**5 노드 상세 (overview 안에서 클릭):**\n• \`services-flow-overview\` — 전체 다이어그램 + 시나리오 2종\n• \`services/whosbuying-frontend\` — Flutter Web 노드\n• \`services/whosbuying-backend\` — Spring Boot 노드\n• \`services/whosbuying-data-layer\` — MariaDB / Redis / RabbitMQ\n• \`services/discord-bot\` — Discord 봇 노드\n• \`services/admin-tools\` — Admin 도구 노드",
          "inline": false
        },
        {
          "name": "🔍 Codex 검수 리뷰",
          "value": "매 commit Codex 자동 검수 결과 (한국어, 5항목 평가)\n• Admin UI: ${PROD_BASE}/#/admin/codex\n• 영구 기록: ${REPO_BASE}/tree/main/docs/codex-review (sha 단위)",
          "inline": false
        },
        {
          "name": "🚨 Kill Switch",
          "value": "긴급 서비스 중단 토글 (Redis 기반)\n• prod: ${PROD_BASE}/#/admin/kill\n• 로컬: ${LOCAL_BASE}/#/admin/kill\n• BE: \`${PROD_BASE}/api/v1/admin/kill-switch\` GET/POST",
          "inline": false
        },
        {
          "name": "⚙️ 부속 인프라 (BASIC AUTH 별도)",
          "value": "• Actuator (헬스/메트릭): \`${PROD_BASE}/actuator/health\` (admin / ACTUATOR_PASSWORD)\n• Swagger UI (API 문서): \`http://localhost:8080/swagger-ui.html\`\n• Grafana (대시보드): \`http://localhost:3001\` (admin/admin)\n• Prometheus (메트릭 수집): \`http://localhost:9090\`\n• RabbitMQ 관리: \`http://localhost:15672\` (guest/guest)",
          "inline": false
        },
        {
          "name": "🤖 자동 복구 시스템 (L1/L2/L3)",
          "value": "PR-OPS-AUTO-RECOVERY-FULL (2026-05-12) — 영구 사고 자동 진단/복구\n• L1 launchd: 봇 crash 시 10초 후 자동 재시작\n• L2 Codex: 5분 cron, 15분 연속 다운 시 자동 진단 → \`#ops-errors\` / \`#game-errors\` 알림\n• L3 Claude: Codex 진단 후 자동 fix PR (sub-agent 위임)\n• 무한루프 차단: 같은 패턴 3회 반복 시 stop\n• 정책 SSOT: \`.claude/rules/harness/auto-recovery-gate.md\`",
          "inline": false
        }
      ],
      "footer": { "text": "PR-ADMIN-DEEPLINK · 본 메시지 우클릭 → 메시지 고정 (수동 핀) — 옛 공지는 unpin 해도 OK" }
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
  echo "  3. 옛 admin-hub 핀 메시지는 우클릭 → '핀 해제'"
  echo ""
  echo "(자동 핀 등록은 DISCORD_NOTICE_CHANNEL_ID 환경변수 설정 후"
  echo " node project-manager/discord-bot/scripts/announce-admin-hub-pinned.js 사용)"
  exit 0
else
  echo "[announce-admin-hub] FAIL HTTP=$HTTP"
  echo "응답:"
  cat /tmp/announce-admin-hub.out
  exit 2
fi
