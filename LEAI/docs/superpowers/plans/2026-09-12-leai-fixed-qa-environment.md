# LEAI Fixed QA Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy one persistent LEAI QA website, backend, database, account set, and synthetic dataset that cannot read from or write to production.

**Architecture:** The frontend and backend repositories each gain one long-lived `qa` branch. Source paths remain unchanged; a GitHub Actions job copies the frontend repository's `LEAI/` directory into a temporary artifact and publishes it under `LEAI-QA/LEAI/`, while a separate Heroku app deploys the backend `qa` branch against a dedicated `leai_qa` schema on the existing Postgres add-on. Explicit runtime environment configuration, schema-aware health reporting, guarded seed/reset commands, and deployed browser checks prevent silent production fallback. The schema-boundary amendment is implemented by `LEAI/docs/superpowers/plans/2026-09-13-leai-shared-database-qa-schema.md` before this plan's remote Task 7.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript, Node built-in test runner, Python standard library, GitHub Actions and Pages, Django 4.2, PostgreSQL, Heroku Pipeline/Release Phase, `uv`, Playwright/web verification.

**Spec:** `LEAI/docs/superpowers/specs/2026-09-12-leai-qa-staging-environment-design.md`

## Global Constraints

- Use one fixed QA environment; do not create per-feature or per-PR deployments.
- Keep `LEAI/` at the same path in `main`, `qa`, and every feature branch. No source folder is moved, renamed, or exchanged during deployment or promotion.
- QA source promotion is a reviewed Git merge/cherry-pick of commits. Artifact copying occurs only inside a temporary Actions workspace and the dedicated `GUII-Lab/LEAI-QA` repository.
- QA and production use different Heroku apps, schemas, accounts, session tokens, audit rows, and deployment credentials. During the internal pilot they share one physical Postgres add-on.
- Production uses only `public`; QA uses only `leai_qa`. Each schema has its own tables and `django_migrations` history. The QA search path never includes `public`.
- Unknown frontend hosts and missing deployment configuration fail closed; they never fall back to the production API.
- Do not clone production data into QA. Do not send real email from QA.
- Do not change, migrate, backfill, deploy, or restart production while executing Tasks 1–7.
- Provisioning a billable Heroku dyno requires showing the current plan and price to Harvey immediately before creation. No additional Postgres plan is provisioned for the internal pilot.
- Use TDD, focused commits, exact-path staging, and real browser gestures. Preserve unrelated dirty-worktree changes.
- Work in `/private/tmp/leai-question-set-wizard/frontend` and `/private/tmp/leai-question-set-wizard/backend` until the explicit QA-branch task.

---

### Task 1: Add a fail-closed frontend environment contract

**Files:**
- Create: `LEAI/leai-deployment-config.js`
- Create: `LEAI/leai-environment.js`
- Modify: `LEAI/leai-shared.js:1-5`
- Modify: `LEAI/CourseBanner.html`
- Modify: `LEAI/Customizations.html`
- Modify: `LEAI/FeedbackAnalyzer.html`
- Modify: `LEAI/FeedbackChat.html`
- Modify: `LEAI/InstructorHome.html`
- Modify: `LEAI/PromptDesigner.html`
- Modify: `LEAI/feedback.html`
- Create: `LEAI/tests/leai-environment.test.js`
- Create: `LEAI/tests/leai-environment-loading.test.js`

**Interfaces:**
- Produces: `leaiEnvironment.resolveEnvironment(locationLike, deploymentOverride) -> EnvironmentConfig`.
- Produces: `leaiEnvironment.requireApiBase(config) -> string`, throwing `LEAI_UNKNOWN_ENVIRONMENT` for invalid/unknown configuration.
- Produces browser global: `window.LEAI_ENVIRONMENT` with `{name, apiBase, publicBaseUrl, buildId, emailEnabled, known}`.
- Consumes optional browser global: `window.LEAI_DEPLOYMENT_CONFIG`, generated only in a deployment artifact.
- Changes shared global: `API = leaiEnvironment.requireApiBase(window.LEAI_ENVIRONMENT)`.

