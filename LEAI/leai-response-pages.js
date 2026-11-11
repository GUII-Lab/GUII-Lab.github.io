(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.leaiResponsePages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const key = row => String(row.gpt_id == null ? row.survey_id : row.gpt_id) + ':' + row.session_id;

    function hydrate(surveys) {
        return surveys.map(survey => {
            const sessions = {};
            Object.entries(survey.response_summaries || {}).forEach(([sid, summary]) => {
                // Metadata sentinels preserve existing progress/source semantics.
                // They are never passed off as conversation content.
                const rows = [];
                if (summary.student_count) rows.push({sent_by: 'user', source: summary.chat_count ? 'chat' : 'pdf', content: '', created_at: summary.first_at, summary_only: true});
                if (summary.pdf_count) rows.push({sent_by: 'student', source: 'pdf', content: '', pdf_batch_id: summary.pdf_batch_id, created_at: summary.first_at, summary_only: true});
                if (summary.chat_count && !summary.student_count) rows.push({sent_by: 'assistant', source: 'chat', content: '', summary_only: true});
                if (summary.nudged) rows.push({sent_by: 'assistant', referred: true, content: '', summary_only: true});
                sessions[sid] = rows;
            });
            return {...survey, sessions, structured_sessions: {}};
        });
    }

    function client(api, session, transport) {
        const fetcher = transport || fetch;
        const controller = new AbortController();
        const details = new Map();
        const pending = new Map();
        const waiting = [];
        let activeDetails = 0;
        let snapshot = null;
        function acquireDetail() {
            if (controller.signal.aborted) return Promise.reject(new DOMException('Response reader closed', 'AbortError'));
            if (activeDetails < 4) { activeDetails++; return Promise.resolve(); }
            return new Promise((resolve, reject) => waiting.push({resolve, reject}));
        }
        function releaseDetail() {
            const next = waiting.shift();
            if (next) next.resolve();
            else activeDetails--;
        }
        async function request(path, params, signal) {
            if (controller.signal.aborted) throw new DOMException('Response reader closed', 'AbortError');
            const query = new URLSearchParams({course_id: session.courseId, ...params});
            if (snapshot) query.set('snapshot', snapshot);
            const response = await fetcher(api + '/legacy_analyzer/' + path + '/?' + query, {
                signal: signal || controller.signal, cache: 'no-store',
                headers: {Authorization: 'Bearer ' + (session.response_export_token || '')}
            });
            const data = await response.json();
            if (controller.signal.aborted) throw new DOMException('Response reader closed', 'AbortError');
            if (!response.ok) {
                const error = new Error(response.status === 401 ? 'Sign in to this course again.' :
                    response.status === 409 ? 'Responses changed. Reload feedback to continue.' :
                    'Couldn’t load responses. Try again.');
                error.status = response.status;
                throw error;
            }
            return data;
        }
        return {
            surveys: () => request('surveys', {}),
            async bootstrap() {
                const data = await request('bootstrap', {});
                snapshot = data.snapshot;
                return hydrate(data.surveys);
            },
            page: (params, signal) => request('responses', params, signal),
            corpus: params => request('corpus', params),
            peek: row => details.get(key(row)),
            detail(row) {
                const id = key(row);
                if (details.has(id)) return Promise.resolve(details.get(id));
                if (pending.has(id)) return pending.get(id);
                const promise = acquireDetail().then(async () => {
                    try {
                        return await request('detail', {survey_id: row.gpt_id == null ? row.survey_id : row.gpt_id, session_id: row.session_id});
                    } finally { releaseDetail(); }
                })
                    .then(data => {
                        details.set(id, data);
                        if (details.size > 100) details.delete(details.keys().next().value);
                        return data;
                    }).finally(() => pending.delete(id));
                pending.set(id, promise);
                return promise;
            },
            destroy() {
                controller.abort();
                waiting.splice(0).forEach(item => item.reject(new DOMException('Response reader closed', 'AbortError')));
                details.clear(); pending.clear();
            }
        };
    }

    function pager(fetchPage, onChange) {
        let generation = 0;
        let controller = null;
        let params = {};
        let state = {};
        let pending = null;
        let seen = new Set();
        let disposed = false;
        function publish(extra) { state = {...state, ...extra}; onChange(state); }
        function loadMore() {
            if (disposed || pending || !state.hasMore) return pending || Promise.resolve();
            const current = generation;
            controller = new AbortController();
            const signal = controller.signal;
            publish({loading: true, error: null, added: []});
            const pageParams = {...params, ...(state.cursor ? {cursor: state.cursor} : {})};
            const request = Promise.resolve().then(() => fetchPage(pageParams, signal))
                .then(data => {
                    if (current !== generation) return;
                    const added = data.results.filter(row => {
                        const id = key(row);
                        if (seen.has(id)) return false;
                        seen.add(id); return true;
                    });
                    publish({rows: state.rows.concat(added), added, total: data.total,
                        hasMore: data.has_more, cursor: data.next_cursor, loading: false});
                }).catch(error => {
                    if (current === generation && error.name !== 'AbortError') publish({loading: false, error, added: []});
                }).finally(() => { if (current === generation) pending = null; });
            pending = request;
            return request;
        }
        return {
            reset(next) {
                generation++;
                disposed = false;
                if (controller) controller.abort();
                pending = null; params = next; seen = new Set();
                publish({rows: [], added: [], total: null, cursor: null, hasMore: true, loading: false, error: null});
                return loadMore();
            },
            loadMore,
            destroy() { disposed = true; generation++; if (controller) controller.abort(); pending = null; }
        };
    }
    return {client, pager, hydrate, key};
});
