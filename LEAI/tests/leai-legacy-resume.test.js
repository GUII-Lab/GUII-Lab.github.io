'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../feedback.html'), 'utf8');

function loadRecovery(overrides = {}) {
    const start = source.indexOf('        async function recoverLegacyTranscript(');
    assert.notEqual(start, -1, 'the startup recovery handler must exist');
    const end = source.indexOf('\n        function startOrchestratedChat(', start);
    const rendered = [], errors = [], calls = [];
    const context = {
        gptConfig: {id: 351}, window: {sessionData: {sessionID: 'existing-session'}},
        leaiSession: {resume: async (...args) => { calls.push(args); return {messages: [{content: 'saved'}]}; }},
        renderLegacyTranscript: messages => rendered.push(messages),
        orchestrationError: error => errors.push(error), ...overrides,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return {context, rendered, errors, calls};
}

test('only an existing legacy transcript startup conflict restores saved messages', async () => {
    const h = loadRecovery();
    await h.context.recoverLegacyTranscript({status: 409, message: 'existing_legacy_transcript'});
    assert.deepEqual(h.calls, [[351, 'existing-session']]);
    assert.equal(h.rendered[0][0].content, 'saved');
    assert.equal(h.errors.length, 0);
});

for (const [status, message] of [[409, 'stale_turn'], [410, 'session_archived'], [403, 'survey_closed'], [503, 'engine_unavailable'], [500, 'existing_legacy_transcript']]) {
    test(`startup ${status}/${message} never falls back to legacy records`, async () => {
        const h = loadRecovery(); const error = {status, message};
        await h.context.recoverLegacyTranscript(error);
        assert.equal(h.calls.length, 0);
        assert.equal(h.rendered.length, 0);
        assert.equal(h.errors[0], error);
    });
}

for (const result of ['empty', 'failed']) {
    test(`legacy read ${result} keeps the session closed with an actionable error`, async () => {
        const h = loadRecovery({leaiSession: {resume: async () => {
            if (result === 'failed') throw new Error('network');
            return {messages: []};
        }}});
        await h.context.recoverLegacyTranscript({status: 409, message: 'existing_legacy_transcript'});
        assert.equal(h.rendered.length, 0);
        assert.equal(h.errors[0].message, 'legacy_restore_failed');
    });
}
