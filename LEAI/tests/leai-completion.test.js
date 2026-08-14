'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', 'leai-completion.js');
const PROMPT_DESIGNER_PATH = path.join(__dirname, '..', 'PromptDesigner.html');
const FEEDBACK_ANALYZER_PATH = path.join(__dirname, '..', 'FeedbackAnalyzer.html');

function loadCompletionFresh() {
    delete require.cache[require.resolve(MODULE_PATH)];
    delete globalThis.leaiCompletion;
    return require(MODULE_PATH);
}

test('CommonJS import does not write globalThis.leaiCompletion', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.equal(globalThis.leaiCompletion, undefined);
    assert.equal(typeof leaiCompletion.downloadState, 'function');
});

test('downloadState accepts only actual boolean true for settings, persistence, and completion', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.downloadState({
        mode: 'form',
        certificateSetting: 'true',
        documentSetting: 1,
        hasPersistedStudentMessage: {},
        complete: 'yes',
    }), {
        showStrip: false,
        showCertificate: false,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
    });
});

test('downloadState supports snake_case aliases with camelCase precedence', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.downloadState({
        mode: 'group',
        certificate_setting: true,
        document_setting: true,
        has_persisted_student_message: true,
        complete: true,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: true,
        showDocument: true,
        documentReady: true,
        presentation: 'ready',
    });

    assert.deepEqual(leaiCompletion.downloadState({
        mode: 'form',
        certificateSetting: false,
        certificate_setting: true,
        documentSetting: 'invalid',
        document_setting: true,
        hasPersistedStudentMessage: null,
        has_persisted_student_message: true,
        complete: true,
    }), {
        showStrip: false,
        showCertificate: false,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
    });
});

test('downloadState keeps type-confused snake_case values safely false', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.downloadState({
        mode: 'group',
        certificate_setting: 'true',
        document_setting: 1,
        has_persisted_student_message: {},
        complete: true,
    }), {
        showStrip: false,
        showCertificate: false,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
    });
});

test('courseDownloadSettings normalizes public bootstrap flags with false defaults', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.courseDownloadSettings(), {
        completion_certificate_enabled: false,
        parsed_document_download_enabled: false,
    });

    assert.deepEqual(leaiCompletion.courseDownloadSettings({
        completion_certificate_enabled: true,
        parsed_document_download_enabled: false,
    }), {
        completion_certificate_enabled: true,
        parsed_document_download_enabled: false,
    });

    assert.deepEqual(leaiCompletion.courseDownloadSettings({
        completionCertificateEnabled: false,
        parsedDocumentDownloadEnabled: true,
    }), {
        completion_certificate_enabled: false,
        parsed_document_download_enabled: true,
    });

    assert.deepEqual(leaiCompletion.courseDownloadSettings({
        completion_certificate_enabled: 'true',
        parsedDocumentDownloadEnabled: 1,
    }), {
        completion_certificate_enabled: false,
        parsed_document_download_enabled: false,
    });
});

test('countPersistedStudentMessages counts only persisted student-role rows', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.equal(leaiCompletion.countPersistedStudentMessages(), 0);
    assert.equal(leaiCompletion.countPersistedStudentMessages([
        { sent_by: 'assistant', content: 'prompt' },
        { sent_by: 'user', content: 'first answer' },
        { sent_by: 'USER-MESSAGE', content: 'legacy answer' },
        { role: 'student', content: 'restored answer' },
        { sentBy: 'user', content: 'camel case answer' },
        { sent_by: 'pdf', content: 'artifact row' },
    ]), 4);
});

test('normalizeRestoredMessageRole maps legacy student roles to user and ai roles to assistant', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.equal(leaiCompletion.normalizeRestoredMessageRole('user'), 'user');
    assert.equal(leaiCompletion.normalizeRestoredMessageRole('USER-MESSAGE'), 'user');
    assert.equal(leaiCompletion.normalizeRestoredMessageRole('student'), 'user');
    assert.equal(leaiCompletion.normalizeRestoredMessageRole('assistant'), 'assistant');
    assert.equal(leaiCompletion.normalizeRestoredMessageRole('AI'), 'assistant');
    assert.equal(leaiCompletion.normalizeRestoredMessageRole('weird-role'), 'assistant');
});

