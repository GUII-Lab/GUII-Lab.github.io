#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
Fetch all FeedbackMessage rows for a given LEAI survey, group them by
session_id into ordered transcripts, and write them to disk as a single
JSON file (and optionally as a markdown bundle for easy reading).

Usage
-----
    LEAI/scripts/fetch_transcripts.py --public-id jDl3ywdzr1uf
    LEAI/scripts/fetch_transcripts.py --public-id jDl3ywdzr1uf \
        --since-iso 2026-04-30T00:00:00Z \
        --out /tmp/wk6-transcripts.json --md /tmp/wk6-transcripts.md
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

API_PROD = "https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api"
API_LOCAL = "http://localhost:8000/datapipeline/api"


def fetch_survey(api: str, public_id: str) -> dict:
    r = requests.get(
        f"{api}/get_feedback_gpt_by_public_id/",
        params={"public_id": public_id},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def fetch_messages(api: str, gpt_id: int) -> list[dict]:
    """
    Returns a flat list of FeedbackMessage rows.

    The backend endpoint actually returns the messages already grouped:
        {sessions: {<session_id>: [msg, ...]}, session_count, message_count}
    We flatten that here so downstream `group_into_sessions` can re-sort and
    decorate without needing to know about the wire shape.
    """
    r = requests.get(
        f"{api}/feedback_messages_by_gpt/",
        params={"gpt_id": gpt_id},
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()

    if isinstance(body, list):
        return body

    if isinstance(body, dict):
        # Live shape: {"sessions": {sid: [msg,...]}, "session_count": n, "message_count": m}
        sessions = body.get("sessions")
        if isinstance(sessions, dict):
            flat: list[dict] = []
            for sid, msgs in sessions.items():
                if isinstance(msgs, list):
                    for m in msgs:
                        # Backend rows already include session_id, but make sure.
                        m = dict(m)
                        m.setdefault("session_id", sid)
                        flat.append(m)
            return flat
        if isinstance(sessions, list):
            return sessions
        # Fallback shapes some legacy endpoints return.
        for key in ("messages", "results", "data"):
            if key in body and isinstance(body[key], list):
                return body[key]
        sys.exit(f"unexpected response shape from /feedback_messages_by_gpt/: {list(body)[:5]}")

    sys.exit(f"unexpected response type: {type(body).__name__}")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        sys.exit(f"could not parse --since-iso {s!r}")


def message_time(msg: dict) -> datetime | None:
    """Best-effort timestamp for a message row."""
    for field in ("created_at", "timestamp", "ts", "client_ts"):
        v = msg.get(field)
        if v is None:
            continue
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=timezone.utc)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                continue
    return None


def normalize_role(sent_by: str) -> str:
    """Both legacy ('ai-message'/'user-message') and new ('user'/'assistant') exist."""
    s = (sent_by or "").lower()
    if s in ("ai-message", "assistant", "bot"):
        return "bot"
    if s in ("user-message", "user", "student"):
        return "student"
    return s or "unknown"


def group_into_sessions(messages: list[dict]) -> list[dict]:
    """Group raw messages by session_id, sort by client_seq then time."""
    by_session: dict[str, list[dict]] = defaultdict(list)
    for m in messages:
        sid = m.get("session_id") or m.get("student_id") or "unknown"
        by_session[sid].append(m)

    transcripts = []
    for sid, msgs in by_session.items():
        msgs.sort(key=lambda m: (
            m.get("client_seq") if m.get("client_seq") is not None else 1e18,
            message_time(m) or datetime.fromtimestamp(0, tz=timezone.utc),
            m.get("id", 0),
        ))
        first_t = message_time(msgs[0]) if msgs else None
        last_t = message_time(msgs[-1]) if msgs else None
        transcripts.append({
            "session_id": sid,
            "msg_count": len(msgs),
            "started_at": first_t.isoformat() if first_t else None,
            "ended_at": last_t.isoformat() if last_t else None,
            "turns": [
                {
                    "role": normalize_role(m.get("sent_by", "")),
                    "content": m.get("content", ""),
                    "client_seq": m.get("client_seq"),
                    "ts": (message_time(m).isoformat() if message_time(m) else None),
                }
                for m in msgs
            ],
        })

    transcripts.sort(key=lambda t: t["started_at"] or "")
    return transcripts


def filter_since(transcripts: list[dict], since: datetime | None) -> list[dict]:
    if not since:
        return transcripts
    # Force `since` aware-UTC for safe comparison.
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    out = []
    for t in transcripts:
        if not t["started_at"]:
            continue
        started = datetime.fromisoformat(t["started_at"])
        # Backend `created_at` strings are naive — assume UTC.
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if started >= since:
            out.append(t)
    return out


def render_markdown(survey: dict, transcripts: list[dict]) -> str:
    lines = [
        f"# Transcripts — {survey.get('name')}",
        f"_Survey id: {survey.get('id')} · public_id: {survey.get('public_id')} · "
        f"week: {survey.get('week_number')} · sessions: {len(transcripts)}_",
        "",
    ]
    for i, t in enumerate(transcripts, 1):
        lines.append(f"## Session {i} — `{t['session_id'][:8]}…`  ({t['msg_count']} turns)")
        lines.append(f"_started_at: {t['started_at']}_")
        lines.append("")
        for turn in t["turns"]:
            tag = "**BOT**" if turn["role"] == "bot" else "**STU**"
            content = turn["content"].strip().replace("\n", "\n> ")
            lines.append(f"{tag} ({turn['client_seq']}): > {content}")
        lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser(description="Pull transcripts for a LEAI survey.")
    p.add_argument("--public-id", required=True, help="Survey public_id (e.g. jDl3ywdzr1uf)")
    p.add_argument("--api", default=API_PROD,
                   help=f"API base URL (default: {API_PROD}; local: {API_LOCAL})")
    p.add_argument("--since-iso", default=None,
                   help="Filter sessions started on/after this ISO timestamp (e.g. 2026-04-30T00:00:00Z)")
    p.add_argument("--out", default=None, help="Write JSON to this path (defaults to stdout)")
    p.add_argument("--md", default=None, help="Also write a markdown bundle to this path")
    args = p.parse_args()

    api = args.api.rstrip("/")
    since = parse_iso(args.since_iso)

    print(f"→ fetching survey {args.public_id} from {api}", file=sys.stderr)
    survey = fetch_survey(api, args.public_id)
    print(f"  survey: {survey.get('name')!r}  id={survey.get('id')}", file=sys.stderr)

    print(f"→ pulling messages for gpt_id={survey['id']}", file=sys.stderr)
    raw = fetch_messages(api, survey["id"])
    print(f"  got {len(raw)} raw messages", file=sys.stderr)

    transcripts = group_into_sessions(raw)
    transcripts = filter_since(transcripts, since)
    print(f"  {len(transcripts)} sessions after filter", file=sys.stderr)

    payload = {
        "survey": {
            "id": survey.get("id"),
            "public_id": survey.get("public_id"),
            "name": survey.get("name"),
            "week_number": survey.get("week_number"),
            "instructions": survey.get("instructions"),
        },
        "transcripts": transcripts,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "filter": {"since_iso": args.since_iso},
    }

    out_text = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(out_text)
        print(f"  wrote JSON → {args.out}", file=sys.stderr)
    else:
        print(out_text)

    if args.md:
        Path(args.md).write_text(render_markdown(survey, transcripts))
        print(f"  wrote markdown → {args.md}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
