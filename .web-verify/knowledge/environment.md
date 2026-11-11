# Environment

- **Dev server**: `python3 -m http.server 8080` from repo root (usually already running on :8080).
- **LEAI API base auto-switch**: `leai-shared.js` routes to `http://localhost:8000/datapipeline/api` when `window.location.hostname` is `localhost` or `127.0.0.1`; otherwise Heroku. To exercise live API calls from a local browser, run the `guiidatapipelines` Django backend on :8000.
- **Playwright MCP screenshots**: must be saved inside the repo (e.g. `.web-verify/screenshots/…`). `/tmp/web-verify` is outside the allowed roots and is rejected.
- **Stale MCP Chrome**: if `browser_navigate` errors with "Browser is already in use", kill stragglers with `pkill -f "user-data-dir=.*ms-playwright/mcp-chrome"` and retry.
- **Cache busting**: the Playwright-driven Chrome caches HTML aggressively between test runs on the same URL. After editing PromptDesigner/feedback.html/FeedbackAnalyzer, append a cache-bust query (`?v=N`) in `browser_navigate` or re-verify that the updated code is loaded via `document.scripts` text check before relying on DOM assertions.
- **Django `--noreload`**: when the local Django server is started with `python manage.py runserver 8000 --noreload`, code edits to `views.py` (or anything else in the package) are NOT picked up. Before verifying a backend change live, check `ps aux | grep runserver`; if `--noreload` is present, restart the server so your edit is actually running. Django unit tests use a fresh import and will pass against the new code even when the live server is still serving the old code.
- **Local Django uses Postgres, not sqlite**: `guiidatapipelines/settings.py` has `ENGINE: postgresql_psycopg2, NAME: ciba`. The `db.sqlite3` file sitting in the repo is legacy cruft from before the Postgres switch — Django does not open it. To inspect what was actually persisted, use `psql -d ciba` (e.g. `psql -d ciba -c "SELECT * FROM datapipeline_feedbackmessage ORDER BY id DESC LIMIT 10;"`). All 21 datapipeline migrations are applied; the schema is complete. Do NOT diagnose "missing tables" from the repo sqlite file — it's a red herring.
- **FeedbackMessage.gpt_id is IntegerField**: when fabricating a synthetic survey payload for a local verification run, passing a string for `gpt_id` (e.g. `'verify-survey'`) triggers Django's 400 on IntegerField validation, so the row is silently rejected. That is why stubbed/test traffic generally does not pollute Postgres — but if you ever pass an integer gpt_id, the row WILL land. Pick a guaranteed-bogus integer (e.g. `-1`) and clean up with `DELETE FROM datapipeline_feedbackmessage WHERE gpt_id=-1` at the end of the run.

## In-Group Feedback mode (mock-backed frontend)

The In-Group feature is fully exercisable from the frontend alone — all state lives in `localStorage` under `leai.mock.*` until the backend ships.

- **Login bypass for visual verification**: drop the session into `sessionStorage` before navigating to PromptDesigner so `enterApp()` can run without course credentials.

    ```js
    sessionStorage.setItem('leai_session', JSON.stringify({ courseId: 'verify-ingroup', courseName: 'Verify In-Group Feedback' }));
    ```

- **Reset mock data between runs**: clear these keys (plus any `leai.mock.chatLog.*` / `leai.feedback.*`):

    ```
    leai.mock.teamConfigurations
    leai.mock.surveyTeamSnapshots
    leai.mock.sessionTeamAssignments
    leai.mock.surveys
    leai.promptDesigner.mode
    ```

- **Shareable link shape**: survey link from PromptDesigner is `feedback.html?id=<surveyId>` (same `?id=` param as general surveys). Not `?survey=`.
- **Chat log persistence**: feedback.html's in-group flow writes each turn to `leai.mock.chatLog.{surveyId}`; FeedbackAnalyzer's team drill-down reads this key.
- **Live `leaiChat`**: the bot actually calls the Heroku backend with the generated system prompt — the in-group letter-label instruction works end-to-end; verify real bot output by sending a user message that mentions a teammate.
