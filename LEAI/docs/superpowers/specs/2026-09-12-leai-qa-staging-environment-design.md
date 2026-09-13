# LEAI Fixed QA/Staging Environment Design

**Status:** Approved in chat on 2026-09-12 for specification and planning

**Scope:** One persistent QA environment for LEAI, not one preview environment per feature

**Repositories:** `GUII-Lab/GUII-Lab.github.io` and `GUII-Lab/guiidatapipelines`

## 1. Decision

LEAI will have one long-lived QA environment whose frontend, backend, accounts, data, audit events, and deployment credentials are isolated from production. The QA frontend may be publicly downloadable like the existing static site, but all instructor operations require QA credentials and can reach only the QA backend. The environment does not use production student or instructor data.

GitHub Pages supports one Pages site per repository. The existing organization site therefore remains the production target, while a separate project repository hosts the QA Pages site. A GitHub Actions workflow in the source repository publishes the approved QA branch to that target repository. Heroku hosts a separate QA Django app with its own Postgres add-on.

Per-branch preview URLs, Heroku Review Apps, Canvas integration, reminders, and email verification are outside this design.

## 2. Goals

- Give Harvey and invited instructors one stable URL for testing LEAI before production release.
- Keep QA and production databases physically separate; neither environment may attach or share the other's `DATABASE_URL`.
- Keep local development and remote QA behavior comparable through the same migrations and deterministic synthetic seed dataset.
- Rehearse schema migrations, instructor self-service, the Question Set Wizard, student completion, analysis, and audit logging without changing production.
- Make the active environment obvious in the interface and observable in deployment logs.
- Preserve the existing production GitHub Pages source and production Heroku app until a separate release is explicitly approved.

## 3. Non-goals

- A unique deployment for every feature branch or pull request.
- Automatic promotion from QA to production.
- Copying the production database into QA.
- Sending real verification, reminder, or digest email from QA.
- Making the static HTML itself secret. GitHub Pages is public hosting; application access is enforced by QA instructor authentication.
- Canvas or other LMS integration.
- Destructive production backfill or cleanup migrations.

## 4. Environment topology

| Concern | Local development | QA | Production |
| --- | --- | --- | --- |
| Frontend source | Current working branch/worktree | Long-lived `qa` branch | `main` |
| Frontend host | `localhost` | Separate `GUII-Lab/LEAI-QA` Pages repository | Existing `GUII-Lab.github.io` Pages site |
| Backend source | Matching local backend branch | Long-lived `qa` branch in backend repository | `main` |
| Backend host | Local Django server | New Heroku QA app | Existing Heroku production app |
| Database | Local Postgres | New, independently provisioned Heroku Postgres | Existing production Postgres |
| Accounts | Synthetic/local | QA-only instructor/admin accounts | Production accounts |
| Data | Deterministic QA seed plus local edits | Same seed version plus QA testing edits | Real course data |
| Email | Disabled/console | Disabled | Separately enabled when production email is approved |
| UI marker | `LOCAL` | Persistent `QA` banner | No test banner |

Because the frontend and backend live in separate repositories, the single logical QA release line requires one `qa` branch in each repository. Their accepted commit hashes are recorded together for each QA release.

## 5. Frontend deployment

### 5.1 Hosting

Create an organization-owned project repository named `LEAI-QA` and enable GitHub Pages for it. The expected stable URL is:

`https://guii-lab.github.io/LEAI-QA/`

The source repository remains `GUII-Lab/GUII-Lab.github.io`. A workflow triggered by pushes to its `qa` branch publishes only the LEAI static artifact to the `LEAI-QA` repository. Production Pages configuration remains unchanged.

Cross-repository deployment uses a fine-grained credential limited to content write access on the target QA repository. Store it in a GitHub Actions environment named `qa`; do not reuse a broad personal token when a narrower deploy credential is available.

### 5.2 Runtime environment configuration

The current frontend treats every non-local hostname as production. Replace that two-way choice with an explicit public runtime configuration loaded before `leai-shared.js`:

- `environment`: `local`, `qa`, or `production`
- `apiBase`: the matching backend base URL
- `buildId`: the deployed source commit
- `emailEnabled`: `false` for the first QA release

The QA deployment workflow generates or selects the QA configuration. Production retains its production API base. API URLs are public configuration, not secrets.

Unknown environments fail closed: instructor mutation and publication controls remain unavailable if a valid API base and environment identifier are not present. They must never silently fall back to production.

### 5.3 Environment visibility

Every QA instructor page displays a persistent `QA environment` marker. The account menu or footer exposes the frontend build ID and backend environment identifier so screenshots and bug reports can be attributed to a precise release.

## 6. Backend and database

### 6.1 Heroku application

Create a new Heroku app dedicated to QA, provision a new Postgres add-on, and add the app to the staging stage of the same Heroku Pipeline as production when the current account and app generation permit it. The production app remains in the production stage.

Minimum QA configuration includes:

- `LEAI_ENV=qa`
- QA-specific `DATABASE_URL` supplied by its own add-on
- QA-specific Django secret and allowed hosts
- QA frontend origin in the CORS/CSRF allowlist
- `LEAI_EMAIL_ENABLED=false`
- provider credentials scoped for QA where available
- the deployed frontend/backend build identifiers

Production credentials, database URLs, and instructor passwords are never copied into GitHub or the QA seed.

### 6.2 Isolation checks

Deployment verification records non-secret database/add-on identifiers for QA and production and fails if they match. It also confirms:

- the QA frontend calls only the QA API;
- the QA API reports `qa` from a health/environment endpoint;
- the production API reports `production`;
- a QA instructor cannot authenticate against production;
- a production instructor cannot authenticate against QA unless a separate QA account was intentionally created;
- QA activity appears only in the QA audit log.

