# LEAI Instructor Endpoint Authorization and Audit Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every instructor-only operation reachable from account-based LEAI tools is authorized to the selected course and every state change or sensitive export is attributable before Instructor Home is released.

**Architecture:** Central helpers resolve the canonical Course, authenticate the bearer session, and validate active CourseMembership plus capability. Membership-owned courses reject missing and wrong-course tokens. Mutations write fixed-enum audit events atomically, while shared frontend fetch helpers attach the bearer token.

**Tech Stack:** Django 4.2, PostgreSQL, static HTML/vanilla JavaScript, Django TestCase/Client, Node test runner, `uv`.

**Spec:** `LEAI/docs/superpowers/specs/2026-09-10-leai-instructor-home-design.md`, Section 9.4.

## Global Constraints

- Backend worktree: `/private/tmp/leai-question-set-wizard/backend`; frontend worktree: `/private/tmp/leai-question-set-wizard/frontend`; both use the existing `feat/leai-question-set-wizard` branch.
- Complete the audit model/writer plan first.
- Do not push, deploy, change production flags, or migrate production.
- Membership-owned courses with `legacy_password_login_enabled=False` must reject instructor operations without a valid token and active membership for the exact course.
- Owners have publish/export rights; non-owners must satisfy `can_publish` or `can_export` where required.
- Public student endpoints remain public and are never attributed to an instructor.
- Legacy compatibility remains explicit and never fabricates an account actor.
- Audit metadata never contains responses, prompts, analysis output, uploaded filenames/content, raw tokens, or passwords.

---

## Release coverage matrix

| Endpoint | Canonical course | Requirement | Success audit |
|---|---|---|---|
| `POST update_course_banner` | body course ID | membership + publish | `course.banner_updated` |
| `POST update_course_customization` | body course ID | membership + publish | `course.customization_updated` |
| `POST create_feedback_gpt` | body course ID | membership + publish | `survey.created` |
| `POST set_survey_status` | survey course | membership + publish | `survey.status_changed` |
| `POST update_survey` | survey course | membership + publish | `survey.updated` |
| `POST clone_survey` | source survey course | membership + publish | `survey.cloned` |
| `POST delete_survey` | survey course | owner or publish | `survey.deleted` |
| `GET export_survey_responses` | survey course | owner or export | `survey.responses_exported` |
| survey/response list reads | query/survey course | membership | none |
| chat session collection/detail/turn/message | chat session course | membership | create/update/delete/turn events |
| Quick Take GET/DELETE/generate | request course | membership | delete/generate events |
| team configuration list/create/update/archive/delete | config course | membership; writes publish | mutation events |
| PDF start/detail/commit/roster/dedup/batches/revert | related survey course | membership; writes publish | start/abandon/commit/revert events |

`get_feedback_gpt_by_public_id`, `feedback_message_api`, `feedback_session_resume`, `issue_completion_certificate`, `register_session_identity`, public schema-template reads, and student team assignment remain student/public flows.

`feedback_messages_bulk_api` is not accepted as a general account endpoint because its messages do not provide one trustworthy canonical course before validation. Replace the Prompt Designer import call with the PDF-ingest flow or a survey-scoped authenticated endpoint; never authorize a mixed-course batch from client `gpt_id` values.

---

### Task 1: Add reusable course authorization and capability helpers

**Files:**
- Modify: `datapipeline/instructor_auth.py`
- Create: `datapipeline/tests/test_instructor_endpoint_authorization.py`

**Interfaces:**
- Produces: `authorize_instructor_course(request, course, *, capability=None) -> (account, session, membership, error_response)`.
- Produces: `membership_allows(membership, capability) -> bool` for `publish`, `export`, or `None`.

- [ ] **Step 1: Write failing helper tests**

Cover missing/malformed/expired token, inactive membership, wrong-course token, owner capability bypass, explicit instructor capability, and TA denial. Assert exact 401 `authentication_required`, 403 `course_access_denied`, and 403 `capability_denied` bodies.

```python
account, session, membership, error = authorize_instructor_course(
    request, self.course, capability='publish',
)
self.assertEqual(account, self.account)
self.assertEqual(membership.course, self.course)
self.assertIsNone(error)
```

