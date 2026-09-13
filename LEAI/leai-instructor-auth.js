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
        var sourceHeaders = source.headers || {};
        var headers;
        if (typeof Headers === 'function' && sourceHeaders instanceof Headers) {
            headers = new Headers(sourceHeaders);
            headers.set('Authorization', 'Bearer ' + token);
        } else if (Array.isArray(sourceHeaders)) {
            headers = Object.fromEntries(sourceHeaders);
            headers.Authorization = 'Bearer ' + token;
        } else {
            headers = Object.assign({}, sourceHeaders, {
                Authorization: 'Bearer ' + token,
            });
        }
        return Object.assign({}, source, { headers: headers });
    }

    function instructorHomeHref() {
        return 'InstructorHome.html';
    }

    function expireAccountSession() {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) {
            try { sessionStorage.removeItem('leai_session'); } catch (error) {}
        }
        if (
            typeof window !== 'undefined'
            && window.location
            && typeof window.location.replace === 'function'
            && !/\/InstructorHome\.html$/.test(window.location.pathname || '')
        ) {
            window.location.replace(instructorHomeHref());
        }
    }

    function requireQaMutationIdentity(options) {
        if (typeof window === 'undefined'
                || !window.LEAI_ENVIRONMENT
                || window.LEAI_ENVIRONMENT.name !== 'qa') return;
        if (!window.leaiEnvironment
                || typeof window.leaiEnvironment.requireInstructorMutation !== 'function') {
            throw new Error('LEAI_QA_IDENTITY_UNVERIFIED');
        }
        window.leaiEnvironment.requireInstructorMutation(
            window.LEAI_ENVIRONMENT,
            window.LEAI_ENVIRONMENT_IDENTITY,
            options,
        );
    }

    async function authorizedFetch(fetchImpl, token, url, options) {
        requireQaMutationIdentity(options);
        var requestOptions = options || {};
        if (token) requestOptions = authorizedOptions(token, requestOptions);
        var response = await fetchImpl(url, requestOptions);
        if (token && response.status === 401) expireAccountSession();
        return response;
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
        return parseResponse(await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_me/',
            undefined,
        ));
    }

    async function updateProfile(fetchImpl, apiBase, token, patch) {
        var source = patch || {};
        var payload = {};
        if (Object.prototype.hasOwnProperty.call(source, 'display_name')) {
            payload.display_name = String(source.display_name || '').trim();
        }
        if (Object.prototype.hasOwnProperty.call(source, 'email')) {
            payload.email = normalizeEmail(source.email);
        }
        return parseResponse(await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_me/',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
        ));
    }

    async function changePassword(fetchImpl, apiBase, token, currentPassword, newPassword) {
        return parseResponse(await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_password/',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword,
                }),
            },
        ));
    }

    async function listCourses(fetchImpl, apiBase, token) {
        return parseResponse(await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_courses/',
            undefined,
        ));
    }

    async function createCourse(fetchImpl, apiBase, token, course) {
        return parseResponse(await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_courses/',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(course),
            },
        ));
    }

    async function signOut(fetchImpl, apiBase, token) {
        if (!token) return;
        var response = await authorizedFetch(
            fetchImpl,
            token,
            apiBase + '/instructor_sessions/current/',
            { method: 'DELETE' },
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
        authorizedFetch: authorizedFetch,
        instructorHomeHref: instructorHomeHref,
        signIn: signIn,
        getAccount: getAccount,
        updateProfile: updateProfile,
        changePassword: changePassword,
        listCourses: listCourses,
        createCourse: createCourse,
        signOut: signOut,
        selectCourse: selectCourse,
        hasUsableInstructorSession: hasUsableInstructorSession,
    };
}));
