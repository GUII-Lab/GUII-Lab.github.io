# LEAI Instructor Home and Course Workspace — Design Spec

**Date:** 2026-09-10

**Status:** Direction approved; detailed spec awaiting review

**Scope:** New instructor home, centralized onboarding, course switching, course creation, and basic account settings

**Repositories:** `GUII-Lab.github.io` frontend plus the existing instructor-account API in `guiidatapipelines`

## 1. Decision

Replace the compact course picker embedded in `PromptDesigner.html` with a dedicated, wide-screen `InstructorHome.html`. This page becomes the global instructor workspace: instructors sign in, finish a required first password change, see all courses, create a course, switch courses, update basic account settings, and sign out there.

Course tools such as Prompt Designer and Feedback Analyzer remain separate, course-scoped pages. They gain a clear **All courses** route back to Instructor Home. The design is inspired by the scale and clarity of an LMS dashboard, but it stays visually consistent with LEAI and does not introduce Canvas integration.

This establishes the correct information architecture for later course rollover, course duplication, cross-course question-set/schema copying, collaborators, and notifications without pretending those capabilities exist today.

## 2. Why this boundary

The current onboarding implementation makes four different jobs share one small card inside Prompt Designer:

1. account authentication;
2. forced initial password change;
3. course selection and creation;
4. entry into a course-authoring tool.

That structure works as an authentication proof, but it makes a course feel like a login choice rather than a durable workspace. It also leaves no natural home for account settings or operations involving two courses.

The new boundary is:

```text
Instructor account
└── Instructor Home (global scope)
    ├── Courses
    │   ├── Course A → course-scoped LEAI tools
    │   ├── Course B → course-scoped LEAI tools
    │   └── Create course
    └── Account
        ├── Profile
        ├── Password
        └── Sign out
```

Any action that affects more than one course belongs in Instructor Home. Any action that edits one selected course belongs in that course's tools.

## 3. Goals

- Give instructors a dashboard-sized, credible home for managing multiple courses.
- Make first-time onboarding and repeat course entry understandable without Harvey's manual guidance.
- Let an authenticated instructor create another course and continue directly into course setup.
- Make switching from one course to another explicit and safe.
- Provide functional personal settings for display name and password while email remains administrator-managed.
- Preserve the additive identity and membership schema already implemented; this UI slice must not require a destructive database migration.
- Create clean extension points for future rollover, duplicate, archive, collaborator, and schema-copy actions.

## 4. Non-goals for this slice

- Canvas, LTI, roster, gradebook, or LMS integration.
- Email verification, password-reset email, reminders, or browser notifications.
- Course duplicate, rollover, archive, ownership transfer, or deletion.
- Cross-course question-set or FormSchema copying.
- Course-level activity feeds, response totals, or fabricated dashboard analytics.
- The full first-survey Wizard, QuestionSet schema redesign, or ResponseSession migration.
- Student-facing changes.

Future actions are documented here for placement and API planning, but the UI must not show disabled menu items or controls that do nothing.

## 5. Primary user flows

### 5.1 Returning instructor

```text
InstructorHome.html
→ restore valid instructor session
→ fetch account and active course memberships
→ render course dashboard
→ select course card
→ store selected course in leai_session
→ open PromptDesigner.html
```

The previously selected course may be marked **Current**, but Instructor Home always shows the complete active course list rather than bypassing the dashboard.

### 5.2 First sign-in with a temporary password

```text
sign in
→ backend returns must_change_password
→ full-page password setup state
→ change password using existing endpoint
→ refresh account
→ course dashboard
```

The password setup state cannot be skipped. The current password remains in memory only long enough to complete this required transition and is never persisted.

### 5.3 Instructor with no courses

After authentication, the Courses view shows a substantial empty state explaining what a course contains and one primary **Create your first course** action. It does not automatically open a small form or imply that account creation failed.

### 5.4 Create another course

From the Courses view, **Create course** opens a right-side drawer on desktop and a full-width sheet on mobile. Required fields are:

- institution, selected from active institution memberships;
- course name;
- course ID, with lowercase-letter/number/hyphen validation and a suggestion derived from the course name;
- instructor name shown for the course, prefilled from the account display name.

On success, the course is selected and the instructor enters Prompt Designer. When the first-survey Wizard ships, this same success transition will route a course with no setup progress into that Wizard; the course-creation contract does not need to change.

### 5.5 Switch course

Every course-scoped instructor page adds **All courses** near the course identity in its sidebar. Activating it returns to Instructor Home without signing out. Selecting a different card replaces only `courseId` and `courseName` in the existing session object; the instructor token and account fields remain.

### 5.6 Account settings

The Account view is a full main-panel view, not a modal. It provides:

- editable display name;
- read-only email address;
- a neutral explanation that email is currently administrator-managed;
- authentication provider and verification state as informational metadata;
- a functional change-password form requiring current password, new password, and confirmation;
- sign out.

Updating the account display name changes the account profile and the default instructor name for future courses. It does not silently rewrite historical `Course.instructor_name` values.

## 6. Page and navigation design

### 6.1 Signed-in desktop shell

The page uses the full viewport and has two regions:

- **Navigation rail:** approximately 232 px, using the existing dark LEAI sidebar language. It contains the LEAI mark, **Courses**, **Account**, **Instructor guide**, and a bottom account/sign-out area.
- **Main canvas:** a soft neutral background with a centered content width up to approximately 1280 px and generous 32–48 px spacing.

Only working destinations are rendered. **Courses** is the default and visually selected. **Account** switches the main view without leaving the page. **Instructor guide** links to the existing guide.

This is Canvas-like in spatial confidence and navigation clarity, not a visual copy of Canvas.

### 6.2 Courses view

The header contains:

- greeting using the instructor display name;
- a short sentence explaining that a course opens its feedback workspace;
- a primary **Create course** button.

Courses render in a responsive grid. Each card includes:

- course name as the strongest label;
- course ID;
- institution name when it can be resolved from the account payload;
- membership role;
- **Current** marker when it matches the selected course;
- one clear **Open course** affordance, with the whole card keyboard-operable.

Cards do not show response counts or recent activity until a dedicated summary API exists. They also do not show a three-dot menu until at least one real secondary course action ships.

### 6.3 Future course actions

The card component and backend authorization model should allow a secondary action menu later. Expected placement is the card's top-right corner, with actions enabled according to membership role and capability flags. Candidate actions, in likely delivery order, are:

1. start a new term from this course;
2. duplicate selected question sets into another course;
3. archive course;
4. manage instructors and TAs;
5. transfer ownership.

These are architectural extension points only. No placeholder controls appear in the first release.

### 6.4 Create-course drawer

The drawer keeps the dashboard visible behind it so instructors retain context. It has a descriptive title, short helper text, inline field validation, Cancel, and **Create and continue**. Closing an unsubmitted drawer loses only local form input and never mutates server state.

If creation fails, the drawer stays open, preserves the entered values, and displays a specific error for duplicate course ID or lost institution access.

### 6.5 Signed-out and forced-password states

Authentication still lives at `InstructorHome.html`, but it should no longer look like a picker card embedded in another product screen. The signed-out state uses a focused, professional panel with enough page context to explain LEAI and link to the Instructor Guide.

The forced-password screen uses the same shell and page scale so the transition into the dashboard feels continuous.

### 6.6 Mobile behavior

- The navigation rail becomes a top bar plus accessible drawer.
- Course cards become one column.
- The create-course drawer becomes a full-width sheet.
- Primary actions remain reachable without horizontal scrolling.
- Account and password forms remain single-column.

## 7. Routing and session rules

The existing `sessionStorage` key `leai_session` remains the single frontend session record. It can represent an authenticated instructor before course selection:

```json
{
  "instructorToken": "...",
  "instructorSessionExpiresAt": "...",
  "instructorEmail": "...",
  "instructorDisplayName": "...",
  "mustChangePassword": false,
  "courseId": "optional",
  "courseName": "optional"
}
```

Rules:

- A valid instructor token is sufficient to render Instructor Home.
- A valid token plus an authorized `courseId` is required for a membership-owned course tool.
- Instructor Home refreshes account and course membership data from `GET /instructor_me/`; it does not trust a stale locally stored course list.
- Selecting a card persists the selected course and routes to Prompt Designer.
- Returning to Instructor Home does not clear the selected course.
- Signing out revokes the current backend session, clears `leai_session`, and renders the signed-out state.
- An expired or revoked token is cleared and returns the user to the signed-out state with a session-expired message.
- During the additive migration, already-open legacy course-ID/password sessions remain supported on the existing course pages. They do not gain access to the account dashboard.

Instructor pages should share redirect/session helpers through `leai-instructor-auth.js`; they should not each reimplement the rules.

## 8. Backend/API impact

The dashboard reuses the implemented endpoints:

- `POST /api/instructor_sessions/`
- `DELETE /api/instructor_sessions/current/`
- `GET /api/instructor_me/`
- `POST /api/instructor_password/`
- `GET /api/instructor_courses/`
- `POST /api/instructor_courses/`

One additive API capability is required for a useful account screen:

- `PATCH /api/instructor_me/` with `{ "display_name": "..." }`.

Validation: trim whitespace, require 1–100 characters, reject unknown fields, require a valid instructor session, and reject changes while `must_change_password` is true. The response is the same serialized account shape as GET. No database migration is required because `InstructorAccount.display_name` already exists.

