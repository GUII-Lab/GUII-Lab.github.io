#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Render the form-mode structured download artifact for a submitted session.

Pulls the FeedbackMessage rows for a given session_id from the LEAI backend
and produces the same HTML / Markdown the browser's download button would
generate. Used to ship samples to Magy for sign-off before Tuesday.

Usage:
    LEAI/scripts/render_form_download.py \\
        --session-id 290884b4-9f28-4ddd-8fe7-426104c247af \\
        --form hci271-week6-reflection \\
        --gpt-id 146 \\
        --out LEAI/scripts/reports/hci271-week6/golden-engaged.html

The same arguments accept a Markdown destination via --md.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import leai_formmode as fm  # noqa: E402

API_PROD = "https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api"


def fetch_messages(api: str, session_id: str, gpt_id: int) -> list[dict]:
    """Fetch FeedbackMessage rows for a session ordered by client_seq.

    Uses /feedback_messages_by_gpt/ (the same endpoint fetch_transcripts.py
    uses) and filters down to the requested session.
    """
    r = requests.get(
        f"{api}/feedback_messages_by_gpt/",
        params={"gpt_id": gpt_id},
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    flat: list[dict] = []
    if isinstance(body, list):
        flat = body
    elif isinstance(body, dict):
        sessions = body.get("sessions")
        if isinstance(sessions, dict):
            for sid, msgs in sessions.items():
                for m in msgs or []:
                    m = dict(m)
                    m.setdefault("session_id", sid)
                    flat.append(m)
        elif isinstance(sessions, list):
            flat = sessions
        else:
            for key in ("messages", "results", "data"):
                if key in body and isinstance(body[key], list):
                    flat = body[key]
                    break
    msgs = [m for m in flat if (m.get("session_id") or "") == session_id]
    msgs.sort(key=lambda m: m.get("client_seq") or m.get("id") or 0)
    return msgs


def to_transcript(msgs: list[dict]) -> list[dict]:
    """Convert backend rows to the engine's transcript shape."""
    out = []
    for m in msgs:
        sent_by = (m.get("sent_by") or "").lower()
        text = m.get("content") or ""
        if not text:
            continue
        if sent_by in ("user", "user-message"):
            out.append({"role": "user", "text": text})
        elif sent_by in ("assistant", "ai-message", "bot"):
            out.append({"role": "assistant", "text": text})
    return out


def reconstruct_state(schema: dict, transcript: list[dict]) -> fm.EngineState:
    """Walk the transcript and rebuild engine state so the renderer can
    extract section content. We replay the bot's "Area N of N — Title."
    prefixes to mark each area as opened/answered."""
    state = fm.init_engine(schema)
    fm.before_turn(state, None)  # opening
    user_buffer: list[str] = []
    for t in transcript:
        if t["role"] == "user":
            user_buffer.append(t["text"])
        else:
            # process the next bot turn — first apply any buffered user text
            for u in user_buffer:
                fm.before_turn(state, u)
            user_buffer = []
            # advance state by simulating after_turn (no-op besides ended detection)
            fm.after_turn(state, t["text"])
    for u in user_buffer:
        fm.before_turn(state, u)
    return state


# ─── HTML renderer (mirror of leaiFormMode.renderStructuredHtml) ─────────


def render_html(state: fm.EngineState, transcript: list[dict], student_name: str | None = None) -> str:
    schema = state.schema
    e = html.escape
    today = date.today().isoformat()
    parts: list[str] = []
    parts.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">")
    parts.append(f"<title>{e(schema['title'])}</title>")
    parts.append(
        "<style>"
        "body{font-family:Inter,system-ui,sans-serif;max-width:780px;margin:0 auto;padding:40px 28px;color:#1f2a2e;background:#fff;line-height:1.55;}"
        "h1{font-size:1.6rem;margin:0 0 4px;letter-spacing:-0.01em;}"
        "h2{font-size:1.05rem;margin:28px 0 8px;color:#0a2333;border-bottom:1px solid #e2e8eb;padding-bottom:4px;}"
        ".meta{font-size:0.85rem;color:#5a6669;margin:0 0 18px;}"
        ".meta div{margin:2px 0;}"
        "table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:0.92rem;}"
        "th,td{border:1px solid #d8e0e3;padding:8px 10px;text-align:left;vertical-align:top;}"
        "th{background:#f3f7f8;font-weight:700;}"
        "p{margin:6px 0;}"
        ".section-body{font-size:0.95rem;}"
        ".transcript{margin-top:32px;padding-top:18px;border-top:2px solid #c8d2d6;}"
        ".turn{margin:0 0 12px;font-size:0.9rem;}"
        ".turn .who{font-weight:700;color:#0a2333;}"
        ".turn.bot .who{color:#006493;}"
        ".turn.user{padding:6px 12px;background:#f0f4f6;border-radius:8px;}"
        "@media print{body{padding:24px;}.section-body{page-break-inside:avoid;}}"
        "</style></head><body>"
    )
    parts.append(f"<h1>{e(schema['title'])}</h1>")
    parts.append("<div class=\"meta\">")
    parts.append(f"<div><strong>Course:</strong> {e(schema['course'])}</div>")
    parts.append(f"<div><strong>Instructor:</strong> {e(schema['instructor'])}</div>")
    parts.append(f"<div><strong>Week:</strong> {e(str(schema['week']))}</div>")
    if student_name:
        parts.append(f"<div><strong>Name:</strong> {e(student_name)}</div>")
    if state.team_id:
        parts.append(f"<div><strong>Team:</strong> {e(state.team_id)}</div>")
    if state.team_member_slot:
        parts.append(f"<div><strong>Member slot:</strong> {e(state.team_member_slot)}</div>")
    parts.append(f"<div><strong>Date submitted:</strong> {today}</div>")
    parts.append("</div>")

    for s in schema["sections"]:
        parts.append(f"<h2>{e(s['id'])}. {e(s['title'])}</h2>")
        answer = _extract_section(s, transcript)
        if not answer:
            body_html = "<p><em>(no response captured)</em></p>"
        else:
            paras = [
                "<p>" + e(p).replace("\n", "<br>") + "</p>"
                for p in answer.split("\n\n")
            ]
            body_html = "<div class=\"section-body\">" + "".join(paras) + "</div>"
        if s["id"] == "2.2":
            parts.append("<table><thead><tr><th>Team Member</th><th>Primary Role / Contribution This Week</th></tr></thead>")
            parts.append("<tbody><tr><td colspan=\"2\"><em>Captured below in narrative form — instructor may transcribe to this table for grading.</em></td></tr></tbody></table>")
            parts.append(body_html)
        elif s["id"] == "2.4":
            parts.append("<table><thead><tr><th>Dimension</th><th>Rating (1–5)</th><th>Brief Justification</th></tr></thead><tbody>")
            for f_ in s["fields"]:
                if f_.get("dimension"):
                    parts.append(f"<tr><td>{e(f_['dimension'])}</td><td></td><td><em>see narrative</em></td></tr>")
            parts.append("</tbody></table>")
            parts.append(body_html)
        else:
            parts.append(body_html)

    parts.append("<div class=\"transcript\">")
    parts.append("<h2>Raw Conversation Transcript</h2>")
    for t in transcript:
        who = "Student" if t["role"] == "user" else "Remi"
        cls = "user" if t["role"] == "user" else "bot"
        parts.append(f"<div class=\"turn {cls}\"><span class=\"who\">{e(who)}:</span> {e(t['text'])}</div>")
    parts.append("</div></body></html>")
    return "".join(parts)


