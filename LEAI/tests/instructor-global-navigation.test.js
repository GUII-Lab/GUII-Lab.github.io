'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(filename) {
    return fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
}

const instructorPages = [
    'PromptDesigner.html',
    'FeedbackAnalyzer.html',
    'FeedbackChat.html',
    'CourseBanner.html',
    'Customizations.html',
];

test('every course-scoped instructor tool has one visible All courses route', () => {
    instructorPages.forEach(function (filename) {
        const html = source(filename);
        const links = html.match(/href="InstructorHome\.html"[^>]*>[\s\S]*?<span class="sidebar-label">All courses<\/span>/g) || [];
        assert.equal(links.length, 1, filename);
    });
});

test('shared sign out revokes account sessions and always finishes at Home', () => {
    const shared = source('leai-shared.js');
    assert.match(shared, /leaiInstructorAuth\.signOut\(fetch, API, instructorToken\)/);
    assert.match(shared, /window\.location\.href = leaiInstructorAuth\.instructorHomeHref\(\)/);
    assert.doesNotMatch(shared, /window\.location\.href = 'PromptDesigner\.html'/);
    assert.doesNotMatch(shared, /getElementById\('login-screen'\)/);
});

test('All courses navigation preserves the selected course session', () => {
    const shared = source('leai-shared.js');
    assert.doesNotMatch(shared, /InstructorHome\.html[\s\S]{0,120}clearSession\(/);
    instructorPages.forEach(function (filename) {
        const html = source(filename);
        const allCoursesLink = html.match(/<a href="InstructorHome\.html"[\s\S]*?<span class="sidebar-label">All courses<\/span>[\s\S]*?<\/a>/);
        assert.ok(allCoursesLink, filename);
        assert.doesNotMatch(allCoursesLink[0], /onclick=/i, filename);
    });
});
