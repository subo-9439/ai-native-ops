#!/usr/bin/env python3
"""
reinject_after_compaction.py — Compaction 후 핵심 컨텍스트 재주입.
CLAUDE.md와 harness_summary.md에서 핵심만 추출하여 stdout으로 출력한다.
Claude Code의 PostCompact hook에서 호출되어 컨텍스트에 재주입된다.

최대 출력: 2000자 (과도한 재주입 방지)
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLAUDE_MD = os.path.join(REPO_ROOT, "CLAUDE.md")
HARNESS_SUMMARY = os.path.join(
    REPO_ROOT, ".agent", "harness", "memory", "current", "harness_summary.md"
)

MAX_OUTPUT = 2000


def read_file_safe(path: str, max_chars: int = 1500) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read(max_chars)
        return content
    except Exception:
        return ""


def extract_claude_md_core(content: str) -> str:
    """CLAUDE.md에서 하네스 실행 계약 섹션만 추출한다."""
    lines = content.split("\n")
    result = []
    in_section = False
    for line in lines:
        if "하네스 실행 계약" in line or "Harness Execution Contract" in line:
            in_section = True
        elif in_section and line.startswith("## ") and "하네스" not in line:
            break
        if in_section:
            result.append(line)
    # 섹션이 없으면 첫 30줄
    if not result:
        result = lines[:30]
    return "\n".join(result)


def main():
    parts = []

    # CLAUDE.md 핵심
    claude_content = read_file_safe(CLAUDE_MD)
    if claude_content:
        core = extract_claude_md_core(claude_content)
        if core.strip():
            parts.append("=== CLAUDE.md 핵심 ===")
            parts.append(core.strip())

    # harness_summary.md
    summary = read_file_safe(HARNESS_SUMMARY, 800)
    if summary.strip():
        parts.append("\n=== 하네스 요약 ===")
        parts.append(summary.strip())

    # 기본 리마인더 (파일이 없는 경우)
    if not parts:
        parts.append("=== 하네스 리마인더 ===")
        parts.append("- 증거 없는 심볼/API 추천 금지")
        parts.append("- 승인 전 자동 반영 금지")
        parts.append("- 민감 경로(.env, secrets, *.key) 접근 금지")
        parts.append("- 변경 전 스캔, 변경 후 self-check")

    output = "\n".join(parts)
    if len(output) > MAX_OUTPUT:
        output = output[:MAX_OUTPUT] + "\n... (truncated)"

    print(output)


if __name__ == "__main__":
    main()