test('studentFooterState keeps the certificate locked through first-save pending and failed states', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'general',
        certificateSetting: true,
        documentSetting: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'pending',
        complete: false,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'pending',
        certificate: {
            visible: true,
            enabled: false,
            status: 'pending',
            label: 'Respond once to unlock your certificate',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'general',
        certificateSetting: true,
        documentSetting: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'failed',
        complete: false,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'failed',
        certificate: {
            visible: true,
            enabled: false,
            status: 'failed',
            label: 'Respond once to unlock your certificate',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });
});

test('studentFooterState keeps unlock and retry copy even when completion makes the strip ready-sized', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'general',
        certificateSetting: true,
        documentSetting: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'failed',
        complete: true,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'ready',
        hasPersistedStudentMessage: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'failed',
        certificate: {
            visible: true,
            enabled: false,
            status: 'failed',
            label: 'Respond once to unlock your certificate',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });
});

test('studentFooterState unlocks the certificate after the first persisted student row', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'general',
        certificateSetting: true,
        documentSetting: false,
        persistedStudentMessageCount: 1,
        firstStudentPersistState: 'succeeded',
        complete: false,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: true,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: true,
        persistedStudentMessageCount: 1,
        firstStudentPersistState: 'succeeded',
        certificate: {
            visible: true,
            enabled: true,
            status: 'ready',
            label: 'Download completion certificate (PDF)',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });
});

test('buildCompletionMarkerKey scopes the completion marker to the exact survey and anonymous session', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.equal(
        leaiCompletion.buildCompletionMarkerKey({
            publicId: 'survey-public-id',
            sessionId: 'anon-session-123',
        }),
        'leai_completion_ready:survey-public-id:anon-session-123'
    );

    assert.equal(
        leaiCompletion.buildCompletionMarkerKey({
            surveyId: 42,
            sessionId: 'anon-session-123',
        }),
        'leai_completion_ready:42:anon-session-123'
    );

    assert.equal(
        leaiCompletion.buildCompletionMarkerKey({
            publicId: 'survey-public-id',
            sessionId: '',
        }),
        null
    );
});

test('studentFooterState restores certificate availability from persisted student rows', () => {
    const leaiCompletion = loadCompletionFresh();
    const restoredCount = leaiCompletion.countPersistedStudentMessages([
        { sent_by: 'assistant', content: 'welcome' },
        { sent_by: 'user', content: 'saved response' },
        { sent_by: 'assistant', content: 'follow-up' },
    ]);

    assert.equal(restoredCount, 1);
    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'form',
        certificateSetting: true,
        documentSetting: true,
        persistedStudentMessageCount: restoredCount,
        complete: true,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: true,
        showDocument: true,
        documentReady: true,
        presentation: 'ready',
        hasPersistedStudentMessage: true,
        persistedStudentMessageCount: 1,
        firstStudentPersistState: 'idle',
        certificate: {
            visible: true,
            enabled: true,
            status: 'ready',
            label: 'Download completion certificate (PDF)',
        },
        document: {
            visible: true,
            enabled: true,
            status: 'ready',
            label: 'Download my reflection (Word / .docx)',
        },
    });
});

