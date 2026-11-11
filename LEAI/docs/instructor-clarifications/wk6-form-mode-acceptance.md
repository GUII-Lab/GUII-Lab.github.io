# Form-Mapping Mode — Acceptance Criteria & Verification Recipes

Companion to `wk6-form-mapping-mode-plan.md`. Purpose: lock the **expected behavior** for each feature so that (a) Harvey and I are aligned before I write code, (b) I can self-verify each item before claiming "done," and (c) Magy can verify in under 10 minutes by following the recipe under each feature.

**Conventions used below:**

- *Goal* = one-sentence intent.
- *Behavior contract* = numbered observable behaviors. Each one MUST be true.
- *Out of scope* = explicit non-goals so we don't scope-creep.
- *Verification recipe* = literal click/run steps with the expected result.
- *Owner of sign-off* = who has to say "yes, this passes."
- *Golden artifact* = a checked-in reference file Magy/Harvey can compare against (for the artifacts where wording matters).

A feature is **DONE** only when every item in its Behavior Contract is checked off and the Owner has signed off on the verification recipe. No partial credit.

---

## F1 — Structured Reflection mode in PromptDesigner

**Goal:** Add a third mode (`data-mode="form"`) to PromptDesigner that binds a survey to the HCI 271 Week 6 reflection template, without touching General or In-Group modes.

**Behavior contract**

- [ ] B1.1 PromptDesigner shows three tabs: *General Course Feedback*, *In-Group Feedback*, *Structured Reflection*.
- [ ] B1.2 Selecting *Structured Reflection* reveals: course/week picker, **Template** picker (only "HCI 271 Week 6 — Mapping from Data to Design" listed for now), team configuration (reused In-Group component), and a **read-only schema preview** of the 10 prompts.
- [ ] B1.3 Saving creates a survey with `mode="form"` and `form_schema_id="hci271-week6-reflection"` persisted to the backend.
- [ ] B1.4 Surveys created in *General* or *In-Group* mode behave **identically** to before this change — no UI shift, no prompt change, no analytics regression.
- [ ] B1.5 The mode badge in the header reads "Structured Reflection" when this mode is active.

**Out of scope**

- Designing a generic form-builder UI. Only the Week 6 schema is selectable for Tuesday.
- Allowing instructors to edit the schema in-app. (Schema is a checked-in JSON file.)

**Verification recipe (Harvey, ~3 min)**

1. `python3 -m http.server 8080` from repo root.
2. Open `http://localhost:8080/LEAI/PromptDesigner.html`.
3. Confirm three mode tabs are visible. Click each — General/In-Group panels match production screenshots in `LEAI/screenshots/`.
4. Click *Structured Reflection*. Confirm template picker, team config, schema preview render.
5. Save a draft survey; in the network tab, confirm payload includes `mode: "form"` and `form_schema_id`.

**Owner of sign-off:** Harvey.

---

## F2 — Semi-structured interview engine

**Goal:** Make the bot walk all 10 template sections in order, ask "anything else?" before transitioning, probe shallow answers exactly once, and refuse to close until every section has at least one student response.

**Behavior contract**

- [ ] B2.1 Bot opens with a section-1.1 question (Key Concepts), not a generic warm-up.
- [ ] B2.2 Before moving from section *n* to section *n+1*, bot asks "anything else on [topic of n] before we move on?" exactly once.
- [ ] B2.3 If the student's answer for a section is fewer than ~25 words **or** lacks a concrete example, bot probes once with a specificity prompt ("can you give a specific moment / example / sticky note that moved?"). It does NOT probe a second time on the same section even if the follow-up is also shallow.
- [ ] B2.4 Bot asks **at most one question per turn**. No "and also" follow-ups, no bulleted question lists. (Existing LEAI rule, must hold here too.)
- [ ] B2.5 Bot does NOT explain methods (affinity diagramming, thematic analysis, triangulation, etc.) — if asked, it redirects with "what part felt unclear when you tried it?".
- [ ] B2.6 If student types `STOP` before all sections have ≥1 response, bot warns once: "you've still got N sections left — really stop?". On a second `STOP`, honor it.
- [ ] B2.7 When all 10 sections have ≥1 response AND the student signals they're done, bot emits the closing message + `[END]` token (existing chat-lock mechanism).
- [ ] B2.8 Section transitions are **visible to the student**: each transition message names the next section in plain language ("Now let's switch to your team's planning this week…"). This is the "transparent" requirement.

