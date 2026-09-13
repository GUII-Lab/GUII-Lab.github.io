'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const leaiFormMode = require('../leai-formmode.js');

function fallSchemaFixture() {
    return {
        schema_id: 'collab-ai-metacognition',
        version: 1,
        title: 'Collaborative AI Metacognition',
        course: 'CMPM 80H',
        instructor: 'Mimi Rapoport',
        week: 'Winter 2027',
        shallow_word_threshold: 8,
        sections: [
            {
                id: 'understanding',
                title: 'Understanding the AI',
                topic: 'your understanding of the AI',
                opening_prompt: 'Explain your mental model, confidence, surprises, and remaining uncertainty all together.',
                depth_probe: 'What specific moment shaped that answer?',
                fields: [
                    { id: 'mental-model', kind: 'shortform', label: 'How do you think the AI produced its response?' },
                    { id: 'confidence', kind: 'rating_with_justification', label: 'How confident are you in that explanation, and why?' },
                    { id: 'uncertainty', kind: 'longform', label: 'What are you still uncertain about?' },
                ],
            },
            {
                id: 'collaboration',
                title: 'Collaboration Choices',
                topic: 'how you collaborated with AI',
                opening_prompt: 'Describe every collaboration choice in one response.',
                fields: [
                    { id: 'choice', kind: 'shortform', label: 'What choice did you keep for yourself?' },
                    { id: 'division', kind: 'table', label: 'How did you divide work between yourself and the AI?' },
                ],
            },
        ],
        closing: { feedback_prompt: 'How was this reflection experience?' },
    };
}

function substantialAnswer() {
    return 'I compared its output with my notes, checked the examples it selected, and traced where its explanation stopped matching the evidence I had collected.';
}

test('initial state and opening directive target only the first labeled field', () => {
    const schema = fallSchemaFixture();
    const state = leaiFormMode.init(schema);

    assert.equal(state.field_cursor, 0);
    assert.equal(leaiFormMode.currentField(state).id, 'mental-model');
    assert.equal(
        leaiFormMode.progressLabel(state),
        'Area 1 of 2 — Understanding the AI · Question 1 of 3'
    );

    const turn = leaiFormMode.beforeTurn(state, '');
    assert.equal(turn.directive.kind, 'field_opening');
    assert.equal(turn.directive.field_id, 'mental-model');
    assert.match(turn.directive.text, /How do you think the AI produced its response\?/);
    assert.doesNotMatch(turn.directive.text, /How confident are you/);
    assert.doesNotMatch(turn.directive.text, /What are you still uncertain about/);
    assert.doesNotMatch(turn.directive.text, /Explain your mental model, confidence/);
});

test('progress moves from the last question to closing and completion states', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    state.current_area_index = 2;
    state.field_cursor = 1;

    assert.equal(
        leaiFormMode.progressLabel(state),
        'Area 2 of 2 — Collaboration Choices · Question 2 of 2'
    );

    state.closing_feedback_asked = true;
    assert.equal(leaiFormMode.progressLabel(state), 'Closing question');

    state.ended = true;
    assert.equal(leaiFormMode.progressLabel(state), 'Reflection complete');
});

test('a substantive answer advances exactly one field and returns exact attribution', () => {
    const schema = fallSchemaFixture();
    const state = leaiFormMode.init(schema);
    leaiFormMode.beforeTurn(state, '');

    const turn = leaiFormMode.beforeTurn(state, substantialAnswer());

    assert.deepEqual(turn.responseAttribution, {
        form_schema_id: 'collab-ai-metacognition',
        form_schema_version: 1,
        form_section_id: 'understanding',
        form_field_id: 'mental-model',
        form_field_label: 'How do you think the AI produced its response?',
        form_response_phase: 'primary',
    });
    assert.equal(state.field_cursor, 1);
    assert.equal(turn.directive.kind, 'field_question');
    assert.equal(turn.directive.field_id, 'confidence');
    assert.match(turn.directive.text, /rating and.*reason|rating.*justification/i);
    assert.doesNotMatch(turn.directive.text, /What are you still uncertain about/);
});

