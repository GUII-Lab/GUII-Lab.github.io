# Task 3 deploy-key implementation report

## Result

Implemented the approved repository-scoped SSH deploy-key contract from frontend base commit `58c826b585b2b5ebd47ec24c5169696eb48912c8`.

- The QA Pages target checkout now uses `ssh-key: ${{ secrets.LEAI_QA_PAGES_DEPLOY_KEY }}`.
- The source checkout remains credential-free with `persist-credentials: false`.
- The deploy key appears only in `Checkout QA Pages target`, after the Node and Python tests, artifact build and verification, and backend environment/schema preflight.
- The target repository, `main` branch, source/target paths, synchronization checks, QA identity gates, and non-force push remain unchanged.
- The old `LEAI_QA_PAGES_TOKEN` secret and every `token:` checkout input are absent from the workflow.

## TDD evidence

I changed only `LEAI/tests/leai-qa-workflow.test.js` before implementation. The updated contract requires the exact deploy-key secret name, one secret-bearing step, target-only use, preflight ordering, no `token:` input, and no old secret reference.

RED against the token-based workflow:

```text
node --test LEAI/tests/leai-qa-workflow.test.js
tests 8, pass 7, fail 1, exit 1
```

The intended failure showed the target checkout still had:

```text
token: ${{ secrets.LEAI_QA_PAGES_TOKEN }}
```

instead of:

```text
ssh-key: ${{ secrets.LEAI_QA_PAGES_DEPLOY_KEY }}
```

GREEN after the minimal workflow and documentation changes:

```text
node --test LEAI/tests/leai-qa-workflow.test.js
tests 8, pass 8, fail 0, exit 0
```

All pre-existing workflow contract tests remain present, including the tests that pin trigger/ref/environment behavior, action versions, test and artifact ordering, artifact identity, backend `leai_qa` preflight, synchronized output, and non-force publication.

## Documentation boundary

The QA spec and both approved plans now state that:

- the public deploy key is installed with write access only on `GUII-Lab/LEAI-QA`;
- the private key is stored only as `LEAI_QA_PAGES_DEPLOY_KEY` in the source repository's `qa` GitHub environment;
- revocation removes the target-repository public deploy key and deletes the environment secret;
- rotation installs a replacement public key, replaces the private-key secret, verifies deployment, and then removes the old public key;
- no personal or organization-wide token is used.

## Aggregate verification

- `node --test LEAI/tests/*.test.js`: 150/150 passed.
- `UV_CACHE_DIR=/private/tmp/leai-uv-cache uv run python -m unittest discover -s LEAI/tests -p 'test_*.py' -v`: 35/35 passed.
- `actionlint .github/workflows/deploy-leai-qa.yml`: exit 0, no findings.
- Generated untracked Python and pytest caches were removed. The repository's pre-existing tracked bytecode files were restored unchanged.
- Final `git diff --check` is recorded after this report is added.

## Delivery boundary

One focused local commit contains only the five brief-owned files and this report. Nothing was pushed or deployed. No remote was contacted or changed, and no SSH key, repository secret, or deploy-key registration was generated or installed.
