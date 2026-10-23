'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '../..');
const origin = 'https://leai-ui-check.invalid';
const demoId = 'etc-discussion-demo-v1';
const registry = [
    { schema_id: 'fixture-private-a', title: 'Private course A reflection', course_label: 'Private course A' },
    { schema_id: demoId, title: 'DEMO ONLY · ETC discussion', course_label: 'ETC Demo' },
    { schema_id: 'fixture-private-b', title: 'Private course B reflection', course_label: 'Private course B' },
];
const reportDir = process.env.LEAI_DEMO_VERIFY_ARTIFACT_DIR;
const captures = [];
let browser;

test.before(async () => {
    const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync(installedChrome) ? installedChrome : undefined),
    });
    if (reportDir) fs.mkdirSync(reportDir, { recursive: true });
});

test.after(async () => {
    if (browser) await browser.close();
    if (reportDir) {
        const sections = captures.map(({ label, filename }) => '<section><h2>' + label + '</h2><img src="data:image/png;base64,' + fs.readFileSync(filename).toString('base64') + '"></section>');
        fs.writeFileSync(path.join(reportDir, 'report.html'), '<!doctype html><meta charset="utf-8"><title>HTML Prompt Designer demo schema verification</title><style>body{font:16px system-ui;max-width:1480px;margin:30px auto;padding:0 20px}img{max-width:100%;border:1px solid #bbb}section{margin:30px 0}</style><h1>HTML Prompt Designer demo schema verification</h1><p>Actual local HTML/CSS/JS in Chrome. Synthetic API responses; no production data, backend writes, or AI calls. Screenshots cover the default and selected demo states. Test output supplies the interaction assertions. Hosted deployment and other browsers were not verified.</p>' + sections.join(''));
    }
});

async function openDesigner(t, { courseName = 'ETC Demo · Fall 2026', rows = registry, surveys = [], mode = 'form', width = 1440 } = {}) {
    const page = await browser.newPage();
    const unexpected = [];
    const detailRequests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.setViewport({ width, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', async request => {
        const url = new URL(request.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
        const json = body => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin }, body: JSON.stringify(body) });
        if (url.origin === origin) {
            const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
            const filename = path.join(root, relative);
            if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return request.respond({ status: 404, body: '' });
            const type = filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.png') ? 'image/png' : 'text/html';
            return request.respond({ status: 200, contentType: type, body: fs.readFileSync(filename) });
        }
        if (url.hostname === 'guiidata-b6c968e6ed85.herokuapp.com') {
            if (request.method() !== 'GET') {
                unexpected.push(request.method() + ' ' + url.pathname);
                return request.respond({ status: 418, body: 'Unexpected write blocked' });
            }
            if (url.pathname === '/datapipeline/api/form_schemas/') return json(rows);
            if (url.pathname === '/datapipeline/api/form_schemas/' + demoId + '/') {
                detailRequests.push(demoId);
                return json({ schema_id: demoId, title: 'ETC Demo discussion', body: { title: 'ETC Demo discussion', engine: 'orchestrator-v1', version: '1.0.0', sections: [{ id: '1', title: 'Class discussion' }], intro: 'Reflect on a classroom discussion.' } });
            }
            if (url.pathname === '/datapipeline/api/feedback_gpts_by_course/') return json(surveys);
            if (url.pathname === '/datapipeline/api/team_configurations/') return json([]);
            unexpected.push(request.method() + ' ' + url.pathname);
            return request.respond({ status: 418, body: 'Unexpected endpoint blocked' });
        }
        if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return request.continue();
        unexpected.push(request.method() + ' ' + url.hostname + url.pathname);
        return request.abort();
    });
    await page.evaluateOnNewDocument((name, initialMode) => {
        sessionStorage.setItem('leai_session', JSON.stringify({ courseId: 'demo-ui-fixture', courseName: name }));
        localStorage.setItem('leai.promptDesigner.mode', initialMode);
    }, courseName, mode);
    t.after(async () => {
        await page.close();
        assert.deepEqual(unexpected, [], 'All backend traffic must match the synthetic read-only fixture');
        assert.deepEqual(errors, [], 'No application page errors');
    });
    await page.goto(origin + '/LEAI/PromptDesigner.html', { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForFunction(() => document.querySelector('#form-schema-select option')?.textContent === 'Select a schema…');
    return { page, detailRequests };
}

async function capture(page, label, name) {
    if (!reportDir) return;
    const filename = path.join(reportDir, name + '.png');
    await page.screenshot({ path: filename, fullPage: true });
    captures.push({ label, filename });
}

const options = (page, selector) => page.$$eval(selector + ' option', nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));

