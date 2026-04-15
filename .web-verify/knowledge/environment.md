# Environment

- **Dev server**: `python3 -m http.server 8080` from repo root (usually already running on :8080).
- **LEAI API base auto-switch**: `leai-shared.js` routes to `http://localhost:8000/datapipeline/api` when `window.location.hostname` is `localhost` or `127.0.0.1`; otherwise Heroku. To exercise live API calls from a local browser, run the `guiidatapipelines` Django backend on :8000.
- **Playwright MCP screenshots**: must be saved inside the repo (e.g. `.web-verify/screenshots/…`). `/tmp/web-verify` is outside the allowed roots and is rejected.
- **Stale MCP Chrome**: if `browser_navigate` errors with "Browser is already in use", kill stragglers with `pkill -f "user-data-dir=.*ms-playwright/mcp-chrome"` and retry.
