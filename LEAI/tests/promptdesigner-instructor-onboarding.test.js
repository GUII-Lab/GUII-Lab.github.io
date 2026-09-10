'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promptDesigner = fs.readFileSync(
    path.join(__dirname, '..', 'PromptDesigner.html'),
    'utf8'
);
const shared = fs.readFileSync(path.join(__dirname, '..', 'leai-shared.js'), 'utf8');

test('Prompt Designer loads the instructor auth adapter before its page controller', () => {
    assert.match(promptDesigner, /<script src="leai-instructor-auth\.js[^>]*><\/script>/);
});

test('the onboarding shell has sign-in, required-password-change, and course-picker stages', () => {
    for (const id of [
        'instructor-signin-panel',
        'password-change-panel',
        'course-picker-panel',
        'instructor-email',
        'instructor-password',
        'course-list',
        'new-course-panel',
    ]) {
        assert.match(promptDesigner, new RegExp('id="' + id + '"'));
    }
});

test('Prompt Designer no longer provisions courses through the legacy shared-password endpoints', () => {
    assert.doesNotMatch(promptDesigner, /\/create_course\//);
    assert.doesNotMatch(promptDesigner, /\/verify_course_password\//);
});

test('new course creation requires an institution and no course password', () => {
    assert.match(promptDesigner, /id="new-institution-slug"/);
    assert.doesNotMatch(promptDesigner, /id="new-password"/);
});

test('shared sidebar sign-out revokes instructor sessions when an auth token exists', () => {
    assert.match(shared, /leaiInstructorAuth\.signOut/);
    assert.match(shared, /instructorToken/);
    assert.match(shared, /window\.location\.href = 'PromptDesigner\.html'/);
});
