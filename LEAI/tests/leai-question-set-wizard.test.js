'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = require('../leai-question-set-wizard.js');

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        text: async function () { return JSON.stringify(payload); },
    };
}

test('wizard API uses authenticated course-scoped draft endpoints', async () => {
    const calls = [];
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function (url, options) {
            calls.push({ url: url, options: options || {} });
            return jsonResponse(201, { id: 'draft-1', version: 1 });
        },
    });

    await api.listTemplates();
    await api.listDrafts('course-1');
    await api.createDraft('course-1', 'weekly-reflection');

    assert.equal(calls[0].url, '/api/question_set_templates/');
    assert.equal(calls[1].url, '/api/question_set_drafts/?course_id=course-1');
    assert.equal(calls[2].url, '/api/question_set_drafts/');
    assert.deepEqual(JSON.parse(calls[2].options.body), {
        course_id: 'course-1',
        template_id: 'weekly-reflection',
    });
});

test('wizard save, freeze, preview, and survey creation preserve the revision gate', async () => {
    const calls = [];
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function (url, options) {
            calls.push({ url: url, options: options || {} });
            return jsonResponse(200, {});
        },
    });
    const body = { title: 'Reflection', sections: [] };

    await api.saveDraft('draft-1', 4, body);
    await api.freezeDraft('draft-1', 5);
    await api.createPreview('revision-1');
    await api.createSurvey('revision-1', {
        courseId: 'course-1',
        idempotencyKey: 'fixed-key-123',
        surveyLabel: 'Week 3',
        weekNumber: 3,
        opensAt: '2026-09-11T12:00:00.000Z',
        expiresAt: '2026-09-18T12:00:00.000Z',
    });

    assert.equal(calls[0].url, '/api/question_set_drafts/draft-1/');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        expected_version: 4,
        body: body,
    });
    assert.equal(calls[1].url, '/api/question_set_drafts/draft-1/freeze/');
    assert.equal(calls[2].url, '/api/question_set_revisions/revision-1/preview_capability/');
    assert.equal(calls[3].url, '/api/question_set_revisions/revision-1/surveys/');
    assert.deepEqual(JSON.parse(calls[3].options.body), {
        course_id: 'course-1',
        idempotency_key: 'fixed-key-123',
        survey_label: 'Week 3',
        week_number: 3,
        opens_at: '2026-09-11T12:00:00.000Z',
        expires_at: '2026-09-18T12:00:00.000Z',
    });
});

test('wizard surfaces structured API errors instead of treating HTTP 409 as success', async () => {
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function () {
            return jsonResponse(409, { error: 'stale_draft' });
        },
    });

    await assert.rejects(
        api.saveDraft('draft-1', 1, {}),
        function (error) {
            return error.code === 'stale_draft' && error.status === 409;
        },
    );
});

test('survey idempotency key is stable for an exact revision', () => {
    assert.equal(
        wizard.idempotencyKeyForRevision('revision-123'),
        'question-set-survey-revision-123',
    );
});

test('Prompt Designer exposes the real four-step wizard and keeps legacy schema setup secondary', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'PromptDesigner.html'),
        'utf8',
    );
    assert.match(html, /leai-question-set-wizard\.css/);
    assert.match(html, /leai-question-set-wizard\.js/);
    assert.match(html, /id="question-set-wizard-open"/);
    assert.match(html, /id="question-set-wizard-root"/);
    assert.match(html, /Use an existing database schema/);
    assert.match(html, /leaiQuestionSetWizard\.mount/);
    const formSurveyRenderer = html.match(
        /function buildFormSurveyItem\(s\) \{([\s\S]*?)\n    function loadFormSurveys/,
    )[1];
    assert.match(
        formSurveyRenderer,
        /if \(!s\.question_set_revision_id\) \{[\s\S]*?appendChild\(dupBtn\)[\s\S]*?appendChild\(editBtn\)[\s\S]*?appendChild\(deleteBtn\)/,
    );
    assert.match(html, /s\.question_set_revision_id[\s\S]*?\? 'Question set'/);
    assert.doesNotMatch(html, /close or duplicate it later/i);

    const source = fs.readFileSync(
        path.join(__dirname, '..', 'leai-question-set-wizard.js'),
        'utf8',
    );
    assert.match(source, /notice\.setAttribute\('aria-live', 'polite'\)/);
    assert.match(source, /event\.key === 'Tab'/);
    assert.match(source, /function markDirty\(\)[\s\S]*?secondaryButton\.textContent = 'Save draft'/);
    assert.match(source, /state\.drafts = state\.drafts\.map/);
    assert.match(source, /closeButton\.focus\(\);[\s\S]*?Promise\.all/);
    assert.match(source, /function focusEditorStart\(\)/);
    assert.equal((source.match(/focusEditorStart\(\);/g) || []).length, 2);
    const busyBranch = source.match(/if \(busy\) \{([\s\S]*?)footerStatus\.textContent/)[1];
    assert.doesNotMatch(busyBranch, /closeButton/);
});

test('student page routes preview messages and completion away from research responses', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'feedback.html'),
        'utf8',
    );
    assert.match(html, /urlParams\.get\('preview'\)/);
    assert.match(html, /question_set_preview\/[\s\S]*?\/messages\//);
    assert.match(html, /question_set_preview\/[\s\S]*?\/complete\//);
    assert.match(html, /Practice answers never count as student responses/);
    assert.match(html, /previewPersistenceChain/);
    assert.match(html, /if \(previewPersistenceError\) throw previewPersistenceError/);
    assert.equal((html.match(/previewPersistenceError = null/g) || []).length, 1);
    assert.match(html, /Checking that every practice answer was saved/);
    assert.match(html, /completeQuestionSetPreview\(\)\.then[\s\S]*?notice\.textContent = 'Preview complete/);
});
