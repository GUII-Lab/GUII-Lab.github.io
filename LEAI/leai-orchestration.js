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
        function status(phase, operation, code) {
            // A display observer must never change whether an answer is persisted.
            if (options.onStatus) try { options.onStatus({phase, operation, status:code, version:state && state.version}); } catch (_) {}
        }
        async function request(operation, body) {
            status('waiting', operation);
            try {
            const response = await transport(options.api + '/form_orchestration/' + operation + '/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({}, identity, body)), cache: 'no-store',
            });
            const data = await response.json();
            if (!response.ok) {
                const error = new Error(data.error || 'Request failed');
                error.status = response.status;
                error.retryable = data.retryable === true;
                throw error;
            }
            status('saved', operation, response.status);
            return data;
            } catch (error) { status('failed', operation, error.status); throw error; }
        }
        async function resume() {
            state = await request('session', consent || {});
            return state;
        }
        async function submit() {
            if (busy) throw new Error('A request is already pending');
            busy = true;
            try {
                try {
                    state = await request('turn', pending);
                } catch (error) {
                    // Check persistence before retrying an uncertain result. Keep the
                    // same request ID so a disconnected success cannot save twice.
                    if (!error.status || error.status >= 500) {
                        const previous = state;
                        let restored;
                        try { restored = await resume(); } catch (_) { throw error; }
                        const appended = (restored.messages || []).slice((previous.messages || []).length);
                        if (restored.version === pending.expected_version + 1 && appended.some(message =>
                            message.sent_by === 'user-message' && message.content === pending.text)) {
                            state = restored;
                            status('recovered', 'turn');
                        } else if (restored.version !== pending.expected_version) {
                            pending = null;
                            const conflict = new Error('stale_turn'); conflict.status = 409;
                            throw conflict;
                        } else if (error.status === 503 && error.retryable) {
                            status('retrying', 'turn', error.status);
                            state = await request('turn', pending);
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
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
