'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = require('../leai-question-set-wizard.js');

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        text: async function () { return JSON.stringify(payload); },
    };
}

test('replacement, settings, preparation metadata and publication bind the exact preview', async () => {
    const calls = [];
    const api = wizard.createApi({apiBase: '/api', authorizedFetch: async (url, options) => {
        calls.push({url, ...options});
        return jsonResponse(200, {});
    }, fetch: async () => jsonResponse(425, {
        error: 'preview_preparing', ready_at: '2026-09-14T12:00:03Z', retry_after_ms: 750,
    })});
    await api.createDraft('course', 'template', true);
    assert.equal(JSON.parse(calls[0].body).confirm_abandon_active, true);
    await api.updatePreviewSettings('exact/token', {completion_certificate_enabled: false});
    assert.equal(calls[1].url, '/api/question_set_preview/exact%2Ftoken/settings/');
    assert.equal(calls[1].method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[1].body), {completion_certificate_enabled: false});
    await api.createSurvey('revision', {previewToken: 'exact/token'});
    assert.equal(JSON.parse(calls[2].body).preview_token, 'exact/token');
    await assert.rejects(api.getPreview('exact/token'), error =>
        error.status === 425 && error.ready_at === '2026-09-14T12:00:03Z' && error.retry_after_ms === 750);
});

test('Structured Feedback is first and initializes after course authentication', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'PromptDesigner.html'), 'utf8');
    const tabs = html.match(/<div class="mode-tabs"[\s\S]*?<\/div>/)[0];
    assert.deepEqual([...tabs.matchAll(/data-mode="([^"]+)"/g)].map(match => match[1]), ['form', 'group', 'general']);
    assert.match(html.match(/function enterApp\(\)[\s\S]*?\/\/ ===== MODE TABS/)[0], /applyMode\('form'\)/);
    assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, ''), /structured reflection/i);
});

// Real browser DOM and native gestures exercise the mounted controller. Only the
// external API is replaced; live backend/QA verification is a separate release gate.
const puppeteer = require('puppeteer');
let browser;
test.before(async () => {
    browser = await puppeteer.launch({
        headless: true,
        args: process.env.CI ? ['--no-sandbox'] : [],
    });
});
test.after(async () => { if (browser) await browser.close(); });

