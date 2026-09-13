'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LEAI_DIR = path.join(__dirname, '..');
const PAGES = [
    'CourseBanner.html',
    'Customizations.html',
    'FeedbackAnalyzer.html',
    'FeedbackChat.html',
    'InstructorHome.html',
    'PromptDesigner.html',
    'feedback.html',
];
const ENVIRONMENT_RELEASE_KEY = 'leai-env-r1';

function scriptSources(html) {
    return Array.from(
        html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi),
        function (match) { return match[1]; },
    );
}

test('LEAI pages load deployment configuration, environment, and shared code in order', () => {
    PAGES.forEach(function (page) {
        const html = fs.readFileSync(path.join(LEAI_DIR, page), 'utf8');
        const sources = scriptSources(html);
        const deploymentIndex = sources.indexOf(
            'leai-deployment-config.js?v=' + ENVIRONMENT_RELEASE_KEY,
        );

        assert.ok(deploymentIndex >= 0, page + ' must load the deployment config');
        assert.deepEqual(
            sources.slice(deploymentIndex, deploymentIndex + 3),
            [
                'leai-deployment-config.js?v=' + ENVIRONMENT_RELEASE_KEY,
                'leai-environment.js?v=' + ENVIRONMENT_RELEASE_KEY,
                'leai-shared.js?v=' + ENVIRONMENT_RELEASE_KEY,
            ],
            page + ' must load the versioned environment contract immediately before shared code',
        );
        assert.doesNotMatch(html, /(?:const|let|var)\s+API\s*=/);
        assert.doesNotMatch(html, /guiidata-b6c968e6ed85\.herokuapp\.com|localhost:8000\/datapipeline\/api/);
    });
});

test('shared API binding requires a resolved LEAI environment', () => {
    const shared = fs.readFileSync(path.join(LEAI_DIR, 'leai-shared.js'), 'utf8');

    assert.match(
        shared,
        /const API = leaiEnvironment\.requireApiBase\(window\.LEAI_ENVIRONMENT\);/,
    );
});
