'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'leai-environment.js'), 'utf8');

function loadEnvironment(environment) {
    const listeners = {};
    const body = {
        children: [],
        insertBefore: function (node) { this.children.unshift(node); },
    };
    const document = {
        readyState: 'loading',
        body: body,
        addEventListener: function (type, listener) { listeners[type] = listener; },
        createElement: function () {
            return {
                attributes: {},
                setAttribute: function (name, value) { this.attributes[name] = value; },
            };
        },
        querySelector: function (selector) {
            return body.children.find(function (node) { return selector === '.leai-environment-banner' && node.className === 'leai-environment-banner'; }) || null;
        },
    };
    const window = {
        document: document,
        location: { hostname: 'guii-lab.github.io', origin: 'https://guii-lab.github.io', pathname: '/LEAI-QA/LEAI/InstructorHome.html' },
        LEAI_DEPLOYMENT_CONFIG: environment === 'qa' || environment === 'invalid-qa' ? {
            environment: 'qa',
            apiBase: 'https://guiidata-leai-qa.herokuapp.com/datapipeline/api',
            publicBaseUrl: environment === 'invalid-qa'
                ? 'http://guii-lab.github.io/LEAI-QA/LEAI/'
                : 'https://guii-lab.github.io/LEAI-QA/LEAI/',
        } : null,
    };
    vm.runInNewContext(source, { window: window, URL: URL });
    return { body: body, listeners: listeners };
}

test('QA environment adds one non-dismissible status banner after DOM content loads', () => {
    const page = loadEnvironment('qa');

    page.listeners.DOMContentLoaded();
    page.listeners.DOMContentLoaded();

    assert.equal(page.body.children.length, 1);
    const banner = page.body.children[0];
    assert.equal(banner.className, 'leai-environment-banner');
    assert.equal(banner.attributes.role, 'status');
    assert.equal(banner.textContent, 'QA environment · test data only');
});

test('production environment does not add a QA banner', () => {
    const page = loadEnvironment('production');

    assert.equal(page.listeners.DOMContentLoaded, undefined);
    assert.equal(page.body.children.length, 0);
});

test('invalid QA configuration does not add a banner', () => {
    const page = loadEnvironment('invalid-qa');

    assert.equal(page.listeners.DOMContentLoaded, undefined);
    assert.equal(page.body.children.length, 0);
});