- [ ] **Step 2: Run the helper test and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.InstructorCourseAuthorizationTests --verbosity 2
```

- [ ] **Step 3: Implement the helper**

Authenticate once, query one active membership joined through an active InstitutionMembership, and compare its course to the canonical Course object. Owners pass both capability checks. Do not accept a second client course ID after the domain object is resolved.

- [ ] **Step 4: Verify and commit**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.InstructorCourseAuthorizationTests --verbosity 2
git add datapipeline/instructor_auth.py datapipeline/tests/test_instructor_endpoint_authorization.py
git commit -m "Authorize instructor course operations"
```

---

### Task 2: Protect and audit course and survey management

**Files:**
- Modify: `datapipeline/views.py`
- Modify: `datapipeline/tests/test_leai_views.py`
- Modify: `datapipeline/tests/test_instructor_endpoint_authorization.py`

**Interfaces:**
- Consumes: `authorize_instructor_course` and `record_instructor_event`.
- Produces: protected course settings, survey lifecycle, response reads, and export endpoints from the matrix.

- [ ] **Step 1: Add a table-driven RED authorization matrix**

For each course/survey endpoint, test no token, wrong-course token, owner token, and explicit legacy compatibility. For mutations, assert exactly one action event on success and zero success events on rejection or rollback. For export, assert event `row_count` equals exported response rows.

- [ ] **Step 2: Run the matrix and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.CourseAndSurveyEndpointMatrixTests --verbosity 2
```

- [ ] **Step 3: Authorize canonical objects before access**

Resolve Course directly for course endpoints and through `FeedbackGPT.course` for survey endpoints. Require publish for writes, export for CSV, and active membership for response/survey reads. Keep public survey/student endpoints unchanged.

- [ ] **Step 4: Make mutations and events atomic**

Wrap each save/delete/clone and its event in one `transaction.atomic()`. Capture stable target IDs and bounded count/field metadata before deletion. Do not catch an audit-validation failure and then commit the domain mutation.

- [ ] **Step 5: Verify and commit**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.CourseAndSurveyEndpointMatrixTests datapipeline.tests.test_leai_views --verbosity 2
git add datapipeline/views.py datapipeline/tests/test_leai_views.py datapipeline/tests/test_instructor_endpoint_authorization.py
git commit -m "Protect and audit instructor survey operations"
```

---

### Task 3: Protect and audit analysis sessions and Quick Takes

**Files:**
- Modify: `datapipeline/views.py`
- Modify: `datapipeline/tests/test_leai_analysis.py`
- Modify: `datapipeline/tests/test_instructor_endpoint_authorization.py`

**Interfaces:**
- Authorizes through `LEAIChatSession.course`, `LEAIChatMessage.session.course`, or the Quick Take request course.
- Emits fixed `analysis.*` actions.

- [ ] **Step 1: Write RED coverage for every analysis method**

Test GET/POST session collection, GET/PATCH/DELETE detail, POST turn, GET message polling, GET/DELETE Quick Take, and POST Quick Take generation with no token, wrong-course token, and owner token. Writes create one event; reads/polls create none.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.AnalysisEndpointMatrixTests --verbosity 2
```

- [ ] **Step 3: Implement authorization and atomic events**

Authorize before serializing content or starting a job. Session create/update/delete and Quick Take delete write their event in the same transaction. Async turn/Quick Take generation records the event atomically with the pending job/message row, not after model output completes.

- [ ] **Step 4: Verify and commit**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.AnalysisEndpointMatrixTests datapipeline.tests.test_leai_analysis --verbosity 2
git add datapipeline/views.py datapipeline/tests/test_leai_analysis.py datapipeline/tests/test_instructor_endpoint_authorization.py
git commit -m "Protect and audit instructor analysis operations"
```

---

### Task 4: Protect and audit team configuration and PDF ingest

**Files:**
- Modify: `datapipeline/views.py`
- Modify: `datapipeline/leai_pdf_ingest.py`
- Modify: `datapipeline/tests/test_leai_pdf_ingest.py`
- Modify: `datapipeline/tests/test_instructor_endpoint_authorization.py`

**Interfaces:**
- Resolves TeamConfiguration to Course and ingest job/batch to Survey to Course.
- Emits fixed `team_configuration.*` and `pdf_ingest.*` actions.

- [ ] **Step 1: Write the RED method matrix**

