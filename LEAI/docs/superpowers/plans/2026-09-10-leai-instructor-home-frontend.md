# LEAI Instructor Home Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Prompt Designer's compact onboarding picker with a dedicated responsive Instructor Home for authentication, course management, account settings, and safe course switching.

**Architecture:** `InstructorHome.html` owns global account state and renders signed-out, forced-password, Courses, Account, and create-course-drawer views. `leai-instructor-auth.js` remains the shared API/session adapter. Course-scoped pages keep their existing tools and gain an All courses route; no fake future actions render.

**Tech Stack:** Static HTML, Tailwind CDN, `leai-shared.css`, vanilla JavaScript, Node built-in test runner, local Django API, Playwright/web verification.

**Spec:** `LEAI/docs/superpowers/specs/2026-09-10-leai-instructor-home-design.md`.

## Global Constraints

- Work in `/private/tmp/leai-question-set-wizard/frontend` on the existing `feat/leai-question-set-wizard` branch.
- Complete the backend audit/profile plan first so `PATCH instructor_me` exists for integration testing.
- Do not push or deploy.
- Do not show placeholder buttons or menus for rollover, duplicate, archive, collaborators, schema copy, notifications, or Canvas.
- Do not add a framework, bundler, or runtime dependency.
- Preserve `sessionStorage` key `leai_session` and legacy course-password compatibility during cutover.
- Do not store current or new passwords in web storage.
- Use existing LEAI tokens and shared modules; visual scale may be Canvas-like but must not copy Canvas branding.
- Verify real pages with real clicks/typing in Chromium and WebKit when available and generate a scoped HTML report.

---

### Task 1: Extend the shared instructor API and session adapter

**Files:**
- Modify: `LEAI/leai-instructor-auth.js`
- Modify: `LEAI/tests/leai-instructor-auth.test.js`

**Interfaces:**
- Produces: `updateProfile(fetchImpl, apiBase, token, displayName, email) -> Promise<Account>`.
- Produces: `instructorHomeHref() -> 'InstructorHome.html'`.
- Preserves: `signIn`, `getAccount`, `changePassword`, `listCourses`, `createCourse`, `signOut`, `selectCourse`, and `hasUsableInstructorSession`.

- [ ] **Step 1: Write failing adapter tests**

```javascript
test('updateProfile sends a trimmed display name and normalized email with bearer auth', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return jsonResponse(200, {
            display_name: 'Prof. Updated',
            email: 'prof.updated@ucsc.edu',
        });
    };
    const account = await auth.updateProfile(
        fetchImpl,
        '/api',
        'token',
        '  Prof. Updated  ',
        ' Prof.Updated@UCSC.EDU ',
    );
    assert.equal(calls[0].url, '/api/instructor_me/');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        display_name: 'Prof. Updated',
        email: 'prof.updated@ucsc.edu',
    });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
    assert.equal(account.display_name, 'Prof. Updated');
});
```

Also assert `instructorHomeHref()` returns the relative URL and `selectCourse` preserves every instructor-account field.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test LEAI/tests/leai-instructor-auth.test.js
```

Expected: missing `updateProfile` and `instructorHomeHref`.

- [ ] **Step 3: Implement minimal adapter methods**

Use the existing `authorizedOptions` and `parseResponse` helpers. PATCH sends only `{display_name: String(displayName || '').trim()}`. Keep all error details constrained to the existing stable error object.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
node --test LEAI/tests/leai-instructor-auth.test.js
```

- [ ] **Step 5: Commit the adapter**

```bash
git add LEAI/leai-instructor-auth.js LEAI/tests/leai-instructor-auth.test.js
git commit -m "Extend instructor account adapter"
```

---

### Task 2: Build the dedicated Instructor Home states and course dashboard

**Files:**
- Create: `LEAI/InstructorHome.html`
- Create: `LEAI/leai-instructor-home.js`
- Create: `LEAI/tests/instructor-home.test.js`

