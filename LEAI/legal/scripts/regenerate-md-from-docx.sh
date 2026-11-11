#!/usr/bin/env bash
# Regenerate the .md files that the live LEAI legal pages render, using the
# canonical .docx files as ground truth.
#
# Workflow:
#   1. Edit LEAI-Privacy-Policy.docx and/or LEAI-Terms-of-Use.docx in Word.
#   2. Run this script (from any directory).
#   3. Commit the updated docx + md files together.
#
# Requires: pandoc (https://pandoc.org/)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LEGAL_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if ! command -v pandoc >/dev/null 2>&1; then
  echo "error: pandoc is not installed. Install it with 'brew install pandoc' on macOS." >&2
  exit 1
fi

convert () {
  local docx="$1"
  local md="$2"
  if [[ ! -f "$docx" ]]; then
    echo "error: missing source file $docx" >&2
    exit 1
  fi
  pandoc \
    --from docx \
    --to gfm \
    --wrap=none \
    --shift-heading-level-by=0 \
    --output "$md" \
    "$docx"
  echo "wrote $md"
}

convert "$LEGAL_DIR/LEAI-Privacy-Policy.docx" "$LEGAL_DIR/privacy.md"
convert "$LEGAL_DIR/LEAI-Terms-of-Use.docx"   "$LEGAL_DIR/terms.md"

echo "done."