test('a thin answer gets one same-field probe and the next answer advances', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    leaiFormMode.beforeTurn(state, '');

    const probeTurn = leaiFormMode.beforeTurn(state, 'Not sure.');
    assert.equal(state.field_cursor, 0);
    assert.equal(probeTurn.directive.kind, 'field_probe');
    assert.equal(probeTurn.directive.field_id, 'mental-model');
    assert.match(probeTurn.directive.text, /How do you think the AI produced its response\?/);
    assert.doesNotMatch(probeTurn.directive.text, /How confident are you/);

    const nextTurn = leaiFormMode.beforeTurn(state, 'Still not sure.');
    assert.equal(nextTurn.responseAttribution.form_response_phase, 'probe');
    assert.equal(state.field_cursor, 1);
    assert.equal(nextTurn.directive.field_id, 'confidence');
    assert.equal(state.field_coverage['mental-model'].probe_used, true);
});

test('a one-field question-set area uses its authored follow-up verbatim', () => {
    const schema = fallSchemaFixture();
    schema.sections[0].fields = [schema.sections[0].fields[0]];
    const state = leaiFormMode.init(schema);
    leaiFormMode.beforeTurn(state, '');

    const probeTurn = leaiFormMode.beforeTurn(state, 'Not sure.');

    assert.equal(probeTurn.directive.kind, 'field_probe');
    assert.match(probeTurn.directive.text, /What specific moment shaped that answer\?/);
});

test('an ordinary concise answer advances when the schema has no custom thin threshold', () => {
    const schema = fallSchemaFixture();
    delete schema.shallow_word_threshold;
    const state = leaiFormMode.init(schema);
    leaiFormMode.beforeTurn(state, '');

    const turn = leaiFormMode.beforeTurn(
        state,
        'It predicted a likely answer from patterns in similar examples.'
    );

    assert.equal(state.field_cursor, 1);
    assert.equal(turn.directive.kind, 'field_question');
    assert.equal(turn.directive.field_id, 'confidence');
});

test('the legacy section shallow threshold does not force probes in field flow', () => {
    const schema = fallSchemaFixture();
    schema.shallow_word_threshold = 25;
    const state = leaiFormMode.init(schema);
    leaiFormMode.beforeTurn(state, '');

    const turn = leaiFormMode.beforeTurn(
        state,
        'It predicted a likely answer from patterns in similar examples.'
    );

    assert.equal(state.field_cursor, 1);
    assert.equal(turn.directive.field_id, 'confidence');
});

test('an explicitly confused answer gets one same-field rephrase even when it is long', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    leaiFormMode.beforeTurn(state, '');

    const turn = leaiFormMode.beforeTurn(
        state,
        'I am not sure what this question means, so I cannot tell what kind of explanation you want from me.'
    );

    assert.equal(state.field_cursor, 0);
    assert.equal(turn.directive.kind, 'field_probe');
    assert.equal(turn.directive.field_id, 'mental-model');
});

test('field directives contain no legacy wrap-up instruction and the system prompt names field control', () => {
    const schema = fallSchemaFixture();
    const state = leaiFormMode.init(schema);
    const turn = leaiFormMode.beforeTurn(state, '');
    const promptTail = leaiFormMode.systemPromptTail(schema);

    assert.doesNotMatch(turn.directive.text, /anything else/i);
    assert.doesNotMatch(turn.directive.text, /sub-field/i);
    assert.match(promptTail, /field-by-field/i);
    assert.match(promptTail, /canonical field label/i);
});

test('the final field can be probed once before advancing directly to the next section', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    leaiFormMode.beforeTurn(state, '');
    leaiFormMode.beforeTurn(state, substantialAnswer());
    leaiFormMode.beforeTurn(state, substantialAnswer());

    assert.equal(leaiFormMode.currentField(state).id, 'uncertainty');
    const probeTurn = leaiFormMode.beforeTurn(state, 'Nothing.');
    assert.equal(probeTurn.directive.kind, 'field_probe');
    assert.equal(probeTurn.directive.field_id, 'uncertainty');

    const nextSectionTurn = leaiFormMode.beforeTurn(state, 'I cannot name anything else yet.');
    assert.equal(state.current_area_index, 2);
    assert.equal(state.field_cursor, 0);
    assert.equal(nextSectionTurn.directive.kind, 'field_question');
    assert.equal(nextSectionTurn.directive.field_id, 'choice');
    assert.doesNotMatch(nextSectionTurn.directive.text.split('\n\n[HARD RULES')[0], /Anything else/i);
});

