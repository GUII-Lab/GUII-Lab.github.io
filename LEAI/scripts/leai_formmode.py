"""LEAI form-mapping mode — Python mirror of leai-formmode.js.

Same state-transition rules as the JS engine; both consume the same schema
JSON. Used by simulate_conversation.py to drive form-mode chats from the CLI
without a browser.

Spec: LEAI/docs/instructor-clarifications/wk6-form-mode-SPEC.md §4 / §6
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# ─── schema loading ──────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]

# FormSchema registry is the sole source of truth (see Django migrations 0024
# and 0025). The legacy LEAI/docs/forms/ JSON fallback was retired with 0025.
DEFAULT_API_BASE = "https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api"


def _api_base() -> str:
    return (os.environ.get("LEAI_API_BASE") or DEFAULT_API_BASE).rstrip("/")


def load_schema(schema_id: str) -> dict[str, Any]:
    """Fetch a form schema by id from the FormSchema registry endpoint.

    Honors the ``LEAI_API_BASE`` env var so local development against
    ``http://localhost:8000/datapipeline/api`` works without code edits.
    """
    import urllib.request
    import urllib.error

    url = f"{_api_base()}/form_schemas/{urllib.parse.quote(schema_id, safe='')}/"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"form_schemas registry HTTP {e.code} for {schema_id}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"form_schemas registry unreachable at {url}: {e}") from e
    body = payload.get("body") if isinstance(payload, dict) else None
    if not body:
        raise RuntimeError(f"form_schemas registry returned no body for {schema_id}")
    return body


# ─── engine state ────────────────────────────────────────────────────────


@dataclass
class Coverage:
    opened: bool = False
    response_received: bool = False
    probe_used: bool = False
    sub_signals: dict[str, Any] = field(default_factory=dict)


@dataclass
class EngineState:
    schema: dict[str, Any]
    current_area_index: int = 1
    coverage: dict[str, Coverage] = field(default_factory=dict)
    ended: bool = False
    team_id: Optional[str] = None
    team_member_slot: Optional[str] = None
    last_directive: Optional[dict[str, Any]] = None
    awaiting_anything_else: bool = False
    closing_feedback_asked: bool = False
    turn: int = 0
    # Canonical roster captured the first time the student lists teammates in
    # Area 2.2. Mirrors the JS engine's `state.roster` — drives the per-member
    # walk so the exported roster table isn't all "(not captured)".
    roster: Optional[list[str]] = None
    # Safety net: count student turns spent on the current area. If a student
    # never says "move on" / "no" / etc., we still cap the time spent so the
    # interview can finish. See MAX_TURNS_PER_AREA.
    turns_in_current_area: int = 0


# Cap on student turns within a single area before the engine force-advances.
# Tuned to accommodate Area 6 (Roles & Contributions) which legitimately
# walks teammate-by-teammate (~12 turns in the engaged sim). Above that,
# the conversation has stalled and we move on.
MAX_TURNS_PER_AREA = 14

# Hard total-turn cap scales per-schema (see _total_turn_budget()).
MIN_TOTAL_TURN_BUDGET = 24
TURNS_PER_SECTION_BUDGET = 5


def _total_turn_budget(state: "EngineState") -> int:
    n = len(state.schema.get("sections") or []) if state and state.schema else 6
    return max(MIN_TOTAL_TURN_BUDGET, n * TURNS_PER_SECTION_BUDGET)


@dataclass
class BeforeTurnResult:
    short_circuit: bool = False
    synthetic_response: str = ""
    directive: Optional[dict[str, Any]] = None
    ended: bool = False


@dataclass
class AfterTurnResult:
    displayed_message: str
    ended: bool
    lock_chat: bool


# ─── engine ──────────────────────────────────────────────────────────────


def init_engine(schema: dict[str, Any], *, team_id: Optional[str] = None,
                team_member_slot: Optional[str] = None) -> EngineState:
    coverage = {s["id"]: Coverage() for s in schema["sections"]}
    return EngineState(
        schema=schema,
        coverage=coverage,
        team_id=team_id,
        team_member_slot=team_member_slot,
    )


def system_prompt_tail(schema: dict[str, Any]) -> str:
    n = len(schema["sections"])
    titles = "\n".join(
        f"  Area {i + 1} of {n} — {s['title']}"
        for i, s in enumerate(schema["sections"])
    )
    return (
        "\n\n==== FORM-MAPPING MODE (engine-controlled) ====\n"
        f"You are now operating under an external state machine that tracks which of the {n} reflection areas the student is on. Each turn you will receive a [DIRECTIVE] block telling you exactly what to do this turn. Follow the directive exactly.\n"
        "Areas (canonical titles — do NOT rename, paraphrase, invent):\n"
        f"{titles}\n"
        "Constraints:\n"
        "- Stay on the directive's area. Do not skip ahead.\n"
        "- Ask AT MOST one question per turn.\n"
        "- Keep messages under 350 characters unless the directive says otherwise.\n"
        "- Do NOT write the reflection for the student. Redirect off-topic asks back to their reflection.\n"
        "- Do NOT emit the [END] token. The engine handles closing.\n"
        "- NEVER emit a section header like \"Area X of N — Title\" anywhere in your reply. The engine prepends section headers automatically when (and only when) advancing. Emitting your own header — including out-of-order ones — corrupts the structured reflection download.\n"
        "- Section progression is strictly monotonic: 1 → 2 → 3 → ... → N. Do NOT regress to an earlier area, even if the student asks to \"go back\" or seems to revisit one. Acknowledge the revision in place, but stay on the current area.\n"
        "\n"
        "==== METHOD-EXPLANATION REFUSAL (NON-NEGOTIABLE) ====\n"
        "You MUST NOT define, summarize, explain, paraphrase, or describe how to do any method, framework, concept, or reading. This includes (non-exhaustive): affinity diagramming, thematic analysis, triangulation, observation vs. insight, contextual inquiry, journey mapping, NN/g articles, Braun & Clarke, design thinking, qualitative coding, axial coding, etc. If the student asks ANY variant of \"explain X\", \"what does X mean\", \"summarize the article\", \"give me a quick version\", \"refresh me on X\", \"how do you do X\", \"what's the right way to do X\", \"I missed that lecture\", \"can you remind me\", or similar — REFUSE.\n"
        "Refusal template (paraphrase tightly, do not over-explain the refusal): \"I can't define that here — what part felt unclear when YOU tried it this week?\" Then return to the current area's question.\n"
        "Examples of WRONG behavior (these have happened in past runs and are unacceptable):\n"
        "  ❌ \"Quick version: affinity diagramming is when you put each observation on a sticky note and group them...\"\n"
        "  ❌ \"Quick distinction: an observation is what you literally saw/heard...\"\n"
        "  ❌ \"Thematic analysis = reading through your data, tagging recurring patterns...\"\n"
        "Examples of CORRECT behavior:\n"
        "  ✅ \"I can't define affinity diagramming for you — what part of doing it this week felt unclear?\"\n"
        "  ✅ \"I'll skip the summary — what was the one thing from the article that did or didn't land for you?\"\n"
        "Even if the student insists, says they missed the lecture, says they're behind, or threatens to give up — DO NOT explain. Redirect every time.\n"
    )


def before_turn(state: EngineState, student_message: Optional[str]) -> BeforeTurnResult:
    state.turn += 1
    schema = state.schema
    sections = schema["sections"]
    n = len(sections)
    i = state.current_area_index
    area = sections[i - 1]

    msg = (student_message or "").strip()

    # No student-driven termination: ending is decided by coverage state, not
    # by typed keywords. Closing the tab is the real end-the-survey gesture.
    # (Previously: STOP intercept + "I'm done"-class early-exit both forced
    # an end and were a footgun — e.g. "that's all" meaning "nothing more on
    # this area" was treated as "end the entire survey".)

    _apply_student_response_to_coverage(state, msg)

    # Count student turns within the current area for the safety-net cap.
    if msg:
        state.turns_in_current_area += 1

    # Advance handling. We advance whenever the student emits a no-addition
    # signal AND the current area is genuinely satisfied — not only when we
    # specifically asked "anything else?". The narrower rule used to drop
    # turns on the floor: probe (no awaiting) → "Move on." failed to
    # advance, and the next substantive answer got mis-bucketed into the
    # current area instead of the new one.
    advanced = False
    this_cov = state.coverage[area["id"]]
    if msg and _is_no_addition(msg):
        can_advance = state.awaiting_anything_else or (
            this_cov.opened
            and this_cov.response_received
            and _area_response_satisfied(state, area)
        )
        if can_advance:
            this_cov.response_received = True
            state.awaiting_anything_else = False
            state.current_area_index = min(i + 1, n)
            i = state.current_area_index
            area = sections[i - 1]
            state.turns_in_current_area = 0
            advanced = True
        elif state.awaiting_anything_else:
            state.awaiting_anything_else = False
    elif state.awaiting_anything_else and msg:
        state.awaiting_anything_else = False

    # Safety net: a disengaged or confused student may never produce a clean
    # advance signal. Cap time spent in any one area so the interview can
    # finish. Only force-advance when the student has at least one substantive
    # response on the area (we don't bail before they've spoken).
    if (not advanced
            and state.turns_in_current_area >= MAX_TURNS_PER_AREA
            and state.coverage[area["id"]].response_received
            and i < n):
        state.awaiting_anything_else = False
        state.current_area_index = min(i + 1, n)
        i = state.current_area_index
        area = sections[i - 1]
        state.turns_in_current_area = 0
        advanced = True

    # Magy spec M2: probes once; moves on if student doesn't take it.
    if (not advanced
            and state.coverage[area["id"]].probe_used
            and state.coverage[area["id"]].response_received
            and _area_response_satisfied(state, area)
            and msg
            and len([w for w in msg.split() if w]) <= 6
            and i < n):
        state.awaiting_anything_else = False
        state.current_area_index = min(i + 1, n)
        i = state.current_area_index
        area = sections[i - 1]
        state.turns_in_current_area = 0
        advanced = True

    # Hard total-turn safety net (budget scales per-schema).
    if (state.turn >= _total_turn_budget(state)
            and not _all_covered(state)
            and not state.closing_feedback_asked):
        _force_cover_all(state)
        i = state.current_area_index
        area = sections[i - 1]

    # Directive selection
    if state.turn == 1:
        state.coverage[area["id"]].opened = True
        directive = _dir_opening(state, area)
    elif state.closing_feedback_asked:
        directive = _dir_final_ack(state)
    elif _all_covered(state):
        directive = _dir_close(state)
    elif not state.coverage[area["id"]].opened:
        state.coverage[area["id"]].opened = True
        directive = _dir_open_area(state, area, i, n)
    elif (
        area["id"] == "2.2"
        and state.coverage[area["id"]].sub_signals.get("has_roster")
        and state.roster
    ):
        # 2.2 special flow: walk member-by-member, then equity, then wrap.
        # Without this the engine would fire _should_probe with the equity
        # depth_probe right after the roster turn and skip every member.
        cov22 = state.coverage[area["id"]]
        cov22.sub_signals.setdefault("members_walked", [])
        roster_pretty = [n for n in (state.roster or []) if n != "self"]
        walked: list[str] = cov22.sub_signals["members_walked"]
        if len(walked) < len(roster_pretty):
            # Find first un-walked member. `walked` is updated by
            # _apply_student_response_to_coverage based on names the student
            # actually said — not a blind ++counter — so it can be sparse if
            # the LLM ignored a previous walk directive. Pick the first
            # roster slot whose name isn't in `walked` yet.
            next_member: Optional[str] = None
            for member in roster_pretty:
                if member.lower() not in walked:
                    next_member = member
                    break
            if next_member is not None:
                directive = _dir_roster_walk(state, area, next_member, len(roster_pretty) - len(walked) - 1)
            elif not cov22.sub_signals.get("equity_asked"):
                cov22.sub_signals["equity_asked"] = True
                directive = _dir_ask_equity(state, area)
            else:
                directive = _dir_continue_area(state, area, i, n)
        elif not cov22.sub_signals.get("equity_asked"):
            cov22.sub_signals["equity_asked"] = True
            directive = _dir_ask_equity(state, area)
        elif _area_response_satisfied(state, area):
            state.awaiting_anything_else = True
            directive = _dir_anything_else(state, area)
        else:
            directive = _dir_continue_area(state, area, i, n)
    elif area["id"] == "2.4":
        # 2.4 has a fixed dimension-by-dimension walk. Without this branch
        # the engine fell through to _dir_continue_area, the LLM owned per-
        # dim state, and would split each dim into two turns (justification
        # turn → rating turn). When the student gave "5. <justification>"
        # in one turn — the natural shape — the LLM would still re-ask the
        # rating, the student would drift one dim ahead, and ratings could
        # end up paired to the wrong dim. One turn per dim asks for both.
        cov24 = state.coverage[area["id"]]
        if not isinstance(cov24.sub_signals.get("dim_cursor"), int):
            cov24.sub_signals["dim_cursor"] = 0
        dims24br = [f for f in (area.get("fields") or []) if f.get("kind") == "rating_with_justification"]
        if cov24.sub_signals["dim_cursor"] < len(dims24br):
            cur_dim = dims24br[cov24.sub_signals["dim_cursor"]]
            directive = _dir_rate_and_justify(state, area, cur_dim, cov24.sub_signals["dim_cursor"], len(dims24br))
        elif _area_response_satisfied(state, area):
            state.awaiting_anything_else = True
            directive = _dir_anything_else(state, area)
        else:
            directive = _dir_continue_area(state, area, i, n)
    elif _should_probe(state, area, msg):
        state.coverage[area["id"]].probe_used = True
        directive = _dir_probe(state, area)
    elif _area_response_satisfied(state, area):
        state.awaiting_anything_else = True
        directive = _dir_anything_else(state, area)
    else:
        directive = _dir_continue_area(state, area, i, n)

    state.last_directive = directive
    return BeforeTurnResult(directive=directive)


def after_turn(state: EngineState, llm_response: str) -> AfterTurnResult:
    raw = (llm_response or "").strip()
    had_end = "[END]" in raw.upper()
    stripped = re.sub(r"\[END\]", "", raw, flags=re.IGNORECASE).strip()
    schema = state.schema
    n = len(schema["sections"])
    i = state.current_area_index
    area = schema["sections"][i - 1]

    displayed = stripped
    ended = False

    # Sync engine to closing-feedback question: if the bot just asked it,
    # mark all sections covered AND set closing_feedback_asked so the next
    # turn fires _dir_final_ack and emits [END].
    closing_prompt = ((state.schema.get("closing") or {}).get("feedback_prompt")) or ""
    if closing_prompt and _looks_like_closing_feedback(displayed, closing_prompt):
        _force_cover_all(state)
        state.closing_feedback_asked = True
        i = state.current_area_index
        area = state.schema["sections"][i - 1]

    # Sync engine state to LLM-driven progression: if the LLM emitted a valid
    # forward "Area X of N — Title" header, advance the engine to match.
    # Hard rule: advance by AT MOST one step at a time, and only if the
    # previous area genuinely satisfied the engine. Without this, an LLM that
    # hallucinates "Area 6 of 6" while still mid-Area-4 skips over sections
    # that never received a student answer, and the artifact comes out empty
    # for those sections.
    advanced_to = _detect_forward_advance(state, displayed)
    if advanced_to > i:
        allow_advance = (
            advanced_to == i + 1
            and _area_response_satisfied(state, area)
        )
        if allow_advance:
            state.coverage[area["id"]].response_received = True
            state.current_area_index = advanced_to
            state.coverage[state.schema["sections"][advanced_to - 1]["id"]].opened = True
            state.turns_in_current_area = 0
            state.awaiting_anything_else = False
            i = advanced_to
            area = state.schema["sections"][i - 1]
        else:
            # LLM tried to skip ahead — strip the bogus header so the student
            # doesn't see a section title that hasn't been earned. The prefix
            # logic below re-emits the correct current-area header.
            displayed = re.sub(
                r"Area\s+\d+\s+of\s+\d+\s+[—\-]\s+[^.\n]+?\s*\.\s*",
                "",
                displayed,
                flags=re.IGNORECASE,
            ).strip()

    # Defensively strip any LLM-hallucinated wrong-section headers before
    # potentially prefixing the engine-injected one.
    displayed = _strip_wrong_section_headers(displayed, i, n)

    kind = state.last_directive.get("kind") if state.last_directive else None
    prev_emitted = getattr(state, "_last_emitted_area", 0) or 0
    should_emit_header = (
        kind in ("opening", "open_area") or i != prev_emitted
    )
    if should_emit_header:
        prefix = f"Area {i} of {n} — {area['title']}."
        already_at_start = displayed.startswith(prefix)
        any_header_at_start = bool(
            re.match(r"Area\s+\d+\s+of\s+\d+\s+[—\-]\s+", displayed, flags=re.IGNORECASE)
        )
        if not already_at_start and not any_header_at_start:
            displayed = f"{prefix} {displayed}"
        elif any_header_at_start and not already_at_start:
            displayed = re.sub(
                r"^Area\s+\d+\s+of\s+\d+\s+[—\-]\s+[^.\n]+\.\s*",
                f"{prefix} ",
                displayed,
                flags=re.IGNORECASE,
            )
        state._last_emitted_area = i  # type: ignore[attr-defined]

    if had_end:
        if _all_covered(state):
            state.ended = True
            ended = True
        else:
            remaining = _count_remaining(state)
            displayed += f"\n\n(continuing — {remaining} of {n} areas left.)"
    elif kind in ("close", "final_ack") and _all_covered(state):
        # Close directive (or post-feedback ack) ran and all areas are
        # covered — the engine owns closing, so append [END] to lock the
        # chat downstream.
        state.ended = True
        ended = True
        displayed = f"{displayed}\n\n[END]"

    if state.ended:
        ended = True

    return AfterTurnResult(
        displayed_message=displayed,
        ended=ended,
        lock_chat=ended,
    )


def is_complete(state: EngineState) -> bool:
    return _all_covered(state)


def progress_label(state: EngineState) -> str:
    n = len(state.schema["sections"])
    i = state.current_area_index
    area = state.schema["sections"][i - 1]
    return f"Area {i} of {n} — {area['title']}"


# ─── private helpers ─────────────────────────────────────────────────────


def _detect_forward_advance(state: EngineState, displayed: str) -> int:
    """Return the largest forward area index implied by an LLM-emitted header,
    or the engine's current index if nothing forward is detected."""
    n = len(state.schema["sections"])
    current = state.current_area_index
    pat = re.compile(
        r"Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\.",
        flags=re.IGNORECASE,
    )
    best = current
    for m in pat.finditer(displayed or ""):
        idx = int(m.group(1))
        total = int(m.group(2))
        if total != n or idx <= current or idx > n:
            continue
        schema_title = state.schema["sections"][idx - 1]["title"]
        emitted_title = (m.group(3) or "").strip()
        if schema_title[:8].lower() == emitted_title[:8].lower() and idx > best:
            best = idx
    return best


