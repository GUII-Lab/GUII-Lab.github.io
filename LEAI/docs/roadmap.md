# LEAI Feature Roadmap

Last updated: 2026-03-31

## Priority Levels

| Level | Meaning |
|-------|---------|
| P0 | Critical — blocks basic usability or data integrity |
| P1 | High — directly promised to the fellowship, or instructors ask for it |
| P2 | Medium — quality-of-life improvement, extends the platform |
| P3 | Low — nice to have, deferred until core is stable |

## Fellowship Commitment Key

Features marked **[F]** were explicitly committed to in the Department Innovation Fellowship application (Spring 2026). These carry additional delivery obligation beyond normal product priority.

---

## Feature List

| # | Feature | Priority | Fellowship | Status | Description | Justification |
|---|---------|----------|------------|--------|-------------|---------------|
| 1 | Survey expiration (auto 2-week default) | P0 | | Planned | Each survey automatically expires 2 weeks after creation. The expiration date is displayed prominently to instructors in the survey list. Instructors can override the date at creation time or edit it later. | Prevents stale surveys from collecting responses after the relevant course week has passed. Without this, a student clicking an old link from a prior term could still submit feedback, contaminating the dataset. A 2-week window matches the rhythm of weekly/biweekly feedback collection observed in current use. |
| 2 | Manual close / reopen surveys | P0 | | Planned | Instructors can close a survey immediately from the survey list (overriding the expiration) or reopen a closed survey. Closed surveys display a lock icon in the instructor view. | Instructors need to close surveys early when class ends, during exam weeks, or when they have enough responses. They also need to reopen if the initial window was too short. This is the minimum control flow needed for responsible deployment. |
| 3 | Student view: closed / expired state | P0 | | Planned | When a student visits a survey link that is closed or expired, the feedback.html page shows a clear "This survey is no longer accepting responses" message instead of loading the chat. The message includes the course name and the reason (expired vs. manually closed). | Without this, students who visit an old link are silently dropped into a broken or unintended session. A clear closed state prevents confusion and protects data quality. |
| 4 | Instructor configuration layer: feedback themes and timing | P1 | [F] | Planned | Instructors can tag each survey with structured feedback themes (e.g., assignment clarity, pacing, collaboration) and a timing category (mid-quarter, milestone-based, post-project). These tags are used to organize surveys in the dashboard and filter responses in the Feedback Analyzer. | Directly committed in the fellowship application under "Instructor Configuration Layer." The application describes theme and timing configuration as a core deliverable. Without this, the system is a free-form prompt tool rather than a configurable instructional infrastructure. |
| 5 | Anonymity and reporting structure controls | P1 | [F] | Planned | A per-survey toggle for anonymous vs. pseudonymous mode. In anonymous mode (default), sessions use random IDs with no linkage. In pseudonymous mode, students enter an optional identifier (student ID or alias) at the start of the session. The reporting structure setting controls whether the Feedback Analyzer shows individual session detail or only aggregated themes. | Explicitly listed in the fellowship application under "Instructor Configuration Layer" as an anonymity and reporting structure control. Instructors in different courses have different norms around student privacy; this should be configurable per survey, not globally. |
| 6 | Group reflection mode | P1 | [F] | Planned | A new survey type for in-group structured retrospectives. A group shares a single session link; the bot facilitates reflection on collaboration, coordination, and project-based friction points. Each participant contributes turns in the same conversation. The instructor view shows group sessions separately from individual sessions. | Committed as a major new feature in the fellowship application: "This fellowship will also support the introducing of a new dedicated group reflection mode." CM capstone courses rely heavily on collaborative production. This mode addresses a gap that standard individual surveys cannot fill. |
| 7 | Feedback Analyzer: theme summarization | P1 | [F] | Partial | The Feedback Analyzer surfaces recurring themes across responses for a given survey, presents representative student language per theme, and highlights emerging friction areas (topics mentioned frequently with negative sentiment). | Directly committed under "Instructor Insight Dashboard" in the fellowship application. The current Analyzer shows raw conversations; theme summarization is what transforms it from a transcript viewer into an actionable instructional tool. |
| 8 | Response count display on survey list | P1 | | Planned | The instructor survey list shows how many students have responded to each survey (distinct session count). Updated on page load and refreshable. | Instructors currently have no way to know if any students have submitted responses without going to the Feedback Analyzer. A response count on the survey list gives them a fast signal without context switching, and helps them decide whether to extend or close a survey. |
| 9 | Onboarding templates and documentation | P1 | [F] | Partial | A set of 3-4 pre-filled prompt templates based on common CM course use cases (weekly lecture feedback, milestone check-in, end-of-course reflection, group retrospective). Documentation covering setup, sharing links, reading the Analyzer, and troubleshooting. | The fellowship timeline explicitly allocates Week 12 to "documentation, onboarding templates, and summative report." The Prompt Designer's Guided Builder partially addresses this, but formal templates and written documentation are a separate deliverable needed for department-wide adoption. |
| 10 | Survey scheduling (future open date) | P2 | | Planned | Instructors can set an optional "opens on" date for a survey. The survey link is shareable immediately but the chat is locked until the scheduled date. Students see a "This survey opens on [date]" message before the open date. | Instructors often prepare surveys in advance and want to distribute links before the week begins without students being able to respond early. Scheduling removes the need to remember to manually open a survey. |
| 11 | Duplicate / clone a survey | P2 | | Planned | A "Duplicate" button on each survey in the list creates a copy with the same prompt, label prefixed with "Copy of", and a new expiration window. The clone is immediately editable. | Instructors reuse prompt structures across weeks (as seen in the Advanced Programming example prompts). Cloning saves significant rewriting time and reduces prompt inconsistency across a course. |
| 12 | Edit existing survey prompt | P2 | | Planned | Instructors can edit the system prompt of an existing survey after creation. Edits take effect for all future conversations on that survey link (existing conversation history is not affected). A warning is shown if any responses already exist. | Instructors often discover phrasing issues or missing topics after sharing a survey link. Currently, they must create a new survey and share a new link, breaking continuity. |
| 13 | Canvas LMS integration | P2 | | Planned | Instructors can generate a Canvas assignment link that wraps the survey URL, allowing Canvas to record completion via a simple completion webhook or by showing students a completion code to enter into Canvas. | The fellowship application notes the system must support broad departmental adoption. Canvas is the LMS used across CM courses. Even a lightweight completion-code approach removes the friction of instructors manually tracking participation. |
| 14 | Export all responses for a survey | P2 | | Planned | From the survey list, a "Download responses" button exports all conversations for a survey as a CSV or JSON file. Each row is a message with session ID, timestamp, role, and content. | Instructors need to archive data at the end of a course, share it with research collaborators, or analyze it in external tools. The Feedback Analyzer covers basic in-app analysis but does not replace bulk data export for research or course record purposes. |
| 15 | Response rate and engagement metrics | P2 | | Planned | The instructor survey list shows per survey: response count, average conversation length (turns), and average session duration. A colored indicator shows relative engagement. | Instructors want to know not just that students responded, but whether they gave substantive feedback. A 1-turn session likely means the student typed one word and left. These metrics help instructors identify low-engagement surveys and adjust prompts. |
| 16 | Mobile-optimized student view | P3 | | Planned | Responsive layout improvements to feedback.html for small screens: larger tap targets, better textarea sizing, sticky send button. | Students may use phones to complete surveys between classes. Current layout is functional but not optimized for mobile. Lower priority than core functionality improvements. |

---

## Fellowship Deliverable Summary

The following table maps fellowship commitments from the application directly to roadmap features.

| Fellowship Commitment | Roadmap Features | Notes |
|----------------------|-----------------|-------|
| Instructor Configuration Layer (themes, timing, individual/group, anonymity) | #4, #5, #6 | Group mode is the largest new build; themes/timing are additions to existing PromptDesigner |
| Student Interaction Layer — Individual | Existing (feedback.html) | Core is deployed; needs expiration (#1-3) and anonymity (#5) |
| Student Interaction Layer — Group Reflection Mode | #6 | Not yet started; highest-effort new feature |
| Instructor Insight Dashboard (themes, student language, friction) | #7 | FeedbackAnalyzer exists but lacks summarization |
| Onboarding templates and documentation | #9 | Partial: Guided Builder handles prompts; formal docs are separate |
| Pilot in at least one CM course (Weeks 3-11) | All P0 and P1 features | Pilot requires at least #1-3 and #7 to be credible |
| Summative report (Week 12) | #9 | Deliverable outside the codebase |
