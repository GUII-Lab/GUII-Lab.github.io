"""Build self-contained HTML verification report for LEAI async QuickTake."""
import base64
import json
import pathlib

SCREENSHOTS_DIR = pathlib.Path(__file__).resolve().parents[1] / ".web-verify" / "screenshots"
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "verification-report-leai-async-quicktake-2026-04-15.html"

def encode(name: str) -> str:
    with open(SCREENSHOTS_DIR / name, "rb") as f:
        return base64.b64encode(f.read()).decode()

CTA = encode("01-cta.png")
SHIMMER = encode("02-shimmer.png")
READY = encode("03-ready.png")
RELOAD = encode("04-reload-resumed.png")

criteria = [
    {
        "name": "initial-cta",
        "spec": "When no QuickTake exists for the current scope, FeedbackAnalyzer shows the 'Generate summary' CTA with no error.",
        "status": "pass",
        "img": CTA,
        "note": "Entire Course scope selected. Response count (45), participation (100%), and the initial CTA card all render. Clicking the CTA initiates the async flow.",
        "judgment": "CTA renders as expected. The AI Quick Take card shows the 'Summarize this with AI' heading, the descriptive paragraph, and a solid 'Generate summary' button. No stale error, no spinner, no previous bullets leaking through.",
    },
    {
        "name": "pending-shimmer",
        "spec": "Immediately after clicking Generate, the CTA is replaced by a shimmer/pending placeholder while the background job is running. The UI does not block the tab and no timeout/CORS error appears.",
        "status": "pass",
        "img": SHIMMER,
        "note": "Within a few hundred ms of clicking Generate summary, the card transitions to the shimmer state. The POST returned 202 and the frontend entered its polling loop (2s interval).",
        "judgment": "Shimmer shows three animated placeholder bars. No blocking, no H12 router timeout, no CORS preflight failure. This is the critical regression the async refactor was designed to fix — confirmed working end-to-end in the browser.",
    },
    {
        "name": "ready-bullets",
        "spec": "When the background job completes, polling detects status=ready and the card renders bullets with citation pills and the 'X/Y verified' label.",
        "status": "pass",
        "img": READY,
        "note": "Job completed and polling transitioned the UI to the rendered state. 10 thematic bullets with R## citation pills. Header shows '40/42 verified' from the verifier pass. 'Regenerate', 'Show prompt', and 'Ask a follow-up' affordances are all present.",
        "judgment": "Full happy path verified: POST 202 → background thread runs map-reduce over 45 responses → verifier checks every citation → polling GET returns status=ready → UI renders bullets. Content is coherent (themes: hands-on learning, practice problems, group project logistics, pacing, course materials, technical issues, etc.) and citations reference real response IDs R5–R44.",
    },
    {
        "name": "reload-resumes-fetch",
        "spec": "Reloading the page while a QuickTake exists for the active scope re-fetches from the server and renders the cached result without re-generating.",
        "status": "pass",
        "img": RELOAD,
        "note": "After switching to Week 1 Check-in scope, triggering generate, then immediately reloading the page, the UI correctly queries GET /leai_quicktake/?scope_key=week-1 and renders the 9 completed bullets. No duplicate POST /generate/ was issued (verified by DB row count = 1 for scope_key=week-1).",
        "judgment": "State survives navigation. The GET endpoint returns whatever persisted status is current (ready in this run), and the page renders it. If the row were still pending/running at reload time, renderQuickTake would branch to attachQuickTakePoll and resume the polling loop without re-invoking /generate/.",
    },
]

pass_n = sum(1 for c in criteria if c["status"] == "pass")
fail_n = sum(1 for c in criteria if c["status"] == "fail")
human_n = sum(1 for c in criteria if c["status"] == "human-required")

