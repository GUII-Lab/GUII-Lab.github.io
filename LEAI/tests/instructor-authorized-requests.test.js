'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../leai-instructor-auth.js');
const environment = require('../leai-environment.js');

function response(status) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        text: async function () { return ''; },
    };
}

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        text: async function () { return JSON.stringify(payload); },
    };
}

function source(filename) {
    return fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
}

function directFetchLines(contents, endpoint) {
    const needle = "fetch(API + '/" + endpoint;
    return contents.split('\n').filter(function (line) {
        return line.includes(needle);
    });
}

test('authorizedFetch merges bearer auth without losing caller headers', async () => {
    const calls = [];
    const result = await auth.authorizedFetch(
        async function (url, options) {
            calls.push({ url: url, options: options });
            return response(200);
        },
        'account-token',
        '/api/protected/',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Request-ID': 'request-1',
            },
            body: '{}',
        },
    );

    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer account-token');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].options.headers['X-Request-ID'], 'request-1');
});

test('authorizedFetch keeps an explicit legacy request token-free', async () => {
    const calls = [];
    let cleared = false;
    let routed = false;
    const oldStorage = global.sessionStorage;
    const oldWindow = global.window;
    global.sessionStorage = {
        removeItem: function () { cleared = true; },
    };
    global.window = {
        location: { replace: function () { routed = true; } },
    };
    try {
        const result = await auth.authorizedFetch(
            async function (url, options) {
                calls.push({ url: url, options: options });
                return response(401);
            },
            '',
            '/api/legacy/',
            { headers: { Accept: 'application/json' } },
        );
        assert.equal(result.status, 401);
        assert.equal(calls[0].options.headers.Authorization, undefined);
        assert.equal(cleared, false);
        assert.equal(routed, false);
    } finally {
        if (oldStorage === undefined) delete global.sessionStorage;
        else global.sessionStorage = oldStorage;
        if (oldWindow === undefined) delete global.window;
        else global.window = oldWindow;
    }
});

test('account 401 clears session, routes Home, and never retries a mutation', async () => {
    let calls = 0;
    const removed = [];
    const routes = [];
    const oldStorage = global.sessionStorage;
    const oldWindow = global.window;
    global.sessionStorage = {
        removeItem: function (key) { removed.push(key); },
    };
    global.window = {
        location: { replace: function (href) { routes.push(href); } },
    };
    try {
        const result = await auth.authorizedFetch(
            async function () {
                calls += 1;
                return response(401);
            },
            'expired-token',
            '/api/protected-mutation/',
            { method: 'POST', body: '{}' },
        );
        assert.equal(result.status, 401);
        assert.equal(calls, 1);
        assert.deepEqual(removed, ['leai_session']);
        assert.deepEqual(routes, ['InstructorHome.html']);
    } finally {
        if (oldStorage === undefined) delete global.sessionStorage;
        else global.sessionStorage = oldStorage;
        if (oldWindow === undefined) delete global.window;
        else global.window = oldWindow;
    }
});

test('QA account mutations fail before fetch until environment identity matches', async () => {
    let calls = 0;
    const oldWindow = global.window;
    global.window = {
        LEAI_ENVIRONMENT: { name: 'qa', known: true, buildId: 'abc1234' },
        LEAI_ENVIRONMENT_IDENTITY: { verified: false },
        leaiEnvironment: environment,
    };
    try {
        await assert.rejects(
            auth.authorizedFetch(
                async function () { calls += 1; return response(200); },
                'account-token',
                '/api/protected-mutation/',
                { method: 'POST', body: '{}' },
            ),
            /LEAI_QA_IDENTITY_UNVERIFIED/,
        );
        assert.equal(calls, 0);

        global.window.LEAI_ENVIRONMENT_IDENTITY = {
            verified: true,
            frontendBuildId: 'abc1234',
            backendBuildId: 'backend-def5678',
        };
        const result = await auth.authorizedFetch(
            async function () { calls += 1; return response(200); },
            'account-token',
            '/api/protected-mutation/',
            { method: 'POST', body: '{}' },
        );
        assert.equal(result.status, 200);
        assert.equal(calls, 1);
    } finally {
        if (oldWindow === undefined) delete global.window;
        else global.window = oldWindow;
    }
});

test('account 401 on Instructor Home clears session without reloading the same page', async () => {
    const removed = [];
    const routes = [];
    const oldStorage = global.sessionStorage;
    const oldWindow = global.window;
    global.sessionStorage = {
        removeItem: function (key) { removed.push(key); },
    };
    global.window = {
        location: {
            pathname: '/LEAI/InstructorHome.html',
            replace: function (href) { routes.push(href); },
        },
    };
    try {
        const result = await auth.authorizedFetch(
            async function () { return response(401); },
            'expired-token',
            '/api/instructor_me/',
        );
        assert.equal(result.status, 401);
        assert.deepEqual(removed, ['leai_session']);
        assert.deepEqual(routes, []);
    } finally {
        if (oldStorage === undefined) delete global.sessionStorage;
        else global.sessionStorage = oldStorage;
        if (oldWindow === undefined) delete global.window;
        else global.window = oldWindow;
    }
});