async function mounted(t, config = {}) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.setViewport({width: 1000, height: 650});
    await page.setContent('<button id="open">Create a new structured feedback</button><button id="resume">Continue your previous session</button><div id="root"></div>');
    await page.addStyleTag({path: path.join(__dirname, '..', 'leai-question-set-wizard.css')});
    await page.addScriptTag({path: path.join(__dirname, '..', 'leai-question-set-wizard.js')});
    await page.evaluate(config => {
        const storage = new Map();
        Object.defineProperty(window, 'sessionStorage', {value: {
            getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
        }});
        const body = {title: 'Weekly learning', intro: 'Think about your week.', sections: [
            {id: 'learning', title: 'Learning', opening_prompt: 'What did you learn?', depth_probe: ''},
        ], closing: {feedback_prompt: 'How was this reflection?'}};
        window.fixture = {calls: [], draft: {id: 'draft-1', course_id: 'course', version: 1, title: body.title, body, workflow_status: 'active'},
            settings: {completion_certificate_enabled: true, parsed_document_download_enabled: false},
            ready: !!config.ready, completed: !!config.completed, expired: false,
            active: !!config.active, delaySettings: false, failSettings: false, holdRead: false};
        window.confirm = () => !!config.confirm;
        const fetcher = async (url, options = {}) => {
            const f = window.fixture;
            const data = options.body ? JSON.parse(options.body) : null;
            f.calls.push({url, method: options.method || 'GET', data, time: Date.now()});
            let result = {};
            let status = 200;
            if (url.endsWith('/question_set_templates/')) {
                if (f.failTemplates) { status = 503; result = {error: 'unavailable'}; }
                else result = {templates: [{id: 'weekly', name: 'Weekly', description: 'Review learning', body}]};
            }
            else if (url.includes('/question_set_drafts/?')) {
                const courseId = new URL(url, 'https://fixture.test').searchParams.get('course_id');
                result = {drafts: f.active && f.draft.course_id === courseId ? [f.draft] : []};
            }
            else if (url.endsWith('/question_set_drafts/')) { f.active = true; result = f.draft; }
            else if (url.endsWith('/freeze/')) result = {revision: {id: 'revision-1', preview_completed: true}};
            else if (url.endsWith('/question_set_drafts/draft-1/')) {
                if (data && f.holdSave) await new Promise(resolve => { f.releaseSave = resolve; });
                if (data && f.failSave) { status = 503; result = {error: 'unavailable'}; }
                else { if (data) { f.draft.body = data.body; f.draft.version++; } result = f.draft; }
            } else if (url.endsWith('/preview_capability/')) {
                if (f.holdCapability) await new Promise(resolve => { f.releaseCapability = resolve; });
                result = {token: 'token-1', ready_at: new Date(Date.now() + 3000).toISOString(), preview_url: 'feedback.html?preview=token-1', ...f.settings};
            } else if (url.endsWith('/settings/')) {
                if (f.delaySettings) await new Promise(resolve => { f.releaseSettings = resolve; });
                if (f.failSettings) { status = 503; result = {error: 'unavailable'}; }
                else { Object.assign(f.settings, data); result = {...f.settings}; }
            } else if (url.endsWith('/question_set_preview/token-1/')) {
                if (f.holdRead) await new Promise(resolve => { f.releaseRead = resolve; });
                if (f.expired) { status = 410; result = {error: 'preview_expired'}; }
                else if (!f.ready) { status = 425; result = {error: 'preview_preparing', ready_at: new Date(Date.now() + 2000).toISOString(), retry_after_ms: 300}; }
                else result = {preview_completed: f.completed, question_set_revision_id: 'revision-1', ...f.settings};
            } else if (url.endsWith('/surveys/')) {
                if (data.course_id !== f.draft.course_id) { status = 400; result = {error: 'course_mismatch'}; }
                else { f.active = false; result = {public_id: 'survey-1', survey_label: data.survey_label}; }
            }
            else throw new Error('Unexpected fixture route: ' + url);
            return {ok: status < 400, status, text: async () => JSON.stringify(result)};
        };
        window.activeFixtureCourse = {id: 'course', name: 'Course'};
        window.controller = leaiQuestionSetWizard.mount({root: '#root', openButton: '#open', resumeButton: '#resume',
            apiBase: '/api', authorizedFetch: fetcher, fetch: fetcher, getCourse: () => activeFixtureCourse,
            onDraftsChanged: drafts => { window.landingDrafts = drafts; },
            onRestoreError: error => { window.restoreError = error.code; }});
    }, config);
    await page.evaluate(() => controller.refreshDrafts());
    return page;
}

async function edit(page) {
    await page.click('#open');
    await page.waitForSelector('.qsw-template-card');
    await page.click('.qsw-template-card');
    await page.waitForSelector('[data-bind="title"]');
}

async function generate(page) {
    await edit(page);
    assert.equal(await page.$eval('.qsw-footer .qsw-button-primary', el => el.textContent), 'Generate preview');
    await page.type('[data-bind="title"]', ' edited');
    await page.click('.qsw-footer .qsw-button-primary');
    await page.waitForSelector('.qsw-preview-layout');
}

test('continue opens the returned draft directly in Edit; replacement cancel leaves it untouched', async t => {
    const page = await mounted(t, {active: true});
    await page.click('#resume');
    await page.waitForSelector('[data-bind="title"]', {timeout: 1200});
    assert.equal(await page.$('.qsw-resume'), null);
    await page.click('.qsw-icon-button');
    await page.click('#open');
    assert.equal(await page.$eval('#root', el => el.hidden), true);
    assert.equal(await page.evaluate(() => fixture.calls.filter(c => c.method === 'POST').length), 0);
});

test('confirmed replacement sends consent once and keeps one resumable draft', async t => {
    const page = await mounted(t, {active: true, confirm: true});
    await edit(page);
    assert.equal(await page.evaluate(() => fixture.calls.find(c => c.url.endsWith('/question_set_drafts/') && c.method === 'POST').data.confirm_abandon_active), true);
    assert.equal(await page.evaluate(() => landingDrafts.length), 1);
});

test('resumed setup can return to templates and replace it after confirmation', async t => {
    const page = await mounted(t, {active: true, confirm: true});
    await page.click('#resume');
    await page.waitForSelector('[data-bind="title"]');
    await page.click('.qsw-footer .qsw-button-secondary');
    assert.equal(await page.$$eval('.qsw-template-card', els => els.length), 1);
    await page.click('.qsw-template-card');
    await page.waitForSelector('[data-bind="title"]');
    assert.equal(await page.evaluate(() => fixture.calls.find(c => c.url.endsWith('/question_set_drafts/') && c.method === 'POST').data.confirm_abandon_active), true);
});