test('studentFooterState handles certificate-only, document-only, both, and fully disabled combinations', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'general',
        certificateSetting: true,
        documentSetting: true,
        persistedStudentMessageCount: 0,
        complete: false,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'idle',
        certificate: {
            visible: true,
            enabled: false,
            status: 'locked',
            label: 'Respond once to unlock your certificate',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'group',
        certificateSetting: false,
        documentSetting: true,
        persistedStudentMessageCount: 0,
        complete: false,
    }), {
        showStrip: true,
        showCertificate: false,
        certificateEnabled: false,
        showDocument: true,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: false,
        persistedStudentMessageCount: 0,
        firstStudentPersistState: 'idle',
        certificate: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
        document: {
            visible: true,
            enabled: true,
            status: 'draft',
            label: 'Save draft (.docx) ↓',
        },
    });

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'form',
        certificateSetting: true,
        documentSetting: true,
        persistedStudentMessageCount: 1,
        complete: false,
    }), {
        showStrip: true,
        showCertificate: true,
        certificateEnabled: true,
        showDocument: true,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: true,
        persistedStudentMessageCount: 1,
        firstStudentPersistState: 'idle',
        certificate: {
            visible: true,
            enabled: true,
            status: 'ready',
            label: 'Download completion certificate (PDF)',
        },
        document: {
            visible: true,
            enabled: true,
            status: 'draft',
            label: 'Save draft (.docx) ↓',
        },
    });

    assert.deepEqual(leaiCompletion.studentFooterState({
        mode: 'form',
        certificateSetting: false,
        documentSetting: false,
        persistedStudentMessageCount: 1,
        complete: true,
    }), {
        showStrip: false,
        showCertificate: false,
        certificateEnabled: false,
        showDocument: false,
        documentReady: false,
        presentation: 'normal',
        hasPersistedStudentMessage: true,
        persistedStudentMessageCount: 1,
        firstStudentPersistState: 'idle',
        certificate: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
        document: {
            visible: false,
            enabled: false,
            status: 'hidden',
            label: '',
        },
    });
});

test('buildPromptDesignerSurveyPayload builds create/import payloads without legacy canvas state', () => {
    const leaiCompletion = loadCompletionFresh();
    const opensAt = '2026-08-13T10:30';
    const expiresAt = '2026-08-20T10:30:00.000Z';

    assert.deepEqual(leaiCompletion.buildPromptDesignerSurveyPayload({
        courseId: 'cmpm-101',
        surveyLabel: 'Week 4 Reflection',
        weekNumber: '4',
        instructions: 'Be helpful.',
        instructorName: 'Prof. Test',
        opensAt: opensAt,
        expiresAt: expiresAt,
        anonymityMode: 'anonymous',
        canvas_integration: true,
        canvasIntegration: true,
    }), {
        course_id: 'cmpm-101',
        name: 'cmpm-101 — Week 4 Reflection',
        week_number: 4,
        survey_label: 'Week 4 Reflection',
        instructions: 'Be helpful.',
        instructor_name: 'Prof. Test',
        opens_at: new Date(opensAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        anonymity_mode: 'anonymous',
    });
});

test('PromptDesigner no longer ships the legacy s-canvas-integration inputs', () => {
    const html = fs.readFileSync(PROMPT_DESIGNER_PATH, 'utf8');

    assert.doesNotMatch(html, /id="s-canvas-integration"/);
});

test('downloadState covers the full mode/setting/persistence/completion matrix', () => {
    const leaiCompletion = loadCompletionFresh();
    const expectations = {
        general: {
            '0000': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0001': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0010': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0011': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0100': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0101': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0110': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0111': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '1000': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '1001': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'ready' },
            '1010': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'normal' },
            '1011': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'ready' },
            '1100': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '1101': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'ready' },
            '1110': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'normal' },
            '1111': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'ready' },
        },
        group: {
            '0000': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0001': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0010': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0011': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0100': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '0101': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '0110': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '0111': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '1000': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '1001': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'ready' },
            '1010': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'normal' },
            '1011': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'ready' },
            '1100': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '1101': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '1110': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: true, documentReady: false, presentation: 'normal' },
            '1111': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: true, documentReady: true, presentation: 'ready' },
        },
        form: {
            '0000': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0001': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0010': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0011': { showStrip: false, showCertificate: false, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '0100': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '0101': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '0110': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '0111': { showStrip: true, showCertificate: false, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '1000': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'normal' },
            '1001': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: false, documentReady: false, presentation: 'ready' },
            '1010': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'normal' },
            '1011': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: false, documentReady: false, presentation: 'ready' },
            '1100': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: true, documentReady: false, presentation: 'normal' },
            '1101': { showStrip: true, showCertificate: true, certificateEnabled: false, showDocument: true, documentReady: true, presentation: 'ready' },
            '1110': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: true, documentReady: false, presentation: 'normal' },
            '1111': { showStrip: true, showCertificate: true, certificateEnabled: true, showDocument: true, documentReady: true, presentation: 'ready' },
        },
    };
    const booleans = [false, true];

    Object.keys(expectations).forEach(function (mode) {
        booleans.forEach(function (certificateSetting) {
            booleans.forEach(function (documentSetting) {
                booleans.forEach(function (hasPersistedStudentMessage) {
                    booleans.forEach(function (complete) {
                        const key =
                            (certificateSetting ? '1' : '0') +
                            (documentSetting ? '1' : '0') +
                            (hasPersistedStudentMessage ? '1' : '0') +
                            (complete ? '1' : '0');
                        assert.deepEqual(
                            leaiCompletion.downloadState({
                                mode: mode,
                                certificateSetting: certificateSetting,
                                documentSetting: documentSetting,
                                hasPersistedStudentMessage: hasPersistedStudentMessage,
                                complete: complete,
                            }),
                            expectations[mode][key],
                            mode + ' ' + key
                        );
                    });
                });
            });
        });
    });
});

