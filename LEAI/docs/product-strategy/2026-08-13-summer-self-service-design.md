# LEAI Summer 2026 Self-Service Design

**Date:** 2026-08-13
**Status:** Approved design, pending Harvey's spec review. No implementation has started.
**Scope rule:** design first; no product code, no branches, no deploys until an
implementation plan is approved separately.

This document records the decisions, the verified current-state inventory that
grounds them, the summer roadmap, and the validation plan. It supersedes the
statuses in `LEAI/docs/roadmap.md` (stale since 2026-03-31).

---

## 1. Goal

Eliminate Harvey as a required step in instructor onboarding. A new instructor
must be able to create a course, launch a useful first survey (including a
structured one), understand the responses, run the weekly loop, and return in a
later term, without database seeding, hand-written schemas, script-run password
resets, or repair of mixed term data.

**Success test:** an instructor outside the development team completes setup and
launches a real survey with zero synchronous help (Section 7).

**Timeline:** no fixed date. Ship when the quality gates pass.

---

## 2. Verified current-state inventory (2026-08-11)

Built from live code in this repo and `guiidatapipelines`, not from the stale
roadmap. Classification: **(a)** self-service in UI, **(b)** developer/manual
setup required, **(c)** absent.

### 2.1 Already self-service (a)

- Course creation from the PromptDesigner UI: ID, name, instructor, password,
  duplicate handling (`PromptDesigner.html:2156-2186`, backend
  `views.py:182-201`). The instructor guide never documents it and is written
  as if courses are provisioned for the instructor.
- Full survey lifecycle in all three modes: create, scheduled open, 14-day
  auto-expiry default (`views.py:610-615`), close/reopen, clone, edit prompt
  after creation, two-step delete, status badges. Student-facing closed /
  expired / not-yet-open screens work end to end (`feedback.html:1405-1419`).
- General-mode guided builder, four templates, worked example, tips panel.
- In-group team/studio configuration: full CRUD, per-team sizes and names,
  small-team ethics warning, snapshot semantics (`views.py:2180-2455`).
- Form-mode survey creation against an existing schema, with schema preview.
- Analyzer: Instructor Insights with computed citation pills and popovers,
  freshness strip, minimum-5-responses guard, week scoping, in-group grids,
  Students and Group Progress tabs (cross-week), nudged chips, banner A/B
  exposure chips, PDF ingest wizard with revert. FeedbackChat with
  server-persisted sessions, scope picker, editable system prompt.
- Customizations (bot name, referral toggle and wording) and CourseBanner
  (including A/B split) are instructor-editable.
- Student page: consent gate (individual modes), cross-device resume via
  `#cid=`, docx reflection download, mobile-responsive layout.

### 2.2 Requires Harvey today (b)

- **FormSchema authoring.** The API is read-only (`urls.py:38-39`); every
  structured course (HCI 271, CMPM 80H, CMPM 80K) needed seed scripts, Django
  admin, or migrations. The UI can only bind an existing schema. This is the
  single largest concierge dependency.
- Password set/reset (`scripts/set_course_password.py` against prod).
- Real studio roster import (`scripts/set_cmpm80k_studios.py`).
- Bulk term seeding with prompt bodies from repo files (`seed_cmpm80k.py`).
- Cross-week tracking discovery (the toggle works but sits behind a
  deliberately unlabeled gear in Customizations).

### 2.3 Absent (c)

- Any instructor identity: no email field anywhere, no recovery path, no
  ownership, no TA roles. `leai_session` is a client-side gate only.
- Term/rollover concept; course clone, archive, or delete. Reusing a course_id
  mixes terms in the analyzer, identity clustering, and QuickTake scope keys.
- Response counts on the general and in-group survey lists (backend already
  returns `session_count`; only the form list renders it,
  `PromptDesigner.html:2612`).
- Instructor preview without polluting data (the open-link button creates real
  sessions; the only mitigation is a `test-` course-ID convention).
- Product telemetry: zero events of any kind. Nothing answers where
  instructors drop out.
