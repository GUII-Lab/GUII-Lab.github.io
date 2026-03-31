# LEAI Unified Instructor Dashboard — Design Spec

**Date:** 2026-03-30  
**Scope:** PromptDesigner.html + FeedbackAnalyzer.html  
**Status:** Approved

---

## Overview

Unify the two instructor-facing LEAI pages under a shared left sidebar so instructors can navigate between them without re-authenticating. Both pages remain separate URLs — no routing framework, no build step. The sidebar is duplicated in both files (copy-paste, consistent with the existing single-file HTML architecture).

---

## Auth

### Mechanism
- `sessionStorage` (not `localStorage`) stores the authenticated session per tab.
- Key stored: `leai_session` → `{ courseId, courseName }`
- On page load, each page reads `leai_session`. If present → show app. If absent → show login card.
- Sign Out clears `leai_session` and re-renders the login card without a full page reload.

### Login card — PromptDesigner
Two panels:
1. **Create new course** — course ID, course name, instructor name, password → `POST create_new_gpt/` (existing endpoint)
2. **Unlock existing course** — course ID, password → `POST verify_course_password/` (existing endpoint)

On success from either panel, store session and show the app.

### Login card — FeedbackAnalyzer
Single panel:
- **Unlock existing course** — course ID, password → `POST verify_course_password/`

On success, store session and show the app.

### Cross-page session
When an instructor is logged in and clicks a sidebar nav link, the destination page loads and reads `leai_session` from `sessionStorage`. Since it's present, the login card is skipped and the app renders immediately. No credentials are passed in the URL.

---

## Sidebar

### Structure (same in both files)
```
[collapse toggle]
LEAI                         ← label
cm150-sp26                   ← courseId from session

[pencil icon]  Prompt Designer    ← active if on PromptDesigner.html
[grid icon]    Feedback Analyzer  ← active if on FeedbackAnalyzer.html

─────────────────────────────
[logout icon]  Sign Out
```

### Desktop — expanded (default)
- Width: 220px, dark background (`#1e293b`)
- Collapse toggle button (hamburger/chevron icon) in the sidebar header
- Active page: highlighted row with blue tint (`rgba(59,130,246,0.2)`) + blue text (`#93c5fd`)
- Inactive page: muted white (`rgba(255,255,255,0.55)`)
- Sign Out at bottom, separated by a top border
- Smooth CSS transition on width change (`transition: width 0.2s ease`)

### Desktop — collapsed
- Width: 44px
- Only icons visible, labels hidden
- Active state preserved (icon highlighted)
- Tooltips on hover (`title` attribute) showing the nav item label
- Collapse state persisted in `localStorage` key `leai_sidebar_collapsed` so it survives page navigation

### Mobile (breakpoint: ≤ 768px)
- Sidebar hidden by default; no icon strip
- Top bar shown: dark background, hamburger icon (left) + "LEAI" wordmark
- Hamburger tap → sidebar slides in as an overlay drawer (width 220px, `position: fixed`, `z-index: 200`)
- Scrim (semi-transparent overlay) covers the rest of the page; tap scrim to close drawer
- CSS transition: `transform: translateX(-100%)` → `translateX(0)`

### Icons
Inline SVGs (no external icon library). Two icons needed:
- Prompt Designer: pencil/edit icon
- Feedback Analyzer: grid/dashboard icon
- Sign Out: arrow-right-from-bracket icon
- Collapse toggle: three-line hamburger (desktop), same icon for mobile top bar

---

## Page layout after sidebar

### PromptDesigner.html
- Remove `padding: 32px 24px` from `body`
- Sidebar + main content sit side-by-side in a flex row (`display: flex; height: 100vh`)
- Main content: `flex: 1; overflow-y: auto; padding: 32px 24px`
- Existing `.page-header`, `.layout`, `.card` structure unchanged inside main content

### FeedbackAnalyzer.html
- Remove current `.topbar` (course name + sign out live in sidebar now)
- Sidebar + main content in flex row
- Main content: `flex: 1; overflow-y: auto`
- Existing `.main`, tabs, stat-row, table-card structure unchanged inside main content

---

## Shared JS snippet (~35 lines)

Both pages include an identical inline JS block that handles:

1. **Session check** on `DOMContentLoaded` — show login or app
2. **Sign out** — clear `leai_session`, hide app, show login card
3. **Sidebar collapse toggle** — toggle CSS class, persist to `localStorage`
4. **Mobile hamburger** — toggle drawer open/close, bind scrim click to close
5. **Active nav highlight** — compare `window.location.pathname` to each nav href, add `.active` class

Navigation between pages uses plain `<a href="PromptDesigner.html">` / `<a href="FeedbackAnalyzer.html">` — no JS router.

---

## What does NOT change

- All existing API calls, endpoints, and data logic in both pages
- The student-facing `feedback.html` page — untouched
- `FeedbackGPTCreator.html` and `feedbackResponses.html` — untouched
- No external dependencies added (no npm, no frameworks)

---

## Out of scope

- Persistent login across browser closes (localStorage auth) — not needed, sessionStorage is sufficient
- A dedicated `/login` redirect page — inline login card per page is simpler and sufficient
- Canvas / LMS integration
