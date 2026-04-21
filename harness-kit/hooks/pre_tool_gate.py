#!/usr/bin/env python3
"""
pre_tool_gate.py — Claude Code PreToolUse hook.
민감 경로 접근과 파괴 명령을 차단한다.

실패 코드:
  HG001: sensitive path denied
  HG002: dangerous command denied

stdin: Claude Code hook JSON (tool_name, tool_input 등)
stdout: JSON {"decision": "allow"|"deny", "reason": "..."}
"""

import json
import sys
import re
import os
from datetime import datetime, timezone

# ── 민감 경로 패턴 ──────────────────────────────────────────
SENSITIVE_PATTERNS = [
    r"\.env($|\.)",
    r"secrets[/\\]",
    r"credentials?[/\\]",
    r"\.pem$",
    r"\.key$",
    r"\.p12$",
    r"\.pfx$",
    r"\.jks$",
    r"id_rsa",
    r"id_ed25519",
    r"token\.json",
    r"service.account\.json",
    r"application-local\.yml$",
]
SENSITIVE_RE = [re.compile(p, re.IGNORECASE) for p in SENSITIVE_PATTERNS]

# ── 파괴 명령 패턴 ──────────────────────────────────────────
DANGEROUS_COMMANDS = [
    r"\brm\s+(-\w*r\w*f|--force).*\b",
    r"\brm\s+-rf\b",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\s+-[dfx]+\b",
    r"\bgit\s+checkout\s+--\s+\.",
    r"\bgit\s+push\s+.*--force\b",
    r"\bdel\s+/[fFqQsS]",
    r"\bformat\s+[a-zA-Z]:",
    r"\bdrop\s+database\b",
    r"\bdrop\s+table\b",
    r"\btruncate\s+table\b",
    r"\bsudo\s+rm\b",
]
DANGEROUS_RE = [re.compile(p, re.IGNORECASE) for p in DANGEROUS_COMMANDS]


def check_sensitive_path(path: str) -> bool:
    if not path:
        return False
    for pat in SENSITIVE_RE:
        if pat.search(path):
            return True
    return False


def check_dangerous_command(cmd: str) -> bool:
    if not cmd:
        return False
    for pat in DANGEROUS_RE:
        if pat.search(cmd):
            return True
    return False


def extract_paths(tool_input: dict) -> list[str]:
    """tool_input에서 경로로 보이는 값을 추출한다."""
    paths = []
    for key in ("file_path", "path", "file", "directory", "glob", "pattern"):
        val = tool_input.get(key)
        if isinstance(val, str) and val:
            paths.append(val)
    # command 안에 포함된 경로도 검사
    cmd = tool_input.get("command", "")
    if isinstance(cmd, str):
        paths.append(cmd)
    return paths


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            # 입력 없으면 allow
            print(json.dumps({"decision": "allow", "reason": "no input"}))
            return

        event = json.loads(raw)
    except (json.JSONDecodeError, Exception):
        # 파싱 실패 시 allow (logger 성격과 달리 gate는 보수적 deny도 가능하지만,
        # 파싱 실패로 모든 작업을 막으면 운영 불가이므로 allow + 경고)
        print(json.dumps({
            "decision": "allow",
            "reason": "hook input parse failed — degraded allow"
        }))
        return

    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError:
            tool_input = {"command": tool_input}

    # ── 민감 경로 검사 ──
    for p in extract_paths(tool_input):
        if check_sensitive_path(p):
            result = {
                "decision": "deny",
                "reason": f"HG001: sensitive path denied — {p}"
            }
            print(json.dumps(result))
            return

    # ── 파괴 명령 검사 ──
    cmd = tool_input.get("command", "")
    if isinstance(cmd, str) and check_dangerous_command(cmd):
        result = {
            "decision": "deny",
            "reason": f"HG002: dangerous command denied — {cmd[:120]}"
        }
        print(json.dumps(result))
        return

    # ── 통과 ──
    print(json.dumps({"decision": "allow", "reason": "passed all gates"}))


if __name__ == "__main__":
    main()
