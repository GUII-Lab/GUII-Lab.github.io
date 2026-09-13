# LEAI Shared-Database QA Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the internal LEAI QA app against a dedicated `leai_qa` PostgreSQL schema on the existing Heroku Postgres add-on without allowing QA code, migrations, seed, or reset operations to fall through to production's `public` schema.

**Architecture:** The production and QA Heroku apps share one managed Postgres attachment but use separate connection search paths and migration histories. `LEAI_ENV=production` maps only to `public`; `LEAI_ENV=qa` maps only to `leai_qa`. Backend health, migrations, seed/reset, frontend identity, and the Pages workflow all fail closed unless the configured and active schema match the environment.

**Tech Stack:** Django 4.2, PostgreSQL schemas/search path, Heroku Release Phase and managed add-on attachments, static JavaScript, GitHub Actions, Node built-in tests, Python unittest, `uv`.

**Spec:** `LEAI/docs/superpowers/specs/2026-09-12-leai-qa-staging-environment-design.md`

## Global Constraints

- No additional Heroku Postgres add-on is provisioned for the internal pilot.
- Production remains in `public`; QA uses exactly `leai_qa`; the QA connection search path must not include `public`.
- Never copy or print `DATABASE_URL`. Attach the existing add-on through Heroku so credential rotation remains managed.
- QA and production share physical capacity, availability, backups, and owner credentials; do not describe this as physical isolation.
- QA migrations have a separate `django_migrations` table inside `leai_qa`.
- Every QA seed/reset path requires `LEAI_ENV=qa`, configured schema `leai_qa`, and active schema `leai_qa`.
- Production startup and verification require the effective schema `public`; local development defaults to `public`.
- Missing, malformed, or mismatched QA schema configuration fails closed and must not query application tables in `public`.
- The environment endpoint exposes only safe identity fields, adding `database_schema`; it never exposes database name, host, user, password, URL, or add-on credential.
- The frontend and Pages workflow require backend `database_schema=leai_qa` before enabling instructor mutations or deployment.
- No source folder moves, production migration/backfill, remote seed/reset, push, or deployment occurs in Tasks 1-2.
- Use TDD, focused commits, exact-path staging, independent review, aggregate verification, and clean worktrees.

---

### Task 1: Enforce and prepare the backend schema boundary

**Files:**
- Create: `datapipeline/database_schema.py`
- Create: `datapipeline/management/commands/prepare_leai_database.py`
- Modify: `guiidatapipelines/settings.py`
- Modify: `datapipeline/environment_views.py`
- Modify: `datapipeline/management/commands/verify_leai_environment.py`
- Modify: `datapipeline/management/commands/seed_leai_qa.py`
- Modify: `datapipeline/qa_seed.py`
- Modify: `Procfile`
- Modify: `datapipeline/tests/test_environment_configuration.py`
- Modify: `datapipeline/tests/test_qa_seed.py`
- Create: `datapipeline/tests/test_database_schema.py`

**Interfaces:**
- Produces setting: `LEAI_DB_SCHEMA`, effective values `public`, `leai_qa`, or empty/invalid.
- Produces: `expected_database_schema(environment) -> str | None`.
- Produces: `active_database_schema() -> str`, querying `SELECT current_schema()` and suppressing database exception details.
- Produces: `require_environment_database_schema(expected_environment) -> str`, rejecting configured or active mismatch without querying application tables.
- Produces command: `prepare_leai_database`, idempotently creating only `leai_qa` when `LEAI_ENV=qa` and `LEAI_DB_SCHEMA=leai_qa`; production/local perform no DDL and verify `public`.
- Extends safe environment JSON with `database_schema` only after active-schema verification.

- [ ] **Step 1: Write failing settings and schema-helper tests**

Add subprocess settings tests proving:

```python
qa = self.load_settings(
    LEAI_ENV='qa',
    LEAI_DB_SCHEMA='leai_qa',
    LEAI_BUILD_ID='abc1234',
    LEAI_EMAIL_ENABLED='false',
    LEAI_ALLOWED_HOSTS='qa-api.example',
    LEAI_ALLOWED_ORIGINS='https://qa.example',
    SECRET_KEY=STRONG_TEST_SECRET_KEY,
)
self.assertEqual(qa['database_schema'], 'leai_qa')
self.assertEqual(qa['database_options']['options'], '-c search_path=leai_qa')
```

