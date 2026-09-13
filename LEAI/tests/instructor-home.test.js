'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOME_PATH = path.join(__dirname, '..', 'InstructorHome.html');
const CONTROLLER_PATH = path.join(__dirname, '..', 'leai-instructor-home.js');

function homeSource() {
    return fs.readFileSync(HOME_PATH, 'utf8');
}

test('Instructor Home contains every real page state and shared dependency', () => {
    const html = homeSource();
    [
        'home-auth-view',
        'home-password-view',
        'home-shell',
        'courses-view',
        'account-view',
        'course-grid',
        'course-empty-state',
        'create-course-drawer',
        'mobile-nav-drawer',
        'home-live-region',
    ].forEach(function (id) {
        assert.match(html, new RegExp('id="' + id + '"'));
    });
    assert.match(html, /leai-tailwind-config\.js/);
    assert.match(html, /leai-shared\.css/);
    assert.match(html, /leai-instructor-auth\.js/);
    assert.match(html, /leai-shared\.js/);
    assert.match(html, /leai-instructor-home\.js/);
    assert.match(html, /leai-version\.js/);
    assert.ok(
        html.indexOf('leai-instructor-auth.js') < html.indexOf('leai-instructor-home.js'),
        'auth adapter must load before the Home controller',
    );
});

test('Home uses accessible landmarks, persistent labels, and dialogs', () => {
    const html = homeSource();
    assert.match(html, /<nav[^>]+aria-label="Instructor navigation"/);
    assert.match(html, /<main[^>]+id="home-main"/);
    assert.match(html, /id="create-course-drawer"[^>]+role="dialog"[^>]+aria-modal="true"/);
    assert.match(html, /id="mobile-nav-drawer"[^>]+role="dialog"[^>]+aria-modal="true"/);
    [
        'home-email',
        'home-password',
        'setup-new-password',
        'setup-confirm-password',
        'course-institution',
        'course-name',
        'course-id',
        'course-instructor-name',
        'account-display-name',
        'account-email',
        'account-current-password',
        'account-new-password',
        'account-confirm-password',
    ].forEach(function (id) {
        assert.match(html, new RegExp('<label[^>]+for="' + id + '"'));
    });
    assert.match(html, /id="home-live-region"[^>]+aria-live="polite"/);
});

test('first release renders only real navigation and no future course actions', () => {
    const html = homeSource();
    assert.match(html, />Courses</);
    assert.match(html, />Account</);
    assert.match(html, />Instructor guide</i);
    assert.match(html, />Sign out</);
    assert.match(html, />Create course</);
    assert.doesNotMatch(
        html,
        />\s*(Duplicate|Rollover|Archive|Canvas|Notifications|Collaborators)\s*</i,
    );
    assert.doesNotMatch(html, /three-dot|more_vert|ellipsis-menu/i);
});

test('Account keeps only editable display name, UCSC email, and password controls', () => {
    const html = homeSource();
    const emailInput = html.match(/<input id="account-email"[^>]*>/)[0];
    assert.doesNotMatch(emailInput, /readonly|aria-readonly/);
    assert.match(emailInput, /required/);
    assert.doesNotMatch(html, /id="(?:rail|mobile)-account-email"/);
    assert.doesNotMatch(html, /account-details-title|account-provider|account-verification|account-institutions/);
    assert.doesNotMatch(html, /Email status|Institution access|Sign-in method|Managed by administrator/);
});

test('Home accepts only UCSC instructor email addresses', () => {
    delete require.cache[require.resolve(CONTROLLER_PATH)];
    const home = require(CONTROLLER_PATH);
    assert.equal(home.isAllowedInstructorEmail('name@ucsc.edu'), true);
    assert.equal(home.isAllowedInstructorEmail(' NAME@UCSC.EDU '), true);
    assert.equal(home.isAllowedInstructorEmail('name@example.edu'), false);
    assert.equal(home.isAllowedInstructorEmail('instructor@qa.invalid'), false);
    assert.equal(home.isAllowedInstructorEmail('name@sub.ucsc.edu'), false);
    assert.equal(home.isAllowedInstructorEmail('name space@ucsc.edu'), false);
});

test('profile patch omits an unchanged seeded QA email on a display-name-only save', () => {
    delete require.cache[require.resolve(CONTROLLER_PATH)];
    const home = require(CONTROLLER_PATH);

    assert.deepEqual(home.profilePatch({
        display_name: 'QA Instructor',
        email: 'instructor@qa.invalid',
    }, '  QA Instructor Updated  ', '  INSTRUCTOR@QA.INVALID  '), {
        display_name: 'QA Instructor Updated',
    });
});

test('profile patch normalizes a changed UCSC email and omits unchanged fields', () => {
    delete require.cache[require.resolve(CONTROLLER_PATH)];
    const home = require(CONTROLLER_PATH);
    const account = {
        display_name: 'Prof. Rivera',
        email: 'prof.rivera@ucsc.edu',
    };

    assert.deepEqual(
        home.profilePatch(account, 'Prof. Rivera', '  NEW.ADDRESS@UCSC.EDU  '),
        { email: 'new.address@ucsc.edu' },
    );
    assert.deepEqual(
        home.profilePatch(account, '  Prof. Rivera  ', '  PROF.RIVERA@UCSC.EDU  '),
        {},
    );
});

test('pure Home helpers normalize slugs, institutions, and course cards', () => {
    delete require.cache[require.resolve(CONTROLLER_PATH)];
    const home = require(CONTROLLER_PATH);
    const account = {
        display_name: 'Prof. Rivera',
        institutions: [{ slug: 'ucsc', name: 'University of California, Santa Cruz' }],
    };
    const course = {
        course_id: 'cmpm80k-sm26',
        course_name: 'Foundations of Game Design',
        institution_slug: 'ucsc',
        role: 'owner',
    };

    assert.equal(
        home.slugSuggestion(' Foundations of Game Design '),
        'foundations-of-game-design',
    );
    assert.equal(home.slugSuggestion('HCI & AI!!!'), 'hci-ai');
    assert.equal(
        home.institutionName(account, 'ucsc'),
        'University of California, Santa Cruz',
    );
    assert.equal(home.institutionName(account, 'missing'), 'missing');
    assert.deepEqual(
        home.courseCardViewModel(course, account, { courseId: course.course_id }),
        {
            courseId: 'cmpm80k-sm26',
            courseName: 'Foundations of Game Design',
            institutionName: 'University of California, Santa Cruz',
            roleLabel: 'Owner',
            isCurrent: true,
        },
    );
});

test('Home controller isolates course selection for the later setup wizard', () => {
    const source = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    assert.match(source, /function continueIntoCourse\(course\)/);
    assert.match(source, /leaiInstructorAuth\.selectCourse/);
    assert.match(source, /PromptDesigner\.html/);
    assert.doesNotMatch(source, /FormSchema|QuestionSet|form_schema/);
});

test('sign out resets cross-account view and message state', () => {
    const source = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const start = source.indexOf('function showSignedOut(notice)');
    const end = source.indexOf('function accountSession', start);
    const signedOutBlock = source.slice(start, end);
    assert.match(signedOutBlock, /currentView = 'courses'/);
    assert.match(signedOutBlock, /account-profile-message/);
    assert.match(signedOutBlock, /account-password-message/);
    assert.match(signedOutBlock, /account-current-password/);
    assert.match(signedOutBlock, /account-new-password/);
    assert.match(signedOutBlock, /account-confirm-password/);
});
