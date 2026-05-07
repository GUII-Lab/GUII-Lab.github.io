// Capture two screenshots for the StudyCrafter pitch deck (slide 4):
//   pd-form-mode-tab.png   — PromptDesigner Structured Reflection tab + schema picker
//   feedback-form-mode.png — student-side form-mode walkthrough
//
// Runs against the live GitHub Pages site so leai-shared.js auto-routes
// to the Heroku backend and FormSchemas resolve. No local Django needed.

import puppeteer from 'puppeteer';

const SITE = 'https://guii-lab.github.io/LEAI';
const SCHEMA_ID = 'hci271-week6-reflection';
const COURSE_ID = 'cm150-sp26';
const COURSE_NAME = 'Foundations of Computational Media';
const OUT_DIR = new URL('../guide-assets/', import.meta.url).pathname;

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
    protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
page.setDefaultTimeout(60000);

// 1. PromptDesigner — Structured Reflection tab active, schema picker populated.
// Stub the synchronous confirm() that the mode-tab click handler invokes —
// it hangs Puppeteer in headless mode.
await page.evaluateOnNewDocument(() => {
    window.confirm = () => true;
    window.alert = () => {};
});
await page.goto(SITE + '/PromptDesigner.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.mode-tab[data-mode="form"]', { timeout: 30000 });
// Synthesize a logged-in session and switch directly to form mode (skip click handler).
await page.evaluate((id, name) => {
    try { lockCourse(id, name); } catch (_) { /* tolerate config-load error */ }
}, COURSE_ID, COURSE_NAME);
await new Promise(r => setTimeout(r, 400));
await page.evaluate(() => {
    if (typeof applyMode === 'function') applyMode('form');
});
await page.waitForFunction(() => {
    const sel = document.getElementById('form-schema-select');
    return sel && sel.options.length > 1;
}, { timeout: 30000 });
await page.evaluate(() => {
    const sel = document.getElementById('form-schema-select');
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change'));
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: OUT_DIR + 'pd-form-mode-tab.png', fullPage: false });
console.log('captured pd-form-mode-tab.png');

// 2. feedback.html?form=<schema_id> — student walkthrough
await page.goto(SITE + '/feedback.html?form=' + encodeURIComponent(SCHEMA_ID), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
});
await page.waitForSelector('#consent-required', { timeout: 30000 });
await page.evaluate(() => {
    const cb = document.getElementById('consent-required');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    document.getElementById('consent-continue-btn').click();
});
// Wait for any bot/assistant message bubble to render
await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.bot-message, .message-bot, [data-role="assistant"], .chat-message');
    return msgs.length >= 1;
}, { timeout: 60000 }).catch(() => { /* fallback: capture whatever is on screen */ });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: OUT_DIR + 'feedback-form-mode.png', fullPage: false });
console.log('captured feedback-form-mode.png');

await browser.close();
