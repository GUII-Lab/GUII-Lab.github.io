'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const core = require('../leai-question-set-wizard.js');
const builder = require('../leai-feedback-builder-v12.js');

function response(status, payload) {
    return {ok: status < 400, status, text: async () => JSON.stringify(payload)};
}

test('v12 API carries the three-type taxonomy and old Team configuration unchanged', async () => {
    const calls = [];
    const api = core.createApi({
        apiBase: '/api',
        authorizedFetch: async (url, options = {}) => {
            calls.push({url, method: options.method || 'GET', body: options.body && JSON.parse(options.body)});
            return response(200, []);
        },
        fetch: async () => response(200, {}),
    });
    await api.createFeedbackDraft({
        courseId: 'course', audience: 'team', collectionStyle: 'guided',
        sourceKind: 'blank', sourceTemplateRevisionId: null,
    });
    await api.createSurvey('revision', {
        courseId: 'course', idempotencyKey: 'publish-revision', surveyLabel: 'Team check-in',
        previewToken: 'preview', teamConfigurationId: 7,
    });
    assert.deepEqual(calls[0].body, {
        course_id: 'course', audience: 'team', collection_style: 'guided',
        source_kind: 'blank', source_template_revision_id: null,
    });
    assert.equal(calls[1].body.team_configuration_id, 7);
});

test('PromptDesigner exposes one unified Feedback Builder instead of three creation modes', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'PromptDesigner.html'), 'utf8');
    assert.match(html, /leai-feedback-builder-v12\.js/);
    assert.match(html, /Create new feedback/);
    assert.match(html, /Your Feedback Surveys/);
    assert.match(html, /class="mode-tabs"[^>]*hidden/);
    assert.match(html, /leaiFeedbackBuilderV12\.mount/);
});

test('saved-age wording is human readable', () => {
    assert.equal(builder.elapsedLabel(new Date(Date.now() - 2000)), 'Saved just now');
    assert.match(builder.elapsedLabel(new Date(Date.now() - 65000)), /^Saved 1 minute ago$/);
});

let browser;
test.before(async () => {
    browser = await puppeteer.launch({headless: true, args: process.env.CI ? ['--no-sandbox'] : []});
});
test.after(async () => { if (browser) await browser.close(); });

const guidedBody = {
    schema_version: 'guided-feedback-v2',
    title: 'Weekly Reflection',
    intro: 'Reflect on this week.',
    sections: [
        {id: '11111111-1111-4111-8111-111111111111', title: 'Learning', questions: [{
            id: '22222222-2222-4222-8222-222222222222', short_label: 'Key idea',
            prompt: 'What stayed with you?', follow_up: {enabled: true, prompt: 'Why?'}, response_kind: 'long_text',
        }]},
        {id: '33333333-3333-4333-8333-333333333333', title: 'Next step', questions: [{
            id: '44444444-4444-4444-8444-444444444444', short_label: 'Action',
            prompt: 'What will you do next?', follow_up: {enabled: false, prompt: ''}, response_kind: 'long_text',
        }]},
    ],
    closing: {prompt: 'Anything else?'},
};

