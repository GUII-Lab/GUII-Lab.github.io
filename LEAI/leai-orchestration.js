// The server owns orchestration, evidence and persistence. This client owns transport only.
(function (root) {
    'use strict';
    function createClient(options) {
        const transport = options.fetch || root.fetch.bind(root);
        let state = null;
        let pending = null;
        let consent = null;
        let busy = false;
        const identity = { public_id: options.publicId, session_id: options.sessionId };
        async function request(operation, body) {
            const response = await transport(options.api + '/form_orchestration/' + operation + '/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({}, identity, body)), cache: 'no-store',
            });
            const data = await response.json();
            if (!response.ok) {
                const error = new Error(data.error || 'Request failed');
                error.status = response.status;
                throw error;
            }
            return data;
        }
        async function resume() {
            state = await request('session', consent || {});
            return state;
        }
        async function submit() {
            if (busy) throw new Error('A request is already pending');
            busy = true;
            try {
                state = await request('turn', pending);
                pending = null;
                return state;
            } catch (error) {
                if (error.status === 400 || error.status === 422) pending = null;
                if (error.status === 409) {
                    // The user decides whether to send their text against the refreshed question.
                    pending = null;
                    await resume();
                }
                throw error;
            } finally { busy = false; }
        }
        return {
            async start(value) { consent = value; return resume(); },
            resume,
            async send(text) {
                if (!state) throw new Error('Session has not started');
                if (pending) throw new Error('A failed request is pending; retry it first');
                pending = { text, expected_version: state.version,
                    request_id: root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2) };
                return submit();
            },
            async retry() { if (!pending) throw new Error('No pending request'); return submit(); },
            async finalize() {
                if (busy || pending) throw new Error('Wait for your response to save first');
                try { return await request('finalize', { expected_version: state.version }); }
                catch (error) { if (error.status === 409) await resume(); throw error; }
            },
            getState() { return state; },
            getPending() { return pending && Object.assign({}, pending); },
        };
    }
    const api = { createClient };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.leaiOrchestration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