test('buildProgressSnapshot allowlists form progress without transcript content', () => {
    const leaiCompletion = loadCompletionFresh();
    const snapshot = leaiCompletion.buildProgressSnapshot({
        mode: 'form',
        student_message_count: 7,
        complete: true,
        schema_id: 'week-6-reflection',
        area_index: 999,
        area_id: '2.1',
        area_title: '  Collaboration and roles  ',
        engine_turn: 10001,
        last_directive_kind: 'probe'.repeat(30),
        response_text: 'private student answer',
        transcript: [{ role: 'user', content: 'do not include me' }],
        session_id: 'session-123',
        messages: ['still private'],
    });

    assert.deepEqual(snapshot, {
        version: 1,
        mode: 'form',
        student_message_count: 7,
        complete: true,
        schema_id: 'week-6-reflection',
        area_index: 500,
        area_id: '2.1',
        area_title: 'Collaboration and roles',
        engine_turn: 10000,
        last_directive_kind: 'probe'.repeat(20),
    });
    assert.deepEqual(Object.keys(snapshot).sort(), [
        'area_id',
        'area_index',
        'area_title',
        'complete',
        'engine_turn',
        'last_directive_kind',
        'mode',
        'schema_id',
        'student_message_count',
        'version',
    ]);
});

test('buildProgressSnapshot omits form-only keys outside form mode', () => {
    const leaiCompletion = loadCompletionFresh();
    assert.deepEqual(leaiCompletion.buildProgressSnapshot({
        mode: 'group',
        student_message_count: 3,
        complete: false,
        schema_id: 'ignore-me',
        area_index: 3,
        area_id: '3.1',
        area_title: 'Ignore me too',
        engine_turn: 12,
        last_directive_kind: 'followup',
    }), {
        version: 1,
        mode: 'group',
        student_message_count: 3,
        complete: false,
    });
});

