# StudyCrafter Pitch — Presenter Pack

Five-minute pitch for the StudyCrafter team meeting. Position: LEAI as a sibling tool to StudyHelper. Goal: let teachers self-select interest. Author: Jiahong (Harvey) Li. Date: 2026-05-06.

## Files

- **`studycrafter-pitch.pptx`** — the actual deck. Drag it into Google Drive and double-click; it opens in Google Slides natively. Edit fonts/positions there if needed.
- `script.md` — verbatim spoken script. ~600 words, ~5 minutes at 120 wpm. Read aloud as written; square brackets are stage cues, not spoken words.
- `slides.md` — text source for the deck (slide titles, on-slide copy, image references). Edit this if you want to regenerate the .pptx.
- `build_deck.py` — script that generates `studycrafter-pitch.pptx` from the screenshots in `LEAI/guide-assets/` and `LEAI/student-guide-assets/`. Run with `uv run --with python-pptx --with pillow python build_deck.py` from this directory.

## Asset checklist

All image paths referenced from `slides.md` must exist before the talk. Verify:

```bash
cd <repo root>
for f in \
  LEAI/guide-assets/test-f1-f2-survey-list.png \
  LEAI/guide-assets/test-f11-edit-modal.png \
  LEAI/guide-assets/pd-form-mode.png \
  LEAI/guide-assets/feedback-consent-modal.png \
  LEAI/guide-assets/chat-new-session.png \
  LEAI/guide-assets/feedback-header-anonymity.png \
  LEAI/student-guide-assets/group-team-select.png \
  LEAI/student-guide-assets/mic-recording.png \
  LEAI/guide-assets/feedback-form-mode.png \
  LEAI/guide-assets/analyzer-quicktake.png \
  LEAI/guide-assets/analyzer-keyness.png \
  LEAI/guide-assets/analyzer-ngram-clickthrough.png \
; do
  test -f "$f" && echo "OK: $f" || echo "MISSING: $f"
done
```

If `pd-form-mode.png` or `feedback-form-mode.png` is missing, regenerate with:

```bash
python3 -m http.server 8181 &  # in a separate terminal
node LEAI/screenshots/capture-form-mode.mjs
```

## At presentation time

1. Drag `studycrafter-pitch.pptx` into Google Drive and open in Google Slides. Adjust spacing or fonts if anything looks off — the build script aims for a clean default but Google Slides may render text wrapping slightly differently than PowerPoint.
2. Open `script.md` on your phone or a second monitor. Read it aloud during the talk. Stage cues in `[brackets]` are for you, not the audience.
3. Total target: 5 minutes flat. If you are running long, trim slide 5's design-rationale paragraph first.

## Regenerating the deck

If you change a screenshot or want to tweak the layout, edit `build_deck.py` and re-run:

```bash
cd LEAI/docs/studycrafter-pitch
uv run --with python-pptx --with pillow python build_deck.py
```

## Source spec

`docs/superpowers/specs/2026-05-06-leai-studycrafter-pitch-design.md`