test('a newly discovered active draft requires confirmation before template replacement', async t => {
    const page = await mounted(t);
    await page.evaluate(() => { fixture.active = true; });
    await page.click('#open');
    await page.waitForSelector('.qsw-template-card');
    await page.click('.qsw-template-card');
    assert.equal(await page.evaluate(() => fixture.calls.filter(c => c.url.endsWith('/question_set_drafts/') && c.method === 'POST').length), 0);
});

test('Generate saves then freezes then issues; backend readiness gates a monotonic accessible progress bar', async t => {
    const page = await mounted(t);
    await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}]);
    await generate(page);
    const writes = await page.evaluate(() => fixture.calls.filter(c => c.method !== 'GET').map(c => c.url));
    assert.deepEqual(writes.slice(-3), ['/api/question_set_drafts/draft-1/', '/api/question_set_drafts/draft-1/freeze/', '/api/question_set_revisions/revision-1/preview_capability/']);
    assert.equal(await page.$('a.qsw-launch-button'), null);
    const before = await page.$eval('[role="progressbar"]', el => Number(el.getAttribute('aria-valuenow')));
    await page.waitForFunction(() => fixture.calls.filter(c => c.url.endsWith('/question_set_preview/token-1/')).length >= 2);
    const after = await page.$eval('[role="progressbar"]', el => Number(el.getAttribute('aria-valuenow')));
    assert.ok(after >= before && after < 100);
    assert.equal(await page.$eval('.qsw-preparation-fill', el => getComputedStyle(el).transitionDuration), '0s');
    await page.evaluate(() => { fixture.ready = true; });
    await page.waitForSelector('a.qsw-launch-button');
    assert.equal(await page.$eval('.qsw-footer .qsw-button-primary', el => el.disabled), true);
    const times = await page.evaluate(() => fixture.calls.filter(c => c.url.endsWith('/question_set_preview/token-1/')).map(c => c.time));
    assert.ok(times[1] - times[0] >= 280, 'honors server retry_after_ms');
});

test('Preview starts at the top after a scrolled editor and hides the extra footer action', async t => {
    const page = await mounted(t);
    await page.setViewport({width: 1000, height: 360});
    await edit(page);
    await page.evaluate(() => { document.querySelector('.qsw-content').scrollTop = 300; });
    await page.click('.qsw-footer .qsw-button-primary');
    await page.waitForSelector('[role="progressbar"]');
    assert.equal(await page.$eval('.qsw-content', el => el.scrollTop), 0);
    assert.equal(await page.$eval('.qsw-footer-actions button:nth-child(2)', el => getComputedStyle(el).display), 'none');
    const visibleProgress = await page.$eval('[role="progressbar"]', el => {
        const bar = el.getBoundingClientRect();
        const content = document.querySelector('.qsw-content').getBoundingClientRect();
        return bar.top >= content.top && bar.bottom <= content.bottom;
    });
    assert.equal(visibleProgress, true, 'preparation bar is visible without scrolling at short desktop height');
});

