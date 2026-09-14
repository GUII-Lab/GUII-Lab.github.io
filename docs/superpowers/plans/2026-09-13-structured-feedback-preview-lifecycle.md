# Structured Feedback Preview and Draft Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an accessible, resumable Structured Feedback Wizard with backend-enforced preview preparation and per-survey completion downloads.

**Architecture:** Extend Question Set workflow records with explicit lifecycle and preview settings, gate preview reads with a server-generated `ready_at`, and copy exact preview settings into the published survey link. Keep content revisions immutable, use the existing student DOCX path, and add a non-verifiable preview-only certificate PDF path.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript frontend; Django backend; PostgreSQL; Node test runner; Django unittest; Playwright browser verification.

**Spec:** `docs/superpowers/specs/2026-09-13-structured-feedback-preview-lifecycle-design.md`

## Global Constraints

- All instructor-facing “Structured Reflection” text becomes “Structured Feedback.”
- Preview readiness is enforced by the backend from 2.6 through 3.8 seconds; no blocking server sleep.
- Certificate defaults on; Completion form defaults off.
- Settings are scoped to the exact preview and resulting survey, never the course.
- Preview certificates are watermarked and create no verification code or persistent certificate.
- Abandoned workflows remain available to audit but are hidden from instructor resume UI.

---

### Task 1: Diagnose and lock the modal footer regression

**Files:**
- Modify: `LEAI/tests/leai-question-set-wizard.test.js`
- Modify: `LEAI/leai-question-set-wizard.css`

**Interfaces:**
- Consumes: existing `.qsw-panel`, `.qsw-content`, and `.qsw-footer` layout.
- Produces: a dynamic-viewport panel with one scroll owner and an always-reachable footer.

- [ ] Add a failing source contract plus browser reproduction for short viewport footer reachability.
- [ ] Run the focused Node test and record the expected layout failure.
- [ ] Update panel rows and dynamic viewport sizing so notice collapse cannot create an implicit extra row and only content scrolls.
- [ ] Re-run the focused test and pointer/keyboard reproduction.
- [ ] Commit the focused footer fix.

### Task 2: Add explicit active, completed, and abandoned workflow lifecycle

**Files:**
- Create: `datapipeline/migrations/0046_question_set_workflow_lifecycle.py`
- Modify: `datapipeline/models.py`
- Modify: `datapipeline/question_sets.py`
- Modify: `datapipeline/question_set_views.py`
- Modify: `datapipeline/tests/test_question_set_wizard.py`

**Interfaces:**
- Produces: `QuestionSet.workflow_status`, `abandon_active_draft(...)`, newest-active-only draft listing, and publish completion transition.

- [ ] Write backend tests showing only the newest active draft is returned, replacement requires confirmation, abandoned rows remain, and publication completes the workflow.
- [ ] Run focused Django tests and confirm lifecycle assertions fail for missing behavior.
- [ ] Add the migration, model choices, service transitions, authorization, and audit events.
- [ ] Re-run focused tests and migration checks.
- [ ] Commit the lifecycle backend change.

### Task 3: Enforce random preview preparation on the server

**Files:**
- Create: `datapipeline/migrations/0047_preview_session_ready_at.py`
- Modify: `datapipeline/models.py`
- Modify: `datapipeline/question_sets.py`
- Modify: `datapipeline/question_set_views.py`
- Modify: `datapipeline/tests/test_question_set_wizard.py`

**Interfaces:**
- Produces: `PreviewSession.ready_at`, 2.6-3.8 second server-assigned delay, and `preview_preparing` responses with timing metadata.

- [ ] Write backend boundary tests using a patched clock/random source for minimum, maximum, early access, and ready access.
- [ ] Run focused tests and confirm missing readiness behavior fails.
- [ ] Add readiness assignment and public read guard without sleeping a worker.
- [ ] Re-run focused tests and verify old expired-token behavior remains distinct.
- [ ] Commit preview readiness.

### Task 4: Persist exact completion settings and copy them on publish

