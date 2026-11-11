/* Legacy course response export. The UUID selects; R labels only describe. */
(function (root) {
    'use strict';
    const consentLabels = {recorded: 'Yes', not_recorded: 'Not recorded', mixed: 'Needs review', unavailable: 'Needs review'};
    async function request(api, session, path, body, method, signal) {
        if (!session || !session.response_export_token) {
            const error = new Error('Sign in to this course again to export responses.');
            error.status = 401; throw error;
        }
        const res = await fetch(api + '/legacy_response_exports/' + path, {
            method: method || (body ? 'POST' : 'GET'), cache: 'no-store', signal,
            headers: {Authorization: 'Bearer ' + session.response_export_token, ...(body ? {'Content-Type': 'application/json'} : {})},
            ...(body ? {body: JSON.stringify(body)} : {})
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const error = new Error(res.status === 401 ? 'Sign in to this course again to export responses.' :
                data.error === 'export_disabled' ? 'Response export is off for this course.' :
                data.error === 'responses_changed' ? 'Response labels changed. Reload the list and confirm your selection.' :
                data.error === 'export_limit_exceeded' ? 'This selection is too large. Select fewer conversations.' :
                'Couldn’t export these responses. Try again.');
            error.status = res.status;
            throw error;
        }
        return path === 'download/' ? res : res.json();
    }
    function mountGear(api, session, input, status) {
        let available = false;
        let saved = false;
        async function load() {
            available = false;
            input.disabled = true;
            try {
                const data = await request(api, session, 'settings/?course_id=' + encodeURIComponent(session.courseId));
                input.checked = saved = data.enabled;
                available = true;
                status.textContent = '';
            } catch (error) { status.textContent = error.message; }
            input.disabled = !available;
        }
        load();
        return {async save() {
            if (!available) return;
            input.disabled = true;
            try {
                const data = await request(api, session, 'settings/', {course_id: session.courseId, enabled: input.checked}, 'PATCH');
                input.checked = saved = data.enabled;
                status.textContent = '';
            } catch (error) {
                try {
                    const data = await request(api, session, 'settings/?course_id=' + encodeURIComponent(session.courseId));
                    input.checked = saved = data.enabled;
                    status.textContent = 'Saved setting reloaded after a connection error.';
                } catch (_) {
                    available = false;
                    input.indeterminate = true;
                    status.textContent = 'Couldn’t verify the saved setting. Reload this page before changing response export.';
                }
                throw error;
            } finally { input.disabled = !available; }
        }};
    }
    function node(tag, text, className) {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (className) el.className = className;
        return el;
    }
    function startTime(value) {
        return value ? new Date(value).toLocaleString('en-US', {timeZone: 'America/Los_Angeles',
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'}) + ' PT' : 'Time unavailable';
    }
    function mountAnalyzer(api, session, getScope) {
        const header = document.querySelector('#student-responses-section .section-header');
        const button = node('button', 'Export…', 'btn btn-outline btn-sm');
        button.type = 'button'; button.hidden = true;
        header.insertBefore(button, document.getElementById('expand-all-btn'));
        const authStatus = node('p', '', 'response-export-help');
        authStatus.setAttribute('role', 'status');
        header.after(authStatus);
        const dialog = node('dialog', null, 'response-export-dialog');
        const title = node('h2', 'Export student responses'); title.id = 'response-export-title';
        title.tabIndex = -1;
        dialog.setAttribute('aria-labelledby', title.id);
        const scopeText = node('p', '', 'response-export-scope');
        const help = node('p', 'Includes all conversations in this week and response type.', 'response-export-help');
        const allLabel = node('label', '', 'response-export-all');
        const all = node('input'); all.type = 'checkbox';
        const count = node('span');
        allLabel.append(all, document.createTextNode(' Select all'), count);
        const list = node('div', null, 'response-export-list');
        const status = node('p', '', 'response-export-status'); status.setAttribute('role', 'status');
        const actions = node('div', null, 'modal-actions');
        const cancel = node('button', 'Cancel', 'btn btn-outline'); cancel.type = 'button';
        const reload = node('button', 'Reload list', 'btn btn-outline'); reload.type = 'button'; reload.hidden = true;
        const download = node('button', 'Download ZIP', 'btn btn-primary'); download.type = 'button';
        actions.append(cancel, reload, download);
        dialog.append(title, scopeText, help, allLabel, list, status, actions);
        document.body.append(dialog);
        let enabled = false;
        let rows = [];
        let selected = new Set();
        let busy = false;
        let current;
        let controller;
        let destroyed = false;
        function update() {
            const scope = getScope();
            button.hidden = !enabled;
            button.disabled = scope.kind !== 'week';
            button.title = button.disabled ? 'Choose a week to export responses.' : '';
        }
        async function loadSettings() {
            if (destroyed) return;
            try {
                enabled = (await request(api, session, 'settings/?course_id=' + encodeURIComponent(session.courseId))).enabled;
                authStatus.textContent = '';
            } catch (error) {
                enabled = false;
                authStatus.textContent = error.status === 401 ? 'Sign in again to check response export access.' : '';
            }
            if (!destroyed) update();
        }
        function updateSelection() {
            const available = rows.filter(r => r.exportable);
            all.checked = available.length > 0 && selected.size === available.length;
            all.indeterminate = selected.size > 0 && selected.size < available.length;
            all.disabled = busy || !available.length;
            count.textContent = selected.size + ' of ' + available.length + ' selected';
            download.disabled = busy || !selected.size;
            download.textContent = busy ? 'Preparing ZIP…' : selected.size ? 'Download ' + selected.size + (selected.size === 1 ? ' conversation' : ' conversations') : 'Download ZIP';
            list.querySelectorAll('input').forEach(input => {input.disabled = busy || !rows.find(r => r.conversation_id === input.value).exportable;});
        }
        function render() {
            list.replaceChildren();
            rows.forEach(row => {
                const label = node('label', null, 'response-export-row');
                const input = node('input'); input.type = 'checkbox'; input.value = row.conversation_id;
                input.checked = selected.has(row.conversation_id); input.disabled = !row.exportable;
                const text = node('span');
                const meta = node('span', row.message_count + ' messages · Research consent: ', 'response-export-meta');
                meta.append(node('span', consentLabels[row.consent] || consentLabels.unavailable,
                    'response-export-consent response-export-consent--' + row.consent));
                text.append(node('strong', row.response_id), node('span', startTime(row.started_at)), meta);
                if (row.unavailable_reason) text.append(node('span', row.unavailable_reason, 'response-export-meta'));
                input.addEventListener('change', () => {if (input.checked) selected.add(input.value); else selected.delete(input.value); updateSelection();});
                label.append(input, text); list.append(label);
            });
            updateSelection();
        }
        async function load(preserve) {
            controller?.abort(); controller = new AbortController();
            status.textContent = 'Loading conversations…'; list.replaceChildren();
            reload.hidden = true; busy = true; updateSelection();
            try {
                const data = await request(api, session, 'conversations/?' + new URLSearchParams(current), null, null, controller.signal);
                rows = data.conversations;
                selected = preserve ? new Set([...selected].filter(id => rows.some(r => r.conversation_id === id && r.exportable))) : new Set();
                status.textContent = rows.length ? (preserve ? 'List updated. Confirm your selection before downloading.' : '') : 'No conversations in this week and response type.';
            } catch (error) {
                if (error.name === 'AbortError') return;
                status.textContent = error.message; reload.hidden = false;
                if (error.status === 403) {enabled = false; update();}
                rows = []; selected.clear();
            } finally {busy = false; render();}
        }
        function close() {controller?.abort(); dialog.close(); button.focus();}
        cancel.addEventListener('click', close);
        dialog.addEventListener('cancel', () => controller?.abort());
        dialog.addEventListener('click', event => {if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) close();});
        dialog.addEventListener('close', () => {controller?.abort(); if (!destroyed) button.focus();});
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(el => !el.hidden && el.getClientRects().length);
            if (!focusable.length) return;
            const index = focusable.indexOf(document.activeElement);
            const next = index < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
                : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
            event.preventDefault(); focusable[next].focus();
        });
        all.addEventListener('change', () => {selected = all.checked ? new Set(rows.filter(r => r.exportable).map(r => r.conversation_id)) : new Set(); render();});
        reload.addEventListener('click', () => load(true));
        button.addEventListener('click', () => {
            const scope = getScope();
            current = {course_id: session.courseId, week_number: scope.weekNumber, mode: scope.mode};
            scopeText.textContent = session.courseName + ' · Week ' + scope.weekNumber + ' · ' + ({form:'Individual Reflections',group:'In-Group Feedback',general:'General Course Feedback'}[scope.mode]);
            rows = []; selected.clear(); dialog.showModal(); title.focus(); load(false);
        });
        download.addEventListener('click', async () => {
            if (busy || !selected.size) return;
            busy = true; updateSelection(); status.textContent = 'Preparing ZIP…';
            controller?.abort(); controller = new AbortController();
            try {
                const res = await request(api, session, 'download/', {...current,
                    selected: rows.filter(r => selected.has(r.conversation_id)).map(r => ({conversation_id:r.conversation_id,response_id:r.response_id}))}, null, controller.signal);
                const blob = await res.blob();
                if (!dialog.open || destroyed || controller.signal.aborted) return;
                const url = URL.createObjectURL(blob);
                const link = node('a'); link.href = url;
                link.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'responses.zip';
                document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                status.textContent = 'Download started · ' + selected.size + ' conversations';
            } catch (error) {
                if (error.name !== 'AbortError') {
                    status.textContent = error.message;
                    if (error.status === 409) reload.hidden = false;
                    if (error.status === 403) {enabled = false; update();}
                }
            } finally {busy = false; updateSelection();}
        });
        root.addEventListener('focus', loadSettings);
        loadSettings();
        return {update, destroy() {destroyed = true; controller?.abort(); root.removeEventListener('focus', loadSettings); dialog.remove(); button.remove(); authStatus.remove();}};
    }
    root.leaiResponseExport = {mountGear, mountAnalyzer};
})(window);