The QA database must never be a follower, attachment, or shared credential for the production database.

## 7. QA accounts and authentication

QA uses manually provisioned instructor and administrator accounts for the first release. Their email addresses are test identities and are not treated as verified. No email delivery is required.

Before the public QA URL is considered usable, instructor login/session APIs and authorization of instructor mutation endpoints must be functionally verified. Static page visibility is not the security boundary; authenticated backend access is.

QA credentials are delivered manually and stored only in the appropriate password manager or secure channel. Passwords and reusable session tokens are not committed to fixtures, reports, or browser screenshots.

## 8. Local and QA data parity

"Same as local" means the same schema, migration set, and versioned synthetic seed—not one shared database.

The backend repository owns a deterministic, idempotent QA seed command that creates only synthetic records, including:

- one QA institution;
- at least two QA instructors with distinct ownership boundaries;
- representative active, upcoming, and completed courses;
- draft and published structured-reflection surveys;
- anonymous synthetic response sessions and messages;
- analysis and audit-log examples needed for UI verification.

Local and QA environments record the seed version. They may diverge after testing. A manual reset command restores QA to the seed state, but it runs only when both `LEAI_ENV=qa` and an explicit reset confirmation are present. It must refuse to run in production.

Production exports are not seed input. If production-shaped migration rehearsal later needs realistic distributions, use a separately approved scrubbed snapshot with direct identifiers and free-text student responses removed or replaced.

## 9. Schema migration and deployment sequence

The QA backend deploys before the QA frontend when an API or schema contract changes:

1. Run backend tests and migration consistency checks locally.
2. Back up the current QA database when it contains test evidence worth retaining.
3. Deploy the accepted backend QA commit.
4. Run additive migrations in Heroku Release Phase or an explicitly monitored release command.
5. Verify migration state, QA health, environment identity, and required endpoint compatibility.
6. Run or update the deterministic seed only when the release requires it.
7. Deploy the matching frontend QA commit.
8. Run end-to-end QA acceptance tests and record both commit hashes.

Production migration remains a separate approval gate. Passing QA does not authorize a production migration, merge, push, or deploy.

Migrations needed for the Wizard remain additive and rollback-compatible at the code level. Destructive cleanup and ambiguous historical backfill are excluded from the QA environment setup and require their own later decision.

## 10. QA release workflow

1. Implement and verify a feature in isolated local worktrees.
2. Select matching frontend and backend commits for the fixed QA release.
3. Update the two `qa` branches only after focused and aggregate tests pass.
4. GitHub and Heroku deploy to the fixed QA URLs.
5. Harvey and independent reviewers exercise the real instructor and student flows.
6. Bugs are fixed on feature branches and then deliberately advanced to QA.
7. After acceptance, create a separate production release decision and merge only the accepted commits to `main`.

There is no automatic production promotion. The QA branch can contain work that remains unreleased.

## 11. Failure handling and rollback

- Frontend deployment failure leaves the last successful QA Pages artifact active.
- Backend health-check failure blocks frontend deployment.
- A migration failure blocks the Heroku release before the new application version becomes active where Release Phase behavior permits.
- Application rollback uses Heroku release rollback or redeployment of the last accepted backend commit; schema rollback is not performed destructively.
- QA seed/reset failure leaves the environment marked unhealthy until row-count and fixture integrity checks pass.
- Production is not used as a fallback for any QA failure.

## 12. Verification and acceptance criteria

The environment is ready only when all of the following pass against the real deployed URLs:

- QA and production frontend URLs both remain available and visibly distinct.
- QA and production API and database identifiers are distinct.
- Browser network inspection shows no QA request to the production Heroku hostname.
- QA account login succeeds only in QA and protects instructor mutation endpoints.
- Instructor course creation, course switching, profile settings, Question Set Wizard, exact student preview, survey publication, and link retrieval work in QA.
- A synthetic student can complete a published QA survey; the response appears in QA analysis and nowhere in production.
- Instructor and administrator actions appear in the QA audit log with the correct actor and course.
- Blank opening and closing dates remain blank; the Wizard does not introduce a silent 14-day expiration.
- QA email delivery remains disabled.
- The QA seed produces the expected record counts locally and remotely.
- Full frontend and backend suites pass, followed by real Chromium and WebKit/Firefox user-gesture verification where available.
- Production row counts and selected immutable checksums are unchanged before and after the QA exercise.

## 13. Initial implementation phases

### Phase A: Environment-safe application configuration

Add explicit frontend/backend environment identity, remove silent production fallback, add the QA banner/build identifiers, and verify authentication boundaries.

### Phase B: Remote QA infrastructure

Reauthenticate GitHub and Heroku, create the target Pages repository, GitHub `qa` environment, Heroku QA app, and independent Postgres add-on. Configure least-privilege deployment credentials without exposing secret values.

### Phase C: Seed and reset tooling

Implement the deterministic synthetic seed, guarded QA reset, expected-count verification, and environment-isolation checks.

### Phase D: First deployment and acceptance

Advance the existing Question Set Wizard release candidate to the two QA branches, deploy backend then frontend, run the full deployed instructor/student journey, and generate a browser verification report.

### Phase E: Production release preparation

Only after QA acceptance and the separate migration rehearsal, prepare a production release checklist. Production remains unchanged until Harvey explicitly approves it.

## 14. Setup prerequisites

- Restore authenticated access to the GUII-Lab GitHub organization with permission to create/configure the QA repository and Actions environment.
- Restore Heroku authentication with permission to create an app, provision an add-on, and inspect or configure the existing production Pipeline.
- Confirm the final QA repository and Heroku app names are available. Naming changes do not alter the architecture.
- Determine the least-cost Heroku dyno and Postgres plans that support the expected QA workload before provisioning billable resources.
