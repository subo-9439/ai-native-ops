#!/usr/bin/env bash
# harness-kit/apply-all.sh — registry.yaml 에 등록된 모든 repo에 apply.sh 실행.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$KIT_DIR/registry.yaml"
OPT=""
[ "${1:-}" = "--dry-run" ] && OPT="--dry-run"
[ "${1:-}" = "--force" ]   && OPT="--force"

if [ ! -f "$REGISTRY" ]; then
  echo "Error: $REGISTRY not found" >&2
  exit 1
fi

# yaml 'path:' 항목 추출 (간단 파서, awk)
paths=$(awk '/^[[:space:]]*path:/ {sub(/^[[:space:]]*path:[[:space:]]*/,""); gsub(/"/,""); print}' "$REGISTRY")

if [ -z "$paths" ]; then
  echo "No targets in registry"
  exit 0
fi

for rel in $paths; do
  target="$KIT_DIR/../$rel"
  if [ ! -d "$target" ]; then
    echo "[skip] $rel (not found)"
    continue
  fi
  echo "=== $rel ==="
  "$KIT_DIR/scripts/apply.sh" "$target" $OPT
done
