'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const leaiFormMode = require('../leai-formmode.js');

const schemaPath = path.join(
    __dirname,
    'fixtures',
    'collab-ai-metacognition-v1.0.0.json'
);

function loadFall26Schema() {
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

test('the production Winter 27 schema walks all 11 labels in exact order', () => {
    const schema = loadFall26Schema();
    const expected = schema.sections.flatMap((section) =>
        section.fields.map((field) => ({
            sectionId: section.id,
            fieldId: field.id,
            label: field.label,
        }))
    );
    const state = leaiFormMode.init(schema);
    const seen = [];

    let turn = leaiFormMode.beforeTurn(state, '');
    for (const expectedField of expected) {
        seen.push({
            sectionId: turn.directive.section_id,
            fieldId: turn.directive.field_id,
            label: turn.directive.field_label,
        });
        const directiveBody = turn.directive.text.split('\n\n[HARD RULES')[0];
        assert.ok(directiveBody.includes(expectedField.label));
        const otherLabels = expected
            .map((field) => field.label)
            .filter((label) => label !== expectedField.label);
        for (const otherLabel of otherLabels) {
            assert.ok(!directiveBody.includes(otherLabel));
        }
        turn = leaiFormMode.beforeTurn(
            state,
            'I use this by checking the task context and making one deliberate choice.'
        );
    }

    assert.deepEqual(seen, expected);
    assert.equal(turn.directive.kind, 'close');
    assert.match(turn.directive.text, /how did reflecting through this conversation compare/i);
});

test('the production Winter 27 opening ignores compound section prompts', () => {
    const schema = loadFall26Schema();
    const turn = leaiFormMode.beforeTurn(leaiFormMode.init(schema), '');
    const directiveBody = turn.directive.text.split('\n\n[HARD RULES')[0];

    assert.match(directiveBody, /How I give the most appropriate information to the AI/);
    assert.doesNotMatch(directiveBody, /what it needs/);
    assert.doesNotMatch(directiveBody, /what it’s good and less good at/);
    assert.doesNotMatch(directiveBody, /how you split the work/);
});

test('the displayed primary question is deterministically anchored to the label', () => {
    const schema = loadFall26Schema();
    const state = leaiFormMode.init(schema);
    const pre = leaiFormMode.beforeTurn(state, '');

    assert.equal(
        pre.directive.student_question,
        'How do you give the most appropriate information to the AI?'
    );

    const post = leaiFormMode.afterTurn(
        state,
        'Hi, I’ll guide you one item at a time. What usually makes an AI answer useful?'
    );

    assert.match(post.displayedMessage, /How do you give the most appropriate information to the AI\?/);
    assert.doesNotMatch(post.displayedMessage, /What usually makes an AI answer useful\?/);
});

test('all Winter 27 first-person labels become grammatical second-person questions', () => {
    const schema = loadFall26Schema();
    const expectedQuestions = [
        'How do you give the most appropriate information to the AI?',
        'What information does the AI need to perform the task?',
        'How well do you understand what the AI is good at and less good at for this task?',
        'How do you decide the best way to divide the work between you and the AI?',
        'How do you make sure you’re giving the AI’s recommendations proper consideration before accepting or rejecting them?',
        'How do you check in on task goals while working with the AI?',
        'How do you watch for your own mental shortcuts or biases shaping your reactions to the AI’s output?',
        'How do you stay aware of your own limitations while doing the task?',
        'How do you think about improving the way you work with the AI?',
        'How do you examine your own thinking before drawing conclusions about the AI’s output?',
        'How do you analyze a situation after something goes wrong, so you can learn from it?',
    ];
    const actualQuestions = schema.sections.flatMap((section) =>
        section.fields.map((field) => leaiFormMode.canonicalStudentQuestion(field.label))
    );

    assert.deepEqual(actualQuestions, expectedQuestions);
});