- CSV/JSON export in the Analyzer UI (backend endpoint
  `export_survey_responses` exists, unwired).
- Onboarding wizard or checklist of any kind.
- Forgotten-password recovery on any login card.

### 2.4 Security and privacy findings (drive Phase 0)

1. **Unauthenticated writes.** Every instructor write endpoint (and transcript
   read) is open server-side; `delete_survey` needs only a sequential integer
   id. The password gate exists only in the browser.
2. **`getOAI` returns the raw OpenAI API key to any caller**
   (`views.py:35-37`).
3. **Research consent is captured but never enforced.** No corpus builder,
   read path, or export filters on `research_consent`; privacy policy section 6
   promises otherwise.
4. **Consent ordering.** Cross-week device signals are POSTed before the
   consent modal renders (`feedback.html:1450` vs `:1497`), and group surveys
   skip the consent modal entirely (their research consent silently defaults
   to false).
5. **Fabricated failure states.** On LLM/API failure the student page invents
   a bot reply ("Welcome! How can I help you today?", `feedback.html:2581-2584`;
   group variant `:2355-2360`) and persists it as real data. A dead backend
   renders the Analyzer as an innocent-looking empty course
   (`FeedbackAnalyzer.html:1166`).

### 2.5 Smaller verified defects worth fixing in passing

- Wrong-password message branch never fires on PromptDesigner
  (`PromptDesigner.html:2204` expects strings the backend does not return,
  `views.py:221`).
- Survey JSON export omits `mode` and `form_schema_id`, so re-import silently
  downgrades form/group surveys to general (`PromptDesigner.html:3096-3105`).
- Invalid survey ID shows unstyled red text instead of the lifecycle screen.
- Analyzer stats row renders four zeros with no guidance on a fresh course.
- Anonymity badge on the student page is hard-coded rather than derived from
  `anonymity_mode` in general mode.

---

## 3. Decisions (Harvey, 2026-08-11 to 2026-08-13)

| # | Decision | Choice |
|---|---|---|
| D1 | Timeline | No fixed date; ship when quality gates pass |
| D2 | Identity model | Keep course-ID + password. Add `instructor_email` to Course, email-based self-service reset, server-side password enforcement on writes. No instructor accounts this summer |
| D3 | Structured self-service | **Full schema builder UI** with write API, template starting points, validation, and mandatory live preview |
| D4 | Learning loop (strategy C) | **Deferred entirely** to after the next deployment |
| D5 | Security/privacy hardening | All five findings are Must (Phase 0) |

Strategy comparison summary: activation is the binding constraint (retention
and learning-loop evidence both require a second instructor to exist first);
retention features only get exercised at a term boundary; the learning loop
needs live instructors mid-course to generate data. Sequence: hardening, then
activation, then two retention essentials. Everything else waits.

Onboarding pattern (compared per the brief): **wizard for first-course setup +
persistent checklist for the full loop**, contextual guidance where pages
already have it. A demo/sample course teaches the analyzer best but is the
most build for the least activation gain: Later.

---

## 4. The activation funnel

```
create course → setup wizard done → first survey created → previewed →
link shared → first student response → analyzer opened → insight generated →
insight viewed w/ citations → next-week survey created → [term boundary] →
course rolled over → instructor returns next term
```

Every Must feature removes a wall in this funnel or instruments it. Telemetry
events (A7) map one-to-one to these stages.

---

## 5. Roadmap

Complexity scale, relative to the rest of LEAI: XS (hours), S (about a day),
M (days), L (a week or more).

### 5.1 MUST, Phase 0: hardening pack

**H1. Server-side auth on instructor endpoints.**
- Problem: Section 2.4 finding 1.
- Smallest version: `verify_course_password` returns a signed, course-scoped
  token (Django `signing`; no accounts table). All instructor writes plus
  transcript/export reads require it. Student endpoints unchanged.
- Data model: none.
- Acceptance: unauthenticated calls to every instructor endpoint return
  401/403; all six instructor pages still work end to end; a token for course
  X cannot act on course Y.
