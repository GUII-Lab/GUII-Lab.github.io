#!/usr/bin/env bash
# Start the LEAI front-end (static) + back-end (Django) for local playtesting.
#
# Front-end: python -m http.server 8080 — `leai-shared.js` auto-routes API
# calls to localhost:8000 when served from localhost (no edits needed).
# Back-end: Django dev server on :8000 with CORS open + DEBUG=True.
#
# Required for the features you just implemented:
#   F1–F4  — backend serves /openai-chat/, /message/, /feedbackList/, etc.
#   F5     — /openai-chat/ proxies the insights generation
#   F6     — /getOAI/ exposes the OpenAI key for direct browser TTS
#   F3     — /team_configurations/, /survey_team_snapshot/, /session_team_assignment/
#
# Usage:
#   export oaiKey=sk-...                # required for F5/F6 + chat
#   ./scripts/dev-up.sh                 # starts both, tails logs
#   Ctrl-C                              # stops both cleanly

set -euo pipefail

FRONTEND_DIR="/Users/harveyli/Documents/GitHub/GUII-Lab.github.io"
BACKEND_DIR="/Users/harveyli/Documents/GitHub/guiidatapipelines"
FRONTEND_PORT=8080
BACKEND_PORT=8000
LOG_DIR="/tmp/leai-dev"
mkdir -p "$LOG_DIR"

# ── Sanity checks ──────────────────────────────────────────────────────────
if [[ -z "${oaiKey:-}" ]]; then
  echo "⚠️  oaiKey env var is not set."
  echo "   F5 (insights via /openai-chat/) and F6 (TTS via /getOAI/) will fail."
  echo "   Run:  export oaiKey=sk-...    then re-run this script."
  echo "   Continuing anyway in 3s — Ctrl-C to abort."
  sleep 3
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ uv not found. Install: brew install uv"
  exit 1
fi

# ── Free the ports if a previous run is still bound ────────────────────────
for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "↻  Port $port is busy — killing $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done

# ── Backend: Django on :8000 ───────────────────────────────────────────────
echo "→ Starting Django backend on :$BACKEND_PORT  (logs: $LOG_DIR/backend.log)"
(
  cd "$BACKEND_DIR"
  # Reuse the existing venv if present; otherwise create one with uv.
  if [[ -d .venv ]]; then
    source .venv/bin/activate
  else
    uv venv .venv
    source .venv/bin/activate
    uv pip install -r requirements.txt
  fi
  # Apply any pending migrations against the local sqlite DB.
  python manage.py migrate --noinput >/dev/null
  exec python manage.py runserver "0.0.0.0:$BACKEND_PORT"
) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# ── Frontend: static file server on :8080 ──────────────────────────────────
echo "→ Starting front-end on :$FRONTEND_PORT  (logs: $LOG_DIR/frontend.log)"
(
  cd "$FRONTEND_DIR"
  exec python3 -m http.server "$FRONTEND_PORT"
) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# ── Wait for both to bind, then print URLs ─────────────────────────────────
sleep 2
if ! lsof -ti :"$BACKEND_PORT" >/dev/null 2>&1; then
  echo "❌ Backend failed to start. Last 30 log lines:"
  tail -30 "$LOG_DIR/backend.log"
  kill $FRONTEND_PID 2>/dev/null || true
  exit 1
fi
if ! lsof -ti :"$FRONTEND_PORT" >/dev/null 2>&1; then
  echo "❌ Front-end failed to start. Last 30 log lines:"
  tail -30 "$LOG_DIR/frontend.log"
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi

cat <<EOF

✅ Both servers running.

   PromptDesigner    : http://localhost:$FRONTEND_PORT/LEAI/PromptDesigner.html
   FeedbackChat      : http://localhost:$FRONTEND_PORT/LEAI/FeedbackChat.html
   FeedbackAnalyzer  : http://localhost:$FRONTEND_PORT/LEAI/FeedbackAnalyzer.html
   Form-mode survey  : http://localhost:$FRONTEND_PORT/LEAI/feedback.html?id=<SURVEY_ID>&form=hci271-week6-reflection
   Team form-mode    : http://localhost:$FRONTEND_PORT/LEAI/feedback.html?id=<SURVEY_ID>&form=hci271-week6-reflection&team=team-1&team_name=Coyote

   Backend API base  : http://localhost:$BACKEND_PORT/datapipeline/api/
   Logs              : $LOG_DIR/backend.log   $LOG_DIR/frontend.log

   Tail both logs:    tail -f $LOG_DIR/*.log
   Stop:              Ctrl-C  (or:  kill $BACKEND_PID $FRONTEND_PID)

EOF

# ── Trap Ctrl-C and tear both down cleanly ─────────────────────────────────
cleanup() {
  echo ""
  echo "↻  Stopping servers…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  echo "✓ stopped."
  exit 0
}
trap cleanup INT TERM

# ── Tail both logs to this terminal until interrupted ──────────────────────
tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
