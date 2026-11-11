# HCI 271 Week 6 — Form-Mapping Mode Playtest Checklist (F1 → F8)

Walk these in order. Each step is a single click/command + the literal pass condition. If a step fails, fix before moving on — features build on each other.

> **Prereqs (one-time):**
> - [ ] From repo root: `python3 -m http.server 8080` (keep this terminal open)
> - [ ] In a **second** terminal: `cd LEAI/scripts && uv --version` succeeds (Python sim uses `uv`)
> - [ ] Browser: Chrome or Safari, devtools open (Network + Console tabs)
> - [ ] You know the public id of an existing draft survey on the Heroku DB. If not, create one in PromptDesigner first and copy its `id` from the URL — the `?id=…` value. Call this **`<SURVEY_ID>`** below.

---

## F1 — Form-mode activation (option b)

**Goal:** `?form=hci271-week6-reflection` activates the engine; without it, behavior is unchanged.

- [ ] **F1.1** Open `http://localhost:8080/LEAI/feedback.html?id=<SURVEY_ID>` (no `form=` param). Bot greets you with the **survey's normal opening** — *no* "Area 1 of 10" prefix anywhere in the chat.
- [ ] **F1.2** Open `http://localhost:8080/LEAI/feedback.html?id=<SURVEY_ID>&form=hci271-week6-reflection`. The first bot message starts with the literal string `Area 1 of 10 — Key Concepts & Takeaways.` (em-dash, not hyphen). Progress label "Area 1 of 10" visible in the chat header.
- [ ] **F1.3** In devtools Network tab, confirm `docs/forms/hci271-week6-reflection.json` was fetched 200 on the form-mode load and **not** on the no-param load.

---

## F2 — Semi-structured interview engine

**Goal:** Walk all 10 areas in order, probe shallow answers once, refuse to close until coverage is met.

Run all four personas against the live backend via the sim. **From `LEAI/scripts/`:**

- [ ] **F2.1 (engaged)** `./simulate_conversation.py --public-id <SURVEY_ID> --form hci271-week6-reflection --turns personas/engaged-wk6-form.json`
  - Log shows transitions in order from Area 1 → Area 10.
  - Each transition starts with `Area N of 10 — <exact title>`.
  - `[END]` appears **only after** Area 10's response is captured.
- [ ] **F2.2 (shallow)** `./simulate_conversation.py --public-id <SURVEY_ID> --form hci271-week6-reflection --turns personas/shallow-wk6-form.json`
  - Each area gets exactly one probe (the `depth_probe` text). No second probe even if the follow-up is also shallow.
- [ ] **F2.3 (stop-early)** `./simulate_conversation.py --public-id <SURVEY_ID> --form hci271-week6-reflection --turns personas/stop-early-wk6-form.json`
  - First `STOP` triggers the "We've still got [N] of 10 areas left — really stop?" warning.
  - Second `STOP` honored: closing message + `[END]`.
- [ ] **F2.4 (off-topic)** `./simulate_conversation.py --public-id <SURVEY_ID> --form hci271-week6-reflection --turns personas/offtopic-wk6-form.json`
  - Bot redirects every "explain X" / "write it for me" request. **No** definition of affinity diagramming, thematic analysis, etc. anywhere in the transcript.
- [ ] **F2.5 (browser parity)** Open `http://localhost:8080/LEAI/feedback.html?id=<SURVEY_ID>&form=hci271-week6-reflection`. Type the first 5 user messages from `personas/engaged-wk6-form.json` by hand. Confirm: same Area-N-of-10 prefixes appear, progress label increments, prefixes match the first 5 lines of `reports/hci271-week6/run-engaged-formmode-v2.log`.

---

## F3 — Team link with individual sessions

**Goal:** One URL per team, each student answers individually, sessions don't bleed.

