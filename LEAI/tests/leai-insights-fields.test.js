'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function source(name) {
    return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

function createSandbox(locationLike) {
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const sandbox = {
        location: locationLike || {
            hostname: 'localhost',
            origin: 'http://localhost:8080',
            pathname: '/LEAI/FeedbackAnalyzer.html',
        },
        document: {},
        sessionStorage: storage,
        localStorage: storage,
        setTimeout,
        clearTimeout,
        URLSearchParams,
        Set,
        console,
    };
    sandbox.window = sandbox;
    return sandbox;
}

function loadEnvironment(sandbox, deploymentOverride) {
    vm.runInNewContext(source('leai-deployment-config.js'), sandbox);
    if (deploymentOverride !== undefined) sandbox.LEAI_DEPLOYMENT_CONFIG = deploymentOverride;
    vm.runInNewContext(source('leai-environment.js'), sandbox);
    return sandbox.LEAI_ENVIRONMENT;
}

function loadInsights(locationLike, deploymentOverride) {
    const sandbox = createSandbox(locationLike);
    const environment = loadEnvironment(sandbox, deploymentOverride);
    vm.runInNewContext(source('leai-shared.js') + '\n;globalThis.__leaiInsights = leaiInsights;', sandbox);
    return { insights: sandbox.__leaiInsights, environment: environment };
}

test('insights payload includes ordered field contracts and attributed original responses', () => {
    const { insights } = loadInsights();
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

test('insights VM keeps unknown and invalid QA environments fail-closed', () => {
    const unknownLocation = {
        hostname: 'example.test',
        origin: 'https://example.test',
        pathname: '/LEAI/FeedbackAnalyzer.html',
    };
    const unknown = loadEnvironment(createSandbox(unknownLocation));
    assert.equal(unknown.known, false);
    assert.equal(unknown.apiBase, '');
    assert.throws(() => loadInsights(unknownLocation), /LEAI_UNKNOWN_ENVIRONMENT/);

    const invalidQa = loadEnvironment(createSandbox({
        hostname: 'guii-lab.github.io',
        origin: 'https://guii-lab.github.io',
        pathname: '/LEAI-QA/LEAI/FeedbackAnalyzer.html',
    }), {
        environment: 'qa',
        apiBase: 'https://guiidata-leai-qa-f30daf4812c3.herokuapp.com/datapipeline/api',
        publicBaseUrl: 'http://guii-lab.github.io/LEAI-QA/LEAI/',
    });
    assert.equal(invalidQa.known, false);
    assert.equal(invalidQa.apiBase, '');
});
