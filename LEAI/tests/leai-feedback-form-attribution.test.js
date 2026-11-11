'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const feedbackSource = fs.readFileSync(
    path.join(__dirname, '..', 'feedback.html'),
    'utf8'
);

test('student message persistence captures the field shown before cursor advancement', () => {
    assert.match(
        feedbackSource,
        /function currentFormResponseAttribution\(\)[\s\S]*?pendingResponseAttribution\(formMode\.state\)/
    );
    assert.match(
        feedbackSource,
        /function storeData\([\s\S]*?var formAttribution = currentFormResponseAttribution\(\);[\s\S]*?Object\.assign\(data, formAttribution\)/
    );
});

test('in-group student persistence uses the same exact field attribution', () => {
    assert.match(
        feedbackSource,
        /function persistBackendMessage\([\s\S]*?var formAttribution = currentFormResponseAttribution\(\);[\s\S]*?Object\.assign\(payload, formAttribution\)/
    );
});

test('live and resumed chat history retain attribution for field-aware downloads', () => {
    assert.match(
        feedbackSource,
        /function attributedChatTurn\([\s\S]*?form_field_id:[\s\S]*?form_response_phase:/
    );
    assert.match(
        feedbackSource,
        /chatHistory\.push\(attributedChatTurn\('user', transcription, currentFormResponseAttribution\(\)\)\)/
    );
    assert.match(
        feedbackSource,
        /chatHistory\.push\(attributedChatTurn\(role, m\.content, m\)\)/
    );
    assert.match(
        feedbackSource,
        /form_field_id: m\.form_field_id[\s\S]*?form_response_phase: m\.form_response_phase/
    );
});

test('assistant field questions persist and remain attributed alongside answers', () => {
    assert.match(
        feedbackSource,
        /function attributedChatTurn\([\s\S]*?if \(!attribution\) return turn;/
    );
    assert.doesNotMatch(
        feedbackSource,
        /function attributedChatTurn\([\s\S]*?if \(role !== 'user' \|\| !attribution\) return turn;/
    );
    assert.match(
        feedbackSource,
        /function storeData\([\s\S]*?var formAttribution = currentFormResponseAttribution\(\);[\s\S]*?Object\.assign\(data, formAttribution\)/
    );
    assert.match(
        feedbackSource,
        /function persistBackendMessage\([\s\S]*?var formAttribution = currentFormResponseAttribution\(\);[\s\S]*?Object\.assign\(payload, formAttribution\)/
    );
    assert.match(
        feedbackSource,
        /chatHistory\.push\(attributedChatTurn\('assistant', displayed, currentFormResponseAttribution\(\)\)\)/
    );
});

test('main and group resume prime the opening directive before replaying the first AI turn', () => {
    assert.match(
        feedbackSource,
        /function replayResumedConversation\(messages\)[\s\S]*?beforeTurn\(formMode\.state, null\)[\s\S]*?messages\.forEach/
    );
    assert.match(
        feedbackSource,
        /function rehydrateChat\(snapshot\)[\s\S]*?beforeTurn\(formMode\.state, null\)[\s\S]*?for \(var i = 0; i < prior\.length; i\+\+\)/
    );
});
