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

test('older insights show original response text; unavailable text is explicit', () => {
    const { render } = setup();
    const older = render({ text: 'Older theme', cited_ids: ['R1'], quotes: [] });
    assert.equal(find(older, 'qt-quote-body').children[0].text, 'Original response');
    const unavailable = render({ text: 'Missing source', cited_ids: ['R2'] });
    assert.equal(find(unavailable, 'qt-evidence').children[0].textContent,
        'Source text is unavailable for these responses.');
});