def _strip_wrong_section_headers(text: str, current_idx: int, total_n: int) -> str:
    """Remove "Area X of N — Title" headers whose index doesn't match the
    engine's current area. Mirrors stripWrongSectionHeaders in leai-formmode.js.
    """
    if not text:
        return text
    pat = re.compile(
        r"Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\.",
        flags=re.IGNORECASE,
    )

    def repl(m: re.Match[str]) -> str:
        idx = int(m.group(1))
        total = int(m.group(2))
        if idx == current_idx and total == total_n:
            return m.group(0)
        return ""

    out = pat.sub(repl, text)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# "Strong" advance signals — when these start a SHORT (≤8 words) message,
# treat the whole message as a no-addition signal even if more text follows.
_STRONG_NO_ADD = re.compile(
    r"^(no|nope|nah|move on|moving on|let'?s? move on|let'?s go|"
    r"go next|next( one| please)?|skip|skip( ahead| this)?|"
    r"i'?m done|i think we'?re done|that'?s it|that'?s all|"
    r"nothing more|nothing else|nothing( more)? to add|"
    r"nothing( more)? on this( one)?|i think we are done|we'?re done)\b",
    flags=re.IGNORECASE,
)

# "Weak" signals — natural at the start of substantive responses ("Yeah, the
# thing that…", "Ready for the ratings"). Treat as no-addition only when they
# are essentially the WHOLE message (≤3 words, no clause structure).
_WEAK_NO_ADD_WHOLE = re.compile(
    r"^(done|good|fine|ready|ok|okay|sure|yep|yeah|cool|got it|got it\.?)$",
    flags=re.IGNORECASE,
)


