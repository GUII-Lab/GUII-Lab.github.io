'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PAGE_PATH = path.join(__dirname, '..', 'feedbackResponses.html');
const HTML = fs.readFileSync(PAGE_PATH, 'utf8');
const PAGE_SCRIPT = Array.from(
    HTML.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
    function (match) { return match[1]; },
).filter(function (script) { return script.trim(); }).at(-1);

const USABLE_SESSION = {
    instructorToken: 'instructor-token',
    instructorSessionExpiresAt: '2999-01-01T00:00:00.000Z',
    courseId: 'course 1',
};

class FakeElement {
    constructor(tagName, id) {
        this.tagName = tagName.toUpperCase();
        this.id = id || '';
        this.children = [];
        this.className = '';
        this.onclick = null;
        this.textContent = '';
        this.value = '';
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children = children;
    }
}

function descendantText(node) {
    return [node.textContent].concat(node.children.map(descendantText)).join('');
}

async function runPage(options) {
    const settings = options || {};
    const session = Object.prototype.hasOwnProperty.call(settings, 'session')
        ? settings.session
        : USABLE_SESSION;
    const identity = settings.identity || { verified: true };
    const response = settings.response || { ok: true, status: 200, json: async function () { return {}; } };
    const elements = Object.fromEntries(
        ['startTime', 'endTime', 'gptUsed', 'applyFilters', 'sessionList', 'messageDisplay'].map(
            function (id) { return [id, new FakeElement('div', id)]; },
        ),
    );
    const listeners = {};
    const redirects = [];
    const requests = [];
    let identityReads = 0;

    const sandbox = {
        API: '/api',
        console: { error() {}, warn() {}, log() {} },
        document: {
            addEventListener(event, listener) {
                listeners[event] = listener;
            },
            createElement(tagName) {
                return new FakeElement(tagName);
            },
            createTextNode(text) {
                const node = new FakeElement('#text');
                node.textContent = String(text);
                return node;
            },
            getElementById(id) {
                return elements[id];
            },
        },
        getSession() {
            return session;
        },
        leaiInstructorAuth: {
            hasUsableInstructorSession(candidate) {
                return Boolean(
                    candidate
                    && candidate.instructorToken
                    && candidate.instructorSessionExpiresAt
                    && Date.parse(candidate.instructorSessionExpiresAt) > Date.now()
                );
            },
            instructorHomeHref() {
                return 'InstructorHome.html';
            },
        },
        location: {
            pathname: '/LEAI-QA/LEAI/feedbackResponses.html',
            replace(href) {
                redirects.push(href);
            },
        },
        async authorizedFetch(url, fetchOptions) {
            requests.push({ url, options: fetchOptions });
            return response;
        },
    };
    sandbox.window = sandbox;
    sandbox.LEAI_ENVIRONMENT = { name: 'qa' };
    Object.defineProperty(sandbox, 'LEAI_ENVIRONMENT_IDENTITY_READY', {
        configurable: true,
        get() {
            identityReads += 1;
            return Promise.resolve(identity);
        },
    });

    vm.runInNewContext(PAGE_SCRIPT, sandbox, { filename: PAGE_PATH });
    assert.equal(typeof listeners.DOMContentLoaded, 'function');
    await listeners.DOMContentLoaded();
    await new Promise(function (resolve) { setImmediate(resolve); });

    return { elements, identityReads, redirects, requests, sandbox };
}

test('feedback responses loads instructor auth before the environment and shared API', () => {
    const scripts = Array.from(
        HTML.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi),
        function (match) { return match[1]; },
    );

    assert.deepEqual(scripts.slice(-4), [
        'leai-instructor-auth.js?v=leai-env-identity-r1',
        'leai-deployment-config.js?v=leai-env-r1',
        'leai-environment.js?v=leai-env-r1',
        'leai-shared.js?v=leai-env-r1',
    ]);
    assert.doesNotMatch(HTML, /guiidata-b6c968e6ed85\.herokuapp\.com/);
    assert.doesNotMatch(HTML, /(?:const|let|var)\s+API\s*=/);
});

test('missing or incomplete instructor sessions redirect before identity or data requests', async () => {
    for (const session of [
        null,
        { instructorToken: 'token', instructorSessionExpiresAt: '2000-01-01T00:00:00.000Z', courseId: 'course' },
        { instructorToken: 'token', instructorSessionExpiresAt: '2999-01-01T00:00:00.000Z' },
    ]) {
        const result = await runPage({ session });
        assert.deepEqual(result.redirects, ['InstructorHome.html']);
        assert.equal(result.identityReads, 0);
        assert.deepEqual(result.requests, []);
    }
});

test('verified QA session requests only the selected course through authorizedFetch', async () => {
    const groupedResponses = {
        sessionA: [{ gpt_used: 'Tutor', sent_by: 'student', content: 'Hello', created_at: '2026-09-13' }],
    };
    const result = await runPage({
        response: { ok: true, status: 200, json: async function () { return groupedResponses; } },
    });

    assert.deepEqual(result.redirects, []);
    assert.equal(result.identityReads, 1);
    assert.deepEqual(result.requests, [
        { url: '/api/feedbackList/?course_id=course%201', options: undefined },
    ]);
    assert.equal(typeof result.elements.applyFilters.onclick, 'function');
});

test('unverified QA identity fails closed before requesting response data', async () => {
    const result = await runPage({ identity: { verified: false } });

    assert.equal(result.identityReads, 1);
    assert.deepEqual(result.requests, []);
    assert.match(result.elements.messageDisplay.textContent, /identity/i);
});

test('401 and 403 responses are handled without parsing response bodies', async () => {
    for (const status of [401, 403]) {
        let parsed = false;
        const result = await runPage({
            response: {
                ok: false,
                status,
                async json() {
                    parsed = true;
                    throw new Error('response body must not be parsed');
                },
            },
        });

        assert.equal(parsed, false);
        if (status === 401) {
            assert.deepEqual(result.redirects, ['InstructorHome.html']);
        } else {
            assert.match(result.elements.messageDisplay.textContent, /access/i);
        }
    }
});

test('grouped transcripts render untrusted message content as literal text', async () => {
    const payload = '<img src=x onerror="window.pwned=true">';
    const result = await runPage({
        response: {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    sessionA: [{ gpt_used: 'Tutor', sent_by: 'student', content: payload, created_at: '2026-09-13' }],
                };
            },
        },
    });

    result.elements.applyFilters.onclick();
    assert.equal(result.elements.sessionList.children.length, 1);
    result.elements.sessionList.children[0].onclick();

    assert.equal(result.elements.messageDisplay.children.length, 1);
    assert.match(descendantText(result.elements.messageDisplay.children[0]), /<img src=x onerror=/);
    assert.equal(result.sandbox.pwned, undefined);
    assert.doesNotMatch(HTML, /\.innerHTML\s*=/);
});
