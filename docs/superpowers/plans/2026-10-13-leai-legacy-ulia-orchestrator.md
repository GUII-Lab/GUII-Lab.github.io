# Legacy LEAI Ulia Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve the original static LEAI interface, connect both Ulia protocols to the existing AI orchestrator, and bind two separate reflections to the confirmed winter 80 course. **Status: implemented, published, installed, and post-release dialogue checked.**

**Architecture:** Add a legacy API/storage adapter around the existing `run_orchestration` and `preview_proposal`; retain legacy Course/FeedbackGPT identity. Store frozen protocol, authoritative flow/evidence, ordered FeedbackMessage rows and idempotency receipts on the server. Feed existing UI, analysis and downloads from that state.

**Tech Stack:** Existing Django 5.2/PostgreSQL, vanilla HTML/JS, OpenAI Responses client, existing browser download libraries, Node tests and uv-managed Python. No new product dependency.

**Spec:** `docs/superpowers/specs/2026-10-13-leai-legacy-ulia-orchestrator-design.md` (approved 2026-10-13).

## Global Constraints

- Preserve existing interface, message rendering, composer, dictation, course settings and output design.
- Preserve exact Ulia fixture wording, 11 IDs in P1–P4/M1–M4/E1–E3 order, 3 sections, scales, coverage and probe budgets.
- Likert input remains natural-language chat; no rating widget, sentiment-inferred rating or declined-to-midpoint conversion.
- Server owns history, protocol, progression, evidence, completion and saved outputs. Do not copy the orchestrator into browser code.
- Keep other general/group/form surveys on their existing path. Reject legacy direct writes for orchestrated sessions to prevent duplicate or forged answer rows.
- Existing main branches only; preserve unrelated frontend dirty work and the backend's 19 unpushed commits. No push/deployment as a side effect.
- Backend root is `/Users/harveyli/Documents/GitHub/guiidatapipelines`; frontend root is this checkout. Backend writes need the normal sandbox permission mechanism.
- Use uv for Python; actual full tests/checks and real-page verification precede completion claims.
- Exact winter course ID must be read from real records or confirmed by user; no inferred ID, course creation, old survey replacement or response migration.
- Local implementation/testing first. Hosted candidate and deployment authorization precede live course installation; do not bypass the current local/QA orchestration gate.

## Review Focus

- One message supports several items and includes Unicode or repeated quotes: retain valid per-item evidence and reject ambiguous spans.
- Client loses the success response or another tab advances: retry once with the original request ID without duplicate messages; handle stale versions by refreshing authoritative state.
- Teacher changes the registry after a student begins: resume the frozen original protocol and keep its content hash.
- Browser storage is unavailable: preserve the current session in memory and show recovery limitations without creating another session per turn.
- Survey closes or referral settings change while provider runs: recheck at commit, reject closed writes and suppress an outdated referral.

## Shared contracts and test fixture

New backend modules:

- `datapipeline/leai_legacy_protocol.py`: `build_envelope(protocol: dict) -> dict`, `protocol_for_survey(survey: FeedbackGPT) -> dict | None`.
- `datapipeline/leai_legacy_orchestration.py`: `start_or_resume(survey, session_id: str, terms_consent: bool, research_consent: bool) -> LegacyOrchestrationSession`, `commit_turn(session, text: str, expected_version: int, request_id: str) -> dict`, `session_payload(session) -> dict`, `derive_snapshot(session) -> dict`, `finalize_session(session, expected_version: int) -> dict`.
- `datapipeline/leai_legacy_orchestration_views.py`: POST session, turn and finalize views; existing JSON/error conventions and no-store responses.

Session payload keys are `engine`, `session_id`, `version`, `status`, `messages`, `progress`, `review_ready`, `results`, `answer_excerpts`; operational metrics are excluded. Messages contain stable `sequence`, `sent_by`, `content`, `created_at`, `referred` and existing form attribution. Snapshot contains `protocol_hash`, `schema`, `slots`, `results`, `messages`, `finalized_at`. Slots map section ID to item ID to verbatim active answer text, with supported rating/label prepended for Likert outputs.