def _is_no_addition(s: str) -> bool:
    if not s:
        return False
    # Strip leading/trailing punctuation and whitespace.
    t = re.sub(r"^[\s,.\-—!?]+|[\s,.\-—!?]+$", "", s).strip()
    if not t:
        return False
    words = [w for w in t.split() if w]
    if not words:
        return False
    # STRONG signal at the start, but only when the whole message is short
    # (≤ 10 words). Substantive responses can legitimately START with a
    # STRONG-matching phrase — e.g. "Next week's commitment: …" begins with
    # "Next" and was previously misclassified as advance-now, dropping the
    # entire 3.2 answer on the floor.
    if len(words) <= 10 and _STRONG_NO_ADD.match(t):
        return True
    # WEAK signals are natural at the start of substantive responses
    # ("Yeah, the thing that…", "Ready for the ratings"). Only treat as
    # no-addition when the whole message is essentially that word.
    if len(words) <= 3 and _WEAK_NO_ADD_WHOLE.match(t):
        return True
    return False


def _apply_student_response_to_coverage(state: EngineState, msg: str) -> None:
    if not msg:
        return
    i = state.current_area_index
    area = state.schema["sections"][i - 1]
    cov = state.coverage[area["id"]]
    if not cov.opened:
        return

    if not _is_no_addition(msg) and len(msg) >= 2:
        cov.response_received = True
        cov.sub_signals["substantive_turns"] = cov.sub_signals.get("substantive_turns", 0) + 1

    if area["id"] == "2.2":
        # Bind `has_roster` strictly to a successful extraction. The previous
        # version flipped this from any comma/and/&/colon match, which caused
        # state.roster to lock onto an Area-1 revision message that happened
        # to mention three capitalized tokens (Monday, Anvitha, Google
        # Calendar) in narrative prose. Now has_roster only flips when we
        # actually have ≥2 plausible names AND the message looks like a
        # roster list rather than a sentence of prose / a revision request.
        roster_captured_this_turn = False
        if state.roster is None:
            extracted = _extract_roster_names(msg)
            if extracted and len(extracted) >= 2:
                state.roster = extracted
                cov.sub_signals["has_roster"] = True
                roster_captured_this_turn = True
        # Per-member walk: mark any roster name the student explicitly
        # mentioned in this reply. Replaces the blind counter in the
        # before_turn 2.2 branch — that one ticked walked++ every turn
        # regardless of whether the LLM asked the target member or the
        # student actually answered about them. Transcript repro: engine
        # emits walk(Alison), LLM ignores and re-asks Anvitha, engine still
        # increments walked → Alison/Diane/Jasmine never get asked.
        #
        # Skip on the roster-capture turn itself — the student just listed
        # names with no contributions; auto-marking everyone walked from
        # that one message would skip per-member coverage entirely.
        if state.roster and not roster_captured_this_turn:
            roster_pretty2 = [n for n in state.roster if n != "self"]
            walked2: list[str] = list(cov.sub_signals.get("members_walked") or [])
            for member in roster_pretty2:
                member_key = member.lower()
                if member_key in walked2:
                    continue
                first_name = member.split()[0]
                if re.search(r"\b" + re.escape(first_name) + r"\b", msg, flags=re.IGNORECASE):
                    walked2.append(member_key)
            # Fallback: if the LLM's last directive targeted a specific
            # member and the student gave a substantive reply, accept that
            # as coverage even if they didn't say the name out loud.
            last_dir = state.last_directive or {}
            if (
                last_dir.get("kind") == "roster_walk"
                and last_dir.get("target_member")
                and not _is_no_addition(msg)
                and len(msg) >= 3
            ):
                target_key = str(last_dir["target_member"]).lower()
                if target_key not in walked2:
                    walked2.append(target_key)
            cov.sub_signals["members_walked"] = walked2
    elif area["id"] == "2.4":
        # Format-agnostic rating extraction. Students may answer in any
        # format — "5", "5. because...", "I'd give a 4 because...",
        # "five — we...", "because of X, rate 3". Pull the first 1-5
        # number anywhere in the message as the rating for the current
        # dim; strip the leading rating token (if any) to recover the
        # justification. Auto-advance dim_cursor regardless of whether the
        # LLM split rating-vs-justification across turns.
        dims24 = [f for f in (area.get("fields") or []) if f.get("kind") == "rating_with_justification"]
        cov.sub_signals.setdefault("dim_ratings", {})
        if not isinstance(cov.sub_signals.get("dim_cursor"), int):
            cov.sub_signals["dim_cursor"] = 0
        rating_match = re.search(r"\b([1-5])\b", msg)
        dim_cursor = cov.sub_signals["dim_cursor"]
        if rating_match and dim_cursor < len(dims24) and not _is_no_addition(msg):
            rating = int(rating_match.group(1))
            justification = re.sub(r"^\s*[1-5]\s*[.,\-—–:]?\s*", "", msg).strip() or msg.strip()
            cov.sub_signals["dim_ratings"][dims24[dim_cursor]["id"]] = {
                "rating": rating,
                "justification": justification,
            }
            cov.sub_signals["dim_cursor"] = dim_cursor + 1
        nums = re.findall(r"\b[1-5]\b", msg)
        cov.sub_signals["ratings_count"] = cov.sub_signals.get("ratings_count", 0) + len(nums)


