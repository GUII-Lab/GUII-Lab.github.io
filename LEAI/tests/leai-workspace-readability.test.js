'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

function citationPosition({ viewport = [390, 845], anchor, size }) {
    const source = fs.readFileSync(path.join(root, 'leai-shared.js'), 'utf8');
    const start = source.indexOf('const citationPopoverAnchors');
    const end = source.indexOf('\nfunction refreshCitationPopovers', start);
    const context = {
        document: { documentElement: { clientWidth: viewport[0] } },
        window: { innerHeight: viewport[1] },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + '\nthis.position = positionCitationPopover;', context);
    const popover = { style: {}, getBoundingClientRect: () => size };
    context.position(popover, { getBoundingClientRect: () => anchor });
    return Object.fromEntries(Object.entries(popover.style).map(([key, value]) => [key, parseFloat(value)]));
}

test('citation popup uses space below the source when it fits', () => {
    const style = citationPosition({ anchor: { left: 30, top: 100, bottom: 120 }, size: { width: 300, height: 200 } });
    assert.deepEqual(style, { left: 30, top: 128, maxHeight: 821 });
});

test('citation popup opens above a source near the bottom and stays within the right edge', () => {
    const style = citationPosition({ anchor: { left: 350, top: 700, bottom: 720 }, size: { width: 366, height: 435 } });
    assert.deepEqual(style, { left: 12, top: 257, maxHeight: 821 });
});

test('expanded citation fallback keeps the whole scrollable popup inside the viewport', () => {
    const style = citationPosition({ anchor: { left: -10, top: 400, bottom: 420 }, size: { width: 366, height: 821 } });
    assert.deepEqual(style, { left: 12, top: 12, maxHeight: 821 });
});

function scopeDescription(scope, surveys) {
    const source = fs.readFileSync(path.join(root, 'FeedbackChat.html'), 'utf8');
    const names = ['modeOf', 'modeLabel', 'surveyLabel', 'describeScope'];
    const declarations = names.map(name => {
        const start = source.indexOf('    function ' + name + '(');
        return source.slice(start, source.indexOf('\n    }\n', start) + 7);
    }).join('\n');
    const context = { allSurveys: surveys, scope };
    vm.createContext(context);
    return vm.runInContext(declarations + '\ndescribeScope(scope)', context);
}

const surveys = [
    { gpt_id: 11, mode: 'form', week_number: 3, survey_label: 'Week 3 · Class discussion reflection' },
    { gpt_id: 12, mode: 'form', week_number: 9, survey_label: 'Week 9 · Discussion flow check' },
];
test('a single selected activity names the actual activity even when the stored ID is a string', () => {
    assert.equal(scopeDescription({ kind: 'custom', survey_ids: ['11'] }, surveys), surveys[0].survey_label);
});
test('missing survey data keeps a safe count description', () => {
    assert.equal(scopeDescription({ kind: 'custom', survey_ids: [99] }, surveys), '1 surveys selected');
});
test('selecting both activities preserves the existing mode summary', () => {
    assert.equal(scopeDescription({ kind: 'custom', survey_ids: [11, 12] }, surveys), 'Structured Reflection · all (2)');
});
test('course, week, and empty selection remain explicit', () => {
    assert.equal(scopeDescription({ kind: 'course' }, surveys), 'Entire course');
    assert.equal(scopeDescription({ kind: 'week', week_number: 3 }, surveys), 'Week 3');
    assert.equal(scopeDescription({ kind: 'custom', survey_ids: [] }, surveys), 'No surveys selected');
});