Also prove QA missing/`public`/malformed schema yields a LEAI system-check error and a non-production fallback search path; production and local resolve to `public`; no QA option contains `,public` or whitespace-separated fallback schemas. Unit-test exact configured/active match, `None`, `public`, multi-schema, and secret-bearing database errors.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
UV_OFFLINE=1 UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run --with-requirements requirements.txt python manage.py test datapipeline.tests.test_environment_configuration datapipeline.tests.test_database_schema -v 2
```

Expected: failures because `LEAI_DB_SCHEMA`, schema checks, and helpers do not exist.

- [ ] **Step 3: Implement schema settings after Heroku database configuration**

After `django_heroku.settings(...)` has resolved `DATABASE_URL`, merge an exact PostgreSQL option into `DATABASES['default']['OPTIONS']`:

```python
_LEAI_EXPECTED_DB_SCHEMA = {
    'local': 'public',
    'qa': 'leai_qa',
    'production': 'public',
}
LEAI_DB_SCHEMA = os.environ.get(
    'LEAI_DB_SCHEMA',
    'public' if LEAI_ENV in {'local', 'production'} else '',
).strip()
_effective_search_path = (
    LEAI_DB_SCHEMA
    if LEAI_DB_SCHEMA == _LEAI_EXPECTED_DB_SCHEMA.get(LEAI_ENV)
    else 'pg_catalog'
)
DATABASES['default'].setdefault('OPTIONS', {})['options'] = (
    f'-c search_path={_effective_search_path}'
)
```

Add stable LEAI check IDs for configured-schema mismatch and database-option mismatch. Do not interpolate arbitrary schema names into connection options.

- [ ] **Step 4: Implement active-schema verification and safe identity**

`database_schema.py` maps environments to exact schemas, queries only `SELECT current_schema()`, and raises a generic domain error with suppressed database cause. `verify_leai_environment --json` and `/api/environment/` return:

```json
{"environment":"qa","build_id":"abc1234","email_enabled":false,"database_schema":"leai_qa"}
```

Return HTTP 503 with a generic safe error when database schema identity cannot be verified. Never include database connection properties.

- [ ] **Step 5: Guard seed/reset at both command and service boundaries**

Before reading instructor records or mutating fixtures, both `seed_leai_qa.Command.handle()` and `qa_seed._require_qa_environment()` call the schema guard. Tests prove `LEAI_ENV=qa` with active `public`, empty, or unavailable schema performs no model query or mutation.

- [ ] **Step 6: Add the idempotent release preparation command**

`prepare_leai_database` has `requires_system_checks = []`. It accepts no arbitrary schema argument. For exact QA configuration it executes only:

```sql
CREATE SCHEMA IF NOT EXISTS "leai_qa"
```

then verifies `current_schema()` is `leai_qa`. For production/local it creates nothing and verifies `public`. Invalid environment/configuration fails before SQL. Database errors are generic and suppress underlying credential text. Update `Procfile` to:

```procfile
release: python manage.py prepare_leai_database && python manage.py migrate && python manage.py verify_leai_environment --expect "$LEAI_ENV"
web: gunicorn guiidatapipelines.wsgi --log-file -
```

- [ ] **Step 7: Verify GREEN and aggregate backend behavior**

```bash
UV_OFFLINE=1 UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run --with-requirements requirements.txt python manage.py test datapipeline.tests.test_environment_configuration datapipeline.tests.test_database_schema datapipeline.tests.test_qa_seed -v 2
UV_OFFLINE=1 UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run --with-requirements requirements.txt python manage.py test -v 1
UV_OFFLINE=1 UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run --with-requirements requirements.txt python manage.py check
UV_OFFLINE=1 UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run --with-requirements requirements.txt python manage.py makemigrations --check --dry-run
git diff --check
```

- [ ] **Step 8: Commit backend schema enforcement**

```bash
git add Procfile guiidatapipelines/settings.py datapipeline/database_schema.py datapipeline/environment_views.py datapipeline/management/commands/prepare_leai_database.py datapipeline/management/commands/verify_leai_environment.py datapipeline/management/commands/seed_leai_qa.py datapipeline/qa_seed.py datapipeline/tests/test_environment_configuration.py datapipeline/tests/test_database_schema.py datapipeline/tests/test_qa_seed.py
git commit -m "Isolate LEAI QA in its database schema"
```

---

### Task 2: Require QA schema identity in the frontend and deployment workflow

**Files:**
- Modify: `LEAI/leai-environment.js`
- Modify: `LEAI/tests/leai-qa-banner.test.js`
- Modify: `.github/workflows/deploy-leai-qa.yml`
- Modify: `LEAI/tests/leai-qa-workflow.test.js`

**Interfaces:**
- Consumes backend safe identity: `database_schema: "leai_qa"`.
- Extends browser QA identity with `databaseSchema`.
- Keeps all instructor pages inert unless environment, email flag, build ID, and schema identity are valid.
- Blocks Pages target checkout unless backend reports exact `database_schema=leai_qa`.

- [ ] **Step 1: Write failing browser and workflow contract tests**

Add tests proving valid QA identity requires `database_schema: 'leai_qa'`; missing, `public`, mixed-case, or multi-schema values keep instructor UI inert. Assert the workflow checks the exact schema before the target-only `LEAI_QA_PAGES_DEPLOY_KEY` appears.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test LEAI/tests/leai-qa-banner.test.js LEAI/tests/leai-qa-workflow.test.js
```

- [ ] **Step 3: Implement exact schema attestation**