**Out of scope**

- Forcing a minimum word count per section (we explicitly chose "probe once, then move on").
- Real-time progress meter UI (deferred unless trivial).

**Verification recipe (Harvey via sim, ~10 min)**

1. `cd LEAI/scripts && python3 simulate_conversation.py --persona engaged --form hci271-week6-reflection` — expect all 10 sections covered, one probe per shallow answer max, `[END]` at conclusion.
2. Re-run with `--persona shallow` — expect 10 transitions, 10 probes (one each), conversation still terminates cleanly.
3. Re-run with `--persona stop-early` (sends STOP after section 3) — expect single warn-then-honor.
4. Re-run with `--persona off-topic` (asks bot to define affinity diagramming) — expect redirect, no definition.
5. Diff each transcript against `LEAI/scripts/reports/hci271-week6/golden-*.md` — section transitions must be present and in order.

**Owner of sign-off:** Harvey for behavior; Magy reviews one full transcript end-to-end and approves the conversational tone.

**Golden artifact:** `LEAI/scripts/reports/hci271-week6/golden-engaged.md` (committed before Tuesday).

---

## F3 — Team link with individual sessions

**Goal:** One survey link per team. Each student answers individually about *their* team. The team identity is captured but doesn't make the session shared.

**Behavior contract**