_ROSTER_STOPLIST = {
    "i", "we", "and", "or", "the", "a", "an", "my", "our", "team", "member",
    "members", "roster", "teammates", "plus", "including", "hi", "hello",
    "yes", "no", "ok", "okay", "sure", "yeah", "it", "is", "are", "be", "was",
    "so", "total", "all", "of", "us", "me", "myself", "just", "only",
}


def _extract_roster_names(msg: str) -> Optional[list[str]]:
    """Mirror of `extractRosterNames` in leai-formmode.js.

    When the message uses comma/semicolon/&/" and " delimiters, treat each
    delimited segment as one name (possibly multi-word — "Anvitha Goli"
    stays a single roster entry). Otherwise fall back to whitespace
    splitting so "Emily Amy Sarah" still resolves. Adds a "self" sentinel
    when the student includes themselves.
    """
    if not msg or len(msg) > 500:
        return None
    stripped = re.sub(r"^[\s\-—–:•]+", "", msg).strip()
    # Reject revision/correction messages. Students replying "oh for area 1,
    # revise to..." or "actually I meant..." were causing the extractor to
    # pull stray capitalized tokens (Monday, Anvitha, Google Calendar) from
    # narrative prose and lock those onto state.roster.
    if re.match(
        r"^(?:oh\s+)?(?:for\s+area|wait|hold\s+on|actually|i\s+meant|revise|rewrite)\b",
        stripped,
        flags=re.IGNORECASE,
    ):
        return None
    if re.search(
        r"\b(?:revise|rewrite|edit|update)\s+(?:to|that|it|my|the)\b",
        stripped,
        flags=re.IGNORECASE,
    ):
        return None
    # Multi-sentence prose (period / ! / ? followed by a capital letter) is
    # narrative, not a roster list. A bare roster is a single sentence.
    if re.search(r"[.!?]\s+[A-Z]", stripped):
        return None
    stripped = re.sub(
        r"^(?:it'?s|i'?m|we'?re|i\s+have|we\s+have|so\s+|on\s+my\s+team\s+(?:is|are|it'?s)?\s*)+",
        "",
        stripped,
        flags=re.IGNORECASE,
    ).strip()
    has_self = bool(
        re.search(r"\b(?:me|myself)\b", stripped, flags=re.IGNORECASE)
        or re.search(r"\(\s*me\s*\)", stripped, flags=re.IGNORECASE)
    )
    stripped = re.sub(r"\(\s*me\s*\)", " ", stripped, flags=re.IGNORECASE)
    has_delimiters = bool(re.search(r"[,;&]|\sand\s", stripped, flags=re.IGNORECASE))
    segments = (
        re.split(r"\s*[,;&]\s*|\s+and\s+", stripped, flags=re.IGNORECASE)
        if has_delimiters
        else stripped.split()
    )
    names: list[str] = []
    for seg in segments:
        tokens: list[str] = []
        for raw_tok in seg.split():
            tok = re.sub(r"[^A-Za-z'\-]", "", raw_tok)
            if not tok:
                continue
            if not re.match(r"^[A-Z][a-zA-Z'\-]*$", tok):
                continue
            if len(tok) < 2:
                continue
            if tok.lower() in _ROSTER_STOPLIST:
                continue
            tokens.append(tok)
        if tokens:
            names.append(" ".join(tokens))
    seen: dict[str, bool] = {}
    out: list[str] = []
    for n in names:
        key = n.lower()
        if not seen.get(key):
            seen[key] = True
            out.append(n)
    if has_self:
        out.append("self")
    return out if len(out) >= 2 else None