def render_markdown(state: fm.EngineState, transcript: list[dict]) -> str:
    schema = state.schema
    today = date.today().isoformat()
    lines: list[str] = []
    lines.append(f"# {schema['title']}")
    lines.append("")
    lines.append(f"- **Course:** {schema['course']}")
    lines.append(f"- **Instructor:** {schema['instructor']}")
    lines.append(f"- **Week:** {schema['week']}")
    if state.team_id:
        lines.append(f"- **Team:** {state.team_id}")
    if state.team_member_slot:
        lines.append(f"- **Member slot:** {state.team_member_slot}")
    lines.append(f"- **Date submitted:** {today}")
    lines.append("")
    lines.append("---")
    lines.append("")
    for s in schema["sections"]:
        lines.append(f"## {s['id']}. {s['title']}")
        lines.append("")
        ans = _extract_section(s, transcript) or "_(no response captured)_"
        if s["id"] == "2.2":
            lines.append("| Team Member | Primary Role / Contribution This Week |")
            lines.append("|---|---|")
            lines.append("| _(see narrative below — auto-extraction may need cleanup)_ | |")
            lines.append("")
        elif s["id"] == "2.4":
            lines.append("| Dimension | Rating (1–5) | Brief Justification |")
            lines.append("|---|---|---|")
            for f_ in s["fields"]:
                if f_.get("dimension"):
                    lines.append(f"| {f_['dimension']} | _(see narrative below)_ | |")
            lines.append("")
        lines.append(ans)
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Raw Conversation Transcript")
    lines.append("")
    for t in transcript:
        who = "Student" if t["role"] == "user" else "Remi"
        lines.append(f"**{who}:** {t['text']}")
        lines.append("")
    return "\n".join(lines)


def _extract_section(section: dict, transcript: list[dict]) -> str:
    import re as _re
    title_re = _re.compile(rf"Area\s+\d+\s+of\s+\d+\s+—\s+{_re.escape(section['title'])}", _re.IGNORECASE)
    any_area_re = _re.compile(r"Area\s+\d+\s+of\s+\d+\s+—\s+", _re.IGNORECASE)
    in_section = False
    captured: list[str] = []
    for t in transcript:
        if t["role"] == "assistant":
            if title_re.search(t["text"]):
                in_section = True
                continue
            if any_area_re.search(t["text"]) and not title_re.search(t["text"]):
                in_section = False
            continue
        if in_section:
            captured.append(t["text"])
    return "\n\n".join(captured)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--session-id", required=True)
    p.add_argument("--form", required=True, help="Schema id (e.g. hci271-week6-reflection)")
    p.add_argument("--gpt-id", required=True, type=int, help="LEAI gpt_id (numeric)")
    p.add_argument("--api", default=API_PROD)
    p.add_argument("--out", default=None, help="Path to write HTML output")
    p.add_argument("--md", default=None, help="Path to write Markdown output")
    p.add_argument("--student-name", default=None)
    args = p.parse_args()

    schema = fm.load_schema(args.form)
    msgs = fetch_messages(args.api.rstrip("/"), args.session_id, args.gpt_id)
    transcript = to_transcript(msgs)
    state = reconstruct_state(schema, transcript)

    if args.out:
        Path(args.out).write_text(render_html(state, transcript, args.student_name))
        print(f"wrote HTML: {args.out}")
    if args.md:
        Path(args.md).write_text(render_markdown(state, transcript))
        print(f"wrote MD: {args.md}")
    if not (args.out or args.md):
        print(render_html(state, transcript, args.student_name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