- [ ] B3.1 Instructor configures N teams + sizes; LEAI generates N distinct survey URLs (one per team), each carrying a `team_id` query param.
- [ ] B3.2 On entering, the student is shown their team name and asked to select their own membership from a dropdown of "Member 1 / Member 2 / …" (no real names pre-filled).
- [ ] B3.3 The student's `sessionID` is bound to (`survey_id`, `team_id`, `member_slot`). Two students from the same team have **different** session IDs and never see each other's answers.
- [ ] B3.4 The 2.2 Roles & Contributions step asks the student to list teammate **names + contributions** (Magy confirmed names are OK because it's graded).
- [ ] B3.5 FeedbackAnalyzer groups submissions by team for the instructor view.

**Out of scope**

- Real-time team chat or shared canvas. Sessions are individual and isolated.

**Verification recipe (Harvey, ~5 min)**

1. Create a Structured Reflection survey with 2 teams × 3 members.
2. Open team-1 link in two private browser windows; submit answers as different members.
3. Open FeedbackAnalyzer → confirm both submissions appear under "Team 1" and neither leaks the other's content.
4. Open team-2 link, confirm it's a separate URL with a different `team_id`.

**Owner of sign-off:** Harvey.

---

## F4 — Structured form-mapped + raw transcript download

**Goal:** At the end of the session, the student gets a single PDF (and optional Markdown) containing (a) the structured answers mapped to the official template headers + (b) the raw transcript appended.

**Behavior contract**

- [ ] B4.1 "Download my reflection" button appears in the chat UI immediately after `[END]`.
- [ ] B4.2 Output PDF starts with the template metadata block (Course, Instructor, Name, Team, Week, Date) — **Name** field is filled from session, **Team** from `team_id`.
- [ ] B4.3 Each of the 10 template sections (1.1, 1.2, 1.3 with three sub-fields, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2) appears as its own header with the consolidated answer underneath.
- [ ] B4.4 Section 2.2 renders as a **table** with columns "Team Member" and "Primary Role / Contribution This Week" — exactly matching the PDF template.
- [ ] B4.5 Section 2.4 renders as a **table** with rows "We had a clear, shared goal…", "Everyone's contributions were valued…", etc. (the five dimensions), columns "Rating (1–5)" and "Brief Justification".
- [ ] B4.6 Below the structured part, a section titled "Raw Conversation Transcript" appends the full chat in `Speaker: message` format, in chronological order including any in-conversation revisions.
- [ ] B4.7 The student-said content in the structured part uses the student's **latest revision** when they reworded mid-conversation (e.g., "actually, scratch that — what I meant was…"). Earlier draft is retained only in the raw transcript.
- [ ] B4.8 Filename follows the template's convention: `HCI271_Reflection_Week6_[StudentLastName].pdf`.
- [ ] B4.9 PDF passes a sanity render check on macOS Preview AND in Adobe Reader (no broken fonts, no overflowing tables).

**Out of scope**

- Editing the PDF after download. (LEAI is the system of record up to download; post-download is the student's responsibility.)

**Verification recipe (Harvey + Magy, ~5 min)**

1. Run F2 verification recipe step 1 (engaged persona); when conversation ends, click *Download my reflection*.
2. Open the PDF and side-by-side compare against `HCI capston course resources/Reflection_template.pdf` — every section header in the same order, 2.2 and 2.4 tables present.
3. Confirm the raw transcript at the bottom matches the on-screen chat history.
4. Magy spot-checks one PDF: does it look gradable against her rubric?

**Owner of sign-off:** Magy (because she is the grader).

**Golden artifact:** `LEAI/scripts/reports/hci271-week6/golden-engaged.pdf` (committed before Tuesday).

---

## F5 — Instructor insights report (TTS-ready)

**Goal:** Per-submission written report — a concise, evidenced data-insights brief that's "深入浅出" (deep but accessible), ready to feed into TTS.

**Behavior contract**

- [ ] B5.1 Length: 350–500 words. (Roughly 2–3 minutes of TTS.)
- [ ] B5.2 Structure, in order:
  - One-sentence TL;DR — overall reflection quality and the single most striking finding.
  - **Per-section bullets** (one bullet per template section) — each bullet has: *finding* + *one direct evidence quote* from the student (≤25 words).
  - **Coverage flags** — bullet list of sections that were thinly answered or skipped.
  - **Team-process signals** — 2–3 sentences on what Part 2 surfaced about team health, since Magy specifically wants to evaluate this.
- [ ] B5.3 Tone: analytical, third-person ("the student described…"), not casual. Comparable to a UX research executive summary.
- [ ] B5.4 NO method-explanations, NO advice to the student, NO grading judgments. Pure observation + evidence.
- [ ] B5.5 All quotes are verbatim (or marked `[paraphrased]` if shortened).

**Out of scope**

- Any kind of automated grade or rubric score. Magy grades; LEAI describes.

**Verification recipe (Magy, ~3 min)**

1. In FeedbackAnalyzer, open one submission → click *Insights Report*.
2. Read it — does the TL;DR match Magy's own read of the transcript?
3. Spot-check 3 evidence quotes against the raw transcript — must be verbatim.
4. Confirm length is in the 350–500 band (the UI shows word count).

**Owner of sign-off:** Magy.

**Golden artifact:** `LEAI/scripts/reports/hci271-week6/golden-insights-engaged.md` — sent to Magy for sign-off **before Monday EOD** so we have time to iterate.

---

## F6 — TTS audio summary

**Goal:** One audio file per submission, generated by TTS over F5's report, playable in FeedbackAnalyzer.

**Behavior contract**

- [ ] B6.1 *Listen* button next to *Insights Report* on each submission.
- [ ] B6.2 Audio is generated **on-demand** (not pre-cached for every submission — cost control), then cached after first play.
- [ ] B6.3 Voice model: OpenAI TTS, voice `alloy` or `nova` (whichever Magy prefers — A/B her on a sample).
- [ ] B6.4 Audio plays inline; no download required, but a download link is offered.
- [ ] B6.5 If the report is updated, the cached audio is invalidated.

**Out of scope**

- TTS on the raw transcript (too long, less useful).
- Any voice cloning or multi-voice rendering.

**Verification recipe (Magy, ~2 min)**

1. Open a submission, click *Listen*.
2. Audio plays within ~3 seconds; sounds natural; matches the report text.
3. Close and reopen — playback is instant (cached).

**Owner of sign-off:** Magy.

---

## F7 — Canvas instructions paragraph

**Goal:** A single paragraph Magy can paste into the Canvas assignment description.

**Behavior contract**

- [ ] B7.1 Paragraph is ≤ 150 words.
- [ ] B7.2 Covers: what's changing this week (chat replaces PDF), where the team link is, expected duration, the download → upload step, the "ask Remi to revise" tip, due date placeholder.
- [ ] B7.3 No marketing/jargon — written plain enough for any HCI 271 student to follow on first read.
- [ ] B7.4 Per-team links are auto-spliced when Magy copies from PromptDesigner (one click per team → clipboard contains the paragraph + that team's link).

**Verification recipe (Magy, ~1 min)**

1. In PromptDesigner → Structured Reflection → click "Copy Canvas blurb for Team 1."
2. Paste into Canvas — paragraph reads cleanly, link is the team-1 URL.

**Owner of sign-off:** Magy.

**Golden artifact:** `LEAI/docs/instructor-clarifications/wk6-canvas-blurb.md` — final wording locked before Tuesday.

---

## F8 — (Stretch) Student voice input/output

**Goal:** Reactivate the existing voice mode so students who prefer talking can speak/listen instead of typing/reading.

**Behavior contract**

- [ ] B8.1 A toggle in the chat UI enables voice mode.
- [ ] B8.2 Microphone input → transcribed via Whisper → fed to chat as user message (visible in transcript as text).
- [ ] B8.3 Bot replies → spoken via TTS, also displayed as text.
- [ ] B8.4 Voice mode does NOT bypass form-mode coverage rules; same engine, different I/O.
- [ ] B8.5 Voice mode is opt-in; default remains text.

**Verification recipe (Harvey, ~2 min)**

1. Toggle voice on; speak a 1-paragraph response; confirm transcription is reasonable.
2. Confirm bot's spoken reply matches the displayed text.
3. Confirm the structured download still includes voiced answers correctly.

**Owner of sign-off:** Harvey.

**Stretch flag:** Skipped without consequence if F1–F7 take all available time.

---

## Cross-cutting acceptance — "transparent and clear" UX

(Promised explicitly: form mode must feel **transparent** to the student.)

- [ ] X1 At the start of the chat, Remi states up-front: "I'll walk you through 6 reflection areas. You can type STOP at any point. At the end you'll get a PDF to upload."
- [ ] X2 A subtle progress indicator (e.g., "Section 3 of 6") is visible somewhere in the chat UI. (Not a heavy progress bar — a small label.)
- [ ] X3 Each section transition message names the section that just finished + the section coming up.
- [ ] X4 If the student asks "what's left?" mid-conversation, Remi answers honestly with the remaining sections.

## Cross-cutting acceptance — "compatible with current setup"

- [ ] Y1 No regression in any General Course Feedback survey created before this change. Verified by opening one existing pre-change survey from FeedbackAnalyzer and confirming behavior is unchanged.
- [ ] Y2 No regression in In-Group surveys. Same check.
- [ ] Y3 No new required env vars on the backend deploy beyond what's already set on Heroku for OpenAI.
- [ ] Y4 Existing `sessionID`, `selectedGPT`, `openaiKey` localStorage keys still work as before.

---

## How we'll use this doc operationally

1. **Before code:** Harvey reads §F1–F8 + cross-cutting, flags any contract item that doesn't match expectation. We update this doc until we agree.
2. **During code:** Each PR/commit references the contract IDs it implements (e.g., "implements B2.1, B2.2, B2.6"). I keep a running checkbox list and tick items as I land them.
3. **Before Magy demo:** Harvey runs every Verification Recipe; any failed checkbox is a blocker.
4. **At demo:** Magy runs the Owner-of-sign-off recipes for the items she owns (F4, F5, F6, F7). She doesn't have to read this doc — she just follows the recipes.
5. **Post-demo:** Any contract item Magy disputes becomes a follow-up item, not silently changed.

This is the only place expected behavior is defined. If something isn't here, it's not in scope.