def _area_response_satisfied(state: EngineState, area: dict[str, Any]) -> bool:
    cov = state.coverage[area["id"]]
    if not cov.response_received:
        return False
    if area["id"] == "2.4":
        # Spec M6: collect all dimensions' rating+justification pairs.
        # Prefer the structured dim_cursor (one increment per captured pair
        # via the format-agnostic parser); fall back to the legacy raw-digit
        # count for compatibility with older transcripts / force_cover_all.
        dims24as = [f for f in (area.get("fields") or []) if f.get("kind") == "rating_with_justification"]
        need = len(dims24as) or 5
        return (
            cov.sub_signals.get("dim_cursor", 0) >= need
            or cov.sub_signals.get("ratings_count", 0) >= need
        )
    if area["id"] == "2.2":
        if not cov.sub_signals.get("has_roster", False):
            return False
        # Roster captured — but we still need to walk every teammate AND ask
        # the equity question before the section is done. Without this the
        # engine would (a) prematurely fire shouldProbe with the equity
        # prompt as the first response after the roster and (b) leave every
        # teammate's contribution row "(not captured)".
        roster_pretty = [n for n in (state.roster or []) if n != "self"]
        if not roster_pretty:
            return False  # no usable roster → keep asking, not "graceful pass"
        walked = len(cov.sub_signals.get("members_walked", []) or [])
        return walked >= len(roster_pretty) and bool(cov.sub_signals.get("equity_asked"))
    # Sections with multiple labeled `shortform` sub-fields (e.g. 2.3
    # worked/challenge/improvement) need at least N substantive student
    # turns before we can claim coverage.
    shortform_count = sum(
        1 for f in (area.get("fields") or []) if f.get("kind") == "shortform"
    )
    if shortform_count >= 2:
        turns = cov.sub_signals.get("substantive_turns", 0)
        return turns >= shortform_count
    return True


