'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '..', 'feedbackResponses.html');

test('feedback responses uses the shared environment API contract', () => {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    const scripts = Array.from(
        html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi),
        function (match) { return match[1]; },
    );

    assert.deepEqual(scripts.slice(-3), [
        'leai-deployment-config.js?v=leai-env-r1',
        'leai-environment.js?v=leai-env-r1',
        'leai-shared.js?v=leai-env-r1',
    ]);
    assert.match(html, /fetch\(API \+ '\/feedbackList\/'\)/);
    assert.doesNotMatch(html, /guiidata-b6c968e6ed85\.herokuapp\.com/);
    assert.doesNotMatch(html, /(?:const|let|var)\s+API\s*=/);
});
