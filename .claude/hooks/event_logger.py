#!/usr/bin/env python3
"""
event_logger.py — Claude Code hook event logger.
모든 hook 이벤트를 append-only JSONL로 기록한다.

출력: .agent/harness/memory/raw/events.jsonl
실패해도 작업을 막지 않는다 (logger 성격).
"""

import json
import sys
import os
import hashlib
import uuid
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOG_PATH = os.path.join(REPO_ROOT, ".agent", "harness", "memory", "raw", "events.jsonl")

SCHEMA_VERSION = "1.0.0"


def stable_hash(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return

        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            event = {"raw_text": raw[:2000]}

        now = datetime.now(timezone.utc).isoformat()
        event_id = str(uuid.uuid4())
        payload_hash = stable_hash(raw)

        record = {
            "schema_version": SCHEMA_VERSION,
            "event_id": event_id,
            "timestamp": now,
            "source": "claude-code-hook",
            "session_id": event.get("session_id", os.environ.get("CLAUDE_SESSION_ID", "unknown")),
            "cwd": event.get("cwd", os.getcwd()),
            "hook_event_name": event.get("hook_event_name", event.get("event", "unknown")),
            "tool_name": event.get("tool_name", ""),
            "tool_input": event.get("tool_input", {}),
            "payload_hash": payload_hash,
            "raw": event,
        }

        # 디렉토리 보장
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    except Exception:
        # logger는 절대 작업을 막지 않는다
        pass


if __name__ == "__main__":
    main()
