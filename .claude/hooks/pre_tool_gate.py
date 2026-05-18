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
from pathlib import Path
from typing import List

# ── SSOT: sensitive-paths.yaml 로드 ─────────────────────────
# 정책 SSOT 는 .agent/harness/policies/sensitive-paths.yaml 이다.
# yaml 로드 실패 시 fail-open(degraded allow) — 인라인 fallback 패턴 사용.
# 운영 차단보다 운영 가능성 우선 (CLAUDE.md 6조).

_FALLBACK_SENSITIVE = [
    r"\.env($|\.)",
    r"secrets[/\\]",
    r"credentials?[/\\]",
    r"\.pem$",
    r"\.key$",
    r"id_rsa",
    r"id_ed25519",
]
_FALLBACK_DANGEROUS = [
    r"\brm\s+-rf\b",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+push\s+.*--force\b",
    r"\bsudo\s+rm\b",
]


def _load_policy():
    """sensitive-paths.yaml 로드 → (sensitive[], dangerous[], exceptions[]) 반환.
    실패 시 fallback 패턴 반환 + stderr 경고.
    PR-GATE-EXCEPTIONS — exceptions 섹션 추가 (false-positive 차단)."""
    repo_root = Path(__file__).resolve().parents[2]
    policy_path = repo_root / ".agent" / "harness" / "policies" / "sensitive-paths.yaml"
    try:
        import yaml  # type: ignore
        with policy_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        sensitive = list(data.get("sensitive_paths") or [])
        dangerous = list(data.get("dangerous_commands") or [])
        # exceptions: 미존재 시 빈 리스트 (기존 동작 유지 — backward compat)
        exceptions_section = data.get("exceptions") or {}
        path_exceptions = list(exceptions_section.get("sensitive_paths") or [])
        if not sensitive or not dangerous:
            raise ValueError("empty policy lists")
        return sensitive, dangerous, path_exceptions
    except Exception as exc:
        sys.stderr.write(
            f"[pre_tool_gate] policy load failed ({exc}); using fallback patterns\n"
        )
        return _FALLBACK_SENSITIVE, _FALLBACK_DANGEROUS, []


SENSITIVE_PATTERNS, DANGEROUS_COMMANDS, PATH_EXCEPTIONS = _load_policy()
SENSITIVE_RE = [re.compile(p, re.IGNORECASE) for p in SENSITIVE_PATTERNS]
DANGEROUS_RE = [re.compile(p, re.IGNORECASE) for p in DANGEROUS_COMMANDS]
PATH_EXCEPTION_RE = [re.compile(p, re.IGNORECASE) for p in PATH_EXCEPTIONS]


def _is_exception(path: str) -> bool:
    """PR-GATE-EXCEPTIONS — 정당한 false-positive 예외 매치."""
    if not path:
        return False
    for pat in PATH_EXCEPTION_RE:
        if pat.search(path):
            return True
    return False


def check_sensitive_path(path: str) -> bool:
    if not path:
        return False
    # exceptions 우선 — false-positive 차단
    if _is_exception(path):
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


def extract_paths(tool_input: dict) -> List[str]:
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