test('pendingResponseAttribution reflects the exact field currently shown to the student', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    leaiFormMode.beforeTurn(state, '');

    assert.deepEqual(leaiFormMode.pendingResponseAttribution(state), {
        form_schema_id: 'collab-ai-metacognition',
        form_schema_version: 1,
        form_section_id: 'understanding',
        form_field_id: 'mental-model',
        form_field_label: 'How do you think the AI produced its response?',
        form_response_phase: 'primary',
    });
});

test('structured artifacts render exact attributed student responses field by field', () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    const transcript = [
        {
            role: 'user',
            text: 'I think it predicted likely words from patterns in its training data.',
            form_section_id: 'understanding',
            form_field_id: 'mental-model',
            form_field_label: 'How do you think the AI produced its response?',
            form_response_phase: 'primary',
        },
        {
            role: 'user',
            text: 'I am about a three because I cannot see its internal process.',
            form_section_id: 'understanding',
            form_field_id: 'confidence',
            form_field_label: 'How confident are you in that explanation, and why?',
            form_response_phase: 'primary',
        },
    ];

    const markdown = leaiFormMode.renderStructuredMarkdown(state, transcript);
    const html = leaiFormMode.renderStructuredHtml(state, transcript);

    assert.match(markdown, /\*\*How do you think the AI produced its response\?\*\*/);
    assert.match(markdown, /predicted likely words from patterns/);
    assert.match(markdown, /\*\*How confident are you in that explanation, and why\?\*\*/);
    assert.match(markdown, /about a three because/);
    assert.match(html, /How do you think the AI produced its response\?/);
    assert.match(html, /predicted likely words from patterns/);
    assert.match(html, /How confident are you in that explanation, and why\?/);
});

