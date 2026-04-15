# Agent Verification Boundaries

- **feedback.html full flow**: requires a valid `?id=<public_id>` survey that exists in the backend AND a reachable backend (local :8000 or Heroku with CORS). On localhost with no local backend, fetches 404 — static rendering can still be verified by injecting messages via `buildAiMessage` / `buildStudentMessage` through `browser_evaluate`.
- **PromptDesigner.html**: requires course login; surveys list needs `/login_course/` session cookie. For pure-CSS changes (e.g. button width), prefer synthetic DOM injection in an unauthenticated page load rather than driving the login flow.
- **Live AI markdown**: calling real OpenAI responses requires the Heroku backend with CORS; skip for CI-style verification and instead inject a known markdown string to validate the rendering path.
- **Concurrent-student bug**: cannot be reproduced end-to-end from a single Playwright tab. Verify by (a) confirming `crypto.randomUUID` is used, (b) batch-generating IDs to show zero collisions, (c) confirming per-survey sessionStorage keying.
