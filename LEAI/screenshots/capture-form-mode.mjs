import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8181/LEAI';
const OUT_DIR = new URL('../guide-assets/', import.meta.url).pathname;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 120000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// Block external API calls so pending Heroku fetches don't tie up the JS engine.
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('heroku') || url.includes('openai') || url.includes('guiidata')) {
    req.abort();
  } else {
    req.continue();
  }
});

// ─── pd-form-mode.png ────────────────────────────────────────────────
// Use 'load' (not networkidle0) so Tailwind CDN JIT finishes before we evaluate.
await page.goto(BASE + '/PromptDesigner.html', { waitUntil: 'load', timeout: 60000 });
// Extra wait for Tailwind CDN JIT compilation to settle.
await new Promise(r => setTimeout(r, 3000));

await page.evaluate(() => {
  if (typeof lockCourse === 'function') {
    lockCourse('cm150-sp26', 'Foundations of Computational Media');
  }
});
await new Promise(r => setTimeout(r, 500));

// Activate the Form (Structured Reflection) mode panel by calling applyMode directly.
// (Avoid tab.click() — the click event triggers concurrent Heroku fetches that block CDP.)
await page.evaluate(() => {
  if (typeof applyMode === 'function') {
    applyMode('form');
  }
});
await new Promise(r => setTimeout(r, 500));

// Inject a fake schema list into the schema picker so it has something to show.
await page.evaluate(() => {
  const sel = document.getElementById('form-schema-select');
  if (!sel) return;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const fakeSchemas = [
    { id: 'hci271-wk6-team', label: 'HCI 271 Wk 6 — Team Process' },
    { id: 'cm150-final-reflect', label: 'CM 150 — Final Project Reflection' },
  ];
  fakeSchemas.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    sel.appendChild(opt);
  });
  sel.value = fakeSchemas[0].id;
  // Do NOT dispatch 'change' — it triggers renderFormSchemaPreview which fetches again.
  // Instead build the preview card directly below.

  const preview = document.getElementById('form-schema-preview');
  if (preview) {
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    preview.style.display = 'block';

    const card = document.createElement('div');
    card.style.cssText = 'padding:12px 16px; border:1px solid #e2e8f0; border-radius:8px; background:#f8fafc';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700; margin-bottom:8px';
    title.textContent = 'HCI 271 Wk 6 — Team Process';
    card.appendChild(title);

    const ol = document.createElement('ol');
    ol.style.cssText = 'margin:0; padding-left:18px; color:#475569; font-size:14px; line-height:1.6';
    [
      'What did your team accomplish this week?',
      'What blockers did you face?',
      'Roles and contributions — for each teammate.',
      'What will you change next week?',
    ].forEach((q) => {
      const li = document.createElement('li');
      li.textContent = q;
      ol.appendChild(li);
    });
    card.appendChild(ol);

    preview.appendChild(card);
  }
});
await new Promise(r => setTimeout(r, 300));

await page.screenshot({ path: OUT_DIR + 'pd-form-mode.png', fullPage: false });

// ─── feedback-form-mode.png ──────────────────────────────────────────
// Use ?id=17 (same as existing capture.mjs) — the page only reads ?id=, not ?form=.
await page.goto(BASE + '/feedback.html?id=17', { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));

await page.evaluate(() => {
  // Hide the no-survey-screen overlay (shown when Heroku fetch fails/is blocked).
  const noSurvey = document.getElementById('no-survey-screen');
  if (noSurvey) noSurvey.style.display = 'none';

  // Hide consent modal.
  const consent = document.getElementById('consent-modal');
  if (consent) consent.style.display = 'none';

  // Hide the selector widget (same as existing capture.mjs).
  const selWrapper = document.querySelector('.select-wrapper');
  if (selWrapper) selWrapper.style.display = 'none';

  // Set chat title to something meaningful for a form-mode survey.
  const chatTitle = document.getElementById('chat-title');
  if (chatTitle) chatTitle.textContent = 'HCI 271 Wk 6 — Team Process';

  // Enable the send button so it doesn't look disabled.
  const sendBtn = document.getElementById('sendMessage');
  if (sendBtn) sendBtn.disabled = false;

  // Use the actual transcription container (same pattern as existing capture.mjs).
  const chat = document.getElementById('transcription');
  if (!chat) return;
  while (chat.firstChild) chat.removeChild(chat.firstChild);

  const turns = [
    { who: 'bot',     text: "Hi! I'm here to help you reflect on this week. We'll go section by section. Ready?" },
    { who: 'student', text: "Yes." },
    { who: 'bot',     text: "Section 1 of 4 — What did your team accomplish this week?" },
    { who: 'student', text: "We finished the wireframes and a first paper prototype." },
    { who: 'bot',     text: "Nice. Anything you almost cut but kept?" },
    { who: 'student', text: "The error states. We almost skipped them." },
    { who: 'bot',     text: "Got it. Section 2 of 4 — What blockers did you face?" },
  ];
  turns.forEach((t) => {
    const div = document.createElement('div');
    // Use the same class pattern as existing capture.mjs (ai-message / user-message).
    div.className = 'message ' + (t.who === 'bot' ? 'ai-message' : 'user-message');
    div.textContent = t.text;
    chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;
});
await new Promise(r => setTimeout(r, 300));

await page.screenshot({ path: OUT_DIR + 'feedback-form-mode.png', fullPage: false });

await browser.close();
console.log('Wrote pd-form-mode.png and feedback-form-mode.png');