criterion_html = []
for c in criteria:
    label = {"pass": "PASS", "fail": "FAIL", "human-required": "HUMAN REVIEW"}[c["status"]]
    cls = c["status"].replace("-required", " human").split()[-1] if c["status"] == "human-required" else c["status"]
    badge_cls = "pass" if c["status"] == "pass" else ("fail" if c["status"] == "fail" else "human")
    criterion_html.append(f"""
  <div class="criterion open">
    <div class="criterion-header">
      <h3>{c['name']}</h3>
      <span class="badge {badge_cls}">{label}</span>
    </div>
    <div class="criterion-body">
      <div class="spec">{c['spec']}</div>
      <div class="step">
        <div class="step-action">Evidence</div>
        <div class="step-note">{c['note']}</div>
        <img src="data:image/png;base64,{c['img']}" alt="{c['name']}" onclick="openLightbox(this.src)" />
      </div>
      <div class="judgment {badge_cls}">
        <div class="judgment-label">Judgment</div>
        {c['judgment']}
      </div>
    </div>
  </div>""")

fixes_html = """
  <div class="fix">
    <div class="fix-label">Root-cause fix discovered during verification</div>
    <p>Initial run of this verification showed the POST returned 202 but the row remained status=pending indefinitely — the worker thread was never spawned. Instrumentation revealed <code>start_quicktake_job</code> was returning early before reaching <code>thread.start()</code> because the idempotency guard <code>if qt.status in (PENDING, RUNNING): return qt, False</code> matched the row <em>just created</em> with <code>defaults={'status': STATUS_PENDING, ...}</code>.</p>
    <p><strong>Fix:</strong> wrap the idempotency check in <code>if not created:</code> so it only applies to pre-existing rows (<code>datapipeline/leai_analysis.py</code> <code>start_quicktake_job</code>). First-run rows fall through to the thread spawn block. Verified: logs now show the full lifecycle (pending → running → ready) and bullets render in the UI.</p>
  </div>"""

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verification Report — LEAI Async QuickTake (2026-04-15)</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.6; padding: 2rem; }}
  .container {{ max-width: 1000px; margin: 0 auto; }}
  h1 {{ color: #f0f6fc; margin-bottom: 0.5rem; }}
  .meta {{ color: #8b949e; font-size: 0.9rem; margin-bottom: 2rem; }}
  .summary {{ display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }}
  .stat {{ padding: 1rem 1.5rem; border-radius: 8px; background: #161b22; border: 1px solid #30363d; }}
  .stat .number {{ font-size: 2rem; font-weight: 700; }}
  .stat.pass .number {{ color: #3fb950; }}
  .stat.fail .number {{ color: #f85149; }}
  .stat.human .number {{ color: #d29922; }}
  .stat.total .number {{ color: #58a6ff; }}
  .criterion {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }}
  .criterion-header {{ padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }}
  .criterion-header:hover {{ background: #1c2129; }}
  .criterion-header h3 {{ color: #f0f6fc; font-size: 1.1rem; }}
  .badge {{ padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }}
  .badge.pass {{ background: #238636; color: #fff; }}
  .badge.fail {{ background: #da3633; color: #fff; }}
  .badge.human {{ background: #9e6a03; color: #fff; }}
  .criterion-body {{ padding: 0 1.5rem 1.5rem; display: none; }}
  .criterion.open .criterion-body {{ display: block; }}
  .spec {{ color: #8b949e; font-style: italic; margin-bottom: 1rem; padding: 0.75rem; background: #0d1117; border-radius: 4px; border-left: 3px solid #30363d; }}
  .step {{ margin-bottom: 1.5rem; padding-left: 1.5rem; border-left: 2px solid #30363d; }}
  .step-action {{ color: #58a6ff; font-weight: 600; margin-bottom: 0.5rem; }}
  .step-note {{ color: #8b949e; font-size: 0.9rem; margin-bottom: 0.5rem; }}
  .step img {{ max-width: 100%; border-radius: 6px; border: 1px solid #30363d; cursor: pointer; transition: transform 0.2s; margin-top: 0.5rem; }}
  .step img:hover {{ transform: scale(1.01); }}
  .judgment {{ margin-top: 1rem; padding: 1rem; background: #0d1117; border-radius: 6px; }}
  .judgment-label {{ font-weight: 700; margin-bottom: 0.5rem; }}
  .judgment.pass {{ border-left: 3px solid #3fb950; }}
  .judgment.fail {{ border-left: 3px solid #f85149; }}
  .judgment.human {{ border-left: 3px solid #d29922; }}
  .fix {{ margin-top: 1rem; padding: 1rem; background: #1c1d2e; border-radius: 6px; border-left: 3px solid #a371f7; }}
  .fix-label {{ color: #a371f7; font-weight: 700; margin-bottom: 0.5rem; }}
  .fix p {{ margin-top: 0.5rem; }}
  .fix code {{ background: #0d1117; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; }}
  .context {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }}
  .context h2 {{ color: #f0f6fc; font-size: 1.1rem; margin-bottom: 0.5rem; }}
  .context p {{ margin-top: 0.5rem; color: #c9d1d9; }}
  .context code {{ background: #0d1117; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; }}
  .lightbox {{ display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; padding: 2rem; }}
  .lightbox.active {{ display: flex; }}
  .lightbox img {{ max-width: 95%; max-height: 95%; border-radius: 8px; }}
</style>
</head>
<body>
<div class="container">
  <h1>Verification Report — LEAI Async QuickTake</h1>
  <div class="meta">
    Generated: 2026-04-15 &middot; URL: http://localhost:8080/LEAI/FeedbackAnalyzer.html &middot; Backend: http://localhost:8000 &middot; Browser: chromium &middot; Viewport: 1440x900 &middot; Course: leai-test (45 responses, 3 weeks)
  </div>

  <div class="summary">
    <div class="stat pass"><div class="number">{pass_n}</div><div>Passed</div></div>
    <div class="stat fail"><div class="number">{fail_n}</div><div>Failed</div></div>
    <div class="stat human"><div class="number">{human_n}</div><div>Human Review</div></div>
    <div class="stat total"><div class="number">{len(criteria)}</div><div>Total</div></div>
  </div>

  <div class="context">
    <h2>Context</h2>
    <p>Original bug: clicking <em>AI Quick Take</em> returned 503 with a CORS error banner. Root cause was a Heroku H12 router timeout (30s hard limit) on a synchronous OpenAI call, not a CORS misconfiguration.</p>
    <p>Fix shipped in <code>guiidatapipelines</code>: converted <code>leai_quicktake_generate</code> from synchronous to an in-process background thread (no Redis, no worker dyno), switched the QuickTake model to <code>gpt-4.1-mini</code>, added <code>status/error/job_started_at</code> columns with a <code>STATUS_CHOICES</code> state machine, added a 600s stale-job detector, and returns HTTP 202 immediately. Frontend polls GET every 2s via new <code>leaiChat.pollQuickTake</code>.</p>
    <p>This report verifies the end-to-end user flow in a real browser against a local Django backend running the exact code being deployed to Heroku.</p>
  </div>

{''.join(criterion_html)}

  <div class="context">
    <h2>Bugs Fixed During Verification</h2>
    {fixes_html}
  </div>

  <div class="context">
    <h2>Human Review Items</h2>
    <p>None. All four criteria were verifiable programmatically via screenshots + API introspection. The generated bullet content is coherent and on-topic, but that is expected LLM output quality (not a feature being verified by this report).</p>
  </div>
</div>

<div class="lightbox" onclick="this.classList.remove('active')">
  <img id="lightbox-img" src="" alt="Enlarged screenshot" />
</div>

<script>
function openLightbox(src) {{
  const lb = document.querySelector('.lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.classList.add('active');
}}
document.querySelectorAll('.criterion-header').forEach(h => {{
  h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
}});
</script>
</body>
</html>
"""

OUTPUT.write_text(html)
print(f"Report written: {OUTPUT}")
print(f"Size: {OUTPUT.stat().st_size} bytes")