- Verification: curl matrix over the endpoint list + Playwright on real pages.
- Metric: none (risk removal).
- Complexity: M (fan-out across ~25 endpoints and 6 pages, not conceptually
  hard). Risk: low.

**H2. Remove the `getOAI` key leak.**
- Smallest version: delete the route; verify which legacy SCAI pages call it
  and migrate or retire them.
- Acceptance: endpoint gone from prod; no LEAI or SCAI page breaks.
- Complexity: XS-S.

**H3. Enforce research consent.**
- Problem: Section 2.4 finding 3; the published policy promises it.
- Smallest version: QuickTake, FeedbackChat, and per-student-brief corpus
  builders plus research-facing exports filter on `research_consent`.
  Instructor operational views (raw responses) stay unfiltered, matching the
  policy's operational/research distinction. Serializers emit the flag. The
  freshness strip shows consented-N so low-consent courses are legible.
- Acceptance: a seeded non-consented message never appears in any generated
  analysis corpus (deterministic test) yet remains visible in Student
  Responses.
- Complexity: S-M. Risk: insight quality drops in low-consent courses;
  surfaced, not hidden.

**H4. Consent ordering + group-mode consent.**
- Smallest version: `register_session_identity` fires only after consent is
  accepted; group surveys get the same consent modal, including the research
  checkbox.
- Acceptance: network assertion that no identity POST precedes the Continue
  click; declining means no capture; group flow records real consent choices.
- Privacy: closes two published-promise gaps.
- Complexity: S.

**H5. Honest failure states.**
- Smallest version: student page renders a visible, retryable error on LLM/API
  failure and never persists a fabricated reply; opening-message failure does
  not masquerade as a greeting; Analyzer main-load failure shows an error
  banner distinct from an empty course.
- Acceptance: with backend down or model erroring, no fabricated row is
  written; student sees retry; analyzer distinguishes outage from empty.
- Complexity: S.

### 5.2 MUST, Phase 1: activation

**A1. Instructor email + self-service password reset + ownership transfer.**
- Problem: recovery is Harvey running a script against prod; no out-of-band
  channel exists anywhere.
- Smallest version: `instructor_email` on Course (required at creation,
  editable in Customizations, which doubles as ownership transfer). "Forgot
  password" on all login cards sends a single-use reset link.
- Dependencies: an email sender (Heroku add-on or SMTP), the one new
  infrastructure piece; H1 tokens.
- Privacy: first instructor PII in the system. Privacy policy gains an
  instructor-facing section; email used only for recovery and ownership.
- Acceptance: full reset round-trip on a prod-like environment;
  enumeration-safe response for unknown emails.
- Metric: funnel stage 1 completable by outsiders; lockout support contacts
  go to zero.
- Complexity: M.

**A2. Guided first-course setup wizard.**
- Problem: course creation is self-service but undocumented and unguided.
- Smallest version: linear wizard on PromptDesigner for the no-course state:
  course details with email → use case (weekly check-in / milestone / team
  retro; preselects mode and template) → privacy defaults in plain language
  (anonymity, what students see, banner off, cross-week off) → first survey
  prefilled from template → preview (A3) → share screen with link and
  suggested Canvas announcement text. Skippable; every step reuses existing
  endpoints.
- Data model: none (wizard state is client-side).
- Acceptance: fresh browser, zero prior state, to a live survey link in 10
  minutes or less without reading docs; every wizard step maps to an existing
  endpoint call that succeeds.
- Metric: stage 1→5 conversion; time to first link.
- Complexity: M.

**A3. Preview-as-student without polluting data.**
- Problem: instructor test sessions contaminate counts and insights; the
  `test-` course-ID hack is the proof of need.
- Smallest version: Preview button per survey opens
  `feedback.html?id=…&preview=1`; the page shows a preview banner; the engine
  runs normally; writes carry a new `FeedbackMessage.is_preview` boolean
  (migration). Every count, corpus, export, and identity path excludes
  preview rows.
- Acceptance: a full preview conversation changes no count anywhere and
  appears in no analysis; preview of a closed survey still works for the
  instructor.
