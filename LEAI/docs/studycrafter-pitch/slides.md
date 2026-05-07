# LEAI Pitch — Slide Content for Google Slides

Each block below is one slide. Copy the title and on-slide text into Google Slides. Drag the listed images from the noted paths.

Image paths are relative to the repo root.

---

## Slide 1 — What is LEAI

**On-slide text:**
- Title: **LEAI — Learning Experience AI**
- Subtitle: A sibling lab tool to StudyHelper. StudyHelper helps students learn. LEAI listens to how it went.
- Three labels arranged left-to-right with arrows between them: **PromptDesigner → FeedbackCollector → FeedbackAnalyzer**

**Images:** none (text-only title slide). Optional: a faint background mark from the LEAI logo if available.

**Presenter cue:** Open with the sibling-tool framing. Do not enumerate features yet.

---

## Slide 2 — Instructor sets up a survey

**On-slide text:**
- Title: **Set up a survey in minutes**
- Three short lines: *Pick a template. Write the bot's voice. Share a link.*
- Caption near the mode-tab thumbnail: *Three modes: Free-Form · In-Group · Structured Reflection*

**Images:**
- Main: `LEAI/guide-assets/test-f1-f2-survey-list.png` (survey list)
- Inset: `LEAI/guide-assets/test-f11-edit-modal.png` (edit modal)
- Small thumbnail showing the mode-tab bar: cropped from `LEAI/guide-assets/pd-form-mode.png` (top region of the panel)

**Presenter cue:** Three modes get named here, but do not explain them yet. Slide 3 covers default; slide 4 covers Structured Reflection.

---

## Slide 3 — Student conversation (default mode)

**On-slide text:**
- Title: **What students experience**
- Four capability tags arranged in a 2×2 grid: **Conversational · Anonymous · Group-aware · Voice-input**

**Images:**
- Main left: `LEAI/guide-assets/feedback-consent-modal.png`
- Main right: `LEAI/guide-assets/chat-new-session.png`
- Three small thumbnails along the bottom: `LEAI/guide-assets/feedback-header-anonymity.png`, `LEAI/student-guide-assets/group-team-select.png`, `LEAI/student-guide-assets/mic-recording.png`

**Presenter cue:** Highlight the conversational depth as the differentiator vs a static form.

---

## Slide 4 — Structured Reflection (form mode)

**On-slide text:**
- Title: **Structured Reflection — when every section must be answered**
- Three short labeled lines:
  - **What:** AI walks every section in order.
  - **Why:** When you need every section answered — for example, a graded team reflection.
  - **How:** Instructor picks a schema in Prompt Designer. Student sees a normal chat.

**Images:**
- Left: `LEAI/guide-assets/pd-form-mode.png` (instructor side, schema picker)
- Right: `LEAI/guide-assets/feedback-form-mode.png` (student side, mid-walkthrough)

**Presenter cue:** Introduce as the alternative to default chat. Avoid engineering vocabulary.

---

## Slide 5 — Instructor sees insights

**On-slide text:**
- Title: **From conversations to insights**
- Three layer labels: **Quicktake · Keyness · Raw responses**
- One short paragraph below the images:
  > *Free-form chat is rich but messy. We did not want instructors to trust one black-box summary. The analyzer combines an AI summary, a statistical view of distinctive words, and one click into the actual student words. Three views, so you can triangulate.*
- Closing micro-line at the bottom right of the slide: *More at LEAI/instructor-guide.html*

**Images:**
- Left: `LEAI/guide-assets/analyzer-quicktake.png`
- Right: `LEAI/guide-assets/analyzer-keyness.png`
- Small thumbnail bottom-center: `LEAI/guide-assets/analyzer-ngram-clickthrough.png`

**Presenter cue:** Spend slightly longer on the design rationale paragraph. End softly — no hard adoption ask.
