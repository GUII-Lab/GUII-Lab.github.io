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