def _should_probe(state: EngineState, area: dict[str, Any], last_msg: str) -> bool:
    cov = state.coverage[area["id"]]
    if cov.probe_used or not cov.response_received:
        return False
    if not _area_response_satisfied(state, area):
        return False
    threshold = state.schema.get("shallow_word_threshold", 25)
    wc = len([w for w in (last_msg or "").split() if w])
    return 0 < wc < threshold


def _all_covered(state: EngineState) -> bool:
    for s in state.schema["sections"]:
        cov = state.coverage[s["id"]]
        if not cov.response_received:
            return False
        if not _area_response_satisfied(state, s):
            return False
    return True


def _count_remaining(state: EngineState) -> int:
    c = 0
    for s in state.schema["sections"]:
        cov = state.coverage[s["id"]]
        if not cov.response_received or not _area_response_satisfied(state, s):
            c += 1
    return c


# ─── directive builders ──────────────────────────────────────────────────


def _dir_opening(state: EngineState, area: dict[str, Any]) -> dict[str, Any]:
    n = len(state.schema["sections"])
    parts_blurb = state.schema.get("parts_blurb")
    if not (isinstance(parts_blurb, str) and parts_blurb.strip()):
        parts_blurb = "from this week's template"
    else:
        parts_blurb = parts_blurb.strip()
    return {
        "kind": "opening",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            "This is the OPENING turn.\n"
            "1. Greet the student briefly.\n"
            f"2. Tell them: \"I'll walk you through {n} reflection areas {parts_blurb}. You can ask to revise an earlier answer at any time, and you'll get a downloadable artifact at the end.\"\n"
            f"3. Then ask the opening question for Area 1: {area['title']}. Use this question or rephrase tightly: \"{area['opening_prompt']}\"\n"
            f"Do NOT include the \"Area 1 of {n} — {area['title']}.\" prefix yourself — engine will prepend it.\n"
            "One question only. Under 350 characters."
        ),
    }