test('verificationCandidates preserves duplicate-week surveys in original order', () => {
    const leaiCompletion = loadCompletionFresh();
    const surveys = [
        { gpt_id: 11, week_number: 1, name: 'Week 1 A' },
        { gpt_id: 21, week_number: 2, name: 'Week 2 A' },
        { gpt_id: 22, week_number: 2, name: 'Week 2 B' },
        { gpt_id: 31, week_number: 3, name: 'Week 3 A' },
        { gpt_id: 23, week_number: 2, name: 'Week 2 C' },
    ];

    const candidates = leaiCompletion.verificationCandidates(surveys, 2);

    assert.equal(candidates.length, 3);
    assert.strictEqual(candidates[0], surveys[1]);
    assert.strictEqual(candidates[1], surveys[2]);
    assert.strictEqual(candidates[2], surveys[4]);
});

test('verificationTarget returns null for zero candidates, auto-selects the only survey, and never defaults a duplicate week', () => {
    const leaiCompletion = loadCompletionFresh();
    const oneCandidate = [{ gpt_id: 42, id: 420, survey_label: 'Week 4 Reflection' }];
    const duplicateWeek = [
        { gpt_id: 71, id: 701, survey_label: 'Week 7 A' },
        { gpt_id: 72, id: 702, survey_label: 'Week 7 B' },
    ];

    assert.equal(leaiCompletion.verificationTarget([], ''), null);
    assert.strictEqual(leaiCompletion.verificationTarget(oneCandidate, ''), oneCandidate[0]);
    assert.strictEqual(leaiCompletion.verificationTarget(oneCandidate, '999'), oneCandidate[0]);
    assert.equal(leaiCompletion.verificationTarget(duplicateWeek, ''), null);
    assert.equal(leaiCompletion.verificationTarget(duplicateWeek, '999'), null);
    assert.strictEqual(leaiCompletion.verificationTarget(duplicateWeek, '72'), duplicateWeek[1]);
    assert.strictEqual(leaiCompletion.verificationTarget(duplicateWeek, '701'), duplicateWeek[0]);
});

test('verificationControls keeps a duplicate-week survey picker enabled until an exact survey is chosen', () => {
    const leaiCompletion = loadCompletionFresh();
    const duplicateWeek = [
        { gpt_id: 71, survey_label: 'Week 7 A' },
        { gpt_id: 72, survey_label: 'Week 7 B' },
    ];

    assert.deepEqual(leaiCompletion.verificationControls(duplicateWeek, '', false), {
        surveyDisabled: false,
        inputDisabled: true,
        submitDisabled: true,
    });
    assert.deepEqual(leaiCompletion.verificationControls(duplicateWeek, '72', false), {
        surveyDisabled: false,
        inputDisabled: false,
        submitDisabled: false,
    });
    assert.deepEqual(leaiCompletion.verificationControls(duplicateWeek, '72', true), {
        surveyDisabled: true,
        inputDisabled: true,
        submitDisabled: true,
    });
});

test('verificationBatch returns a visible empty-state error for zero codes', () => {
    const leaiCompletion = loadCompletionFresh();

    assert.deepEqual(leaiCompletion.verificationBatch('', 100), {
        codes: [],
        error: 'Enter at least one code to verify.',
    });
});

test('verificationBatch accepts 100 codes while preserving duplicates and order', () => {
    const leaiCompletion = loadCompletionFresh();
    const codes = Array.from({ length: 100 }, function (_value, index) {
        const group = String(index).padStart(4, '0');
        return 'ABCD-EFGH-' + group + '-WXYZ';
    });
    const raw = codes.concat(['ABCD-EFGH-0000-WXYZ']).join('\n');

    assert.deepEqual(leaiCompletion.verificationBatch(raw, 101), {
        codes: codes.concat(['ABCD-EFGH-0000-WXYZ']),
        error: '',
    });
    assert.deepEqual(leaiCompletion.verificationBatch(codes.join('\n'), 100), {
        codes: codes,
        error: '',
    });
});

test('verificationBatch blocks 101 codes with deterministic text and no request payload', () => {
    const leaiCompletion = loadCompletionFresh();
    const codes = Array.from({ length: 101 }, function (_value, index) {
        const group = String(index).padStart(4, '0');
        return 'WXYZ-QRST-' + group + '-ABCD';
    });

    assert.deepEqual(leaiCompletion.verificationBatch(codes.join(','), 100), {
        codes: [],
        error: 'Enter 100 codes or fewer.',
    });
});

