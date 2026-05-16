#!/bin/bash
# PR-OPS-AWAKE1 + PR-OPS-AUTO-RECOVERY-L1 — launchd 자동 시작 / 자동 복구 설치.
#
# 무엇을 셋업하나:
#   1. com.nolza.caffeinate  — 시스템 슬립 영구 차단 (FDA 무관, 항상 동작 가능)
#   2. com.nolza.ops         — bot/gateway/wiki 자동 시작 (선택, FDA 부여 시만 동작)
#   3. com.nolza.discord-bot — Discord 봇 단독 자동 재가동 (L1, FDA 무관)
#
# 사용:
#   bash scripts/install-launchd.sh                    # 모두 설치
#   bash scripts/install-launchd.sh caffeinate         # caffeinate 만
#   bash scripts/install-launchd.sh ops                # ops 만
#   bash scripts/install-launchd.sh discord-bot        # discord-bot 만 (권장)
#
# 사전 조건 (ops.plist 만 해당):
#   macOS 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한 → /bin/bash 추가
#   (FDA 없이는 launchd → ~/Desktop 접근 차단됨)
#
# 해제:
#   launchctl unload ~/Library/LaunchAgents/com.nolza.caffeinate.plist
#   launchctl unload ~/Library/LaunchAgents/com.nolza.ops.plist
#   launchctl unload ~/Library/LaunchAgents/com.nolza.discord-bot.plist

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/scripts/launchd"
DST_DIR="$HOME/Library/LaunchAgents"
TARGET="${1:-all}"

mkdir -p "$DST_DIR"

install_plist() {
  local NAME="$1"
  local SRC="$SRC_DIR/$NAME.plist"
  local DST="$DST_DIR/$NAME.plist"

  if [ ! -f "$SRC" ]; then
    echo "[install-launchd] ❌ 소스 없음: $SRC" >&2
    return 1
  fi

  echo "[install-launchd] $NAME"
  echo "  cp  $SRC → $DST"
  cp "$SRC" "$DST"

  # 이미 로드돼 있으면 unload 후 재로드 (변경사항 반영)
  if launchctl list | grep -q "$NAME"; then
    echo "  unload (기존 로드 있음)"
    launchctl unload "$DST" 2>/dev/null || true
  fi

  echo "  load"
  launchctl load "$DST"

  sleep 1
  if launchctl list | grep -q "$NAME"; then
    local STATUS
    STATUS="$(launchctl list "$NAME" 2>/dev/null | grep LastExitStatus | head -1 || echo '?')"
    echo "  ✅ 로드 완료 ($STATUS)"
  else
    echo "  ❌ 로드 실패 — ~/Library/LaunchAgents/$NAME.plist 수동 점검" >&2
    return 1
  fi
}

case "$TARGET" in
  caffeinate)
    install_plist "com.nolza.caffeinate"
    ;;
  ops)
    install_plist "com.nolza.ops"
    ;;
  discord-bot)
    install_plist "com.nolza.discord-bot"
    ;;
  audit-bot)
    install_plist "com.nolza.audit-bot"
    ;;
  audit-game)
    install_plist "com.nolza.audit-game"
    ;;
  audit)
    install_plist "com.nolza.audit-bot"
    install_plist "com.nolza.audit-game"
    ;;
  auto-deploy)
    install_plist "com.nolza.auto-deploy"
    ;;
  auto-deploy-off)
    DST="$DST_DIR/com.nolza.auto-deploy.plist"
    if [ -f "$DST" ]; then
      launchctl unload "$DST" 2>/dev/null || true
      echo "[install-launchd] ✅ com.nolza.auto-deploy unload 완료 (자동 배포 중지)"
    else
      echo "[install-launchd] com.nolza.auto-deploy 미설치 — skip"
    fi
    exit 0
    ;;
  all|"")
    install_plist "com.nolza.caffeinate"
    install_plist "com.nolza.discord-bot" || {
      echo ""
      echo "[install-launchd] ⚠️ com.nolza.discord-bot 로드 실패"
      echo "[install-launchd]    /tmp/discord-bot.err.log 확인"
    }
    install_plist "com.nolza.audit-bot" || true
    install_plist "com.nolza.audit-game" || true
    install_plist "com.nolza.ops" || {
      echo ""
      echo "[install-launchd] ⚠️ com.nolza.ops 로드 실패 (FDA 미부여 가능성)"
      echo "[install-launchd]    /tmp/ops.err.log 확인 후 시스템 설정 → FDA 점검"
    }
    ;;
  *)
    echo "사용법: $0 [caffeinate|ops|discord-bot|audit-bot|audit-game|audit|auto-deploy|auto-deploy-off|all]" >&2
    exit 2
    ;;
esac

echo ""
echo "[install-launchd] 현재 로드된 com.nolza.* :"
launchctl list | grep "com.nolza" | sed 's/^/  /'