async function mount(t, viewport = {width: 1180, height: 760}) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.setViewport(viewport);
    await page.setContent('<button id="open">Create new feedback</button><button id="resume" hidden>Continue your previous session</button><div id="root" hidden></div>');
    await page.addStyleTag({path: path.join(__dirname, '..', 'leai-feedback-builder-v12.css')});
    await page.addScriptTag({path: path.join(__dirname, '..', 'leai-question-set-wizard.js')});
    await page.addScriptTag({path: path.join(__dirname, '..', 'leai-feedback-builder-v12.js')});
    await page.evaluate(body => {
        window.fixture = {
            calls: [], confirmCount: 0, body, version: 1, ready: false, skipped: false,
            activeDraft: null,
        };
        window.confirm = () => { fixture.confirmCount += 1; return true; };
        window.fetcher = async (url, options = {}) => {
            const data = options.body ? JSON.parse(options.body) : null;
            fixture.calls.push({url, method: options.method || 'GET', data});
            let payload = {};
            if (url.includes('/question_set_templates/?')) {
                const team = url.includes('audience=team');
                payload = {templates: [{id: team ? 'team-template' : 'weekly-template', revision_id: team ? 'team-r1' : 'weekly-r1',
                    revision_number: 1, name: team ? 'Team Collaboration Check-in' : 'Weekly Reflection',
                    description: 'A useful starting point', source: 'leai'}]};
            } else if (url.includes('/question_set_drafts/?')) {
                payload = {drafts: fixture.activeDraft ? [fixture.activeDraft] : []};
            } else if (url.endsWith('/question_set_drafts/') && options.method === 'POST') {
                fixture.version = 1;
                fixture.activeDraft = {id: 'draft-1', version: 1, audience: data.audience,
                    collection_style: data.collection_style, workflow_status: 'active', updated_at: new Date().toISOString(),
                    body: JSON.parse(JSON.stringify(fixture.body))};
                if (data.audience === 'team') fixture.activeDraft.body.title = 'Team Collaboration Check-in';
                payload = fixture.activeDraft;
            } else if (url.endsWith('/question_set_drafts/draft-1/') && options.method === 'PATCH') {
                if (fixture.holdSave) {
                    await new Promise(resolve => { fixture.releaseSave = resolve; });
                    fixture.holdSave = false;
                }
                fixture.version += 1;
                fixture.activeDraft.version = fixture.version;
                fixture.activeDraft.body = data.body;
                fixture.activeDraft.updated_at = new Date().toISOString();
                payload = fixture.activeDraft;
            } else if (url.endsWith('/question_set_drafts/draft-1/')) {
                payload = fixture.activeDraft;
            } else if (url.endsWith('/versions/')) {
                payload = {versions: [{id: 'version-1', version_number: 1, author_kind: 'system', summary: 'Starting point'}]};
            } else if (url.endsWith('/authoring_conversation/')) {
                payload = {conversation: {messages: []}};
            } else if (url.endsWith('/freeze/')) {
                payload = {revision: {id: 'revision-1'}};
            } else if (url.endsWith('/preview_capability/')) {
                payload = {token: 'preview-1', preview_url: 'feedback.html?preview=preview-1',
                    ready_at: new Date(Date.now() + 250).toISOString(), completion_certificate_enabled: true,
                    parsed_document_download_enabled: false};
                setTimeout(() => { fixture.ready = true; }, 280);
            } else if (url.endsWith('/question_set_preview/preview-1/')) {
                if (!fixture.ready) return {ok: false, status: 425, text: async () => JSON.stringify({error: 'preview_preparing', ready_at: new Date(Date.now() + 150).toISOString(), retry_after_ms: 80})};
                payload = {preview_completed: false, preview_skipped: fixture.skipped,
                    completion_certificate_enabled: true, parsed_document_download_enabled: false};
            } else if (url.endsWith('/skip/')) {
                fixture.skipped = true; payload = {preview_skipped: true};
            } else if (url.endsWith('/settings/')) {
                payload = data;
            } else if (url.includes('/team_configurations/?')) {
                payload = [{id: 7, name: 'Lab teams', teams: [{number: 1, size: 2}, {number: 2, size: 2}]}];
            } else if (url.endsWith('/surveys/')) {
                payload = {public_id: 'shared-team-link', survey_label: data.survey_label, mode: data.team_configuration_id ? 'group' : 'form'};
                fixture.activeDraft = null;
            } else {
                throw new Error('Unexpected route ' + url);
            }
            return {ok: true, status: 200, text: async () => JSON.stringify(payload)};
        };
        window.controller = leaiFeedbackBuilderV12.mount({
            root: '#root', openButton: '#open', resumeButton: '#resume', apiBase: '/api',
            authorizedFetch: fetcher, fetch: fetcher, getCourse: () => ({id: 'course', name: 'Course'}),
        });
    }, guidedBody);
    await page.evaluate(() => controller.refreshDrafts());
    return page;
}

