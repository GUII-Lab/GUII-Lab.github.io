# LEAI Instructor Audit Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immutable, administrator-visible audit trail for instructor-account security events and state changes, plus the profile API needed by Instructor Home.

**Architecture:** Add one independent `InstructorAuditEvent` table and a centralized allow-listing writer. Covered mutations write their audit event in the same database transaction; denied events are recorded after authorization resolves. Django Admin exposes identity and audit records, with the audit log newest-first and read-only.

**Tech Stack:** Django 4.2, PostgreSQL, Django auth, Django Admin, Django TestCase/Client, `uv`.

**Spec:** `LEAI/docs/superpowers/specs/2026-09-10-leai-instructor-home-design.md`, especially Sections 8–10 and 13–15.

## Global Constraints

- Work in `/private/tmp/leai-question-set-wizard/backend` on the existing `feat/leai-question-set-wizard` branch.
- Do not push, deploy, or run a production migration.
- The audit migration creates a new table and indexes only; it must not alter or backfill existing course, survey, or response rows.
- Never store passwords, raw session tokens, authorization headers, student feedback, prompts, uploaded documents, analysis output, or unrestricted free text in audit events.
- Keep unknown-email and wrong-password responses identical.
- Attribute only authenticated/account-resolved operations; never infer an instructor from a legacy course password.
- Every successful covered mutation and its audit event must persist or roll back together.
- Use TDD and commit each independently passing task locally.

---

### Task 1: Add the append-only audit model and migration

**Files:**
- Modify: `datapipeline/models.py`
- Create: `datapipeline/migrations/0046_instructorauditevent.py`
- Create: `datapipeline/tests/test_instructor_audit.py`

**Interfaces:**
- Produces: `InstructorAuditEvent` with constants for actions and outcomes.
- Produces: newest-first model ordering and indexes for actor/time, course/time, and action/outcome/time.
- Consumes: `InstructorAccount`, `InstructorSession`, and `Course` from migration 0045.

- [ ] **Step 1: Write failing model-shape tests**

Add tests that instantiate one event and assert UUID identity, actor/session/course relationships, stable course ID snapshot, newest-first ordering, and model validation for action/outcome choices.

```python
class InstructorAuditModelTests(TestCase):
    def test_event_keeps_actor_course_and_stable_course_snapshot(self):
        event = InstructorAuditEvent.objects.create(
            actor=self.account,
            session=self.session,
            course=self.course,
            course_id_snapshot=self.course.course_id,
            action=InstructorAuditEvent.ACTION_COURSE_CREATED,
            outcome=InstructorAuditEvent.OUTCOME_SUCCESS,
            target_type='course',
            target_id=self.course.course_id,
            metadata={'institution_slug': 'ucsc'},
        )
        self.assertIsInstance(event.event_id, uuid.UUID)
        self.assertEqual(event.actor, self.account)
        self.assertEqual(event.course_id_snapshot, 'cmpm80k-sm26')
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
uv run python manage.py test datapipeline.tests.test_instructor_audit.InstructorAuditModelTests --verbosity 2
```

Expected: import failure because `InstructorAuditEvent` does not exist.

- [ ] **Step 3: Implement the model**

Add fixed constants and fields:

