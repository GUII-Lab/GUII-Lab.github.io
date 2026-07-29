# Change Log — 2026-06-17

## Task: Draft Slack message + email for LEAI innovation scholarship end-of-quarter update

### Actions taken

1. Explored LEAI repo directory structure (top-level files, docs/, scripts/, legal/, mockups/)
2. Read leai-version.js — confirmed v0.2.8, last updated 2026-06-14
3. Read student-instructions.md — confirmed deployed URLs and student workflow
4. Read docs/instructor-guide.md — understood full system architecture (Prompt Designer, Feedback Collector, Feedback Analyzer)
5. Read docs/roadmap.md — understood fellowship commitments and feature status
6. Checked docs/prompts/ — confirmed LEAI was used in HCI 271 (wk6–10) and CMPM 80H (wk1–5)
7. Checked scripts/reports/ — found compliance testing reports (54/54 passing for CMPM 80H)
8. Read instructor-guide.html — confirmed Instructor Insights feature with citation-backed analysis
9. Checked docs/instructor-clarifications/ — found compliance patch docs and form-mode specs
10. Checked legal/ — confirmed privacy policy and terms of use published
11. Checked for .context/ and session-handoff.md — none found

### Files created

- LEAI_Email_Drafts.md — contains Slack draft to Magy and email draft to David Lee
- change-log.md — this file

### Decisions

