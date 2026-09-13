'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../leai-instructor-auth.js');

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        text: async function () { return body === undefined ? '' : JSON.stringify(body); },
    };
}

test('normalizeEmail trims and lowercases instructor identities', () => {
    assert.equal(auth.normalizeEmail('  Professor@Example.EDU '), 'professor@example.edu');
    assert.equal(auth.normalizeEmail(null), '');
});

test('signIn posts normalized credentials and returns a reusable instructor session', async () => {
    const calls = [];
    const fetchImpl = async function (url, options) {
        calls.push({ url: url, options: options });
        return jsonResponse(201, {
            token: 'raw-session-token',
            expires_at: '2026-09-11T12:00:00Z',
            must_change_password: true,
        });
    };

    const session = await auth.signIn(fetchImpl, '/api', ' Teacher@Example.edu ', 'temporary-password');

    assert.equal(calls[0].url, '/api/instructor_sessions/');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        email: 'teacher@example.edu',
        password: 'temporary-password',
    });
    assert.deepEqual(session, {
        instructorToken: 'raw-session-token',
        instructorSessionExpiresAt: '2026-09-11T12:00:00Z',
        mustChangePassword: true,
    });
});

test('authorized requests send the bearer token and parse JSON', async () => {
    const calls = [];
    const fetchImpl = async function (url, options) {
        calls.push({ url: url, options: options });
        return jsonResponse(200, { courses: [] });
    };

    const result = await auth.listCourses(fetchImpl, '/api', 'secret');

    assert.deepEqual(result, { courses: [] });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
});

test('updateProfile sends a trimmed display name and normalized email with bearer auth', async () => {
    const calls = [];
    const fetchImpl = async function (url, options) {
        calls.push({ url: url, options: options });
        return jsonResponse(200, {
            display_name: 'Prof. Updated',
            email: 'prof.updated@ucsc.edu',
        });
    };

    const account = await auth.updateProfile(
        fetchImpl,
        '/api',
        'token',
        {
            display_name: '  Prof. Updated  ',
            email: '  Prof.Updated@UCSC.EDU  ',
        },
    );

    assert.equal(calls[0].url, '/api/instructor_me/');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        display_name: 'Prof. Updated',
        email: 'prof.updated@ucsc.edu',
    });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(account.display_name, 'Prof. Updated');
});

test('updateProfile omits email when the partial patch changes only display name', async () => {
    const calls = [];
    const fetchImpl = async function (url, options) {
        calls.push({ url: url, options: options });
        return jsonResponse(200, {
            display_name: 'QA Instructor Updated',
            email: 'instructor@qa.invalid',
        });
    };

    await auth.updateProfile(fetchImpl, '/api', 'token', {
        display_name: '  QA Instructor Updated  ',
    });

    assert.deepEqual(JSON.parse(calls[0].options.body), {
        display_name: 'QA Instructor Updated',
    });
});

test('instructorHomeHref returns the stable relative account destination', () => {
    assert.equal(auth.instructorHomeHref(), 'InstructorHome.html');
});

test('changePassword sends both passwords and preserves backend validation details', async () => {
    const fetchImpl = async function () {
        return jsonResponse(400, {
            error: 'invalid_password',
            details: ['This password is too short.', 'This password is too common.'],
        });
    };

    await assert.rejects(
        auth.changePassword(fetchImpl, '/api', 'token', 'old', 'short'),
        function (error) {
            assert.equal(error.code, 'invalid_password');
            assert.deepEqual(error.details, [
                'This password is too short.',
                'This password is too common.',
            ]);
            return true;
        }
    );
});

test('selectCourse merges course context without discarding instructor authentication', () => {
    assert.deepEqual(auth.selectCourse({
        instructorToken: 'token',
        instructorSessionExpiresAt: '2026-09-11T12:00:00Z',
        instructorEmail: 'teacher@example.edu',
    }, {
        course_id: 'cmpm80k-sm26',
        course_name: 'Foundations of Game Design',
    }), {
        instructorToken: 'token',
        instructorSessionExpiresAt: '2026-09-11T12:00:00Z',
        instructorEmail: 'teacher@example.edu',
        courseId: 'cmpm80k-sm26',
        courseName: 'Foundations of Game Design',
    });
});

test('hasUsableInstructorSession rejects missing and expired sessions', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');

    assert.equal(auth.hasUsableInstructorSession(null, now), false);
    assert.equal(auth.hasUsableInstructorSession({ instructorToken: 'token' }, now), false);
    assert.equal(auth.hasUsableInstructorSession({
        instructorToken: 'token',
        instructorSessionExpiresAt: '2026-09-10T11:59:59Z',
    }, now), false);
    assert.equal(auth.hasUsableInstructorSession({
        instructorToken: 'token',
        instructorSessionExpiresAt: '2026-09-10T12:00:01Z',
    }, now), true);
});

test('API failures expose a stable code without leaking arbitrary server text', async () => {
    const fetchImpl = async function () {
        return jsonResponse(401, { error: 'invalid_credentials', debug: 'sensitive detail' });
    };

    await assert.rejects(
        auth.signIn(fetchImpl, '/api', 'teacher@example.edu', 'wrong'),
        function (error) {
            assert.equal(error.code, 'invalid_credentials');
            assert.equal(error.message, 'invalid_credentials');
            assert.equal(Object.prototype.hasOwnProperty.call(error, 'debug'), false);
            return true;
        }
    );
});

test('logout tolerates an already-expired server session', async () => {
    const fetchImpl = async function () { return jsonResponse(401, { error: 'authentication_required' }); };
    await assert.doesNotReject(auth.signOut(fetchImpl, '/api', 'expired-token'));
});