```python
class InstructorAuditEvent(models.Model):
    ACTION_LOGIN_SUCCEEDED = 'auth.login_succeeded'
    ACTION_LOGIN_DENIED = 'auth.login_denied'
    ACTION_LOGOUT = 'auth.logout'
    ACTION_PASSWORD_CHANGED = 'account.password_changed'
    ACTION_PROFILE_UPDATED = 'account.profile_updated'
    ACTION_COURSE_CREATED = 'course.created'
    ACTION_COURSE_BANNER_UPDATED = 'course.banner_updated'
    ACTION_COURSE_CUSTOMIZATION_UPDATED = 'course.customization_updated'
    ACTION_SURVEY_CREATED = 'survey.created'
    ACTION_SURVEY_UPDATED = 'survey.updated'
    ACTION_SURVEY_STATUS_CHANGED = 'survey.status_changed'
    ACTION_SURVEY_CLONED = 'survey.cloned'
    ACTION_SURVEY_DELETED = 'survey.deleted'
    ACTION_SURVEY_RESPONSES_EXPORTED = 'survey.responses_exported'
    ACTION_ANALYSIS_SESSION_CREATED = 'analysis.session_created'
    ACTION_ANALYSIS_SESSION_UPDATED = 'analysis.session_updated'
    ACTION_ANALYSIS_SESSION_DELETED = 'analysis.session_deleted'
    ACTION_ANALYSIS_TURN_STARTED = 'analysis.turn_started'
    ACTION_ANALYSIS_QUICKTAKE_GENERATED = 'analysis.quicktake_generated'
    ACTION_ANALYSIS_QUICKTAKE_DELETED = 'analysis.quicktake_deleted'
    ACTION_TEAM_CONFIGURATION_CREATED = 'team_configuration.created'
    ACTION_TEAM_CONFIGURATION_UPDATED = 'team_configuration.updated'
    ACTION_TEAM_CONFIGURATION_ARCHIVED = 'team_configuration.archived'
    ACTION_TEAM_CONFIGURATION_DELETED = 'team_configuration.deleted'
    ACTION_PDF_INGEST_STARTED = 'pdf_ingest.started'
    ACTION_PDF_INGEST_ABANDONED = 'pdf_ingest.abandoned'
    ACTION_PDF_INGEST_COMMITTED = 'pdf_ingest.committed'
    ACTION_PDF_INGEST_REVERTED = 'pdf_ingest.reverted'
    ACTION_AUTHORIZATION_DENIED = 'authorization.denied'

    OUTCOME_SUCCESS = 'success'
    OUTCOME_DENIED = 'denied'
    OUTCOME_FAILED = 'failed'

    event_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    occurred_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(
        InstructorAccount, on_delete=models.PROTECT,
        null=True, blank=True, related_name='audit_events',
    )
    session = models.ForeignKey(
        InstructorSession, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='audit_events',
    )
    course = models.ForeignKey(
        Course, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='instructor_audit_events',
    )
    course_id_snapshot = models.CharField(max_length=50, blank=True, default='')
    action = models.CharField(max_length=64, choices=ACTION_CHOICES)
    outcome = models.CharField(max_length=16, choices=OUTCOME_CHOICES)
    target_type = models.CharField(max_length=32, blank=True, default='')
    target_id = models.CharField(max_length=100, blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-occurred_at', '-id']
```

Add indexes named `leai_audit_actor_time`, `leai_audit_course_time`, and `leai_audit_action_time`. Keep actor protected so account history cannot be erased by deleting the account; allow a future course/session cleanup while retaining snapshots.

- [ ] **Step 4: Generate and inspect the isolated migration**

Run:

```bash
uv run python manage.py makemigrations datapipeline --name instructorauditevent
uv run python manage.py sqlmigrate datapipeline 0046
```

Expected: only `CREATE TABLE`, FK, constraint, and index SQL for the audit model; no alteration of existing domain tables.

- [ ] **Step 5: Run model tests and migration checks**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_audit.InstructorAuditModelTests --verbosity 2
uv run python manage.py makemigrations --check --dry-run
```

Expected: PASS and `No changes detected`.

- [ ] **Step 6: Commit the model slice**

```bash
git add datapipeline/models.py datapipeline/migrations/0046_instructorauditevent.py datapipeline/tests/test_instructor_audit.py
git commit -m "Add instructor audit event model"
```

---

### Task 2: Add the centralized validated audit writer

**Files:**
- Create: `datapipeline/instructor_audit.py`
- Modify: `datapipeline/tests/test_instructor_audit.py`

**Interfaces:**
- Produces: `record_instructor_event(*, action, outcome, actor=None, session=None, course=None, target_type='', target_id='', metadata=None) -> InstructorAuditEvent`.
- Produces: `ALLOWED_METADATA_KEYS`, keyed by action.
- Consumes: `InstructorAuditEvent` from Task 1.

- [ ] **Step 1: Write failing allow-list and secret-rejection tests**

```python
def test_writer_rejects_unknown_metadata_keys(self):
    with self.assertRaises(ValidationError):
        record_instructor_event(
            action=InstructorAuditEvent.ACTION_COURSE_CREATED,
            outcome=InstructorAuditEvent.OUTCOME_SUCCESS,
            actor=self.account,
            metadata={'password': 'must-not-land'},
        )
    self.assertFalse(InstructorAuditEvent.objects.exists())

