(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.leaiInstructorAuth = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalizeEmail(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }

    function apiError(response, payload) {
        var code = payload && typeof payload.error === 'string'
            ? payload.error
            : (response.status === 401 ? 'authentication_required' : 'request_failed');
        var error = new Error(code);
        error.code = code;
        error.status = response.status;
        if (payload && Array.isArray(payload.details)) error.details = payload.details.slice();
        return error;
    }

    async function parseResponse(response) {
        var text = await response.text();
        var payload = null;
        if (text) {
            try { payload = JSON.parse(text); } catch (error) { payload = null; }
        }
        if (!response.ok) throw apiError(response, payload);
        return payload;
    }

    function authorizedOptions(token, options) {
        var source = options || {};
        var headers = Object.assign({}, source.headers || {}, {
            Authorization: 'Bearer ' + token,
        });
        return Object.assign({}, source, { headers: headers });
    }

    async function signIn(fetchImpl, apiBase, email, password) {
        var payload = await parseResponse(await fetchImpl(apiBase + '/instructor_sessions/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizeEmail(email), password: password }),
        }));
        return {
            instructorToken: payload.token,
            instructorSessionExpiresAt: payload.expires_at,
            mustChangePassword: payload.must_change_password === true,
        };
    }

    async function getAccount(fetchImpl, apiBase, token) {
        return parseResponse(await fetchImpl(
            apiBase + '/instructor_me/',
            authorizedOptions(token)
        ));
    }

    async function changePassword(fetchImpl, apiBase, token, currentPassword, newPassword) {
        return parseResponse(await fetchImpl(
            apiBase + '/instructor_password/',
            authorizedOptions(token, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword,
                }),
            })
        ));
    }

    async function listCourses(fetchImpl, apiBase, token) {
        return parseResponse(await fetchImpl(
            apiBase + '/instructor_courses/',
            authorizedOptions(token)
        ));
    }

    async function createCourse(fetchImpl, apiBase, token, course) {
        return parseResponse(await fetchImpl(
            apiBase + '/instructor_courses/',
            authorizedOptions(token, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(course),
            })
        ));
    }

    async function signOut(fetchImpl, apiBase, token) {
        if (!token) return;
        var response = await fetchImpl(
            apiBase + '/instructor_sessions/current/',
            authorizedOptions(token, { method: 'DELETE' })
        );
        if (response.status === 401 || response.status === 204) return;
        await parseResponse(response);
    }

    function selectCourse(session, course) {
        return Object.assign({}, session || {}, {
            courseId: course.course_id,
            courseName: course.course_name,
        });
    }

    function hasUsableInstructorSession(session, now) {
        if (!session || !session.instructorToken || !session.instructorSessionExpiresAt) return false;
        var expiry = Date.parse(session.instructorSessionExpiresAt);
        var currentTime = typeof now === 'number' ? now : Date.now();
        return Number.isFinite(expiry) && expiry > currentTime;
    }

    return {
        normalizeEmail: normalizeEmail,
        signIn: signIn,
        getAccount: getAccount,
        changePassword: changePassword,
        listCourses: listCourses,
        createCourse: createCourse,
        signOut: signOut,
        selectCourse: selectCourse,
        hasUsableInstructorSession: hasUsableInstructorSession,
    };
}));