- [ ] **F3.1** Open the same form-mode URL but add `&team=team-1&team_name=Coyote`. Bot's intro mentions Team Coyote (or accepts the team context without confusion).
- [ ] **F3.2** Open `&team=team-1&team_name=Coyote` in **two** private windows. Submit different content in each. In FeedbackAnalyzer, both submissions appear, and neither window's chat ever shows the other's text.
- [ ] **F3.3** Open `&team=team-2&team_name=Wolf` in a third window. Confirm separate `team_id` is captured (look at the network payload for `/message/` or check the engine state via `console.log(window.__leaiEngineState)` if exposed).
- [ ] **F3.4** When you reach Area 6 (Roles & Contributions), the bot asks for the team roster up-front (per O2 default). Provide 3 teammate names + contributions. Confirm all three appear later in the structured download.

---

## F4 — Structured form-mapped + raw transcript download

**Goal:** End-of-session download has 10 area headers (with 2.2 + 2.4 tables) on top, raw transcript appended.

- [ ] **F4.1** Complete an engaged-persona session (from F3 or fresh). After the bot emits `[END]`, a **"Download my reflection"** button is visible in the chat footer.
- [ ] **F4.2** Click it. Two formats offered (HTML/PDF + Markdown).
- [ ] **F4.3** Open the downloaded HTML/PDF in Preview. Top of file: metadata block with Course / Instructor / Name / Team / Week / Date.
- [ ] **F4.4** Each of the 10 area headers appears in order: 1.1, 1.2, 1.3 (with three sub-fields a/b/c), 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2.
- [ ] **F4.5** Section 2.2 renders as a table: columns "Team Member" + "Primary Role / Contribution This Week", at least one row per teammate.
- [ ] **F4.6** Section 2.4 renders as a table: 5 rows (shared goal / heard / disagreements / commitments / confidence) × columns Rating + Justification.
- [ ] **F4.7** Below the structured part: section "Raw Conversation Transcript" with chronological `Speaker: message` lines.
- [ ] **F4.8** If you mid-conversation said "actually, scratch that — what I meant was…", the structured part shows the **revised** answer; raw transcript still has both.
- [ ] **F4.9** Filename matches `HCI271_Reflection_Week6_<LastName>.<ext>` (or session timestamp if no name captured).
- [ ] **F4.10** Side-by-side compare against `reports/hci271-week6/golden-engaged.html` — section order and table shapes match.

---

## F5 — Instructor insights report (in-app)

**Goal:** Per-submission 350–500-word analytical brief, generated in FeedbackAnalyzer on demand.