Common Django fixture, implemented in `datapipeline/tests/test_legacy_orchestration.py`:

```python
import json
from pathlib import Path
from django.test import TestCase, override_settings
from datapipeline.models import Course, FeedbackGPT, FormSchema
from datapipeline.leai_legacy_protocol import build_envelope

ROOT = Path(__file__).resolve().parents[2]

@override_settings(LEAI_ENVIRONMENT='local', LEAI_ORCHESTRATION_ENABLED=True)
class LegacyOrchestrationTests(TestCase):
    def setUp(self):
        self.protocol = json.loads((ROOT / 'leai/fixtures/ulia_conversational.json').read_text())
        self.course = Course.objects.create(course_id='ulia-local-verifier', course_name='Local verifier', instructor_name='Verifier', password='local-only')
        self.schema = FormSchema.objects.create(schema_id='ulia-local-text', body=build_envelope(self.protocol))
        self.survey = FeedbackGPT.objects.create(public_id='ulialocaltext', name='Local Ulia text', instructions='Schema managed', course=self.course, mode='form', form_schema=self.schema)
```

All student fixtures are synthetic with `research_consent=False`. These IDs never identify the target winter course.

### Task 1: Schema envelope and registration

**Files:** Create backend `datapipeline/leai_legacy_protocol.py`, `datapipeline/management/commands/install_legacy_ulia_reflections.py`; test `datapipeline/tests/test_legacy_ulia_registration.py`.

- [ ] Write failing tests for exact protocol equality, generated fields, two registrations, default dry-run, repeat idempotency, conflict rollback and unknown course refusal. Test the command with `call_command('install_legacy_ulia_reflections', course_id, stdout=StringIO())`; assert no new records before `apply=True`.
- [ ] Run the scoped test with `uv run --no-project --python .venv/bin/python python manage.py test datapipeline.tests.test_legacy_ulia_registration`; confirm the new command/module is missing before implementation.
- [ ] Implement the envelope as a projection, not a rewritten protocol:

```python
def build_envelope(protocol):
    from copy import deepcopy
    from leai.services.protocol import validate_protocol
    validate_protocol(protocol)
    return {'engine': 'orchestrator-v1', 'protocol': deepcopy(protocol),
            'title': protocol['title'], 'intro': protocol['intro'],
            'sections': [{'id': s['id'], 'title': s['title'],
                          'fields': [{'id': i['id'], 'kind': 'shortform', 'label': i['prompt']}
                                     for i in s['items']]} for s in protocol['sections']]}
```

- [ ] Command consumes the two existing fixture files and exact legacy course ID. Use deterministic schema IDs `ulia-conversational-v1` and `ulia-likert-v1`, verify existing body equality, and create two separately labelled FeedbackGPT records only with `--apply`. Use one atomic transaction and report exact row counts/public IDs. Existing mismatches abort, not update.
- [ ] Pass scoped registration tests and record the focused diff. No installation into an unidentified/live course.

### Task 2: Durable legacy sessions and turn storage

**Files:** Modify backend `datapipeline/models.py`; create `datapipeline/migrations/0045_legacy_orchestration.py` and `datapipeline/leai_legacy_orchestration.py`; test `datapipeline/tests/test_legacy_orchestration.py`.