test('profile update sends normalized changed fields together', async () => {
    const calls = [];
    const result = await auth.updateProfile(
        async function (url, options) {
            calls.push({ url: url, options: options });
            return jsonResponse(200, {
                email: 'name@ucsc.edu',
                display_name: 'Name',
            });
        },
        '/api',
        'account-token',
        {
            display_name: '  Name  ',
            email: '  NAME@UCSC.EDU  ',
        },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/instructor_me/');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        display_name: 'Name',
        email: 'name@ucsc.edu',
    });
    assert.equal(result.email, 'name@ucsc.edu');
});

test('shared instructor chat, team, and PDF wrappers use authorizedFetch', () => {
    const shared = source('leai-shared.js');
    const genericProtectedCalls = shared.match(/authorizedFetch\(API \+ path, opts\)/g) || [];
    assert.equal(genericProtectedCalls.length, 1, 'PDF JSON wrapper');
    assert.match(shared, /opts\._public \? fetch : authorizedFetch/);

    [
        'team_configurations/?',
        'team_configurations/create/',
        'team_configurations/update/',
        'team_configurations/archive/',
        'team_configurations/delete/',
        'leai_pdf_ingest/start/',
    ].forEach(function (endpoint) {
        assert.deepEqual(directFetchLines(shared, endpoint), [], endpoint);
    });

    assert.match(shared, /authorizedFetch\(API \+ '\/team_configurations\/\?'/);
    assert.match(shared, /authorizedFetch\(API \+ '\/leai_pdf_ingest\/start\/'/);
});

test('shared request wrapper checks QA identity before legacy token fallback', () => {
    const shared = source('leai-shared.js');
    const wrapper = shared.slice(
        shared.indexOf('function authorizedFetch(url, options)'),
        shared.indexOf('// ===== UI HELPERS ====='),
    );

    assert.match(wrapper, /requireInstructorMutation/);
    assert.ok(
        wrapper.indexOf('requireInstructorMutation') < wrapper.indexOf('if (!token) return fetch'),
        'QA mutation identity must be checked before a token-free request can escape',
    );
});

test('direct instructor page requests use authorizedFetch for protected endpoints', () => {
    const expectations = {
        'PromptDesigner.html': [
            'create_feedback_gpt/',
            'feedback_gpts_by_course/',
            'set_survey_status/',
            'clone_survey/',
            'update_survey/',
            'delete_survey/',
        ],
        'FeedbackAnalyzer.html': [
            'feedback_messages_by_course/',
            'feedback_gpts_by_course/',
            'feedback_messages_by_gpt/',
        ],
        'FeedbackChat.html': ['feedback_messages_by_course/'],
        'CourseBanner.html': ['update_course_banner/'],
        'Customizations.html': ['update_course_customization/'],
    };

    Object.entries(expectations).forEach(function (entry) {
        const filename = entry[0];
        const contents = source(filename);
        entry[1].forEach(function (endpoint) {
            assert.deepEqual(
                directFetchLines(contents, endpoint),
                [],
                filename + ' still directly fetches ' + endpoint,
            );
            assert.ok(
                contents.includes("authorizedFetch(API + '/" + endpoint),
                filename + ' does not authorize ' + endpoint,
            );
        });
    });
});

test('student and explicit public/legacy requests remain token-free', () => {
    const shared = source('leai-shared.js');
    const student = source('feedback.html');
    const promptDesigner = source('PromptDesigner.html');

    assert.ok(shared.includes("fetch(API + '/feedback_session_resume/'"));
    assert.ok(shared.includes("fetch(API + '/session_team_assignment/'"));
    assert.ok(shared.includes("fetch(API + '/survey_team_snapshot/?'"));
    assert.ok(student.includes("fetch(API + '/feedback_message_api/'"));
    assert.ok(student.includes("fetch(API + '/register_session_identity/'"));
    assert.ok(promptDesigner.includes("fetch(API + '/form_schemas/?active=1'"));
    assert.ok(promptDesigner.includes("fetch(API + '/feedback_messages_bulk_api/'"));
    const bulkEndpointIndex = promptDesigner.indexOf("fetch(API + '/feedback_messages_bulk_api/'");
    const bulkGuard = promptDesigner.slice(Math.max(0, bulkEndpointIndex - 900), bulkEndpointIndex);
    assert.match(
        bulkGuard,
        /currentSession && currentSession\.instructorToken[\s\S]*return;/,
        'account sessions must return before the legacy mixed-course bulk endpoint',
    );
});

test('student chat calls explicitly use the public chat transport', () => {
    const student = source('feedback.html');
    const chatCalls = student.match(/leaiChat\.chat\(/g) || [];
    const publicChatOptions = student.match(/publicRequest:\s*true/g) || [];

    assert.equal(chatCalls.length, 3);
    assert.equal(publicChatOptions.length, chatCalls.length);
});