test('structured artifacts keep QA conversation links inside the QA public base', async () => {
    const state = leaiFormMode.init(fallSchemaFixture());
    const transcript = [];
    const opts = {
        publicId: 'qa-survey',
        sessionId: 'qa-session',
        publicBaseUrl: 'https://guii-lab.github.io/LEAI-QA/LEAI/',
    };

    const markdown = leaiFormMode.renderStructuredMarkdown(state, transcript, opts);
    const html = leaiFormMode.renderStructuredHtml(state, transcript, opts);
    assert.match(markdown, /LEAI-QA\/LEAI\/feedback\.html\?id=qa-survey#cid=qa-session/);
    assert.match(html, /LEAI-QA\/LEAI\/feedback\.html\?id=qa-survey#cid=qa-session/);
    assert.doesNotMatch(markdown, /guii-lab\.github\.io\/LEAI\/feedback/);
    assert.doesNotMatch(html, /guii-lab\.github\.io\/LEAI\/feedback/);

    const encodedMarkdown = leaiFormMode.renderStructuredMarkdown(state, transcript, {
        publicId: 'qa survey',
        sessionId: 'qa#session',
        publicBaseUrl: opts.publicBaseUrl,
    });
    assert.match(encodedMarkdown, /id=qa\+survey#cid=qa%23session/);

    const reservedSessionOpts = {
        publicId: 'qa-survey',
        sessionId: 's /?#%&',
        publicBaseUrl: opts.publicBaseUrl,
    };
    const reservedMarkdown = leaiFormMode.renderStructuredMarkdown(state, transcript, reservedSessionOpts);
    const reservedHtml = leaiFormMode.renderStructuredHtml(state, transcript, reservedSessionOpts);
    const reservedTarget = 'https://guii-lab.github.io/LEAI-QA/LEAI/feedback.html?id=qa-survey#cid=s%20%2F%3F%23%25%26';
    assert.match(reservedMarkdown, new RegExp(reservedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(reservedHtml, new RegExp(reservedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const originalDocx = globalThis.docx;
    class FakeDocxNode {
        constructor(options) { this.options = options; }
    }
    globalThis.docx = {
        Paragraph: FakeDocxNode,
        TextRun: FakeDocxNode,
        TableCell: FakeDocxNode,
        TableRow: FakeDocxNode,
        Table: FakeDocxNode,
        Document: FakeDocxNode,
        ExternalHyperlink: FakeDocxNode,
        Packer: { toBlob: async function (document) { return document; } },
    };
    try {
        const document = await leaiFormMode.renderStructuredDocx(state, transcript, reservedSessionOpts);
        const children = document.options.sections[0].children;
        const linkParagraph = children.find(function (node) {
            return node.options.children && node.options.children.some(function (child) {
                return child.options && child.options.link;
            });
        });
        const link = linkParagraph.options.children.find(function (child) {
            return child.options && child.options.link;
        });
        assert.equal(link.options.link, reservedTarget);
    } finally {
        if (originalDocx === undefined) delete globalThis.docx;
        else globalThis.docx = originalDocx;
    }
});

test('table and rating kinds turn their field metadata into one shaped question each', () => {
    const schema = {
        schema_id: 'team-kind-shapes',
        version: '1.0.0',
        sections: [{
            id: 'team',
            title: 'Team',
            fields: [
                {
                    id: 'roster',
                    kind: 'table',
                    columns: ['Team Member', 'Primary Role / Contribution This Week'],
                },
                {
                    id: 'shared-goal',
                    kind: 'rating_with_justification',
                    dimension: 'We had a clear, shared goal for the week.',
                },
            ],
        }],
        closing: { feedback_prompt: 'How was this reflection?' },
    };
    const state = leaiFormMode.init(schema);

    const tableTurn = leaiFormMode.beforeTurn(state, '');
    assert.match(tableTurn.directive.student_question, /What rows.*Team Member.*Primary Role \/ Contribution This Week/i);
    assert.equal((tableTurn.directive.student_question.match(/\?/g) || []).length, 1);

    const ratingTurn = leaiFormMode.beforeTurn(state, substantialAnswer());
    assert.match(ratingTurn.directive.student_question, /1.?5 rating/i);
    assert.match(ratingTurn.directive.student_question, /We had a clear, shared goal for the week/);
    assert.match(ratingTurn.directive.student_question, /why\?/i);
    assert.equal((ratingTurn.directive.student_question.match(/\?/g) || []).length, 1);
});

test('schema validation rejects ambiguous field identity and unsupported kinds', () => {
    const duplicate = fallSchemaFixture();
    duplicate.sections[1].fields[0].id = 'mental-model';
    assert.throws(
        () => leaiFormMode.init(duplicate),
        /duplicate field id.*mental-model/i
    );

    const missingId = fallSchemaFixture();
    delete missingId.sections[0].fields[0].id;
    assert.throws(
        () => leaiFormMode.init(missingId),
        /field id is required/i
    );

    const unsupported = fallSchemaFixture();
    unsupported.sections[0].fields[0].kind = 'essay_blob';
    assert.throws(
        () => leaiFormMode.init(unsupported),
        /unsupported field kind.*essay_blob/i
    );
});

test('schema validation preserves the historical unlabeled longform fallback only', () => {
    const legacy = {
        schema_id: 'legacy-longform',
        version: '1.0.0',
        sections: [{
            id: 'reflection',
            title: 'Reflection',
            opening_prompt: 'What happened this week?',
            fields: [{ id: 'reflection', kind: 'longform' }],
        }],
        closing: { feedback_prompt: 'How was this reflection?' },
    };
    assert.doesNotThrow(() => leaiFormMode.init(legacy));

    const unlabeledShortform = fallSchemaFixture();
    delete unlabeledShortform.sections[0].fields[0].label;
    assert.throws(
        () => leaiFormMode.init(unlabeledShortform),
        /shortform field.*label/i
    );
});
