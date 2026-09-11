(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.leaiQuestionSetWizard = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function WizardApiError(code, status, message) {
        this.name = 'WizardApiError';
        this.code = code || 'request_failed';
        this.status = status || 0;
        this.message = message || this.code;
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
            createDraft: function (courseId, templateId) {
                return auth('/question_set_drafts/', jsonOptions('POST', {
                    course_id: courseId,
                    template_id: templateId,
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
        };

        rootEl.className = 'qsw-overlay';
        rootEl.hidden = true;
        rootEl.setAttribute('role', 'dialog');
        rootEl.setAttribute('aria-modal', 'true');
        rootEl.setAttribute('aria-labelledby', 'qsw-title');

        var panel = element('section', 'qsw-panel');
        var header = element('header', 'qsw-header');
        var headerCopy = element('div', 'qsw-header-copy');
        var eyebrow = element('div', 'qsw-eyebrow', 'Structured reflection builder');
        var title = element('h2', '', 'Create a question set');
        title.id = 'qsw-title';
        var subtitle = element('p', 'qsw-subtitle');
        var closeButton = element('button', 'qsw-icon-button', '×');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close question set builder');
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
            if (typeof options.onDraftsChanged === 'function') {
                options.onDraftsChanged(state.drafts.slice());
            }
        }

        function setBusy(busy, label) {
            state.busy = busy;
            rootEl.classList.toggle('qsw-busy', busy);
            if (busy) {
                [backButton, secondaryButton, primaryButton].forEach(function (button) {
                    button.disabled = true;
                });
                footerStatus.textContent = label || '';
                return;
            }
            closeButton.disabled = false;
            backButton.disabled = false;
            secondaryButton.disabled = state.step === 2 ? !state.dirty : false;
            primaryButton.disabled = state.step === 3 ? !state.previewCompleted : false;
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

            if (state.drafts.length) {
                var resumeSection = element('section', 'qsw-resume');
                resumeSection.appendChild(element('h3', '', 'Continue a saved draft'));
                state.drafts.forEach(function (draft) {
                    var row = element('div', 'qsw-resume-row');
                    var copy = element('div');
                    copy.appendChild(element('strong', '', draft.title));
                    copy.appendChild(element(
                        'span',
                        '',
                        draft.body.sections.length + ' questions · saved ' +
                            new Date(draft.updated_at).toLocaleString(),
                    ));
                    var button = element('button', 'qsw-button qsw-button-secondary', 'Resume editing');
                    button.type = 'button';
                    button.addEventListener('click', function () {
                        setBusy(true, 'Loading the latest saved draft…');
                        api.getDraft(draft.id).then(function (latest) {
                            state.draft = latest;
                            state.drafts = state.drafts.map(function (candidate) {
                                return candidate.id === latest.id ? latest : candidate;
                            });
                            state.revision = null;
                            state.previewToken = null;
                            state.previewUrl = null;
                            state.previewCompleted = false;
                            state.dirty = false;
                            state.step = 2;
                            render();
                            focusEditorStart();
                        }).catch(handleError).finally(function () { setBusy(false); });
                    });
                    row.appendChild(copy);
                    row.appendChild(button);
                    resumeSection.appendChild(row);
                });
                wrap.appendChild(resumeSection);
            }

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
                    if (!activeCourse) return;
                    setBusy(true, 'Creating your draft…');
                    api.createDraft(activeCourse.id, template.id).then(function (draft) {
                        state.draft = draft;
                        state.drafts.unshift(draft);
                        notifyDraftsChanged();
                        state.step = 2;
                        state.dirty = false;
                        setNotice('', '');
                        render();
                        focusEditorStart();
                    }).catch(handleError).finally(function () { setBusy(false); });
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
            primaryButton.textContent = 'Save changes & prepare preview';
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
            setBusy(true, 'Saving draft…');
            return api.saveDraft(
                state.draft.id,
                state.draft.version,
                collectBody(),
            ).then(function (draft) {
                state.draft = draft;
                state.drafts = state.drafts.map(function (candidate) {
                    return candidate.id === draft.id ? draft : candidate;
                });
                state.dirty = false;
                notifyDraftsChanged();
                setNotice('Draft saved.', 'success');
                return draft;
            }).catch(function (error) {
                handleError(error);
                throw error;
            }).finally(function () { setBusy(false); });
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
                    'Prepare student preview',
                );
                launch.type = 'button';
                launch.addEventListener('click', launchPreview);
                visual.appendChild(launch);
            } else if (state.previewUrl) {
                var newTabLink = element('a', 'qsw-button qsw-button-primary qsw-launch-button', 'Open preview in a new tab ↗');
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
            if (!state.previewCompleted && state.previewToken) {
                var check = element('button', 'qsw-button qsw-button-secondary', 'Check completion');
                check.type = 'button';
                check.addEventListener('click', checkPreviewCompletion);
                checklist.appendChild(check);
            }
            wrap.appendChild(checklist);
            replaceChildren(content, wrap);

            backButton.hidden = false;
            backButton.textContent = 'Back to edit';
            secondaryButton.hidden = true;
            primaryButton.hidden = false;
            primaryButton.textContent = state.previewCompleted ? 'Continue to publish' : 'Complete preview first';
            primaryButton.disabled = !state.previewCompleted;
            footerStatus.textContent = state.previewCompleted
                ? 'Preview completed for this exact revision'
                : 'Survey creation stays locked until the closing is reached';
        }

        function launchPreview() {
            if (state.previewToken) return;
            setBusy(true, 'Preparing isolated preview…');
            api.createPreview(state.revision.id).then(function (result) {
                state.previewToken = result.token;
                var target = result.preview_url || ('feedback.html?preview=' + encodeURIComponent(result.token));
                state.previewUrl = target;
                if (!state.previewCompleted) startPolling();
                render();
            }).catch(function (error) {
                handleError(error);
            }).finally(function () { setBusy(false); });
        }

        function checkPreviewCompletion() {
            if (!state.previewToken) return Promise.resolve(false);
            return api.getPreview(state.previewToken).then(function (result) {
                state.previewCompleted = state.previewCompleted || !!result.preview_completed;
                if (state.previewCompleted) {
                    stopPolling();
                    setNotice('Preview complete. You can now publish this survey.', 'success');
                    render();
                }
                return state.previewCompleted;
            }).catch(function (error) {
                if (error.code === 'preview_expired') {
                    state.previewToken = null;
                    stopPolling();
                    setNotice('That preview expired. Launch a fresh preview.', 'error');
                    render();
                    return false;
                }
                handleError(error);
                return false;
            });
        }

        function startPolling() {
            stopPolling();
            state.pollTimer = window.setInterval(checkPreviewCompletion, 2000);
        }

        function stopPolling() {
            if (state.pollTimer) window.clearInterval(state.pollTimer);
            state.pollTimer = null;
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
                footerStatus.textContent = 'Saved to the Structured Reflection survey list';
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
            }).then(function (receipt) {
                state.receipt = receipt;
                setNotice('', '');
                if (typeof options.onCreated === 'function') options.onCreated(receipt);
                render();
            }).catch(handleError).finally(function () { setBusy(false); });
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
            updateProgress();
            if (state.step === 1) renderChoose();
            if (state.step === 2) renderEdit();
            if (state.step === 3) renderPreview();
            if (state.step === 4) renderSchedule();
        }

        function open() {
            var activeCourse = course();
            if (!activeCourse) return;
            state.open = true;
            state.step = 1;
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
            Promise.all([
                api.listTemplates(),
                api.listDrafts(activeCourse.id),
            ]).then(function (results) {
                state.templates = results[0].templates || [];
                state.drafts = results[1].drafts || [];
                notifyDraftsChanged();
                render();
            }).catch(function (error) {
                handleError(error);
                replaceChildren(content, element(
                    'p',
                    'qsw-lead',
                    'The builder could not load. Close it and try again.',
                ));
                footerStatus.textContent = 'Nothing was changed.';
            }).finally(function () { setBusy(false); });
        }

        function close(force) {
            if (!force && state.dirty && !window.confirm('Close without saving your latest changes?')) {
                return false;
            }
            stopPolling();
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

            state.open = true;
            state.receipt = null;
            state.dirty = false;
            rootEl.hidden = false;
            document.body.classList.add('qsw-open');
            subtitle.textContent = activeCourse.name + ' · ' + activeCourse.id;
            replaceChildren(content, element('p', 'qsw-lead', 'Restoring your completed preview…'));
            closeButton.focus();
            setBusy(true, 'Restoring your completed preview…');

            return Promise.all([
                api.getDraft(saved.draftId),
                api.getPreview(saved.previewToken),
                api.freezeDraft(saved.draftId, saved.draftVersion),
                api.listDrafts(activeCourse.id),
            ]).then(function (results) {
                var draft = results[0];
                var preview = results[1];
                var revision = results[2].revision;
                if (!revision || String(revision.id) !== String(saved.revisionId)) {
                    throw new WizardApiError('preview_revision_mismatch', 409);
                }
                state.draft = draft;
                state.revision = revision;
                state.previewToken = saved.previewToken;
                state.previewUrl = saved.previewUrl ||
                    ('feedback.html?preview=' + encodeURIComponent(saved.previewToken));
                state.previewCompleted = !!preview.preview_completed;
                state.drafts = results[3].drafts || [];
                notifyDraftsChanged();
                state.idempotencyKey = idempotencyKeyForRevision(revision.id);
                state.step = 3;
                if (!state.previewCompleted) startPolling();
                render();
                return true;
            }).catch(function (error) {
                close(true);
                return api.listDrafts(activeCourse.id).then(function (result) {
                    state.drafts = result.drafts || [];
                    notifyDraftsChanged();
                }).catch(function () {}).then(function () {
                    if (typeof options.onRestoreError === 'function') options.onRestoreError(error);
                    return null;
                });
            }).finally(function () { setBusy(false); });
        }

        openButton.addEventListener('click', open);
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
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        backButton.addEventListener('click', function () {
            if (state.step === 2) {
                if (state.dirty && !window.confirm('Go back without saving your latest changes?')) return;
                state.step = 1;
            } else if (state.step === 3) {
                state.step = 2;
            } else if (state.step === 4) {
                state.step = 3;
            }
            render();
        });
        secondaryButton.addEventListener('click', function () {
            if (state.step === 2) saveCurrentDraft().then(render).catch(function () {});
        });
        primaryButton.addEventListener('click', function () {
            if (state.step === 2) {
                var save = state.dirty ? saveCurrentDraft() : Promise.resolve(state.draft);
                save.then(function (draft) {
                    setBusy(true, 'Freezing exact revision…');
                    return api.freezeDraft(draft.id, draft.version);
                }).then(function (result) {
                    state.revision = result.revision;
                    state.idempotencyKey = idempotencyKeyForRevision(result.revision.id);
                    state.previewCompleted = !!result.revision.preview_completed;
                    state.previewToken = null;
                    state.previewUrl = null;
                    state.step = 3;
                    setNotice('', '');
                    render();
                }).catch(handleError).finally(function () { setBusy(false); });
            } else if (state.step === 3 && state.previewCompleted) {
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
                    state.drafts = result.drafts || [];
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