**Interfaces:**
- Consumes: all methods from `leai-instructor-auth.js`, global `API`, and `sessionStorage.leai_session`.
- Produces DOM states with IDs: `home-auth-view`, `home-password-view`, `home-shell`, `courses-view`, `account-view`, `course-grid`, `course-empty-state`, `create-course-drawer`, `mobile-nav-drawer`, and `home-live-region`.
- Produces exported pure helpers for tests: `slugSuggestion(name)`, `institutionName(account, slug)`, and `courseCardViewModel(course, account, session)`.

- [ ] **Step 1: Write failing structural and pure-helper tests**

Read `InstructorHome.html` and assert shared CSS/config/version/auth scripts, persistent form labels, all required state IDs, navigation landmarks, Courses and Account controls, and absence of future-action copy (`Duplicate`, `Rollover`, `Archive`, `Canvas`, `Notifications`). Require `leai-instructor-home.js` and test:

```javascript
assert.equal(home.slugSuggestion('Foundations of Game Design'), 'foundations-of-game-design');
assert.equal(home.institutionName(account, 'ucsc'), 'University of California, Santa Cruz');
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
```

- [ ] **Step 2: Run the home test and verify RED**

```bash
node --test LEAI/tests/instructor-home.test.js
```

Expected: page/controller files are missing.

- [ ] **Step 3: Implement the responsive HTML shell**

Load scripts in the established LEAI order. Create signed-out and forced-password panels, then a signed-in shell with a 232 px desktop rail and main canvas capped near 1280 px. Include Courses, Account, Instructor Guide, and Sign out only. Use a mobile top bar and hidden navigation drawer. Add a right-side create-course dialog/drawer with institution, course name, course ID, and instructor-name fields.

Use proper `<nav>`, `<main>`, `<button>`, `<form>`, `<label>`, `aria-current`, `role="dialog"`, `aria-modal`, and live-region semantics. Add `prefers-reduced-motion` handling and one-column mobile layout.

- [ ] **Step 4: Implement page state and session restoration**

On DOM ready:

1. read `leai_session`;
2. if no usable token, show sign-in;
3. if usable, call `getAccount`;
4. if `must_change_password`, show required password view;
5. otherwise render all active courses, mark but do not auto-open the current course;
6. on 401, clear storage and show session-expired sign-in.

Keep the temporary current password in a closure variable only during the forced password flow. Never put it in DOM data attributes or storage.

- [ ] **Step 5: Implement sign-in, password setup, and course selection**

Sign-in uses the existing generic invalid-credential copy. Required password setup validates matching fields, calls `changePassword`, refreshes the account, clears the in-memory current password, and opens Courses. Selecting a course calls `selectCourse`, writes the merged session, and navigates to `PromptDesigner.html`.

- [ ] **Step 6: Implement course rendering and create drawer**

Render cards from DOM methods and `textContent`, never HTML interpolation. Join institution names by slug. Sort the current course first, then remaining courses by course name and ID. Empty state renders one `Create your first course` action.

The drawer suggests a slug only until the instructor manually edits the ID. It traps focus, closes with Escape, restores trigger focus, preserves fields after API errors, and focuses the first invalid field. On success, call `selectCourse`, save the merged session, and enter Prompt Designer.

- [x] **Step 7: Implement Account view**

Profile save calls `updateProfile`, updates `instructorDisplayName` in storage, refreshes visible account copy, and leaves historical course names untouched server-side. Email is read-only with administrator-managed explanation. Password change requires current/new/confirmation fields, calls `changePassword`, clears all password inputs, and shows a non-color-only success message.

- [ ] **Step 8: Implement mobile navigation and sign out**

The mobile drawer traps/restores focus and closes on Escape or scrim click. Sign out calls the backend first, tolerates an expired session, clears storage, resets in-memory account state, and returns to signed-out view.

- [ ] **Step 9: Run home tests and verify GREEN**

```bash
node --test LEAI/tests/instructor-home.test.js LEAI/tests/leai-instructor-auth.test.js
```

