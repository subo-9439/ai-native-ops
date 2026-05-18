#!/usr/bin/env python3
"""
dispatch_sla_check.py - 디스패치 SLA 체커 (CLI/cron 호출용)

state file: .agent/harness/memory/dispatch_state.json
스키마(pending[] 항목):
  {
    "id": "PR-XXX",
    "channel": "FE|BE|AI|OPS",
    "started_at":     "<iso>",       # 디스패치 발행 시각
    "last_signal_at": "<iso>",       # 마지막 활동 신호 시각 (없으면 started_at)
    "started_head":   "<sha>",       # (선택) 디스패치 시점 HEAD
    "started_dirty_hash": "<sha1>"   # (선택) 디스패치 시점 dirty 시그니처
  }

실행: python3 dispatch_sla_check.py
출력: stdout 에 SLA 위반 알림 (jsonl). 위반 없으면 빈 출력 + exit 0.
종료 코드: 위반 있음 → 2, 없음 → 0.

threshold (operational-workflow.yaml dispatch_sla 와 동기):
  warn_minutes: 30
  fallback_hours: 4

응답중/무응답 판별 (3 신호) — 1개라도 있으면 활성으로 보고 위반에서 제외:
  S1 head_changed     : git HEAD 변경 (started_head 대비 현재 HEAD 다름)
  S2 dirty_changed    : dirty tree 변경 (started_dirty_hash 대비 현재 sig 다름)
  S3 sync_events_after: claude-sync(.ops/context.jsonl) 의 started_at 이후 dev/terminal 이벤트
"""
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STATE_FILE = REPO / ".agent" / "harness" / "memory" / "dispatch_state.json"
SYNC_LOG = REPO / ".ops" / "context.jsonl"
WARN_MINUTES = 30
FALLBACK_HOURS = 4


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def load_pending():
    if not STATE_FILE.exists():
        return []
    try:
        data = json.loads(STATE_FILE.read_text("utf-8"))
        return data.get("pending", [])
    except Exception:
        return []


SYNC_PENDING_RE = re.compile(r"\[dispatch_pending\]\s+id=(\S+)")
SYNC_DONE_RE = re.compile(r"\[dispatch_done\]\s+id=(\S+)")


def load_sync_pending():
    """claude-sync(.ops/context.jsonl) [dispatch_pending] - [dispatch_done]
    매칭되지 않은 항목을 pending entry 형태로 반환한다.
    봇(discord-bot/index.js dispatchToAgents)이 summary 에 마커를 기록한다."""
    if not SYNC_LOG.exists():
        return []
    pending = {}
    try:
        with SYNC_LOG.open("r", encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    evt = json.loads(ln)
                except Exception:
                    continue
                summary = evt.get("summary") or ""
                ts = evt.get("timestamp", "")
                mp = SYNC_PENDING_RE.search(summary)
                if mp:
                    pending[mp.group(1)] = ts
                    continue
                md = SYNC_DONE_RE.search(summary)
                if md:
                    pending.pop(md.group(1), None)
    except Exception:
        return []
    return [{"id": did, "channel": "DISCORD",
             "started_at": ts, "last_signal_at": ts}
            for did, ts in pending.items()]


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
    excludes = (
        ".agent/harness/memory/audit_loop_state.json",
        ".agent/harness/memory/dispatch_state.json",
    )
    lines = [ln for ln in porcelain.splitlines() if not any(e in ln for e in excludes)]
    canonical = "\n".join(sorted(lines))
    dirty_hash = hashlib.sha1(canonical.encode("utf-8")).hexdigest() if canonical else "clean"
    return head, dirty_hash


def sync_events_after(iso_ts):
    if not SYNC_LOG.exists() or not iso_ts:
        return 0
    boundary = parse_iso(iso_ts)
    if not boundary:
        return 0
    count = 0
    try:
        with SYNC_LOG.open("r", encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    evt = json.loads(ln)
                except Exception:
                    continue
                ts = parse_iso(evt.get("timestamp", ""))
                if not ts or ts <= boundary:
                    continue
                agent = (evt.get("agent") or "").lower()
                if "dev" in agent or "terminal" in agent or "ops" in agent:
                    count += 1
    except Exception:
        return 0
    return count


def detect_signals(item, head_now, dirty_now):
    started_head = item.get("started_head")
    started_dirty = item.get("started_dirty_hash")
    started_at = item.get("started_at") or item.get("last_signal_at")
    return {
        "head_changed": bool(started_head and head_now and started_head != head_now),
        "dirty_changed": bool(started_dirty and dirty_now and started_dirty != dirty_now),
        "sync_events_after": sync_events_after(started_at),
    }


def main():
    pending = load_pending()
    pending.extend(load_sync_pending())
    now = datetime.now(timezone.utc)
    head_now, dirty_now = current_repo_signature()
    violations = []

    for item in pending:
        signal_at = parse_iso(item.get("last_signal_at") or item.get("started_at", ""))
        if not signal_at:
            continue
        delta = now - signal_at
        minutes = delta.total_seconds() / 60.0

        if minutes >= FALLBACK_HOURS * 60:
            severity = "fallback"
        elif minutes >= WARN_MINUTES:
            severity = "warn"
        else:
            continue

        signals = detect_signals(item, head_now, dirty_now)
        active = (
            signals["head_changed"]
            or signals["dirty_changed"]
            or signals["sync_events_after"] > 0
        )
        if active:
            continue

        violations.append({
            "id": item.get("id", "?"),
            "channel": item.get("channel", "?"),
            "minutes_silent": round(minutes, 1),
            "severity": severity,
            "active": False,
            "signals": signals,
            "action": (
                "자동 직접 구현 진입 (Claude Bash 우회)"
                if severity == "fallback"
                else "CEO 보고 1회 + A/B/C 3택 제시"
            ),
        })

    for v in violations:
        sys.stdout.write(json.dumps(v, ensure_ascii=False) + "\n")

    sys.exit(2 if violations else 0)


if __name__ == "__main__":
    main()
