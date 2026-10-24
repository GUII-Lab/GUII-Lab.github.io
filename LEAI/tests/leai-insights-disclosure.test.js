'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production theme renderer without a browser or backend.
class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    click() { this.listeners.click(); }
}
function find(node, className) {
    if ((node.className || '').split(' ').includes(className)) return node;
    for (const child of node.children || []) {
        const match = find(child, className);
        if (match) return match;
    }
}
function setup() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'FeedbackAnalyzer.html'), 'utf8');
    const start = html.indexOf('var buildBulletLi = function (b) {');
    const end = html.indexOf('// Themes first.', start);
    const bindings = [];
    const context = {
        document: { createElement: tag => new Element(tag), createTextNode: text => ({ text }) },
        sentimentCounts: { positive: 0, negative: 0, mixed: 0, neutral: 0 },
        pillAssignment: { ridToPill: { R1: 1, R2: 2 } },
        sourceByRid: { R1: { text: 'Original response', week_number: 1, display_rid: 'R1' } },
        pillBindings: bindings,
    };
    vm.runInNewContext(html.slice(start, end), context);
    return { render: context.buildBulletLi, bindings };
}

test('all themes start collapsed, expand independently as quotations, and collapse again', () => {
    const { render, bindings } = setup();
    const bullets = ['positive', 'mixed', 'negative', 'neutral'].map(sentiment => render({
        text: 'Theme', sentiment, cited_ids: ['R1'], quotes: [{ rid: 'R1', text: '<student words>' }],
    }));
    for (const bullet of bullets) {
        const count = find(bullet, 'qt-claim-count');
        const evidence = find(bullet, 'qt-evidence');
        assert.equal(evidence.style.display, 'none');
        assert.equal(count.attributes['aria-expanded'], 'false');
        assert.equal(find(bullet, 'qt-cites'), undefined);
        count.click();
        assert.equal(evidence.style.display, 'block');
        assert.equal(count.attributes['aria-expanded'], 'true');
        assert.equal(find(evidence, 'qt-quote-body').children[0].text, '<student words>');
        for (const other of bullets.filter(other => other !== bullet)) {
            assert.equal(find(other, 'qt-evidence').style.display, 'none');
        }
        count.click();
        assert.equal(evidence.style.display, 'none');
        assert.equal(count.attributes['aria-expanded'], 'false');
    }
    assert.equal(bindings.length, 4);
    assert.equal(bindings[0].rid, 'R1');
    assert.equal(bindings[0].pill.attributes.tabindex, '0');
});

test('older insights without direct quotes never substitute the aggregated response', () => {
    const { render } = setup();
    const older = render({ text: 'Older theme', cited_ids: ['R1'], quotes: [] });
    assert.equal(find(older, 'qt-quote-body'), undefined);
    assert.equal(find(older, 'qt-evidence').children[0].textContent, 'No direct quotes saved for these responses.');
    const unavailable = render({ text: 'Missing source', cited_ids: ['R2'] });
    assert.equal(find(unavailable, 'qt-evidence').children[0].textContent,
        'No direct quotes saved for these responses.');
});

test('quotes outside the supported citation set are excluded', () => {
    const { render } = setup();
    const bullet = render({ text: 'Theme', cited_ids: ['R1'], quotes: [{ rid: 'R2', text: 'Unrelated quote' }] });
    assert.equal(find(bullet, 'qt-quote-body'), undefined);
});

function citationHelpers(surveys = []) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'FeedbackAnalyzer.html'), 'utf8');
    const start = html.indexOf('    function quickTakeSourceMessages');
    const end = html.indexOf('    var _quickTakePopover', start);
    const context = {
        allSurveys: surveys,
        document: { createElement: tag => new Element(tag), createTextNode: text => ({ text }) },
    };
    vm.runInNewContext(html.slice(start, end), context);
    return context;
}
test('citations resolve the exact survey and session, including repeated session IDs', () => {
    const first = [{ content: 'Week 1' }];
    const second = [{ content: 'Week 2' }];
    const helpers = citationHelpers([
        { gpt_id: 1, sessions: { same: first } }, { gpt_id: 2, sessions: { same: second } },
    ]);
    assert.equal(helpers.quickTakeSourceMessages({ survey_id: '2', session_id: 'same' }), second);
    assert.equal(helpers.quickTakeSourceMessages({ survey_id: 1, session_id: 'same' }), first);
    assert.equal(helpers.quickTakeSourceMessages({ session_id: 'same' }).length, 0);
});
test('highlighting preserves literal special characters, whitespace, and safe text', () => {
    const helpers = citationHelpers();
    const target = new Element('div');
    assert.equal(helpers.appendCitedText(target, 'Before <b> choice (a+b)?\n after', '<b> choice (a+b)?'), true);
    assert.equal(target.children[1].tag, 'mark');
    assert.equal(target.children[1].textContent, '<b> choice (a+b)?');
    const missing = new Element('div');
    assert.equal(helpers.appendCitedText(missing, 'Other words', 'no match'), false);
    assert.equal(missing.textContent, 'Other words');
});