For institution display names on course cards, the frontend joins each course's `institution_slug` to the existing `institutions` array returned by `instructor_me`. No duplicated backend field is required.

## 9. Relationship to the data-schema and Wizard roadmap

This work intentionally precedes the QuestionSet/FormSchema restructure because it changes no survey-response data and gives the later Wizard a stable entry point.

Recommended order remains:

```text
Instructor identity foundation (implemented)
→ Instructor Home and global navigation (this spec)
→ authorize remaining legacy instructor endpoints
→ occurrence-scoped ResponseSession migration
→ immutable QuestionSet drafts and revisions
→ isolated student preview
→ template-first first-survey Wizard
→ recurrence, stable links, and notices
```

The create-course success handler should be isolated in one function so the Wizard can later replace `open Prompt Designer` with `begin setup` for new courses. Instructor Home should not encode FormSchema or QuestionSet assumptions before those models are settled.

Cross-course schema migration and course duplicate depend on immutable QuestionSet/FormSchema lineage. Their controls therefore belong in the future dashboard, but implementation must wait until the schema redesign defines exactly what is copied, referenced, or version-pinned.

## 10. Accessibility and interaction requirements

- All navigation and course cards are reachable and activatable by keyboard.
- Visible focus states use LEAI tokens and meet contrast requirements.
- Navigation uses landmarks and an explicit current-page state.
- The drawer traps focus while open, closes with Escape, restores focus to its trigger, and has an accessible title.
- Loading, empty, error, and success states are announced without relying on color alone.
- Forms have persistent labels, field-level errors, and a summary message when submission fails.
- Destructive future actions will require explicit confirmation; none exist in this slice.
- Reduced-motion preferences disable nonessential drawer and card transitions.

## 11. Error and edge-case behavior

- **No institution membership:** show a blocking explanation that an administrator must assign an institution; do not render a broken create form.
- **Course removed while selected:** refresh membership data, clear the selected course fields, and show the dashboard notice.
- **Duplicate course ID:** keep the drawer open and focus the course-ID error.
- **Network failure:** preserve local form values and offer Retry.
- **Expired session during a write:** clear auth, return to sign-in, and do not claim the write succeeded.
- **Multiple institutions:** require explicit institution selection and remember it only within the open drawer.
- **Long course names/IDs:** wrap names, truncate only secondary metadata, and preserve full values for assistive text.
- **Zero, one, or many courses:** use the same page structure; do not introduce one-course auto-redirect behavior.

## 12. Implementation boundaries

### Frontend

- Add `LEAI/InstructorHome.html` using the existing Tailwind CDN, `leai-shared.css`, version script, and vanilla JavaScript conventions.
- Extend `leai-instructor-auth.js` with profile update and centralized course-selection/redirect helpers.
- Remove the account onboarding/course picker UI from `PromptDesigner.html`; preserve only the selected-course application.
- Add **All courses** to the shared instructor sidebar markup on course-scoped pages.
- Route authentication/session failures from membership-owned flows to Instructor Home.
- Do not add a framework, bundler, or new runtime dependency.

### Backend

- Add `PATCH instructor_me` with validation and tests.
- Do not add or alter database fields for this slice.
- Preserve legacy course authentication during the planned additive cutover.

## 13. Verification and acceptance criteria

Automated coverage must prove:

- sign-in and forced password change lead to Instructor Home;
- a valid authenticated session can exist with no selected course;
- only active course memberships render;
- selecting a course preserves the instructor token and updates course fields;
- create-course success creates exactly one course and one owner membership, then opens it;
- duplicate IDs and institution authorization errors preserve the form;
- display-name update validates and persists without modifying historical course names;
- password change works from Account and keeps the current session valid;
- sign out revokes the session;
- expired sessions return to sign-in;
- legacy course sessions remain usable during cutover.

Browser verification must exercise the real static pages against the local Django backend with real clicks and typing in Chromium and WebKit when available. Required visual states are signed out, forced password change, no-course empty state, many-course grid, create drawer with validation, Account, course selection, **All courses** return, mobile navigation, and sign out. Produce a scoped HTML report with screenshots.

Before completion, run the full frontend and backend test suites, `git diff --check`, migration drift checks, and a production-safety review. Do not deploy or run a production migration as part of this feature without separate approval.

## 14. Success definition

An instructor with a manually provisioned account can sign in, choose a permanent password, understand where their courses live, create a first or additional course, enter its Prompt Designer, return to all courses, switch courses, edit their display name, change their password, and sign out without Harvey walking them through the interface.

The resulting page is also the stable product surface where later rollover and cross-course reuse can be added after the data-schema work, without redesigning authentication or course selection again.
