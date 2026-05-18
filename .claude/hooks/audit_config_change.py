#!/usr/bin/env python3
"""
audit_config_change.py — Claude Code ConfigChange 감사 로거.
설정 변경 이벤트를 별도 감사 로그에 기록한다.

출력: .agent/harness/memory/raw/config_audit.jsonl
실패해도 작업을 막지 않는다.
"""

import json
import sys
import os
import uuid
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIT_PATH = os.path.join(REPO_ROOT, ".agent", "harness", "memory", "raw", "config_audit.jsonl")


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return

        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            event = {"raw_text": raw[:2000]}

        record = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "config_change",
            "session_id": event.get("session_id", os.environ.get("CLAUDE_SESSION_ID", "unknown")),
            "file_path": event.get("file_path", ""),
            "tool_name": event.get("tool_name", ""),
            "tool_input": event.get("tool_input", {}),
            "raw": event,
        }

        os.makedirs(os.path.dirname(AUDIT_PATH), exist_ok=True)

        with open(AUDIT_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    except Exception:
        pass


if __name__ == "__main__":
    main()