- Metric: stage 4 event; unblocks the wizard's preview step.
- Complexity: S-M (the exclusion sweep is the work).

**A4. Response counts on all survey lists.**
- Smallest version: render the already-returned `session_count` in the general
  and in-group lists (form mode already does), excluding previews.
- Complexity: XS.

**A5. Schema builder + FormSchema write API.** *(largest build)*
- Problem: the biggest concierge dependency (Section 2.2).
- Smallest version of "full builder": create/edit schemas in a builder that
  starts from curated templates (blank sheet allowed but discouraged):
  section list with per-section prompts, rating/justification toggles,
  concept-list (no-define) field, referral section toggle, closing question
  defaulting to the neutral wording. Write API `create/update_form_schema`
  behind H1 auth, server-side structural validation, version bump on edit
  with binding safety: editing a schema bound to a survey with responses
  creates a new version; existing surveys keep theirs.
- Builder guardrails encode the known engine failure modes: planted-wording
  lint, one-question rule, roster-walk size cap, and a schema-overrides-prompt
  warning (the FormSchema body is injected verbatim and beats the prompt).
- Mandatory before publish: a live preview conversation via A3.
- Data model: FormSchema gains a `course` FK (course-owned schemas) and a
  version/parent lineage; existing global schemas become read-only templates.
- Privacy: schema text goes to the model provider (already true today).
- Acceptance: an instructor with no developer help creates a structured survey
  from a template, customizes sections, previews a full conversation,
  publishes, and a synthetic student completes it with the engine honoring
  every section, verified on real pages with the persona harness. A schema
  failing validation cannot be published.
- Metric: structured surveys created without Harvey.
- Complexity: **L, highest-risk item.** Mitigations: template-first UX,
  validation, forced preview, engine harness runs before any real course uses
  an instructor-authored schema.

**A6. Persistent onboarding checklist.**
- Smallest version: dismissible checklist card on PromptDesigner (compact
  mirror on the Analyzer) tracking funnel stages from real data: create →
  preview → share → first response → open analyzer → generate insight. Each
  item deep-links to the right page. State derives from telemetry events plus
  a dismissed flag.
- Acceptance: states flip from real events; survives sessions; dismissible.
- Complexity: S.

**A7. Privacy-preserving funnel telemetry.**
- Smallest version: one Django `ProductEvent` table (event name from a fixed
  enum of funnel stages plus a few UI events, `course_id`, timestamp; free
  text is rejected by construction) and one `POST /product_event/`. Fired
  from instructor pages; the two student milestones (first response per
  survey) are derived server-side so student pages send no events. Analysis
  is a SQL notebook, not UI.
- Privacy: instructor behavioral data disclosed in the terms/privacy addendum
  alongside A1's email addition; no third parties; student feedback text,
  transcripts, names, and prompts never enter events, enforced by the enum.
- Acceptance: replaying the full funnel on a fresh course produces exactly the
  expected event sequence; a test asserts no event payload accepts free text.
- Metric: this is the metric layer (activation and drop-off per stage).
- Complexity: S.

**A8. Documentation catch-up.**
- Smallest version: instructor guide gains create-your-course, structured mode
  and the builder, preview, checklist, and the reset flow; the passive-voice
  provisioning framing is removed.
- Acceptance: a documentation-only walkthrough matches every real screen
  (screenshot-verified).
- Complexity: S.

### 5.3 SHOULD, Phase 2: retention essentials

**B1. Course rollover.**
- Problem: no term concept; reusing a course_id permanently mixes identity
  clusters, QuickTake scopes, and analyzer views.
- Smallest version: "Start new term from this course" in PromptDesigner:
  creates a new course_id (suffix convention such as `-f26`, editable), copies
  settings (customizations, banner config, referral, team configs,
  course-owned schemas) and selected surveys as drafts with fresh public_ids,
  cleared dates, zero responses. The old course is untouched and gains
  `archived_at` (instructor-list ordering only). Email and password carry
  over.
- Acceptance: rolled course shows zero responses and identities; old links
  still resolve to the old course; no cross-term S-clustering; every copied
  setting verified field by field.