**Files:**
- Create: `datapipeline/migrations/0048_question_set_completion_settings.py`
- Modify: `datapipeline/models.py`
- Modify: `datapipeline/question_sets.py`
- Modify: `datapipeline/question_set_views.py`
- Modify: `datapipeline/urls.py`
- Modify: `datapipeline/views.py`
- Modify: `datapipeline/tests/test_question_set_wizard.py`

**Interfaces:**
- Produces: authenticated preview-settings PATCH, preview-token publication binding, and immutable published link settings.

- [ ] Write backend tests for defaults, strict booleans, ownership, exact-revision binding, idempotent retry conflicts, and public-survey values.
- [ ] Run focused tests and confirm endpoints/fields are absent.
- [ ] Add fields, serializers, update service, authenticated route, and publication copying.
- [ ] Re-run focused tests and migration checks.
- [ ] Commit per-survey completion settings.

### Task 5: Produce a real but non-verifiable preview certificate

**Files:**
- Modify: `datapipeline/views.py`
- Modify: `datapipeline/urls.py`
- Modify: `datapipeline/tests/test_completion_certificates.py`
- Modify: `LEAI/feedback.html`
- Modify: `LEAI/tests/leai-completion.test.js`

**Interfaces:**
- Produces: a preview-token PDF download with watermark and no certificate persistence; existing production issuance remains unchanged.

- [ ] Write backend tests for PDF response, watermark text, authorization/capability checks, and zero CompletionCertificate rows.
- [ ] Write frontend test for routing preview certificate downloads to the preview endpoint.
- [ ] Run both focused suites and confirm expected failures.
- [ ] Extract/reuse the existing PDF renderer and add preview-only rendering; route preview button clicks accordingly.
- [ ] Re-run focused suites and assert formal issuance tests still pass.
- [ ] Commit preview download support.

### Task 6: Update Wizard controls, copy, progress, and entry-point lifecycle

**Files:**
- Modify: `LEAI/PromptDesigner.html`
- Modify: `LEAI/leai-question-set-wizard.js`
- Modify: `LEAI/leai-question-set-wizard.css`
- Modify: `LEAI/tests/leai-question-set-wizard.test.js`

**Interfaces:**
- Consumes: lifecycle, readiness, settings, and publication APIs from Tasks 2-4.
- Produces: global Structured Feedback naming, reordered tabs, separate create/resume actions, generation progress, accessible settings switches/help, applied-live state, and exact preview-token publish payload.

- [ ] Add failing tests for all copy/order, newest resume, replacement confirmation, progress states, switch accessibility, persistence rollback, and publication payload behavior.
- [ ] Run the focused Node suite and confirm each new behavior fails before implementation.
- [ ] Implement the minimal DOM, controller state, polling, and API calls; preserve existing visual tokens and reduced-motion behavior.
- [ ] Re-run focused tests and then all frontend tests.
- [ ] Commit the integrated Wizard frontend.

### Task 7: Full regression and deployed QA verification

**Files:**
- Modify: `.context/session-handoff.md`
- Modify: `.context/update-log.md`
- Create locally: `verification-report-structured-feedback-preview-lifecycle-2026-09-13.html`

**Interfaces:**
- Consumes: completed frontend/backend implementation.
- Produces: deployed QA evidence and a handoff containing exact builds and remaining boundaries.

- [ ] Run all frontend Node/Python tests and the entire backend Django suite from clean commands.
- [ ] Run `git diff --check` and migration consistency checks in both worktrees.
- [ ] Deploy backend migrations/code and frontend artifact to QA only; record build identifiers.
- [ ] Use real browser gestures at desktop and short viewports to create/resume, generate, toggle/reload, download both files, complete, and publish.
- [ ] Inspect the downloaded PDF/DOCX and confirm watermark/content; query QA records to confirm settings and lifecycle counts.
- [ ] Generate the self-contained HTML verification report with screenshots and update local context.
- [ ] Dispatch independent reviewers for spec conformance, security/data integrity, and first-use UX; resolve any confirmed release blockers.