- [ ] **Step 1: Write failing environment-resolution tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../leai-environment.js');

test('local, production, and explicit QA resolve without crossing environments', () => {
    assert.equal(env.resolveEnvironment(
        { hostname: 'localhost', origin: 'http://localhost:8080', pathname: '/LEAI/InstructorHome.html' },
        null,
    ).apiBase, 'http://localhost:8000/datapipeline/api');

    assert.equal(env.resolveEnvironment(
        { hostname: 'guii-lab.github.io', origin: 'https://guii-lab.github.io', pathname: '/LEAI/InstructorHome.html' },
        null,
    ).name, 'production');

    const qa = env.resolveEnvironment(
        { hostname: 'guii-lab.github.io', origin: 'https://guii-lab.github.io', pathname: '/LEAI-QA/LEAI/InstructorHome.html' },
        {
            environment: 'qa',
            apiBase: 'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api',
            publicBaseUrl: 'https://guii-lab.github.io/LEAI-QA/LEAI/',
            buildId: 'abc1234',
            emailEnabled: false,
        },
    );
    assert.equal(qa.name, 'qa');
    assert.equal(qa.publicBaseUrl, 'https://guii-lab.github.io/LEAI-QA/LEAI/');
});

test('unknown hosts fail instead of using production', () => {
    const unknown = env.resolveEnvironment(
        { hostname: 'example.test', origin: 'https://example.test', pathname: '/LEAI/' },
        null,
    );
    assert.equal(unknown.known, false);
    assert.throws(() => env.requireApiBase(unknown), /LEAI_UNKNOWN_ENVIRONMENT/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test LEAI/tests/leai-environment.test.js
```

Expected: module-not-found failure for `leai-environment.js`.

- [ ] **Step 3: Implement the UMD environment module**

Implement one pure resolver with exact host/path recognition:

```javascript
function normalizeBase(value) {
    return String(value || '').replace(/\/+$/, '') + '/';
}

function resolveEnvironment(locationLike, override) {
    if (override && override.environment === 'qa') {
        const valid = /^https:\/\//.test(override.apiBase || '')
            && /^https:\/\//.test(override.publicBaseUrl || '');
        return Object.freeze({
            name: 'qa',
            apiBase: valid ? String(override.apiBase).replace(/\/$/, '') : '',
            publicBaseUrl: valid ? normalizeBase(override.publicBaseUrl) : '',
            buildId: String(override.buildId || ''),
            emailEnabled: override.emailEnabled === true,
            known: valid,
        });
    }
    if (locationLike.hostname === 'localhost' || locationLike.hostname === '127.0.0.1') {
        return Object.freeze({
            name: 'local',
            apiBase: 'http://localhost:8000/datapipeline/api',
            publicBaseUrl: normalizeBase(locationLike.origin + '/LEAI/'),
            buildId: 'local', emailEnabled: false, known: true,
        });
    }
    if (locationLike.hostname === 'guii-lab.github.io'
            && /^\/LEAI(?:\/|$)/.test(locationLike.pathname || '')) {
        return Object.freeze({
            name: 'production',
            apiBase: 'https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api',
            publicBaseUrl: 'https://guii-lab.github.io/LEAI/',
            buildId: '', emailEnabled: false, known: true,
        });
    }
    return Object.freeze({
        name: 'unknown', apiBase: '', publicBaseUrl: '', buildId: '',
        emailEnabled: false, known: false,
    });
}
```

Export for Node and assign `window.LEAI_ENVIRONMENT` in browsers. Keep `leai-deployment-config.js` to one safe default assignment: `window.LEAI_DEPLOYMENT_CONFIG = null;`.

- [ ] **Step 4: Add script-loading contract tests**

For every HTML page that loads `leai-shared.js`, assert this order:

```html
<script src="leai-deployment-config.js"></script>
<script src="leai-environment.js"></script>
<script src="leai-shared.js"></script>
```

Allow existing cache-busting query strings. Assert no page defines its own API base.

- [ ] **Step 5: Implement the script order and shared API binding**

Add the two scripts immediately before `leai-shared.js` on the seven listed pages. Replace the hostname ternary at the top of `leai-shared.js` with:

```javascript
const API = leaiEnvironment.requireApiBase(window.LEAI_ENVIRONMENT);
```

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
node --test LEAI/tests/leai-environment.test.js LEAI/tests/leai-environment-loading.test.js
```

- [ ] **Step 7: Commit the frontend environment contract**

```bash
git add LEAI/leai-deployment-config.js LEAI/leai-environment.js LEAI/leai-shared.js LEAI/CourseBanner.html LEAI/Customizations.html LEAI/FeedbackAnalyzer.html LEAI/FeedbackChat.html LEAI/InstructorHome.html LEAI/PromptDesigner.html LEAI/feedback.html LEAI/tests/leai-environment.test.js LEAI/tests/leai-environment-loading.test.js
git commit -m "Add explicit LEAI environment routing"
```

---

### Task 2: Make every generated student link environment-aware

**Files:**
- Modify: `LEAI/leai-environment.js`
- Modify: `LEAI/feedback.html:4008-4035`
- Modify: `LEAI/leai-formmode.js:971-1080,1273-1370`
- Modify: `LEAI/leai-shared.css`
- Modify: `LEAI/tests/leai-environment.test.js`
- Modify: `LEAI/tests/leai-formmode-fields.test.js`
- Create: `LEAI/tests/leai-qa-banner.test.js`

**Interfaces:**
- Produces: `leaiEnvironment.publicUrl(config, relativePath, query, hash) -> string`.
- Consumes in Form Mode: `opts.publicBaseUrl`.
- Preserves production link shape: `https://guii-lab.github.io/LEAI/feedback.html?id=...#cid=...`.

- [ ] **Step 1: Write failing public-link and renderer tests**

```javascript
assert.equal(
    env.publicUrl(qa, 'feedback.html', { id: 'survey 1' }, 'cid=session 1'),
    'https://guii-lab.github.io/LEAI-QA/LEAI/feedback.html?id=survey+1#cid=session%201',
);

const output = leaiFormMode.renderStructuredMarkdown(state, transcript, {
    publicId: 'qa-survey', sessionId: 'qa-session',
    publicBaseUrl: 'https://guii-lab.github.io/LEAI-QA/LEAI/',
});
assert.match(output, /LEAI-QA\/LEAI\/feedback\.html\?id=qa-survey#cid=qa-session/);
assert.doesNotMatch(output, /guii-lab\.github\.io\/LEAI\/feedback/);
```

Test Markdown, HTML, and DOCX link targets.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test LEAI/tests/leai-environment.test.js LEAI/tests/leai-formmode-fields.test.js
```

Expected: missing `publicUrl` and production URL still present.

- [ ] **Step 3: Implement shared URL construction and renderer input**

Use `URL` and `URLSearchParams`; reject absolute `relativePath` inputs. In `_buildFormModeBlob`, pass `window.LEAI_ENVIRONMENT.publicBaseUrl`. In all three renderers, construct the conversation URL from `opts.publicBaseUrl`; do not retain a production fallback.

- [ ] **Step 4: Add and test the QA environment marker**

On `DOMContentLoaded`, the environment module injects one non-dismissible `<div class="leai-environment-banner" role="status">QA environment · test data only</div>` when `name === 'qa'`. Add shared styling that stays visible above instructor content without covering mobile controls. Do not render it in production.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
node --test LEAI/tests/leai-environment.test.js LEAI/tests/leai-formmode-fields.test.js LEAI/tests/leai-qa-banner.test.js
```

- [ ] **Step 6: Commit environment-safe links and marker**

```bash
git add LEAI/leai-environment.js LEAI/feedback.html LEAI/leai-formmode.js LEAI/leai-shared.css LEAI/tests/leai-environment.test.js LEAI/tests/leai-formmode-fields.test.js LEAI/tests/leai-qa-banner.test.js
git commit -m "Keep QA links inside the QA site"
```

---

### Task 3: Add backend environment identity and deployment verification

**Files:**
- Modify: `/private/tmp/leai-question-set-wizard/backend/guiidatapipelines/settings.py`
- Modify: `/private/tmp/leai-question-set-wizard/backend/datapipeline/urls.py`
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/environment_views.py`
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/management/commands/verify_leai_environment.py`
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/tests/test_environment_configuration.py`

**Interfaces:**
- Produces setting: `LEAI_ENV` in `{local, qa, production}`.
- Produces setting: `LEAI_BUILD_ID` as a non-secret deployment identifier.
- Produces endpoint: `GET /datapipeline/api/environment/` returning `{environment, build_id, email_enabled}`.
- Produces command: `python manage.py verify_leai_environment --expect qa --json`.

- [ ] **Step 1: Write failing settings, endpoint, and command tests**

```python
@override_settings(LEAI_ENV='qa', LEAI_BUILD_ID='abc1234', LEAI_EMAIL_ENABLED=False)
def test_environment_endpoint_reports_only_safe_identity(self):
    response = self.client.get('/datapipeline/api/environment/')
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json(), {
        'environment': 'qa', 'build_id': 'abc1234', 'email_enabled': False,
    })
    self.assertNotContains(response, 'DATABASE_URL')

def test_verify_command_rejects_environment_mismatch(self):
    with override_settings(LEAI_ENV='production'):
        with self.assertRaises(CommandError):
            call_command('verify_leai_environment', expect='qa')
```

Also test that QA CORS/CSRF origins come only from `LEAI_ALLOWED_ORIGINS` and that malformed or missing origins fail Django system checks outside local development.

- [ ] **Step 2: Run the focused backend test and verify RED**

```bash
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py test datapipeline.tests.test_environment_configuration --verbosity 2
```

- [ ] **Step 3: Implement environment-aware settings**

Read `LEAI_ENV`, `LEAI_BUILD_ID`, `LEAI_EMAIL_ENABLED`, `LEAI_ALLOWED_HOSTS`, and comma-separated `LEAI_ALLOWED_ORIGINS` from environment variables. Local defaults remain usable. QA and production require explicit host/origin values and set `CORS_ALLOW_ALL_ORIGINS=False`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` from the parsed list.

Do not expose database URLs, secret keys, provider keys, or add-on identifiers through the public endpoint.

- [ ] **Step 4: Implement the identity endpoint and verification command**

The endpoint allows `GET` only. The command exits nonzero when `settings.LEAI_ENV != --expect`, prints the safe JSON identity when requested, runs Django deployment checks, and performs `SELECT 1` through the configured default connection.

- [ ] **Step 5: Run focused tests and system checks**

```bash
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py test datapipeline.tests.test_environment_configuration --verbosity 2
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py check
```

- [ ] **Step 6: Commit backend environment identity**

```bash
git add guiidatapipelines/settings.py datapipeline/urls.py datapipeline/environment_views.py datapipeline/management/commands/verify_leai_environment.py datapipeline/tests/test_environment_configuration.py
git commit -m "Add explicit LEAI backend environment identity"
```

---

### Task 4: Add deterministic QA seed and guarded reset tooling

**Files:**
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/qa_seed.py`
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/management/commands/seed_leai_qa.py`
- Create: `/private/tmp/leai-question-set-wizard/backend/datapipeline/tests/test_qa_seed.py`

**Interfaces:**
- Produces: `QA_SEED_VERSION = '2026-09-12.1'`.
- Produces: `seed_qa_data(reset: bool) -> dict[str, int]` inside one transaction.
- Produces command: `python manage.py seed_leai_qa [--reset --confirm qa] --json`.
- Owns only records with deterministic `qa-` public/course identifiers and `qa.invalid` email domains.

- [ ] **Step 1: Write failing command safety and idempotency tests**

```python
def test_seed_refuses_non_qa_environment(self):
    with override_settings(LEAI_ENV='production'):
        with self.assertRaises(CommandError):
            call_command('seed_leai_qa')

@override_settings(LEAI_ENV='qa')
def test_seed_is_idempotent_and_reports_exact_counts(self):
    first = seed_qa_data(reset=False)
    second = seed_qa_data(reset=False)
    self.assertEqual(first, second)
    self.assertEqual(InstructorAccount.objects.filter(email__endswith='@qa.invalid').count(), 2)
    self.assertEqual(Course.objects.filter(course_id__startswith='qa-').count(), 3)

@override_settings(LEAI_ENV='qa')
def test_reset_requires_exact_confirmation(self):
    with self.assertRaises(CommandError):
        call_command('seed_leai_qa', reset=True, confirm='production')
```

Also assert seed results include draft/published surveys, anonymous response sessions/messages, and audit events; assert unrelated rows survive reset.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py test datapipeline.tests.test_qa_seed --verbosity 2
```

- [ ] **Step 3: Implement the bounded seed module**

Use stable identifiers and `update_or_create` for one `qa-ucsc` institution, two instructors, three courses (upcoming/active/completed), one editable draft, one immutable published revision/survey, anonymous completed responses, one analysis example, and representative instructor audit events. Generate instructor passwords from required command arguments or interactively; never define passwords in source.

`reset=True` deletes only the deterministic QA-owned graph in dependency order, inside `transaction.atomic()`, after confirming `settings.LEAI_ENV == 'qa'` and `confirm == 'qa'`. It must not use an unscoped table-wide `.delete()`.

- [ ] **Step 4: Implement exact persisted-count reporting**

After commit, re-query each model and return the persisted counts. Command success requires all expected counts, not merely successful create/update calls.

- [ ] **Step 5: Run focused and full backend suites**

```bash
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py test datapipeline.tests.test_qa_seed --verbosity 2
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py test --verbosity 1
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py makemigrations --check --dry-run
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python manage.py migrate --plan
```

- [ ] **Step 6: Commit QA seed tooling**

```bash
git add datapipeline/qa_seed.py datapipeline/management/commands/seed_leai_qa.py datapipeline/tests/test_qa_seed.py
git commit -m "Add guarded LEAI QA seed data"
```

---

### Task 5: Build a path-preserving QA Pages artifact

**Files:**
- Create: `scripts/build-leai-qa-artifact.py`
- Create: `LEAI/tests/test_build_leai_qa_artifact.py`

**Interfaces:**
- Command: `uv run python scripts/build-leai-qa-artifact.py --source . --output /private/tmp/leai-qa-artifact-plan --api-base https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api --build-id local-plan-test`.
- Produces: `/private/tmp/leai-qa-artifact-plan/LEAI/` with the source directory structure unchanged in the documented local example.
- Produces: `/private/tmp/leai-qa-artifact-plan/index.html` redirecting to `LEAI/InstructorHome.html`.
- Produces: artifact-only `/private/tmp/leai-qa-artifact-plan/LEAI/leai-deployment-config.js` with QA values.
- Never modifies or deletes the source `LEAI/` directory.

- [ ] **Step 1: Write failing artifact tests using a temporary directory**

```python
def test_artifact_preserves_leai_folder_and_does_not_mutate_source(self):
    before = sha256((SOURCE / 'LEAI' / 'leai-deployment-config.js').read_bytes()).hexdigest()
    build_artifact(SOURCE, output, 'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api', 'abc1234')
    self.assertTrue((output / 'LEAI' / 'InstructorHome.html').exists())
    self.assertIn('/LEAI-QA/LEAI/', (output / 'LEAI' / 'leai-deployment-config.js').read_text())
    self.assertEqual(before, sha256((SOURCE / 'LEAI' / 'leai-deployment-config.js').read_bytes()).hexdigest())
```

Also assert the command rejects `/`, the source root, an output inside `LEAI/`, a non-HTTPS API base, and an empty build ID.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest LEAI.tests.test_build_leai_qa_artifact -v
```

- [ ] **Step 3: Implement guarded artifact construction**

Use `pathlib`, `tempfile`, `shutil.copytree`, and `json.dumps`. Resolve and validate source/output paths before creating output. Copy `LEAI/` to `output/LEAI/`; do not flatten it. Write the QA deployment config only after copying. Generate a minimal accessible root page with a normal link and immediate same-origin redirect to `LEAI/InstructorHome.html`.

- [ ] **Step 4: Run focused test and inspect a real artifact**

```bash
QA_ARTIFACT_DIR=$(mktemp -d /private/tmp/leai-qa-artifact.XXXXXX)
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python scripts/build-leai-qa-artifact.py --source . --output "$QA_ARTIFACT_DIR" --api-base https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api --build-id local-plan-test
find "$QA_ARTIFACT_DIR" -maxdepth 2 -type f | sort | head -40
```

Expected: `index.html` and unchanged `LEAI/...` relative structure; no `SCAI/` artifact.

- [ ] **Step 5: Commit artifact builder**

```bash
git add scripts/build-leai-qa-artifact.py LEAI/tests/test_build_leai_qa_artifact.py
git commit -m "Build path-preserving LEAI QA artifacts"
```

---

### Task 6: Add the fixed QA deployment workflow

**Files:**
- Create: `.github/workflows/deploy-leai-qa.yml`
- Create: `LEAI/tests/leai-qa-workflow.test.js`

**Interfaces:**
- Trigger: push to `qa` and manual `workflow_dispatch`.
- Consumes GitHub environment variable: `LEAI_QA_API_BASE`.
- Consumes GitHub `qa` environment secret: `LEAI_QA_PAGES_DEPLOY_KEY`, the private half of an SSH deploy key whose public half has write access only to `GUII-Lab/LEAI-QA`.
- Publishes target: `GUII-Lab/LEAI-QA`, branch `main`, root Pages source.

- [ ] **Step 1: Write failing workflow contract tests**

Read YAML as text and assert exact trigger branch, `environment: qa`, source and target checkouts in separate paths, full frontend tests before artifact build, the path-preserving builder command, target `GUII-Lab/LEAI-QA`, and no production hostname/API literal in the generated QA command.

- [ ] **Step 2: Run the workflow test and verify RED**

```bash
node --test LEAI/tests/leai-qa-workflow.test.js
```

- [ ] **Step 3: Implement the workflow**

Use `actions/checkout` for the source and target repositories in separate directories. Run:

```bash
node --test LEAI/tests/*.test.js
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest discover -s LEAI/tests -p 'test_*.py' -v
uv run python scripts/build-leai-qa-artifact.py --source . --output "$RUNNER_TEMP/leai-qa" --api-base "${{ vars.LEAI_QA_API_BASE }}" --build-id "${{ github.sha }}"
```

Synchronize the temporary artifact into the target checkout while preserving `.git`, verify `LEAI/InstructorHome.html` and the QA deployment config, commit only if the artifact changed, and push target `main`. Set workflow concurrency to `leai-qa-pages` with `cancel-in-progress: true`.

- [ ] **Step 4: Run workflow and aggregate frontend tests locally**

```bash
node --test LEAI/tests/leai-qa-workflow.test.js
node --test LEAI/tests/*.test.js
UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest discover -s LEAI/tests -p 'test_*.py' -v
git diff --check
```

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/deploy-leai-qa.yml LEAI/tests/leai-qa-workflow.test.js
git commit -m "Deploy one fixed LEAI QA site"
```

---

### Task 7: Create the two QA branches and remote infrastructure

> **Amendment (2026-09-13):** Complete `2026-09-13-leai-shared-database-qa-schema.md` first. References below to an independent QA Postgres add-on are superseded by a managed attachment of the existing add-on plus the dedicated `leai_qa` schema. Never run the obsolete `addons:create` command in Step 4.

**Files:**
- No source files unless the Heroku app name requires updating an already-tested public configuration assertion.
- Remote GitHub repository: `GUII-Lab/LEAI-QA`.
- Remote GitHub environments: `qa` in both source repositories.
- Remote Heroku app: `guiidata-leai-qa`.
- Remote Heroku Postgres: the existing add-on attached through Heroku to `guiidata-leai-qa`, with QA restricted to `leai_qa`.

**Interfaces:**
- Frontend QA branch points to the accepted frontend release commit.
- Backend QA branch points to the accepted backend release commit.
- Heroku Release Phase remains `python manage.py migrate` from the existing `Procfile`.

- [ ] **Step 1: Reauthenticate and perform read-only inventory**

```bash
gh auth login -h github.com
heroku login
gh repo view GUII-Lab/GUII-Lab.github.io
gh repo view GUII-Lab/guiidatapipelines
heroku apps:info -a guiidata-b6c968e6ed85
heroku pipelines
heroku addons -a guiidata-b6c968e6ed85
```

Record app generation, pipeline membership, region, stack, current dyno plan, and Postgres plan without printing config values.

- [ ] **Step 2: Confirm shared-database headroom and compute cost**

Inspect the current Postgres plan, storage, table count, and connection use without printing credentials. Confirm there is headroom for a second schema. Show Harvey the least-cost dyno plan that supports the QA workload; no additional database is purchased.

- [ ] **Step 3: Create the target Pages repository and QA deployment environment**

```bash
gh repo create GUII-Lab/LEAI-QA --public --description "Persistent QA deployment for LEAI"
```

Initialize `main`, enable Pages from `main` `/ (root)`, create the source repository environment `qa`, and set public variable `LEAI_QA_API_BASE=https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api`. Install an SSH deploy public key with write access only on `GUII-Lab/LEAI-QA`, and store its private key only as the source repository's `qa` environment secret `LEAI_QA_PAGES_DEPLOY_KEY`; do not print either key. Revoke access by removing that target-repository deploy key and deleting the environment secret. Rotate it by installing a replacement public key, replacing the secret, verifying deployment, and then removing the old public key. Do not create either key until the independently reviewed remote-infrastructure task.

- [ ] **Step 4: Create the QA Heroku app and attach the existing database**

```bash
heroku create guiidata-leai-qa
heroku addons:attach guiidata-b6c968e6ed85::DATABASE --app guiidata-leai-qa --as DATABASE
```

Resolve and verify the exact production add-on attachment name in Step 1 before using the command; do not invent it or copy its URL. Set `LEAI_ENV=qa`, `LEAI_DB_SCHEMA=leai_qa`, `LEAI_BUILD_ID`, `LEAI_EMAIL_ENABLED=false`, `LEAI_ALLOWED_HOSTS=guiidata-leai-qa-f30daf4812c3.herokuapp.com`, `LEAI_ALLOWED_ORIGINS=https://guii-lab.github.io`, and QA-specific Django/provider secrets through Heroku config without displaying their values. Production remains `LEAI_ENV=production` and `LEAI_DB_SCHEMA=public`. Confirm both apps report the same non-secret add-on identity but different configured and active schemas.

- [ ] **Step 5: Create one logical QA release line across the two repositories**

In the frontend worktree:

```bash
git branch qa feat/leai-question-set-wizard
git push -u origin qa
```

In the backend worktree:

```bash
git branch qa feat/leai-question-set-wizard
git push -u origin qa
```

If either remote branch already exists, inspect and reconcile it; do not force-push.

- [ ] **Step 6: Connect backend `qa` to the Heroku staging app**

In Heroku Dashboard, place `guiidata-leai-qa` in the staging stage of the production app's existing Pipeline when compatible. Connect `GUII-Lab/guiidatapipelines`, select branch `qa`, enable automatic deploy only after CI passes, and leave production auto-deploy settings unchanged.

- [ ] **Step 7: Verify remote isolation before seeding**

```bash
heroku run python manage.py verify_leai_environment --expect qa --json -a guiidata-leai-qa
heroku run python manage.py showmigrations datapipeline -a guiidata-leai-qa
curl --fail https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api/environment/
```

Expected: environment `qa`, configured and active schema `leai_qa`, QA build ID, email disabled, all required migrations applied in the QA schema, and no production hostname in responses.

---

### Task 8: Seed, deploy, and verify the complete real QA journey

**Files:**
- Create locally: `scripts/build-verify-report-leai-qa.py`
- Create locally: `verification-report-leai-qa-2026-09-12.html`
- Store screenshots under: `.web-verify/screenshots/leai-qa/`
- Do not commit report/screenshots unless separately requested.

**Interfaces:**
- QA frontend: `https://guii-lab.github.io/LEAI-QA/LEAI/InstructorHome.html`.
- QA backend: `https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api/`.
- QA admin: `https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/admin/`.

- [ ] **Step 1: Seed QA and verify every persisted count**

```bash
heroku run python manage.py seed_leai_qa --reset --confirm qa --json -a guiidata-leai-qa
heroku run python manage.py verify_leai_environment --expect qa --json -a guiidata-leai-qa
```

Compare returned counts to the seed contract and query all expected deterministic identifiers. HTTP/process success without matching persisted counts is failure.

- [ ] **Step 2: Capture production read-only invariants**

Record production migration state, selected model row counts, and immutable Wizard-related checksums without exporting student response text. This is a before/after invariant, not permission to alter production.

- [ ] **Step 3: Verify the QA frontend artifact and network boundary**

Open the real QA URL with Chromium. Confirm the visible QA banner and build ID. Inspect browser network requests while signing in and assert every API request uses `guiidata-leai-qa-f30daf4812c3.herokuapp.com`; fail immediately on any request to `guiidata-b6c968e6ed85.herokuapp.com`.

- [ ] **Step 4: Exercise the instructor journey with real gestures**

Using a manually delivered QA instructor credential:

1. sign in and complete required password change if presented;
2. create a new QA course;
3. switch away and back through Instructor Home;
4. update display name and password;
5. create/edit/save/freeze a Question Set;
6. complete the exact student preview in its new tab;
7. publish with blank opening and closing dates;
8. copy the generated QA student link;
9. confirm corresponding audit events in QA Django Admin.

- [ ] **Step 5: Exercise the anonymous student and analysis journey**

Open the generated link in a clean browser context, submit every authored question and closing response, then verify the completed response appears in QA analysis. Confirm preview data remains excluded and no QA identifier exists in production.

- [ ] **Step 6: Repeat browser acceptance in a second engine**

Repeat critical login, course selection, Wizard preview tab, publication, and student submission in WebKit or Firefox. Use actual clicks, typing, and tab behavior rather than script-dispatched events.

- [ ] **Step 7: Verify production remained unchanged**

Re-run the production read-only invariant capture and compare it to Step 2. Any row-count/checksum change attributable to QA testing blocks completion.

- [ ] **Step 8: Generate the scoped HTML verification report**

Include environment identities, commit hashes, sanitized network-host evidence, migration state, seed counts, browser engines, screenshots, audit evidence, and production invariant comparison. Do not include passwords, raw tokens, provider keys, database URLs, or student free text.

- [ ] **Step 9: Commit only reusable verification automation**

After report review, commit the scoped report builder only if it is reusable and requested. Keep generated report/screenshots local and gitignored.

---

## Plan self-review

- **Spec coverage:** Tasks 1–2 cover explicit frontend routing, QA visibility, and environment-safe links; Tasks 3–4 cover backend identity, account/data isolation, and deterministic parity; Tasks 5–6 cover path-preserving Pages deployment; Tasks 7–8 cover remote infrastructure, migration order, real-flow verification, and production invariants.
- **Path consistency:** Source remains `LEAI/` everywhere. Only the temporary artifact adds the hosting repository prefix, producing `/LEAI-QA/LEAI/` without moving source files.
- **Type/interface consistency:** `EnvironmentConfig.publicBaseUrl` is produced in Task 1, consumed by Task 2 and generated by Task 5. Backend `LEAI_ENV` is produced in Task 3, required by Task 4, configured in Task 7, and verified in Task 8.
- **Deferred scope:** Per-feature previews, production release, production backfill/cleanup, email delivery, Canvas, and reminders remain excluded.
