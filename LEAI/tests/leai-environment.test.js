'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../leai-environment.js');

test('local, production, and explicit QA resolve without crossing environments', () => {
    assert.equal(env.resolveEnvironment(
        { hostname: 'localhost', origin: 'http://localhost:8080', pathname: '/LEAI/InstructorHome.html' },
        null,
    ).apiBase, 'http://localhost:8000/datapipeline/api');

    assert.equal(env.resolveEnvironment(
        { hostname: 'guii-lab.github.io', origin: 'https://guii-lab.github.io', pathname: '/LEAI/InstructorHome.html' },
        null,
    ).name, 'production');

    const qa = env.resolveEnvironment(
        { hostname: 'guii-lab.github.io', origin: 'https://guii-lab.github.io', pathname: '/LEAI-QA/LEAI/InstructorHome.html' },
        {
            environment: 'qa',
            apiBase: 'https://guiidata-leai-qa.herokuapp.com/datapipeline/api',
            publicBaseUrl: 'https://guii-lab.github.io/LEAI-QA/LEAI/',
            buildId: 'abc1234',
            emailEnabled: false,
        },
    );
    assert.equal(qa.name, 'qa');
    assert.equal(qa.publicBaseUrl, 'https://guii-lab.github.io/LEAI-QA/LEAI/');
});

test('unknown hosts fail instead of using production', () => {
    const unknown = env.resolveEnvironment(
        { hostname: 'example.test', origin: 'https://example.test', pathname: '/LEAI/' },
        null,
    );
    assert.equal(unknown.known, false);
    assert.throws(() => env.requireApiBase(unknown), /LEAI_UNKNOWN_ENVIRONMENT/);
});