- Included interviews as a brief mention (per Li's instruction to defer to best judgment — mentioned without overclaiming)
- Used "HCI 271 instructor" rather than naming Magy in the email to David, keeping it professional
- Acknowledged David's previous feedback about clarity as the opening framing
- Included the 54/54 compliance testing stat as concrete quality evidence
- Used the guii-lab.github.io URL (with hyphen) matching the student-instructions.md links
- Saved drafts to the LEAI workspace folder (user's requested path was outside mounted directory)

### Next steps

- Li reviews both drafts and adjusts as needed
- Send Slack message to Magy for her review
- After Magy's approval, send email to David

---

## 2026-06-18 — Task: CMPM 80H prompt verification + production deployment

### Actions taken

1. Verified the 9 CMPM 80H prompts (5 form + 4 group) via persona simulation — 84 conversations across runs, **0** acknowledgement-allowlist / one-question / no-define violations; every "engaged" persona reached the closing `[END]` (full coverage)
2. Applied + deployed the per-turn tone-gate fix to the production engine `leai-formmode.js` (mirrored in `leai_formmode.py`): static system-prompt tone rules are ignored ~90% of the time even by Opus; only the per-turn `[DIRECTIVE]` binds, so the ack-allowlist + no-define rules are now injected each turn
3. Added anti-"canned" refinements: rotate the wrap-up ("anything else…") phrasing by turn index so a re-asked wrap-up is never verbatim; vary the no-define refusal opener ("I can't" / "I won't" / "I'm not going to")
4. Bumped LEAI `v0.2.7 → v0.2.8` and cache-busted the engine include in `feedback.html` (it loaded `leai-formmode.js` with no `?v=`), plus the `?v=` strings across the 5 LEAI pages
5. Seeded the 9 surveys to **production** (Heroku Postgres) — course `cmpm80h-sm26`, instructor "Magy"; verified all 9 `is_active` on the live API
6. Diagnosed the blank course-login password (seeder never set `Course.password`, so `check_password` rejects every login) and added `set_course_password.py`
7. Added `scramble_cmpm80h_ids.py` and refactored the seeder to mint **random** `public_id`s keyed on (course, week, mode) instead of guessable `c80h-w*`
8. Made `guiidatapipelines/scripts/` local-only: deduped the gitignore rule and removed the cmpm80h seed/verify scripts from the remote

### Files created / changed

- `LEAI/leai-formmode.js`, `LEAI/scripts/leai_formmode.py` — per-turn tone gates + wrap-up/refusal variation
- `LEAI/leai-version.js` (v0.2.8), `LEAI/feedback.html` + `CourseBanner.html`/`FeedbackChat.html`/`FeedbackAnalyzer.html`/`PromptDesigner.html` — version/cache-bust
- `LEAI/docs/prompts/wk{1-5}-cmpm80h-{form,group}.md` (9) — the prompt set
- `LEAI/docs/instructor-clarifications/cmpm80h-production-parity-patch.md`
- Commits: `c35d4a8` (prompts), `750d6ec` (engine), `ebba379` (v0.2.8). guiidatapipelines: `38a6b15` (seed/harness), `ae92f30` (untrack scripts/). The cmpm80h tooling now lives only on disk (gitignored).

### Decisions

- Per-turn directive injection over static prompt (the load-bearing fix) — applies to ALL courses' form/in-group surveys, not just CMPM 80H
- Scrambled `public_id`s (guessable → random) for share-link privacy
- Kept `guiidatapipelines/scripts/` local-only; left the colleague's `dryrun_openai_responses.py` tracked
- Did NOT bump the legal-doc version (no policy change); did NOT hardcode any password/DB-URL in scripts (read at runtime via env/getpass)

### Next steps (Li runs against prod)

- Run `set_course_password.py cmpm80h-sm26` to give the course a login password
- Run `scramble_cmpm80h_ids.py` for the live share links to hand to Magy
- Remove the `DATABASE_URL` line from `guiidatapipelines/.env` after prod writes so local commands return to `ciba`

---

## 2026-06-24 — Task: Per-course AI name (Customizations tab)

### Actions taken

1. Added a course-level `bot_display_name` so instructors can rename the AI's message tag for their class — the blue-dot **LEAI** label beside each AI bubble in the student chat (`feedback.html`). Blank falls back to `LEAI`; capped at 100 chars. This is the message *tag*, not the per-survey persona (Weeki/Mira), which is untouched.
2. Backend (`guiidatapipelines`): new `Course.bot_display_name` field + migration `0036`; `get_course_customization` / `update_course_customization` endpoints (the update is course-login gated, trims to 100); the resolved name is inlined as `bot_display_name` on the existing `get_feedback_gpt_by_public_id` response so the student chat gets it on first paint (no extra round-trip). Modeled on the CourseBanner course-config pattern.
3. Frontend: new `Customizations.html` instructor page (sign-in, name field with live 100-char counter, live AI-tag preview, save). Added the "Customizations" sidebar item (`tune` icon) to PromptDesigner / FeedbackAnalyzer / FeedbackChat / CourseBanner. `feedback.html` reads `gpt.bot_display_name` into `window.leaiBotName` and uses it at all 4 AI-label sites.
4. Verified end-to-end in a real browser against the local Django + static server: instructor save → backend persist → a live AI bubble in `feedback.html` rendered the tag "COACH BEE" instead of "LEAI", 0 console errors. Backend checks: custom name, whitespace-trim, 100-char truncation, blank→`LEAI`, no-course→`LEAI`, 404 on missing course.

### Files created / changed

- `LEAI/Customizations.html` (new) — instructor customization page
- `LEAI/feedback.html` — `window.leaiBotName` capture + 4 AI-label sites
- `LEAI/CourseBanner.html`, `FeedbackAnalyzer.html`, `FeedbackChat.html`, `PromptDesigner.html` — Customizations nav item
- `guiidatapipelines`: `datapipeline/models.py` (field), `migrations/0036_course_bot_display_name.py`, `datapipeline/views.py` (helpers + 2 endpoints + inline), `datapipeline/urls.py` (2 routes)

### Decisions

- Course-level backend storage (not instructor localStorage) — students don't share the instructor's browser, so the name has to travel with the course.
- Replaced only the AI message tag; left the per-survey persona `botName` alone (confirmed via survey).
- Did NOT bump the LEAI version: `leai-shared.css`/`leai-shared.js` are unchanged, so the existing `v0.2.8` cache-bust still holds; the new page references v0.2.8 to match.
- Left the chat's revise-hint helper text ("Just tell LEAI — for example…") as-is — it's not an AI message tag, so it fell outside the confirmed scope.

### Next steps

- Deploy `guiidatapipelines` to Heroku and run `migrate` — the backend field/endpoints only take effect in production after the deploy. The frontend is live on GitHub Pages ~1-2 min after push to `main`.
- (Optional) Swap the name into the revise-hint helper text for coherence, if wanted.

## 2026-07-07 — Task: P0 form-mode fixes from CMPM 80H feedback analysis

### Actions taken

1. Analyzed CMPM 80H student feedback (the closing "what did you think of LEAI" question, triangulated against each student's transcript) and derived four P0 fixes to the form-mode engine. Magy reviewed the plan and gave the go-ahead.
2. **P0-1 — cap redundant follow-ups.** The wrap-up "anything else?" (`dirAnythingElse` / `_dir_anything_else`) now fires at most once per area, then force-advances, ending the "are we done?" loop students hit. Also added a per-turn `NO REDUNDANT RE-ASK` gate.
3. **P0-1b — closing dup bug.** The group closing wording never matched `looksLikeClosingFeedback`, so `closing_feedback_asked` never got set and the closing question fired twice. Now the flag is set authoritatively from `directiveKind === 'close'` (JS) / `directive_kind == "close"` (Py), independent of the text matcher.
4. **P0-2 — accept "smooth / no friction."** New `SMOOTH_NO_FRICTION` regex short-circuits `shouldProbe`, plus an `ACCEPT SMOOTH/NO-FRICTION` gate, so a team that says it worked smoothly is accepted instead of re-probed for a problem that isn't there.
5. **P0-3 — allow rephrase on request.** New `ALLOW REPHRASE ON REQUEST` gate — a "what does that mean?" / "say it simpler" reply is rephrased on the same area rather than treated as an off-topic redirect.
6. **P0-4 — de-plant the closing question.** The old wording planted "honest" and "PDF" and biased the comparison it was measuring. Neutral fallback constant (`CLOSING_FEEDBACK_FALLBACK` / `_CLOSING_FEEDBACK_FALLBACK`) added to both engines; the closing-feedback matcher is additive (matches old + new). The seeded CMPM 80H schema wording is reworded via backend migration `0037`. Prompt docs (`wk1–4-cmpm80h-{form,group}.md`) updated to match.
7. **Test-proof.** Two Sonnet 5 subagents wrote deterministic, offline (no LLM, no network) driver harnesses — one per engine — against the frozen production-shaped CMPM 80H schemas, covering all five scenarios (P0-1a, 1b, 2, 3, 4). Both engines pass every scenario and agree scenario-for-scenario; re-verified by re-running both harnesses directly.

### Files created / changed

- `LEAI/leai-formmode.js` — canonical engine: 3 new turn gates, `SMOOTH_NO_FRICTION`, `CLOSING_FEEDBACK_FALLBACK`, dup-closing fix, additive closing matcher.
- `LEAI/scripts/leai_formmode.py` — Python mirror kept at parity.
- `LEAI/docs/prompts/wk1-cmpm80h-form.md`, `wk2-cmpm80h-{form,group}.md`, `wk3-cmpm80h-{form,group}.md`, `wk4-cmpm80h-{form,group}.md` — reworded closing question.
- `guiidatapipelines`: `datapipeline/migrations/0037_fix_cmpm80h_closing_prompts.py` (new) — reword seeded `cmpm80h-reflection` + `cmpm80h-team-reflection` closing prompts; has upgrade/downgrade, depends on `0036`. Local-only seeder `scripts/seed_cmpm80h.py` updated to match (gitignored).

### Decisions

- `MAX_TURNS_PER_AREA` kept at 14. A draft lowered it to 13, but it doubles as the Area 2.2 roster-walk bound (13 caps max team size at ~11). Redundancy is handled structurally by P0-1, so the safety net stays put.
- Verification proves engine (state-machine) behavior deterministically. The conversational half of P0-2/P0-3 rides on the injected gate text — the engine emits the gate and stays on-area; whether the model obeys is the LLM's job and would need a live persona run to observe.
- Did NOT bump the LEAI version — `leai-shared.css`/`.js` are unchanged, so the existing `v0.2.8` cache-bust still holds. The engine file is loaded with its own cache-bust.

### Next steps

- Deploy `guiidatapipelines` to Heroku and run `migrate` to apply `0037` — until then the live registry still serves the old planted CMPM 80H closing wording (confirmed against the registry). Surveys are live, so time the deploy at a week boundary so the closing question doesn't change mid-week.
- `wk5-cmpm80h-*` closing variants use bespoke "across the whole course" wording that also plants "honest reflection" — left untouched, pending a decision.

## 2026-07-16 — Task: Rebuild the StudyCrafter pitch deck around results, then rewrite its speaker notes

### Actions taken

1. Found that `studycrafter-pitch.pptx` had diverged from `build_deck.py` — the shipped deck was hand-assembled in Google Slides, carried ~1MB full-window screenshots, had no motivation slide, and contained zero speaker notes (no `notesSlides` part at all). A naive regenerate would have destroyed it, so the new deck is written to a new file and the original is untouched.
2. Wrote `build_deck_v2.py`, producing a 9-slide `studycrafter-pitch-v2.pptx` with embedded notes on every slide. Adds the "Why LEAI" motivation slide, a results slide from the SP26 end-of-quarter report, and an ideas slide with an explicit ask.
3. Dispatched four independent zero-context reviewers against the design. They converged unanimously: restore the motivation slide as slide 2, the screenshots were unreadable wallpaper, and Structured Reflection belongs after the student-experience slide. Also caught that the deck had no call to action and that "~5 minutes" appeared on no slide.
4. Reversed my own call on SUS. I had argued for notes-only; the skeptic reviewer showed that was a persuasion rationale and asymmetric (suppressing n=6 while featuring an n=1 testimonial). SUS now sits on the results slide, framed as the adoption/usability tension.
5. Recaptured screenshots against v0.2.8 (`shots/`) and cropped every one to the claim it proves — no browser chrome, no sidebar. A full 1440px window shown at half-slide width projects UI text at ~5.7pt, which is unreadable from the back of a room.
6. Trimmed all eight main slides to the assertion and pushed the removed detail into the notes.
7. Rewrote all nine sets of notes against Harvey's hand edits to the .pptx (below), in plain sentences with no dashes and no "A, not B" constructions.

### Files created / changed

- `LEAI/docs/studycrafter-pitch/build_deck_v2.py` (new) — deck builder. Run with `uv run --with python-pptx --with pillow python build_deck_v2.py` from that directory.
- `LEAI/docs/studycrafter-pitch/studycrafter-pitch-v2.pptx` (new) — the deck. 9 slides, 9 notesSlides.
- `LEAI/docs/studycrafter-pitch/shots/` (new) — cropped captures.

### Decisions

- **The .pptx is now the source of truth, not the builder.** Harvey edits the deck directly in PowerPoint: he added a Feedback Chat slide at 7, corrected week 10 from 25 of 25 to 24 of 25, and cut the student-control and Canvas bullets from the ideas slide. `build_deck_v2.py` predates all of it. Patch the deck in place with python-pptx; re-running the builder overwrites his work.
- Verified every build by rendering to PDF (`soffice --headless --convert-to pdf`) and looking at each page. That is what caught all five layout bugs — slide 1 text overlap, a butchered consent crop, a slide 6 image floating small, uncropped chrome on the backup slide, and a slide 8 band overflow.
- Insights per-claim counts are computed, not model-generated — confirmed in `FeedbackAnalyzer.html:2432-2450`, where the chip renders `citeRids.length` after dedupe and after dropping IDs that don't resolve. The notes carry that answer, along with the honest caveat that code counts while the model chooses what to cite.
- Screenshots showing seeded numbers sit two slides from real deployment numbers, so slide 6 carries a visible DEMO DATA stamp and the notes cue saying it aloud.
- Course Banner and Customizations stay out, per Harvey.
- Left `build_deck.py` in place. It builds a third, unrelated deck from `LEAI/guide-assets/` and is now misleading; its fate is undecided.

### Next steps

- Slides 4, 5 and 9 still use art recovered from the old deck. Slide 5's screenshot predates the revise/add-to hint, so the slide claims a feature its image doesn't show — recapture before presenting.
- HCI 220's real student count is still missing from the results slide; dev numbers were refused for a slide claiming real deployment.
- `script.md` and `slides.md` describe the old 6-slide deck and are now out of sync with the real 9.

---

## 2026-07-16 — Task: Point-to-a-human referral gate + CMPM 80K survey prep

### Actions taken

1. Added the POINT TO A HUMAN referral gate as a 7th per-turn tone gate in both form-mode engines (`leai-formmode.js` + `LEAI/scripts/leai_formmode.py`, byte-identical directive text). Fires when a student signals they're stuck/lost/behind/struggling: one sentence pointing them at a person, no troubleshooting, no promised outcomes, once per conversation. The model tags the firing reply with `[REFERRED]`; the engine strips the marker, latches `referral_done`, and flips the gate to a suppression line.
2. Config travels the bot_display_name path: new `Course.referral_enabled` + `Course.referral_text` (guiidatapipelines migration 0038), served on `get_feedback_gpt_by_public_id`, overlaid onto the schema in `feedback.html`, editable in Customizations (toggle + wording field with live sentence preview). Blank wording falls back to "your instructor or TA during their office hours".
3. Verification: `LEAI/scripts/verify_referral_gate.py`. 36 deterministic checks (both engines + parity + six-gate regression) pass. Live layer: 4 scripted personas through real `claude -p` turns — fired on the distress turn in the same message, refused to define under "tell me or I give up" while still firing, never fired on the-work-went-badly answers, never fired with the flag off, marker never leaked. Transcripts in `LEAI/scripts/reports/referral-gate/`.
4. CMPM 80K prep: `guiidatapipelines/scripts/seed_cmpm80k.py` (gitignored, local-only like the 80H tooling) seeds `cmpm80k-reflection` + `cmpm80k-team-reflection` mirroring the two Google Docs Kate is confirming, course `cmpm80k-sm26` with bot "Kit" and referral on, and the Week 1 individual survey. Ran clean against the local DB.
5. Drafted the 80K studio-survey prompt (`wk1-cmpm80k-group.md`, off the 80H group standard: roster walk as peer review, justification-before-rating, async standup wording, glossary carve-out, pointing-to-a-human section).

### Blocked on Kate (msgs in cmpm80k-kate-questions.md)

- Week 1 concept list for the no-define placeholder in `wk1-cmpm80k-form.md`
- Office hours for the summer async section → `Course.referral_text`
- Which weeks get individual vs studio surveys; the two peer-review weeks
- Names-in-transcript and glossary carve-out confirmations

### Deploy notes (Harvey — tasks 7 and 8)

- Nothing pushed. Pushing this repo to main publishes to GitHub Pages; the Heroku deploy also carries migrations 0037+0038 and the P0 form-mode fixes that are in-repo but not yet live.
- `feedback.html` cache-busts the engine at `?v=v0.2.9`; the full LEAI_VERSION release cut (leai-version.js + all `?v=` refs + legal lockstep) was left for deploy time.
- Set the course password: `scripts/set_course_password.py cmpm80k-sm26`.

---

## 2026-07-17 — Task: Soften the referral-gate phrasing (reviewer feedback)

### Context

Feedback on the point-to-a-human flow: the flow is right, but imperative phrasing ("This is the time to bring it to the Prof or TA") can read as a forced action. Make it warm and open-ended instead.

### Decision (confirmed with Harvey)

- **Warm statement, keep the flow.** The referral is a gentle, agency-giving *statement* (no "?"), so the bot's one survey question still rides the same turn and the reflection keeps moving. Chosen over a question-form invitation, which would have paused the survey a turn and collided with the one-question-per-turn rule.
- **Default wording keeps "during their office hours"** (still per-course configurable).

### Actions taken

1. Rewrote the active gate directive in both engines (`leai-formmode.js` `referralGate` + `leai_formmode.py` `_referral_gate`, byte-identical): the bot now adds one warm, open-ended sentence that *invites* ("no pressure, but it might help to...", "whenever you'd like, you could...") rather than instructs, phrased as a statement so the single "?" stays the survey question. Parity check still passes.
2. Extended `verify_referral_gate.py`: fired reply must keep exactly one "?" (invitation is a statement) and must not use "this is the time" framing. Deterministic + live layers re-run.
3. Updated the email example to Kate (`cmpm80k-kate-questions.md`), both prompt docs' "Pointing to a human" sections, and the "will and won't do" bullet in both Google Docs (re-uploaded).

### Not deployed

Same as the 2026-07-16 entry — committed on main, not pushed.

---

## 2026-07-20 — Task: Name the 80K bot LEAI (drop "Kit")

Harvey reversed the earlier "Kit" naming — the 80K bot goes by LEAI, its default. No custom name this course (Kate can still request one; Magy's is Remi).

- Blank `Course.bot_display_name` → default "LEAI" message tag. `seed_cmpm80k.py` now clears it (`BOT_NAME = ''`); re-seeded local DB, confirmed `bot_display_name=''`.
- Persona renamed to LEAI in both prompt docs (`wk1-cmpm80k-form.md`, `wk1-cmpm80k-group.md`).
- Email/questions doc: naming line and the referral example ("LEAI:" not "Kit:") updated.
- Both Google Docs re-uploaded ("conversation with LEAI, our bot").
- Harness persona `KIT_PERSONA` → `LEAI_PERSONA`; deterministic + parity checks green; live layer re-running to refresh transcripts.

Gate logic untouched — the name is cosmetic to the referral behavior.

---

## 2026-07-28 — Task: Publish CMPM 80K Week 1 to production

Kate's course went live. Everything from the 2026-07-16 / 07-17 / 07-20 entries
that was "committed but not pushed" is now deployed.

### Actions taken

1. `seed_cmpm80k.py`: added the Week 1 studio survey to `SURVEYS`
   (`wk1-cmpm80k-group.md` + `cmpm80k-team-reflection`). The prompt file and
   schema already existed; only the list entry was missing.
2. Pushed `guiidatapipelines` (`af822b3`, referral config) → Heroku deploy, and
   `GUII-Lab.github.io` (12 commits: referral gate engines, Customizations UI,
   80K prompt drafts) → GitHub Pages.
3. Applied migration `0038` to the prod DB (it was at `0037`). Ran the seeder
   against prod: schemas, course `cmpm80k-sm26`, `80K Studios` team config, and
   both Week 1 surveys created with fresh public_ids.
4. Set the course login password on prod (hashed, pbkdf2_sha256, verified).

### Live IDs (production)

| Survey | Mode | public_id |
|---|---|---|
| CMPM 80K Wk1 Form (Individual) | form, anonymous | `b4ZrDdVyfcPE` |
| CMPM 80K Wk1 Group (Studio) | group, identified | `lec1221Fqsbl` |

Student URLs: `https://guii-lab.github.io/LEAI/feedback.html?id=<public_id>`

### Verification

Live login returns `valid: true` for `cmpm80k-sm26`. Both surveys list on
`feedback_gpts_by_course`, `is_closed=False`. `get_course_customization` returns
`referral_enabled: true` (proves 0038 + the new code are both live). The studio
snapshot serves Studio 1 / Studio 2. Both student URLs loaded in a real browser:
the individual form shows the "CMPM 80K — Week 1" header with the ANONYMOUS
badge and consent gate; the group survey shows the studio picker. 0 console
errors on both (only the known Tailwind CDN warning).

### Still open

- Studios are the **2x4 placeholder**, not Kate's real roster. Fix in the
  instructor UI when she sends the real studios.
- Both prompt files still carry their DRAFT blocker headers: Week 1 concept list
  for the no-define rule, office hours for `referral_text` (currently the
  generic default), names-in-transcript consent, glossary carve-out.
- Weeks 2-10 unseeded pending Kate's week schedule.

---

## 2026-07-29 — Task: Surface the point-to-a-human nudge in the analyzer

### The problem

The referral gate shipped 2026-07-16 and has been firing in production, but
nothing recorded that it fired. The model tags its reply `[REFERRED]`;
`afterTurn` latched `referral_done`, stripped the marker, and the stripped text
is what got persisted. `FeedbackMessage` had no field for it. So an instructor
could not see which students were pointed at a person — the point of the
feature — and the latch, living only in browser memory, did not survive a
refresh: a student who resumed could be nudged a second time.

### Actions taken

1. `FeedbackMessage.referred` boolean + migration 0039. Written by
   `feedback_message_api` and the bulk endpoint; returned by
   `feedback_messages_by_course`, `feedback_messages_by_gpt`, and
   `feedback_session_resume`.
2. Both engines return `referred` for the turn the marker fired on, and accept
   it back as an input so replaying a stored transcript re-latches the gate.
   Kept per-turn, not per-conversation: reusing `referral_done` would flag
   every reply after the nudge.
3. feedback.html threads it through all four write paths (general + in-group,
   intro turn + normal turn) and both replay paths.
4. FeedbackAnalyzer: "Nudged" chip on the response row, flag on the one AI
   reply inside the expanded card, legend + "Nudged only" filter in a strip
   under Student Responses, and a NUDGED stat card. Everything self-gates on
   the flag existing, so courses with the setting off see no change.
5. Quick Take and FeedbackChat corpora mark nudged responses `[NUDGED]`, with
   prompt rules to weight them as evidence of struggle and never editorialize
   about the nudge. The per-student Insights Brief gets a `=== NUDGE ===` block.
6. `simulate_conversation.py` persists the flag, so a distressed persona now
   produces a chip without hand-typing in a browser.

### Decisions

- Chip is data-gated, not gated on the Structured Reflection tab: the shared
  panel renders in all three tabs, and the gate does fire in in-group surveys
  that bind a form schema. It can never fire in a plain general survey.
- Only the positive state renders. Unlike the banner A/B pair, "not nudged" is
  the default and a negative chip on most cards is noise.
- `[NUDGED]` is its own bracket, not a third `·` segment inside `[Rn · Team]`,
  which the prompts define as the team-name slot.
- No Quick Take schema field / no dedicated panel. The marker informs the
  existing bullets; a structured output field would mean 0040 + a renderer.
- Rose chip, deliberately not the banner chip's amber — a card can carry both.

### Not backfilled

Rows written before 0039 have the marker already stripped, so no flag is
recoverable for them. CMPM 80H and CMPM 80K Week 1 will show no chips.

### Verification

`verify_referral_gate.py` 52 checks pass (was 38; +14 covering the per-turn
flag, replay re-latch, and the JS-only post-`[END]` passthrough branch, which
has no Python counterpart and so is invisible to the parity check).
`verify_form_artifact_split.js` 15/15 individual, 26/26 team.
`verify_form_artifact_replay.js` 19/20 — the one failure is LLM slot-extraction
flakiness, unchanged behavior (the committed engine scores 18/20 on the same
run). Round-tripped `referred` through all four endpoints with curl. In a real
browser: chip, in-transcript flag, legend, filter (persists across reload), and
stat card all render; the General tab is untouched. Resumed a nudged
conversation and confirmed `referral_done === true` after replay and that the
next distress turn gets the `ALREADY DONE` gate — the double-nudge bug.

Caught during verification: Tailwind's preflight blockifies `svg`, which
dropped the flag onto its own line under the AI label. Fixed with an explicit
`display: inline-block`.

### Still open

- Deploy: backend must land and migrate before the frontend ships, or nudges
  fired in the gap are lost. Nothing is broken if the order slips — unknown
  JSON keys are ignored and every read self-gates.
- `build_response_corpus` still does not filter on `research_consent`.
  Pre-existing, but marking non-consenting rows `[NUDGED]` sharpens it.
- In a week with few responses, "R3 was nudged" is close to identifying. Worth
  checking against the IRB framing before enabling on a small course.