def test_writer_derives_course_snapshot(self):
    event = record_instructor_event(
        action=InstructorAuditEvent.ACTION_COURSE_CREATED,
        outcome=InstructorAuditEvent.OUTCOME_SUCCESS,
        actor=self.account,
        course=self.course,
        metadata={'institution_slug': 'ucsc'},
    )
    self.assertEqual(event.course_id_snapshot, self.course.course_id)
```

Also reject metadata values that are nested objects/lists or strings longer than 100 characters.

- [ ] **Step 2: Run writer tests and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_audit.InstructorAuditWriterTests --verbosity 2
```

Expected: module import failure.

- [ ] **Step 3: Implement the writer**

Define a strict map:

```python
ALLOWED_METADATA_KEYS = {
    InstructorAuditEvent.ACTION_LOGIN_SUCCEEDED: frozenset(),
    InstructorAuditEvent.ACTION_LOGIN_DENIED: frozenset(),
    InstructorAuditEvent.ACTION_LOGOUT: frozenset(),
    InstructorAuditEvent.ACTION_PASSWORD_CHANGED: frozenset(),
    InstructorAuditEvent.ACTION_PROFILE_UPDATED: frozenset({'changed_field'}),
    InstructorAuditEvent.ACTION_COURSE_CREATED: frozenset({'institution_slug'}),
    InstructorAuditEvent.ACTION_COURSE_BANNER_UPDATED: frozenset({'changed_fields'}),
    InstructorAuditEvent.ACTION_COURSE_CUSTOMIZATION_UPDATED: frozenset({'changed_fields'}),
    InstructorAuditEvent.ACTION_SURVEY_CREATED: frozenset({'mode'}),
    InstructorAuditEvent.ACTION_SURVEY_UPDATED: frozenset({'changed_fields'}),
    InstructorAuditEvent.ACTION_SURVEY_STATUS_CHANGED: frozenset({'status'}),
    InstructorAuditEvent.ACTION_SURVEY_CLONED: frozenset({'source_survey_id'}),
    InstructorAuditEvent.ACTION_SURVEY_DELETED: frozenset({'responses_deleted'}),
    InstructorAuditEvent.ACTION_SURVEY_RESPONSES_EXPORTED: frozenset({'row_count'}),
    InstructorAuditEvent.ACTION_ANALYSIS_SESSION_CREATED: frozenset(),
    InstructorAuditEvent.ACTION_ANALYSIS_SESSION_UPDATED: frozenset({'changed_fields'}),
    InstructorAuditEvent.ACTION_ANALYSIS_SESSION_DELETED: frozenset(),
    InstructorAuditEvent.ACTION_ANALYSIS_TURN_STARTED: frozenset(),
    InstructorAuditEvent.ACTION_ANALYSIS_QUICKTAKE_GENERATED: frozenset({'scope_kind'}),
    InstructorAuditEvent.ACTION_ANALYSIS_QUICKTAKE_DELETED: frozenset(),
    InstructorAuditEvent.ACTION_TEAM_CONFIGURATION_CREATED: frozenset(),
    InstructorAuditEvent.ACTION_TEAM_CONFIGURATION_UPDATED: frozenset({'changed_fields'}),
    InstructorAuditEvent.ACTION_TEAM_CONFIGURATION_ARCHIVED: frozenset(),
    InstructorAuditEvent.ACTION_TEAM_CONFIGURATION_DELETED: frozenset(),
    InstructorAuditEvent.ACTION_PDF_INGEST_STARTED: frozenset({'file_count'}),
    InstructorAuditEvent.ACTION_PDF_INGEST_ABANDONED: frozenset(),
    InstructorAuditEvent.ACTION_PDF_INGEST_COMMITTED: frozenset({'student_count', 'message_count'}),
    InstructorAuditEvent.ACTION_PDF_INGEST_REVERTED: frozenset({'deleted_count'}),
    InstructorAuditEvent.ACTION_AUTHORIZATION_DENIED: frozenset({'reason_code'}),
}
```