Extend `evaluateQaIdentity` and the visible QA marker with the safe schema name. Extend the workflow backend identity assertion and safe log object. Do not add a database URL, host, name, user, or add-on identifier to browser-visible configuration.

- [ ] **Step 4: Verify GREEN and aggregate frontend behavior**

```bash
node --test LEAI/tests/leai-qa-banner.test.js LEAI/tests/leai-qa-workflow.test.js
node --test LEAI/tests/*.test.js
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest discover -s LEAI/tests -p 'test_*.py' -v
actionlint .github/workflows/deploy-leai-qa.yml
git diff --check
```

- [ ] **Step 5: Commit frontend schema attestation**

```bash
git add LEAI/leai-environment.js LEAI/tests/leai-qa-banner.test.js .github/workflows/deploy-leai-qa.yml LEAI/tests/leai-qa-workflow.test.js
git commit -m "Require LEAI QA database schema identity"
```

---

### Task 3: Inventory and create the shared-schema remote environment

**Files:**
- Remote GitHub repository/environment and Heroku app/configuration only.
- No source change unless a verified remote name differs from the fixed public configuration.

**Interfaces:**
- Production app: `LEAI_ENV=production`, effective schema `public`.
- QA app: `LEAI_ENV=qa`, `LEAI_DB_SCHEMA=leai_qa`.
- QA database attachment: existing production add-on attached through Heroku as `DATABASE`; never copied manually.

- [ ] **Step 1: Restore authentication and perform read-only inventory**

Verify GitHub and Heroku identities. Record, without printing config values: exact production app, pipeline/stage, region, stack, dyno plan, Postgres add-on/plan, storage, table count, connection use, and existing attachments. Confirm the proposed QA app/repository names are available.

- [ ] **Step 2: Verify capacity and capture a backup**

Confirm the current plan has headroom for a second schema. Capture a production database backup before first schema creation. Backup success is required; do not continue on an uncertain result.

- [ ] **Step 3: Create QA app and managed attachment**

Create `guiidata-leai-qa`, attach the exact inventoried production add-on as `DATABASE`, and verify Heroku reports the same non-secret add-on identity on both apps. Never output either app's database URL.

- [ ] **Step 4: Configure exact environment variables**

Set QA environment/build/host/origin/email/schema values and QA-specific secrets. Set or verify production's effective `LEAI_DB_SCHEMA=public` without deploying or restarting production unless Heroku config mutation would trigger a restart; if it would, stop for explicit production-change approval.

- [ ] **Step 5: Create remote QA release branches and deploy backend first**

Create/reconcile non-force `qa` branches, deploy the backend, and require Release Phase success for prepare → migrate → verify. Then verify `/api/environment/` reports `qa` and `leai_qa` before allowing frontend deployment.

- [ ] **Step 6: Create Pages target and deploy frontend**

Create/configure `GUII-Lab/LEAI-QA`, the public QA API variable, and a write-enabled SSH deploy key limited to that repository. Store its private key only as `LEAI_QA_PAGES_DEPLOY_KEY` in the source repository's `qa` environment. Revoke it by removing the target deploy key and deleting the secret; rotate it by installing a replacement public key, replacing the secret, verifying deployment, and then removing the old public key. Push the accepted frontend `qa` branch and require workflow backend preflight plus Pages publication success.

---

### Task 4: Seed and verify the real QA schema without production mutation

**Files:**
- Generate local browser-verification report and screenshots only; do not commit them unless separately requested.

- [ ] **Step 1: Capture production read-only invariants**

Record production `public` migration state, selected row counts, and immutable Wizard checksums without response text.

- [ ] **Step 2: Seed QA with exact persisted-count verification**

Run the guarded QA seed against `leai_qa`, verify every deterministic identifier/count, and prove production `public` counts are unchanged.

- [ ] **Step 3: Run the real instructor/student/admin browser journey**

Use real gestures in Chromium and a second available engine. Verify account/course/profile/Wizard/preview/publication/student/analysis/audit flows, visible frontend/backend/schema identity, no production-host request, blank optional dates, and disabled email.

- [ ] **Step 4: Recheck production invariants and produce the report**

Compare before/after production counts/checksums, record accepted frontend/backend commits and active schema, and mark the environment ready only if every persisted count and network boundary passes.

---

## Self-review

- **Spec coverage:** Tasks 1-2 implement configured/active schema enforcement across backend, seed/reset, frontend, and CI. Tasks 3-4 replace the obsolete independent-add-on remote steps with managed attachment, backup, deployment, and real isolation verification.
- **Placeholder scan:** No TODO/TBD or unspecified error-handling steps remain.
- **Interface consistency:** Backend emits `database_schema`; frontend and workflow consume the same snake-case field. `LEAI_ENV=qa` maps to `leai_qa`; production/local map to `public`; no QA path accepts `public` as fallback.
- **Risk boundary:** Sharing owner credentials cannot provide physical isolation. The plan mitigates application accidents but does not protect against a malicious process or arbitrary SQL with owner privileges; the spec defines when to upgrade to an independent database.
