#!/usr/bin/env bash
# harness-kit/check-drift.sh — 대상 repo와 harness-kit 원본 사이의 drift를 검사한다.
# 사용법: check-drift.sh <대상_repo_경로>
# 종료코드: 0=동일, 1=drift 감지, 2=인자 오류

set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  echo "Usage: $0 <target_repo>" >&2
  exit 2
fi

TARGET="$(cd "$TARGET" && pwd)"
DRIFT=0

# 런타임 상태 & kit-only 템플릿은 drift 비교에서 제외
RUNTIME_EXCLUDES=(
  -x 'events.jsonl'
  -x 'lessons.current.json'
  -x 'rule_candidates.current.json'
  -x '*.template'
  -x 'RUN_REPORT_*.md'
  -x '.bootstrap.lock'
)

check_dir() {
  local src="$1"
  local dst="$2"
  local label="$3"
  if [ ! -d "$dst" ]; then
    echo "[DRIFT] $label: missing at $dst"
    DRIFT=1
    return
  fi
  if ! diff -qr "${RUNTIME_EXCLUDES[@]}" "$src" "$dst" >/dev/null 2>&1; then
    echo "[DRIFT] $label:"
    diff -qr "${RUNTIME_EXCLUDES[@]}" "$src" "$dst" 2>&1 | sed 's/^/  /'
    DRIFT=1
  else
    echo "[OK]    $label"
  fi
}

check_dir "$KIT_DIR/hooks"         "$TARGET/.claude/hooks"         "hooks"
check_dir "$KIT_DIR/rules"         "$TARGET/.claude/rules/harness" "rules/harness"
check_dir "$KIT_DIR/harness-core"  "$TARGET/.agent/harness"        "harness-core"

# settings.json hooks 섹션 비교
SETTINGS="$TARGET/.claude/settings.json"
HOOKS_PATCH="$KIT_DIR/hooks-settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo "[DRIFT] settings.json: missing at $SETTINGS"
  DRIFT=1
else
  if ! python3 - "$SETTINGS" "$HOOKS_PATCH" <<'PY'
import json, sys
with open(sys.argv[1]) as f: settings = json.load(f)
with open(sys.argv[2]) as f: patch = json.load(f)
sys.exit(0 if settings.get('hooks') == patch else 1)
PY
  then
    echo "[DRIFT] settings.json hooks section differs"
    DRIFT=1
  else
    echo "[OK]    settings.json hooks section"
  fi
fi

if [ $DRIFT -eq 0 ]; then
  echo "[drift] CLEAN — target in sync with kit"
  exit 0
else
  echo "[drift] DRIFT DETECTED — run apply.sh to sync"
  exit 1
fi