def _dir_open_area(state: EngineState, area: dict[str, Any], i: int, n: int) -> dict[str, Any]:
    return {
        "kind": "open_area",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"You just finished the previous area. Now open Area {i} of {n}: {area['title']}.\n"
            f"Ask this opening question (rephrase tightly if needed, but keep the substance): \"{area['opening_prompt']}\"\n"
            f"Do NOT include the \"Area {i} of {n} — {area['title']}.\" prefix — engine will prepend it.\n"
            "One question only. Under 350 characters."
        ),
    }


def _dir_probe(state: EngineState, area: dict[str, Any]) -> dict[str, Any]:
    probe = area.get("depth_probe") or "Can you anchor that in a specific moment, example, or piece of evidence?"
    return {
        "kind": "probe",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"The student's answer was thin. Probe ONCE for specificity. Use the area's probe text or rephrase: \"{probe}\"\n"
            "After this probe, regardless of the student's response, the engine will move on. Do not probe again.\n"
            "One question only. Under 350 characters."
        ),
    }


def _dir_anything_else(state: EngineState, area: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "anything_else",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"The student has answered the area substantively. Now ask the wrap-up question: \"Anything else on {area['topic']} before we move on?\"\n"
            "Do NOT advance to the next area in this message — engine handles that on the next turn based on the student's reply.\n"
            "Brief acknowledgement of what they said + the wrap-up question. Under 350 characters."
        ),
    }


def _dir_continue_area(state: EngineState, area: dict[str, Any], i: int, n: int) -> dict[str, Any]:
    return {
        "kind": "continue",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"You are still on Area {i} of {n}: {area['title']}. Continue gathering substantive content for this area.\n"
            f"Already-asked opening question (do NOT re-ask verbatim — the student has heard it): \"{area['opening_prompt']}\"\n"
            "Pick a different angle: a sub-field that hasn't been answered yet, a concrete example, a counter-example, an improvement, or evidence the student hasn't given. ONE question only.\n"
            "STRICT: do NOT repeat, paraphrase, restate, or echo the opening question above — it is already in the transcript. Asking a new angle means asking something genuinely different, not the opening question with new wording.\n"
            "STRICT: emit EXACTLY ONE question mark (\"?\") in your reply. Two or more topics ending in \"?\" is forbidden — pick one.\n"
            "Do NOT advance to the next area.\n"
            "Under 350 characters."
        ),
    }


def _dir_roster_walk(state: EngineState, area: dict[str, Any], next_member: str, remaining_after: int) -> dict[str, Any]:
    tail = (
        f"After this teammate you still have {remaining_after} more to walk through before the equity question."
        if remaining_after > 0
        else "This is the last teammate before the equity question."
    )
    return {
        "kind": "roster_walk",
        "target_member": next_member,
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"You captured the roster. Now walk through teammates ONE AT A TIME — this turn is about exactly ONE teammate: {next_member}.\n"
            f"Phrasing: \"What did {next_member} primarily contribute this week?\" (rephrase tightly if needed, but the name \"{next_member}\" must appear verbatim).\n"
            f"Brief acknowledgement of the previous answer (one of the allowlisted forms only) + the single question about {next_member}.\n"
            "Do NOT bundle multiple teammates. Do NOT ask the equity question yet. Do NOT advance to the next area.\n"
            f"{tail}\n"
            "One question only. Under 350 characters.\n"
            f"REQUIRED: your reply MUST end with a question asking about {next_member}."
        ),
    }


