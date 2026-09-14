(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.leaiQuestionSetWizard = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function WizardApiError(code, status, message, payload) {
        this.name = 'WizardApiError';
        this.code = code || 'request_failed';
        this.status = status || 0;
        this.message = message || this.code;
        this.ready_at = payload && payload.ready_at;
        this.retry_after_ms = payload && payload.retry_after_ms;
        if (Error.captureStackTrace) Error.captureStackTrace(this, WizardApiError);
    }
    WizardApiError.prototype = Object.create(Error.prototype);
    WizardApiError.prototype.constructor = WizardApiError;

    function requestJson(fetcher, url, options) {
        return fetcher(url, options || {}).then(function (response) {
            return response.text().then(function (text) {
                var payload = {};
                if (text) {
                    try { payload = JSON.parse(text); }
                    catch (error) { payload = { error: 'invalid_response' }; }
                }
                if (!response.ok) {
                    throw new WizardApiError(
                        payload.error,
                        response.status,
                        payload.message || payload.error,
                        payload,
                    );
                }
                return payload;
            });
        });
    }

    function createApi(options) {
        var apiBase = String(options.apiBase || '').replace(/\/$/, '');
        var authFetch = options.authorizedFetch;
        var publicFetch = options.fetch || authFetch;
        function auth(path, requestOptions) {
            return requestJson(authFetch, apiBase + path, requestOptions);
        }
        function plain(path, requestOptions) {
            return requestJson(publicFetch, apiBase + path, requestOptions);
        }
        function jsonOptions(method, payload) {
            return {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            };
        }
        return {
            listTemplates: function () {
                return auth('/question_set_templates/');
            },
            listDrafts: function (courseId) {
                return auth('/question_set_drafts/?course_id=' + encodeURIComponent(courseId));
            },
            createDraft: function (courseId, templateId, confirmAbandonActive) {
                return auth('/question_set_drafts/', jsonOptions('POST', {
                    course_id: courseId,
                    template_id: templateId,
                    ...(confirmAbandonActive === true ? { confirm_abandon_active: true } : {}),
                }));
            },
            getDraft: function (draftId) {
                return auth('/question_set_drafts/' + encodeURIComponent(draftId) + '/');
            },
            saveDraft: function (draftId, expectedVersion, body) {
                return auth(
                    '/question_set_drafts/' + encodeURIComponent(draftId) + '/',
                    jsonOptions('PATCH', {
                        expected_version: expectedVersion,
                        body: body,
                    }),
                );
            },
            freezeDraft: function (draftId, expectedVersion) {
                return auth(
                    '/question_set_drafts/' + encodeURIComponent(draftId) + '/freeze/',
                    jsonOptions('POST', { expected_version: expectedVersion }),
                );
            },
            createPreview: function (revisionId) {
                return auth(
                    '/question_set_revisions/' + encodeURIComponent(revisionId) + '/preview_capability/',
                    jsonOptions('POST', {}),
                );
            },
            getPreview: function (token) {
                return plain('/question_set_preview/' + encodeURIComponent(token) + '/');
            },
            updatePreviewSettings: function (token, settings) {
                return auth('/question_set_preview/' + encodeURIComponent(token) + '/settings/',
                    jsonOptions('PATCH', settings));
            },
            createSurvey: function (revisionId, source) {
                return auth(
                    '/question_set_revisions/' + encodeURIComponent(revisionId) + '/surveys/',
                    jsonOptions('POST', {
                        course_id: source.courseId,
                        idempotency_key: source.idempotencyKey,
                        survey_label: source.surveyLabel,
                        week_number: source.weekNumber,
                        opens_at: source.opensAt,
                        expires_at: source.expiresAt,
                        preview_token: source.previewToken,
                    }),
                );
            },
        };
    }

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function replaceChildren(parent) {
        while (parent.firstChild) parent.removeChild(parent.firstChild);
        for (var index = 1; index < arguments.length; index += 1) {
            if (arguments[index]) parent.appendChild(arguments[index]);
        }
    }

    function randomIdempotencyKey() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return 'wizard-' + crypto.randomUUID();
        }
        return 'wizard-' + Date.now().toString(36) + '-' +
            Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }

    function idempotencyKeyForRevision(revisionId) {
        return 'question-set-survey-' + String(revisionId || '').trim();
    }

    function shouldConfirmModeSwitch(isDirty) {
        return isDirty === true;
    }

    function buildPreviewReturnState(draft, revision, previewToken, previewUrl) {
        return {
            draftId: draft && draft.id,
            draftVersion: draft && draft.version,
            revisionId: revision && revision.id,
            previewToken: previewToken,
            previewUrl: previewUrl,
        };
    }

    function isoOrNull(value) {
        if (!value) return null;
        var date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    function mount(options) {
        var rootEl = typeof options.root === 'string'
            ? document.querySelector(options.root)
            : options.root;
        var openButton = typeof options.openButton === 'string'
            ? document.querySelector(options.openButton)
            : options.openButton;
        if (!rootEl || !openButton) return null;
        const resumeButton = typeof options.resumeButton === 'string'
            ? document.querySelector(options.resumeButton) : options.resumeButton;

        var api = createApi({
            apiBase: options.apiBase,
            authorizedFetch: options.authorizedFetch,
            fetch: options.fetch || window.fetch.bind(window),
        });
        var state = {
            open: false,
            busy: false,
            step: 1,
            templates: [],
            drafts: [],
            draft: null,
            revision: null,
            previewToken: null,
            previewUrl: null,
            previewCompleted: false,
            dirty: false,
            idempotencyKey: randomIdempotencyKey(),
            receipt: null,
            pollTimer: null,
            progressTimer: null,
            epoch: 0,
            previewReady: false,
            readyAt: null,
            preparationStarted: null,
            preparationProgress: 0,
            settings: {},
            settingsSaving: {},
            settingsStatus: {},
            confirmAbandonActive: false,
        };
        let previewRead = null;
        let renderedStep = null;

        rootEl.className = 'qsw-overlay';
        rootEl.hidden = true;
        rootEl.setAttribute('role', 'dialog');
        rootEl.setAttribute('aria-modal', 'true');
        rootEl.setAttribute('aria-labelledby', 'qsw-title');

        var panel = element('section', 'qsw-panel');
        var header = element('header', 'qsw-header');
        var headerCopy = element('div', 'qsw-header-copy');
        var eyebrow = element('div', 'qsw-eyebrow', 'Structured Feedback builder');
        var title = element('h2', '', 'Create structured feedback');
        title.id = 'qsw-title';
        var subtitle = element('p', 'qsw-subtitle');
        var closeButton = element('button', 'qsw-icon-button', '×');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close Structured Feedback builder');
        headerCopy.appendChild(eyebrow);
        headerCopy.appendChild(title);
        headerCopy.appendChild(subtitle);
        header.appendChild(headerCopy);
        header.appendChild(closeButton);

        var progress = element('ol', 'qsw-progress');
        var stepNames = ['Choose', 'Edit', 'Preview', 'Publish'];
        stepNames.forEach(function (name, index) {
            var item = element('li', 'qsw-progress-item');
            item.dataset.step = String(index + 1);
            item.appendChild(element('span', 'qsw-progress-number', String(index + 1)));
            item.appendChild(element('span', 'qsw-progress-label', name));
            progress.appendChild(item);
        });

        var notice = element('div', 'qsw-notice');
        notice.hidden = true;
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        var content = element('div', 'qsw-content');
        var footer = element('footer', 'qsw-footer');
        var footerStatus = element('div', 'qsw-footer-status');
        footerStatus.tabIndex = -1;
        var footerActions = element('div', 'qsw-footer-actions');
        var backButton = element('button', 'qsw-button qsw-button-secondary', 'Back');
        backButton.type = 'button';
        var secondaryButton = element('button', 'qsw-button qsw-button-secondary');
        secondaryButton.type = 'button';
        var primaryButton = element('button', 'qsw-button qsw-button-primary');
        primaryButton.type = 'button';
        footerActions.appendChild(backButton);
        footerActions.appendChild(secondaryButton);
        footerActions.appendChild(primaryButton);
        footer.appendChild(footerStatus);
        footer.appendChild(footerActions);

        panel.appendChild(header);
        panel.appendChild(progress);
        panel.appendChild(notice);
        panel.appendChild(content);
        panel.appendChild(footer);
        rootEl.appendChild(panel);

        function course() {
            return typeof options.getCourse === 'function' ? options.getCourse() : null;
        }

        function focusEditorStart() {
            var firstControl = content.querySelector('input, textarea, select, button');
            if (firstControl) firstControl.focus();
            else closeButton.focus();
        }

        function setNotice(message, type) {
            notice.textContent = message || '';
            notice.className = 'qsw-notice' + (type ? ' qsw-notice-' + type : '');
            notice.hidden = !message;
        }

        function notifyDraftsChanged() {
            if (resumeButton) resumeButton.hidden = !state.drafts.length;
            if (typeof options.onDraftsChanged === 'function') {
                options.onDraftsChanged(state.drafts.slice());
            }
        }

        function setBusy(busy, label) {
            state.busy = busy;
            rootEl.classList.toggle('qsw-busy', busy);
            content.setAttribute('aria-busy', String(busy));
            if (state.step === 2) {
                content.querySelectorAll('input, textarea, select').forEach(input => {
                    input.disabled = busy;
                });
            }
            if (busy) {
                [backButton, secondaryButton, primaryButton].forEach(function (button) {
                    button.disabled = true;
                });
                footerStatus.textContent = label || '';
                if (state.step === 2) footerStatus.focus();
                return;
            }
            closeButton.disabled = false;
            backButton.disabled = false;
            secondaryButton.disabled = state.step === 2 ? !state.dirty : false;
            primaryButton.disabled = state.step === 3
                ? !state.previewReady || !state.previewCompleted || settingsPending() : false;
        }

        function updateProgress() {
            Array.prototype.forEach.call(progress.children, function (item) {
                var number = parseInt(item.dataset.step, 10);
                item.classList.toggle('is-current', number === state.step);
                item.classList.toggle('is-complete', number < state.step);
                item.setAttribute('aria-current', number === state.step ? 'step' : 'false');
            });
        }

        function inputField(labelText, value, options) {
            var field = element('label', 'qsw-field');
            var label = element('span', 'qsw-field-label', labelText);
            var input = document.createElement(options && options.multiline ? 'textarea' : 'input');
            input.className = 'qsw-input';
            input.value = value || '';
            if (options && options.multiline) input.rows = options.rows || 3;
            if (options && options.type) input.type = options.type;
            if (options && options.placeholder) input.placeholder = options.placeholder;
            if (options && options.min) input.min = options.min;
            if (options && options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);
            field.appendChild(label);
            field.appendChild(input);
            if (options && options.hint) {
                field.appendChild(element('span', 'qsw-field-hint', options.hint));
            }
            return { field: field, input: input };
        }

        function renderChoose() {
            title.textContent = 'Start with a proven structure';
            var wrap = element('div', 'qsw-stack');
            var intro = element(
                'p',
                'qsw-lead',
                'Choose an individual reflection template. You can adjust every student-facing question before anything is published.',
            );
            wrap.appendChild(intro);

            var templateHeading = element('div', 'qsw-section-heading');
            templateHeading.appendChild(element('h3', '', 'Choose a template'));
            templateHeading.appendChild(element('span', '', 'Individual responses only'));
            wrap.appendChild(templateHeading);
            var grid = element('div', 'qsw-template-grid');
            state.templates.forEach(function (template, index) {
                var card = element('button', 'qsw-template-card');
                card.type = 'button';
                card.dataset.templateId = template.id;
                card.appendChild(element('span', 'qsw-template-index', '0' + (index + 1)));
                card.appendChild(element('strong', '', template.name));
                card.appendChild(element('p', '', template.description));
                card.appendChild(element(
                    'span',
                    'qsw-template-meta',
                    template.body.sections.length + ' questions · guided conversation',
                ));
                card.addEventListener('click', function () {
                    var activeCourse = course();
                    if (!activeCourse || state.busy) return;
                    if (state.drafts.length && !state.confirmAbandonActive) {
                        if (!window.confirm('Your unfinished setup will be replaced. Its history will be kept. Continue?')) return;
                        state.confirmAbandonActive = true;
                    }
                    const epoch = state.epoch;
                    setBusy(true, 'Creating your draft…');
                    api.createDraft(activeCourse.id, template.id, state.confirmAbandonActive).then(function (draft) {
                        if (!isCurrent(epoch)) return;
                        state.draft = draft;
                        state.drafts = [draft];
                        state.confirmAbandonActive = false;
                        notifyDraftsChanged();
                        state.step = 2;
                        state.dirty = false;
                        setNotice('', '');
                        render();
                        focusEditorStart();
                    }).catch(error => { if (isCurrent(epoch)) handleError(error); })
                        .finally(() => { if (isCurrent(epoch)) setBusy(false); });
                });
                grid.appendChild(card);
            });
            wrap.appendChild(grid);
            replaceChildren(content, wrap);

            backButton.hidden = true;
            secondaryButton.hidden = true;
            primaryButton.hidden = true;
            footerStatus.textContent = 'Nothing is published until you finish a real preview.';
        }

        function markDirty() {
            state.dirty = true;
            footerStatus.textContent = 'Unsaved changes';
            secondaryButton.textContent = 'Save draft';
            secondaryButton.disabled = false;
        }

        function renderEdit() {
            title.textContent = 'Shape the conversation';
            var body = state.draft.body;
            var wrap = element('div', 'qsw-editor-layout');
            var main = element('div', 'qsw-editor-main');
            var side = element('aside', 'qsw-editor-aside');

            var titleField = inputField('Question set title', body.title, {
                placeholder: 'Weekly learning reflection',
                hint: 'Students see this title at the top of the reflection.',
            });
            titleField.input.dataset.bind = 'title';
            main.appendChild(titleField.field);
            var introField = inputField('Opening context', body.intro, {
                multiline: true,
                rows: 2,
            });
            introField.input.dataset.bind = 'intro';
            main.appendChild(introField.field);

            var questionsHeading = element('div', 'qsw-section-heading');
            questionsHeading.appendChild(element('h3', '', 'Questions'));
            questionsHeading.appendChild(element('span', '', 'Asked one at a time'));
            main.appendChild(questionsHeading);
            body.sections.forEach(function (section, index) {
                var card = element('section', 'qsw-question-card');
                var cardHead = element('div', 'qsw-question-head');
                cardHead.appendChild(element('span', 'qsw-question-number', String(index + 1)));
                cardHead.appendChild(element('strong', '', 'Conversation area'));
                card.appendChild(cardHead);
                var sectionTitle = inputField('Short label', section.title, {
                    ariaLabel: 'Conversation area ' + (index + 1) + ' short label',
                });
                sectionTitle.input.dataset.sectionIndex = String(index);
                sectionTitle.input.dataset.sectionKey = 'title';
                card.appendChild(sectionTitle.field);
                var prompt = inputField('Main question', section.opening_prompt, {
                    multiline: true,
                    rows: 3,
                    ariaLabel: 'Conversation area ' + (index + 1) + ' main question',
                });
                prompt.input.dataset.sectionIndex = String(index);
                prompt.input.dataset.sectionKey = 'opening_prompt';
                card.appendChild(prompt.field);
                var probe = inputField('Optional follow-up', section.depth_probe || '', {
                    multiline: true,
                    rows: 2,
                    ariaLabel: 'Conversation area ' + (index + 1) + ' optional follow-up',
                });
                probe.input.dataset.sectionIndex = String(index);
                probe.input.dataset.sectionKey = 'depth_probe';
                card.appendChild(probe.field);
                main.appendChild(card);
            });
            var closing = inputField(
                'Closing feedback question',
                body.closing.feedback_prompt,
                { multiline: true, rows: 2 },
            );
            closing.input.dataset.bind = 'closing';
            main.appendChild(closing.field);

            side.appendChild(element('span', 'qsw-aside-kicker', 'What students experience'));
            side.appendChild(element('h3', '', 'One calm question at a time'));
            side.appendChild(element(
                'p',
                '',
                'LEAI follows this order. When a student’s first answer needs more detail, it may ask the optional follow-up; it never asks more than one follow-up per area.',
            ));
            var guardrails = element('ul', 'qsw-check-list');
            [
                'Individual reflection only',
                'Anonymous student sessions',
                'Exact revision frozen before preview',
                'Practice answers excluded from analysis',
            ].forEach(function (text) {
                guardrails.appendChild(element('li', '', text));
            });
            side.appendChild(guardrails);
            side.appendChild(element(
                'p',
                'qsw-aside-note',
                'Changing student-facing wording after preview creates a new revision and requires another preview.',
            ));
            wrap.appendChild(main);
            wrap.appendChild(side);
            replaceChildren(content, wrap);

            Array.prototype.forEach.call(content.querySelectorAll('input, textarea'), function (input) {
                input.addEventListener('input', markDirty);
            });
            backButton.hidden = false;
            backButton.textContent = 'Back to templates';
            secondaryButton.hidden = false;
            secondaryButton.textContent = state.dirty ? 'Save draft' : 'Saved';
            secondaryButton.disabled = !state.dirty;
            primaryButton.hidden = false;
            primaryButton.textContent = 'Generate preview';
            footerStatus.textContent = state.dirty
                ? 'Unsaved changes'
                : 'Draft saved';
        }

        function collectBody() {
            var body = JSON.parse(JSON.stringify(state.draft.body));
            Array.prototype.forEach.call(content.querySelectorAll('[data-bind]'), function (input) {
                if (input.dataset.bind === 'title') body.title = input.value;
                if (input.dataset.bind === 'intro') body.intro = input.value;
                if (input.dataset.bind === 'closing') body.closing.feedback_prompt = input.value;
            });
            Array.prototype.forEach.call(content.querySelectorAll('[data-section-index]'), function (input) {
                var section = body.sections[parseInt(input.dataset.sectionIndex, 10)];
                section[input.dataset.sectionKey] = input.value;
            });
            return body;
        }

        function saveCurrentDraft() {
            if (!state.dirty) return Promise.resolve(state.draft);
            const epoch = state.epoch;
            setBusy(true, 'Saving draft…');
            return api.saveDraft(
                state.draft.id,
                state.draft.version,
                collectBody(),
            ).then(function (draft) {
                if (!isCurrent(epoch)) return null;
                state.draft = draft;
                state.drafts = state.drafts.map(function (candidate) {
                    return candidate.id === draft.id ? draft : candidate;
                });
                state.dirty = false;
                notifyDraftsChanged();
                setNotice('Draft saved.', 'success');
                return draft;
            }).catch(function (error) {
                if (isCurrent(epoch)) handleError(error);
                throw error;
            }).finally(function () { if (isCurrent(epoch)) setBusy(false); });
        }

        function renderPreview() {
            title.textContent = 'Try the exact student experience';
            var wrap = element('div', 'qsw-preview-layout');
            var visual = element('div', 'qsw-preview-visual');
            visual.appendChild(element('span', 'qsw-preview-badge', 'PRACTICE PREVIEW'));
            visual.appendChild(element('h3', '', state.draft.body.title));
            if (!state.previewToken) {
                var launch = element(
                    'button',
                    'qsw-button qsw-button-primary qsw-launch-button',
                    'Generate a fresh preview',
                );
                launch.type = 'button';
                launch.addEventListener('click', launchPreview);
                visual.appendChild(launch);
            } else if (!state.previewReady) {
                visual.classList.add('is-preparing');
                const preparation = element('div', 'qsw-preparation');
                const label = element('p', '', 'Preparing your student preview…');
                label.setAttribute('aria-live', 'polite');
                const bar = element('div', 'qsw-preparation-bar');
                bar.setAttribute('role', 'progressbar');
                bar.setAttribute('aria-label', 'Preparing student preview');
                bar.setAttribute('aria-valuemin', '0');
                bar.setAttribute('aria-valuemax', '100');
                bar.appendChild(element('span', 'qsw-preparation-fill'));
                preparation.appendChild(label);
                preparation.appendChild(bar);
                visual.appendChild(preparation);
            } else if (state.previewUrl) {
                var newTabLink = element('a', 'qsw-button qsw-button-primary qsw-launch-button', 'Open preview in a new tab');
                newTabLink.href = state.previewUrl;
                newTabLink.target = '_blank';
                newTabLink.rel = 'noopener';
                visual.appendChild(newTabLink);
            }
            wrap.appendChild(visual);

            var checklist = element('aside', 'qsw-preview-check');
            checklist.appendChild(element('h3', '', 'Preview gate'));
            var items = [
                ['Exact wording is frozen', true],
                ['Student conversation engine', true],
                ['Practice data is isolated', true],
                ['Closing reached', state.previewCompleted],
            ];
            items.forEach(function (item) {
                var row = element('div', 'qsw-gate-row' + (item[1] ? ' is-done' : ''));
                row.appendChild(element('span', 'qsw-gate-dot', item[1] ? '✓' : '○'));
                row.appendChild(element('span', '', item[0]));
                checklist.appendChild(row);
            });
            if (!state.previewCompleted && state.previewReady) {
                var check = element('button', 'qsw-button qsw-button-secondary', 'Check completion');
                check.type = 'button';
                check.addEventListener('click', checkPreviewCompletion);
                checklist.appendChild(check);
            }
            if (state.previewToken && typeof state.settings.completion_certificate_enabled === 'boolean') {
                checklist.appendChild(renderSettings());
            }
            wrap.appendChild(checklist);
            replaceChildren(content, wrap);
            updatePreparationProgress();

            backButton.hidden = false;
            backButton.textContent = 'Back to edit';
            secondaryButton.hidden = true;
            primaryButton.hidden = false;
            primaryButton.textContent = state.previewCompleted ? 'Continue to publish' : 'Complete preview first';
            primaryButton.disabled = !state.previewReady || !state.previewCompleted || settingsPending();
            footerStatus.textContent = state.previewCompleted
                ? 'Preview completed for this exact revision'
                : 'Survey creation stays locked until the closing is reached';
        }

        function launchPreview() {
            if (state.previewToken) return Promise.resolve();
            const epoch = state.epoch;
            setBusy(true, 'Preparing isolated preview…');
            return api.createPreview(state.revision.id).then(function (result) {
                if (!isCurrent(epoch)) return;
                state.previewToken = result.token;
                var target = result.preview_url || ('feedback.html?preview=' + encodeURIComponent(result.token));
                state.previewUrl = target;
                state.previewCompleted = false;
                state.previewReady = false;
                state.readyAt = result.ready_at;
                state.preparationStarted = Date.now();
                state.preparationProgress = 0;
                state.settings = completionSettings(result);
                state.settingsSaving = {};
                state.settingsStatus = {};
                state.step = 3;
                rememberPreview();
                render();
                startPolling();
            }).catch(function (error) {
                if (isCurrent(epoch)) handleError(error);
            }).finally(function () { if (isCurrent(epoch)) setBusy(false); });
        }

        function checkPreviewCompletion() {
            if (!state.previewToken || !state.open || state.step !== 3) return Promise.resolve(false);
            if (previewRead) return previewRead;
            if (state.pollTimer) window.clearTimeout(state.pollTimer);
            state.pollTimer = null;
            const epoch = state.epoch;
            const token = state.previewToken;
            const current = () => isCurrent(epoch) && state.previewToken === token && state.step === 3;
            const settingsAtRead = state.settings;
            let retry = 2000;
            previewRead = api.getPreview(token).then(function (result) {
                if (!current()) return false;
                if (result.question_set_revision_id && String(result.question_set_revision_id) !== String(state.revision.id)) {
                    throw new WizardApiError('preview_revision_mismatch', 409);
                }
                const wasReady = state.previewReady;
                const wasCompleted = state.previewCompleted;
                state.previewReady = true;
                state.preparationProgress = 100;
                if (!wasReady && settingsAtRead === state.settings && !settingsPending()) {
                    state.settings = completionSettings(result);
                }
                state.previewCompleted = state.previewCompleted || !!result.preview_completed;
                if (state.previewCompleted) {
                    stopPolling();
                    setNotice('Preview complete. You can now publish this survey.', 'success');
                }
                if (!wasReady || wasCompleted !== state.previewCompleted) render();
                return state.previewCompleted;
            }).catch(function (error) {
                if (!current()) return false;
                if (error.code === 'preview_preparing' && error.status === 425) {
                    state.readyAt = error.ready_at || state.readyAt;
                    retry = Number.isFinite(error.retry_after_ms) && error.retry_after_ms > 0
                        ? error.retry_after_ms : 500;
                    updatePreparationProgress();
                    return false;
                }
                if (error.code === 'preview_expired') {
                    state.previewToken = null;
                    state.previewUrl = null;
                    state.previewReady = false;
                    state.previewCompleted = false;
                    forgetPreview();
                    stopPolling();
                    setNotice('That preview expired. Generate a fresh preview.', 'error');
                    render();
                    return false;
                }
                handleError(error);
                return false;
            }).finally(function () {
                if (!isCurrent(epoch)) return;
                previewRead = null;
                if (current() && state.previewToken && !state.previewCompleted) {
                    state.pollTimer = window.setTimeout(checkPreviewCompletion, Math.min(2147483647, retry));
                }
            });
            return previewRead;
        }

        function startPolling() {
            stopPolling();
            updatePreparationProgress();
            checkPreviewCompletion();
        }

        function stopPolling() {
            if (state.pollTimer) window.clearTimeout(state.pollTimer);
            if (state.progressTimer) window.clearTimeout(state.progressTimer);
            state.pollTimer = null;
            state.progressTimer = null;
        }

        function isCurrent(epoch) {
            return state.open && state.epoch === epoch;
        }

        function cancelPending() {
            stopPolling();
            state.epoch += 1;
            previewRead = null;
            state.settingsSaving = {};
        }

        function rememberPreview() {
            try {
                window.sessionStorage.setItem('leai.questionSetWizard.return', JSON.stringify(
                    buildPreviewReturnState(state.draft, state.revision, state.previewToken, state.previewUrl)));
            } catch (error) { /* Storage may be unavailable; this open tab still works. */ }
        }

        function forgetPreview() {
            try { window.sessionStorage.removeItem('leai.questionSetWizard.return'); } catch (error) { /* Optional storage. */ }
        }

        function updatePreparationProgress() {
            if (state.progressTimer) window.clearTimeout(state.progressTimer);
            state.progressTimer = null;
            if (!state.open || state.step !== 3 || !state.previewToken || state.previewReady) return;
            const start = state.preparationStarted || Date.now();
            const duration = Date.parse(state.readyAt) - start;
            const measured = duration > 0 ? Math.floor(100 * (Date.now() - start) / duration) : 0;
            state.preparationProgress = Math.max(state.preparationProgress, Math.min(99, Math.max(0, measured)));
            const bar = content.querySelector('[role="progressbar"]');
            if (bar) {
                bar.setAttribute('aria-valuenow', String(state.preparationProgress));
                bar.setAttribute('aria-valuetext', state.preparationProgress + '% prepared; waiting for the server');
                bar.firstChild.style.width = state.preparationProgress + '%';
            }
            state.progressTimer = window.setTimeout(updatePreparationProgress, 100);
        }

        function completionSettings(result) {
            return {
                completion_certificate_enabled: result.completion_certificate_enabled === true,
                parsed_document_download_enabled: result.parsed_document_download_enabled === true,
            };
        }

        function settingsPending() {
            return Object.values(state.settingsSaving).some(Boolean);
        }

        function renderSettings() {
            // Keep controls and their pending handlers alive when readiness or
            // completion updates the surrounding Preview step.
            const existing = content.querySelector('.qsw-settings');
            if (existing && existing.dataset.token === state.previewToken) {
                existing.querySelectorAll('input').forEach(input => {
                    if (!state.settingsSaving[input.dataset.setting]) {
                        input.checked = state.settings[input.dataset.setting] === true;
                    }
                });
                return existing;
            }
            const wrap = element('section', 'qsw-settings');
            wrap.dataset.token = state.previewToken;
            wrap.appendChild(element('h3', '', 'Completion downloads'));
            [
                ['completion_certificate_enabled', 'Completion certificate', 'After finishing, students can download a PDF certificate. During instructor preview it is watermarked Instructor preview - not valid and is not verifiable.'],
                ['parsed_document_download_enabled', 'Completion form', 'After finishing, students can download a DOCX summary of their conversation. It contains their preview or student answers; store and share it with care.'],
            ].forEach(([key, name, explanation]) => {
                const row = element('div', 'qsw-setting');
                const line = element('div', 'qsw-setting-line');
                const label = element('label', 'qsw-switch-label');
                const input = element('input');
                input.type = 'checkbox';
                input.dataset.setting = key;
                input.setAttribute('role', 'switch');
                input.setAttribute('aria-label', name);
                input.checked = state.settings[key] === true;
                input.disabled = !!state.settingsSaving[key];
                label.appendChild(input);
                label.appendChild(element('span', '', name));
                const help = element('button', 'qsw-help-button', '?');
                help.type = 'button';
                help.setAttribute('aria-label', 'About ' + name);
                help.setAttribute('aria-expanded', 'false');
                const description = element('p', 'qsw-setting-help', explanation);
                description.id = 'qsw-help-' + key;
                description.hidden = true;
                help.setAttribute('aria-controls', description.id);
                help.addEventListener('click', () => {
                    description.hidden = !description.hidden;
                    help.setAttribute('aria-expanded', String(!description.hidden));
                });
                const status = element('p', 'qsw-setting-status', state.settingsStatus[key] || '');
                status.setAttribute('role', 'status');
                status.setAttribute('aria-live', 'polite');
                input.addEventListener('change', () => {
                    const epoch = state.epoch;
                    const token = state.previewToken;
                    const persisted = state.settings[key];
                    const selected = input.checked === true;
                    state.settingsSaving[key] = true;
                    input.disabled = true;
                    status.textContent = 'Saving…';
                    primaryButton.disabled = true;
                    api.updatePreviewSettings(token, { [key]: selected }).then(result => {
                        if (!isCurrent(epoch) || state.previewToken !== token) return;
                        state.settings = { ...state.settings, [key]: result[key] === true };
                        input.checked = state.settings[key];
                        state.settingsStatus[key] = 'Applied live';
                        status.textContent = 'Applied live';
                    }).catch(() => {
                        if (!isCurrent(epoch) || state.previewToken !== token) return;
                        input.checked = persisted;
                        state.settingsStatus[key] = 'Could not save ' + name + '. Try again.';
                        status.textContent = state.settingsStatus[key];
                    }).finally(() => {
                        if (!isCurrent(epoch) || state.previewToken !== token) return;
                        state.settingsSaving[key] = false;
                        input.disabled = false;
                        setBusy(state.busy);
                    });
                });
                line.appendChild(label);
                line.appendChild(help);
                row.appendChild(line);
                row.appendChild(description);
                row.appendChild(status);
                wrap.appendChild(row);
            });
            wrap.appendChild(element('p', 'qsw-field-hint', 'Reload the already-open preview, or open it again, to check changes.'));
            return wrap;
        }

        function renderSchedule() {
            title.textContent = state.receipt ? 'Your survey is ready' : 'Publish this survey';
            if (state.receipt) {
                var receipt = element('div', 'qsw-receipt');
                receipt.appendChild(element('span', 'qsw-receipt-check', '✓'));
                receipt.appendChild(element('h3', '', state.receipt.survey_label || state.receipt.name));
                receipt.appendChild(element(
                    'p',
                    '',
                    'This link is for this survey only. Student responses will use the exact revision you previewed.',
                ));
                var linkBox = element('div', 'qsw-link-box');
                var link = element('span', '', absoluteSurveyUrl(state.receipt.public_id));
                var copy = element('button', 'qsw-button qsw-button-secondary', 'Copy link');
                copy.type = 'button';
                copy.addEventListener('click', function () {
                    navigator.clipboard.writeText(link.textContent).then(function () {
                        copy.textContent = 'Copied';
                        window.setTimeout(function () { copy.textContent = 'Copy link'; }, 1800);
                    }).catch(function () {
                        setNotice('Copy failed. Select the link text and copy it manually.', 'error');
                    });
                });
                linkBox.appendChild(link);
                linkBox.appendChild(copy);
                receipt.appendChild(linkBox);
                var open = element('a', 'qsw-button qsw-button-secondary', 'Open survey ↗');
                open.href = absoluteSurveyUrl(state.receipt.public_id);
                open.target = '_blank';
                open.rel = 'noopener';
                receipt.appendChild(open);
                replaceChildren(content, receipt);
                backButton.hidden = true;
                secondaryButton.hidden = true;
                primaryButton.hidden = false;
                primaryButton.textContent = 'Done';
                primaryButton.disabled = false;
                footerStatus.textContent = 'Saved to the Structured Feedback survey list';
                return;
            }

            var wrap = element('div', 'qsw-schedule-layout');
            var form = element('div', 'qsw-schedule-form');
            form.appendChild(element(
                'p',
                'qsw-lead',
                'Publish one shareable survey now. It becomes available immediately unless you choose an opening time.',
            ));
            var label = inputField('Survey label', state.draft.body.title, {
                placeholder: 'Week 3 learning reflection',
                hint: 'Instructors see this label in the survey list; students see it on the consent screen.',
            });
            label.input.id = 'qsw-survey-label';
            form.appendChild(label.field);
            var dates = element('div', 'qsw-field-grid');
            var week = inputField('Week / milestone (optional)', '', { type: 'number', min: '1' });
            week.input.id = 'qsw-week';
            var opens = inputField('Opens (optional)', '', { type: 'datetime-local' });
            opens.input.id = 'qsw-opens';
            var expires = inputField('Closes (optional)', '', { type: 'datetime-local' });
            expires.input.id = 'qsw-expires';
            dates.appendChild(week.field);
            dates.appendChild(opens.field);
            dates.appendChild(expires.field);
            form.appendChild(element(
                'p',
                'qsw-field-grid-hint',
                'Week / milestone is an optional organizing number shown only in your instructor survey list.',
            ));
            form.appendChild(dates);
            wrap.appendChild(form);
            var summary = element('aside', 'qsw-publish-summary');
            summary.appendChild(element('span', 'qsw-aside-kicker', 'Publication summary'));
            summary.appendChild(element('h3', '', state.draft.body.title));
            summary.appendChild(element('p', '', state.draft.body.sections.length + ' guided questions'));
            summary.appendChild(element('p', '', 'Student preview complete'));
            summary.appendChild(element('p', '', 'Anonymous individual responses'));
            summary.appendChild(element('p', '', 'Completion certificate: ' + (state.settings.completion_certificate_enabled ? 'On' : 'Off')));
            summary.appendChild(element('p', '', 'Completion form: ' + (state.settings.parsed_document_download_enabled ? 'On' : 'Off')));
            wrap.appendChild(summary);
            replaceChildren(content, wrap);
            backButton.hidden = false;
            backButton.textContent = 'Back to preview';
            secondaryButton.hidden = true;
            primaryButton.hidden = false;
            primaryButton.textContent = 'Publish survey & get link';
            primaryButton.disabled = false;
            footerStatus.textContent = 'Creates one survey; no recurring series';
        }

        function absoluteSurveyUrl(publicId) {
            var current = window.location.href.split('#')[0].split('?')[0];
            return current.replace('PromptDesigner.html', 'feedback.html') + '?id=' + publicId;
        }

        function createSurvey() {
            if (!state.previewReady || !state.previewCompleted || settingsPending() || state.busy) return;
            const epoch = state.epoch;
            var label = document.getElementById('qsw-survey-label').value.trim();
            var weekValue = document.getElementById('qsw-week').value;
            var opensAt = document.getElementById('qsw-opens').value;
            var expiresAt = document.getElementById('qsw-expires').value;
            if (!label) {
                setNotice('Add a survey label before creating the link.', 'error');
                document.getElementById('qsw-survey-label').focus();
                return;
            }
            if (opensAt && expiresAt && new Date(opensAt) >= new Date(expiresAt)) {
                setNotice('Closing time must be after opening time.', 'error');
                return;
            }
            setBusy(true, 'Publishing survey…');
            api.createSurvey(state.revision.id, {
                courseId: course().id,
                idempotencyKey: state.idempotencyKey,
                surveyLabel: label,
                weekNumber: weekValue ? parseInt(weekValue, 10) : null,
                opensAt: isoOrNull(opensAt),
                expiresAt: isoOrNull(expiresAt),
                previewToken: state.previewToken,
            }).then(function (receipt) {
                if (!isCurrent(epoch)) return;
                state.receipt = receipt;
                state.drafts = [];
                forgetPreview();
                notifyDraftsChanged();
                setNotice('', '');
                if (typeof options.onCreated === 'function') options.onCreated(receipt);
                render();
            }).catch(error => { if (isCurrent(epoch)) handleError(error); })
                .finally(() => { if (isCurrent(epoch)) setBusy(false); });
        }

        function handleError(error) {
            var messages = {
                stale_draft: 'This draft changed in another tab. Close and reopen the builder to load the latest version.',
                invalid_question_set: error && error.message,
                preview_required: 'Complete the real preview before creating this survey.',
                preview_expired: 'The preview link expired. Launch a fresh preview.',
                capability_denied: 'Your course role does not allow publishing.',
            };
            setNotice(messages[error && error.code] || 'Something went wrong. Please try again.', 'error');
        }

        function render() {
            const changedStep = renderedStep !== state.step;
            const focused = document.activeElement;
            updateProgress();
            if (state.step === 1) renderChoose();
            if (state.step === 2) renderEdit();
            if (state.step === 3) renderPreview();
            if (state.step === 4) renderSchedule();
            if (changedStep) content.scrollTop = 0;
            else if (focused && focused.isConnected && content.contains(focused)) focused.focus({ preventScroll: true });
            renderedStep = state.step;
        }

        function open(resume) {
            var activeCourse = course();
            if (!activeCourse) return Promise.resolve(false);
            const resumeDraft = resume === true ? state.drafts[0] : null;
            if (resume === true && !resumeDraft) return Promise.resolve(false);
            const replace = !resumeDraft && state.drafts.length > 0;
            if (replace && !window.confirm('Create a new structured feedback? Your unfinished setup will be replaced. Its history will be kept.')) return Promise.resolve(false);
            cancelPending();
            const epoch = state.epoch;
            state.open = true;
            state.confirmAbandonActive = replace;
            state.step = 1;
            state.dirty = false;
            state.revision = null;
            state.previewToken = null;
            state.previewUrl = null;
            state.previewReady = false;
            state.previewCompleted = false;
            state.receipt = null;
            state.idempotencyKey = randomIdempotencyKey();
            setNotice('', '');
            rootEl.hidden = false;
            document.body.classList.add('qsw-open');
            subtitle.textContent = activeCourse.name + ' · ' + activeCourse.id;
            replaceChildren(content, element('p', 'qsw-lead', 'Loading templates and saved drafts…'));
            backButton.hidden = true;
            secondaryButton.hidden = true;
            primaryButton.hidden = true;
            closeButton.focus();
            setBusy(true, 'Loading templates and saved drafts…');
            if (resumeDraft) {
                return Promise.all([api.getDraft(resumeDraft.id), api.listTemplates()]).then(([latest, templates]) => {
                    if (!isCurrent(epoch)) return;
                    if (latest.workflow_status && latest.workflow_status !== 'active') throw new WizardApiError('inactive_draft', 409);
                    state.templates = templates.templates || [];
                    state.draft = latest;
                    state.drafts = [latest];
                    state.step = 2;
                    notifyDraftsChanged();
                    render();
                    focusEditorStart();
                }).catch(error => { if (isCurrent(epoch)) handleError(error); })
                    .finally(() => { if (isCurrent(epoch)) setBusy(false); });
            }
            return Promise.all([
                api.listTemplates(),
                api.listDrafts(activeCourse.id),
            ]).then(function (results) {
                if (!isCurrent(epoch)) return;
                state.templates = results[0].templates || [];
                state.drafts = activeDrafts(results[1]);
                notifyDraftsChanged();
                render();
            }).catch(function (error) {
                if (!isCurrent(epoch)) return;
                handleError(error);
                replaceChildren(content, element(
                    'p',
                    'qsw-lead',
                    'The builder could not load. Close it and try again.',
                ));
                footerStatus.textContent = 'Nothing was changed.';
            }).finally(function () { if (isCurrent(epoch)) setBusy(false); });
        }

        function close(force) {
            if (!force && state.dirty && !window.confirm('Close without saving your latest changes?')) {
                return false;
            }
            cancelPending();
            state.open = false;
            rootEl.hidden = true;
            document.body.classList.remove('qsw-open');
            openButton.focus();
            return true;
        }

        function restoreSameTabPreview() {
            var raw = null;
            try {
                raw = window.sessionStorage.getItem('leai.questionSetWizard.return');
                window.sessionStorage.removeItem('leai.questionSetWizard.return');
            } catch (error) {
                return Promise.resolve(false);
            }
            if (!raw) return Promise.resolve(false);
            var saved;
            try { saved = JSON.parse(raw); }
            catch (error) { return Promise.resolve(false); }
            if (!saved || !saved.draftId || !saved.revisionId || !saved.previewToken) {
                return Promise.resolve(false);
            }
            var activeCourse = course();
            if (!activeCourse) return Promise.resolve(false);

            cancelPending();
            const epoch = state.epoch;
            const restoreIsCurrent = () => state.epoch === epoch && course() && course().id === activeCourse.id;

            return api.getDraft(saved.draftId).then(function (draft) {
                if (!restoreIsCurrent()) return false;
                if (draft.course_id !== activeCourse.id) {
                    throw new WizardApiError('course_mismatch', 400);
                }
                state.open = true;
                state.receipt = null;
                state.dirty = false;
                rootEl.hidden = false;
                document.body.classList.add('qsw-open');
                subtitle.textContent = activeCourse.name + ' · ' + activeCourse.id;
                replaceChildren(content, element('p', 'qsw-lead', 'Restoring your preview…'));
                closeButton.focus();
                setBusy(true, 'Restoring your preview…');

                return Promise.all([
                    api.freezeDraft(saved.draftId, saved.draftVersion),
                    api.listDrafts(activeCourse.id),
                    api.listTemplates(),
                ]).then(function (results) {
                    if (!isCurrent(epoch) || !restoreIsCurrent()) return false;
                    const revision = results[0].revision;
                    if (!revision || String(revision.id) !== String(saved.revisionId) ||
                            (draft.workflow_status && draft.workflow_status !== 'active')) {
                        throw new WizardApiError('preview_revision_mismatch', 409);
                    }
                    state.draft = draft;
                    state.revision = revision;
                    state.previewToken = saved.previewToken;
                    state.previewUrl = saved.previewUrl ||
                        ('feedback.html?preview=' + encodeURIComponent(saved.previewToken));
                    state.previewCompleted = false;
                    state.previewReady = false;
                    state.settings = {};
                    state.settingsSaving = {};
                    state.settingsStatus = {};
                    state.readyAt = null;
                    state.preparationStarted = Date.now();
                    state.preparationProgress = 0;
                    state.drafts = activeDrafts(results[1]);
                    state.templates = results[2].templates || [];
                    notifyDraftsChanged();
                    state.idempotencyKey = idempotencyKeyForRevision(revision.id);
                    state.step = 3;
                    render();
                    rememberPreview();
                    startPolling();
                    return true;
                });
            }).catch(function (error) {
                if (!restoreIsCurrent()) return false;
                if (state.open) close(true);
                else cancelPending();
                const recoveryEpoch = state.epoch;
                const recoveryIsCurrent = () => state.epoch === recoveryEpoch && !state.open && course() && course().id === activeCourse.id;
                return api.listDrafts(activeCourse.id).then(function (result) {
                    if (!recoveryIsCurrent()) return;
                    state.drafts = activeDrafts(result);
                    notifyDraftsChanged();
                }).catch(function () {}).then(function () {
                    if (recoveryIsCurrent() && typeof options.onRestoreError === 'function') options.onRestoreError(error);
                    return null;
                });
            }).finally(function () { if (isCurrent(epoch)) setBusy(false); });
        }

        function activeDrafts(result) {
            return (result.drafts || []).filter(draft => !draft.workflow_status || draft.workflow_status === 'active').slice(0, 1);
        }

        openButton.addEventListener('click', () => open(false));
        if (resumeButton) resumeButton.addEventListener('click', () => open(true));
        closeButton.addEventListener('click', function () { close(false); });
        rootEl.addEventListener('click', function (event) {
            if (event.target === rootEl) close(false);
        });
        rootEl.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                close(false);
                return;
            }
            if (event.key === 'Tab') {
                var focusable = Array.prototype.filter.call(
                    rootEl.querySelectorAll(
                        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    ),
                    function (node) { return !node.hidden && node.offsetParent !== null; },
                );
                if (!focusable.length) return;
                var first = focusable[0];
                var last = focusable[focusable.length - 1];
                if (document.activeElement === footerStatus) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        backButton.addEventListener('click', function () {
            if (state.busy) return;
            if (state.step === 2) {
                if (state.dirty && !window.confirm('Go back without saving your latest changes?')) return;
                // Returning to templates is another explicit replacement choice.
                if (!window.confirm('Choose a new template? Your unfinished setup will be replaced when you select it. Its history will be kept.')) return;
                state.confirmAbandonActive = true;
                state.dirty = false;
                state.step = 1;
            } else if (state.step === 3) {
                cancelPending();
                forgetPreview();
                state.step = 2;
            } else if (state.step === 4) {
                state.step = 3;
                startPolling();
            }
            render();
        });
        secondaryButton.addEventListener('click', function () {
            if (state.step !== 2 || state.busy) return;
            const epoch = state.epoch;
            saveCurrentDraft().then(() => {
                if (isCurrent(epoch)) render();
            }).catch(function () {}).finally(() => {
                if (isCurrent(epoch) && state.step === 2) focusEditorStart();
            });
        });
        primaryButton.addEventListener('click', function () {
            if (state.busy) return;
            if (state.step === 2) {
                cancelPending();
                forgetPreview();
                const epoch = state.epoch;
                var save = state.dirty ? saveCurrentDraft() : Promise.resolve(state.draft);
                setBusy(true, 'Saving and preparing preview…');
                save.then(function (draft) {
                    if (!isCurrent(epoch)) return null;
                    setBusy(true, 'Freezing exact revision…');
                    return api.freezeDraft(draft.id, draft.version);
                }).then(function (result) {
                    if (!isCurrent(epoch) || !result) return;
                    state.revision = result.revision;
                    state.idempotencyKey = idempotencyKeyForRevision(result.revision.id);
                    state.previewCompleted = false;
                    state.previewToken = null;
                    state.previewUrl = null;
                    setNotice('', '');
                    return launchPreview();
                }).catch(error => { if (isCurrent(epoch)) handleError(error); })
                    .finally(() => { if (isCurrent(epoch)) setBusy(false); });
            } else if (state.step === 3 && state.previewReady && state.previewCompleted && !settingsPending()) {
                stopPolling();
                state.step = 4;
                render();
            } else if (state.step === 4 && state.receipt) {
                close(true);
            } else if (state.step === 4) {
                createSurvey();
            }
        });
        window.addEventListener('beforeunload', function (event) {
            if (!state.open || !state.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });

        return {
            open: open,
            close: close,
            restoreSameTabPreview: restoreSameTabPreview,
            refreshDrafts: function () {
                var activeCourse = course();
                if (!activeCourse) return Promise.resolve([]);
                return api.listDrafts(activeCourse.id).then(function (result) {
                    state.drafts = activeDrafts(result);
                    notifyDraftsChanged();
                    return state.drafts;
                });
            },
            getState: function () { return state; },
        };
    }

    return {
        WizardApiError: WizardApiError,
        createApi: createApi,
        mount: mount,
        randomIdempotencyKey: randomIdempotencyKey,
        idempotencyKeyForRevision: idempotencyKeyForRevision,
        shouldConfirmModeSwitch: shouldConfirmModeSwitch,
        buildPreviewReturnState: buildPreviewReturnState,
    };
}));
