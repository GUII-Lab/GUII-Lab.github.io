'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promptDesigner = fs.readFileSync(
    path.join(__dirname, '..', 'PromptDesigner.html'),
    'utf8',
);

test('Prompt Designer loads auth before its course-scoped controller', () => {
    const authIndex = promptDesigner.indexOf('leai-instructor-auth.js');
    const controllerIndex = promptDesigner.lastIndexOf('<script>');
    assert.notEqual(authIndex, -1);
    assert.ok(authIndex < controllerIndex);
});

test('global account onboarding exists only in Instructor Home', () => {
    [
        'instructor-signin-panel',
        'password-change-panel',
        'course-picker-panel',
        'course-list',
        'new-course-panel',
        'new-institution-slug',
        'new-course-id',
        'new-course-name',
        'new-instructor-name',
    ].forEach(function (id) {
        assert.doesNotMatch(promptDesigner, new RegExp('id="' + id + '"'));
    });
    assert.doesNotMatch(promptDesigner, /login-screen/);
    assert.doesNotMatch(promptDesigner, /leaiInstructorAuth\.(signIn|changePassword|createCourse)\(/);
});

test('course workspace offers a visible route back to all courses', () => {
    assert.match(
        promptDesigner,
        /href="InstructorHome\.html"[^>]*>[\s\S]*?<span class="sidebar-label">All courses<\/span>/,
    );
});

test('account sessions require an active selected membership before entry', () => {
    assert.match(promptDesigner, /leaiInstructorAuth\.hasUsableInstructorSession\(stored\)/);
    assert.match(promptDesigner, /leaiInstructorAuth\.getAccount\(fetch, API, stored\.instructorToken\)/);
    assert.match(promptDesigner, /account\.courses[\s\S]*course\.course_id === stored\.courseId/);
    assert.match(promptDesigner, /window\.location\.replace\('InstructorHome\.html'\)/);
});

test('legacy selected course sessions remain supported during cutover', () => {
    assert.match(promptDesigner, /stored\.courseId && !stored\.instructorToken/);
    assert.match(promptDesigner, /activeCourse = \{ id: stored\.courseId, name: stored\.courseName \}/);
    assert.doesNotMatch(promptDesigner, /\/create_course\//);
    assert.doesNotMatch(promptDesigner, /\/verify_course_password\//);
});
