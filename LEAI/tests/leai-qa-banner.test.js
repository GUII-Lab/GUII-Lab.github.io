'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'leai-environment.js'), 'utf8');

function loadEnvironment(options) {
    const settings = options || {};
    const listeners = {};
    const calls = [];
    const body = {
        children: [],
        inert: false,
        insertBefore: function (node) { this.children.unshift(node); },
    };
    const document = {
        readyState: 'loading',
        body: body,
        addEventListener: function (type, listener) { listeners[type] = listener; },
        createElement: function () {
            return {
                attributes: {},
                setAttribute: function (name, value) { this.attributes[name] = value; },
            };
        },
        querySelector: function (selector) {
            return body.children.find(function (node) {
                return selector === '.leai-environment-banner'
                    && node.className === 'leai-environment-banner';
            }) || null;
        },
    };
    const window = {
        document: document,
        location: {
            hostname: 'guii-lab.github.io',
            origin: 'https://guii-lab.github.io',
            pathname: '/LEAI-QA/LEAI/InstructorHome.html',
        },
        LEAI_DEPLOYMENT_CONFIG: settings.environment === 'production' ? null : {
            environment: 'qa',
            apiBase: 'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api',
            publicBaseUrl: settings.environment === 'invalid-qa'
                ? 'http://guii-lab.github.io/LEAI-QA/LEAI/'
                : 'https://guii-lab.github.io/LEAI-QA/LEAI/',
            buildId: 'frontend-abc1234',
            emailEnabled: false,
        },
        fetch: async function (url) {
            calls.push(url);
            if (settings.fetchError) throw new Error('network unavailable');
            return {
                ok: true,
                json: async function () {
                    return settings.backendIdentity || {
                        environment: 'qa',
                        build_id: 'backend-def5678',
                        email_enabled: false,
                        database_schema: 'leai_qa',
                    };
                },
            };
        },
    };
    vm.runInNewContext(source, { window: window, URL: URL, URLSearchParams: URLSearchParams });
    return { body: body, calls: calls, listeners: listeners, window: window };
}

test('QA marker persists distinct frontend and backend build identities', async () => {
    const page = loadEnvironment();

    assert.equal(page.body.inert, true);
    page.listeners.DOMContentLoaded();
    assert.match(page.body.children[0].textContent, /frontend build frontend-abc1234/);
    assert.match(page.body.children[0].textContent, /backend build checking/);

    const identity = await page.window.LEAI_ENVIRONMENT_IDENTITY_READY;

    assert.equal(identity.verified, true);
    assert.deepEqual(Object.keys(identity), [
        'verified',
        'frontendBuildId',
        'backendBuildId',
        'databaseSchema',
    ]);
    assert.equal(identity.databaseSchema, 'leai_qa');
    assert.equal(page.body.inert, false);
    assert.deepEqual(page.calls, [
        'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api/environment/',
    ]);
    assert.equal(page.body.children.length, 1);
    assert.equal(
        page.body.children[0].textContent,
        'QA environment · test data only · database schema leai_qa · frontend build frontend-abc1234 · backend build backend-def5678',
    );
});

test('QA environment mismatch keeps instructor UI blocked and displays both identities', async () => {
    const page = loadEnvironment({
        backendIdentity: {
            environment: 'production',
            build_id: 'backend-def5678',
            email_enabled: false,
            database_schema: 'leai_qa',
        },
    });
    page.listeners.DOMContentLoaded();

    const identity = await page.window.LEAI_ENVIRONMENT_IDENTITY_READY;

    assert.equal(identity.verified, false);
    assert.equal(page.body.inert, true);
    assert.equal(
        page.body.children[0].textContent,
        'QA environment blocked · database schema leai_qa · frontend build frontend-abc1234 · backend build backend-def5678 · instructor changes disabled',
    );
});

test('QA email-enabled identity remains fail-closed', async () => {
    const page = loadEnvironment({
        backendIdentity: {
            environment: 'qa',
            build_id: 'backend-def5678',
            email_enabled: true,
            database_schema: 'leai_qa',
        },
    });
    page.listeners.DOMContentLoaded();

    const identity = await page.window.LEAI_ENVIRONMENT_IDENTITY_READY;

    assert.equal(identity.verified, false);
    assert.equal(page.body.inert, true);
});

test('missing or non-exact QA database schema keeps instructor UI inert', async (t) => {
    const cases = [
        { name: 'missing', databaseSchema: undefined },
        { name: 'production public', databaseSchema: 'public' },
        { name: 'mixed case', databaseSchema: 'LEAI_QA' },
        { name: 'multiple schemas', databaseSchema: 'leai_qa,public' },
    ];

    for (const testCase of cases) {
        await t.test(testCase.name, async () => {
            const backendIdentity = {
                environment: 'qa',
                build_id: 'backend-def5678',
                email_enabled: false,
            };
            if (testCase.databaseSchema !== undefined) {
                backendIdentity.database_schema = testCase.databaseSchema;
            }
            const page = loadEnvironment({ backendIdentity: backendIdentity });
            page.listeners.DOMContentLoaded();

            const identity = await page.window.LEAI_ENVIRONMENT_IDENTITY_READY;

            assert.equal(identity.verified, false);
            assert.equal(identity.databaseSchema, testCase.databaseSchema || '');
            assert.equal(page.body.inert, true);
        });
    }
});

test('unavailable QA identity remains visible and fail-closed', async () => {
    const page = loadEnvironment({ fetchError: true });
    page.listeners.DOMContentLoaded();

    const identity = await page.window.LEAI_ENVIRONMENT_IDENTITY_READY;

    assert.equal(identity.verified, false);
    assert.equal(page.body.inert, true);
    assert.equal(
        page.body.children[0].textContent,
        'QA environment blocked · database schema unavailable · frontend build frontend-abc1234 · backend build unavailable · instructor changes disabled',
    );
});

test('production and invalid QA configuration do not fetch identity or add a marker', () => {
    ['production', 'invalid-qa'].forEach(function (environment) {
        const page = loadEnvironment({ environment: environment });
        assert.equal(page.listeners.DOMContentLoaded, undefined);
        assert.equal(page.body.children.length, 0);
        assert.equal(page.body.inert, false);
        assert.deepEqual(page.calls, []);
    });
});