test('settings have keyboard help, independent pending state, rollback, live hint and exact publish token', async t => {
    const page = await mounted(t, {ready: true, completed: true});
    await generate(page);
    await page.waitForSelector('a.qsw-launch-button');
    const cert = '[role="switch"][aria-label="Completion certificate"]';
    const form = '[role="switch"][aria-label="Completion form"]';
    assert.equal(await page.$eval(cert, el => el.checked), true);
    assert.equal(await page.$eval(form, el => el.checked), false);
    await page.focus('[aria-label="About Completion certificate"]');
    await page.keyboard.press('Enter');
    assert.match(await page.$eval('.qsw-setting-help:not([hidden])', el => el.textContent), /Instructor preview - not valid/);
    await page.evaluate(() => { fixture.delaySettings = true; fixture.failSettings = true; });
    await page.click(cert);
    assert.equal(await page.$eval(cert, el => el.disabled), true);
    assert.equal(await page.$eval(form, el => el.disabled), false);
    await page.evaluate(() => fixture.releaseSettings());
    await page.waitForFunction(() => document.querySelector('[aria-label="Completion certificate"]').disabled === false);
    assert.equal(await page.$eval(cert, el => el.checked), true);
    assert.match(await page.$eval('.qsw-setting-status', el => el.textContent), /Could not save Completion certificate.*Try again/);
    await page.evaluate(() => { fixture.delaySettings = false; fixture.failSettings = false; });
    await page.click(form);
    await page.waitForFunction(() => document.querySelectorAll('.qsw-setting-status')[1].textContent.includes('Applied live'));
    assert.match(await page.$eval('.qsw-settings', el => el.textContent), /Reload.*open.*preview|reload.*open.*preview/i);
    await page.click('.qsw-footer .qsw-button-primary');
    assert.match(await page.$eval('.qsw-publish-summary', el => el.textContent), /Completion certificate: On.*Completion form: On/);
    assert.deepEqual(await page.$$eval('#qsw-opens, #qsw-expires', els => els.map(el => el.value)), ['', '']);
    await page.click('.qsw-footer .qsw-button-primary');
    await page.waitForSelector('.qsw-receipt');
    assert.equal(await page.evaluate(() => fixture.calls.find(c => c.url.endsWith('/surveys/')).data.preview_token), 'token-1');
    assert.equal(await page.evaluate(() => landingDrafts.length), 0);
});

test('back and close invalidate in-flight preview reads and clear timers', async t => {
    const page = await mounted(t);
    await page.evaluate(() => { fixture.holdRead = true; });
    await generate(page);
    await page.waitForFunction(() => !!fixture.releaseRead);
    await page.click('.qsw-footer .qsw-button-secondary');
    await page.evaluate(() => { fixture.ready = true; fixture.completed = true; fixture.releaseRead(); });
    await page.waitForSelector('[data-bind="title"]');
    assert.equal(await page.evaluate(() => controller.getState().previewCompleted), false);
    assert.equal(await page.evaluate(() => controller.getState().pollTimer), null);
    await page.click('.qsw-icon-button');
    assert.equal(await page.evaluate(() => controller.getState().pollTimer), null);
});

