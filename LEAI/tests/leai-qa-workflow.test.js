'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'deploy-leai-qa.yml');
const workflow = fs.existsSync(workflowPath)
    ? fs.readFileSync(workflowPath, 'utf8')
    : '';
const lines = workflow.split(/\r?\n/);

function indentation(line) {
    return line.match(/^ */)[0].length;
}

function blockFor(sourceLines, key, indent) {
    const prefix = ' '.repeat(indent);
    const start = sourceLines.findIndex((line) => line === `${prefix}${key}:`);
    assert.notEqual(start, -1, `missing ${key} block at indentation ${indent}`);

    let end = sourceLines.length;
    for (let index = start + 1; index < sourceLines.length; index += 1) {
        const line = sourceLines[index];
        if (line.trim() && indentation(line) <= indent) {
            end = index;
            break;
        }
    }
    return sourceLines.slice(start + 1, end);
}

function immediateMap(block, indent) {
    const entries = new Map();
    const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):(?:\\s*(.*))?$`);
    block.forEach((line) => {
        const match = line.match(pattern);
        if (match) entries.set(match[1], match[2] || '');
    });
    return entries;
}

function sequenceFor(block, key, keyIndent) {
    const prefix = ' '.repeat(keyIndent);
    const start = block.findIndex((line) => line === `${prefix}${key}:`);
    assert.notEqual(start, -1, `missing ${key} sequence`);

    const values = [];
    for (let index = start + 1; index < block.length; index += 1) {
        const line = block[index];
        if (line.trim() && indentation(line) <= keyIndent) break;
        const match = line.match(new RegExp(`^ {${keyIndent + 2}}-\\s+(.+)$`));
        if (match) values.push(match[1]);
    }
    return values;
}

function parseSteps(jobBlock) {
    const stepsStart = jobBlock.findIndex((line) => line === '    steps:');
    assert.notEqual(stepsStart, -1, 'missing deploy steps');
    const stepLines = jobBlock.slice(stepsStart + 1);
    const starts = [];
    stepLines.forEach((line, index) => {
        if (/^ {6}- name: .+$/.test(line)) starts.push(index);
    });

    return starts.map((start, position) => {
        const end = starts[position + 1] ?? stepLines.length;
        const source = stepLines.slice(start, end);
        const step = {
            name: source[0].replace(/^ {6}- name: /, ''),
            source,
            with: new Map(),
            env: new Map(),
        };

        for (let index = 1; index < source.length; index += 1) {
            const line = source[index];
            const scalar = line.match(/^ {8}([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!scalar) continue;
            const [, key, value] = scalar;
            if (key === 'with' || key === 'env') {
                const childMap = step[key];
                for (index += 1; index < source.length; index += 1) {
                    const child = source[index].match(/^ {10}([A-Za-z0-9_-]+):\s*(.*)$/);
                    if (!child) {
                        index -= 1;
                        break;
                    }
                    childMap.set(child[1], child[2]);
                }
            } else if (key === 'run' && value === '|') {
                const script = [];
                for (index += 1; index < source.length; index += 1) {
                    if (source[index].trim() && indentation(source[index]) < 10) {
                        index -= 1;
                        break;
                    }
                    script.push(source[index].startsWith('          ')
                        ? source[index].slice(10)
                        : '');
                }
                step.run = script.join('\n').trim();
            } else {
                step[key] = value;
            }
        }
        return step;
    });
}

function compactCommand(command) {
    return String(command || '')
        .replace(/\\\s*\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function namedStep(steps, name) {
    const index = steps.findIndex((step) => step.name === name);
    assert.notEqual(index, -1, `missing workflow step: ${name}`);
    return { ...steps[index], index };
}

if (!workflow) {
    test('fixed LEAI QA deployment workflow exists', () => {
        assert.ok(workflow, `missing workflow: ${workflowPath}`);
    });
} else {
    const onBlock = blockFor(lines, 'on', 0);
    const jobsBlock = blockFor(lines, 'jobs', 0);
    const deployBlock = blockFor(jobsBlock, 'deploy', 2);
    const steps = parseSteps(deployBlock);

    test('trigger, ref guard, concurrency, permissions, and environment bind one QA deployment', () => {
        assert.deepEqual([...immediateMap(onBlock, 2).keys()], ['push', 'workflow_dispatch']);
        const pushBlock = blockFor(onBlock, 'push', 2);
        assert.deepEqual(sequenceFor(pushBlock, 'branches', 4), ['qa']);

        const concurrency = immediateMap(blockFor(lines, 'concurrency', 0), 2);
        assert.deepEqual(Object.fromEntries(concurrency), {
            group: 'leai-qa-pages',
            'cancel-in-progress': 'true',
        });
        assert.deepEqual(Object.fromEntries(immediateMap(blockFor(lines, 'permissions', 0), 2)), {
            contents: 'read',
        });

        const job = immediateMap(deployBlock, 4);
        assert.equal(job.get('if'), "github.ref == 'refs/heads/qa'");
        assert.equal(job.get('environment'), 'qa');
    });

    test('official current actions scope the SSH deploy key to the target checkout', () => {
        const sourceCheckout = namedStep(steps, 'Checkout source');
        const setupUv = namedStep(steps, 'Set up uv');
        const targetCheckout = namedStep(steps, 'Checkout QA Pages target');

        assert.deepEqual(
            steps.filter((step) => step.uses).map((step) => step.uses),
            ['actions/checkout@v7', 'astral-sh/setup-uv@bec219d24cd3e171d82865faccec33120bb574f4', 'actions/checkout@v7'],
        );

        assert.equal(sourceCheckout.index, 0);
        assert.equal(sourceCheckout.uses, 'actions/checkout@v7');
        assert.equal(sourceCheckout.with.get('path'), 'source');
        assert.equal(sourceCheckout.with.get('persist-credentials'), 'false');
        assert.equal(sourceCheckout.with.has('token'), false);

        assert.equal(setupUv.uses, 'astral-sh/setup-uv@bec219d24cd3e171d82865faccec33120bb574f4');
        assert.equal(targetCheckout.uses, 'actions/checkout@v7');
        assert.deepEqual(Object.fromEntries(targetCheckout.with), {
            repository: 'GUII-Lab/LEAI-QA',
            ref: 'main',
            path: 'target',
            'ssh-key': '${{ secrets.LEAI_QA_PAGES_DEPLOY_KEY }}',
        });

        assert.equal(targetCheckout.with.has('token'), false);
        const credentialSteps = steps.filter((step) => step.source.join('\n').includes('secrets.'));
        assert.deepEqual(credentialSteps.map((step) => step.name), ['Checkout QA Pages target']);
        assert.equal((workflow.match(/secrets\.LEAI_QA_PAGES_DEPLOY_KEY/g) || []).length, 1);
        assert.doesNotMatch(workflow, /LEAI_QA_PAGES_TOKEN|^\s*token:/m);
    });

    test('all frontend tests and the Task 5 builder run from source before any target credential exists', () => {
        const setupUv = namedStep(steps, 'Set up uv');
        const installNode = namedStep(steps, 'Install frontend Node dependencies');
        const nodeTests = namedStep(steps, 'Run frontend Node tests');
        const pythonTests = namedStep(steps, 'Run frontend Python tests');
        const build = namedStep(steps, 'Build QA artifact');
        const preflight = namedStep(steps, 'Verify QA artifact before target checkout');
        const targetCheckout = namedStep(steps, 'Checkout QA Pages target');

        assert.equal(installNode['working-directory'], 'source');
        assert.equal(compactCommand(installNode.run), 'npm ci');
        assert.equal(nodeTests['working-directory'], 'source');
        assert.equal(compactCommand(nodeTests.run), 'node --test LEAI/tests/*.test.js');
        assert.equal(pythonTests['working-directory'], 'source');
        assert.equal(
            compactCommand(pythonTests.run),
            'UV_CACHE_DIR="$RUNNER_TEMP/uv-cache" uv run python -m unittest discover -s LEAI/tests -p \'test_*.py\' -v',
        );
        assert.equal(build['working-directory'], 'source');
        assert.equal(
            compactCommand(build.run),
            'uv run python scripts/build-leai-qa-artifact.py --source . --output "$RUNNER_TEMP/leai-qa" --api-base "${{ vars.LEAI_QA_API_BASE }}" --build-id "${{ github.sha }}"',
        );
        assert.ok(setupUv.index < pythonTests.index);
        assert.ok(installNode.index < nodeTests.index);
        assert.ok(nodeTests.index < pythonTests.index);
        assert.ok(pythonTests.index < build.index);
        assert.ok(build.index < preflight.index);
        assert.ok(preflight.index < targetCheckout.index);
        assert.doesNotMatch(build.run, /guiidata-b6c968e6ed85\.herokuapp\.com|guii-lab\.github\.io\/LEAI\//);
        assert.doesNotMatch(workflow, /guiidata-b6c968e6ed85\.herokuapp\.com/);
    });

    test('artifact identity and exclusions are verified before the secret-backed checkout', () => {
        const preflight = namedStep(steps, 'Verify QA artifact before target checkout');
        const targetCheckout = namedStep(steps, 'Checkout QA Pages target');

        assert.ok(preflight.index < targetCheckout.index);
        assert.match(preflight.run, /test -f "\$RUNNER_TEMP\/leai-qa\/index\.html"/);
        assert.match(preflight.run, /test -f "\$RUNNER_TEMP\/leai-qa\/LEAI\/InstructorHome\.html"/);
        assert.match(preflight.run, /environment:\s*'qa'/);
        assert.match(preflight.run, /apiBase:\s*process\.env\.LEAI_QA_API_BASE/);
        assert.match(preflight.run, /publicBaseUrl:\s*'https:\/\/guii-lab\.github\.io\/LEAI-QA\/LEAI\/'/);
        assert.match(preflight.run, /buildId:\s*process\.env\.SOURCE_SHA/);
        assert.match(preflight.run, /emailEnabled:\s*false/);
        assert.match(preflight.run, /test ! -e "\$RUNNER_TEMP\/leai-qa\/SCAI"/);
        assert.match(preflight.run, /find "\$RUNNER_TEMP\/leai-qa" -name \.git -print -quit/);
        assert.deepEqual(Object.fromEntries(preflight.env), {
            LEAI_QA_API_BASE: '${{ vars.LEAI_QA_API_BASE }}',
            SOURCE_SHA: '${{ github.sha }}',
        });
    });

    test('QA backend identity is validated and safely logged before any target credential exists', () => {
        const artifactPreflight = namedStep(steps, 'Verify QA artifact before target checkout');
        const backendPreflight = namedStep(steps, 'Verify QA backend identity');
        const targetCheckout = namedStep(steps, 'Checkout QA Pages target');

        assert.ok(artifactPreflight.index < backendPreflight.index);
        assert.ok(backendPreflight.index < targetCheckout.index);
        assert.deepEqual(Object.fromEntries(backendPreflight.env), {
            LEAI_QA_API_BASE: '${{ vars.LEAI_QA_API_BASE }}',
            FRONTEND_BUILD_ID: '${{ github.sha }}',
        });
        assert.match(
            compactCommand(backendPreflight.run),
            /http_status="\$\(curl --silent --show-error --proto '=https' --output "\$RUNNER_TEMP\/leai-qa-backend-environment\.json" --write-out '%\{http_code\}' "\$\{LEAI_QA_API_BASE\}\/environment\/"\)"/,
        );
        assert.match(backendPreflight.run, /case "\$http_status" in[\s\S]*2\?\?\)[\s\S]*\*\)[\s\S]*exit 1[\s\S]*esac/);
        assert.match(backendPreflight.run, /assert\.equal\(identity\.environment, 'qa'\)/);
        assert.match(backendPreflight.run, /assert\.equal\(identity\.email_enabled, false\)/);
        assert.match(backendPreflight.run, /assert\.equal\(identity\.database_schema, 'leai_qa'\)/);
        assert.match(
            backendPreflight.run,
            /assert\.match\(identity\.build_id, \/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}\$\//,
        );
        assert.match(backendPreflight.run, /frontend_build_id:\s*process\.env\.FRONTEND_BUILD_ID/);
        assert.match(backendPreflight.run, /backend_build_id:\s*identity\.build_id/);
        assert.match(backendPreflight.run, /backend_environment:\s*identity\.environment/);
        assert.match(backendPreflight.run, /backend_email_enabled:\s*identity\.email_enabled/);
        assert.match(backendPreflight.run, /backend_database_schema:\s*identity\.database_schema/);

        const beforeTargetCheckout = steps
            .slice(0, targetCheckout.index)
            .flatMap((step) => step.source)
            .join('\n');
        assert.doesNotMatch(beforeTargetCheckout, /secrets\.|^\s*token:/m);

        const targetCheckoutMarker = '      - name: Checkout QA Pages target';
        const targetCheckoutOffset = workflow.indexOf(targetCheckoutMarker);
        assert.notEqual(targetCheckoutOffset, -1);
        assert.doesNotMatch(
            workflow.slice(0, targetCheckoutOffset),
            /secrets\.|LEAI_QA_PAGES_DEPLOY_KEY|LEAI_QA_PAGES_TOKEN|^\s*(?:ssh-key|token):/m,
        );
    });

    test('sync deletes stale target files while preserving git and verifies the copied site', () => {
        const targetCheckout = namedStep(steps, 'Checkout QA Pages target');
        const sync = namedStep(steps, 'Synchronize QA artifact');
        const verify = namedStep(steps, 'Verify synchronized QA site');
        const publish = namedStep(steps, 'Commit and push changed QA site');

        assert.ok(targetCheckout.index < sync.index);
        assert.equal(
            compactCommand(sync.run),
            'rsync --archive --delete --exclude=\'.git/\' "$RUNNER_TEMP/leai-qa/" target/',
        );
        assert.ok(sync.index < verify.index);
        assert.ok(verify.index < publish.index);
        assert.match(verify.run, /test -d target\/\.git/);
        assert.match(verify.run, /test -f target\/index\.html/);
        assert.match(verify.run, /test -f target\/LEAI\/InstructorHome\.html/);
        assert.match(verify.run, /test ! -e target\/SCAI/);
        assert.match(verify.run, /cmp "\$RUNNER_TEMP\/leai-qa\/LEAI\/leai-deployment-config\.js" target\/LEAI\/leai-deployment-config\.js/);
        assert.match(verify.run, /diff -qr --exclude='\.git' "\$RUNNER_TEMP\/leai-qa" target/);
    });

    test('bot stages exact target contents and only commits changed output before a non-force main push', () => {
        const publish = namedStep(steps, 'Commit and push changed QA site');

        assert.match(publish.run, /git -C target config user\.name "github-actions\[bot\]"/);
        assert.match(publish.run, /git -C target config user\.email "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/);
        assert.match(publish.run, /git -C target remote set-url origin git@github\.com:GUII-Lab\/LEAI-QA\.git/);
        assert.match(publish.run, /git -C target add --all -- \./);
        assert.match(
            publish.run,
            /if git -C target diff --cached --quiet; then[\s\S]*else[\s\S]*git -C target commit -m "Deploy LEAI QA from \$\{GITHUB_SHA\}"[\s\S]*git -C target push origin HEAD:main[\s\S]*fi/,
        );
        assert.doesNotMatch(publish.run, /git[^\n]*push[^\n]*(?:--force|-f\b)|git[^\n]*push[^\n]*main:/);
    });

    test('workflow contains no production target, preview deployment, or source-tree move', () => {
        const runScripts = steps.map((step) => step.run || '').join('\n');
        assert.doesNotMatch(workflow, /GUII-Lab\/GUII-Lab\.github\.io|pull_request|pull_request_target/);
        assert.doesNotMatch(runScripts, /(^|\n)\s*mv\s+[^\n]*(?:source\/)?LEAI(?:\/|\s|$)/);
        assert.doesNotMatch(runScripts, /source\/LEAI-QA|mkdir[^\n]*LEAI-QA/);
        assert.doesNotMatch(runScripts, /\bgit\s+push\b[^\n]*(?:--force|-f\b)/);
    });
}