- [ ] **Step 10: Commit Instructor Home**

```bash
git add LEAI/InstructorHome.html LEAI/leai-instructor-home.js LEAI/tests/instructor-home.test.js
git commit -m "Add LEAI instructor home"
```

---

### Task 3: Remove Prompt Designer onboarding and route account sessions through Home

**Files:**
- Modify: `LEAI/PromptDesigner.html`
- Replace: `LEAI/tests/promptdesigner-instructor-onboarding.test.js`
- Create: `LEAI/tests/promptdesigner-instructor-routing.test.js`

**Interfaces:**
- Consumes: a selected membership-owned session produced by Instructor Home.
- Produces: course-scoped Prompt Designer with `All courses` link to `InstructorHome.html`.
- Preserves: legacy `{courseId, courseName}` sessions without `instructorToken` during cutover.

- [ ] **Step 1: Replace obsolete tests with failing routing tests**

Delete assertions requiring sign-in/password/picker panels inside Prompt Designer. Assert those IDs and new-course fields are absent. Assert `InstructorHome.html` is linked from the sidebar and account-authenticated sessions without `courseId` redirect there.

```javascript
assert.doesNotMatch(promptDesigner, /id="course-picker-panel"/);
assert.doesNotMatch(promptDesigner, /id="instructor-signin-panel"/);
assert.match(promptDesigner, /href="InstructorHome\.html"[^>]*>[\s\S]*All courses/);
assert.match(promptDesigner, /window\.location\.replace\(['"]InstructorHome\.html['"]\)/);
```

- [ ] **Step 2: Run routing tests and verify RED**

```bash
node --test LEAI/tests/promptdesigner-instructor-routing.test.js
```

Expected: embedded onboarding still exists.

- [ ] **Step 3: Remove embedded global-account UI and controller code**

Remove onboarding-only CSS, markup, active-instructor/pending-password variables, and event handlers for sign-in, password change, course list, and create course. Keep the application, course mode, surveys, and legacy course-session behavior unchanged.

- [ ] **Step 4: Add membership-session routing**

On load:

- usable instructor token plus course ID: fetch account and verify the course remains in active memberships before entering;
- usable instructor token without course ID: `window.location.replace('InstructorHome.html')`;
- expired instructor token: clear session and redirect Home;
- legacy course-only session: enter as before;
- no session: redirect Home.

Add **All courses** above the course-scoped tool links. Returning Home does not clear the selected course.

- [ ] **Step 5: Run focused Prompt Designer tests**

