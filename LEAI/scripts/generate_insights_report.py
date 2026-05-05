#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Generate the per-submission instructor insights report (F5).

Pulls a session's transcript from LEAI, sends it through Claude Code (via
`claude -p`) with a fixed analyst system prompt, and writes a 350–500 word
"data-insights brief" — the artifact M8 calls 深入浅出: concise, evidenced,
TTS-ready.

Spec: LEAI/docs/instructor-clarifications/wk6-form-mode-SPEC.md §9
Output structure (locked):
  1. TL;DR sentence — overall reflection quality + most striking finding
  2. Per-area bullets — finding + ONE verbatim quote (≤ 25 words)
  3. Coverage flags — areas thinly answered or skipped
  4. Team-process signals — 2-3 sentences (M3: the part Magy most cares about)

Usage:
    LEAI/scripts/generate_insights_report.py \\
        --session-id 290884b4-9f28-4ddd-8fe7-426104c247af \\
        --form hci271-week6-reflection \\
        --gpt-id 146 \\
        --out LEAI/scripts/reports/hci271-week6/golden-insights-engaged.md
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import leai_formmode as fm  # noqa: E402
from render_form_download import fetch_messages, to_transcript  # noqa: E402

API_PROD = "https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api"

ANALYST_SYSTEM_PROMPT = """\
You are an instructional analyst writing a per-submission insights brief for an HCI 271 instructor reviewing a student's Week 6 reflection on "Mapping from Data to Design." You will be given the schema (the 10 reflection areas the bot walked the student through) and the full conversation transcript. Produce a written brief — not a grade — that helps the instructor see what the student actually surfaced.

OUTPUT FORMAT (strict — do not deviate):

# Insights Brief — [Student name or session id]

**TL;DR.** One sentence: overall reflection quality (substantive / mixed / thin) + the single most striking finding from THIS student's reflection.

## Per-area findings

For each of the 10 areas in order, ONE bullet shaped as:
- **[Area number] [Area title]:** [finding sentence — what the student actually said/learned/struggled with]. Evidence: "[verbatim quote from the student, ≤ 25 words, no paraphrase, no [...] elision]"

If the student's response on an area was empty or skipped, write:
- **[Area number] [Area title]:** No substantive response captured. _(Coverage gap.)_

## Coverage flags

A bulleted list of every area that was thinly answered, off-topic, or skipped. For each flag, name the area and ONE sentence on what was missing. If coverage was strong everywhere, write "No coverage gaps."

## Team-process signals (Part 2 — what the instructor most cares about)

2 to 3 sentences synthesizing what the conversation revealed about the student's TEAM dynamics this week. Pull from areas 5–8 (Planning, Roles, Collaboration, Health Check). Be specific — name moments, contributions, or breakdowns the student described. No grading judgments.

CONSTRAINTS:
- Total length: 350–500 words. Aim for the middle (~420).
- Tone: analytical, third-person ("the student described…"). NOT casual. NOT advice. NOT grading.
- All quotes are VERBATIM. If you have to shorten, mark with [paraphrased] inline.
- No method-explanations. No comments on the bot's behavior.
- This brief will be read aloud by TTS to a busy instructor — write so it sounds natural when spoken: short sentences, evidenced claims, no jargon stacking.
"""


def call_claude_code(system_prompt: str, user_payload: str, timeout: int = 240) -> str:
    """Invoke `claude -p` headlessly. Same pattern as simulate_conversation.py."""
    cmd = [
        "claude", "-p",
        "--output-format", "json",
        "--system-prompt", system_prompt,
        "--disallowed-tools",
        "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,TodoWrite,Task,Agent,NotebookEdit,LS,SlashCommand",
    ]
    proc = subprocess.run(cmd, input=user_payload, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        sys.exit(
            f"claude -p failed (rc={proc.returncode}):\n"
            f"  stderr: {proc.stderr.strip()}\n"
            f"  stdout: {proc.stdout.strip()[:500]}"
        )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.exit(f"claude -p did not return JSON:\n{proc.stdout[:500]}")
    return (data.get("result") or "").strip()


def build_user_payload(schema: dict, transcript: list[dict], student_name: str | None) -> str:
    section_summary = "\n".join(
        f"  Area {i + 1} of {len(schema['sections'])} — {s['title']}"
        for i, s in enumerate(schema["sections"])
    )
    convo_lines = []
    for t in transcript:
        who = "Student" if t["role"] == "user" else "Remi"
        convo_lines.append(f"{who}: {t['text']}")
    return (
        f"=== SCHEMA ===\n"
        f"{schema['title']}\n"
        f"Course: {schema['course']}\n"
        f"Instructor: {schema['instructor']}\n"
        f"Week: {schema['week']}\n\n"
        f"Areas (in order):\n{section_summary}\n\n"
        f"=== STUDENT ===\n"
        f"{student_name or '(anonymous)'}\n\n"
        f"=== TRANSCRIPT ===\n"
        + "\n".join(convo_lines)
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--session-id", required=True)
    p.add_argument("--form", required=True)
    p.add_argument("--gpt-id", required=True, type=int)
    p.add_argument("--api", default=API_PROD)
    p.add_argument("--student-name", default=None)
    p.add_argument("--out", default=None)
    p.add_argument("--timeout", type=int, default=240)
    args = p.parse_args()

    schema = fm.load_schema(args.form)
    msgs = fetch_messages(args.api.rstrip("/"), args.session_id, args.gpt_id)
    if not msgs:
        sys.exit(f"no messages found for session {args.session_id} (gpt {args.gpt_id})")
    transcript = to_transcript(msgs)
    payload = build_user_payload(schema, transcript, args.student_name)
    print(f"→ generating insights report ({len(transcript)} turns, {len(payload)} chars)…", file=sys.stderr)
    report = call_claude_code(ANALYST_SYSTEM_PROMPT, payload, timeout=args.timeout)
    if args.out:
        Path(args.out).write_text(report)
        print(f"wrote: {args.out}", file=sys.stderr)
        wc = len([w for w in report.split() if w])
        print(f"  word count: {wc}", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