test('closing during capability creation discards its late result', async t => {
    const page = await mounted(t);
    await edit(page);
    await page.evaluate(() => { fixture.holdCapability = true; });
    await page.click('.qsw-footer .qsw-button-primary');
    await page.waitForFunction(() => !!fixture.releaseCapability);
    await page.click('.qsw-icon-button');
    await page.evaluate(async () => { fixture.releaseCapability(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(await page.evaluate(() => controller.getState().previewToken), null);
    assert.equal(await page.evaluate(() => controller.getState().pollTimer), null);
    assert.equal(await page.$eval('#root', el => el.hidden), true);
});

test('a late save from a closed editor does not redraw a later editing session', async t => {
    const page = await mounted(t, {confirm: true});
    await edit(page);
    await page.type('[data-bind="title"]', ' first');
    await page.evaluate(() => { fixture.holdSave = true; });
    await page.click('.qsw-footer-actions button:nth-child(2)');
    await page.waitForFunction(() => !!fixture.releaseSave);
    await page.click('.qsw-icon-button');
    await page.click('#resume');
    await page.waitForSelector('[data-bind="title"]');
    await page.type('[data-bind="title"]', ' later');
    const editing = await page.$eval('[data-bind="title"]', el => el.value);
    await page.evaluate(async () => { fixture.releaseSave(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(await page.$eval('[data-bind="title"]', el => el.value), editing);
});

test('a pending setting stays usable after readiness renders and saves to the same preview', async t => {
    const page = await mounted(t);
    await generate(page);
    await page.evaluate(() => { fixture.delaySettings = true; });
    await page.click('[aria-label="Completion certificate"]');
    await page.evaluate(() => { fixture.ready = true; });
    await page.waitForSelector('a.qsw-launch-button');
    await page.evaluate(() => fixture.releaseSettings());
    await page.waitForFunction(() => document.querySelector('[aria-label="Completion certificate"]').disabled === false, {timeout: 1500});
    assert.equal(await page.$eval('[aria-label="Completion certificate"]', el => el.checked), false);
    assert.equal(await page.$eval('.qsw-setting-status', el => el.textContent), 'Applied live');
});

test('expired preview clears its gate and can generate and poll a fresh capability', async t => {
    const page = await mounted(t);
    await page.evaluate(() => { fixture.expired = true; });
    await generate(page).catch(async error => {
        // The capability can expire before the predicate sees its transient token.
        if (!await page.$('.qsw-launch-button')) throw error;
    });
    await page.waitForFunction(() => document.querySelector('.qsw-notice').textContent.includes('expired'));
    await page.evaluate(() => { fixture.expired = false; fixture.ready = true; });
    await page.click('.qsw-launch-button');
    await page.waitForSelector('a.qsw-launch-button', {timeout: 1500});
    assert.equal(await page.evaluate(() => controller.getState().previewReady), true);
});

async function restoreSaved(page) {
    return page.evaluate(() => {
        sessionStorage.setItem('leai.questionSetWizard.return', JSON.stringify({draftId: 'draft-1', draftVersion: 1, revisionId: 'revision-1', previewToken: 'token-1'}));
        return controller.restoreSameTabPreview();
    });
}

test('restoring another course consumes the return state before showing or freezing its draft', async t => {
    const page = await mounted(t, {active: true, ready: true, completed: true});
    await page.evaluate(() => { activeFixtureCourse = {id: 'course-b', name: 'Course B'}; });
    await restoreSaved(page);
    assert.equal(await page.$eval('#root', el => el.hidden), true);
    assert.equal(await page.evaluate(() => controller.getState().draft), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('leai.questionSetWizard.return')), null);
    assert.deepEqual(await page.evaluate(() => landingDrafts), []);
    assert.equal(await page.evaluate(() => fixture.calls.some(c => c.url.endsWith('/freeze/'))), false);
    assert.equal(await page.evaluate(() => fixture.calls.some(c => c.url.endsWith('/surveys/'))), false);
    assert.equal(await page.evaluate(() => fixture.calls.at(-1).url), '/api/question_set_drafts/?course_id=course-b');
    await page.click('#open');
    await page.waitForSelector('.qsw-template-card');
    assert.match(await page.$eval('.qsw-subtitle', el => el.textContent), /Course B/);
});

test('restored previews retain templates when returning through Edit to Choose', async t => {
    const page = await mounted(t, {active: true, ready: true, confirm: true});
    await restoreSaved(page);
    await page.waitForSelector('a.qsw-launch-button');
    await page.click('.qsw-footer .qsw-button-secondary');
    await page.click('.qsw-footer .qsw-button-secondary');
    assert.equal(await page.$$eval('.qsw-template-card', els => els.length), 1);
});

test('template load failure during restore leaves the current course recoverable', async t => {
    const page = await mounted(t, {active: true, ready: true, confirm: true});
    await page.evaluate(() => { fixture.failTemplates = true; });
    await restoreSaved(page);
    assert.equal(await page.$eval('#root', el => el.hidden), true);
    assert.equal(await page.evaluate(() => restoreError), 'unavailable');
    assert.equal(await page.evaluate(() => landingDrafts[0].id), 'draft-1');
    await page.evaluate(() => { fixture.failTemplates = false; });
    await page.click('#resume');
    await page.waitForSelector('[data-bind="title"]');
    await page.click('.qsw-footer .qsw-button-secondary');
    assert.equal(await page.$$eval('.qsw-template-card', els => els.length), 1);
});

test('Tab and Shift+Tab stay inside the modal from pending-save status focus', async t => {
    const page = await mounted(t);
    await edit(page);
    await page.type('[data-bind="title"]', ' before save');
    await page.evaluate(() => { fixture.holdSave = true; });
    await page.click('.qsw-footer-actions button:nth-child(2)');
    await page.waitForFunction(() => !!fixture.releaseSave);
    assert.equal(await page.$eval('.qsw-footer-status', el => document.activeElement === el), true);
    for (const key of ['Tab', 'Shift+Tab']) {
        await page.focus('.qsw-footer-status');
        for (let count = 0; count < 3; count++) {
            if (key === 'Shift+Tab') await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            if (key === 'Shift+Tab') await page.keyboard.up('Shift');
            assert.equal(await page.$eval('#root', el => el.contains(document.activeElement)), true, key + ' stays in the dialog');
            assert.equal(await page.$eval('.qsw-icon-button', el => document.activeElement === el), true);
        }
    }
    assert.equal(await page.$eval('[data-bind="title"]', el => el.disabled), true);
    await page.evaluate(() => fixture.releaseSave());
    await page.waitForFunction(() => !controller.getState().busy);
    assert.equal(await page.$eval('[data-bind="title"]', el => document.activeElement === el && !el.disabled), true);
});

for (const fails of [false, true]) {
    test('pending save blocks keyboard edits and restores editable focus after ' + (fails ? 'failure' : 'success'), async t => {
        const page = await mounted(t);
        await edit(page);
        await page.type('[data-bind="title"]', ' before save');
        const submitted = await page.$eval('[data-bind="title"]', el => el.value);
        await page.evaluate(fails => { fixture.holdSave = true; fixture.failSave = fails; }, fails);
        await page.click('.qsw-footer-actions button:nth-child(2)');
        await page.waitForFunction(() => !!fixture.releaseSave);
        assert.equal(await page.$eval('.qsw-footer-status', el => document.activeElement === el), true, 'saving status receives focus without activating Close when Space is typed');
        await page.focus('[data-bind="title"]');
        await page.keyboard.type(' should not be accepted');
        assert.equal(await page.$eval('[data-bind="title"]', el => el.value), submitted);
        assert.equal(await page.$eval('[data-bind="title"]', el => el.disabled), true);
        assert.equal(await page.$eval('.qsw-icon-button', el => el.disabled), false);
        await page.evaluate(() => fixture.releaseSave());
        await page.waitForFunction(() => !controller.getState().busy);
        assert.equal(await page.$eval('[data-bind="title"]', el => el.disabled), false);
        assert.equal(await page.$eval('[data-bind="title"]', el => document.activeElement === el), true);
        assert.equal(await page.$eval('[data-bind="title"]', el => el.value), submitted);
        await page.keyboard.type(' after save');
        assert.match(await page.$eval('[data-bind="title"]', el => el.value), /after save/);
        assert.equal(await page.evaluate(() => controller.getState().dirty), true);
    });
}

for (const scenario of ['preparing', 'ready', 'completed', 'expired']) {
    test('saved preview restoration handles ' + scenario, async t => {
        const page = await mounted(t, {active: true, ready: scenario !== 'preparing', completed: scenario === 'completed'});
        await page.evaluate(scenario => {
            fixture.expired = scenario === 'expired';
            sessionStorage.setItem('leai.questionSetWizard.return', JSON.stringify({draftId: 'draft-1', draftVersion: 1, revisionId: 'revision-1', previewToken: 'token-1'}));
            return controller.restoreSameTabPreview();
        }, scenario);
        if (scenario === 'expired') {
            await page.waitForFunction(() => document.querySelector('.qsw-notice').textContent.includes('expired'));
            assert.equal(await page.$('a.qsw-launch-button'), null);
        } else if (scenario === 'preparing') {
            await page.waitForSelector('[role="progressbar"]');
            assert.equal(await page.$('a.qsw-launch-button'), null);
            assert.equal(await page.$('[role="switch"]'), null, 'do not invent settings while restored capability settings are unknown');
        } else {
            await page.waitForSelector('a.qsw-launch-button');
            assert.equal(await page.$eval('[aria-label="Completion certificate"]', el => el.checked), true);
            assert.equal(await page.$eval('.qsw-footer .qsw-button-primary', el => el.disabled), scenario !== 'completed');
        }
    });
}

test('wizard API uses authenticated course-scoped draft endpoints', async () => {
    const calls = [];
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function (url, options) {
            calls.push({ url: url, options: options || {} });
            return jsonResponse(201, { id: 'draft-1', version: 1 });
        },
    });

    await api.listTemplates();
    await api.listDrafts('course-1');
    await api.createDraft('course-1', 'weekly-reflection');

    assert.equal(calls[0].url, '/api/question_set_templates/');
    assert.equal(calls[1].url, '/api/question_set_drafts/?course_id=course-1');
    assert.equal(calls[2].url, '/api/question_set_drafts/');
    assert.deepEqual(JSON.parse(calls[2].options.body), {
        course_id: 'course-1',
        template_id: 'weekly-reflection',
    });
});

test('wizard save, freeze, preview, and survey creation preserve the revision gate', async () => {
    const calls = [];
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function (url, options) {
            calls.push({ url: url, options: options || {} });
            return jsonResponse(200, {});
        },
    });
    const body = { title: 'Reflection', sections: [] };

    await api.saveDraft('draft-1', 4, body);
    await api.freezeDraft('draft-1', 5);
    await api.createPreview('revision-1');
    await api.createSurvey('revision-1', {
        courseId: 'course-1',
        idempotencyKey: 'fixed-key-123',
        surveyLabel: 'Week 3',
        weekNumber: 3,
        opensAt: '2026-09-11T12:00:00.000Z',
        expiresAt: '2026-09-18T12:00:00.000Z',
    });

    assert.equal(calls[0].url, '/api/question_set_drafts/draft-1/');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        expected_version: 4,
        body: body,
    });
    assert.equal(calls[1].url, '/api/question_set_drafts/draft-1/freeze/');
    assert.equal(calls[2].url, '/api/question_set_revisions/revision-1/preview_capability/');
    assert.equal(calls[3].url, '/api/question_set_revisions/revision-1/surveys/');
    assert.deepEqual(JSON.parse(calls[3].options.body), {
        course_id: 'course-1',
        idempotency_key: 'fixed-key-123',
        survey_label: 'Week 3',
        week_number: 3,
        opens_at: '2026-09-11T12:00:00.000Z',
        expires_at: '2026-09-18T12:00:00.000Z',
    });
});