- [ ] Add RED tests using the common fixture: repeated start writes only two opening messages; successful turn writes exactly one user/assistant pair; same request replay returns without a second provider call; conflicting payload with same ID fails; provider failure leaves all counts/version unchanged.
- [ ] Define `LegacyOrchestrationSession`: survey FK, session ID, frozen protocol/schema/hash, terms/research consent, flow state JSON, turn version, next sequence, status and finalized snapshot/time. Unique `(survey, session_id)`. Define `LegacyOrchestrationReceipt`: session FK, request ID, request hash, resulting version; unique `(session, request_id)`. Add nullable orchestration-session FK and sequence to FeedbackMessage with unique `(orchestration_session, orchestration_sequence)` for attached rows; historical rows stay null.
- [ ] Start with `begin_flow(protocol)` and intro/main question rendered by the existing `main_question_text`; initialize messages at sequences 1/2, next sequence 3 and version 1. Resume never rebuilds state from transcript.
- [ ] `commit_turn` reads server history and invokes the real provider outside the write lock; under `transaction.atomic()` lock the session, recheck lifecycle/version/receipt, call `preview_proposal`, then save pair/state/receipt atomically. Preserve original user text and validated evidence. Use current course referral policy and suppress a stale nudge as the canonical adapter does.
- [ ] Test changed registry snapshot, early-answer/revision evidence, Unicode and quote ambiguity, stale tab, closed-during-provider and modified referral settings. Preserve no diagnostics in public payload. Pass scoped tests and `makemigrations --check --dry-run`.

### Task 3: Legacy API and authoritative completion

**Files:** Create backend `datapipeline/leai_legacy_orchestration_views.py`; modify `datapipeline/urls.py`, `views.py`, `leai_completion.py`; test `datapipeline/tests/test_legacy_orchestration_api.py`.

- [ ] Write RED tests for consent required, invalid session, cross-survey isolation, closed/scheduled/expired survey, unavailable engine, stale version, retry and completed session mutation. Existing legacy direct-write and bulk-write endpoints reject a survey/session managed by orchestration.
- [ ] Add POST `/form_orchestration/session/`, `/form_orchestration/turn/`, `/form_orchestration/finalize/` under existing API base. All take `public_id` and `session_id` in body; turn also takes `text`, `expected_version`, `request_id`; finalize takes `expected_version`.
- [ ] Return 400 for malformed inputs, 403 for consent/lifecycle denial, 404 for absent resources, 409 for version/receipt conflict, 422 for unsupported engine and 503 for provider unavailable. Never fall through to legacy chat when marked orchestrator.
- [ ] Compute `review_ready` from saved `phase == 'complete'`. Finalize under lock into a frozen `derive_snapshot` result, deny premature completion, and make repeated finalize/download stable. Certificates for these sessions use server completion, preserving the current certificate renderer and settings.
- [ ] Read effective answer spans by server Unicode offsets from stored user messages; build section/item slots and rating labels from each authored scale. Never infer from assistant text. Pass API tests, including snapshot stability after later schema/settings changes and no certificate on incomplete state.

### Task 4: Original student UI connection

**Files:** Create frontend `LEAI/leai-orchestration.js`, `LEAI/tests/leai-orchestration.test.js`; modify `LEAI/feedback.html`.

- [ ] Write RED Node tests for client request IDs/retry, stale recovery, frozen pending input, storage failure, no duplicate rendering and snapshot-to-renderer shape. Module exports in Node and attaches `leaiOrchestration` in the browser; inject `fetch` in tests, use shared `API` in production.
- [ ] Implement `createClient({api, fetch, publicId, sessionId})` returning `start(consent)`, `send(text)`, `retry()`, `resume()`, `finalize()`, `getState()`. A pending turn freezes text/version/request ID; retry reuses them. Success consumes pending text; network/provider failure preserves it.
- [ ] Branch on `form_schema.body.engine` before old engine initialization. Call the backend adapter after existing consent, render saved rows with original `appendMessage(..., {skipPersist:true})`, and render progress in the original progress element. Wire existing Send/Enter/mic transcript to the new path without changing DOM/layout or dictation ownership.
- [ ] Suppress old `beforeTurn`, `afterTurn`, proxy calls, transcript truncation and `storeData` only for the flagged Ulia path. Render retry/closed errors within existing components. Ready state keeps the composer editable; finalized state follows existing completion/download display.
- [ ] Route original download actions through `finalize`, set `state.schema`/`state.slots` from the saved snapshot, and reuse the existing renderers. Do not run `extractSlots`. Run all Node tests and JS syntax checks.