- [ ] **F5.1** Open `http://localhost:8080/LEAI/FeedbackAnalyzer.html`. Log in with the test course credentials.
- [ ] **F5.2** Select the Week 6 scope chip. Scroll to "Student Responses". Find the submission you just produced (the form-mode one).
- [ ] **F5.3** Expand that student card. At the **top** of the card body, an **"Instructor Insights"** panel is visible with a "Form-mode" badge and a "Generate report" button. Non-form-mode submissions (other weeks/surveys) do **not** show this panel.
- [ ] **F5.4** Click "Generate report". Shimmer skeleton appears, "Generating…" status shows briefly.
- [ ] **F5.5** Within ~10–30 sec the report renders as formatted markdown with these blocks in order: TL;DR sentence → "Per-area findings" with 10 bullets → "Coverage flags" → "Team-process signals (Part 2)".
- [ ] **F5.6** Word-count badge in the panel header reads between **350 and 500**. (If outside, re-roll once with Regenerate; if still outside, that's a bug.)
- [ ] **F5.7** Pick 3 evidence quotes in "Per-area findings". Spot-check each against the raw chat below — must be **verbatim** (exact characters, no paraphrase).
- [ ] **F5.8** Click "Regenerate". Shimmer returns, a fresh report replaces the old one. Cached audio (if any) is invalidated — the old MP3 player disappears.
- [ ] **F5.9** Collapse and re-expand the card. The **same** report text reappears instantly (in-memory cache hit), no new `/openai-chat/` network call.

---

## F6 — TTS audio per submission

**Goal:** Listen button generates MP3 on demand, plays inline, downloadable.

- [ ] **F6.1** With the F5 panel showing a generated report, click "▶ Listen". Button label changes to "Loading…".
- [ ] **F6.2** In ~3 sec, an inline `<audio>` element appears below the report with native browser controls. Audio **autoplays**.
- [ ] **F6.3** Listen for ~10 seconds — voice is `nova` (warm female), narration matches the TL;DR sentence and first per-area bullets. Markdown punctuation (`**`, `#`, `-`) is **not** spoken.
- [ ] **F6.4** A "Download" button next to the audio is visible. Click it → an `insights-<sessionId8>.mp3` file lands in your Downloads folder. Plays cleanly in QuickTime.
- [ ] **F6.5** Click "▶ Listen" a second time on the same panel — playback starts **immediately** (cached blob, no network call). Confirm in devtools Network tab that no new `api.openai.com/v1/audio/speech` request fires.
- [ ] **F6.6** Click "Regenerate" on the report → re-generate audio → confirm a fresh MP3 (cache was invalidated when the text changed).

---

## F7 — Canvas instructions paragraph

**Goal:** Paste-ready paragraph for the Canvas assignment description.

- [ ] **F7.1** Open `LEAI/docs/instructor-clarifications/wk6-canvas-blurb.md`. Read top to bottom — under 150 words, plain language, covers: chat replaces PDF this week, team link, ~15–20 min duration, download → upload step, "ask Remi to revise" tip, due date placeholder.
- [ ] **F7.2** Replace `[INSERT TEAM LINK]` with `https://guii-lab.github.io/LEAI/feedback.html?id=<SURVEY_ID>&form=hci271-week6-reflection&team=team-1&team_name=Coyote`. Paste into a temporary Canvas Page → preview → renders cleanly, link is clickable.
- [ ] **F7.3** Repeat for `team-2` — different `team_name` and `team` slug, otherwise identical paragraph.

---

## F8 — Stretch: Student voice mode

**Goal:** Toggle voice on, mic input transcribed, bot reply spoken back. Skips OK if F1–F7 are green.

- [ ] **F8.1** In the form-mode chat, click the voice toggle (if surfaced). Browser prompts for microphone permission — grant it.
- [ ] **F8.2** Speak a 1-paragraph response to the current area. Whisper transcription appears in the chat as a normal user message (text, not audio).
- [ ] **F8.3** Bot's reply auto-plays via TTS. The text version is also displayed.
- [ ] **F8.4** Voice mode does **not** bypass form-mode rules — Area-N-of-10 prefixes still appear, probe-once still applies.
- [ ] **F8.5** Default-text behavior is unchanged: a fresh tab without toggling voice never asks for mic access.
- [ ] **F8.6** End the voice session, download the reflection (F4) — voiced answers are correctly captured in the structured + raw output.

---

## Cross-cutting checks (run once at the end)

### Transparency (X1–X4)

- [ ] **X1** First bot message in form-mode mentions: "I'll walk you through [N] reflection areas. You can type STOP at any point. At the end you'll get a [PDF/file] to upload."
- [ ] **X2** Progress indicator (small "Area N of 10" label) is visible somewhere in the chat UI throughout.
- [ ] **X3** Each transition message names the section that just finished + the next one coming up.
- [ ] **X4** Mid-conversation, type "what's left?" — bot answers honestly with the remaining areas.

### No-regression (Y1–Y4)

- [ ] **Y1 (T9)** Open any pre-existing General-mode survey link (no `?form=` param). Conversation behaves exactly as before — no Area prefixes, no progress label, no insights panel in FeedbackAnalyzer.
- [ ] **Y2 (T10)** Open an In-Group survey link. Team picker appears as before, conversation flow unchanged, FeedbackAnalyzer per-team grouping works.
- [ ] **Y3** No new env vars on Heroku — `git diff guiidatapipelines/` is clean for this ship.
- [ ] **Y4** localStorage keys `sessionID`, `selectedGPT`, `openaiKey` still work as before — open browser devtools → Application → Local Storage and confirm they're being read/written.

---

## Definition of Done (sign here when all green)

- [ ] All F1–F7 boxes ticked above
- [ ] T9 + T10 (Y1, Y2) ticked — no regression
- [ ] One engaged-persona PDF + insights report + TTS sample sent to Magy for sign-off
- [ ] Canvas blurb paragraph sent to Magy for sign-off
- [ ] Demo plan for 11:40 Tuesday confirmed (O7)
- [ ] F8 either ticked or explicitly skipped as stretch

> Anything not on this list is post-Tuesday work.
