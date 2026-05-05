#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright>=1.45"]
# ///
"""
Drive feedback.html in a real chromium browser for one or more personas,
hitting the live `/openai-chat/` proxy so the AI replies are real OpenAI
responses (not `claude -p` synthetics). Persistence happens through the
page's normal `feedback_message_api/` POSTs, so the conversations show up
in `FeedbackAnalyzer.html` exactly as if a real student had completed them.

Usage
-----
    LEAI/scripts/playwright_runner.py \
        --public-id Jz8wiDnLKkdY \
        --personas student_a,student_b,student_c,student_d \
        --mode group \
        --static-base http://localhost:8080 \
        --out LEAI/scripts/reports/run-team-<ts>.json

    LEAI/scripts/playwright_runner.py \
        --public-id QaX5gZAxQBBA \
        --personas student_e,student_f,student_g,student_h \
        --mode form \
        --static-base http://localhost:8080 \
        --out LEAI/scripts/reports/run-form-<ts>.json

Notes
-----
- `--mode group` walks the in-group flow (transparency screen → team picker →
  chat). `--mode form` walks the consent → chat flow. The script auto-detects
  by reading gpt.mode from the survey GET, but you can pin it explicitly.
- Each persona JSON may set "team_id" (numeric, the `id` field on a team in
  team_snapshot.teams). For group mode this is required.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import Page, sync_playwright


PERSONAS_DIR = Path(__file__).resolve().parent / "personas"


# ─── helpers ──────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def load_persona(name: str) -> dict:
    path = PERSONAS_DIR / f"{name}.json"
    if not path.exists():
        sys.exit(f"persona not found: {path}")
    return json.loads(path.read_text())


def wait_for_count(page: Page, selector: str, target: int, timeout_ms: int) -> None:
    page.wait_for_function(
        f"document.querySelectorAll({json.dumps(selector)}).length >= {target}",
        timeout=timeout_ms,
    )


# ─── form-mode (individual) flow ──────────────────────────────────────────

def run_form_session(page: Page, public_id: str, static_base: str, persona: dict, *,
                     turn_timeout_ms: int) -> dict:
    name = persona.get("name", "anon")
    turns = persona["turns"]

    url = f"{static_base}/LEAI/feedback.html?id={public_id}"
    log(f"  → navigating: {url}")
    page.goto(url, wait_until="domcontentloaded")

    # Consent modal.
    page.wait_for_selector("#consent-required", timeout=15_000)
    page.check("#consent-required")
    page.click("#consent-continue-btn")
    log("  ✓ consent accepted")

    # Wait for the bot's intro to render.
    wait_for_count(page, "article.msg-ai .msg-ai-text", 1, 90_000)
    intro_text = page.locator("article.msg-ai .msg-ai-text").nth(0).inner_text().strip()
    log(f"  [00] BOT: {_preview(intro_text)}")

    transcript = [{"role": "bot", "text": intro_text, "ts": _now_ms()}]
    ended = False

    for i, student in enumerate(turns, start=1):
        if ended:
            break

        prev_ai = page.locator("article.msg-ai .msg-ai-text").count()
        # Check whether input is locked.
        if page.locator("#messageInput").is_disabled():
            log("  ⨯ input locked by engine — stopping here")
            break

        page.fill("#messageInput", student)
        # Send via Enter for naturalness; click as fallback.
        page.locator("#messageInput").press("Enter")
        # Some installs of Enter do nothing; fall back to clicking.
        # The send handler also fires on Enter (see L1507-1513), so this is just defensive.
        if page.locator("#messageInput").input_value().strip():
            try:
                page.click("#sendMessage", timeout=2_000)
            except Exception:
                pass
        log(f"  [{i:02d}] STU: {_preview(student)}")
        transcript.append({"role": "student", "text": student, "ts": _now_ms()})

        try:
            wait_for_count(page, "article.msg-ai .msg-ai-text", prev_ai + 1, turn_timeout_ms)
        except Exception as e:
            log(f"  ⨯ timed out waiting for bot reply: {e}")
            break

        bot_text = page.locator("article.msg-ai .msg-ai-text").nth(prev_ai).inner_text().strip()
        log(f"       BOT: {_preview(bot_text)}")
        transcript.append({"role": "bot", "text": bot_text, "ts": _now_ms()})

        # Detect end-of-conversation (form mode locks the input + appends a notice).
        # Wait a beat for the lock + notice DOM mutations to land.
        page.wait_for_timeout(400)
        if page.locator("#messageInput").is_disabled():
            ended = True
            log("  ✓ chat locked — conversation ended")

    artifact = _capture_structured_artifact(page) if ended else None

    return {
        "persona": name,
        "persona_file": persona.get("_path"),
        "public_id": public_id,
        "mode": "form",
        "ended": ended,
        "transcript": transcript,
        "structured_artifact": artifact,
    }


# ─── group-mode (team) flow ───────────────────────────────────────────────

def run_group_session(page: Page, public_id: str, static_base: str, persona: dict, *,
                      turn_timeout_ms: int) -> dict:
    name = persona.get("name", "anon")
    turns = persona["turns"]
    team_id = persona.get("team_id")
    if not team_id:
        sys.exit(f"persona {name!r} missing required 'team_id' for group mode")

    url = f"{static_base}/LEAI/feedback.html?id={public_id}"
    log(f"  → navigating: {url}")
    page.goto(url, wait_until="domcontentloaded")

    # Transparency screen.
    page.wait_for_selector(".pre-chat-btn", timeout=20_000)
    # First .pre-chat-btn on transparency screen says "I understand, continue →".
    page.locator(".pre-chat-btn").first.click()
    log("  ✓ transparency screen passed")

    # Team picker.
    page.wait_for_selector("#tp-select", timeout=10_000)
    page.select_option("#tp-select", value=str(team_id))
    page.locator(".pre-chat-btn").first.click()
    log(f"  ✓ team picked (team_id={team_id})")

    # Chat boots.
    page.wait_for_selector("#ig-input", timeout=20_000)
    # Wait for the bot's intro to render.
    wait_for_count(page, "#ig-messages > div", 1, 90_000)

    intro_text = page.locator("#ig-messages > div").nth(0).inner_text().strip()
    log(f"  [00] BOT: {_preview(intro_text)}")
    transcript = [{"role": "bot", "text": intro_text, "ts": _now_ms()}]
    ended = False

    for i, student in enumerate(turns, start=1):
        if ended:
            break

        # In group mode, send appends BOTH a user-div AND (later) a bot-div.
        # Count children before send and require count + 2 after.
        prev_total = page.locator("#ig-messages > div").count()

        textarea = page.locator("#ig-input")
        if textarea.is_disabled():
            log("  ⨯ input disabled — stopping")
            break
        textarea.fill(student)
        page.locator('button:has-text("Send")').click()
        log(f"  [{i:02d}] STU: {_preview(student)}")
        transcript.append({"role": "student", "text": student, "ts": _now_ms()})

        try:
            wait_for_count(page, "#ig-messages > div", prev_total + 2, turn_timeout_ms)
        except Exception as e:
            log(f"  ⨯ timed out waiting for bot reply: {e}")
            break

        # Bot reply is at index prev_total + 1 (user is at prev_total).
        bot_text = page.locator("#ig-messages > div").nth(prev_total + 1).inner_text().strip()
        log(f"       BOT: {_preview(bot_text)}")
        transcript.append({"role": "bot", "text": bot_text, "ts": _now_ms()})

        # Group flow does not call lockChat(); detect end via engine-marker check
        # in window. We mirror the leai-formmode contract: state.ended is set
        # when [END] was emitted. Read it via page.evaluate.
        try:
            ended = bool(page.evaluate("() => window.formMode && window.formMode.state && window.formMode.state.ended"))
        except Exception:
            ended = False
        if ended:
            log("  ✓ engine state ended — conversation closed")

    artifact = _capture_structured_artifact(page) if ended else None

    return {
        "persona": name,
        "persona_file": persona.get("_path"),
        "public_id": public_id,
        "mode": "group",
        "team_id": team_id,
        "ended": ended,
        "transcript": transcript,
        "structured_artifact": artifact,
    }


# ─── orchestration ────────────────────────────────────────────────────────

def run(args: argparse.Namespace) -> int:
    persona_names = [s.strip() for s in args.personas.split(",") if s.strip()]
    if not persona_names:
        sys.exit("--personas is empty")

    personas = []
    for n in persona_names:
        p = load_persona(n)
        p["_path"] = str(PERSONAS_DIR / f"{n}.json")
        personas.append(p)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    runner = run_form_session if args.mode == "form" else run_group_session
    sessions = []

    with sync_playwright() as pw:
        # --disable-cache prevents stale leai-formmode.js / feedback.html from a
        # previous run — without it, edits to those files don't take effect for
        # the next playwright session.
        browser = pw.chromium.launch(
            headless=args.headless,
            args=["--disable-cache", "--disk-cache-size=0"],
        )
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        for persona in personas:
            log(f"\n[{persona.get('name', '?')}] starting session")
            page = ctx.new_page()
            page.set_default_timeout(60_000)
            try:
                t0 = time.time()
                result = runner(page, args.public_id, args.static_base, persona,
                                turn_timeout_ms=args.turn_timeout * 1000)
                result["elapsed_s"] = round(time.time() - t0, 1)
                sessions.append(result)
                log(f"  ✓ done in {result['elapsed_s']}s  ended={result['ended']}")
            except Exception as e:
                log(f"  ⨯ session failed: {e}")
                sessions.append({
                    "persona": persona.get("name", "?"),
                    "persona_file": persona.get("_path"),
                    "public_id": args.public_id,
                    "mode": args.mode,
                    "error": str(e),
                })
            finally:
                page.close()
        ctx.close()
        browser.close()

    out_path.write_text(json.dumps({
        "public_id": args.public_id,
        "mode": args.mode,
        "static_base": args.static_base,
        "started_at": _now_iso(),
        "sessions": sessions,
    }, indent=2))
    log(f"\n→ wrote {out_path}")
    return 0


def _capture_structured_artifact(page: Page) -> Optional[dict]:
    """After the chat is locked, ask the page to render the structured
    download via leaiFormMode.renderStructuredMarkdown so we can verify
    every section actually got populated. Returns
    {markdown, sections: {id: bool_has_content}} or None on failure."""
    try:
        result = page.evaluate("""() => {
            if (!window.formMode || !window.formMode.state || !window.leaiFormMode) return null;
            // Reconstruct the transcript from chatHistory (general flow) or
            // from #ig-messages / #transcription DOM (which is cheaper and
            // mode-agnostic).
            var transcript = [];
            var igMessages = document.querySelectorAll('#ig-messages > div');
            if (igMessages.length) {
                igMessages.forEach(function (m) {
                    var role = (m.style && m.style.alignSelf === 'flex-end') ? 'user' : 'assistant';
                    transcript.push({ role: role, text: m.innerText.trim() });
                });
            } else {
                document.querySelectorAll('article.msg-ai .msg-ai-text').forEach(function (el) {
                    transcript.push({ role: 'assistant', text: el.innerText.trim() });
                });
                document.querySelectorAll('article.msg-student .msg-student-text').forEach(function (el) {
                    transcript.push({ role: 'user', text: el.innerText.trim() });
                });
            }
            var md = window.leaiFormMode.renderStructuredMarkdown(window.formMode.state, transcript);
            var sections = {};
            (window.formMode.schema.sections || []).forEach(function (s) {
                // A section "has content" if its rendered block contains anything
                // beyond the "(no response captured)" placeholder.
                var re = new RegExp('## ' + s.id + '\\\\.\\\\s+' + s.title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b', 'i');
                var idx = md.search(re);
                if (idx === -1) { sections[s.id] = false; return; }
                var rest = md.slice(idx + 200, idx + 600);
                sections[s.id] = !rest.toLowerCase().includes('no response captured');
            });
            return { markdown_len: md.length, sections: sections };
        }""")
        return result
    except Exception:
        return None


def _preview(s: str, n: int = 100) -> str:
    s = (s or "").replace("\n", " ")
    return s if len(s) <= n else s[:n] + "…"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--public-id", required=True)
    p.add_argument("--personas", required=True,
                   help="Comma-separated persona names (matching personas/<name>.json)")
    p.add_argument("--mode", required=True, choices=["form", "group"])
    p.add_argument("--static-base", default="http://localhost:8080")
    p.add_argument("--out", required=True)
    p.add_argument("--headless", action="store_true", default=True)
    p.add_argument("--no-headless", dest="headless", action="store_false")
    p.add_argument("--turn-timeout", type=int, default=180,
                   help="Per-turn timeout in seconds")
    return p.parse_args()


if __name__ == "__main__":
    sys.exit(run(parse_args()))
