'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadInsights() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'leai-shared.js'), 'utf8');
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const sandbox = {
        window: { location: { hostname: 'localhost' } },
        document: {},
        sessionStorage: storage,
        localStorage: storage,
        setTimeout,
        clearTimeout,
        URLSearchParams,
        Set,
        console,
    };
    vm.runInNewContext(source + '\n;globalThis.__leaiInsights = leaiInsights;', sandbox);
    return sandbox.__leaiInsights;
}

test('insights payload includes ordered field contracts and attributed original responses', () => {
    const insights = loadInsights();
    const schema = {
        schema_id: 'collab-ai-metacognition',
        title: 'Collaborative AI Metacognition',
        sections: [{
            id: 'understanding',
            title: 'Understanding the AI',
            fields: [
                { id: 'mental-model', kind: 'shortform', label: 'How do you think the AI produced its response?' },
                { id: 'confidence', kind: 'rating_with_justification', label: 'How confident are you, and why?' },
            ],
        }],
    };
    const messages = [{
        sent_by: 'user',
        content: 'It predicts likely continuations based on learned patterns.',
        form_section_id: 'understanding',
        form_field_id: 'mental-model',
        form_field_label: 'How do you think the AI produced its response?',
        form_response_phase: 'primary',
    }];

    const payload = insights.buildPayload(schema, messages, { sessionId: 'session-1' });

    assert.match(payload, /mental-model \[shortform\]: How do you think the AI produced its response\?/);
    assert.match(payload, /confidence \[rating_with_justification\]: How confident are you, and why\?/);
    assert.match(payload, /ATTRIBUTED ORIGINAL STUDENT RESPONSES/);
    assert.match(payload, /Field mental-model.*Primary: It predicts likely continuations/s);
});