- Metric: rollover event; instructor-returned-next-term.
- Complexity: M.

**B2. Weekly-reuse polish.**
- Smallest version: clone gains "duplicate into next week": week
  auto-increments, week token in the label updates, dates shift one week,
  clone lands in a highlighted edit state.
- Acceptance: two clicks and one confirm from last week's survey to this
  week's live link.
- Complexity: S.

**B3. Analyzer export + empty/error polish.**
- Smallest version: wire the existing CSV export endpoint into the Analyzer
  (per survey and per course; consent flag as a column; preview rows
  excluded); replace the four-zeros first-run stats row with a guidance
  state.
- Complexity: S.

**B4. Course archive + safe deletion behavior.**
- Smallest version: reversible archive (closes all surveys for students;
  analyzer becomes read-only with a banner). Survey delete keeps its confirm
  and gains a response-count warning. Full course deletion stays a documented
  manual operation pending the retention-policy work.
- Complexity: S.

### 5.4 LATER (explicitly after the next course deployment)

All of strategy C (instructor action log, "you said, we're doing" student
surface, follow-up injection into later weeks, closure research
instrumentation) · Canvas completion codes / LTI · instructor accounts,
workspaces, TA roles, MFA/SSO · demo/sample course · pseudonymous mode · A/B
lift readout · automated retention/deletion schedule · QR codes · per-session
deletion tooling for subject requests · mobile device-lab verification · rate
limiting and cost quotas beyond existing guards (unless live usage forces it
sooner).

---

## 6. Cross-cutting verification standard

Every shipped feature: Playwright against the real pages on the local Django
backend, Chromium + WebKit, real user gestures, an HTML verification report
with screenshots per feature, bulk-persistence counts compared to expected
counts, full build and test pass right before each deploy. The schema builder
additionally gets deterministic engine tests plus live synthetic persona
conversations before any real course uses an instructor-authored schema.

---

## 7. Validation plan

### Stage 1: moderated usability test (after Phase 1 ships to a staging course)

- Participants: 3-5 instructors or TAs outside the dev team (ideally 2 CM
  faculty from the fellowship's target pool, 1-2 grad TAs), recruited for zero
  prior LEAI exposure.
- Protocol: think-aloud, screen-recorded, moderator silent except for prompts.
  Tasks mirror the funnel:
  1. "Set up LEAI for your course and get a link you'd post to Canvas."
  2. "Make a structured team-retro survey and convince yourself it works
     before students see it" (builder + preview).
  3. On a seeded synthetic-response course: "Find out what students struggled
     with this week and how many said it."
  4. "It's next week; run the same check-in again."
- Measures: per-stage completion without rescue, time to first link, stall
  points cross-checked against telemetry (validates A7), SUS, and "what would
  you not trust here?"
- Pass bar: 4 of 5 participants reach a live link unaided; every stall gets a
  named fix or an explicit accept-risk note before Stage 2.

### Stage 2: unassisted pilot (the success test)

- One or two instructors outside the lab run a real course week with zero
  synchronous help: they receive only the public URL and the instructor
  guide. Harvey watches telemetry and the DB and intervenes only if data
  integrity is at risk.
- Success: course created, survey launched, at least one real insight
  generated, next-week survey created, with zero Harvey contact or contact
  only through the documented support email with async response.
- Each funnel stage's drop-off directs the next design round. A pass
  evidences the activation claim for the fellowship report and any follow-up
  publication.

---

## 8. Open items

- Email sender choice for A1 (Heroku add-on vs external SMTP) is an
  implementation-plan decision.
- Legal doc updates (instructor email, telemetry disclosure) ride the same
  release as A1/A7 and bump the legal version in lockstep, per the existing
  convention.
- The competitor teardown and institutional-readiness research sessions
  (Prompts 1-4 in `2026-08-11-deep-research-session-prompts.md`) had produced
  no reports as of 2026-08-13; their findings should be folded into this
  scope only if they change a Must/Should boundary.
- Cross-week tracking stays behind the unlabeled gear this summer; its
  discoverability is revisited with the IRB framing, not as a product task.
