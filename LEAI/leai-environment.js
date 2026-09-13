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
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeBase(value) {
        return String(value || '').replace(/\/+$/, '') + '/';
    }

    function isHttpsUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:' && url.hostname !== '';
        } catch (error) {
            return false;
        }
    }

    function resolveEnvironment(locationLike, override) {
        if (override && override.environment === 'qa') {
            const valid = isHttpsUrl(override.apiBase)
                && isHttpsUrl(override.publicBaseUrl);
            return Object.freeze({
                name: 'qa',
                apiBase: valid ? String(override.apiBase).replace(/\/$/, '') : '',
                publicBaseUrl: valid ? normalizeBase(override.publicBaseUrl) : '',
                buildId: String(override.buildId || ''),
                emailEnabled: override.emailEnabled === true,
                known: valid,
            });
        }
        if (locationLike.hostname === 'localhost' || locationLike.hostname === '127.0.0.1') {
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

    return Object.freeze({
        resolveEnvironment: resolveEnvironment,
        requireApiBase: requireApiBase,
    });
}));
