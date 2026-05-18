#!/bin/bash
# sync_mcp_on_session_start.sh — SessionStart hook
#
# MCP 설정(SSOT) 을 ~/.claude.json + Claude Desktop config 에 동기화한다.
# project-manager 는 scripts/sync-mcp-config.mjs 가 없으므로 정상 skip 한다
# (MCP SSOT 는 whosbuying/.claude/mcp.json — CLAUDE.md SSOT 원칙 참조).
# 변경 없으면 즉시 noop 종료. 실패 시 stderr 1줄 + 정상 종료
# (degraded — 세션은 차단하지 않는다).

set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO/scripts/sync-mcp-config.mjs"

if [ ! -f "$SCRIPT" ]; then
  echo "[sync-mcp] script missing — skip" >&2
  exit 0
fi

# noop 검사 — dry-run 으로 변경 여부만 확인 (3초 타임아웃)
if ! command -v node >/dev/null 2>&1; then
  echo "[sync-mcp] node not found — skip" >&2
  exit 0
fi

# 실제 적용 (변경 없으면 noop)
node "$SCRIPT" >/dev/null 2>&1 || echo "[sync-mcp] sync failed (degraded) — check: node $SCRIPT" >&2

exit 0