def _dir_rate_and_justify(
    state: EngineState,
    area: dict[str, Any],
    dim_field: dict[str, Any],
    dim_idx: int,
    total_dims: int,
) -> dict[str, Any]:
    """Ask for one dimension's rating + justification together in a single turn.

    Replaces the old behavior where the engine had no per-dim state and the LLM
    would split each dim across two turns (justification then rating). Students
    who gave "5. <justification>" in one reply would still be re-asked for the
    rating, drift one dim ahead, and end up with ratings paired to the wrong
    dim's justification (transcript bug 13f9adad, turns 47–62).
    """
    cov = state.coverage[area["id"]]
    ratings = (cov.sub_signals or {}).get("dim_ratings") or {}
    dims = [f for f in (area.get("fields") or []) if f.get("kind") == "rating_with_justification"]
    dim_label = dim_field.get("dimension") or dim_field.get("label") or dim_field.get("id")
    dim_num = dim_idx + 1
    done_lines: list[str] = []
    for d in range(dim_idx):
        df = dims[d]
        r = ratings.get(df.get("id"))
        if r:
            lbl = df.get("dimension") or df.get("label") or df.get("id")
            done_lines.append(f"  [done] Dim {d + 1} \"{lbl}\" → {r.get('rating')}")
    prev_block = ("[ALREADY CAPTURED]\n" + "\n".join(done_lines) + "\n") if done_lines else ""
    return {
        "kind": "rate_and_justify",
        "target_dim": dim_field.get("id"),
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"You are on Area 2.4, dimension {dim_num} of {total_dims}: \"{dim_label}\"\n"
            f"{prev_block}"
            "Ask the student for BOTH a 1-5 rating AND a brief justification in ONE question, one turn. Do NOT split rating and justification into two separate turns — that causes the student to drift one dimension ahead.\n"
            f"Phrasing example: \"For dimension {dim_num} — '{dim_label}' — what 1-5 rating would you give it, and briefly why?\"\n"
            "The student may answer in ANY format — \"5. because...\", \"I'd give a 4 because...\", \"five — we...\", \"because of X, rate 3\". The engine parses any 1-5 number in any position as the rating and captures the rest as justification. Just acknowledge and move on to the next dimension.\n"
            "Brief acknowledgement of the previous dimension's answer (one of the allowlisted forms only) + the rate-and-justify question.\n"
            "One question only. Under 350 characters.\n"
            "REQUIRED: your reply MUST end with a single question asking for both rating and justification."
        ),
    }


def _dir_ask_equity(state: EngineState, area: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "ask_equity",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            "Every teammate contribution is captured. Now ask the equity question — ONE question only.\n"
            "Phrasing: \"Was the distribution of work equitable this week?\" (rephrase tightly if needed).\n"
            "Do NOT bundle \"and if not what would you change?\" — if they answer no, you can probe in a later turn.\n"
            "Brief acknowledgement of the previous answer (one of the allowlisted forms only) + the equity question.\n"
            "One question only. Under 350 characters.\n"
            "REQUIRED: your reply MUST end with the equity question."
        ),
    }


def _dir_close(state: EngineState) -> dict[str, Any]:
    closing = state.schema.get("closing", {})
    feedback = closing.get(
        "feedback_prompt",
        "Did this conversation surface more honest reflection than filling out the PDF would have, "
        "and what would make it work better next week?",
    )
    return {
        "kind": "close",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            f"All {len(state.schema['sections'])} areas have been covered. Wrap up by asking ONE question: \"{feedback}\"\n"
            "Engine will append [END] in code — do NOT emit [END] yourself.\n"
            "Under 350 characters."
        ),
    }


def _dir_final_ack(state: EngineState) -> dict[str, Any]:
    return {
        "kind": "final_ack",
        "text": (
            "[DIRECTIVE FOR THIS TURN]\n"
            "The student just answered the closing-feedback question. Your reply MUST be a single short acknowledgement (≤ 1 sentence, no question, no section header).\n"
            "Engine will append [END] in code — do NOT emit [END] yourself.\n"
            "Examples: \"Thanks, noted.\" / \"Got it, that's helpful — appreciate the time.\""
        ),
    }


def _looks_like_closing_feedback(displayed: str, closing_prompt: str) -> bool:
    if not displayed or not closing_prompt:
        return False
    d = displayed.lower()
    candidates = [
        "surface more honest reflection than filling out the pdf",
        "work better next week",
        "more honest reflection",
        "filling out the pdf",
    ]
    for c in candidates:
        if c in d:
            return True
    key = closing_prompt.lower().lstrip(" \t—–-:.,;!?")
    if len(key) >= 20 and key[:30] in d:
        return True
    return False


def _force_cover_all(state: EngineState) -> None:
    sections = state.schema["sections"]
    for s in sections:
        cov = state.coverage[s["id"]]
        cov.opened = True
        cov.response_received = True
        if s["id"] == "2.4":
            dims24fc = [f for f in (s.get("fields") or []) if f.get("kind") == "rating_with_justification"]
            need24fc = len(dims24fc) or 5
            cov.sub_signals["ratings_count"] = max(cov.sub_signals.get("ratings_count", 0), need24fc)
            cov.sub_signals["dim_cursor"] = max(cov.sub_signals.get("dim_cursor", 0), need24fc)
        if s["id"] == "2.2":
            cov.sub_signals["has_roster"] = True
            # _area_response_satisfied now requires the per-member walk +
            # equity question for 2.2 — fill those so a forced close still
            # satisfies the section.
            roster_pretty_fc = [n for n in (state.roster or []) if n != "self"]
            walked: list[str] = list(cov.sub_signals.get("members_walked") or [])
            while len(walked) < len(roster_pretty_fc):
                walked.append(roster_pretty_fc[len(walked)].lower())
            cov.sub_signals["members_walked"] = walked
            cov.sub_signals["equity_asked"] = True
    state.current_area_index = len(sections)
    state.awaiting_anything_else = False