The function must verify that `action` and `outcome` are valid choices, metadata is a dict, keys are exactly within the per-action allow-list, and values are bounded scalar values or a bounded list of fixed field-name strings for `changed_fields`. It derives `course_id_snapshot` from `course`, calls `full_clean()`, then saves.

- [ ] **Step 4: Run all audit tests**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_audit --verbosity 2
```

Expected: PASS.

- [ ] **Step 5: Commit the writer**

```bash
git add datapipeline/instructor_audit.py datapipeline/tests/test_instructor_audit.py
git commit -m "Validate instructor audit events"
```

---

### Task 3: Audit authentication, password, profile, and course events atomically

**Files:**
- Modify: `datapipeline/instructor_views.py`
- Modify: `datapipeline/tests/test_instructor_sessions.py`
- Modify: `datapipeline/tests/test_instructor_courses.py`
- Modify: `datapipeline/tests/test_instructor_audit.py`

**Interfaces:**
- Produces: `PATCH /datapipeline/api/instructor_me/` accepting only `display_name`.
- Consumes: `record_instructor_event(...)` from Task 2.
- Preserves: GET account serialization and existing session/course endpoint response shapes.

- [ ] **Step 1: Write failing authentication audit tests**

Prove successful login creates one `auth.login_succeeded` event tied to the new session and account. Wrong password for a known account creates one denied event tied to the account; an unknown email creates a denied event with `actor=None` and no raw email in metadata. Logout creates one success event tied to the session that is revoked.

```python
event = InstructorAuditEvent.objects.get(
    action=InstructorAuditEvent.ACTION_LOGIN_SUCCEEDED,
)
self.assertEqual(event.actor, self.account)
self.assertEqual(event.session.token_digest, hashlib.sha256(raw_token.encode()).hexdigest())
self.assertEqual(event.metadata, {})
```

- [ ] **Step 2: Write failing mutation-atomicity tests**

Patch `record_instructor_event` to raise `ValidationError` during password change and course creation. Assert the password/course mutation rolls back. Also assert duplicate course ID produces no `course.created` success event and institution denial produces one `authorization.denied` event.

- [ ] **Step 3: Write failing profile PATCH tests**

Cover missing token, required-password gate, unknown field rejection, blank/over-100-character display names, trimmed success response, one audit event, and unchanged historical `Course.instructor_name`.

```python
response = self.client.patch(
    '/datapipeline/api/instructor_me/',
    data=json.dumps({'display_name': '  Prof. Updated  '}),
    content_type='application/json',
    HTTP_AUTHORIZATION=f'Bearer {token}',
)
self.assertEqual(response.status_code, 200)
self.assertEqual(response.json()['display_name'], 'Prof. Updated')
self.course.refresh_from_db()
self.assertEqual(self.course.instructor_name, 'Prof. Original')
```

- [ ] **Step 4: Run focused tests and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_sessions datapipeline.tests.test_instructor_courses datapipeline.tests.test_instructor_audit --verbosity 2
```

Expected: missing audit events and PATCH returns 405.

- [ ] **Step 5: Wire authentication events**

Wrap session issuance plus the successful login event in one outer `transaction.atomic()`. On denied login, resolve a possible active account without changing the generic response, write a denied event with empty metadata, and return the existing 401 body. Wrap session revocation plus logout event in one transaction.

- [ ] **Step 6: Wire password and course events**

Write `account.password_changed` before leaving the existing password transaction. Write `course.created` after creating both Course and owner membership but before leaving the course transaction. Emit `authorization.denied` only for authenticated institution/course permission failures, using a fixed `reason_code` such as `institution_access_denied`.

- [ ] **Step 7: Implement PATCH instructor_me**

Allow `GET` and `PATCH`. PATCH authenticates through `_authenticated_account`, rejects any key other than `display_name`, trims the value, validates 1–100 characters, and updates the account plus `account.profile_updated` audit event atomically. Respond with `_serialize_account(account)`.

