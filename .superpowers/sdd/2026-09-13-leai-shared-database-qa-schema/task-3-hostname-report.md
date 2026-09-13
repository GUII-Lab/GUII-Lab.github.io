# Task 3 hostname correction report

## Scope

- Replaced the assumed QA API base with the provider-returned exact base: `https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api`.
- Preserved the QA Pages base: `https://guii-lab.github.io/LEAI-QA/LEAI/`.
- Preserved exact-string fail-closed validation. The old hostname and a wildcard-shaped hostname are explicit rejection fixtures.
- Updated the artifact-builder examples, GitHub environment value, `LEAI_ALLOWED_HOSTS`, health URL, QA backend/admin URLs, and browser network assertion in the fixed-QA plan. Heroku app identifiers used by CLI commands remain `guiidata-leai-qa`.
- No backend, workflow, deployment, remote, or production change was made.

## TDD evidence

Tests were updated before runtime code.

RED against the old runtime and artifact constants:

- `node --test LEAI/tests/leai-environment.test.js LEAI/tests/leai-qa-banner.test.js LEAI/tests/leai-insights-fields.test.js` exited 1: 18 tests, 4 passed, 14 failed. The new exact base resolved as unknown, while the old exact base was still accepted.
- `python3 -m unittest LEAI.tests.test_build_leai_qa_artifact` exited 1: 21 tests, with 8 failures and 8 errors. The builder rejected the new exact base and accepted the old exact base.

GREEN after the minimal runtime, builder, documentation, and fingerprint changes:

- Focused Node: 18/18 passed.
- Focused Python: 21/21 passed.

## Runtime fingerprint

- Final `LEAI/leai-environment.js` SHA-256: `e851b7b6d640f6f392c409013fdd30bbdee39055f9c872a2224be1ad3c464644`.
- Replaced the artifact builder's one previous fingerprint with that exact digest.
- The fingerprint allowlist remains a single exact file-to-hash entry.

## Aggregate verification

- `node --test LEAI/tests/*.test.js`: 150/150 passed.
- `UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest discover -s LEAI/tests -p 'test_*.py' -v`: 35/35 passed.
- `actionlint`: passed.
- `git diff --check`: passed.
- Generated untracked Python cache directories were removed. Pre-existing tracked cache files were preserved and excluded from the change.

## Delivery boundary

One focused local commit includes only the task-owned hostname correction files and this report. Nothing was pushed or deployed, and no remote was contacted or mutated.