test('wizard surfaces structured API errors instead of treating HTTP 409 as success', async () => {
    const api = wizard.createApi({
        apiBase: '/api',
        authorizedFetch: async function () {
            return jsonResponse(409, { error: 'stale_draft' });
        },
    });

    await assert.rejects(
        api.saveDraft('draft-1', 1, {}),
        function (error) {
            return error.code === 'stale_draft' && error.status === 409;
        },
    );
});

test('survey idempotency key is stable for an exact revision', () => {
    assert.equal(
        wizard.idempotencyKeyForRevision('revision-123'),
        'question-set-survey-revision-123',
    );
});

test('mode switching only warns after the current mode has been edited', () => {
    assert.equal(wizard.shouldConfirmModeSwitch(false), false);
    assert.equal(wizard.shouldConfirmModeSwitch(true), true);
});

test('same-tab preview return state keeps only the identifiers needed to restore the wizard', () => {
    assert.deepEqual(
        wizard.buildPreviewReturnState(
            { id: 'draft-1', version: 3 },
            { id: 'revision-9' },
            'preview-token',
            'feedback.html?preview=preview-token',
        ),
        {
            draftId: 'draft-1',
            draftVersion: 3,
            revisionId: 'revision-9',
            previewToken: 'preview-token',
            previewUrl: 'feedback.html?preview=preview-token',
        },
    );
});