- [ ] **Step 8: Run focused tests and verify GREEN**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_sessions datapipeline.tests.test_instructor_courses datapipeline.tests.test_instructor_audit --verbosity 2
```

Expected: PASS with exact event counts.

- [ ] **Step 9: Commit the endpoint slice**

```bash
git add datapipeline/instructor_views.py datapipeline/tests/test_instructor_sessions.py datapipeline/tests/test_instructor_courses.py datapipeline/tests/test_instructor_audit.py
git commit -m "Audit instructor account operations"
```

---

### Task 4: Expose safe identity and audit views in Django Admin

**Files:**
- Modify: `datapipeline/admin.py`
- Create: `datapipeline/tests/test_instructor_admin.py`

**Interfaces:**
- Produces: admin registrations for `Institution`, `InstructorAccount`, `InstitutionMembership`, `InstructorSession`, `CourseMembership`, and `InstructorAuditEvent`.
- Produces: read-only `InstructorAuditEventAdmin` ordered newest-first.

- [ ] **Step 1: Write failing registration and immutability tests**

Use `admin.site._registry` to prove every identity model is registered. Instantiate the audit ModelAdmin and assert no add/change/delete permission, all fields are read-only, ordering is `('-occurred_at', '-id')`, and list filters include action/outcome/course/date.

```python
audit_admin = admin.site._registry[InstructorAuditEvent]
self.assertFalse(audit_admin.has_add_permission(request))
self.assertFalse(audit_admin.has_change_permission(request, event))
self.assertFalse(audit_admin.has_delete_permission(request, event))
self.assertEqual(audit_admin.get_ordering(request), ('-occurred_at', '-id'))
```

- [ ] **Step 2: Run admin tests and verify RED**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_admin --verbosity 2
```

Expected: instructor models are absent from the registry.

- [ ] **Step 3: Implement safe ModelAdmin classes**

Use `list_select_related` to avoid N+1 queries. Audit list columns are event ID, occurred time, actor, action, outcome, course snapshot, target type, and target ID. Search fields are actor email, course ID snapshot, target ID, and exact event ID. Do not display token digests. Override add/change/delete permissions to return false and `get_readonly_fields()` to return every concrete field name.

Register sessions with account email, creation, expiry, revoked, and last-used columns only. Register account/membership models with practical search and filters for administrator provisioning support.

- [ ] **Step 4: Run admin and audit tests**

```bash
uv run python manage.py test datapipeline.tests.test_instructor_admin datapipeline.tests.test_instructor_audit --verbosity 2
```

Expected: PASS.

- [ ] **Step 5: Commit the admin slice**

```bash
git add datapipeline/admin.py datapipeline/tests/test_instructor_admin.py
git commit -m "Expose instructor audit log in admin"
```

---

### Task 5: Backend integrity and release-boundary verification

**Files:**
- Modify only if verification uncovers a task-owned defect.

**Interfaces:**
- Verifies the backend contract required by the frontend plan.

- [ ] **Step 1: Run migration safety checks**

```bash
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py migrate --plan
uv run python manage.py sqlmigrate datapipeline 0046
```

Expected: no model drift; 0046 is additive and has no data backfill or destructive SQL.

- [ ] **Step 2: Run the complete backend test suite**

```bash
uv run python manage.py test datapipeline.tests --verbosity 1
```

Expected: all tests pass on PostgreSQL. If SQLite shows the already-known concurrency lock failure, repeat the exact failing test on PostgreSQL and report the distinction rather than hiding it.

- [ ] **Step 3: Run Django and diff checks**

```bash
uv run python manage.py check
uv run python manage.py check --deploy
git diff --check
git status --short
```

Expected: no new Django errors or warnings; existing deployment warnings are reported separately.

- [ ] **Step 4: Verify audit invariants from the database**

Run the focused tests with assertions for exact event counts. Confirm no test event metadata contains keys outside the allow-list and a failed transaction leaves both domain and audit row counts unchanged.

- [ ] **Step 5: Stop at the local boundary**

Do not push, deploy, migrate Heroku, or claim full legacy-endpoint audit coverage. Report the exact initial event set and state that later legacy endpoints gain audit coverage in the same commits that add account authorization.