test('ETC demo starts unselected, hides private schema choices, and requires an explicit selection', { timeout: 60000 }, async t => {
    const { page, detailRequests } = await openDesigner(t);
    assert.deepEqual(await options(page, '#form-schema-select'), [
        { value: '', label: 'Select a schema…' }, { value: demoId, label: 'ETC Demo — Class discussion' },
    ]);
    assert.equal(await page.$eval('#form-schema-select', node => node.value), '');
    assert.equal(await page.$eval('#form-schema-preview', node => getComputedStyle(node).display), 'none');
    assert.deepEqual(detailRequests, []);
    const hints = await page.$$eval('[placeholder], [data-tooltip]', nodes => nodes.map(node => node.getAttribute('placeholder') || node.getAttribute('data-tooltip')).join('\n'));
    assert.doesNotMatch(hints, /hci|271|80h|cm150|jane smith|computational media/i);
    await capture(page, '1440px — neutral default with no schema preview', 'default-1440');
    await page.type('#form-survey-label', 'Demo reflection');
    await page.click('#form-create-btn');
    assert.match(await page.$eval('#form-survey-msg', node => node.textContent), /Pick a schema/);
    await page.click('#form-schema-select');
    await page.keyboard.press('Escape');
    await page.select('#form-schema-select', demoId);
    await page.waitForFunction(() => document.querySelector('#form-schema-preview').textContent.includes('ETC Demo — Class discussion'));
    assert.equal(await page.$eval('#form-schema-select', node => node.value), demoId);
    assert.equal(detailRequests.length, 1);
    await capture(page, '1440px — selected ETC demo schema', 'selected-1440');
    for (const width of [820, 390]) {
        const { page: narrowPage } = await openDesigner(t, { width });
        await narrowPage.select('#form-schema-select', demoId);
        await narrowPage.waitForFunction(() => document.querySelector('#form-schema-preview').textContent.includes('ETC Demo — Class discussion'));
        await narrowPage.focus('#form-schema-select');
        assert.equal(await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No page overflow at ' + width + 'px');
        assert.equal(await narrowPage.$eval('#form-schema-select', node => { const bounds = node.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; }), true, 'Schema control stays within the viewport at ' + width + 'px');
        await capture(narrowPage, width + 'px — selected ETC demo schema (fresh page load)', 'selected-' + width);
    }
    await page.bringToFront();
    await page.select('#form-schema-select', '');
    assert.equal(await page.$eval('#form-schema-preview', node => getComputedStyle(node).display), 'none');
    assert.equal(await page.$eval('#form-survey-instructions', node => node.readOnly), false);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click('.mode-tab[data-mode="group"]');
    await page.waitForFunction(() => document.querySelectorAll('#ig-schema-select option').length === 2);
    assert.deepEqual((await options(page, '#ig-schema-select')).map(option => option.value), ['', demoId]);
});

test('other courses retain registry labels and IDs but also start with Select a schema', async t => {
    const { page } = await openDesigner(t, { courseName: 'Training Sandbox' });
    assert.deepEqual((await options(page, '#form-schema-select')).map(option => option.value), ['', ...registry.map(row => row.schema_id)]);
    assert.match((await options(page, '#form-schema-select'))[1].label, /Private course A/);
    assert.equal(await page.$eval('#form-schema-select', node => node.value), '');
});

test('a missing ETC demo schema never falls back to a real-course schema', async t => {
    const { page } = await openDesigner(t, { rows: registry.filter(row => row.schema_id !== demoId) });
    assert.deepEqual((await options(page, '#form-schema-select')).map(option => option.value), ['', '']);
    assert.equal(await page.$eval('#form-schema-select', node => node.value), '');
});

test('demo edit picker preserves the saved binding and reveals no other course labels', async t => {
    const { page } = await openDesigner(t, { surveys: [{ id: 900001, name: 'Demo reflection', survey_label: 'Demo reflection', mode: 'form', form_schema_id: demoId, public_id: 'demo-ui-fixture', week_number: 3 }] });
    let edit;
    for (const button of await page.$$('#form-survey-list-container button')) {
        if (await button.evaluate(node => node.textContent === 'Edit')) { edit = button; break; }
    }
    assert.ok(edit);
    await edit.click();
    await page.waitForFunction(() => document.querySelector('#edit-schema').value === 'etc-discussion-demo-v1');
    assert.deepEqual(await options(page, '#edit-schema'), [{ value: demoId, label: 'ETC Demo — Class discussion' }]);
    await page.click('#edit-cancel');
});

test('instructor font presets enlarge text, preserve spacing, and survive reload', async t => {
    const { page } = await openDesigner(t);
    const metrics = () => page.evaluate(() => ({
        heading: parseFloat(getComputedStyle(document.querySelector('.page-header h1')).fontSize),
        padding: getComputedStyle(document.querySelector('#form-survey-card')).paddingLeft,
        card: [document.querySelector('#form-survey-card').offsetWidth, document.querySelector('#form-survey-card').offsetHeight],
        schemaSelect: [document.querySelector('#form-schema-select').offsetWidth, document.querySelector('#form-schema-select').offsetHeight],
        sidebar: document.querySelector('#sidebar').getBoundingClientRect().width,
        zoom: getComputedStyle(document.documentElement).zoom,
    }));
    await page.waitForFunction(() => document.querySelector('#form-schema-select option[value="etc-discussion-demo-v1"]'));
    const before = await metrics();
    await page.click('.leai-font-size-trigger');
    await page.click('.leai-font-size-option[data-size="125"]');
    const enlarged = await metrics();
    assert.ok(Math.abs(enlarged.heading - before.heading * 1.25) < 0.1);
    assert.equal(enlarged.card[0], before.card[0], 'Text scaling does not widen the card');
    assert.ok(enlarged.card[1] >= before.card[1], 'Card height can grow to fit reflowed text');
    assert.equal(enlarged.schemaSelect[0], before.schemaSelect[0], 'Select stays within the available column width');
    assert.ok(enlarged.schemaSelect[1] >= before.schemaSelect[1], 'Select can grow vertically to fit enlarged text');
    assert.equal(enlarged.padding, before.padding);
    assert.equal(enlarged.sidebar, before.sidebar);
    assert.equal(enlarged.zoom, '1');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.ok(Math.abs((await metrics()).heading - before.heading * 1.25) < 0.1);
    assert.equal(await page.$eval('.leai-font-size-option[data-size="125"]', node => node.getAttribute('aria-pressed')), 'true');
    await capture(page, '1440px — 125% text, unchanged spacing and sidebar width', 'font-125-1440');
    await page.click('.leai-font-size-trigger');
    await page.click('.leai-font-size-option[data-size="100"]');
    assert.deepEqual(await metrics(), before);
});
