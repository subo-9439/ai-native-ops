#!/usr/bin/env bash
# harness-kit/apply.sh — 신규 repo에 하네스 기본 틀을 설치한다 (init-only).
#
# 철학: kit은 "시작 템플릿"이다. 설치 후 각 repo는 자유롭게 수정 가능.
# 재실행해도 기존 설치를 덮어쓰지 않는다. 업그레이드는 수동 머지.
#
# 사용법:
#   apply.sh <대상_repo> [--dry-run]        # 기본: init-only
#   apply.sh <대상_repo> --force            # 경고 후 강제 덮어쓰기 (초기화)
#
# 동작 (기존 파일/폴더가 있으면 스킵):
#   1. <대상>/.claude/hooks/         — 폴더 없을 때만 복사
#   2. <대상>/.claude/rules/harness/ — 폴더 없을 때만 복사
#   3. <대상>/.agent/harness/        — 폴더 없을 때만 복사 (런타임 상태 초기화 포함)
#   4. <대상>/.claude/settings.json  — hooks 섹션이 없을 때만 삽입, 있으면 스킵
#   5. <대상>/docs/memory-bank/*.md  — 폴더 없을 때만 템플릿 복사
#
# 업그레이드:
#   kit 원본이 바뀌었으면 `check-drift.sh`로 확인 후 각 repo에서 수동 머지.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
MODE="init"
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) MODE="dry" ;;
    --force)   MODE="force" ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "Usage: $0 <target_repo> [--dry-run | --force]" >&2
  exit 1
fi

if [ ! -d "$TARGET" ]; then
  echo "Error: target repo not found: $TARGET" >&2
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
echo "[apply] kit=$KIT_DIR"
echo "[apply] target=$TARGET"
echo "[apply] mode=$MODE"

if [ "$MODE" = "force" ]; then
  echo ""
  echo "⚠  --force 모드: 기존 하네스 설정을 덮어씁니다."
  echo "   .claude/hooks, .claude/rules/harness, .agent/harness 가 초기화됩니다."
  echo "   런타임 상태(events.jsonl 등)는 보존됩니다."
  echo "   계속하려면 5초 내 Ctrl+C로 취소하세요."
  sleep 4
fi

# ── helpers ──────────────────────────────────────────────

copy_init_only() {
  local src="$1" dst="$2" label="$3"
  if [ -d "$dst" ] && [ "$MODE" != "force" ]; then
    echo "  skip  [$label]: already exists at $dst (use --force to overwrite)"
    return
  fi
  if [ "$MODE" = "dry" ]; then
    echo "  would init [$label]: $dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [ "$MODE" = "force" ] && [ -d "$dst" ]; then
    # 런타임 상태는 잠시 빼두고 복사 후 되돌림
    local backup=$(mktemp -d)
    for rel in memory/raw/events.jsonl memory/current/lessons.current.json memory/current/rule_candidates.current.json; do
      if [ -f "$dst/$rel" ]; then
        mkdir -p "$backup/$(dirname "$rel")"
        cp "$dst/$rel" "$backup/$rel"
      fi
    done
    rsync -a --delete "$src"/ "$dst"/
    # 런타임 상태 복구
    for rel in memory/raw/events.jsonl memory/current/lessons.current.json memory/current/rule_candidates.current.json; do
      if [ -f "$backup/$rel" ]; then
        mkdir -p "$(dirname "$dst/$rel")"
        cp "$backup/$rel" "$dst/$rel"
      fi
    done
    rm -rf "$backup"
  else
    rsync -a "$src"/ "$dst"/
  fi
  echo "  init  [$label]: $dst"
}

init_runtime_state() {
  local target="$1"
  [ -f "$target/memory/raw/events.jsonl" ] || { mkdir -p "$target/memory/raw"; : > "$target/memory/raw/events.jsonl"; }
  [ -f "$target/memory/current/lessons.current.json" ] || cp "$KIT_DIR/harness-core/memory/current/lessons.current.json.template" "$target/memory/current/lessons.current.json"
  [ -f "$target/memory/current/rule_candidates.current.json" ] || cp "$KIT_DIR/harness-core/memory/current/rule_candidates.current.json.template" "$target/memory/current/rule_candidates.current.json"
}

# ── 1~3) 하네스 파일 ──────────────────────────────────────

copy_init_only "$KIT_DIR/hooks"        "$TARGET/.claude/hooks"         "hooks"
copy_init_only "$KIT_DIR/rules"        "$TARGET/.claude/rules/harness" "rules"
copy_init_only "$KIT_DIR/harness-core" "$TARGET/.agent/harness"        "harness-core"

if [ "$MODE" = "init" ] || [ "$MODE" = "force" ]; then
  init_runtime_state "$TARGET/.agent/harness"
  rm -f "$TARGET/.agent/harness/memory/current"/*.template 2>/dev/null || true
fi

# ── 4) settings.json hooks 섹션 ───────────────────────────

SETTINGS="$TARGET/.claude/settings.json"
HOOKS_PATCH="$KIT_DIR/hooks-settings.json"
if [ "$MODE" = "dry" ]; then
  echo "  would init [settings.json hooks]: $SETTINGS"
else
  mkdir -p "$(dirname "$SETTINGS")"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  python3 - "$SETTINGS" "$HOOKS_PATCH" "$MODE" <<'PY'
import json, sys
settings_path, patch_path, mode = sys.argv[1], sys.argv[2], sys.argv[3]
with open(settings_path) as f: settings = json.load(f)
with open(patch_path) as f: patch = json.load(f)
if 'hooks' in settings and mode != 'force':
    print(f"  skip  [settings.json hooks]: already present (use --force to overwrite)")
    sys.exit(0)
settings['hooks'] = patch
with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"  init  [settings.json hooks]: {settings_path}")
PY
fi

# ── 5) memory-bank (init-only) ────────────────────────────

MB="$TARGET/docs/memory-bank"
if [ -d "$MB" ]; then
  echo "  skip  [memory-bank]: already exists"
else
  if [ "$MODE" = "dry" ]; then
    echo "  would init [memory-bank]: $MB"
  else
    mkdir -p "$MB"
    for f in activeContext progress decisions systemPatterns; do
      cp "$KIT_DIR/templates/memory-bank/${f}.md" "$MB/${f}.md"
    done
    echo "  init  [memory-bank]: $MB (empty templates)"
  fi
fi

echo "[apply] done"