test('Prompt Designer exposes the real four-step wizard and keeps legacy schema setup secondary', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'PromptDesigner.html'),
        'utf8',
    );
    assert.match(html, /leai-question-set-wizard\.css/);
    assert.match(html, /leai-question-set-wizard\.js/);
    assert.match(html, /id="question-set-wizard-open"/);
    assert.match(html, /id="question-set-wizard-root"/);
    assert.match(html, /Advanced: use an existing course schema/);
    assert.match(html, /Create a new structured feedback/);
    assert.match(html, /Continue your previous session/);
    assert.match(html, /shouldConfirmModeSwitch\(modeDirty\[currentMode\]\)/);
    assert.match(html, /questionSetWizardController\.close\(false\)/);
    assert.match(html, /if \(restored !== false\) return/);
    assert.match(html, /leaiQuestionSetWizard\.mount/);
    const formSurveyRenderer = html.match(
        /function buildFormSurveyItem\(s\) \{([\s\S]*?)\n    function loadFormSurveys/,
    )[1];
    assert.match(
        formSurveyRenderer,
        /if \(!s\.question_set_revision_id\) \{[\s\S]*?appendChild\(dupBtn\)[\s\S]*?appendChild\(editBtn\)[\s\S]*?appendChild\(deleteBtn\)/,
    );
    assert.match(html, /s\.question_set_revision_id[\s\S]*?\? 'Structured feedback'/);
    assert.doesNotMatch(html, /close or duplicate it later/i);

    const source = fs.readFileSync(
        path.join(__dirname, '..', 'leai-question-set-wizard.js'),
        'utf8',
    );
    assert.match(source, /notice\.setAttribute\('aria-live', 'polite'\)/);
    assert.match(source, /event\.key === 'Tab'/);
    assert.match(source, /function markDirty\(\)[\s\S]*?secondaryButton\.textContent = 'Save draft'/);
    assert.match(source, /state\.drafts = state\.drafts\.map/);
    assert.match(source, /closeButton\.focus\(\);[\s\S]*?Promise\.all/);
    assert.match(source, /function focusEditorStart\(\)/);
    const busyBranch = source.match(/if \(busy\) \{([\s\S]*?)footerStatus\.textContent/)[1];
    assert.doesNotMatch(busyBranch, /closeButton/);
    const launchPreview = source.match(
        /function launchPreview\(\) \{([\s\S]*?)\n        function checkPreviewCompletion/,
    )[1];
    assert.doesNotMatch(launchPreview, /window\.open/);
    const previewRenderer = source.match(
        /function renderPreview\(\) \{([\s\S]*?)\n        function launchPreview/,
    )[1];
    assert.match(previewRenderer, /Open preview in a new tab/);
    assert.doesNotMatch(
        previewRenderer,
        /Open preview in this tab|qsw-preview-fallback|qsw-revision-card|Preview-ready version|Questions saved and locked|Opening it in this tab/,
    );
    assert.match(source, /var stepNames = \['Choose', 'Edit', 'Preview', 'Publish'\]/);
    assert.doesNotMatch(source, /ready to schedule|Continue to schedule|now schedule this revision/);
    assert.match(source, /Week \/ milestone is an optional organizing number shown only in your instructor survey list/);
    assert.doesNotMatch(source, /14-day default/);
    assert.match(
        source,
        /state\.previewCompleted = state\.previewCompleted \|\| !!result\.preview_completed/,
    );
    assert.match(source, /first answer needs more detail/);
    assert.match(source, /ariaLabel: 'Conversation area ' \+ \(index \+ 1\) \+ ' short label'/);
    assert.match(source, /ariaLabel: 'Conversation area ' \+ \(index \+ 1\) \+ ' main question'/);
    assert.match(source, /ariaLabel: 'Conversation area ' \+ \(index \+ 1\) \+ ' optional follow-up'/);
    assert.match(source, /onDraftsChanged/);
    assert.match(source, /restoreSameTabPreview/);
    assert.match(source, /api\.listDrafts\(activeCourse\.id\)[\s\S]*?notifyDraftsChanged\(\)/);
});

test('Prompt Designer columns resist long published-survey content', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'PromptDesigner.html'),
        'utf8',
    );

    assert.match(
        html,
        /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
});

test('question set wizard keeps its footer reachable when a notice collapses', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', 'leai-question-set-wizard.css'),
        'utf8',
    );
    const panel = css.match(/\.qsw-panel\s*\{([\s\S]*?)\n\}/)[1];
    assert.match(css, /\.qsw-panel:has\(\.qsw-notice:not\(\[hidden\]\)\)\s*\{/);
    const panelWithNotice = css.match(
        /\.qsw-panel:has\(\.qsw-notice:not\(\[hidden\]\)\)\s*\{([\s\S]*?)\n\}/,
    )[1];
    const content = css.match(/\.qsw-content\s*\{([\s\S]*?)\n\}/)[1];

    assert.match(panel, /height:\s*min\(860px,\s*calc\(100dvh - 48px\)\)/);
    assert.match(panel, /grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/);
    assert.match(panelWithNotice, /grid-template-rows:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/);
    assert.match(panel, /overflow:\s*hidden/);
    assert.match(content, /min-height:\s*0/);
    assert.match(content, /overflow:\s*auto/);
});

test('student page routes preview messages and completion away from research responses', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'feedback.html'),
        'utf8',
    );
    assert.match(html, /urlParams\.get\('preview'\)/);
    assert.match(html, /question_set_preview\/[\s\S]*?\/messages\//);
    assert.match(html, /question_set_preview\/[\s\S]*?\/complete\//);
    assert.match(html, /Practice answers never count as student responses/);
    assert.match(html, /previewPersistenceChain/);
    assert.match(html, /if \(previewPersistenceError\) throw previewPersistenceError/);
    assert.equal((html.match(/previewPersistenceError = null/g) || []).length, 1);
    assert.match(html, /Checking that every practice answer was saved/);
    assert.match(html, /completeQuestionSetPreview\(\)\.then[\s\S]*?notice\.textContent = 'Preview complete/);
    assert.match(html, /aria-label="Your answer"/);
    assert.match(html, /Return to builder/);
    assert.match(html, /Optional: revise or add to an answer/);
});
