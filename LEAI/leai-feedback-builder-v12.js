(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./leai-question-set-wizard.js'));
    else root.leaiFeedbackBuilderV12 = factory(root.leaiQuestionSetWizard);
}(typeof self !== 'undefined' ? self : this, function (wizardCore) {
    'use strict';

    const STEP_LABELS = ['Audience', 'Format', 'Build', 'Preview', 'Publish'];
    const AUTOSAVE_DELAY = 1200;

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
        }[character]));
    }

    function key(prefix) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + '-' + crypto.randomUUID();
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function bodyId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
    }

    function isoOrNull(value) {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    function elapsedLabel(date) {
        if (!date) return 'Not saved yet';
        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 5) return 'Saved just now';
        if (seconds < 60) return 'Saved ' + seconds + ' seconds ago';
        const minutes = Math.floor(seconds / 60);
        return 'Saved ' + minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    }

    function mount(options) {
        const rootEl = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
        const openButton = typeof options.openButton === 'string' ? document.querySelector(options.openButton) : options.openButton;
        const resumeButton = typeof options.resumeButton === 'string' ? document.querySelector(options.resumeButton) : options.resumeButton;
        if (!rootEl || !openButton || !wizardCore) return null;

        const api = wizardCore.createApi({
            apiBase: options.apiBase,
            authorizedFetch: options.authorizedFetch,
            fetch: options.fetch || window.fetch.bind(window),
        });
        const state = {
            open: false,
            busy: false,
            step: 1,
            audience: null,
            collectionStyle: null,
            sourceKind: 'blank',
            selectedTemplateRevisionId: null,
            templateSource: 'leai',
            templates: [],
            drafts: [],
            draft: null,
            versions: [],
            conversation: null,
            revision: null,
            previewToken: null,
            previewUrl: null,
            previewReady: false,
            previewCompleted: false,
            previewSkipped: false,
            readyAt: null,
            settings: {
                completion_certificate_enabled: true,
                parsed_document_download_enabled: false,
            },
            dirty: false,
            savedAt: null,
            autosaveTimer: null,
            savePromise: null,
            saveAgeTimer: null,
            pollTimer: null,
            progressTimer: null,
            replaceConfirmed: false,
            teamConfigurations: [],
            selectedTeamConfigurationId: '',
            teamSetupOpen: false,
            receipt: null,
            savedTemplate: null,
            howOpen: false,
            historyOpen: false,
            templateFormOpen: false,
            skipWarningSeen: false,
        };

        rootEl.className = 'fbv12-overlay';
        rootEl.hidden = true;
        rootEl.setAttribute('role', 'dialog');
        rootEl.setAttribute('aria-modal', 'true');
        rootEl.setAttribute('aria-label', 'Create feedback');

        function activeCourse() {
            return typeof options.getCourse === 'function' ? options.getCourse() : null;
        }

        function setBusy(value) {
            state.busy = value;
            rootEl.classList.toggle('is-busy', value);
            rootEl.setAttribute('aria-busy', String(value));
        }

        function notifyDrafts() {
            if (resumeButton) resumeButton.hidden = state.drafts.length === 0;
            if (typeof options.onDraftsChanged === 'function') options.onDraftsChanged(state.drafts.slice());
        }

        function stopTimers() {
            clearTimeout(state.autosaveTimer);
            clearInterval(state.saveAgeTimer);
            clearTimeout(state.pollTimer);
            clearTimeout(state.progressTimer);
            state.autosaveTimer = null;
            state.saveAgeTimer = null;
            state.pollTimer = null;
            state.progressTimer = null;
        }

        function notice(message, type) {
            const node = rootEl.querySelector('[data-fbv12-notice]');
            if (!node) return;
            node.textContent = message || '';
            node.hidden = !message;
            node.className = 'fbv12-notice ' + (type || '');
        }

        function progressMarkup() {
            return '<ol class="fbv12-steps" aria-label="Feedback creation steps">' + STEP_LABELS.map((label, index) => {
                const number = index + 1;
                const classes = number === state.step ? ' current' : number < state.step ? ' complete' : '';
                return '<li class="fbv12-step' + classes + '"' + (number === state.step ? ' aria-current="step"' : '') + '>' +
                    '<span>' + number + '</span><b>' + label + '</b></li>';
            }).join('') + '</ol>';
        }

        function shell(content) {
            const course = activeCourse() || {};
            rootEl.innerHTML = '<section class="fbv12-panel">' +
                '<header class="fbv12-head"><div><span class="fbv12-eyebrow">Feedback builder</span>' +
                '<h2>Create feedback</h2><p>' + escapeHtml(course.name || '') + ' · ' + escapeHtml(course.id || '') + '</p></div>' +
                '<button type="button" class="fbv12-close" aria-label="Close feedback builder">×</button></header>' +
                progressMarkup() + '<div class="fbv12-notice" data-fbv12-notice hidden></div>' +
                '<main class="fbv12-main">' + content + '</main></section>';
            rootEl.querySelector('.fbv12-close').addEventListener('click', () => close());
        }

        function renderAudience() {
            shell('<section class="fbv12-page"><div class="fbv12-heading"><span class="fbv12-eyebrow">Step 1</span>' +
                '<h1>Who are you collecting feedback from?</h1><p>Choose the purpose. Neither option is preferred over the other.</p></div>' +
                '<div class="fbv12-choice-grid">' +
                '<button class="fbv12-choice" data-audience="individual"><span class="fbv12-icon">I</span><span><b>Individual feedback</b><small>Collect each student’s own learning experience, needs, and suggestions.</small></span></button>' +
                '<button class="fbv12-choice" data-audience="team"><span class="fbv12-icon">T</span><span><b>Team feedback</b><small>Collect private feedback about collaboration inside the team each student selects.</small></span></button>' +
                '</div><div class="fbv12-actions"><button class="fbv12-link" data-how>How LEAI works</button></div>' +
                (state.howOpen ? '<div class="fbv12-how"><button class="fbv12-how-close" data-how aria-label="Close explanation">×</button><h3>How LEAI works</h3>' +
                    '<div class="fbv12-how-flow"><div><span>1</span><b>Choose</b><small>Select a purpose and starting point.</small></div><i>→</i>' +
                    '<div><span>2</span><b>Build</b><small>Edit directly or ask AI for a change.</small></div><i>→</i>' +
                    '<div><span>3</span><b>Preview</b><small>Try the real student flow.</small></div><i>→</i>' +
                    '<div><span>4</span><b>Learn</b><small>Publish, collect, and review patterns.</small></div></div></div>' : '') +
                '</section>');
            rootEl.querySelectorAll('[data-audience]').forEach(button => button.addEventListener('click', async () => {
                state.audience = button.dataset.audience;
                state.collectionStyle = state.audience === 'team' ? 'guided' : null;
                state.step = 2;
                if (state.audience === 'team') {
                    setBusy(true);
                    try { await loadTemplates(); } catch (error) { state.templates = []; }
                    setBusy(false);
                }
                render();
            }));
            rootEl.querySelectorAll('[data-how]').forEach(button => button.addEventListener('click', () => {
                state.howOpen = !state.howOpen;
                renderAudience();
            }));
        }

        function sourceLabel(source) {
            return source === 'mine' ? 'My templates' : source === 'community' ? 'Community' : 'LEAI templates';
        }

        function filteredTemplates() {
            return state.templates.filter(template => template.source === state.templateSource);
        }

        async function loadTemplates() {
            const result = await api.listTemplates(state.audience, state.collectionStyle);
            state.templates = result.templates || [];
            const first = state.templates.find(template => template.source === state.templateSource) || state.templates[0];
            state.selectedTemplateRevisionId = first ? first.revision_id : null;
            state.sourceKind = first ? 'template' : 'blank';
        }

        function templateChooser() {
            const templates = filteredTemplates();
            return '<div class="fbv12-template-library"><div class="fbv12-source-tabs">' + ['leai', 'mine', 'community'].map(source =>
                '<button type="button" data-source="' + source + '" class="' + (source === state.templateSource ? 'active' : '') + '">' + sourceLabel(source) + '</button>'
            ).join('') + '</div><div class="fbv12-template-rail">' + (templates.length ? templates.map(template =>
                '<button type="button" class="fbv12-template' + (template.revision_id === state.selectedTemplateRevisionId && state.sourceKind === 'template' ? ' selected' : '') + '" data-template="' + escapeHtml(template.revision_id) + '">' +
                '<span class="fbv12-template-origin">' + escapeHtml(sourceLabel(template.source)) + ' · revision ' + template.revision_number + '</span>' +
                '<b>' + escapeHtml(template.name) + '</b><small>' + escapeHtml(template.description || 'Reusable guided feedback design') + '</small>' +
                '<span>Fixed copy · editable after selection</span></button>'
            ).join('') : '<div class="fbv12-empty">No compatible templates here yet.</div>') + '</div>' +
                '<button type="button" class="fbv12-template fbv12-blank' + (state.sourceKind === 'blank' ? ' selected' : '') + '" data-blank>' +
                '<span class="fbv12-icon">＋</span><b>Start from scratch</b><small>Create a design manually or ask AI to help.</small></button></div>';
        }

        function renderFormat() {
            const needsStyle = state.audience === 'individual' && !state.collectionStyle;
            const content = needsStyle ? '<section class="fbv12-page"><div class="fbv12-heading"><span class="fbv12-eyebrow">Step 2</span>' +
                '<h1>How should the conversation work?</h1><p>Both paths open the same editable workspace.</p></div>' +
                '<div class="fbv12-choice-grid"><button class="fbv12-choice" data-style="guided"><span class="fbv12-icon">G</span><span><b>Guided feedback</b><small>Every student encounters a planned set of questions and optional follow-ups.</small></span></button>' +
                '<button class="fbv12-choice" data-style="open"><span class="fbv12-icon">O</span><span><b>Open conversation</b><small>Set one opening question and a listening goal, then follow what the student raises.</small></span></button></div>' +
                '<div class="fbv12-footer"><button class="fbv12-secondary" data-back>Back</button></div></section>' :
                '<section class="fbv12-page"><div class="fbv12-heading"><span class="fbv12-eyebrow">Starting point</span><h1>' +
                (state.collectionStyle === 'open' ? 'Start your open conversation' : 'Choose a starting point') + '</h1><p>Everything remains editable after you choose.</p></div>' +
                (state.collectionStyle === 'guided' ? templateChooser() : '<button type="button" class="fbv12-template fbv12-blank selected" data-blank><span class="fbv12-icon">＋</span><b>Start from scratch</b><small>Add the opening, listening goal, and closing in the workspace.</small></button>') +
                '<div class="fbv12-footer"><button class="fbv12-secondary" data-back>Back</button><button class="fbv12-primary" data-start>Open builder</button></div></section>';
            shell(content);
            rootEl.querySelector('[data-back]').addEventListener('click', () => {
                if (state.audience === 'individual' && state.collectionStyle) state.collectionStyle = null;
                else state.step = 1;
                render();
            });
            rootEl.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', async () => {
                state.collectionStyle = button.dataset.style;
                state.templateSource = 'leai';
                setBusy(true);
                try { await loadTemplates(); } catch (error) { state.templates = []; }
                setBusy(false);
                renderFormat();
            }));
            rootEl.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
                state.templateSource = button.dataset.source;
                const first = filteredTemplates()[0];
                if (first) {
                    state.sourceKind = 'template';
                    state.selectedTemplateRevisionId = first.revision_id;
                }
                renderFormat();
            }));
            rootEl.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => {
                state.sourceKind = 'template';
                state.selectedTemplateRevisionId = button.dataset.template;
                renderFormat();
            }));
            rootEl.querySelectorAll('[data-blank]').forEach(button => button.addEventListener('click', () => {
                state.sourceKind = 'blank';
                state.selectedTemplateRevisionId = null;
                renderFormat();
            }));
            const start = rootEl.querySelector('[data-start]');
            if (start) start.addEventListener('click', startDraft);
        }

        async function startDraft() {
            if (state.busy) return;
            const course = activeCourse();
            let confirmReplace = state.replaceConfirmed;
            if (state.drafts.length && !confirmReplace) {
                confirmReplace = window.confirm('Start new feedback? Your most recent unfinished setup will be replaced. Published feedback and saved templates will not change.');
                if (!confirmReplace) return;
            }
            setBusy(true);
            try {
                state.draft = await api.createFeedbackDraft({
                    courseId: course.id,
                    audience: state.audience,
                    collectionStyle: state.collectionStyle,
                    sourceKind: state.sourceKind,
                    sourceTemplateRevisionId: state.selectedTemplateRevisionId,
                    confirmAbandonActive: confirmReplace,
                });
                state.drafts = [state.draft];
                state.replaceConfirmed = false;
                state.savedAt = new Date(state.draft.updated_at || Date.now());
                state.step = 3;
                await refreshBuilderSideData();
                notifyDrafts();
                render();
            } catch (error) {
                renderFormat();
                notice(error.message || 'Could not create this feedback.', 'error');
            } finally { setBusy(false); }
        }

        async function refreshBuilderSideData() {
            if (!state.draft) return;
            const results = await Promise.all([
                api.listVersions(state.draft.id).catch(() => ({versions: []})),
                api.getAuthoringConversation(state.draft.id).catch(() => ({conversation: null})),
            ]);
            state.versions = results[0].versions || [];
            state.conversation = results[1].conversation;
        }

        function updateDraftFromInput(input) {
            const body = state.draft.body;
            const type = input.dataset.field;
            if (type === 'title') body.title = input.value;
            if (type === 'intro') body.intro = input.value;
            if (type === 'opening_prompt') body.opening_prompt = input.value;
            if (type === 'listening_goal') body.listening_goal = input.value;
            if (type === 'closing_prompt') {
                if (body.schema_version === 'guided-feedback-v2') body.closing.prompt = input.value;
                else body.closing_prompt = input.value;
            }
            if (input.dataset.sectionId) {
                const section = body.sections.find(item => item.id === input.dataset.sectionId);
                if (section && type === 'section_title') section.title = input.value;
            }
            if (input.dataset.questionId) {
                const question = body.sections.flatMap(section => section.questions).find(item => item.id === input.dataset.questionId);
                if (question) {
                    if (type === 'short_label') question.short_label = input.value;
                    if (type === 'prompt') question.prompt = input.value;
                    if (type === 'follow_up_prompt') question.follow_up.prompt = input.value;
                }
            }
            scheduleAutosave();
        }

        function scheduleAutosave() {
            state.dirty = true;
            const saved = rootEl.querySelector('[data-saved]');
            if (saved) saved.textContent = 'Saving…';
            clearTimeout(state.autosaveTimer);
            state.autosaveTimer = setTimeout(() => flushAutosave(), AUTOSAVE_DELAY);
        }

        async function flushAutosave(checkpointReason) {
            clearTimeout(state.autosaveTimer);
            state.autosaveTimer = null;
            if (state.savePromise) {
                await state.savePromise;
                return flushAutosave(checkpointReason);
            }
            if (!state.draft || (!state.dirty && !checkpointReason)) return state.draft;
            const beforeVersion = state.draft.version;
            state.dirty = false;
            const liveBody = state.draft.body;
            state.savePromise = api.saveDraft(
                state.draft.id,
                beforeVersion,
                liveBody,
                {idempotencyKey: key('autosave'), checkpointReason: checkpointReason || null},
            ).then(saved => {
                state.draft = state.dirty ? {...saved, body: liveBody} : saved;
                state.savedAt = new Date(saved.updated_at || Date.now());
                const node = rootEl.querySelector('[data-saved]');
                if (node) node.textContent = state.dirty ? 'Saving…' : elapsedLabel(state.savedAt);
                notifyDrafts();
                return state.draft;
            }).catch(error => {
                state.dirty = true;
                throw error;
            }).finally(() => { state.savePromise = null; });
            const saved = await state.savePromise;
            if (checkpointReason && state.dirty) return flushAutosave(checkpointReason);
            if (checkpointReason) await refreshBuilderSideData();
            return saved;
        }

        function guidedEditor() {
            const body = state.draft.body;
            return '<label class="fbv12-field"><span>Feedback title</span><input data-field="title" value="' + escapeHtml(body.title) + '"></label>' +
                '<label class="fbv12-field"><span>Introduction</span><textarea data-field="intro">' + escapeHtml(body.intro) + '</textarea></label>' +
                '<div class="fbv12-sections">' + body.sections.map((section, sectionIndex) =>
                    '<section class="fbv12-section" data-section-card="' + section.id + '"><header><input aria-label="Section title" data-field="section_title" data-section-id="' + section.id + '" value="' + escapeHtml(section.title) + '">' +
                    '<span class="fbv12-item-actions"><button title="Move section up" data-move-section="-1" data-section-id="' + section.id + '"' + (sectionIndex === 0 ? ' disabled' : '') + '>↑</button>' +
                    '<button title="Move section down" data-move-section="1" data-section-id="' + section.id + '"' + (sectionIndex === body.sections.length - 1 ? ' disabled' : '') + '>↓</button>' +
                    '<button title="' + (body.sections.length === 1 ? 'A feedback design needs at least one section' : 'Remove section') + '" data-remove-section="' + section.id + '"' + (body.sections.length === 1 ? ' disabled' : '') + '>Remove</button></span></header>' +
                    section.questions.map((question, questionIndex) => '<div class="fbv12-question"><span class="fbv12-qnum">' + (questionIndex + 1) + '</span><div>' +
                        '<label class="fbv12-field compact"><span>Short label</span><input data-field="short_label" data-question-id="' + question.id + '" value="' + escapeHtml(question.short_label) + '"></label>' +
                        '<label class="fbv12-field compact"><span>Question</span><textarea data-field="prompt" data-question-id="' + question.id + '">' + escapeHtml(question.prompt) + '</textarea></label>' +
                        '<label class="fbv12-field compact"><span>Optional follow-up</span><textarea data-field="follow_up_prompt" data-question-id="' + question.id + '">' + escapeHtml(question.follow_up.prompt || '') + '</textarea></label></div>' +
                        '<span class="fbv12-item-actions vertical"><button title="Move question up" data-move-question="-1" data-question-id="' + question.id + '"' + (questionIndex === 0 ? ' disabled' : '') + '>↑</button>' +
                        '<button title="Move question down" data-move-question="1" data-question-id="' + question.id + '"' + (questionIndex === section.questions.length - 1 ? ' disabled' : '') + '>↓</button>' +
                        '<button title="' + (body.sections.length === 1 && section.questions.length === 1 ? 'A feedback design needs at least one question' : 'Remove question') + '" data-remove-question="' + question.id + '"' + (body.sections.length === 1 && section.questions.length === 1 ? ' disabled' : '') + '>×</button></span></div>').join('') +
                    '<button class="fbv12-add" data-add-question="' + section.id + '">Add a question</button></section>'
                ).join('') + '<button class="fbv12-add" data-add-section>Add a section</button></div>' +
                '<label class="fbv12-field"><span>Closing question</span><textarea data-field="closing_prompt">' + escapeHtml(body.closing.prompt) + '</textarea></label>';
        }

        function openEditor() {
            const body = state.draft.body;
            return ['title', 'opening_prompt', 'listening_goal', 'closing_prompt'].map(field => {
                const labels = {title: 'Feedback title', opening_prompt: 'Opening question', listening_goal: 'Listening goal', closing_prompt: 'Closing question'};
                return '<label class="fbv12-field"><span>' + labels[field] + '</span><textarea data-field="' + field + '">' + escapeHtml(body[field]) + '</textarea></label>';
            }).join('');
        }

        function historyMarkup() {
            if (!state.historyOpen) return '';
            return '<aside class="fbv12-history"><header><b>History</b><button data-history-close aria-label="Close history">×</button></header>' +
                (state.versions.length ? state.versions.map(version => '<button data-restore="' + version.id + '"><b>Version ' + version.version_number + '</b><span>' + escapeHtml(version.summary || version.author_kind) + '</span><small>' + escapeHtml(version.author_kind) + '</small></button>').join('') : '<p>No checkpoints yet.</p>') + '</aside>';
        }

        function conversationMarkup() {
            const messages = state.conversation && state.conversation.messages || [];
            return '<div class="fbv12-chat-history">' + (messages.length ? messages.map(message =>
                '<div class="fbv12-bubble ' + message.role + '">' + escapeHtml(message.content) + '</div>'
            ).join('') : '<div class="fbv12-chat-intro"><b>Build with AI when you need it</b><p>Ask for a rewrite, a new question, a reorganization, or a deletion. Every applied change is saved in History.</p></div>') + '</div>' +
                '<form class="fbv12-composer"><textarea aria-label="Ask AI to improve this feedback" placeholder="Ask AI to add, rewrite, remove, or reorganize something"></textarea><button class="fbv12-primary">Send</button></form>' +
                '<div class="fbv12-composer-meta"><span>AI collaborator</span><span class="fbv12-info"><button type="button" data-info="ai" aria-label="What AI can use">?</button><span hidden>AI can use this course’s title and code, this draft, authorized templates, and LEAI rules. It cannot access rosters, grades, team membership, student submissions, previews, or other courses.</span></span></div>';
        }

        function renderBuild() {
            clearInterval(state.saveAgeTimer);
            const badge = (state.audience === 'team' ? 'Team' : 'Individual') + ' · ' + (state.collectionStyle === 'open' ? 'Open' : 'Guided');
            shell('<section class="fbv12-workspace"><div class="fbv12-workspace-grid"><aside class="fbv12-chat">' + conversationMarkup() + '</aside>' +
                '<section class="fbv12-artifact"><header class="fbv12-artifact-head"><div><span class="fbv12-eyebrow">Editable feedback design</span><div class="fbv12-artifact-title"><h3>' + escapeHtml(state.draft.body.title) + '</h3><span>' + badge + '</span></div></div>' +
                '<div class="fbv12-artifact-status"><span data-saved>' + elapsedLabel(state.savedAt) + '</span><button data-history>History · v' + (state.versions[0] ? state.versions[0].version_number : 1) + '</button></div></header>' +
                '<div class="fbv12-canvas">' + (state.collectionStyle === 'open' ? openEditor() : guidedEditor()) + '</div>' + historyMarkup() + '</section></div>' +
                '<footer class="fbv12-footer"><button class="fbv12-secondary" data-build-back>Back</button><button class="fbv12-primary" data-generate>Generate preview</button></footer></section>');
            bindBuildInteractions();
            state.saveAgeTimer = setInterval(() => rootEl.querySelectorAll('[data-saved]').forEach(node => {
                if (!state.dirty) node.textContent = elapsedLabel(state.savedAt);
            }), 1000);
        }

        function mutateAndRender(callback) {
            callback(state.draft.body);
            scheduleAutosave();
            renderBuild();
        }

        function bindBuildInteractions() {
            rootEl.querySelectorAll('input[data-field], textarea[data-field]').forEach(input => input.addEventListener('input', () => updateDraftFromInput(input)));
            rootEl.querySelector('[data-history]').addEventListener('click', () => { state.historyOpen = !state.historyOpen; renderBuild(); });
            const closeHistory = rootEl.querySelector('[data-history-close]');
            if (closeHistory) closeHistory.addEventListener('click', () => { state.historyOpen = false; renderBuild(); });
            rootEl.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => {
                const tooltip = button.nextElementSibling;
                tooltip.hidden = !tooltip.hidden;
            }));
            rootEl.querySelectorAll('[data-move-section]').forEach(button => button.addEventListener('click', () => mutateAndRender(body => {
                const index = body.sections.findIndex(section => section.id === button.dataset.sectionId);
                const target = index + Number(button.dataset.moveSection);
                const item = body.sections.splice(index, 1)[0]; body.sections.splice(target, 0, item);
            })));
            rootEl.querySelectorAll('[data-remove-section]').forEach(button => button.addEventListener('click', () => mutateAndRender(body => {
                body.sections = body.sections.filter(section => section.id !== button.dataset.removeSection);
            })));
            rootEl.querySelectorAll('[data-move-question]').forEach(button => button.addEventListener('click', () => mutateAndRender(body => {
                body.sections.forEach(section => {
                    const index = section.questions.findIndex(question => question.id === button.dataset.questionId);
                    if (index < 0) return;
                    const target = index + Number(button.dataset.moveQuestion);
                    const item = section.questions.splice(index, 1)[0]; section.questions.splice(target, 0, item);
                });
            })));
            rootEl.querySelectorAll('[data-remove-question]').forEach(button => button.addEventListener('click', () => mutateAndRender(body => {
                body.sections.forEach(section => { section.questions = section.questions.filter(question => question.id !== button.dataset.removeQuestion); });
                body.sections = body.sections.filter(section => section.questions.length);
            })));
            rootEl.querySelectorAll('[data-add-question]').forEach(button => button.addEventListener('click', () => mutateAndRender(body => {
                const section = body.sections.find(item => item.id === button.dataset.addQuestion);
                section.questions.push({id: bodyId(), short_label: 'New question', prompt: 'Write the question students will answer.', follow_up: {enabled: false, prompt: ''}, response_kind: 'long_text'});
            })));
            const addSection = rootEl.querySelector('[data-add-section]');
            if (addSection) addSection.addEventListener('click', () => mutateAndRender(body => body.sections.push({
                id: bodyId(), title: 'New section', questions: [{id: bodyId(), short_label: 'New question', prompt: 'Write the question students will answer.', follow_up: {enabled: false, prompt: ''}, response_kind: 'long_text'}],
            })));
            rootEl.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', async () => {
                setBusy(true);
                try {
                    state.draft = await api.restoreVersion(state.draft.id, state.draft.version, button.dataset.restore, key('restore'));
                    state.savedAt = new Date(state.draft.updated_at || Date.now());
                    state.historyOpen = false;
                    await refreshBuilderSideData();
                    renderBuild();
                } catch (error) { notice(error.message || 'Could not restore this version.', 'error'); }
                finally { setBusy(false); }
            }));
            rootEl.querySelector('.fbv12-composer').addEventListener('submit', runAI);
            rootEl.querySelector('[data-build-back]').addEventListener('click', async () => {
                try { await flushAutosave('leave'); } catch (error) { notice('Could not save before leaving.', 'error'); return; }
                state.step = 2; render();
            });
            rootEl.querySelector('[data-generate]').addEventListener('click', generatePreview);
        }

        async function runAI(event) {
            event.preventDefault();
            if (state.busy) return;
            const input = event.currentTarget.querySelector('textarea');
            const instruction = input.value.trim();
            if (!instruction) return;
            setBusy(true);
            try {
                await flushAutosave('leave');
                await api.runAuthoring(state.draft.id, state.draft.version, instruction, key('ai'));
                state.draft = await api.getDraft(state.draft.id);
                state.savedAt = new Date(state.draft.updated_at || Date.now());
                await refreshBuilderSideData();
                renderBuild();
            } catch (error) {
                notice(error.code === 'authoring_conflict' ? 'The design changed while AI was working. Your manual changes were kept; send the request again.' : (error.message || 'AI could not apply that change.'), 'error');
            } finally { setBusy(false); }
        }

        async function generatePreview() {
            if (state.busy) return;
            setBusy(true);
            try {
                await flushAutosave('preview');
                const frozen = await api.freezeDraft(state.draft.id, state.draft.version);
                state.revision = frozen.revision;
                const preview = await api.createPreview(state.revision.id);
                state.previewToken = preview.token;
                state.previewUrl = preview.preview_url;
                state.readyAt = preview.ready_at;
                state.settings.completion_certificate_enabled = preview.completion_certificate_enabled !== false;
                state.settings.parsed_document_download_enabled = preview.parsed_document_download_enabled === true;
                state.previewReady = false;
                state.previewCompleted = false;
                state.previewSkipped = false;
                state.step = 4;
                render();
                pollPreview();
            } catch (error) {
                renderBuild();
                notice(error.message || 'Could not generate the preview.', 'error');
            } finally { setBusy(false); }
        }

        async function pollPreview() {
            clearTimeout(state.pollTimer);
            if (!state.previewToken || state.step !== 4) return;
            try {
                const result = await api.getPreview(state.previewToken);
                state.previewReady = true;
                state.previewCompleted = result.preview_completed === true;
                state.previewSkipped = result.preview_skipped === true;
                state.settings.completion_certificate_enabled = result.completion_certificate_enabled !== false;
                state.settings.parsed_document_download_enabled = result.parsed_document_download_enabled === true;
                renderPreview();
                if (!state.previewCompleted && !state.previewSkipped) state.pollTimer = setTimeout(pollPreview, 1200);
            } catch (error) {
                if (error.code === 'preview_preparing') {
                    state.readyAt = error.ready_at || state.readyAt;
                    renderPreview();
                    state.pollTimer = setTimeout(pollPreview, Math.max(250, error.retry_after_ms || 500));
                } else notice(error.message || 'Preview is unavailable.', 'error');
            }
        }

        function outputSetting(name, label, shortText, detailedText) {
            const checked = state.settings[name] === true;
            return '<div class="fbv12-setting"><div><b>' + label + '</b><span class="fbv12-info"><button type="button" data-output-help aria-label="About ' + label + '">?</button><span hidden>' + detailedText + '</span></span><small>' + shortText + '</small></div>' +
                '<button type="button" role="switch" aria-checked="' + checked + '" aria-label="' + label + '" class="fbv12-switch ' + (checked ? 'on' : '') + '" data-setting="' + name + '"><span></span></button></div>';
        }

        function renderPreview() {
            clearTimeout(state.progressTimer);
            state.progressTimer = null;
            const readyAt = state.readyAt ? new Date(state.readyAt).getTime() : Date.now() + 3000;
            const percent = state.previewReady ? 100 : Math.max(8, Math.min(94, 100 - Math.ceil((readyAt - Date.now()) / 40)));
            shell('<section class="fbv12-page"><div class="fbv12-heading"><span class="fbv12-eyebrow">Student experience</span><h1>Preview this exact version</h1><div class="fbv12-heading-help"><p>Optional. Try the student flow before publishing.</p><span class="fbv12-info"><button data-output-help aria-label="About preview mode">?</button><span hidden>Practice responses stay separate from course feedback and analysis.</span></span></div></div>' +
                (!state.previewReady ? '<div class="fbv12-generation"><span>Preparing your student preview</span><h2>Checking the conversation flow</h2><div class="fbv12-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><i style="width:' + percent + '%"></i></div><small>Validating and freezing this exact version…</small></div>' :
                    '<div class="fbv12-preview-grid"><div class="fbv12-preview-card"><span class="fbv12-eyebrow">Practice preview</span><h2>' + escapeHtml(state.draft.body.title) + '</h2><p>Opens in a new tab so the builder stays available.</p><a class="fbv12-primary" target="_blank" rel="noopener" href="' + escapeHtml(state.previewUrl) + '">Open student preview ↗</a><small>' + (state.previewCompleted ? 'Preview completed. Continue when ready.' : state.previewSkipped ? 'Preview skipped.' : 'Not completed. You may preview or skip.') + '</small></div>' +
                    '<aside class="fbv12-settings"><span class="fbv12-eyebrow">Student outputs</span><h3>What students receive</h3>' +
                    outputSetting('completion_certificate_enabled', 'Completion certificate', 'Downloadable proof of completion.', 'Students can download proof that they completed the conversation. It contains no response text or teammate data.') +
                    outputSetting('parsed_document_download_enabled', 'Completed response form', 'A copy of their own answers.', 'Students can download only their own completed answers. Files saved to a device are outside LEAI’s control.') +
                    '<div class="fbv12-live-status">Changes apply live. Reload an open preview tab to check them.</div></aside></div>') +
                '<div class="fbv12-footer"><button class="fbv12-secondary" data-preview-back>Back</button><span></span>' +
                (state.previewReady && !state.previewCompleted && !state.previewSkipped ? '<button class="fbv12-link" data-skip>Skip</button>' : '') +
                '<button class="fbv12-primary" data-preview-next ' + ((!state.previewCompleted && !state.previewSkipped) ? 'disabled' : '') + '>Next</button></div></section>');
            rootEl.querySelectorAll('[data-output-help]').forEach(button => button.addEventListener('click', () => { button.nextElementSibling.hidden = !button.nextElementSibling.hidden; }));
            rootEl.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', async () => {
                const name = button.dataset.setting;
                const previous = state.settings[name];
                state.settings[name] = !previous;
                renderPreview();
                try { await api.updatePreviewSettings(state.previewToken, {[name]: !previous}); }
                catch (error) { state.settings[name] = previous; renderPreview(); notice('Could not save that output setting. Try again.', 'error'); }
            }));
            rootEl.querySelector('[data-preview-back]').addEventListener('click', () => { clearTimeout(state.pollTimer); state.step = 3; render(); });
            const skip = rootEl.querySelector('[data-skip]');
            if (skip) skip.addEventListener('click', async () => {
                let acknowledgedBefore = state.skipWarningSeen;
                try { acknowledgedBefore = acknowledgedBefore || window.localStorage.getItem('leai.feedback.previewSkipAcknowledged') === '1'; } catch (error) {}
                if (!acknowledgedBefore && !window.confirm('Skip the student preview? You can still go back before publishing.')) return;
                try {
                    const result = await api.skipPreview(state.previewToken, true);
                    state.skipWarningSeen = true;
                    try { window.localStorage.setItem('leai.feedback.previewSkipAcknowledged', '1'); } catch (error) {}
                    state.previewSkipped = result.preview_skipped === true;
                    state.step = 5;
                    await loadTeamConfigurations();
                    render();
                }
                catch (error) { notice(error.message || 'Could not skip preview.', 'error'); }
            });
            rootEl.querySelector('[data-preview-next]').addEventListener('click', async () => { state.step = 5; await loadTeamConfigurations(); render(); });
            if (!state.previewReady) state.progressTimer = setTimeout(() => renderPreview(), 180);
        }

        async function loadTeamConfigurations() {
            if (state.audience !== 'team') return;
            try {
                state.teamConfigurations = await api.listTeamConfigurations(activeCourse().id);
                if (!state.selectedTeamConfigurationId && state.teamConfigurations.length === 1) {
                    state.selectedTeamConfigurationId = String(state.teamConfigurations[0].id);
                }
                state.teamSetupOpen = state.teamConfigurations.length === 0;
            }
            catch (error) { state.teamConfigurations = []; }
        }

        function teamSetupMarkup() {
            if (state.audience !== 'team') return '';
            const options = state.teamConfigurations.map(configuration => '<option value="' + configuration.id + '"' +
                (String(configuration.id) === state.selectedTeamConfigurationId ? ' selected' : '') + '>' +
                escapeHtml(configuration.name) + ' · ' + configuration.teams.length + ' teams</option>').join('');
            return '<div class="fbv12-team-setup"><label class="fbv12-field"><span>Team configuration</span><select id="fbv12-team"><option value="">Select the teams students will choose from</option>' + options + '</select><small>Students receive one shared link and select their own team.</small></label>' +
                '<button type="button" class="fbv12-link" data-team-setup-toggle>' + (state.teamSetupOpen ? 'Cancel new setup' : 'Create a new team setup') + '</button>' +
                (state.teamSetupOpen ? '<div class="fbv12-team-setup-form"><label class="fbv12-field"><span>Setup name</span><input id="fbv12-team-name" value="Lab teams" placeholder="Lab teams"></label>' +
                    '<label class="fbv12-field"><span>Students in each team</span><input id="fbv12-team-sizes" inputmode="numeric" placeholder="4, 4, 3, 2"><small>Enter one number per team. Two-person teams are fully supported.</small></label>' +
                    '<button type="button" class="fbv12-secondary" data-team-setup-create>Save team setup</button></div>' : '') + '</div>';
        }

        function renderPublish() {
            shell('<section class="fbv12-page"><div class="fbv12-heading"><span class="fbv12-eyebrow">Final step</span><h1>Publish this feedback</h1><p>Blank dates mean available now with no automatic close.</p></div>' +
                (state.receipt ? '<div class="fbv12-receipt"><span class="fbv12-eyebrow">Published</span><h2>' + escapeHtml(state.receipt.survey_label || state.receipt.name) + '</h2><p>Share this link with students:</p><a target="_blank" href="feedback.html?id=' + escapeHtml(state.receipt.public_id) + '">feedback.html?id=' + escapeHtml(state.receipt.public_id) + '</a></div>' :
                    '<div class="fbv12-publish-grid"><div class="fbv12-card"><label class="fbv12-field"><span>Feedback label</span><input id="fbv12-label" value="' + escapeHtml(state.draft.body.title) + '"></label>' +
                    teamSetupMarkup() +
                    '<div class="fbv12-date-grid"><label class="fbv12-field"><span>Opens (optional)</span><input id="fbv12-opens" type="datetime-local"></label><label class="fbv12-field"><span>Closes (optional)</span><input id="fbv12-closes" type="datetime-local"></label></div></div>' +
                    '<aside class="fbv12-card fbv12-summary"><span class="fbv12-eyebrow">Publication summary</span><p><b>Audience</b><span>' + (state.audience === 'team' ? 'Team members' : 'Individual students') + '</span></p><p><b>Format</b><span>' + (state.collectionStyle === 'open' ? 'Open conversation' : 'Guided feedback') + '</span></p><p><b>Preview</b><span>' + (state.previewCompleted ? 'Completed' : 'Skipped after warning') + '</span></p><p><b>Outputs</b><span>Certificate ' + (state.settings.completion_certificate_enabled ? 'on' : 'off') + ' · response form ' + (state.settings.parsed_document_download_enabled ? 'on' : 'off') + '</span></p></aside></div>' +
                    (state.templateFormOpen ? '<div class="fbv12-template-save"><h3>Save as a reusable template</h3><p>New templates are private by default.</p><label class="fbv12-field"><span>Template name</span><input id="fbv12-template-name" value="' + escapeHtml(state.draft.body.title) + '"></label><button class="fbv12-secondary" data-template-confirm>Save to My templates</button>' +
                        (state.savedTemplate ? '<button class="fbv12-secondary" data-template-community>Publish this fixed revision to Community</button>' : '') + '</div>' : '') +
                    '<div class="fbv12-footer"><button class="fbv12-secondary" data-publish-back>Back</button><span></span><button class="fbv12-secondary" data-template-toggle>Save as template</button><button class="fbv12-primary" data-publish>Publish &amp; get link</button></div>') + '</section>');
            const back = rootEl.querySelector('[data-publish-back]');
            if (back) back.addEventListener('click', () => { state.step = 4; render(); pollPreview(); });
            const toggle = rootEl.querySelector('[data-template-toggle]');
            if (toggle) toggle.addEventListener('click', () => { state.templateFormOpen = !state.templateFormOpen; renderPublish(); });
            const saveTemplate = rootEl.querySelector('[data-template-confirm]');
            if (saveTemplate) saveTemplate.addEventListener('click', async () => {
                try { const result = await api.savePrivateTemplate(state.revision.id, rootEl.querySelector('#fbv12-template-name').value, ''); state.savedTemplate = result.template; renderPublish(); notice('Saved privately in My templates.', 'success'); }
                catch (error) { notice(error.message || 'Could not save this template.', 'error'); }
            });
            const community = rootEl.querySelector('[data-template-community]');
            if (community) community.addEventListener('click', async () => {
                try { await api.publishTemplate(state.savedTemplate.id, state.savedTemplate.revision_id); notice('Published this fixed revision to Community.', 'success'); }
                catch (error) { notice(error.message || 'Could not publish this template.', 'error'); }
            });
            const publish = rootEl.querySelector('[data-publish]');
            if (publish) publish.addEventListener('click', publishSurvey);
            const teamSelect = rootEl.querySelector('#fbv12-team');
            if (teamSelect) teamSelect.addEventListener('change', () => { state.selectedTeamConfigurationId = teamSelect.value; });
            const teamSetupToggle = rootEl.querySelector('[data-team-setup-toggle]');
            if (teamSetupToggle) teamSetupToggle.addEventListener('click', () => { state.teamSetupOpen = !state.teamSetupOpen; renderPublish(); });
            const createTeamSetup = rootEl.querySelector('[data-team-setup-create]');
            if (createTeamSetup) createTeamSetup.addEventListener('click', createTeamConfiguration);
        }

        async function createTeamConfiguration() {
            const name = rootEl.querySelector('#fbv12-team-name').value.trim();
            const rawSizes = rootEl.querySelector('#fbv12-team-sizes').value.split(',').map(value => Number(value.trim())).filter(value => value > 0);
            if (!name) { notice('Add a name for this team setup.', 'error'); return; }
            if (!rawSizes.length || rawSizes.length > 50 || rawSizes.some(size => !Number.isInteger(size) || size > 20)) {
                notice('Enter 1–50 team sizes as whole numbers from 1 to 20, separated by commas.', 'error');
                return;
            }
            setBusy(true);
            try {
                const configuration = await api.createTeamConfiguration({
                    courseId: activeCourse().id,
                    name,
                    labelPrefix: 'Team',
                    teams: rawSizes.map((size, index) => ({number: index + 1, size})),
                });
                state.teamConfigurations.push(configuration);
                state.selectedTeamConfigurationId = String(configuration.id);
                state.teamSetupOpen = false;
                renderPublish();
                notice('Team setup saved. Students will choose from these teams.', 'success');
            } catch (error) { notice(error.message || 'Could not save this team setup.', 'error'); }
            finally { setBusy(false); }
        }

        async function publishSurvey() {
            if (state.busy) return;
            const label = rootEl.querySelector('#fbv12-label').value.trim();
            const teamSelect = rootEl.querySelector('#fbv12-team');
            if (!label) { notice('Add a feedback label.', 'error'); return; }
            if (state.audience === 'team' && (!teamSelect || !teamSelect.value)) { notice('Select a team configuration before publishing.', 'error'); return; }
            setBusy(true);
            try {
                state.receipt = await api.createSurvey(state.revision.id, {
                    courseId: activeCourse().id,
                    idempotencyKey: 'feedback-publication-' + state.revision.id,
                    surveyLabel: label,
                    weekNumber: null,
                    opensAt: isoOrNull(rootEl.querySelector('#fbv12-opens').value),
                    expiresAt: isoOrNull(rootEl.querySelector('#fbv12-closes').value),
                    previewToken: state.previewToken,
                    teamConfigurationId: teamSelect ? Number(teamSelect.value) : null,
                });
                state.drafts = [];
                notifyDrafts();
                if (typeof options.onCreated === 'function') options.onCreated(state.receipt);
                renderPublish();
            } catch (error) { notice(error.message || 'Could not publish this feedback.', 'error'); }
            finally { setBusy(false); }
        }

        function render() {
            clearInterval(state.saveAgeTimer);
            if (state.step === 1) renderAudience();
            if (state.step === 2) renderFormat();
            if (state.step === 3) renderBuild();
            if (state.step === 4) renderPreview();
            if (state.step === 5) renderPublish();
            const main = rootEl.querySelector('.fbv12-main');
            if (main) main.scrollTop = 0;
        }

        async function open(resume) {
            const course = activeCourse();
            if (!course) return false;
            stopTimers();
            state.open = true;
            state.receipt = null;
            state.savedTemplate = null;
            rootEl.hidden = false;
            document.body.classList.add('fbv12-open');
            if (resume && state.drafts[0]) {
                setBusy(true);
                try {
                    state.draft = await api.getDraft(state.drafts[0].id);
                    state.audience = state.draft.audience;
                    state.collectionStyle = state.draft.collection_style || 'guided';
                    state.savedAt = new Date(state.draft.updated_at || Date.now());
                    state.step = 3;
                    await refreshBuilderSideData();
                    render();
                } finally { setBusy(false); }
                return true;
            }
            state.step = 1;
            state.audience = null;
            state.collectionStyle = null;
            state.howOpen = false;
            render();
            const firstChoice = rootEl.querySelector('[data-audience]');
            if (firstChoice) firstChoice.focus();
            return true;
        }

        async function close() {
            if (state.busy) return false;
            if (state.dirty) {
                try { await flushAutosave('leave'); }
                catch (error) { notice('Your latest changes could not be saved. Try again before closing.', 'error'); return false; }
            }
            stopTimers();
            state.open = false;
            rootEl.hidden = true;
            document.body.classList.remove('fbv12-open');
            openButton.focus();
            return true;
        }

        async function refreshDrafts() {
            const course = activeCourse();
            if (!course) return [];
            const result = await api.listDrafts(course.id);
            state.drafts = (result.drafts || []).filter(draft => !draft.workflow_status || draft.workflow_status === 'active').slice(0, 1);
            notifyDrafts();
            return state.drafts;
        }

        openButton.addEventListener('click', () => open(false));
        if (resumeButton) resumeButton.addEventListener('click', () => open(true));
        rootEl.addEventListener('click', event => { if (event.target === rootEl) close(); });
        rootEl.addEventListener('keydown', event => {
            if (event.key === 'Escape') { close(); return; }
            if (event.key !== 'Tab' || rootEl.hidden) return;
            const focusable = Array.from(rootEl.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'))
                .filter(node => node.getClientRects().length > 0);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });

        return {
            open,
            close,
            refreshDrafts,
            restoreSameTabPreview: () => Promise.resolve(false),
            getState: () => state,
        };
    }

    return {mount, elapsedLabel};
}));
