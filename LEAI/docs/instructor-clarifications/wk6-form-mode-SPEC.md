# HCI 271 Week 6 Form-Mapping Mode — Frozen Spec for This Ship

This is the single freeze document for the Tuesday 2026-05-05 ship. It supersedes any earlier verbal alignment. If something is in conflict, this doc wins.

Companion docs (don't re-read them — this one absorbs and freezes the relevant parts):
- `wk6-form-mapping-mode-plan.md` — strategy + architecture (informational; spec below is the contract)
- `wk6-form-mode-acceptance.md` — verification recipes (still binding for Definition of Done)
- `wk6-magy-reflection-feedback.md` — Slack thread with Magy
- `wk6-hci271-reflection-formmode.md` — the form-mode prompt (becomes a thin prompt under option (b))
- `LEAI/docs/forms/hci271-week6-reflection.json` — the section schema

---

## §1. Scope and deadline

**Ship date:** Tuesday 2026-05-05, before 11:40 (in-class demo with HCI 271 Capstone I).
**Deliverable:** A working form-mapping reflection flow Magy and Harvey can demo in class, plus a downloadable graded artifact, plus an instructor-side insights report with TTS, plus a Canvas blurb.

### In scope for Tuesday
1. **F1** — survey can be marked as form-mode (option (b): query param `?form=hci271-week6-reflection`; no PromptDesigner UI changes needed for the demo)
2. **F2** — semi-structured interview engine (code-enforced state machine — see §4)
3. **F3** — team link with individual sessions (per-team URL; in-session team-member dropdown; isolated `sessionID`)
4. **F4** — structured form-mapped + raw transcript download (PDF + Markdown)
5. **F5** — instructor insights report per submission (350–500 words, "深入浅出" data-insights brief)
6. **F6** — TTS audio per submission, on-demand
7. **F7** — Canvas instructions paragraph (auto-splice per team)

### Stretch (only if F1–F7 are green Monday EOD)
8. **F8** — student voice input/output

### Explicitly deferred (post-Tuesday)
- Full PromptDesigner third-tab UI (we'll layer it on after Tuesday using the engine built here)
- Cross-submission topic-frequency view (Magy mentioned, but is post-Tuesday because it requires multiple submissions to be useful)
- Generic form-builder UI (Week 6 schema is hard-coded for now)
- Backend deploys requiring Heroku changes (everything Tuesday-ship is client-side or uses existing endpoints)

---

## §2. Confirmed decisions — single audit sheet

One row per locked decision. Source column carries the verbatim quote from Slack (Magy, M1–M12) or this session (Harvey, H1–H11). If a decision drifts from the quote, that's a bug in the spec.

| ID | Decision | Source (verbatim) | Effect on spec |
|----|----------|-------------------|----------------|
| **Initial brief** | Reflection must hit all template points (key concepts, methods in practice, knowledge shift, team processes); transitions between sections required; "all students reflect on all points or at least are asked to"; Tuesday deadline; 11:40 demo offered; downloadable script for grading even though that breaks anonymity. | Magy: "I do want the reflection to hit all the points in the reflection assignment, please see attached. They need to reflect on key concepts, methods in practice, knowledge shift, team processes. So the interaction needs to acknowledge shift between these major points for discussion and reflection to make sure all students reflect on all points or at least are asked to." / "Do you think you can make that happen before Tuesday? Also, if can would you be able to make it at 11:40 to show the students how to use it and how to get in their reviews. Also, I need a functionality of them downloading the script so they can upload it to get a grade. Sorry this would break anonymity but they are graded for reflection. So I need that ability to download the script. The data is stored anonymously so that is fine on the AI side." | Drives entire ship: §1 deadline, F2 coverage gate, F4 download, M5 anonymity tradeoff. |
| **M1** | Coverage = semi-structured interview, agent walks sections in order and asks "anything else?" before advancing. | Magy 2:29 PM: "Yes, (A) with a transition, like it can be semi-structured interview, where the agent asks if they have anything else before they go to the next section of the interview." | F2 / engine §4 E2–E4. |
| **M2** | One-line answers OK; bot probes deeper once; moves on if student doesn't take it. | Magy 2:29 PM: "Students can have 1 line answer, you can prompt deeper reflection once, if they don't take it then you can move on" | F2 / engine §4 E7. |
| **M3** | Part 2 (team process) is the part Magy most wants to evaluate LEAI on; non-negotiable. | Magy 2:29 PM: "Yes, the part 2 is crucial actually because this is where I want to evaluate LEAI" / "for team work" | Areas 5–8 in schema, F5 team-signals bullet block, no-skip on team areas. |
| **M4** | One survey link per team; instructor pre-specifies team name + member count; each student fills out an individual session covering Part 1 + Part 2 + Part 3. | Harvey 2:31 PM: "i was planning one link for each team(instructor/ Ta specify team name and # of teammates)" → Magy 2:31 PM: "That is ok. We can ask them to fill out the two parts." → Harvey clarifying answer: "individual, each answer on survey of the team" | F3 (team link with individual sessions). |
| **M5** | 2.2 Roles & Contributions captures each teammate's name + contribution. Names in transcript are OK because grading needs identification. | Harvey: "8 list name + contribution" + Magy initial: "Sorry this would break anonymity but they are graded for reflection. So I need that ability to download the script. The data is stored anonymously so that is fine on the AI side." | Schema area 2.2 `kind: table`; engine §4.3 E9 (roster threshold). |
| **M6** | 2.4 Team Health collects all five 1–5 ratings + justifications. | Harvey: "score" (immediately after M5, in same message) | Schema area 2.4 `rating_with_justification` × 5; engine §4.3 E9 (rating threshold ≥3 of 5). |
| **M7** | Download = option (C): structured form on top + raw transcript appended. PDF or any uploadable file is fine. | Magy 2:35 PM: "(C) is fine." / Magy 2:36 PM: "PDF or other forms of files they can upload is fine. It is just a file upload for this submission" | F4 (§8 of this doc). |
| **M8** | One TTS audio per submission, generated from the structured insights report. Transcript quality first; TTS is easy. Insights report must be 深入浅出, evidenced, concise — like a data-insights brief, ready for TTS. | Magy 2:30 PM: "Also if you have a summary voice over for the instructors that would be great. So we can listen than read." / Harvey Q9 reply: "one audio per survey, but we shoudl focus on teh transcript first, tts is easy, if the transcript is 深入浅出, covers teh comprehensive status as well as the details and evidences, like a data inisghts report but more concise, that's ready for tts" | F5 / F6 (§9 of this doc). |
| **M9** | Insights granularity = per-person (mirrors current dashboard). Cross-submission "topics that come up more frequently" view requested but post-Tuesday. | Magy 2:30 PM: "Summary for instructors can be per person like you have in the dash board, but it would also be nice to see what topics come up more frequently" | F5 per-submission for Tuesday; cross-submission view in §1 deferred list. |
| **M10** | Canvas instructions paragraph required, paste-ready for the assignment description. | Magy 2:32 PM: "Can you also put together the instructions in a paragraph, so I can add it to the assignment link they use in canvas?" | F7 (§10 of this doc). |
| **M11** | Student voice mode is stretch — "if easy to activate." Tuesday priority: cover all features → TTS at end → Canvas blurb before that → insights report folded into the "(5)" Tuesday slot. | Magy 2:32 PM: "Also, is there a voice option? I remember Sai had that in his earlier one, it may be easier for some students to use voice option." / "if that is easy to activate" / Harvey 2:37 PM: "i will prioritize the other features we talked about and then if there's time before Tuesday i will add the voice input and output feature, how about that?" / Harvey Q10 reply: "10 cover all, tts at the end, and canvas instruction before it, but insight report in 9 at (5)" | F8 stretch only; F1–F7 ordering matches Q10 reply. |
| **M12** | Reflection week = Week 6 (Mapping from Data to Design). | Harvey Q11 reply: "11 wk 6" (anchored to Magy's "before Tuesday" deadline). | Schema `week: 6`; class context references Week 6 content. |
| **H1** | Cover all features in the build even though Harvey told Magy not everything would land — this is internal scope expansion. | Harvey: "Though I told Maggie that we may not have time to cover everything, we should cover everything. Here. And you should plan everything in details." | §1 in-scope = F1–F7; F8 stretch only. |
| **H2** | Workflow must be transparent and clear; compatible with current setup; must not interfere with other classes' surveys. | Harvey: "we need to make the new workflow still very transparent and clear. And, also, compatible with the current setup." | Cross-cutting X1–X4 (transparency) + Y1–Y4 (no-regression) in `wk6-form-mode-acceptance.md`; opt-in `?form=` activation (§5). |
| **H3** | New mode = "form-mapping mode" alongside existing feedback-collection and team modes. Specific to this HCI 271 case; do not modify shared infra. | Harvey: "Let's make another mode actually as form mapping mode. Besides to the existing feedback collection mode and the team mode, has created that. So that's specific for this case. That we won't interfere with any existing service from other classes." | F1 introduces `mode="form"`; option (b) ships via query param; full PromptDesigner third tab deferred (§1 deferred). |
| **H4** | Per-feature acceptance criteria that Harvey, the assistant, and Magy can each easily verify. | Harvey: "We should be clear about all the expectations for each feature. Right? Because the new logic seems kind of sophisticated. So we need a way that whenever you are you you complete I can easily verify. You can easily verify us now because we know we are aligned on the expectations on features. And, also, you and Maggie can easily verify that. Right? That is very important and critical because mapping to a form is something new that we have not expected with the implementations. That become very kind of important." | `wk6-form-mode-acceptance.md` (per-feature contract + verification recipe + owner-of-sign-off); §11 T1–T10 in this doc; §12 single Definition of Done checklist. |
| **H5** | Validate uncertain choices via deployed-survey simulation first; fall back to written confirmation only when sim can't reach the question. | Harvey: "confirm anything you are not sure about with me through survey before you start, and if survey not possible, other ways are fine too" | §3 open items O1–O5 → sim validation; O6/O7 → written confirmation. |
| **H6** | Test ourselves before involving Magy; Magy sees only finished artifacts. | Harvey: "path1, we test ourselves first" | §11 T1–T8 run before any Magy touchpoint; T9/T10 are no-regression blockers. |
| **H7** | Stop iterating the prompt to solve structural problems — implement the features in code. Structural rules belong in the engine, not the system prompt. | Harvey: "Why are we testing the problem with all the system being implemented? All of the problems are still in the beginning set. And the original individual survey option. Why are we doing that again? We in iterating the prompt. Without implementation of features." | §4 engine contract added; prompt slimmed to tone/probing; engine owns counting/ordering/transitions/coverage/STOP/`[END]`. |
| **H8** | Option (b) must let us test "as if the survey actually works as expected" — i.e., end-to-end faithful, not a stub. | Harvey: "Can we pass the prompts or how the survey work as if the survey actually works as expected through option b?" | §6 Python sim mirror + §6.1 Playwright parity check; both browser and sim consume the same schema JSON; structural divergence = parity bug. |
| **H9** | Build option (b). | Harvey: "go for b then" | §1 in-scope F1 ships in option-(b) form (query param, no PromptDesigner UI); proper UI deferred. |
| **H10** | Freeze all requirements and expectations before any code. | Harvey: "before go for b, make sure you have all requiremenst and expectations written down already for this entire ship" | This document is the freeze; §14 names it as the source-of-truth on conflicts. |
| **H11** | Every spec item must trace back to the original Slack quote (Magy) or session quote (Harvey). | Harvey: "good, match them with the original sentences from magy and my explantions to you from the chat history in this session" | This §2 sheet — every row carries the verbatim quote. Future spec edits must update this row's source quote when a decision changes. |

---

## §3. Open items (defaults locked, will validate via sim or quick written confirmation)

These are choices not explicitly answered by Magy but blocking implementation. Default is locked; if a sim run surfaces a problem we revisit, otherwise default ships.

| ID | Question | Locked default | Validation |
|----|----------|----------------|------------|
| O1 | STOP warn-text wording | "We've still got [N] of 10 areas left — really stop?" | Sim — `stop-early-wk6-form` persona |
| O2 | 2.2 collection style | Ask roster up-front, then walk member-by-member, then equity question | Sim — `engaged-wk6-form` persona |
| O3 | 2.4 rating order | Justification first, then number, per dimension (prevents default-fives) | Sim — `engaged-wk6-form` |
| O4 | Insights report length/structure | 350–500 words; TL;DR sentence → per-section bullets w/ verbatim quote → coverage flags → 2–3 sentence team-process signals | Generate sample from sim transcript, ship to Magy for sign-off Monday EOD |
| O5 | TTS voice | OpenAI `nova` (warmer than `alloy`) | A/B sample to Magy in same Monday email |
| O6 | Anonymity in insights | Names retained in graded download; redacted in any cross-submission view (which is post-Tuesday anyway) | Confirmed in writing |
| O7 | Demo flow at 11:40 | 2 min Harvey walkthrough → 8 min students do their own → 2 min on download → upload step | Confirm in writing with Magy by Monday |
| O8 | Reflection content the students reflect on | Their actual Week 6 work (synthesis, affinity, thematic analysis, capstone progress). Bot does not teach. | Inherits from existing prompt and class context |

---

## §4. Engine contract (option (b) — code-enforced state machine)

The engine is the heart of F2. It is a **pure state-transition module** that wraps the LLM call. It is the single source of truth for: which area is current, which areas have been covered, what prefix to inject on transitions, when `[END]` is allowed.

### §4.1 State shape

```
EngineState = {
  schema_id: str,
  current_area_index: int (1..10),
  coverage: { area_id: { opened: bool, response_received: bool, probe_used: bool } },
  stop_warn_issued: bool,
  ended: bool,
  team_id: str | null,
  team_member_slot: str | null,
}
```

### §4.2 Engine interface (used identically by browser and sim)

```
engine.init(schema, team_id, team_member_slot) -> EngineState
engine.before_llm_call(state, last_student_message) -> {
  inject_system_message: str | null,   # injected per-turn so the LLM knows where it is
  block_end: bool,                      # if true, [END] in the response is stripped and we continue
}
engine.after_llm_call(state, llm_response) -> {
  delivered_message: str,               # the message actually shown to the student (may be prefixed)
  next_state: EngineState,              # mutated to reflect this turn
  ended: bool,                          # true only if [END] is honored
}
engine.is_complete(state) -> bool       # all 10 areas have response_received == True
engine.advance(state) -> EngineState    # called when the engine decides current area is done
```

### §4.3 Engine responsibilities (must be in CODE, not prompt)

- E1. Maintain `current_area_index` and never let it skip more than +1 unless the student honor-STOPs out.
- E2. Inject a per-turn system message: *"You are currently on Area N of 10 — [Title]. Stay on this area. The next area after this one is Area N+1 — [Next Title]. Do not advance unless I tell you the area is complete."*
- E3. Detect "ready to advance" signal in student's message (heuristics: "move on", "next", "let's go", "done", "nothing else", or a lull where the student gave a substantive answer + acknowledged "anything else" question with negative). When detected, mark area covered (`response_received=true`) and call `advance()`.
- E4. Prepend the canonical `Area N of 10 — [Title].` prefix to every transition message **in code**, regardless of whether the LLM produced it. (If the LLM also produced one, dedupe.)
- E5. Strip any `[END]` token from the LLM response if not all 10 areas have `response_received=true`. If stripped, append a code-injected "Area [N+1] of 10 — [Title]. …" continuation prompt to the next turn.
- E6. STOP intercept:
  - On first STOP (case-insensitive, whole-word) from student while `is_complete(state) == false`: respond with code-injected "We've still got [N] of 10 areas left — really stop?" Set `stop_warn_issued=true`. Do NOT call the LLM this turn.
  - On second STOP after `stop_warn_issued`: honor — emit code-injected closing message + `[END]`. Mark `ended=true`.
  - If between the two STOPs the student says anything not-STOP: clear `stop_warn_issued`, resume normally.
- E7. Probe-once: track `probe_used` per area. The engine asks the LLM to probe by injecting a "the previous answer is shallow — probe once for specificity" hint, then on the next student response sets `probe_used=true` regardless of depth. The LLM never gets to probe twice on the same area.
- E8. Coverage definition: an area is "covered" (`response_received=true`) when the student gives a non-empty, non-STOP response to the area's opening question OR to its probe.
- E9. For Area 6 (Roles) and Area 8 (Health Check), `response_received` requires structured sub-fields:
  - Area 6: at least one teammate name + contribution captured in the transcript
  - Area 8: at least 3 of 5 dimensions have a rating + justification (we accept incomplete-but-tried)
  - Below threshold → engine forces a follow-up before advancing

### §4.4 Prompt's reduced responsibilities (under option (b))

Once the engine owns state, the prompt only needs to handle:

- Tone, warmth, brevity (≤ 350 chars)
- Asking ONE question per turn
- Domain knowledge (Week 6 content, NN/g pitfalls, etc.) — for substantive probes
- Not teaching / not writing the reflection for the student
- Following the engine's per-turn system messages

The prompt does **not** need to count to 10, enforce ordering, manage transitions, or gate `[END]`. The engine owns all of that.

---

## §5. JS implementation (browser side)

- **New file:** `LEAI/leai-formmode.js` — the engine module. Exports a global `leaiFormMode` object with methods from §4.2.
- **Schema fetch:** loaded from `LEAI/docs/forms/hci271-week6-reflection.json` via `fetch()` on page init.
- **Activation:** `feedback.html` reads `URLSearchParams.get('form')`. If present and matches a known schema id, the form-mode wrapper activates. If absent, behavior is unchanged.
- **Wiring:** the existing chat path in `feedback.html` is wrapped — `engine.before_llm_call` runs before the `/openai-chat/` POST, `engine.after_llm_call` runs after. Injected system messages are prepended to the message array passed to OpenAI.
- **Progress indicator:** small label "Area N of 10" rendered in the chat header. Updates from `engine.state.current_area_index`.
- **STOP/END handling:** code-side intercepts before the LLM is called; LLM response post-processed.
- **Compatibility:** zero impact on surveys without `?form=` param. Engine code is opt-in and tree-shakable.

---

## §6. Python sim mirror

- **Modify:** `LEAI/scripts/simulate_conversation.py` to import and apply the same engine logic.
- **Approach:** re-implement the engine in Python (small surface — see §4 spec). Both engines consume `LEAI/docs/forms/hci271-week6-reflection.json` so the schema is the only shared data, removing JS↔Python serialization headaches.
- **CLI flag:** `--form hci271-week6-reflection` activates the mirror. Without it the script behaves as before.
- **Persisted output:** still writes to FeedbackMessage table so transcripts show up in FeedbackAnalyzer for review.

### §6.1 Parity check

After the JS and Python engines exist, run one Playwright session against `feedback.html?id=...&form=hci271-week6-reflection` with the engaged persona's first 5 turns. Diff the bot's transition prefixes and the engine's injected system messages against the sim's. They should match modulo LLM tone variance. Any structural divergence (different area counts, different transition prefixes, different STOP behavior) is a parity bug — fix before claiming F2 done.

---

## §7. Schema requirements (`LEAI/docs/forms/hci271-week6-reflection.json`)

Already exists; freeze:

- 10 areas, ordered, each with: `id`, `title`, `topic`, `opening_prompt`, `depth_probe`, `fields[]`
- 1.3 has 3 sub-fields (`1.3a/b/c`)
- 2.2 has `kind: table` field with min_rows enforcement (M5 requirement)
- 2.4 has 5 `kind: rating_with_justification` fields (M6 requirement) with `collection_strategy: "ask justification first, then rating"` (O3 default)
- 2.3 has 3 sub-fields (worked / challenge / improvement)

Engine reads `collection_strategy` and `min_rows` to decide whether an area's `response_received` threshold is met (§4.3 E9).

---

## §8. Download (F4) — structured + raw transcript

- **Trigger:** "Download my reflection" button appears after `engine.ended == true`.
- **Format:** PDF as primary, Markdown as secondary (one-click toggle).
- **Top section — structured:** each of the 10 area titles as headers; consolidated answer below. 2.2 renders as a 2-column table (Team Member / Contribution). 2.4 renders as a 3-column table (Dimension / Rating / Justification).
- **Bottom section — raw transcript:** "Speaker: message" format, chronological, includes any in-conversation revisions.
- **Filename:** `HCI271_Reflection_Week6_[StudentLastName].pdf`. If no student name captured, use session timestamp.
- **Implementation:** client-side render via `jspdf` (CDN) — no backend deploy needed.
- **Latest-revision rule:** if the student asked to revise an answer mid-conversation, the structured part uses the latest version. Raw transcript retains both.

---

## §9. Insights report (F5) and TTS (F6)

- **Generation:** on FeedbackAnalyzer per-submission view, "Generate Insights Report" button. Calls `/openai-chat/` with a fixed system prompt that produces the structure in O4. Result cached on the submission record.
- **Length:** 350–500 words. UI shows word count.
- **Structure:**
  1. TL;DR sentence
  2. Per-area bullets (one per area; finding + verbatim quote ≤ 25 words)
  3. Coverage flags (which areas were thinly answered or skipped)
  4. Team-process signals — 2–3 sentences (M3: this is the part Magy specifically wants visibility on)
- **Tone:** analytical, third-person ("the student described…"). Not casual. No grading judgments. No advice to the student.
- **TTS:** "Listen" button triggers OpenAI TTS (`nova` voice, see O5). Audio cached after first play. Inline `<audio>` element + download link.
- **Cost guard:** TTS is on-demand only, not auto-generated for every submission.

---

## §10. Canvas blurb (F7)

- **Where:** PromptDesigner shows a "Copy Canvas blurb for Team [N]" button per team after the survey is saved. (For option (b) Tuesday demo, we'll just provide the paragraph as a static template Magy edits per team.)
- **Content:** ≤ 150 words. Explains: chat replaces PDF this week, the team link, ~15–20 min duration, download → upload step, "ask Remi to revise" tip, due date placeholder.
- **Final wording lives in:** `LEAI/docs/instructor-clarifications/wk6-canvas-blurb.md` (locked Monday EOD).

---

## §11. Test recipes for this ship

Each F-feature already has a Verification Recipe in `wk6-form-mode-acceptance.md`. Augment with these engine-specific test runs:

| ID | Test | Expected |
|----|------|----------|
| T1 | `simulate_conversation.py --public-id <ID> --form hci271-week6-reflection --turns engaged-wk6-form.json` | All 10 areas opened in order. All 10 transitions show "Area N of 10 — [exact canonical title]." `[END]` only after Area 10. |
| T2 | Same with `shallow-wk6-form.json` | All 10 areas opened. Each shallow answer probed exactly once. `[END]` after Area 10 despite thin content. |
| T3 | Same with `stop-early-wk6-form.json` | First STOP triggers "We've still got [N] of 10 areas left — really stop?" Second STOP honored, `[END]` emitted. |
| T4 | Same with `offtopic-wk6-form.json` | Bot redirects every off-topic / "teach me" / "write it for me" request. Never explains a method. All 10 areas still covered. |
| T5 | Browser parity: open `https://guii-lab.github.io/LEAI/feedback.html?id=<ID>&form=hci271-week6-reflection` in Playwright; play first 5 engaged-persona turns | Transition prefixes and progress indicator match T1's first 5 transitions. |
| T6 | Download PDF from a completed engaged-persona session | Structure matches §8: header block → 10 area headers → 2.2 table → 2.4 table → raw transcript. Compare side-by-side with the original `Reflection_template.pdf`. |
| T7 | Insights report from same session | Length 350–500 words. Has TL;DR + 10 bullets + flags + team signals. Quotes are verbatim. |
| T8 | TTS playback on the report | Plays under 3 sec to start; audio matches text; downloadable. |
| T9 | Existing General-mode survey (no `?form=` param) opened from a pre-change link | Behaves exactly as before this change. No regression. |
| T10 | Existing In-Group-mode survey | Behaves exactly as before. |

T9 and T10 are the no-regression gate — required before merging.

---

## §12. Definition of Done (whole ship)

The ship is DONE only when:

- [ ] All M1–M12 (Magy's confirmed asks) are reflected in the deployed flow.
- [ ] All B-items in F1–F7 from `wk6-form-mode-acceptance.md` are checked off.
- [ ] T1–T10 pass.
- [ ] Magy has signed off on:
  - one engaged-persona PDF (F4)
  - one insights report (F5)
  - one TTS audio sample with chosen voice (F6)
  - the Canvas blurb wording (F7)
- [ ] No regression on existing General or In-Group surveys (T9, T10).
- [ ] Canvas blurb is finalized and ready to paste.
- [ ] Demo plan for 11:40 Tuesday is written and confirmed (O7).

Anything not on this list is stretch (F8) or post-Tuesday.

### §12.1. Build status snapshot (2026-05-02 EOD)

| ID | Feature | Status | Evidence |
|----|---------|--------|----------|
| F1 | Form-mode activation | **DONE (option b)** | `?form=hci271-week6-reflection` URL param activates the engine in `feedback.html`; PromptDesigner tab UI is the post-Tuesday upgrade. |
| F2 | Semi-structured interview engine | **DONE** | `leai-formmode.js` + `leai_formmode.py`. T1 (engaged), T2 (shallow), T3 (stop-early), T4 (offtopic) all pass on B2.1–B2.8. Logs in `LEAI/scripts/reports/hci271-week6/run-*-formmode-v2.log`. |
| F3 | Team link + individual sessions | **MVP DONE** | `?team=` and `?team_name=` URL params get tagged into the engine state and into the structured download. Per-team UI picker is post-Tuesday. |
| F4 | Structured + raw transcript download | **DONE** | "Download my reflection" button appears in the chat footer after `[END]`. HTML and Markdown formats. Golden artifact: `LEAI/scripts/reports/hci271-week6/golden-engaged.{html,md}`. |
| F5 | Instructor insights report | **DONE (offline generator)** | `LEAI/scripts/generate_insights_report.py` produces the 350–500-word brief with TL;DR + per-area + flags + team-process signals. Golden: `LEAI/scripts/reports/hci271-week6/golden-insights-engaged.md`. FeedbackAnalyzer integration is post-Tuesday. |
| F6 | TTS audio per submission | **NOT BUILT** | The insights report is TTS-ready (M8: "if the transcript is 深入浅出… that's ready for TTS"). Wiring TTS playback in FeedbackAnalyzer is a 1–2 hour task — defer to Sunday/Monday. |
| F7 | Canvas blurb | **DONE (locked)** | `LEAI/docs/instructor-clarifications/wk6-canvas-blurb.md` — paste-ready paragraph + per-team URL template. |
| F8 | Student voice mode | **STRETCH** | Existing voice plumbing in `leai-shared.js` is untouched; not exercised in form-mode yet. |

### §12.2. Pending verification (Harvey before Tuesday)

- [ ] T5 — Browser parity check: open `https://guii-lab.github.io/LEAI/feedback.html?id=nXaOZjVCx6NV&form=hci271-week6-reflection` in a real browser, walk through engaged-persona's first 5 turns by hand, confirm the "Area N of 10" prefix appears and the progress indicator updates. Compare against `LEAI/scripts/reports/hci271-week6/run-engaged-formmode-v2.log`.
- [ ] T6 — Click "Download my reflection" at end of session, confirm the HTML artifact matches `golden-engaged.html` structure and renders cleanly in Preview.
- [ ] T9 — Open any pre-existing General-mode survey link (without `?form=`), confirm behavior is unchanged.
- [ ] T10 — Open an In-Group survey link, confirm behavior is unchanged.

### §12.3. Pending Magy sign-off (deliver Sunday/Monday)

- [ ] F4 sample: send `golden-engaged.html` to Magy → "does this look gradable?"
- [ ] F5 sample: send `golden-insights-engaged.md` → "does this read well? would you want it shorter / different structure?"
- [ ] F7 blurb: send paragraph from `wk6-canvas-blurb.md` → "ready to paste into Canvas?"
- [ ] O7 demo plan: confirm 2 min Harvey walkthrough → 8 min students → 2 min on download flow.

---

## §13. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Engine drifts between JS and Python implementations | T5 parity check before claiming F2 done; both engines consume same JSON schema as single source of truth |
| LLM still confabulates titles even with engine-injected system messages | Code-side prefix injection (E4) ensures the displayed title is correct regardless of what the LLM says |
| `jspdf` PDF rendering issues on older Safari | Markdown download as fallback; PDF is primary for Tuesday but MD is always available |
| TTS cost spikes if generated for every submission | On-demand only (M8 + §9 cost guard) |
| Demo session reveals a behavior we didn't test | Run T1–T4 plus a Harvey-driven manual session in the actual browser before Tuesday |
| Magy unavailable for sign-off Monday | Send F4/F5/F6/F7 samples Sunday EOD to give a 24h cushion |

---

## §14. Cross-references and source-of-truth map

| Topic | Authoritative source |
|-------|----------------------|
| Magy's confirmations | §2 of this doc + `wk6-magy-reflection-feedback.md` Slack archive |
| Engine contract | §4 of this doc |
| Schema structure | `LEAI/docs/forms/hci271-week6-reflection.json` |
| Form-mode prompt (thin) | `LEAI/docs/prompts/wk6-hci271-reflection-formmode.md` (will be slimmed once engine exists) |
| Per-feature acceptance + verification | `wk6-form-mode-acceptance.md` |
| Whole-ship Definition of Done | §12 of this doc |
| Strategic plan / architecture | `wk6-form-mapping-mode-plan.md` |

If anything is found in two places and they disagree, **this doc wins.** Update the other doc to match.
