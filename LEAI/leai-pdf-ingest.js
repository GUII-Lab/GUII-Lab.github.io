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

    /** Auto-match a filename like "alice-doe.pdf" against a roster of student_ids. */
    function suggestStudent(filename, roster) {
        if (!roster || !roster.length) return '';
        var base = filename.toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-');
        var parts = base.split('-').filter(Boolean);
        var best = '';
        var bestScore = 0;
        roster.forEach(function (s) {
            var sid = (s.student_id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            var sParts = sid.split('-').filter(Boolean);
            var score = 0;
            parts.forEach(function (p) {
                if (p.length >= 3 && sParts.indexOf(p) !== -1) score += 1;
            });
            if (score > bestScore) { best = s.student_id; bestScore = score; }
        });
        return bestScore > 0 ? best : '';
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

        function close() {
            if (state.pollHandle) clearTimeout(state.pollHandle);
            state.pollHandle = null;
            backdrop.remove();
            drawer.remove();
            if (root._activeDrawer === handle) root._activeDrawer = null;
            opts.onClose && opts.onClose(state.commitResult);
        }

        var ctx = {
            state: state,
            render: render,
            close: close,
            startJob: function () { startJob(state, ctx); },
            commit: function () { commit(state, ctx, opts); },
            transition: function (phase) { state.phase = phase; render(); },
        };

        var header = el('div', { class: 'leai-pdf-drawer__header' }, [
            el('div', {}, [
                el('div', { class: 'leai-pdf-drawer__title' }, ['Upload PDF reflections']),
                el('div', { class: 'leai-pdf-drawer__subtitle' }, [
                    survey.name + (survey.week_number ? ' · Week ' + survey.week_number : ''),
                ]),
            ]),
            el('button', { class: 'leai-pdf-drawer__close', 'aria-label': 'Close', onclick: close }, ['×']),
        ]);

        drawer.appendChild(header);
        drawer.appendChild(stepContainer);
        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);
        requestAnimationFrame(function () {
            backdrop.classList.add('leai-pdf-backdrop--open');
            drawer.classList.add('leai-pdf-drawer--open');
        });

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

        render();
        return handle;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 1 — files & attribution

    function renderFilesStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        wrap.appendChild(el('p', { class: 'leai-pdf-explainer' }, [
            'Upload PDF reflections from students who used your template. We read each PDF, ',
            'match its sections to this survey’s questions, and add the answers to your analysis ',
            'below — alongside the chat responses. You’ll review the mapping before anything is saved, ',
            'and every batch you commit can be reverted with one click.',
        ]));

        var fileInput = el('input', {
            type: 'file',
            accept: ACCEPT_TYPES,
            multiple: '',
            style: { display: 'none' },
            onchange: function (ev) { addFiles(state, ctx, ev.target.files); ev.target.value = ''; },
        });
        var dropzone = el('label', { class: 'leai-pdf-dropzone', tabindex: '0' }, [
            fileInput,
            el('div', { class: 'leai-pdf-dropzone__icon' }, ['📄']),
            el('div', { class: 'leai-pdf-dropzone__title' }, ['Drop PDFs here or click to browse']),
            el('div', { class: 'leai-pdf-dropzone__hint' }, [
                'Up to 60 files, 10 MB each. PDFs with text only — scanned image PDFs won’t work.',
            ]),
        ]);
        ['dragenter', 'dragover'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault(); dropzone.classList.add('leai-pdf-dropzone--hover');
            });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault(); dropzone.classList.remove('leai-pdf-dropzone--hover');
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

        var fileList = el('div', { class: 'leai-pdf-file-list' });
        state.files.forEach(function (entry, idx) {
            fileList.appendChild(renderFileRow(entry, idx, state, ctx));
        });
        wrap.appendChild(fileList);

        var attributedCount = state.files.filter(function (f) { return !!f.studentId; }).length;
        var ready = attributedCount === state.files.length && state.files.length > 0;
        var actionRow = el('div', { class: 'leai-pdf-actions' }, [
            el('div', { class: 'leai-pdf-actions__status' }, [
                attributedCount + ' of ' + state.files.length + ' files attributed',
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

    function addFiles(state, ctx, fileList) {
        var existingNames = state.files.map(function (f) { return f.file.name; });
        Array.prototype.forEach.call(fileList, function (file) {
            if (!file.name.toLowerCase().endsWith('.pdf')) return;
            if (existingNames.indexOf(file.name) !== -1) return;
            var suggested = suggestStudent(file.name, state.roster);
            state.files.push({
                file: file,
                studentId: suggested,
                suggested: !!suggested,
            });
        });
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
        ctx.transition('processing');
        leaiPdfIngest.startJob(state.survey.id, files, attribs)
            .then(function (resp) {
                state.jobId = resp.job_id;
                state.jobItems = resp.items || [];
                state.jobProgress = resp.progress || state.jobProgress;
                state.prompts = resp.prompts || [];
                if (resp.status === 'ready' || resp.status === 'failed') {
                    handleJobFinished(state, ctx, resp);
                } else {
                    state.currentPollDelay = POLL_INTERVAL_MS;
                    schedulePoll(state, ctx);
                }
            })
            .catch(function (err) {
                state.jobError = err.message;
                ctx.transition('files');
                alert('Couldn’t start processing: ' + err.message);
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
                state.currentPollDelay = Math.min(state.currentPollDelay + 500, POLL_BACKOFF_MAX_MS);
                schedulePoll(state, ctx);
            }
        }).catch(function (err) {
            state.jobError = 'Lost connection: ' + err.message;
            ctx.render();
        });
    }

    function handleJobFinished(state, ctx, resp) {
        if (resp.status === 'failed') {
            state.jobError = resp.error || 'Processing failed.';
            ctx.render();
            return;
        }
        state.edits = {};
        state.skips = {};
        state.jobItems.forEach(function (item) {
            state.edits[item.filename] = Object.assign({}, item.mapping || {});
        });
        ctx.transition('review');
    }

    function renderProcessingStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        if (state.jobError) {
            wrap.appendChild(el('div', { class: 'leai-pdf-banner leai-pdf-banner--error' }, [state.jobError]));
            wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
                el('button', {
                    class: 'leai-pdf-btn leai-pdf-btn--ghost',
                    onclick: function () { state.jobError = ''; ctx.transition('files'); },
                }, ['Back to files']),
            ]));
            return wrap;
        }

        var p = state.jobProgress || {};
        var pct = p.total ? Math.round(((p.processed || 0) / p.total) * 100) : 0;

        wrap.appendChild(el('div', { class: 'leai-pdf-processing' }, [
            el('div', { class: 'leai-pdf-processing__spinner' }),
            el('div', { class: 'leai-pdf-processing__title', dataset: { role: 'progress-title' } }, [
                'Reading ' + (p.processed || 0) + ' of ' + (p.total || state.files.length) + '…',
            ]),
            el('div', { class: 'leai-pdf-processing__hint' }, [
                'You can close this window — your job will keep running and the result will be waiting next time you reopen the upload panel.',
            ]),
            el('div', { class: 'leai-pdf-progress' }, [
                el('div', {
                    class: 'leai-pdf-progress__bar',
                    dataset: { role: 'progress-bar' },
                    style: { width: pct + '%' },
                }),
            ]),
        ]));

        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                onclick: function () { ctx.close(); },
            }, ['Close — keep processing']),
        ]));
        return wrap;
    }

    function updateProcessingProgress(state) {
        var p = state.jobProgress || {};
        var bar = document.querySelector('[data-role="progress-bar"]');
        var title = document.querySelector('[data-role="progress-title"]');
        if (bar && p.total) bar.style.width = Math.round((p.processed / p.total) * 100) + '%';
        if (title) title.textContent = 'Reading ' + (p.processed || 0) + ' of ' + (p.total || state.files.length) + '…';
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 3 — review-by-exception

    function renderReviewStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });

        var ok = state.jobItems.filter(function (i) { return i.status === 'ok'; });
        var lowConf = state.jobItems.filter(function (i) { return i.status === 'low_conf'; });
        var failed = state.jobItems.filter(function (i) { return i.status === 'failed'; });

        var bannerClass = (failed.length || lowConf.length) ? 'leai-pdf-banner--warn' : 'leai-pdf-banner--ok';
        var banner = el('div', { class: 'leai-pdf-banner ' + bannerClass });
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

        if (lowConf.length) {
            wrap.appendChild(renderReviewGroup('Needs attention', lowConf, true, state, ctx));
        }
        if (failed.length) {
            wrap.appendChild(renderFailedGroup(failed, state, ctx));
        }
        if (ok.length) {
            wrap.appendChild(renderReviewGroup('Looks good (' + ok.length + ')', ok, false, state, ctx));
        }

        var commitable = state.jobItems.some(function (i) { return i.status !== 'failed'; });
        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                onclick: function () { ctx.transition('files'); },
            }, ['Back to files']),
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                disabled: commitable ? false : 'disabled',
                onclick: function () { prepareCommit(state, ctx); },
            }, ['Continue to commit']),
        ]));

        return wrap;
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
                    'Re-export this student’s reflection as a text-based PDF (not a scanned image), then re-upload from the Files step.',
                ]),
            ]));
        });
        return wrap;
    }

    function renderReviewCard(item, state, ctx) {
        var card = el('div', {
            class: 'leai-pdf-review-card' + (item.status === 'low_conf' ? ' leai-pdf-review-card--low' : ''),
        });
        var skipState = !!state.skips[item.filename];
        var head = el('div', { class: 'leai-pdf-review-card__head' }, [
            el('div', {}, [
                el('div', { class: 'leai-pdf-review-card__name' }, [item.filename]),
                el('div', { class: 'leai-pdf-review-card__student' }, ['Attributed to: ', el('strong', {}, [item.student_id || '—'])]),
            ]),
            el('label', { class: 'leai-pdf-review-card__skip' }, [
                el('input', {
                    type: 'checkbox',
                    checked: skipState ? '' : false,
                    onchange: function (e) {
                        state.skips[item.filename] = !!e.target.checked;
                    },
                }),
                'Skip this PDF',
            ]),
        ]);
        card.appendChild(head);

        var cells = el('div', { class: 'leai-pdf-review-card__cells' });
        state.prompts.forEach(function (p) {
            var pid = p.prompt_id;
            var current = state.edits[item.filename] && state.edits[item.filename][pid];
            if (current == null) current = (item.mapping && item.mapping[pid]) || '';
            var isLow = (item.low_conf_prompts || []).indexOf(pid) !== -1;
            var labelChildren = [p.title || pid];
            if (isLow) {
                labelChildren.push(el('span', { class: 'leai-pdf-review-cell__warn' }, ['couldn’t find a clear heading']));
            }
            var cell = el('div', { class: 'leai-pdf-review-cell' + (isLow ? ' leai-pdf-review-cell--low' : '') }, [
                el('div', { class: 'leai-pdf-review-cell__label' }, labelChildren),
                el('textarea', {
                    class: 'leai-pdf-review-cell__textarea',
                    placeholder: isLow
                        ? 'Paste this student’s answer here, or leave blank if they didn’t respond.'
                        : '',
                    rows: '4',
                    oninput: function (e) {
                        state.edits[item.filename] = state.edits[item.filename] || {};
                        state.edits[item.filename][pid] = e.target.value;
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
            existing.forEach(function (sid) {
                if (!state.dedupChoices[sid]) state.dedupChoices[sid] = 'replace';
            });
            ctx.transition('commit');
        }).catch(function (err) {
            alert('Couldn’t check for existing reflections: ' + err.message);
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
                '✓ You can revert this batch from the Recent PDF uploads panel after committing.',
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

        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--ghost',
                onclick: function () { ctx.transition('review'); },
            }, ['Back to review']),
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                onclick: function () { ctx.commit(); },
            }, ['Commit ' + totalMessages + ' response' + (totalMessages === 1 ? '' : 's')]),
        ]));

        return wrap;
    }

    function renderDedupRow(sid, state, ctx) {
        var row = el('div', { class: 'leai-pdf-dedup__row' });
        row.appendChild(el('div', { class: 'leai-pdf-dedup__sid' }, [sid]));
        var choices = [
            { value: 'replace', label: 'Replace existing', hint: 'Delete the previous PDF rows for this student before saving the new one' },
            { value: 'add',     label: 'Add as additional', hint: 'Keep both old and new PDF rows side by side' },
            { value: 'skip',    label: 'Skip this student', hint: 'Don’t save anything — keep the previous as-is' },
        ];
        var sel = el('div', { class: 'leai-pdf-dedup__choices' });
        choices.forEach(function (c) {
            var checked = (state.dedupChoices[sid] || 'replace') === c.value;
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
        leaiPdfIngest.commitJob(state.jobId, items, state.dedupChoices, '').then(function (resp) {
            state.commitResult = resp;
            ctx.transition('success');
            opts.onCommitted && opts.onCommitted(resp);
        }).catch(function (err) {
            alert('Commit failed: ' + err.message);
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 5 — success

    function renderSuccessStep(state, ctx) {
        var wrap = el('div', { class: 'leai-pdf-step__inner' });
        var r = state.commitResult || {};
        wrap.appendChild(el('div', { class: 'leai-pdf-success' }, [
            el('div', { class: 'leai-pdf-success__icon' }, ['✓']),
            el('div', { class: 'leai-pdf-success__title' }, [
                'Added ' + (r.committed_count || 0) + ' response' +
                ((r.committed_count || 0) === 1 ? '' : 's') + ' from ' +
                (r.students_affected || 0) + ' student' +
                ((r.students_affected || 0) === 1 ? '' : 's'),
            ]),
            el('div', { class: 'leai-pdf-success__hint' }, [
                'They now appear in the response browser, AI Quick Take, and analytics below ',
                'with a 📄 PDF badge so you can always tell them apart.',
            ]),
        ]));
        wrap.appendChild(el('div', { class: 'leai-pdf-actions' }, [
            el('button', {
                class: 'leai-pdf-btn leai-pdf-btn--primary',
                onclick: function () { ctx.close(); },
            }, ['Done']),
        ]));
        return wrap;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Recent batches panel

    function renderRecentBatchesPanel(container, survey, opts) {
        opts = opts || {};
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
            batches.forEach(function (b) {
                container.appendChild(renderRecentBatchRow(b, survey, opts));
            });
        }).catch(function (e) {
            container.style.display = '';
            clear(container);
            container.appendChild(el('div', { class: 'leai-pdf-recent__error' }, [
                'Couldn’t load recent uploads: ' + e.message,
            ]));
        });
    }

    function renderRecentBatchRow(batch, survey, opts) {
        var row = el('div', { class: 'leai-pdf-recent__row' });
        row.appendChild(el('div', { class: 'leai-pdf-recent__row-meta' }, [
            el('div', {}, [
                el('strong', {}, [batch.student_count + ' student' + (batch.student_count === 1 ? '' : 's')]),
                ' · ' + batch.message_count + ' response' + (batch.message_count === 1 ? '' : 's'),
            ]),
            el('div', { class: 'leai-pdf-recent__row-time' }, [
                fmtDate(batch.created_at) + (batch.committed_by ? ' · ' + batch.committed_by : ''),
            ]),
        ]));
        var btn = el('button', {
            class: 'leai-pdf-btn leai-pdf-btn--danger leai-pdf-btn--sm',
            onclick: function () {
                if (!confirm('Revert this batch?\n\nThis will remove ' + batch.student_count + ' student’s PDF responses (' + batch.message_count + ' rows). AI Quick Take will refresh.')) return;
                btn.disabled = true; btn.textContent = 'Reverting…';
                leaiPdfIngest.revertBatch(batch.batch_id).then(function () {
                    opts.onReverted && opts.onReverted(batch);
                    renderRecentBatchesPanel(row.parentNode, survey, opts);
                }).catch(function (e) {
                    alert('Revert failed: ' + e.message);
                    btn.disabled = false; btn.textContent = 'Revert';
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