test('normalizeCodes normalizes valid codes and keeps duplicate order', () => {
    const leaiCompletion = loadCompletionFresh();
    assert.deepEqual(
        leaiCompletion.normalizeCodes(
            'abcd efgh jklm npqr,\nABCD-EFGH-JKLM-NPQR\nqrst uvwx yz23 4567'
        ),
        [
            'ABCD-EFGH-JKLM-NPQR',
            'ABCD-EFGH-JKLM-NPQR',
            'QRST-UVWX-YZ23-4567',
        ]
    );
});

test('summarizeVerification counts valid and missing results', () => {
    const leaiCompletion = loadCompletionFresh();
    assert.deepEqual(leaiCompletion.summarizeVerification([
        { code: 'A', status: 'valid' },
        { code: 'B', status: 'not_found' },
        { code: 'C', status: 'valid' },
    ]), {
        valid: 2,
        notFound: 1,
        total: 3,
    });
});

test('FeedbackAnalyzer no longer ships prototype verifier identifiers after exact-target selection moved into helper', () => {
    const html = fs.readFileSync(FEEDBACK_ANALYZER_PATH, 'utf8');
    const leaiCompletion = loadCompletionFresh();
    const candidates = [
        { gpt_id: 81, id: 801, survey_label: 'Week 8 A' },
        { gpt_id: 82, id: 802, survey_label: 'Week 8 B' },
    ];

    assert.equal(leaiCompletion.verificationTarget(candidates, ''), null);
    assert.doesNotMatch(html, /function sessionToCode\b/);
    assert.doesNotMatch(html, /\bcodeMap\b/);
    assert.doesNotMatch(html, /Session \(last 6\)/);
    assert.doesNotMatch(html, /Messages sent/);
    assert.doesNotMatch(html, /canvas_integration/);
});

test('FeedbackAnalyzer verifier contract invalidates stale requests and resets the disclosure only on target changes', () => {
    const html = fs.readFileSync(FEEDBACK_ANALYZER_PATH, 'utf8');

    assert.match(html, /\bverifyRequestGeneration\b/);
    assert.match(html, /\bverifyRequestController\b/);
    assert.match(html, /verifyRequestGeneration\s*\+=\s*1/);
    assert.match(html, /verifyRequestController\.abort\(\)/);
    assert.match(html, /section\.open\s*=\s*false/);
    assert.match(html, /submissionGeneration/);
    assert.match(html, /submissionSurveyId/);
    assert.match(html, /if\s*\(\s*!isCurrentVerifyRequest\(/);
});

test('FeedbackAnalyzer places certificate verification immediately after Traditional Analysis and before Instructor Insights', () => {
    const html = fs.readFileSync(FEEDBACK_ANALYZER_PATH, 'utf8');
    const traditional = html.indexOf('id="traditional-analysis-section"');
    const verifier = html.indexOf('id="verify-codes-section"');
    const insights = html.indexOf('id="quick-take-section"');

    assert.ok(traditional !== -1);
    assert.ok(verifier > traditional);
    assert.ok(insights > verifier);
});

test('filenameFromDisposition prefers encoded filenames and rejects path or control injection', () => {
    const leaiCompletion = loadCompletionFresh();
    assert.equal(
        leaiCompletion.filenameFromDisposition(
            "attachment; filename*=UTF-8''Week%201%20Reflection%20Certificate.pdf",
            'completion-certificate.pdf'
        ),
        'Week 1 Reflection Certificate.pdf'
    );

    assert.equal(
        leaiCompletion.filenameFromDisposition(
            'attachment; filename="../secret\\r\\nset-cookie.pdf"',
            'completion-certificate.pdf'
        ),
        'completion-certificate.pdf'
    );
});