async function realClick(page, selector) {
    const point = await page.$eval(selector, node => {
        node.scrollIntoView({block: 'center', inline: 'center'});
        const box = node.getBoundingClientRect();
        return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    });
    await page.mouse.click(point.x, point.y);
}

async function enterIndividualGuided(page) {
    await realClick(page, '#open');
    await realClick(page, '[data-audience="individual"]');
    await realClick(page, '[data-style="guided"]');
    await page.waitForSelector('[data-template]');
    await realClick(page, '[data-template]');
    await realClick(page, '[data-start]');
    await page.waitForSelector('.fbv12-artifact');
}

test('manual removal is immediate, autosaved, and never asks for deletion confirmation', {timeout: 15000}, async t => {
    const page = await mount(t);
    await enterIndividualGuided(page);
    assert.equal(await page.$$eval('.fbv12-section', nodes => nodes.length), 2);
    await realClick(page, '[data-remove-section]');
    assert.equal(await page.$$eval('.fbv12-section', nodes => nodes.length), 1);
    await new Promise(resolve => setTimeout(resolve, 1450));
    const result = await page.evaluate(() => ({
        confirmCount: fixture.confirmCount,
        save: fixture.calls.find(call => call.method === 'PATCH' && call.url.endsWith('/question_set_drafts/draft-1/')),
        savedLabels: Array.from(document.querySelectorAll('[data-saved]')).map(node => node.textContent),
    }));
    assert.equal(result.confirmCount, 0);
    assert.equal(result.save.data.body.sections.length, 1);
    assert.equal(result.savedLabels.length, 1);
    assert.match(result.savedLabels[0], /^Saved/);
});

test('typing during an in-flight autosave is preserved by a follow-up save', {timeout: 15000}, async t => {
    const page = await mount(t);
    await enterIndividualGuided(page);
    await page.evaluate(() => { fixture.holdSave = true; });
    const title = '[data-field="title"]';
    await page.focus(title);
    await page.keyboard.press('End');
    await page.keyboard.type(' first');
    await new Promise(resolve => setTimeout(resolve, 1300));
    await page.keyboard.type(' second');
    await page.evaluate(() => fixture.releaseSave());
    await new Promise(resolve => setTimeout(resolve, 1500));
    const saves = await page.evaluate(() => fixture.calls.filter(call => call.method === 'PATCH'));
    assert.ok(saves.length >= 2);
    assert.equal(saves[saves.length - 1].data.body.title, 'Weekly Reflection first second');
});

test('Team keeps the old one-link self-selection flow and accepts a two-person team', {timeout: 15000}, async t => {
    const page = await mount(t);
    await realClick(page, '#open');
    await realClick(page, '[data-audience="team"]');
    await page.waitForSelector('[data-template]');
    await realClick(page, '[data-template]');
    await realClick(page, '[data-start]');
    await page.waitForSelector('.fbv12-artifact');
    await realClick(page, '[data-generate]');
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal(await page.$('.fbv12-preview-card') !== null, true);
    await realClick(page, '[data-skip]');
    await page.waitForSelector('#fbv12-team');
    await page.select('#fbv12-team', '7');
    await realClick(page, '[data-publish]');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.$('.fbv12-receipt') !== null, true);
    const published = await page.evaluate(() => fixture.calls.find(call => call.url.endsWith('/surveys/')).data);
    assert.equal(published.team_configuration_id, 7);
    assert.equal(await page.$eval('.fbv12-receipt a', node => node.textContent), 'feedback.html?id=shared-team-link');
});

test('the builder reflows without page-level horizontal overflow', {timeout: 15000}, async t => {
    const page = await mount(t, {width: 390, height: 780});
    await enterIndividualGuided(page);
    const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        panel: document.querySelector('.fbv12-panel').getBoundingClientRect().width,
    }));
    assert.equal(metrics.scroll, metrics.viewport);
    assert.ok(metrics.panel <= metrics.viewport);
});
