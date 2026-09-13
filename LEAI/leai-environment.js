(function (root, factory) {
    const environment = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = environment;
    }

    if (typeof window !== 'undefined') {
        window.leaiEnvironment = environment;
        window.LEAI_ENVIRONMENT = environment.resolveEnvironment(
            window.location,
            window.LEAI_DEPLOYMENT_CONFIG,
        );
        if (window.LEAI_ENVIRONMENT.name === 'qa' && window.LEAI_ENVIRONMENT.known === true) {
            var documentLike = window.document;
            var config = window.LEAI_ENVIRONMENT;
            var instructorPage = /\/(?:InstructorHome|PromptDesigner|Customizations|CourseBanner|FeedbackAnalyzer|FeedbackChat|feedbackResponses)\.html$/.test(
                window.location.pathname || '',
            );
            var markerText = 'QA environment · identity checking · frontend build '
                + (config.buildId || 'unavailable')
                + ' · backend build checking · database schema checking · instructor changes disabled';

            function setInstructorInterfaceBlocked(blocked) {
                if (instructorPage && documentLike.body) documentLike.body.inert = blocked;
            }

            function addQaBanner() {
                if (documentLike.querySelector('.leai-environment-banner')) return;
                var target = documentLike.body || documentLike.documentElement;
                if (!target) return;
                var banner = documentLike.createElement('div');
                banner.className = 'leai-environment-banner';
                banner.setAttribute('role', 'status');
                banner.textContent = markerText;
                target.insertBefore(banner, target.firstChild || null);
                setInstructorInterfaceBlocked(true);
            }

            function applyIdentity(identity) {
                window.LEAI_ENVIRONMENT_IDENTITY = identity;
                var databaseSchema = identity.databaseSchema === 'leai_qa'
                    ? identity.databaseSchema
                    : 'unavailable';
                markerText = identity.verified
                    ? 'QA environment · test data only · database schema ' + databaseSchema
                        + ' · frontend build '
                        + identity.frontendBuildId + ' · backend build ' + identity.backendBuildId
                    : 'QA environment blocked · database schema ' + databaseSchema
                        + ' · frontend build '
                        + (identity.frontendBuildId || 'unavailable') + ' · backend build '
                        + (identity.backendBuildId || 'unavailable')
                        + ' · instructor changes disabled';
                var banner = documentLike.querySelector('.leai-environment-banner');
                if (banner) banner.textContent = markerText;
                setInstructorInterfaceBlocked(!identity.verified);
                return identity;
            }

            window.LEAI_ENVIRONMENT_IDENTITY = Object.freeze({
                verified: false,
                frontendBuildId: String(config.buildId || ''),
                backendBuildId: '',
                databaseSchema: '',
            });
            setInstructorInterfaceBlocked(true);
            if (documentLike.readyState === 'loading') {
                documentLike.addEventListener('DOMContentLoaded', addQaBanner);
            } else {
                addQaBanner();
            }
            window.LEAI_ENVIRONMENT_IDENTITY_READY = Promise.resolve()
                .then(function () {
                    return window.fetch(environment.requireApiBase(config) + '/environment/', {
                        method: 'GET',
                        headers: { Accept: 'application/json' },
                        cache: 'no-store',
                    });
                })
                .then(function (response) {
                    if (!response.ok) throw new Error('LEAI_QA_IDENTITY_UNAVAILABLE');
                    return response.json();
                })
                .then(function (payload) {
                    return applyIdentity(environment.evaluateQaIdentity(config, payload));
                })
                .catch(function () {
                    return applyIdentity(environment.evaluateQaIdentity(config, null));
                });
        }
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const QA_API_BASE = 'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api';
    const QA_PUBLIC_BASE = 'https://guii-lab.github.io/LEAI-QA/LEAI/';

    function normalizeBase(value) {
        return String(value || '').replace(/\/+$/, '') + '/';
    }

    function isLocalLocation(locationLike) {
        return locationLike.hostname === 'localhost' || locationLike.hostname === '127.0.0.1';
    }

    function isFixedQaLocation(locationLike) {
        return locationLike.hostname === 'guii-lab.github.io'
            && /^\/LEAI-QA\/LEAI(?:\/|$)/.test(locationLike.pathname || '');
    }

    function resolveEnvironment(locationLike, override) {
        if (override && override.environment === 'qa') {
            const valid = (isLocalLocation(locationLike) || isFixedQaLocation(locationLike))
                && override.apiBase === QA_API_BASE
                && override.publicBaseUrl === QA_PUBLIC_BASE;
            return Object.freeze({
                name: 'qa',
                apiBase: valid ? QA_API_BASE : '',
                publicBaseUrl: valid ? QA_PUBLIC_BASE : '',
                buildId: String(override.buildId || ''),
                emailEnabled: override.emailEnabled === true,
                known: valid,
            });
        }
        if (isLocalLocation(locationLike)) {
            return Object.freeze({
                name: 'local',
                apiBase: 'http://localhost:8000/datapipeline/api',
                publicBaseUrl: normalizeBase(locationLike.origin + '/LEAI/'),
                buildId: 'local', emailEnabled: false, known: true,
            });
        }
        if (locationLike.hostname === 'guii-lab.github.io'
                && /^\/LEAI(?:\/|$)/.test(locationLike.pathname || '')) {
            return Object.freeze({
                name: 'production',
                apiBase: 'https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api',
                publicBaseUrl: 'https://guii-lab.github.io/LEAI/',
                buildId: '', emailEnabled: false, known: true,
            });
        }
        return Object.freeze({
            name: 'unknown', apiBase: '', publicBaseUrl: '', buildId: '',
            emailEnabled: false, known: false,
        });
    }

    function requireApiBase(config) {
        if (!config || config.known !== true || !config.apiBase) {
            throw new Error('LEAI_UNKNOWN_ENVIRONMENT');
        }
        return config.apiBase;
    }

    function evaluateQaIdentity(config, payload) {
        var frontendBuildId = String(config && config.buildId || '').trim();
        var backendBuildId = String(payload && payload.build_id || '').trim();
        var databaseSchema = typeof (payload && payload.database_schema) === 'string'
            ? payload.database_schema
            : '';
        var verified = !!config
            && config.name === 'qa'
            && config.known === true
            && config.emailEnabled === false
            && frontendBuildId !== ''
            && !!payload
            && payload.environment === 'qa'
            && payload.email_enabled === false
            && backendBuildId !== ''
            && databaseSchema === 'leai_qa';
        return Object.freeze({
            verified: verified,
            frontendBuildId: frontendBuildId,
            backendBuildId: backendBuildId,
            databaseSchema: databaseSchema,
        });
    }

    function requireInstructorMutation(config, identity, options) {
        var method = String(options && options.method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
        if (config && config.name === 'qa' && config.known === true) {
            var buildId = String(config.buildId || '').trim();
            if (!identity
                    || identity.verified !== true
                    || !buildId
                    || identity.frontendBuildId !== buildId
                    || !String(identity.backendBuildId || '').trim()) {
                throw new Error('LEAI_QA_IDENTITY_UNVERIFIED');
            }
        }
    }

    function publicUrl(config, relativePath, query, hash) {
        if (!config || config.known !== true || !config.publicBaseUrl) {
            throw new Error('LEAI_UNKNOWN_ENVIRONMENT');
        }
        var path = String(relativePath || '');
        if (!path || /^\/+|^[a-z][a-z0-9+.-]*:/i.test(path)) {
            throw new Error('LEAI_PUBLIC_URL_PATH');
        }
        var base = new URL(config.publicBaseUrl);
        var url = new URL(path, base);
        if (url.href.slice(0, base.href.length) !== base.href) {
            throw new Error('LEAI_PUBLIC_URL_PATH');
        }
        if (query) url.search = new URLSearchParams(query).toString();
        if (hash) {
            var rawHash = String(hash);
            var separator = rawHash.indexOf('=');
            url.hash = separator === -1
                ? encodeURIComponent(rawHash)
                : rawHash.slice(0, separator + 1) + encodeURIComponent(rawHash.slice(separator + 1));
        }
        return url.href;
    }

    return Object.freeze({
        resolveEnvironment: resolveEnvironment,
        requireApiBase: requireApiBase,
        evaluateQaIdentity: evaluateQaIdentity,
        requireInstructorMutation: requireInstructorMutation,
        publicUrl: publicUrl,
    });
}));
