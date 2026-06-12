/**
 * LEAI PDF reflection ingest UI
 *
 * Drives the instructor-facing drawer in FeedbackAnalyzer.
 *
 * Five-step state machine:
 *   1. files       — pick PDFs + attribute each to a student from roster
 *   2. processing  — server is parsing + mapping; show live progress, allow close
 *   3. review      — review-by-exception: show "needs attention" expanded,
 *                    "looks good" collapsed, "couldn't read" with re-upload
 *   4. commit      — modal with impact preview + dedup decisions
 *   5. success     — confirmation with link to Recent Uploads + Revert
 *
 * Public API:
 *   leaiPdfIngestUi.open({ survey, onCommitted, onClose })
 *   leaiPdfIngestUi.renderRecentBatchesPanel(containerEl, survey, opts)
 *
 * Depends on global `leaiPdfIngest` (API client from leai-shared.js)
 * and Tailwind utility classes.
 */
(function (root) {
    'use strict';

    var POLL_INTERVAL_MS = 2000;
    var POLL_BACKOFF_MAX_MS = 8000;
    var ACCEPT_TYPES = '.pdf,application/pdf';

    // Tab-title mutation helpers — let the instructor see processing
    // progress at a glance from the browser tab while doing other work.
    function updateTitle(state) {
        if (!state || state.phase !== 'processing') return;
        if (!state.originalTitle) state.originalTitle = document.title;
        var p = state.jobProgress || {};
        var total = p.total || (state.files || []).length;
        var processed = p.processed || 0;
        if (total > 0) {
            document.title = '◐ Reading ' + processed + '/' + total + ' PDFs · LEAI';
        } else {
            document.title = '◐ Reading PDFs · LEAI';
        }
    }
    function restoreTitle(state) {
        if (state && state.originalTitle) {
            document.title = state.originalTitle;
            state.originalTitle = null;
        }
    }

    // localStorage key holding {surveyId: jobId} for in-flight ingest jobs.
    // Lets us resume polling when the instructor closes the drawer mid-job
    // and reopens it later (a 50-PDF batch can outlast a coffee run).
    var INFLIGHT_KEY = 'leai.pdfIngest.inFlight';

    // Per-(survey, job) draft of in-progress review edits + skip toggles.
    // We restore this when the drawer reopens so an accidental close (or
    // browser refresh) never loses typed corrections. Keyed by survey id
    // so multiple surveys' drafts coexist.
    var DRAFT_KEY_PREFIX = 'leai.pdfIngest.draft.';
    var DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

    function _draftKey(surveyId) { return DRAFT_KEY_PREFIX + String(surveyId); }
    function readDraft(surveyId, jobId) {
        try {
            var raw = JSON.parse(localStorage.getItem(_draftKey(surveyId)) || 'null');
            if (!raw || raw.jobId !== jobId) return null;
            if ((Date.now() - (raw.savedAt || 0)) > DRAFT_TTL_MS) return null;
            return raw;
        } catch (e) { return null; }
    }
    function writeDraft(surveyId, jobId, edits, skips) {
        try {
            localStorage.setItem(_draftKey(surveyId), JSON.stringify({
                jobId: jobId, edits: edits, skips: skips, savedAt: Date.now(),
            }));
        } catch (e) { /* quota / private mode — ignore */ }
    }
    function clearDraft(surveyId) {
        try { localStorage.removeItem(_draftKey(surveyId)); } catch (e) {}
    }

    /** Count how many times the instructor has successfully committed
     *  via the drawer. Used to suppress the explainer + remember per-
     *  survey preferences after the user is no longer a first-timer. */
    var USE_COUNT_KEY = 'leai.pdfIngest.useCount';
    function incrementUseCount() {
        try {
            var n = parseInt(localStorage.getItem(USE_COUNT_KEY) || '0', 10) || 0;
            localStorage.setItem(USE_COUNT_KEY, String(n + 1));
            return n + 1;
        } catch (e) { return 0; }
    }
    function getUseCount() {
        try { return parseInt(localStorage.getItem(USE_COUNT_KEY) || '0', 10) || 0; }
        catch (e) { return 0; }
    }

    /** Per-survey dedup preference — if the instructor consistently
     *  picks 'replace' for the same survey, we default to it on the
     *  next ingest. Stored as a single value (not per-student) since
     *  it's about workflow style, not specific students. */
    var DEDUP_PREF_KEY_PREFIX = 'leai.pdfIngest.dedupPref.';
    function getDedupPref(surveyId) {
        try { return localStorage.getItem(DEDUP_PREF_KEY_PREFIX + surveyId) || ''; }
        catch (e) { return ''; }
    }
    function setDedupPref(surveyId, choice) {
        try { localStorage.setItem(DEDUP_PREF_KEY_PREFIX + surveyId, choice); }
        catch (e) {}
    }

    /** Debounced save — fires 600ms after the last edit so we don't
     *  hammer localStorage on every keystroke. Updates the
     *  auto-saved-at indicator in the action bar so the instructor
     *  can see their work is being preserved. */
    function scheduleDraftSave(state, ctx) {
        if (state._draftTimer) clearTimeout(state._draftTimer);
        // Show 'Saving…' immediately so the user feels the system
        // responding to their typing; the actual write happens on the
        // 600ms debounce.
        var ind = document.querySelector('[data-role="autosave-indicator"]');
        if (ind) {
            ind.textContent = 'Saving…';
            ind.classList.add('leai-pdf-autosave--pending');
        }
        state._draftTimer = setTimeout(function () {
            writeDraft(state.survey.id, state.jobId, state.edits, state.skips);
            state._lastSaveAt = Date.now();
            state._draftTimer = null;
            if (ind) {
                ind.textContent = 'Saved · ' + fmtClock(state._lastSaveAt);
                ind.classList.remove('leai-pdf-autosave--pending');
            }
            // Trigger a soft re-render only if a card's reviewed state
            // could have changed — i.e. on a low-conf cell going from
            // empty to non-empty (or vice-versa). The user has paused
            // typing 600ms, so caret-stealing is not a concern. We
            // restore focus to the active textarea afterwards.
            if (ctx && ctx.softRender) ctx.softRender();
        }, 600);
    }

    function fmtClock(ms) {
        var d = new Date(ms);
        var h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    function readInFlight() {
        try { return JSON.parse(localStorage.getItem(INFLIGHT_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function writeInFlight(map) {
        try { localStorage.setItem(INFLIGHT_KEY, JSON.stringify(map)); }
        catch (e) {}
    }
    function recordInFlight(surveyId, jobId) {
        var m = readInFlight();
        m[String(surveyId)] = jobId;
        writeInFlight(m);
    }
    function clearInFlight(surveyId) {
        var m = readInFlight();
        if (m[String(surveyId)]) { delete m[String(surveyId)]; writeInFlight(m); }
    }
    function getInFlight(surveyId) {
        return readInFlight()[String(surveyId)] || null;
    }

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'style' && typeof attrs[k] === 'object') {
                    Object.assign(node.style, attrs[k]);
                } else if (k === 'dataset') {
                    Object.keys(attrs[k]).forEach(function (dk) {
                        node.dataset[dk] = attrs[k][dk];
                    });
                } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
                    node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
                } else if (attrs[k] !== false && attrs[k] != null) {
                    node.setAttribute(k, attrs[k]);
                }
            });
        }
        (children || []).forEach(function (child) {
            if (child == null || child === false) return;
            if (typeof child === 'string') node.appendChild(document.createTextNode(child));
            else node.appendChild(child);
        });
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    /** Small slide-in toast within the drawer. Replaces alert() so an
     *  error doesn't yank the user out of the modal flow. variant:
     *  'error' (red), 'success' (green), 'info' (blue). Auto-dismisses
     *  after `ms` (default 4500), or never when ms === 0. */
    function showToast(message, variant, ms) {
        var existing = document.querySelector('.leai-pdf-toast');
        if (existing) existing.remove();
        variant = variant || 'info';
        var toast = el('div', {
            class: 'leai-pdf-toast leai-pdf-toast--' + variant,
            role: variant === 'error' ? 'alert' : 'status',
            'aria-live': variant === 'error' ? 'assertive' : 'polite',
        }, [
            el('span', { class: 'leai-pdf-toast__msg' }, [message]),
            el('button', {
                type: 'button', class: 'leai-pdf-toast__close', 'aria-label': 'Dismiss',
                onclick: function () { toast.remove(); },
            }, ['×']),
        ]);
        document.body.appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('leai-pdf-toast--in'); });
        if (ms !== 0) {
            setTimeout(function () {
                toast.classList.remove('leai-pdf-toast--in');
                setTimeout(function () { toast.remove(); }, 220);
            }, ms || 4500);
        }
    }

    /** Styled in-page confirm dialog (replaces window.confirm). Returns
     *  a Promise<boolean>. Looks like the rest of the drawer instead of
     *  the jarring OS-native modal. */
    function showConfirm(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var backdrop = el('div', { class: 'leai-pdf-confirm-backdrop' });
            var card = el('div', {
                class: 'leai-pdf-confirm', role: 'dialog', 'aria-modal': 'true',
                'aria-labelledby': 'leai-pdf-confirm-title',
            }, [
                el('div', { class: 'leai-pdf-confirm__title', id: 'leai-pdf-confirm-title' }, [opts.title || 'Are you sure?']),
                opts.body ? el('div', { class: 'leai-pdf-confirm__body' }, [opts.body]) : null,
                el('div', { class: 'leai-pdf-confirm__actions' }, [
                    el('button', {
                        class: 'leai-pdf-btn leai-pdf-btn--ghost',
                        onclick: function () { close(false); },
                    }, [opts.cancelLabel || 'Cancel']),
                    el('button', {
                        class: 'leai-pdf-btn ' + (opts.danger ? 'leai-pdf-btn--danger' : 'leai-pdf-btn--primary'),
                        onclick: function () { close(true); },
                    }, [opts.confirmLabel || 'Confirm']),
                ]),
            ]);
            function close(result) {
                document.removeEventListener('keydown', onKey, true);
                backdrop.remove();
                card.remove();
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); close(false); }
                if (e.key === 'Enter') { e.preventDefault(); close(true); }
            }
            backdrop.addEventListener('click', function () { close(false); });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(backdrop);
            document.body.appendChild(card);
            requestAnimationFrame(function () {
                backdrop.classList.add('leai-pdf-confirm-backdrop--in');
                card.classList.add('leai-pdf-confirm--in');
                var primary = card.querySelector(opts.danger ? '.leai-pdf-btn--danger' : '.leai-pdf-btn--primary');
                if (primary) try { primary.focus(); } catch (e) {}
            });
        });
    }

    /** Format a timestamp as a relative phrase ('2 hours ago') for items
     *  within the last 7 days, falling back to the absolute date for
     *  older entries. Keeps the Recent Uploads panel scannable. */
    function fmtRelative(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        var diffMs = Date.now() - d.getTime();
        var sec = Math.floor(diffMs / 1000);
        if (sec < 45) return 'just now';
        if (sec < 90) return 'a minute ago';
        var min = Math.floor(sec / 60);
        if (min < 45) return min + ' minutes ago';
        if (min < 90) return 'an hour ago';
        var hr = Math.floor(min / 60);
        if (hr < 24) return hr + ' hours ago';
        if (hr < 36) return 'yesterday';
        var days = Math.floor(hr / 24);
        if (days < 7) return days + ' days ago';
        return fmtDate(iso);
    }

    /** Map terse / generic backend error strings to friendlier copy at
     *  the boundary so the rest of the UI stays clean. */
    function humanizeError(err) {
        var msg = (err && err.message) || String(err || 'Something went wrong');
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
            return 'Couldn’t reach the server. Check your connection and try again.';
        }
        if (/Internal error/i.test(msg)) {
            return 'The server hit an unexpected error. Try again — if it keeps happening, please report it.';
        }
        if (/Method not allowed/i.test(msg)) {
            return 'This action isn’t available right now. Reload the page and try again.';
        }
        if (/Job not found/i.test(msg)) {
            return 'This processing job is no longer available. Start a new upload.';
        }
        if (/Survey not found/i.test(msg)) {
            return 'The survey was not found — it may have been deleted. Reload the page.';
        }
        if (/Batch already reverted/i.test(msg)) {
            return 'This batch was already reverted.';
        }
        if (/exceeds 10 MB/i.test(msg)) {
            return 'One of your PDFs is over 10 MB. Try splitting or compressing it.';
        }
        if (/Batch exceeds 50 MB/i.test(msg)) {
            return 'The batch total is over 50 MB. Upload in two smaller batches.';
        }
        return msg;
    }

    function fmtBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function fmtDate(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    /** Auto-match a filename like "alice-doe.pdf" against a roster of student_ids.
     *
     *  Scoring is bidirectional and tolerant of:
     *    - reordered names ('jane-doe.pdf' vs 'doe-jane')
     *    - partial overlaps ('janedoe.pdf' vs 'jane-doe' or 'doejaneucsc')
     *    - id-only filenames ('janed01.pdf' vs 'janed01')
     *    - inserted IDs ('alice-d-cs101-wk7.pdf' vs 'alice-d')
     *
     *  Returns the best-matching student_id when confidence is meaningful;
     *  '' if no roster entry shares enough signal with the filename.
     */
    function suggestStudent(filename, roster) {
        if (!roster || !roster.length) return '';
        // Split camelCase / PascalCase before lowercasing so 'SmithBob'
        // tokenises as ['smith','bob'] rather than fusing into one word.
        var camelSplit = filename.replace(/\.pdf$/i, '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .toLowerCase();
        var fileFlat = camelSplit.replace(/[^a-z0-9]+/g, '');
        var fileTokens = camelSplit.split(/[^a-z0-9]+/g).filter(Boolean);

        function score(sid) {
            var sLow = sid.toLowerCase();
            var sFlat = sLow.replace(/[^a-z0-9]+/g, '');
            var sTokens = sLow.split(/[^a-z0-9]+/g).filter(Boolean);
            if (!sFlat) return 0;

            var s = 0;
            // Strongest signal: the whole id appears as a substring of the
            // flat filename (or vice-versa for very short ids).
            if (fileFlat.indexOf(sFlat) !== -1) s += 6;
            else if (sFlat.indexOf(fileFlat) !== -1 && fileFlat.length >= 3) s += 3;

            // Per-token: each shared token (>=2 chars) counts. Length-3+ wins
            // a bonus to stop two-letter coincidences from carrying a match.
            sTokens.forEach(function (t) {
                if (t.length < 2) return;
                if (fileTokens.indexOf(t) !== -1) {
                    s += t.length >= 3 ? 2 : 1;
                } else if (t.length >= 4 && fileFlat.indexOf(t) !== -1) {
                    s += 1;  // token appears within the filename string
                }
            });
            return s;
        }

        var best = '';
        var bestScore = 0;
        var runnerUpScore = 0;
        roster.forEach(function (entry) {
            var s = score(entry.student_id || '');
            if (s > bestScore) {
                runnerUpScore = bestScore;
                bestScore = s;
                best = entry.student_id;
            } else if (s > runnerUpScore) {
                runnerUpScore = s;
            }
        });

        // Require a clear winner (at least 2 points and ahead of the runner-up)
        // so two students who share a first name don't flip-flop ambiguously.
        if (bestScore >= 2 && bestScore > runnerUpScore) return best;
        return '';
    }

    // ────────────────────────────────────────────────────────────────────────
    // Drawer

    function openDrawer(opts) {
        opts = opts || {};
        var survey = opts.survey;
        if (!survey || !survey.id) throw new Error('open() needs { survey }');

        if (root._activeDrawer && root._activeDrawer.survey.id === survey.id) {
            return root._activeDrawer;
        }
        if (root._activeDrawer) root._activeDrawer.close();

        var state = {
            survey: survey,
            phase: 'files',
            roster: [],
            files: [],
            jobId: null,
            jobItems: [],
            jobProgress: { processed: 0, total: 0 },
            jobError: '',
            prompts: [],
            edits: {},
            skips: {},
            dedupExisting: [],
            dedupChoices: {},
            commitResult: null,
            pollHandle: null,
            currentPollDelay: POLL_INTERVAL_MS,
        };

        var backdrop = el('div', { class: 'leai-pdf-backdrop' });
        var drawer = el('div', { class: 'leai-pdf-drawer', role: 'dialog', 'aria-modal': 'true' });
        var stepContainer = el('div', { class: 'leai-pdf-step' });

        function render() {
            clear(stepContainer);
            if (state.phase === 'files') stepContainer.appendChild(renderFilesStep(state, ctx));
            else if (state.phase === 'processing') stepContainer.appendChild(renderProcessingStep(state, ctx));
            else if (state.phase === 'review') stepContainer.appendChild(renderReviewStep(state, ctx));
            else if (state.phase === 'commit') stepContainer.appendChild(renderCommitStep(state, ctx));
            else if (state.phase === 'success') stepContainer.appendChild(renderSuccessStep(state, ctx));
        }

        function close(opts2) {
            opts2 = opts2 || {};
            var doClose = function () {
                if (state.pollHandle) clearTimeout(state.pollHandle);
                state.pollHandle = null;
                document.removeEventListener('keydown', onKeydown, true);
                if (state._popStateHandler) {
                    window.removeEventListener('popstate', state._popStateHandler);
                    state._popStateHandler = null;
                }
                // Pop our sentinel history entry so back-nav returns to
                // wherever the instructor was before opening the drawer.
                // Skipped when the close was itself triggered by popstate
                // (the browser already handled the navigation for us).
                if (state._pushedHistory && !opts2.skipHistoryPop) {
                    try { window.history.back(); } catch (e) {}
                }
                state._pushedHistory = false;
                restoreTitle(state);
                backdrop.remove();
                drawer.remove();
                if (root._activeDrawer === handle) root._activeDrawer = null;
                // Restore focus to whatever opened the drawer.
                if (state.previouslyFocused && typeof state.previouslyFocused.focus === 'function') {
                    try { state.previouslyFocused.focus(); } catch (e) {}
                }
                opts.onClose && opts.onClose(state.commitResult);
            };
            if (state.phase === 'review' && hasUnsavedEdits(state) && !opts2.skipConfirm) {
                showConfirm({
                    title: 'Close without saving your edits?',
                    body: 'Your typed corrections are auto-saved as a draft for 7 days, so they\'ll come back when you reopen this drawer.',
                    confirmLabel: 'Close anyway',
                    cancelLabel: 'Keep editing',
                    danger: true,
                }).then(function (ok) { if (ok) doClose(); });
                return;
            }
            doClose();
        }

        // True if the instructor has typed anything that differs from the
        // server's proposed mapping or marked any file to skip — guards
        // against losing review work via Esc / X.
        function hasUnsavedEdits(state) {
            if (Object.values(state.skips || {}).some(Boolean)) return true;
            return (state.jobItems || []).some(function (item) {
                var serverMap = item.mapping || {};
                var localMap = state.edits[item.filename] || {};
                return Object.keys(localMap).some(function (k) {
                    return (localMap[k] || '') !== (serverMap[k] || '');
                });
            });
        }

        // Esc closes the drawer; Tab/Shift+Tab cycles within the drawer
        // (focus trap) so keyboard users can't accidentally land on
        // analyzer elements behind the modal — standard a11y for dialogs.
        function onKeydown(e) {
            if (e.key === 'Escape' && state.phase !== 'processing') {
                e.preventDefault();
                close();
                return;
            }
            if (e.key === 'Tab') {
                trapTabKey(e);
            }
        }

        function trapTabKey(e) {
            var focusables = Array.prototype.slice.call(drawer.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), ' +
                'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(function (el) {
                // Hidden / zero-size elements should not be reachable.
                return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
            });
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            // If focus is currently outside the drawer, pull it back to the first
            // focusable inside — covers the case where focus escaped via mouse.
            if (!drawer.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
                return;
            }
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        var ctx = {
            state: state,
            opts: opts,
            render: render,
            close: close,
            startJob: function () { startJob(state, ctx); },
            commit: function () { commit(state, ctx, opts); },
            transition: function (phase) { state.phase = phase; render(); },
            // Soft re-render: re-renders the current step but restores
            // focus + selection to the active textarea so a re-render
            // mid-edit doesn't yank the caret. Used by the autosave
            // tail to refresh card-level reviewed state without
            // disrupting typing.
            softRender: function () {
                var active = document.activeElement;
                var sel = active && active.tagName === 'TEXTAREA'
                    ? { val: active.value, start: active.selectionStart, end: active.selectionEnd,
                        labelledby: active.getAttribute('aria-labelledby') }
                    : null;
                render();
                if (sel && sel.labelledby) {
                    var restored = document.querySelector(
                        'textarea[aria-labelledby="' + sel.labelledby + '"]'
                    );
                    if (restored) {
                        try {
                            restored.focus();
                            restored.setSelectionRange(sel.start, sel.end);
                        } catch (e) {}
                    }
                }
            },
        };

        var helpUrl = (opts.helpUrl) || 'instructor-guide.html#pdf-ingest';
        var header = el('div', { class: 'leai-pdf-drawer__header' }, [
            el('div', { class: 'leai-pdf-drawer__title-block' }, [
                el('div', { class: 'leai-pdf-drawer__title' }, ['Upload PDF reflections']),
                el('div', { class: 'leai-pdf-drawer__subtitle' }, [
                    survey.name + (survey.week_number ? ' · Week ' + survey.week_number : ''),
                ]),
            ]),
            el('div', { class: 'leai-pdf-drawer__header-actions' }, [
                el('a', {
                    class: 'leai-pdf-drawer__help',
                    href: helpUrl, target: '_blank', rel: 'noopener',
                    title: 'Open the instructor guide in a new tab',
                }, ['How does this work?']),
                el('button', { class: 'leai-pdf-drawer__close', 'aria-label': 'Close (Esc)', onclick: close }, ['×']),
            ]),
        ]);

        var footer = el('div', { class: 'leai-pdf-drawer__footer' }, [
            el('span', { class: 'leai-pdf-drawer__shortcut' }, ['Esc']),
            ' to close',
            el('span', { class: 'leai-pdf-drawer__footer-sep' }, ['·']),
            el('span', { class: 'leai-pdf-drawer__shortcut' }, ['Tab']),
            ' to navigate',
        ]);

        drawer.appendChild(header);
        drawer.appendChild(stepContainer);
        drawer.appendChild(footer);
        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);
        document.addEventListener('keydown', onKeydown, true);
        // Backdrop click closes too, mirroring native modal behaviour.
        backdrop.addEventListener('click', function () {
            if (state.phase !== 'processing') close();
        });
        // Remember the trigger element so we can restore focus on close.
        state.previouslyFocused = document.activeElement;

        // Browser back-button trap: push a sentinel state so the next
        // back nav fires popstate without leaving the analyzer. We
        // close the drawer instead. On real close (button/Esc) we pop
        // our own sentinel so back returns to wherever the user was.
        try {
            window.history.pushState({ leaiPdfDrawer: true }, '');
            state._pushedHistory = true;
        } catch (e) { /* sandboxed/no history */ }
        function onPopState(e) {
            if (root._activeDrawer === handle) {
                close({ skipHistoryPop: true });
            }
        }
        window.addEventListener('popstate', onPopState);
        state._popStateHandler = onPopState;

        requestAnimationFrame(function () {
            backdrop.classList.add('leai-pdf-backdrop--open');
            drawer.classList.add('leai-pdf-drawer--open');
        });
        // Slight delay so the click that opened us has fully settled before
        // we move focus — otherwise some browsers' default click-up action
        // can yank focus back to <body>.
        setTimeout(function () {
            var preferred = drawer.querySelector('.leai-pdf-dropzone, .leai-pdf-step__inner input, .leai-pdf-step__inner button, .leai-pdf-step__inner textarea');
            var fallback = drawer.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
            var target = preferred || fallback;
            if (target) {
                try { target.focus(); } catch (e) {}
            }
        }, 50);

        var handle = { state: state, close: close, render: render, survey: survey };
        root._activeDrawer = handle;

        leaiPdfIngest.getRoster(survey.id).then(function (roster) {
            state.roster = roster;
            state.files.forEach(function (f) {
                if (!f.studentId) {
                    f.studentId = suggestStudent(f.file.name, roster);
                    f.suggested = !!f.studentId;
                }
            });
            render();
        }).catch(function (e) {
            state.rosterError = e.message;
            render();
        });

        // Prefetch the survey's FormSchema so we can detect a 0-prompts
        // schema before the user even drops files. Best-effort — failure
        // here is non-blocking; the worker will surface the same issue
        // later if it really matters.
        if (survey.form_schema_id || survey.schema_id) {
            var schemaId = survey.form_schema_id || survey.schema_id;
            fetch(API + '/form_schemas/' + encodeURIComponent(schemaId) + '/')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (rec) {
                    if (!rec || !rec.body) return;
                    var sections = (rec.body.sections || []);
                    if (!sections.length) {
                        state.schemaEmpty = true;
                        render();
                    }
                })
                .catch(function () { /* non-blocking */ });
        }

        // Resume an in-flight job for this survey (e.g. instructor closed
        // the drawer while the worker was still processing a large batch).
        // If no in-flight job, also check for an unconfirmed draft from
        // a previously-completed job whose review the instructor abandoned.
        var inFlightJobId = getInFlight(survey.id);
        var draftRecord = null;
        if (!inFlightJobId) {
            try {
                draftRecord = JSON.parse(localStorage.getItem(_draftKey(survey.id)) || 'null');
                if (draftRecord && (Date.now() - (draftRecord.savedAt || 0)) > DRAFT_TTL_MS) {
                    clearDraft(survey.id);
                    draftRecord = null;
                }
            } catch (e) { draftRecord = null; }
        }
        var resumeJobId = inFlightJobId || (draftRecord && draftRecord.jobId);

        if (resumeJobId) {
            state.jobId = resumeJobId;
            state.phase = 'processing';
            leaiPdfIngest.pollJob(resumeJobId).then(function (resp) {
                state.jobItems = resp.items || [];
                state.jobProgress = resp.progress || state.jobProgress;
                state.prompts = resp.prompts || [];
                if (resp.status === 'ready' || resp.status === 'failed') {
                    handleJobFinished(state, ctx, resp);
                } else {
                    state.currentPollDelay = POLL_INTERVAL_MS;
                    schedulePoll(state, ctx);
                }
            }).catch(function () {
                // Job vanished (server restart, manually deleted, stale-
                // expired). Drop the markers and reset to files step.
                clearInFlight(survey.id);
                clearDraft(survey.id);
                state.jobId = null;
                state.phase = 'files';
                render();
            });
        }

        render();
        return handle;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 1 — files & attribution

    function renderFilesStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        // Defensive: if we know the survey's bound FormSchema has zero
        // prompts (set asynchronously by the schema-prefetch on open),
        // bail out with a clear message instead of silently rendering
        // an empty review screen later.
        if (state.schemaEmpty) {
            wrap.appendChild(el('div', { class: 'leai-pdf-banner leai-pdf-banner--warn' }, [
                'This survey’s structured-reflection schema has no prompts to match PDF sections against. ',
                'Add prompts to the survey first (in the Prompt Designer), then come back here.',
            ]));
            return wrap;
        }

        // First-time / occasional users see the full explainer; after a
        // few successful commits it collapses to a small "How this works"
        // expander so it stops competing with the dropzone for attention.
        var EXPLAIN_TEXT = 'Upload PDF reflections from students who used your template. ' +
            'We read each PDF, match its sections to this survey’s questions, and add the answers ' +
            'to your analysis below — alongside the chat responses. You’ll review the mapping ' +
            'before anything is saved, and every batch you commit can be reverted with one click.';
        if (getUseCount() < 3) {
            wrap.appendChild(el('p', { class: 'leai-pdf-explainer' }, [EXPLAIN_TEXT]));
        } else {
            wrap.appendChild(el('details', { class: 'leai-pdf-explainer-collapsed' }, [
                el('summary', {}, ['How this works']),
                el('p', { class: 'leai-pdf-explainer' }, [EXPLAIN_TEXT]),
            ]));
        }

        // Roster preview — sets expectations about who the system can
        // auto-match. Hidden until the roster fetch resolves so we don't
        // flicker an empty count.
        if (state.roster && state.roster.length) {
            var totalCount = state.roster.length;
            var chatCount = state.roster.filter(function (s) {
                return s.submitted_to_this_survey;
            }).length;
            var pdfCount = state.roster.filter(function (s) {
                return s.has_pdf_on_this_survey;
            }).length;
            var statBits = [
                el('span', { class: 'leai-pdf-roster-chip__count' }, [
                    String(totalCount) + ' student' + (totalCount === 1 ? '' : 's'),
                ]),
            ];
            // Detail bits only appear when meaningful (>0) so single-survey
            // courses don't see noisy zeroes.
            if (chatCount > 0) statBits.push(el('span', { class: 'leai-pdf-roster-chip__sub' }, [
                ' · ', String(chatCount), ' already submitted via chat',
            ]));
            if (pdfCount > 0) statBits.push(el('span', { class: 'leai-pdf-roster-chip__sub leai-pdf-roster-chip__sub--pdf' }, [
                ' · ', String(pdfCount), ' have a prior PDF on this survey',
            ]));
            var preview = el('div', { class: 'leai-pdf-roster-chip' },
                statBits.concat([
                    el('details', { class: 'leai-pdf-roster-chip__peek' }, [
                        el('summary', {}, ['Preview names']),
                        el('div', { class: 'leai-pdf-roster-chip__list' },
                            state.roster.slice(0, 12).map(function (s) {
                                var classes = 'leai-pdf-roster-chip__item';
                                if (s.has_pdf_on_this_survey) classes += ' leai-pdf-roster-chip__item--pdf';
                                return el('span', {
                                    class: classes,
                                    title: s.has_pdf_on_this_survey ? 'Already has a PDF reflection on this survey'
                                        : (s.submitted_to_this_survey ? 'Already submitted via chat' : ''),
                                }, [s.student_id]);
                            }).concat(state.roster.length > 12
                                ? [el('span', { class: 'leai-pdf-roster-chip__more' }, [
                                      '+' + (state.roster.length - 12) + ' more',
                                  ])]
                                : [])
                        ),
                    ]),
                ])
            );
            wrap.appendChild(preview);
        }

        var fileInput = el('input', {
            type: 'file',
            accept: ACCEPT_TYPES,
            multiple: '',
            style: { display: 'none' },
            onchange: function (ev) { addFiles(state, ctx, ev.target.files); ev.target.value = ''; },
        });
        var dzTitle = el('div', { class: 'leai-pdf-dropzone__title' }, ['Drop PDFs here or click to browse']);
        var dzHint = el('div', { class: 'leai-pdf-dropzone__hint' }, [
            'Up to 60 files, 10 MB each. PDFs with text only — scanned image PDFs won’t work.',
        ]);
        var defaultTitle = dzTitle.textContent;
        var defaultHint = dzHint.textContent;

        var dropzone = el('label', { class: 'leai-pdf-dropzone', tabindex: '0' }, [
            fileInput,
            el('div', { class: 'leai-pdf-dropzone__icon material-symbols-outlined' }, ['picture_as_pdf']),
            dzTitle,
            dzHint,
        ]);

        function setHoverState(hovering, fileCount) {
            dropzone.classList.toggle('leai-pdf-dropzone--hover', !!hovering);
            if (hovering && fileCount) {
                dzTitle.textContent = 'Drop ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ' to add';
                dzHint.textContent = 'PDF files will be queued for review';
            } else {
                dzTitle.textContent = defaultTitle;
                dzHint.textContent = defaultHint;
            }
        }
        ['dragenter', 'dragover'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault();
                // dataTransfer.items has counts during dragover; .files
                // is empty until drop. Count items where kind==='file'.
                var count = 0;
                if (e.dataTransfer && e.dataTransfer.items) {
                    for (var i = 0; i < e.dataTransfer.items.length; i++) {
                        if (e.dataTransfer.items[i].kind === 'file') count++;
                    }
                }
                setHoverState(true, count);
            });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault(); setHoverState(false, 0);
            });
        });
        dropzone.addEventListener('drop', function (e) {
            if (e.dataTransfer && e.dataTransfer.files) addFiles(state, ctx, e.dataTransfer.files);
        });
        wrap.appendChild(dropzone);

        if (state.rosterError) {
            wrap.appendChild(el('div', { class: 'leai-pdf-banner leai-pdf-banner--error' }, [
                'Couldn’t load the student list: ' + state.rosterError,
            ]));
        }

        if (state.files.length === 0) {
            return wrap;
        }

        // For batches over 5 files, surface a small filter so the
        // instructor can focus on the rows that actually need attention
        // (filename auto-match was empty or low-confidence).
        if (state.files.length > 5) {
            var unattributed = state.files.filter(function (f) { return !f.studentId; }).length;
            var autoMatched = state.files.filter(function (f) { return f.suggested; }).length;
            var currentFilter = state.fileFilter || 'all';
            var chips = [
                { value: 'all', label: 'All (' + state.files.length + ')' },
                { value: 'unattributed', label: 'Needs attribution (' + unattributed + ')', disabled: !unattributed },
                { value: 'auto', label: 'Auto-matched (' + autoMatched + ')', disabled: !autoMatched },
            ];
            var filterRow = el('div', { class: 'leai-pdf-file-filter' });
            chips.forEach(function (chip) {
                if (chip.disabled) return;
                filterRow.appendChild(el('button', {
                    type: 'button',
                    class: 'leai-pdf-file-filter__chip' + (currentFilter === chip.value ? ' leai-pdf-file-filter__chip--on' : ''),
                    onclick: function () { state.fileFilter = chip.value; ctx.render(); },
                }, [chip.label]));
            });
            wrap.appendChild(filterRow);
        }

        var fileList = el('div', { class: 'leai-pdf-file-list' });
        var visibleFiles = applyFileFilter(state.files, state.fileFilter || 'all');
        if (visibleFiles.length === 0 && state.files.length > 0) {
            fileList.appendChild(el('div', { class: 'leai-pdf-file-list__empty' }, [
                'No files match this filter. Switch to "All" to see them.',
            ]));
        }
        visibleFiles.forEach(function (entry) {
            // Use the entry's index in the unfiltered list so remove/edit
            // mutations target the right element.
            var origIdx = state.files.indexOf(entry);
            fileList.appendChild(renderFileRow(entry, origIdx, state, ctx));
        });
        wrap.appendChild(fileList);

        var attributedCount = state.files.filter(function (f) { return !!f.studentId; }).length;
        var ready = attributedCount === state.files.length && state.files.length > 0;
        // Rough wall-clock estimate based on observed pypdf throughput
        // (~2-3s per typical reflection PDF on Heroku) plus a small fixed
        // overhead. Conveys 'this could take a couple minutes for 40
        // files' without being misleadingly precise.
        var estSec = Math.max(2, Math.round(state.files.length * 2.5 + 2));
        var estText;
        if (estSec < 60) estText = 'about ' + estSec + ' seconds';
        else if (estSec < 120) estText = 'about a minute';
        else estText = 'about ' + Math.round(estSec / 60) + ' minutes';

        var actionRow = el('div', { class: 'leai-pdf-actions' }, [
            el('div', { class: 'leai-pdf-actions__status' }, [
                attributedCount + ' of ' + state.files.length + ' files attributed',
                el('span', { class: 'leai-pdf-actions__estimate' }, [' · ', estText]),
            ]),
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                disabled: ready ? false : 'disabled',
                onclick: function () { ctx.startJob(); },
            }, ['Process ' + state.files.length + ' file' + (state.files.length === 1 ? '' : 's')]),
        ]);
        wrap.appendChild(actionRow);

        return wrap;
    }

    function renderFileRow(entry, idx, state, ctx) {
        var row = el('div', { class: 'leai-pdf-file-row' });
        var meta = el('div', { class: 'leai-pdf-file-row__meta' }, [
            el('div', { class: 'leai-pdf-file-row__name' }, [entry.file.name]),
            el('div', { class: 'leai-pdf-file-row__size' }, [fmtBytes(entry.file.size)]),
        ]);

        var datalistId = 'leai-pdf-roster-' + idx;
        var input = el('input', {
            type: 'text',
            value: entry.studentId || '',
            placeholder: 'Student ID or name',
            'aria-label': 'Attribute "' + entry.file.name + '" to a student',
            list: datalistId,
            class: 'leai-pdf-file-row__input' + (entry.studentId ? '' : ' leai-pdf-file-row__input--empty'),
            oninput: function (e) {
                entry.studentId = e.target.value.trim();
                entry.suggested = false;
                e.target.classList.toggle('leai-pdf-file-row__input--empty', !entry.studentId);
                var parent = e.target.closest('.leai-pdf-step__inner');
                if (parent) {
                    var status = parent.querySelector('.leai-pdf-actions__status');
                    var btn = parent.querySelector('.leai-pdf-actions button');
                    var attributed = state.files.filter(function (f) { return !!f.studentId; }).length;
                    if (status) status.textContent = attributed + ' of ' + state.files.length + ' files attributed';
                    if (btn) btn.disabled = attributed === state.files.length ? false : 'disabled';
                }
            },
        });
        var datalist = el('datalist', { id: datalistId });
        state.roster.forEach(function (s) {
            datalist.appendChild(el('option', { value: s.student_id }, []));
        });
        var attribCol = el('div', { class: 'leai-pdf-file-row__attrib' }, [input, datalist]);
        if (entry.suggested) {
            attribCol.appendChild(el('div', { class: 'leai-pdf-file-row__hint' }, ['Auto-matched from filename — change if wrong']));
        }

        var removeBtn = el('button', {
            class: 'leai-pdf-file-row__remove',
            'aria-label': 'Remove file',
            onclick: function () {
                state.files.splice(idx, 1);
                ctx.render();
            },
        }, ['×']);

        row.appendChild(meta);
        row.appendChild(attribCol);
        row.appendChild(removeBtn);
        return row;
    }

    function applyFileFilter(files, filter) {
        if (filter === 'unattributed') return files.filter(function (f) { return !f.studentId; });
        if (filter === 'auto') return files.filter(function (f) { return f.suggested && f.studentId; });
        return files.slice();
    }

    function addFiles(state, ctx, fileList) {
        var existingNames = state.files.map(function (f) { return f.file.name; });
        var rejected = [];
        var duplicates = [];
        Array.prototype.forEach.call(fileList, function (file) {
            if (!file.name.toLowerCase().endsWith('.pdf')) {
                rejected.push(file.name);
                return;
            }
            if (existingNames.indexOf(file.name) !== -1) {
                duplicates.push(file.name);
                return;
            }
            var suggested = suggestStudent(file.name, state.roster);
            state.files.push({
                file: file,
                studentId: suggested,
                suggested: !!suggested,
            });
        });
        // Surface user-visible feedback for any files we silently
        // dropped — non-PDFs and duplicates are easy to miss otherwise.
        if (rejected.length) {
            var preview = rejected.slice(0, 3).join(', ') +
                (rejected.length > 3 ? ' and ' + (rejected.length - 3) + ' more' : '');
            showToast(
                'Only PDFs are supported — skipped: ' + preview,
                'error', 5500
            );
        }
        if (duplicates.length) {
            showToast(
                'Already staged — skipped duplicate: ' + duplicates[0] +
                (duplicates.length > 1 ? ' (+' + (duplicates.length - 1) + ' more)' : ''),
                'info', 4000
            );
        }
        ctx.render();
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 2 — processing

    function startJob(state, ctx) {
        var attribs = {};
        var files = state.files.map(function (f) {
            attribs[f.file.name] = f.studentId;
            return f.file;
        });
        // Pre-flight confirmation for batches over a handful — gives the
        // instructor one last chance to spot a wrong-survey upload before
        // committing minutes of worker time.
        var uniqueStudents = new Set(state.files.map(function (f) { return f.studentId; })).size;
        if (state.files.length >= 4 && !state.preflightConfirmed) {
            var msg = 'Process ' + state.files.length + ' PDF' + (state.files.length === 1 ? '' : 's') +
                      ' for ' + uniqueStudents + ' student' + (uniqueStudents === 1 ? '' : 's') +
                      ' into "' + state.survey.name + '"?\n\n' +
                      'You\'ll review the section mappings before anything is saved.';
            if (!confirm(msg)) return;
            state.preflightConfirmed = true;
        }
        ctx.transition('processing');
        updateTitle(state);
        leaiPdfIngest.startJob(state.survey.id, files, attribs)
            .then(function (resp) {
                state.jobId = resp.job_id;
                recordInFlight(state.survey.id, resp.job_id);
                state.jobItems = resp.items || [];
                state.jobProgress = resp.progress || state.jobProgress;
                state.prompts = resp.prompts || [];
                if (resp.status === 'ready' || resp.status === 'failed') {
                    handleJobFinished(state, ctx, resp);
                } else {
                    state.currentPollDelay = POLL_INTERVAL_MS;
                    schedulePoll(state, ctx);
                    updateTitle(state);
                }
            })
            .catch(function (err) {
                state.jobError = err.message;
                ctx.transition('files');
                showToast(humanizeError(err), 'error');
            });
    }

    function schedulePoll(state, ctx) {
        if (state.pollHandle) clearTimeout(state.pollHandle);
        state.pollHandle = setTimeout(function () { pollOnce(state, ctx); }, state.currentPollDelay);
    }

    function pollOnce(state, ctx) {
        if (!state.jobId) return;
        leaiPdfIngest.pollJob(state.jobId).then(function (resp) {
            state.jobItems = resp.items || [];
            state.jobProgress = resp.progress || state.jobProgress;
            state.prompts = resp.prompts || state.prompts;
            if (resp.status === 'ready' || resp.status === 'failed') {
                handleJobFinished(state, ctx, resp);
            } else {
                updateProcessingProgress(state);
                updateTitle(state);
                state.currentPollDelay = Math.min(state.currentPollDelay + 500, POLL_BACKOFF_MAX_MS);
                schedulePoll(state, ctx);
            }
        }).catch(function (err) {
            state.jobError = 'Lost connection: ' + err.message;
            ctx.render();
        });
    }

    function handleJobFinished(state, ctx, resp) {
        // Either way, the in-flight marker is no longer useful — the job
        // has reached a terminal state.
        clearInFlight(state.survey.id);
        restoreTitle(state);
        // If the instructor switched tabs while waiting on a long batch,
        // surface a system notification so they know to come back. Only
        // fires when permission was already granted — never auto-prompts.
        maybeNotifyComplete(state, resp);
        if (resp.status === 'failed') {
            state.jobError = resp.error || 'Processing failed.';
            ctx.render();
            return;
        }
        // Seed edits with the server mapping, then overlay any saved
        // draft from a previous session on this same job — so an
        // accidental close never costs typed corrections.
        state.edits = {};
        state.skips = {};
        state.jobItems.forEach(function (item) {
            state.edits[item.filename] = Object.assign({}, item.mapping || {});
        });
        var draft = readDraft(state.survey.id, state.jobId);
        if (draft) {
            // Overlay draft.edits cell-by-cell (preserve any new prompts
            // added since the draft was saved) and merge skips.
            Object.keys(draft.edits || {}).forEach(function (fname) {
                state.edits[fname] = Object.assign(
                    state.edits[fname] || {}, draft.edits[fname] || {}
                );
            });
            state.skips = Object.assign({}, draft.skips || {});
            state.draftRestored = true;
        }
        ctx.transition('review');
    }

    function maybeNotifyComplete(state, resp) {
        // Only when the tab is hidden AND the user has previously granted
        // notification permission for this origin. We do NOT call
        // requestPermission() — that would spawn an unwanted prompt.
        try {
            if (!('Notification' in window)) return;
            if (!document.hidden) return;
            if (Notification.permission !== 'granted') return;
            var total = (resp && resp.items && resp.items.length) || 0;
            var msg = resp && resp.status === 'failed'
                ? 'PDF ingest failed — open the upload panel to retry.'
                : 'Processed ' + total + ' PDF' + (total === 1 ? '' : 's') + ' — ready to review.';
            // eslint-disable-next-line no-new
            new Notification('LEAI · PDF reflections', { body: msg, silent: false });
        } catch (e) { /* notifications are best-effort */ }
    }

    function renderProcessingStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        if (state.jobError) {
            wrap.appendChild(el('div', { class: 'leai-pdf-banner leai-pdf-banner--error' }, [
                el('strong', {}, ['Processing failed.']),
                el('div', { style: { marginTop: '4px', fontSize: '12.5px' } }, [state.jobError]),
            ]));
            wrap.appendChild(el('div', { class: 'leai-pdf-banner__hint' }, [
                'Common causes: a network blip mid-batch, a corrupted PDF that crashed the parser, ',
                'or the server taking too long. Your files are still staged — retry will resubmit them.',
            ]));
            wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
                el('button', {
                    class: 'leai-pdf-btn leai-pdf-btn--ghost',
                    onclick: function () { state.jobError = ''; ctx.transition('files'); },
                }, ['Back to files']),
                el('button', {
                    class: 'leai-pdf-btn leai-pdf-btn--primary',
                    onclick: function () {
                        // Clear the error and re-spawn the same files
                        state.jobError = '';
                        state.jobId = null;
                        state.jobItems = [];
                        clearInFlight(state.survey.id);
                        ctx.startJob();
                    },
                }, ['Try again']),
            ]));
            return wrap;
        }

        var p = state.jobProgress || {};
        var totalFiles = p.total || state.files.length;
        var pct = totalFiles ? Math.round(((p.processed || 0) / totalFiles) * 100) : 0;

        wrap.appendChild(el('div', { class: 'leai-pdf-processing' }, [
            el('div', { class: 'leai-pdf-processing__spinner', 'aria-hidden': 'true' }),
            el('div', {
                class: 'leai-pdf-processing__title',
                dataset: { role: 'progress-title' },
                role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
            }, [progressTitleText(state)]),
            el('div', { class: 'leai-pdf-processing__current', dataset: { role: 'progress-current' } }, [
                progressCurrentText(state),
            ]),
            el('div', { class: 'leai-pdf-processing__hint' }, [
                'You can close this window — your job will keep running and the result will be waiting next time you reopen the upload panel.',
            ]),
            el('div', {
                class: 'leai-pdf-progress',
                role: 'progressbar',
                'aria-valuemin': '0', 'aria-valuemax': '100',
                'aria-valuenow': String(pct),
                'aria-valuetext': progressTitleText(state),
            }, [
                el('div', {
                    class: 'leai-pdf-progress__bar',
                    dataset: { role: 'progress-bar' },
                    style: { width: pct + '%' },
                }),
            ]),
            renderProgressDots(state),
        ]));

        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                onclick: function () { ctx.close(); },
            }, ['Close — keep processing']),
        ]));
        return wrap;
    }

    function progressTitleText(state) {
        var p = state.jobProgress || {};
        var totalFiles = p.total || state.files.length;
        var processed = p.processed || 0;
        if (processed >= totalFiles && totalFiles > 0) {
            return 'Wrapping up…';
        }
        return 'Reading ' + processed + ' of ' + totalFiles + '…';
    }

    function progressCurrentText(state) {
        // The next file the worker will process is at index `processed`
        // (since we update progress after each item completes). Show its
        // filename so the instructor sees concrete activity.
        var p = state.jobProgress || {};
        var processed = p.processed || 0;
        var items = state.jobItems || [];
        var pendingFile = items[processed];
        if (pendingFile && pendingFile.filename) {
            return pendingFile.filename;
        }
        // Fall back to the staged-files list when items haven't streamed back yet.
        var pendingStaged = (state.files || [])[processed];
        return pendingStaged ? pendingStaged.file.name : '';
    }

    function renderProgressDots(state) {
        var wrap = el('div', { class: 'leai-pdf-progress-dots', dataset: { role: 'progress-dots' } });
        var p = state.jobProgress || {};
        var total = p.total || state.files.length;
        var processed = p.processed || 0;
        var items = state.jobItems || [];
        for (var i = 0; i < total; i++) {
            var status;
            if (i < processed) {
                var item = items[i];
                status = item && item.status === 'failed' ? 'failed'
                       : item && item.status === 'low_conf' ? 'low'
                       : 'ok';
            } else if (i === processed) {
                status = 'now';
            } else {
                status = 'pending';
            }
            wrap.appendChild(el('span', {
                class: 'leai-pdf-progress-dot leai-pdf-progress-dot--' + status,
                title: (items[i] && items[i].filename) || (state.files[i] && state.files[i].file.name) || '',
            }, []));
        }
        return wrap;
    }

    function updateProcessingProgress(state) {
        var p = state.jobProgress || {};
        var totalFiles = p.total || state.files.length;
        var pct = totalFiles ? Math.round((p.processed / totalFiles) * 100) : 0;
        var bar = document.querySelector('[data-role="progress-bar"]');
        var title = document.querySelector('[data-role="progress-title"]');
        var current = document.querySelector('[data-role="progress-current"]');
        var dots = document.querySelector('[data-role="progress-dots"]');
        var progressbar = document.querySelector('.leai-pdf-progress');
        if (bar && totalFiles) bar.style.width = pct + '%';
        if (title) title.textContent = progressTitleText(state);
        if (current) current.textContent = progressCurrentText(state);
        if (dots && dots.parentNode) dots.parentNode.replaceChild(renderProgressDots(state), dots);
        // Keep the ARIA progressbar values in sync with the visual bar so
        // screen readers announce 'X of Y' as it advances.
        if (progressbar) {
            progressbar.setAttribute('aria-valuenow', String(pct));
            progressbar.setAttribute('aria-valuetext', progressTitleText(state));
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 3 — review-by-exception

    function renderReviewStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        // One-time banner: tell the instructor we restored their work.
        if (state.draftRestored) {
            wrap.appendChild(el('div', { class: 'leai-pdf-banner leai-pdf-banner--info' }, [
                'We restored the edits you had in progress when this drawer was last closed. ',
                el('button', {
                    class: 'leai-pdf-banner__action',
                    onclick: function () {
                        // Discard draft and re-seed from the server mapping.
                        clearDraft(state.survey.id);
                        state.edits = {};
                        state.skips = {};
                        state.jobItems.forEach(function (item) {
                            state.edits[item.filename] = Object.assign({}, item.mapping || {});
                        });
                        state.draftRestored = false;
                        ctx.render();
                    },
                }, ['Discard draft']),
            ]));
            // Show only once per render-flow; subsequent renders see fresh state.
            state.draftRestored = false;
        }
        // Stable alphabetical-by-filename sort within each status bucket
        // so a 40-card review screen is scannable. Original arrival order
        // doesn't carry meaning here (worker processes in the order the
        // browser uploaded, which is itself unspecified).
        var byName = function (a, b) { return (a.filename || '').localeCompare(b.filename || ''); };
        var query = (state.reviewSearch || '').trim().toLowerCase();
        var matches = function (item) {
            if (!query) return true;
            return (item.filename || '').toLowerCase().indexOf(query) !== -1
                || (item.student_id || '').toLowerCase().indexOf(query) !== -1;
        };
        var ok = state.jobItems.filter(function (i) { return i.status === 'ok' && matches(i); }).sort(byName);
        var lowConf = state.jobItems.filter(function (i) { return i.status === 'low_conf' && matches(i); }).sort(byName);
        var failed = state.jobItems.filter(function (i) { return i.status === 'failed' && matches(i); }).sort(byName);

        var bannerClass = (failed.length || lowConf.length) ? 'leai-pdf-banner--warn' : 'leai-pdf-banner--ok';
        var banner = el('div', {
            class: 'leai-pdf-banner ' + bannerClass,
            role: 'status', 'aria-live': 'polite',
        });
        banner.appendChild(document.createTextNode(
            state.jobItems.length + ' PDF' + (state.jobItems.length === 1 ? '' : 's') + ' processed.'
        ));
        var pieces = [];
        if (ok.length) pieces.push(el('strong', {}, [ok.length + ' mapped cleanly']));
        if (lowConf.length) pieces.push(el('strong', {}, [lowConf.length + ' need' + (lowConf.length === 1 ? 's' : '') + ' your attention']));
        if (failed.length) pieces.push(el('strong', {}, [failed.length + ' couldn’t be read']));
        pieces.forEach(function (piece) {
            banner.appendChild(document.createTextNode(' · '));
            banner.appendChild(piece);
        });
        wrap.appendChild(banner);

        // Search input — only when the batch is big enough for finding
        // a specific student to be tedious. Filters by filename or
        // student_id; matches across all status buckets.
        if (state.jobItems.length >= 8) {
            var searchInput = el('input', {
                type: 'search',
                class: 'leai-pdf-review-search',
                placeholder: 'Find a file or student…',
                value: state.reviewSearch || '',
                'aria-label': 'Filter review cards by filename or student',
                oninput: function (e) {
                    state.reviewSearch = e.target.value;
                    // Re-render preserves caret position because the
                    // value attr is round-tripped through state and
                    // re-applied before the input loses focus on the
                    // immediate microtask. Big batches (40 cards) still
                    // re-render in <30ms.
                    ctx.render();
                    var fresh = document.querySelector('.leai-pdf-review-search');
                    if (fresh) {
                        fresh.focus();
                        fresh.setSelectionRange(state.reviewSearch.length, state.reviewSearch.length);
                    }
                },
            });
            wrap.appendChild(searchInput);
        }

        if (lowConf.length) {
            // Bulk-fill bar: when the same prompt is missing across many
            // PDFs (template phrasing drift), instructor types once and
            // applies to every empty cell — turns 30 paste actions into 1.
            wrap.appendChild(renderBulkFillBar(lowConf, state, ctx));
            wrap.appendChild(renderReviewGroup('Needs attention', lowConf, true, state, ctx));
        }
        if (failed.length) {
            wrap.appendChild(renderFailedGroup(failed, state, ctx));
        }
        if (ok.length) {
            wrap.appendChild(renderReviewGroup('Looks good (' + ok.length + ')', ok, false, state, ctx));
        }
        if (query && !ok.length && !lowConf.length && !failed.length) {
            wrap.appendChild(el('div', { class: 'leai-pdf-review-search__empty' }, [
                'No files match "' + query + '". Clear the search to see all.',
            ]));
        }

        var commitable = state.jobItems.some(function (i) { return i.status !== 'failed'; });
        var saveLabel = state._lastSaveAt
            ? 'Saved · ' + fmtClock(state._lastSaveAt)
            : 'Edits auto-save as you type';
        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                onclick: function () { ctx.transition('files'); },
            }, ['Back to files']),
            el('span', {
                class: 'leai-pdf-autosave',
                dataset: { role: 'autosave-indicator' },
                title: 'Your typed corrections persist for 7 days even if you close the drawer.',
            }, [saveLabel]),
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                disabled: commitable ? false : 'disabled',
                onclick: function () { prepareCommit(state, ctx); },
            }, ['Continue to commit']),
        ]));

        return wrap;
    }

    /** Counts of empty cells per prompt across the items in scope.
     *  Used to drive the bulk-fill bar — only show prompts that are
     *  empty in 2+ items, since 1-of-1 doesn't justify a bulk action. */
    function countEmptyByPrompt(items, state) {
        var counts = {};
        items.forEach(function (item) {
            var mapping = state.edits[item.filename] || {};
            (item.low_conf_prompts || []).forEach(function (pid) {
                if (!(mapping[pid] || '').trim()) {
                    counts[pid] = (counts[pid] || 0) + 1;
                }
            });
        });
        return counts;
    }

    function renderBulkFillBar(lowConfItems, state, ctx) {
        var emptyByPrompt = countEmptyByPrompt(lowConfItems, state);
        var prompts = state.prompts.filter(function (p) {
            return (emptyByPrompt[p.prompt_id] || 0) >= 2;
        });
        if (!prompts.length) return el('span', { style: { display: 'none' } }, []);

        var wrap = el('div', { class: 'leai-pdf-bulkfill' }, [
            el('div', { class: 'leai-pdf-bulkfill__title' }, [
                'Bulk fill — same answer, multiple students',
            ]),
            el('div', { class: 'leai-pdf-bulkfill__hint' }, [
                'If many students missed the same section because the template heading drifted, ',
                'paste their answers once and apply to every empty cell at the same time.',
            ]),
        ]);
        prompts.forEach(function (p) {
            wrap.appendChild(renderBulkFillRow(p, emptyByPrompt[p.prompt_id], lowConfItems, state, ctx));
        });
        return wrap;
    }

    function renderBulkFillRow(prompt, emptyCount, lowConfItems, state, ctx) {
        var row = el('div', { class: 'leai-pdf-bulkfill__row' });
        var label = el('div', { class: 'leai-pdf-bulkfill__label' }, [
            el('strong', {}, [prompt.title || prompt.prompt_id]),
            el('span', { class: 'leai-pdf-bulkfill__count' }, [
                emptyCount + ' empty',
            ]),
        ]);
        var input = el('textarea', {
            class: 'leai-pdf-bulkfill__textarea',
            placeholder: 'Paste an answer to apply to every empty ' +
                (prompt.title || prompt.prompt_id) + ' cell…',
            rows: '2',
        });
        var apply = el('button', {
            class: 'leai-pdf-btn leai-pdf-btn--ghost leai-pdf-btn--sm',
            onclick: function () {
                var value = (input.value || '').trim();
                if (!value) {
                    showToast('Type an answer first, then click Apply.', 'info');
                    return;
                }
                if (!confirm('Apply this text to ' + emptyCount + ' empty "' +
                    (prompt.title || prompt.prompt_id) + '" cells?')) return;
                var applied = 0;
                lowConfItems.forEach(function (item) {
                    if ((item.low_conf_prompts || []).indexOf(prompt.prompt_id) === -1) return;
                    state.edits[item.filename] = state.edits[item.filename] || {};
                    var existing = state.edits[item.filename][prompt.prompt_id] || '';
                    if (existing.trim()) return; // never overwrite non-empty
                    state.edits[item.filename][prompt.prompt_id] = value;
                    applied++;
                });
                writeDraft(state.survey.id, state.jobId, state.edits, state.skips);
                input.value = '';
                ctx.render();
            },
        }, ['Apply to ' + emptyCount + ' empty']);
        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(apply);
        return row;
    }

    function renderReviewGroup(label, items, expandedByDefault, state, ctx) {
        var wrap = el('details', {
            class: 'leai-pdf-review-group',
            open: expandedByDefault ? '' : false,
        });
        wrap.appendChild(el('summary', { class: 'leai-pdf-review-group__summary' }, [label]));
        items.forEach(function (item) {
            wrap.appendChild(renderReviewCard(item, state, ctx));
        });
        return wrap;
    }

    function renderFailedGroup(items, state, ctx) {
        var wrap = el('details', { class: 'leai-pdf-review-group leai-pdf-review-group--failed', open: '' });
        wrap.appendChild(el('summary', { class: 'leai-pdf-review-group__summary' }, ['Couldn’t read (' + items.length + ')']));
        items.forEach(function (item) {
            wrap.appendChild(el('div', { class: 'leai-pdf-failed-card' }, [
                el('div', { class: 'leai-pdf-failed-card__name' }, [item.filename]),
                el('div', { class: 'leai-pdf-failed-card__error' }, [item.error || 'Unknown error']),
                el('div', { class: 'leai-pdf-failed-card__hint' }, [
                    'Try re-exporting as a text-based PDF (scanned images won’t work), then replace just this file:',
                ]),
                el('button', {
                    class: 'leai-pdf-btn leai-pdf-btn--ghost leai-pdf-btn--sm',
                    onclick: function () { reuploadSingleFile(item, state, ctx); },
                }, ['Replace this file']),
            ]));
        });
        return wrap;
    }

    /** Open a file picker scoped to a single file, replace just that one
     *  in state.files (preserving attribution), and re-process the batch.
     *  Lets the instructor recover from a single bad PDF without redoing
     *  the whole upload + attribution dance. */
    function reuploadSingleFile(failedItem, state, ctx) {
        var picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = ACCEPT_TYPES;
        picker.style.display = 'none';
        picker.addEventListener('change', function (ev) {
            var file = ev.target.files && ev.target.files[0];
            if (!file) return;
            // Wipe previous state.files and stage just the corrected file
            // attributed to the failed item's student. Then jump back to
            // the files step so the instructor sees the queued upload
            // before processing.
            state.files = [{
                file: file,
                studentId: failedItem.student_id || suggestStudent(file.name, state.roster),
                suggested: !failedItem.student_id,
            }];
            state.jobItems = [];
            state.jobId = null;
            state.edits = {};
            state.skips = {};
            ctx.transition('files');
            picker.remove();
        });
        document.body.appendChild(picker);
        picker.click();
    }

    function renderReviewCard(item, state, ctx) {
        // 'Reviewed' if every previously-low-confidence cell now has a
        // value (either via instructor edit or because the parser
        // actually got it). Gives a sense of progress through a long
        // batch — once all needs-attention cells are filled, the card
        // earns a green check in its header.
        var lowPrompts = item.low_conf_prompts || [];
        var edits = state.edits[item.filename] || {};
        var allLowFilled = lowPrompts.length === 0 || lowPrompts.every(function (pid) {
            var v = (edits[pid] != null ? edits[pid] : (item.mapping && item.mapping[pid])) || '';
            return v.trim().length > 0;
        });
        var isReviewed = item.status !== 'failed' && !state.skips[item.filename] && allLowFilled
            && (lowPrompts.length > 0 || item.status === 'low_conf');

        var cardClasses = 'leai-pdf-review-card'
            + (item.status === 'low_conf' ? ' leai-pdf-review-card--low' : '')
            + (isReviewed ? ' leai-pdf-review-card--reviewed' : '');
        var card = el('div', { class: cardClasses });
        var skipState = !!state.skips[item.filename];
        var head = el('div', { class: 'leai-pdf-review-card__head' }, [
            el('div', {}, [
                el('div', { class: 'leai-pdf-review-card__name' }, [
                    item.filename,
                    isReviewed ? el('span', {
                        class: 'leai-pdf-review-card__check material-symbols-outlined',
                        title: 'All needs-attention cells are filled',
                        'aria-label': 'Reviewed',
                    }, ['check']) : null,
                ]),
                el('div', { class: 'leai-pdf-review-card__student' }, ['Attributed to: ', el('strong', {}, [item.student_id || '—'])]),
            ]),
            el('label', { class: 'leai-pdf-review-card__skip' }, [
                el('input', {
                    type: 'checkbox',
                    checked: skipState ? '' : false,
                    onchange: function (e) {
                        state.skips[item.filename] = !!e.target.checked;
                        writeDraft(state.survey.id, state.jobId, state.edits, state.skips);
                    },
                }),
                'Skip this PDF',
            ]),
        ]);
        card.appendChild(head);

        var cells = el('div', { class: 'leai-pdf-review-card__cells' });
        var safeFilename = (item.filename || '').replace(/[^a-z0-9]+/gi, '-');
        state.prompts.forEach(function (p) {
            var pid = p.prompt_id;
            var current = state.edits[item.filename] && state.edits[item.filename][pid];
            if (current == null) current = (item.mapping && item.mapping[pid]) || '';
            var isLow = (item.low_conf_prompts || []).indexOf(pid) !== -1;
            var isAi = (item.ai_assisted_prompts || []).indexOf(pid) !== -1;
            // Stable id pair so the textarea's aria-labelledby points at
            // the visible label — screen readers announce 'Methods in
            // Practice, low confidence' when the textarea is focused.
            var labelId = 'leai-pdf-cell-label-' + safeFilename + '-' + pid;
            var labelChildren = [p.title || pid];
            if (isAi) {
                // Sparkle badge — instructor knows the parser's regex
                // missed this one and the AI second-pass guessed it.
                // Worth a closer look + tooltip explaining the source.
                labelChildren.push(el('span', {
                    class: 'leai-pdf-review-cell__aibadge',
                    title: 'The regex parser missed this section, so this answer was filled in by an AI second-pass. Worth a quick check.',
                    'aria-label': 'AI-filled value, please verify',
                    tabindex: '0',
                }, ['AI']));
            }
            if (p.opening_prompt) {
                labelChildren.push(el('button', {
                    type: 'button',
                    class: 'leai-pdf-review-cell__info',
                    'aria-label': 'Show full prompt for ' + (p.title || pid),
                    'data-tooltip': 'Survey prompt: ' + p.opening_prompt,
                    tabindex: '0',
                }, ['ⓘ']));
            }
            if (isLow) {
                // Tooltip explains what 'couldn't find' means in plain
                // language so the instructor isn't left guessing whether
                // it's a parser bug or an actual missing answer.
                labelChildren.push(el('span', {
                    class: 'leai-pdf-review-cell__warn',
                    title: 'The PDF didn’t contain a heading that matches this question — paste the student’s answer here, or leave blank if they didn’t respond.',
                    tabindex: '0',
                }, ['needs your eyes']));
            }
            // Per-cell restore button: always rendered but hidden via
            // the cell's --edited modifier when the textarea matches
            // the server's original mapping. Toggling visibility via
            // class lets us avoid a full re-render on every keystroke.
            var serverValue = (item.mapping && item.mapping[pid]) || '';
            var hasEdit = (current || '') !== serverValue;
            var restoreBtn = el('button', {
                type: 'button',
                class: 'leai-pdf-review-cell__restore',
                title: 'Restore the original value the parser proposed',
                'aria-label': 'Restore original ' + (p.title || pid) + ' value',
                onclick: function () {
                    state.edits[item.filename] = state.edits[item.filename] || {};
                    state.edits[item.filename][pid] = serverValue;
                    scheduleDraftSave(state, ctx);
                    ctx.render();
                },
            }, [el('span', { class: 'material-symbols-outlined' }, ['undo'])]);
            labelChildren.push(restoreBtn);

            var cellClass = 'leai-pdf-review-cell'
                + (isLow ? ' leai-pdf-review-cell--low' : '')
                + (hasEdit ? ' leai-pdf-review-cell--edited' : '');
            var cell = el('div', { class: cellClass }, [
                el('div', { class: 'leai-pdf-review-cell__label', id: labelId }, labelChildren),
                el('textarea', {
                    class: 'leai-pdf-review-cell__textarea',
                    'aria-labelledby': labelId,
                    'aria-describedby': isLow ? labelId + '-warn' : null,
                    placeholder: isLow
                        ? 'Paste this student’s answer here, or leave blank if they didn’t respond.'
                        : '',
                    rows: '4',
                    oninput: function (e) {
                        state.edits[item.filename] = state.edits[item.filename] || {};
                        state.edits[item.filename][pid] = e.target.value;
                        // Debounced auto-save so even a partial paste is
                        // recoverable after an accidental close.
                        scheduleDraftSave(state, ctx);
                        // Toggle the cell's --edited modifier so the
                        // restore button appears/hides without a full
                        // re-render (which would lose caret position).
                        var nowEdited = e.target.value !== serverValue;
                        cell.classList.toggle('leai-pdf-review-cell--edited', nowEdited);
                    },
                }, [current || '']),
            ]);
            cells.appendChild(cell);
        });
        card.appendChild(cells);

        if (item.preamble) {
            card.appendChild(el('details', { class: 'leai-pdf-review-card__preamble' }, [
                el('summary', {}, ['Unmatched header text (cover page / instructions)']),
                el('pre', {}, [item.preamble]),
            ]));
        }

        // 'Show what we read' — full extracted text on demand. Useful
        // when a section was flagged low-confidence and the instructor
        // wants to see exactly what the parser saw before re-typing
        // (or to copy-paste a chunk into a cell).
        if (item.extracted_text) {
            card.appendChild(el('details', { class: 'leai-pdf-review-card__extracted' }, [
                el('summary', {}, ['Show what we read from this PDF']),
                el('div', { class: 'leai-pdf-review-card__extracted-hint' }, [
                    'The full extracted text below is what the parser worked with. ',
                    'You can copy chunks from here into the answer cells above.',
                ]),
                el('pre', {}, [item.extracted_text]),
            ]));
        }

        return card;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 4 — commit

    function prepareCommit(state, ctx) {
        var committingStudents = {};
        state.jobItems.forEach(function (item) {
            if (item.status === 'failed') return;
            if (state.skips[item.filename]) return;
            if (item.student_id) committingStudents[item.student_id] = true;
        });
        var ids = Object.keys(committingStudents);
        leaiPdfIngest.dedupCheck(state.survey.id, ids).then(function (existing) {
            state.dedupExisting = existing;
            // Pre-fill from per-survey preference if available (instructor
            // has consistently picked the same option before); otherwise
            // default to 'skip' as the safest behaviour.
            var pref = getDedupPref(state.survey.id);
            existing.forEach(function (sid) {
                if (!state.dedupChoices[sid]) {
                    state.dedupChoices[sid] = pref || 'skip';
                }
            });
            ctx.transition('commit');
        }).catch(function (err) {
            showToast(humanizeError(err), 'error');
        });
    }

    function renderCommitStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        var totalMessages = 0;
        var students = {};
        state.jobItems.forEach(function (item) {
            if (item.status === 'failed' || state.skips[item.filename]) return;
            var mapping = state.edits[item.filename] || {};
            Object.keys(mapping).forEach(function (k) {
                if ((mapping[k] || '').trim()) totalMessages++;
            });
            if (item.student_id) students[item.student_id] = true;
        });
        var studentCount = Object.keys(students).length;

        wrap.appendChild(el('div', { class: 'leai-pdf-commit-summary' }, [
            el('div', { class: 'leai-pdf-commit-summary__title' }, ['About to commit']),
            el('div', { class: 'leai-pdf-commit-summary__line' }, [
                el('strong', {}, [String(totalMessages)]),
                ' response' + (totalMessages === 1 ? '' : 's') + ' from ',
                el('strong', {}, [String(studentCount)]),
                ' student' + (studentCount === 1 ? '' : 's') + '.',
            ]),
            el('div', { class: 'leai-pdf-commit-summary__line' }, [
                'AI Quick Take will refresh on next view to include the new responses.',
            ]),
            el('div', { class: 'leai-pdf-commit-summary__line leai-pdf-commit-summary__line--safe' }, [
                'You can revert this batch from the Recent PDF uploads panel after committing.',
            ]),
        ]));

        if (state.dedupExisting.length) {
            wrap.appendChild(el('div', { class: 'leai-pdf-dedup' }, [
                el('div', { class: 'leai-pdf-dedup__title' }, [
                    state.dedupExisting.length + ' student' +
                    (state.dedupExisting.length === 1 ? ' already has' : 's already have') +
                    ' a PDF reflection on this survey:',
                ]),
                el('div', { class: 'leai-pdf-dedup__rows' }, state.dedupExisting.map(function (sid) {
                    return renderDedupRow(sid, state, ctx);
                })),
            ]));
        }

        var inFlight = !!state.commitInFlight;
        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                disabled: inFlight ? 'disabled' : false,
                onclick: function () { if (!inFlight) ctx.transition('review'); },
            }, ['Back to review']),
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary' + (inFlight ? ' leai-pdf-btn--loading' : ''),
                disabled: inFlight ? 'disabled' : false,
                onclick: function () { ctx.commit(); },
            }, [inFlight
                ? 'Saving ' + totalMessages + ' response' + (totalMessages === 1 ? '' : 's') + '…'
                : 'Commit ' + totalMessages + ' response' + (totalMessages === 1 ? '' : 's')]),
        ]));

        return wrap;
    }

    function renderDedupRow(sid, state, ctx) {
        var row = el('div', { class: 'leai-pdf-dedup__row' });
        row.appendChild(el('div', { class: 'leai-pdf-dedup__sid' }, [sid]));
        // Order: safe default first. Keep existing PDF rows untouched
        // unless the instructor explicitly picks Replace or Add.
        var choices = [
            { value: 'skip',    label: 'Keep existing (default)', hint: 'Don’t save anything new — leave the previous PDF as-is' },
            { value: 'add',     label: 'Add as additional',       hint: 'Keep both old and new PDF rows side by side' },
            { value: 'replace', label: 'Replace existing',        hint: 'Delete the previous PDF rows for this student before saving the new one' },
        ];
        var sel = el('div', { class: 'leai-pdf-dedup__choices' });
        choices.forEach(function (c) {
            var checked = (state.dedupChoices[sid] || 'skip') === c.value;
            var label = el('label', { class: 'leai-pdf-dedup__choice' + (checked ? ' leai-pdf-dedup__choice--on' : '') }, [
                el('input', {
                    type: 'radio',
                    name: 'dedup-' + sid,
                    value: c.value,
                    checked: checked ? '' : false,
                    onchange: function () {
                        state.dedupChoices[sid] = c.value;
                        ctx.render();
                    },
                }),
                el('div', {}, [
                    el('div', { class: 'leai-pdf-dedup__choice-label' }, [c.label]),
                    el('div', { class: 'leai-pdf-dedup__choice-hint' }, [c.hint]),
                ]),
            ]);
            sel.appendChild(label);
        });
        row.appendChild(sel);
        return row;
    }

    function commit(state, ctx, opts) {
        if (state.commitInFlight) return;  // double-click guard
        var items = state.jobItems
            .filter(function (i) { return i.status !== 'failed'; })
            .map(function (item) {
                return {
                    filename: item.filename,
                    student_id: item.student_id,
                    mapping: state.edits[item.filename] || item.mapping || {},
                    skip: !!state.skips[item.filename],
                };
            });
        state.commitInFlight = true;
        ctx.render();  // re-render so the button shows the spinner
        leaiPdfIngest.commitJob(state.jobId, items, state.dedupChoices, '').then(function (resp) {
            state.commitResult = resp;
            state.commitInFlight = false;
            // Draft is no longer relevant — the data is now on the
            // server, and the success state is the source of truth.
            clearDraft(state.survey.id);
            // Increment the global use counter (collapses the explainer
            // after 3 successful commits).
            incrementUseCount();
            // If every dedup decision was the same, remember it as the
            // per-survey preference so the next ingest pre-fills with it.
            var dedupValues = Object.values(state.dedupChoices || {});
            if (dedupValues.length && dedupValues.every(function (v) { return v === dedupValues[0]; })) {
                setDedupPref(state.survey.id, dedupValues[0]);
            }
            ctx.transition('success');
            opts.onCommitted && opts.onCommitted(resp);
        }).catch(function (err) {
            state.commitInFlight = false;
            ctx.render();
            showToast('Commit failed: ' + humanizeError(err), 'error');
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 5 — success

    function renderSuccessStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });
        var r = state.commitResult || {};
        var scrollTarget = (ctx.opts && ctx.opts.scrollToSelector) || '#student-responses-section';
        wrap.appendChild(el('div', { class: 'leai-pdf-success' }, [
            el('div', { class: 'leai-pdf-success__icon material-symbols-outlined' }, ['check']),
            el('div', { class: 'leai-pdf-success__title' }, [
                'Added ' + (r.committed_count || 0) + ' response' +
                ((r.committed_count || 0) === 1 ? '' : 's') + ' from ' +
                (r.students_affected || 0) + ' student' +
                ((r.students_affected || 0) === 1 ? '' : 's'),
            ]),
            el('div', { class: 'leai-pdf-success__hint' }, [
                'They now appear in the response browser, AI Quick Take, and analytics below ',
                'with a PDF badge so you can always tell them apart.',
            ]),
        ]));
        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                onclick: function () {
                    ctx.close({ skipConfirm: true });
                    // Scroll the analyzer's response section into view so
                    // the instructor sees the new rows immediately.
                    var target = document.querySelector(scrollTarget);
                    if (target) {
                        try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                        catch (e) { target.scrollIntoView(); }
                    }
                },
            }, ['Done — show responses']),
        ]));
        return wrap;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Recent batches panel

    var RECENT_INITIAL_LIMIT = 10;

    /** Bucket batches into Today / Yesterday / Earlier this week / Older
     *  groups for the Recent Uploads panel. Preserves input order within
     *  each group (server returns newest-first). */
    function groupBatchesByDate(batches) {
        var groups = { today: [], yesterday: [], earlier_week: [], older: [] };
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var ydayStart = todayStart - 86400000;
        var weekStart = todayStart - 6 * 86400000;
        batches.forEach(function (b) {
            var ts = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (ts >= todayStart) groups.today.push(b);
            else if (ts >= ydayStart) groups.yesterday.push(b);
            else if (ts >= weekStart) groups.earlier_week.push(b);
            else groups.older.push(b);
        });
        var out = [];
        if (groups.today.length) out.push({ label: 'Today', items: groups.today });
        if (groups.yesterday.length) out.push({ label: 'Yesterday', items: groups.yesterday });
        if (groups.earlier_week.length) out.push({ label: 'Earlier this week', items: groups.earlier_week });
        if (groups.older.length) out.push({ label: 'Older', items: groups.older });
        return out;
    }

    /** Build + trigger download of a batch's items_summary as CSV.
     *  Pure-client (no extra endpoint needed) since we already have
     *  the manifest in hand from listBatches. */
    function downloadBatchCsv(batch) {
        var rows = [['filename', 'student_id', 'status', 'dedup', 'prompt_count']];
        (batch.items_summary || []).forEach(function (it) {
            rows.push([
                it.filename || '',
                it.student_id || '',
                it.status || '',
                it.dedup || '',
                String(it.prompt_count == null ? '' : it.prompt_count),
            ]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (cell) {
                var s = String(cell == null ? '' : cell);
                if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var dt = (batch.created_at || '').slice(0, 10) || 'batch';
        a.href = url;
        a.download = 'pdf-ingest-' + dt + '-' + (batch.batch_id || '').slice(0, 8) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
    }

    function renderRecentBatchesPanel(container, survey, opts, options) {
        opts = opts || {};
        options = options || {};
        if (!container) return;
        clear(container);
        leaiPdfIngest.listBatches(survey.id).then(function (batches) {
            if (!batches || !batches.length) {
                container.style.display = 'none';
                return;
            }
            container.style.display = '';
            container.appendChild(el('div', { class: 'leai-pdf-recent__title' }, [
                'Recent PDF uploads (' + batches.length + ')',
            ]));
            // Cap the panel to keep instructor pages tight when many
            // batches accumulate; show-more reveals the rest in place.
            var showAll = !!options.showAll;
            var visible = showAll ? batches : batches.slice(0, RECENT_INITIAL_LIMIT);
            // Date-group the visible batches under Today/Yesterday/Earlier
            // this week/Older — keeps the list scannable when several
            // ingests pile up. Group order matches recency.
            var groups = groupBatchesByDate(visible);
            groups.forEach(function (group) {
                container.appendChild(el('div', { class: 'leai-pdf-recent__group-label' }, [group.label]));
                group.items.forEach(function (b) {
                    container.appendChild(renderRecentBatchRow(b, survey, opts));
                });
            });
            if (!showAll && batches.length > RECENT_INITIAL_LIMIT) {
                container.appendChild(el('button', {
                    class: 'leai-pdf-recent__more',
                    onclick: function () {
                        renderRecentBatchesPanel(container, survey, opts, { showAll: true });
                    },
                }, ['Show all ' + batches.length + ' batches']));
            } else if (showAll && batches.length > RECENT_INITIAL_LIMIT) {
                container.appendChild(el('button', {
                    class: 'leai-pdf-recent__more',
                    onclick: function () {
                        renderRecentBatchesPanel(container, survey, opts, { showAll: false });
                    },
                }, ['Show fewer']));
            }
        }).catch(function (e) {
            container.style.display = '';
            clear(container);
            container.appendChild(el('div', { class: 'leai-pdf-recent__error' }, [
                'Couldn’t load recent uploads: ' + humanizeError(e),
            ]));
        });
    }

    function renderRecentBatchRow(batch, survey, opts) {
        var row = el('div', { class: 'leai-pdf-recent__row' });
        var timeText = fmtRelative(batch.created_at);
        var summaryItems = (batch.items_summary || []).filter(function (it) {
            return it.status === 'committed';
        });
        var hasDetails = summaryItems.length > 0;
        var meta = el('div', { class: 'leai-pdf-recent__row-meta' }, [
            el('div', {}, [
                el('strong', {}, [batch.student_count + ' student' + (batch.student_count === 1 ? '' : 's')]),
                ' · ' + batch.message_count + ' response' + (batch.message_count === 1 ? '' : 's'),
                hasDetails ? el('button', {
                    type: 'button', class: 'leai-pdf-recent__expand',
                    'aria-label': 'Show students in this batch',
                    onclick: function () {
                        var detail = row.querySelector('.leai-pdf-recent__detail');
                        var expanded = detail.classList.toggle('leai-pdf-recent__detail--open');
                        this.textContent = expanded ? '▾' : '▸';
                        this.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    },
                }, ['▸']) : null,
            ]),
            el('div', {
                class: 'leai-pdf-recent__row-time',
                title: fmtDate(batch.created_at),  // hover reveals absolute time
            }, [timeText + (batch.committed_by ? ' · ' + batch.committed_by : '')]),
            // Detail panel (hidden by default; expanded by the ▸ chevron).
            hasDetails ? el('div', { class: 'leai-pdf-recent__detail' }, [
                el('div', { class: 'leai-pdf-recent__detail-list' },
                    summaryItems.map(function (it) {
                        return el('span', { class: 'leai-pdf-recent__detail-item' }, [
                            it.student_id + ' (' + it.prompt_count + ')',
                        ]);
                    })
                ),
            ]) : null,
        ]);
        row.appendChild(meta);

        // CSV export — small icon-button left of the Revert action so an
        // instructor can keep a record of what got committed (useful for
        // dept compliance / sharing what was imported with TAs).
        if (hasDetails) {
            var exportBtn = el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost leai-pdf-btn--sm',
                title: 'Download a CSV of this batch (filename, student_id, status, prompt count)',
                onclick: function () { downloadBatchCsv(batch); },
            }, [el('span', { class: 'material-symbols-outlined' }, ['download']), ' CSV']);
            row.appendChild(exportBtn);
        }
        var btn = el('button', {
            class: 'leai-pdf-btn leai-pdf-btn--danger leai-pdf-btn--sm',
            onclick: function () {
                showConfirm({
                    title: 'Revert this batch?',
                    body: 'Removes ' + batch.student_count + ' student' +
                        (batch.student_count === 1 ? '’s' : 's’') +
                        ' PDF responses (' + batch.message_count + ' row' +
                        (batch.message_count === 1 ? '' : 's') + ') and refreshes AI Quick Take. ' +
                        'This is logged as a reverted batch — the manifest stays for audit.',
                    confirmLabel: 'Revert ' + batch.message_count + ' response' +
                        (batch.message_count === 1 ? '' : 's'),
                    cancelLabel: 'Keep them',
                    danger: true,
                }).then(function (confirmed) {
                    if (!confirmed) return;
                    // Optimistic UI: immediately style the row as in-flight
                    // so the instructor knows their click registered.
                    row.classList.add('leai-pdf-recent__row--reverting');
                    btn.disabled = true; btn.textContent = 'Reverting…';
                    leaiPdfIngest.revertBatch(batch.batch_id).then(function (resp) {
                        var deleted = (resp && resp.deleted_count) || batch.message_count;
                        showToast('Reverted — removed ' + deleted + ' response' +
                            (deleted === 1 ? '' : 's') + '.', 'success');
                        opts.onReverted && opts.onReverted(batch);
                        renderRecentBatchesPanel(row.parentNode, survey, opts);
                    }).catch(function (e) {
                        row.classList.remove('leai-pdf-recent__row--reverting');
                        showToast('Revert failed: ' + humanizeError(e), 'error');
                        btn.disabled = false; btn.textContent = 'Revert';
                    });
                });
            },
        }, ['Revert']);
        row.appendChild(btn);
        return row;
    }

    root.leaiPdfIngestUi = {
        open: openDrawer,
        renderRecentBatchesPanel: renderRecentBatchesPanel,
    };
})(window);