Cover list/create/update/archive/delete team configurations and every PDF start/detail DELETE/commit/roster/dedup/batches/revert path with missing, wrong-course, and owner tokens. Reads emit no event; state changes emit one; failed commit/revert emits no success event.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.TeamAndPdfEndpointMatrixTests --verbosity 2
```

- [ ] **Step 3: Implement authorization and transaction ownership**

Resolve the canonical course before exposing roster or ingest content. If a PDF service owns the transaction, pass actor/session into that service and create the event inside the same transaction. Metadata contains counts only, never filenames, student IDs, mappings, or extracted content.

- [ ] **Step 4: Verify and commit**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization.TeamAndPdfEndpointMatrixTests datapipeline.tests.test_leai_pdf_ingest --verbosity 2
git add datapipeline/views.py datapipeline/leai_pdf_ingest.py datapipeline/tests/test_leai_pdf_ingest.py datapipeline/tests/test_instructor_endpoint_authorization.py
git commit -m "Protect and audit team and PDF operations"
```

---

### Task 5: Attach bearer authorization from all account-based pages

**Files:**
- Modify: `LEAI/leai-instructor-auth.js`
- Modify: `LEAI/leai-shared.js`
- Modify: `LEAI/PromptDesigner.html`
- Modify: `LEAI/FeedbackAnalyzer.html`
- Modify: `LEAI/FeedbackChat.html`
- Modify: `LEAI/CourseBanner.html`
- Modify: `LEAI/Customizations.html`
- Create: `LEAI/tests/instructor-authorized-requests.test.js`

**Interfaces:**
- Produces: `authorizedFetch(fetchImpl, token, url, options) -> Promise<Response>`.
- Makes shared analysis/team/PDF wrappers use the current instructor token.

- [ ] **Step 1: Write RED source and request tests**

Mock fetch and assert bearer headers for every protected shared wrapper. Source-scan each page's direct instructor requests and require `authorizedFetch`. Assert student/public helpers remain token-free.

- [ ] **Step 2: Implement the common request helper**

Merge headers without losing `Content-Type`. Omit authorization only for an explicit legacy session with no instructor token. On account-session 401, clear `leai_session` and route Home; never silently retry a mutation.

- [ ] **Step 3: Replace direct account requests**

Update survey reads/writes, protected response reads/export, chat/Quick Take, banner/customization saves, team configuration, and PDF ingest. Preserve intentional student and legacy-login calls.

- [ ] **Step 4: Verify and commit**

```bash
node --test LEAI/tests/*.test.js
git add LEAI/leai-instructor-auth.js LEAI/leai-shared.js LEAI/PromptDesigner.html LEAI/FeedbackAnalyzer.html LEAI/FeedbackChat.html LEAI/CourseBanner.html LEAI/Customizations.html LEAI/tests/instructor-authorized-requests.test.js
git commit -m "Authorize instructor tool requests"
```

---

### Task 6: Add guarded per-course cutover and run the release gate

**Files:**
- Create: `datapipeline/management/commands/cutover_leai_course_auth.py`
- Create: `datapipeline/tests/test_instructor_course_cutover.py`

**Interfaces:**
- Produces: `cutover_leai_course_auth --course-id <id> [--dry-run]`.
- Changes only `legacy_password_login_enabled` after validating institution, active owner membership, and active owner account.

- [ ] **Step 1: Write RED command tests**

Prove dry-run changes nothing, missing/inactive ownership blocks, valid cutover disables legacy login, repeated execution is idempotent, and no other course changes.

- [ ] **Step 2: Implement guarded cutover**

Lock the explicit Course row in `transaction.atomic()`, print resolved course/institution/owner, and change only `legacy_password_login_enabled`. Do not support globs, all-courses mode, or implicit selection.

- [ ] **Step 3: Run complete suites**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_endpoint_authorization datapipeline.tests.test_instructor_course_cutover --verbosity 2
uv run python manage.py test datapipeline.tests --verbosity 1
uv run python manage.py makemigrations --check --dry-run
node --test LEAI/tests/*.test.js
```

- [ ] **Step 4: Run the local wrong-course matrix**

With two accounts and two courses, exercise every matrix mutation once with the correct token and once with the other course's token. Assert correct operations persist with one event, wrong-course operations return 403 with no domain change/success event, and Admin lists successful events newest-first.

- [ ] **Step 5: Stop before production**

Do not run cutover against Heroku, push, deploy, or claim production readiness. Report local course IDs, event counts by action, full-suite results, and excluded public/student endpoints.