```bash
node --test LEAI/tests/promptdesigner-instructor-routing.test.js LEAI/tests/leai-instructor-auth.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the Prompt Designer cutover**

```bash
git add LEAI/PromptDesigner.html LEAI/tests/promptdesigner-instructor-onboarding.test.js LEAI/tests/promptdesigner-instructor-routing.test.js
git commit -m "Route Prompt Designer through instructor home"
```

---

### Task 4: Add All courses and centralized sign-out destinations across instructor tools

**Files:**
- Modify: `LEAI/leai-shared.js`
- Modify: `LEAI/FeedbackAnalyzer.html`
- Modify: `LEAI/FeedbackChat.html`
- Modify: `LEAI/CourseBanner.html`
- Modify: `LEAI/Customizations.html`
- Create: `LEAI/tests/instructor-global-navigation.test.js`

**Interfaces:**
- Produces: consistent All courses navigation and post-sign-out destination.
- Consumes: `leaiInstructorAuth.instructorHomeHref()`.
- Preserves: explicit legacy login controls until each page's protected endpoints complete account-auth cutover.

- [ ] **Step 1: Write failing cross-page source tests**

For each instructor page, assert one visible `All courses` link to `InstructorHome.html`. In shared sign-out logic, assert backend revocation remains attempted for token sessions and the final destination is Instructor Home rather than Prompt Designer.

- [ ] **Step 2: Run navigation test and verify RED**

```bash
node --test LEAI/tests/instructor-global-navigation.test.js
```

- [ ] **Step 3: Add consistent links and sign-out routing**

Insert All courses in the same sidebar position on all four pages, using the existing sidebar classes and a Material/SVG home or grid icon consistent with each page. Update `leai-shared.js` to navigate to `InstructorHome.html` after account sign-out. Do not remove legacy login forms from pages whose backend reads/writes are not yet fully membership-authorized.

- [ ] **Step 4: Run navigation and existing frontend tests**

```bash
node --test LEAI/tests/*.test.js
```

Expected: every Node test passes. Record exact total.

- [ ] **Step 5: Commit global navigation**

```bash
git add LEAI/leai-shared.js LEAI/FeedbackAnalyzer.html LEAI/FeedbackChat.html LEAI/CourseBanner.html LEAI/Customizations.html LEAI/tests/instructor-global-navigation.test.js
git commit -m "Add instructor global navigation"
```

---

### Task 5: Real-browser acceptance and local release gate

**Files:**
- Create, gitignored: `.web-verify/knowledge/instructor-home.md`
- Create, gitignored: `.web-verify/screenshots/instructor-home-*.png`
- Create, gitignored: `scripts/build-verify-report-instructor-home.py`
- Create, gitignored: `verification-report-instructor-home-2026-09-10.html`
- Modify only task-owned source/tests if verification finds a defect.

**Interfaces:**
- Verifies frontend against the local Django backend with real database persistence and audit events.

- [ ] **Step 1: Start isolated local services**

Run Django from `/private/tmp/leai-question-set-wizard/backend` on port 8000 and the static frontend from `/private/tmp/leai-question-set-wizard/frontend` on an unused port. Before starting, verify no stale process owns either port with `lsof -i :8000` and `lsof -i :<frontend-port>`; stop only session-owned processes.

- [ ] **Step 2: Provision isolated test identities and data**

Use the existing `provision_leai_instructor` command against the local test database. Prepare separate zero-course and many-course accounts, with at least three active courses and one inactive membership excluded. Record expected row counts before interaction.

- [ ] **Step 3: Verify complete desktop flow in Chromium**

Use real click/type gestures to exercise signed out → temporary password → forced password setup → no-course empty state → create drawer validation → create course → Prompt Designer → All courses → switch course → Account display-name update → voluntary password change → sign out. Confirm no future-action placeholder appears.

- [ ] **Step 4: Verify accessibility and responsive flow**

At a mobile viewport, open/close navigation with trigger, Escape, and scrim; open the full-width create sheet; confirm no horizontal overflow. Use keyboard-only navigation for rail links, cards, forms, and drawer focus return. Check reduced-motion behavior.

- [ ] **Step 5: Repeat critical path in WebKit when available**

Repeat login, course selection, create drawer, Account save, All courses return, and sign out. If WebKit is unavailable, report that limitation explicitly rather than claiming multi-browser verification.

- [ ] **Step 6: Verify database and audit persistence exactly**

Compare final Course and CourseMembership counts to the expected increase. Query `InstructorAuditEvent` and confirm exactly one event per covered successful action, newest-first Admin ordering, no success event for rejected course creation, and no secret/student-content metadata.

- [ ] **Step 7: Generate the HTML verification report**

Build a self-contained report containing acceptance criteria, browser/viewport, real page URL, screenshots, exact database counts, audit-event summary, automated test commands, and PASS/FAIL per criterion.

- [ ] **Step 8: Run final repository gates**

Frontend:

```bash
node --test LEAI/tests/*.test.js
git diff --check
git status --short
```

Backend:

```bash
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py test datapipeline.tests --verbosity 1
uv run python manage.py check
git diff --check
git status --short
```

- [ ] **Step 9: Stop services and report the local boundary**

Stop every server started by this task and verify its port is free. Do not push, deploy, or migrate production. Report focused tests, full suites, browser engines, exact persisted counts, commit IDs, and the local report path separately.