### Task 5: Teacher selection and accurate old analysis

**Files:** Modify frontend `LEAI/PromptDesigner.html`, `LEAI/leai-shared.js`, `LEAI/FeedbackAnalyzer.html` only at relevant read points; modify backend `datapipeline/views.py`, `leai_analysis.py`; add tests `LEAI/tests/leai-orchestration-analysis.test.js`, backend `datapipeline/tests/test_legacy_orchestration_analysis.py`.

- [ ] Write RED tests for revised answers disappearing from active analysis, one message covering multiple items, Likert score/label preservation, same session ID across different survey isolation, and original non-orchestrated behavior.
- [ ] Teacher schema selection shows existing preview with source intro; schema-managed instructions are readonly only for flagged protocols. Creating and cloning retains its schema engine. Do not change other page content/styles.
- [ ] Add `structured_sessions` to existing survey response payload: key by session ID within that survey, values `derive_snapshot` answer/results/section projections without diagnostic data. Backend corpus uses effective excerpts, not `_extract_form_sections`, for attached orchestration sessions. Frontend form analysis uses that projection; old rows keep existing handling.
- [ ] Existing exports/downloads use revised evidence and explicit score labels; raw transcript remains available separately. Pass scoped and full suites; inspect focused diffs for unrelated changes.

### Task 6: Real-page verification and winter-course handoff

**Files:** Create scoped Playwright verification script/report under existing `.web-verify/` convention; add course install receipt to `.context/ulia-legacy-integration-audit-2026-10-13.md`. Avoid committing screenshots/report/context.

- [ ] Run full Node suite, full Django suite, Django checks/migration checks. Static frontend has no product build script; record that fact. Distinguish provider doubles from actual orchestrator/provider journeys.
- [ ] Serve actual static pages and Django on loopback using unused ports; preserve unrelated processes. Use real clicks/types on teacher/student pages, desktop/mobile and multiple available engines. Complete both 11-item schemas, revise an earlier answer, reload mid-way, finalize/download, and read Analyzer. Capture matched original/updated screenshots and generate self-contained HTML report.
- [ ] Query all synthetic sessions/messages/receipts/results and compare exact expected counts. Verify both 11-item final results, ratings with evidence, original question order, stable downloads/certificates, error/retry and lifecycle cases. Explicitly record physical microphone and hosted checks if unavailable.
- [ ] Resolve target course from actual record: legacy `course_id`, `course_name`, `instructor_name`, environment and existing survey list. Current audit: local `ciba` has no matching winter course; Heroku CLI lacks authentication. Ask for exact ID or restore the existing authorized connection; do not invent it.
- [ ] Prepare exact frontend/backend deployment candidate and installer dry-run for that ID. Existing local/QA-only orchestration gate remains intact until hosted rollout is explicitly authorized. Only after that authorization install two separate Ulia surveys in the target course, verify both persisted IDs/schema bodies, and supply both original-interface links. Do not replace existing winter surveys.
- [ ] Update local context with actual implemented/verified/bound state. Linear project is owner-confirmed; read existing issues and propose scoped progress without closing React work for legacy-only results.

## Self-review and execution gate

All approved design sections map to Tasks 1–6. One independent review surfaced four Important findings; each was reproduced and fixed. Local full suites passed before publication. The owner approved the exact scoped release and installation. Heroku `guiidata` and GitHub Pages publication succeeded; two surveys were installed in course 133 (`cmpm80h-wi27`) while the existing Week 0 survey remained intact.

Post-release testing used one temporary synthetic dialogue per formal survey. Twenty scoped criteria passed across real provider turns, retries, stale requests, edits, refresh, downloads, certificates, and Firefox/WebKit mobile restoration. The two test sessions and their attached messages, receipts, and test certificates were removed and independently read back as absent. Screenshots, transcripts, candidate copies, and generated reports were removed during wrap-up. See the local execution ledger for concise evidence and remaining limits. Physical mic/touch and native Word layout remain untested; the storage-recovery notice remains deferred.
