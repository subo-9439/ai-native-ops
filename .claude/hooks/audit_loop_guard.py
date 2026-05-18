#!/usr/bin/env python3
"""
audit_loop_guard.py - Claude Code PreToolUse hook.
감사 루프 noop-skip 강제: HEAD + dirty hash 가 직전 감사 이후 변하지 않았다면
docs/memory-bank/activeContext.md 에 "세션 종료 감사" 라인 append 를 차단한다.

실패 코드: HG003 (audit loop noop denied)
state file: .agent/harness/memory/audit_loop_state.json
"""
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STATE_REL = ".agent/harness/memory/audit_loop_state.json"
STATE_FILE = REPO / STATE_REL
TARGET_FILE = "docs/memory-bank/activeContext.md"

AUDIT_PATTERNS = [
    re.compile(r"세션\s*종료\s*감사"),
    re.compile(r"정합\s*후속\s*재확인"),
    re.compile(r"감사\s*1줄"),
    re.compile(r"체인\s*해시\s*정합"),
]


def _git(*args):
    try:
        out = subprocess.check_output(
            ["git", *args], cwd=str(REPO), stderr=subprocess.DEVNULL, timeout=3
        )
        return out.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def current_repo_signature():
    head = _git("rev-parse", "HEAD")
    porcelain = _git("status", "--porcelain")
    # state 파일 자체로 인한 dirty 변동을 제외 (자기참조 무한 변화 방지)
    lines = [ln for ln in porcelain.splitlines() if STATE_REL not in ln]
    canonical = "\n".join(sorted(lines))
    dirty_hash = hashlib.sha1(canonical.encode("utf-8")).hexdigest() if canonical else "clean"
    return head, dirty_hash


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def save_state(head, dirty_hash):
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(
            json.dumps(
                {
                    "last_head": head,
                    "last_dirty_hash": dirty_hash,
                    "last_ts": datetime.now(timezone.utc).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            "utf-8",
        )
    except Exception:
        pass


def is_audit_payload(text):
    if not text:
        return False
    return any(p.search(text) for p in AUDIT_PATTERNS)


def targets_active_context(tool_input):
    for key in ("file_path", "path"):
        v = tool_input.get(key)
        if isinstance(v, str) and TARGET_FILE in v.replace("\\", "/"):
            return True
    return False


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"decision": "allow", "reason": "no input"}))
            return
        event = json.loads(raw)
    except Exception:
        print(json.dumps({"decision": "allow", "reason": "parse failed - degraded allow"}))
        return

    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except Exception:
            tool_input = {}

    if tool_name not in ("Edit", "Write"):
        print(json.dumps({"decision": "allow", "reason": "tool not Edit/Write"}))
        return

    if not targets_active_context(tool_input):
        print(json.dumps({"decision": "allow", "reason": "not activeContext.md"}))
        return

    payload = ""
    for key in ("new_string", "content"):
        v = tool_input.get(key)
        if isinstance(v, str):
            payload += "\n" + v

    if not is_audit_payload(payload):
        print(json.dumps({"decision": "allow", "reason": "not an audit-loop append"}))
        return

    head, dirty_hash = current_repo_signature()
    if not head:
        print(json.dumps({"decision": "allow", "reason": "git unavailable - degraded allow"}))
        return

    state = load_state()
    if state.get("last_head") == head and state.get("last_dirty_hash") == dirty_hash:
        print(
            json.dumps(
                {
                    "decision": "deny",
                    "reason": (
                        f"HG003: audit loop noop denied - HEAD {head[:7]} + dirty {dirty_hash[:7]} "
                        f"unchanged since {state.get('last_ts','?')}. "
                        f"feedback_audit_loop_noop_skip.md 정책에 따라 차단."
                    ),
                }
            )
        )
        return

    save_state(head, dirty_hash)
    print(json.dumps({"decision": "allow", "reason": "repo state changed - audit append OK"}))


if __name__ == "__main__":
    main()
