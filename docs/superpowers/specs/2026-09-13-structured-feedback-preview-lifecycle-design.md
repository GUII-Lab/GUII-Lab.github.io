# Structured Feedback Preview and Draft Lifecycle Design

## Goal

Make Structured Feedback self-service reliable on the QA deployment: instructors can always reach the Wizard actions, resume only their latest unfinished setup, prepare an enforced short preview, configure completion downloads per survey, and verify the exact student experience before publishing.

## Product language and entry points

All instructor-facing uses of “Structured Reflection” become “Structured Feedback.” The Prompt Designer tabs appear in this order: Structured Feedback, In-Group Feedback, General Course Feedback.

The Structured Feedback landing panel always offers **Create a new structured feedback**. When one unfinished Wizard draft exists, it additionally offers **Continue your previous session**. Published or abandoned drafts are not resumable.

Starting a new setup while an unfinished draft exists requires explicit confirmation. Confirmation marks the old workflow abandoned rather than deleting it, preserving audit and research provenance. The instructor API returns at most the newest active draft. Publishing marks that workflow completed.

## Wizard viewport behavior

The modal panel is bounded by the dynamic viewport. Header, steps, notices, and footer remain fixed within the panel; only the central content region scrolls. The footer is never behind or below the viewport, and its primary action remains reachable by pointer and keyboard at desktop, short desktop, tablet, and mobile heights.

## Backend-enforced preview preparation

After **Generate preview** on Edit, the saved draft is frozen into an immutable revision and a PreviewSession is created immediately. The backend assigns `ready_at` using a cryptographically safe random duration from 2.6 through 3.8 seconds after creation. The Wizard moves to Preview and displays a determinate preparation state while polling the backend.

The preview configuration endpoint returns a preparing response before `ready_at`; therefore opening the token URL directly cannot bypass preparation. No server worker sleeps. Once the backend clock reaches `ready_at`, the same capability serves the preview and the Wizard reveals its link.

## Per-preview completion settings

Each PreviewSession stores two booleans:

- `completion_certificate_enabled`, default `true`.
- `parsed_document_download_enabled`, shown as **Completion form**, default `false`.

The Preview step exposes both as accessible switches. Each label has a keyboard-accessible `?` help control explaining what students receive and when. Saving uses an authenticated, owner-checked endpoint. While saving, the affected switch is disabled. Success displays **Applied live** and tells the instructor to reload the already-open preview or open it again. Failure restores the last persisted value and gives a specific retry message.

These settings belong only to the exact preview and the survey published from it. They never mutate course defaults or another Question Set revision.

## Preview downloads

The student preview receives the two saved settings after reload. Completion form uses the same client-side DOCX generation path and the preview conversation data.

When certificate is enabled, the preview uses a preview-only PDF endpoint. It produces the real certificate layout with an obvious **Instructor preview - not valid** watermark. It creates no CompletionCertificate row, no verification code, and no public verification record. Normal published surveys continue to use the existing certificate issuance endpoint.

## Publication integrity

Publishing includes the exact preview token. The backend verifies that the preview belongs to the authenticated instructor, matches the requested revision, is ready, and completed the required conversation. It copies the two completion settings into the QuestionSetSurvey link. Public survey configuration reads these copied values rather than mutable course defaults.

Idempotent retries must match the same revision, actor, preview, and completion settings.

## Auditability

Audit events record active-draft abandonment, preview-setting changes, and publication. Metadata contains only operational booleans and identifiers, never preview answers or capability tokens.

## Verification

Automated coverage includes lifecycle replacement, readiness boundaries, authorization, setting rollback, publication copying, preview certificate non-persistence, copy/order changes, and footer layout contracts. Final verification uses real pointer and keyboard gestures on the deployed QA page at desktop and short-viewport sizes, completes a preview, toggles both settings, reloads the student preview, downloads DOCX and watermarked PDF, publishes, and confirms the published survey retains the selected settings.
