'use strict';
// Synthetic API fixtures only. Exercises the actual student page and gestures.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const {chromium, firefox, webkit, expect} = createRequire(path.join(root, '../LEAI/package.json'))('@playwright/test');
const out = path.join(root, '.web-verify/legacy-resume-20261112');
fs.mkdirSync(out, {recursive:true});
const results = [];
const messages = Array.from({length:28}, (_, i) => ({
    sent_by:i % 2 ? 'user' : 'assistant',
    content:`Synthetic saved message ${i + 1}. ` + 'This original reflection must remain unchanged. '.repeat(4),
    created_at:`2026-10-20T12:${String(i).padStart(2, '0')}:00Z`,
}));
const schema = {engine:'orchestrator-v1', title:'Reflection', sections:[{id:'learning', title:'Learning', fields:[{id:'I11',kind:'shortform',label:'What did you learn?'}]}]};
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); return res.end(); }
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(data);
    });
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of Object.entries({chromium, firefox, webkit})) {
        const browser = await engine.launch({headless:true});
        try {
            for (const width of [390, 1440]) {
                for (const scenario of ['legacy', 'normal', 'read-failed']) {
                    const context = await browser.newContext({viewport:{width,height:900}});
                    const page = await context.newPage();
                    const errors = [], requests = [];
                    page.on('pageerror', e => errors.push(e.message));
                    await page.route('**/datapipeline/api/**', async route => {
                        const request = route.request(), pathname = new URL(request.url()).pathname;
                        const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'};
                        if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers});
                        requests.push(pathname);
                        let status = 200, body;
                        if (pathname.endsWith('/get_feedback_gpt_by_public_id/')) {
                            body = {id:351,public_id:'synthetic',name:'Synthetic historical reflection',is_active:true,mode:'form',identity_tracking_enabled:false,completion_certificate_enabled:true,parsed_document_download_enabled:false,form_schema_id:'synthetic',form_schema:{schema_id:'synthetic',body:schema}};
                        } else if (pathname.endsWith('/form_orchestration/session/')) {
                            if (scenario === 'normal') body = {version:1,status:'active',review_ready:false,schema,slots:{learning:{}},progress:{section_index:1,item_id:'I11',complete:false,label:'Question 1'},messages:[{sent_by:'ai-message',content:'What did you learn?',created_at:messages[0].created_at}]};
                            else { status = 409; body = {error:'existing_legacy_transcript'}; }
                        } else if (pathname.endsWith('/feedback_session_resume/')) {
                            if (scenario === 'read-failed') {status = 503; body = {error:'unavailable'};}
                            else body = {gpt_id:351,session_id:'synthetic-session',messages,count:messages.length};
                        } else if (pathname.endsWith('/legacy_debug/session/')) {
                            status = 401; body = {error:'authentication_required'};
                        } else { throw new Error('Unexpected API request: ' + pathname); }
                        await route.fulfill({status,headers,body:JSON.stringify(body)});
                    });
                    try {
                        await page.goto(base + '/LEAI/feedback.html?id=synthetic#cid=synthetic-session');
                        await page.locator('#consent-required').check();
                        await page.locator('#consent-continue-btn').click();
                        if (scenario === 'legacy') {
                            await expect(page.locator('.strip-action-certificate')).toBeEnabled();
                            await expect(page.locator('#transcription > article')).toHaveCount(28);
                            await expect(page.locator('#messageInput')).toBeEnabled();
                            await expect(page.locator('.chat-footer .input-area')).toBeVisible();
                            await expect(page.locator('#legacy-transcript-note')).toHaveCount(0);
                            assert.deepEqual(await page.locator('#transcription .msg-ai-text, #transcription .msg-student-text').allTextContents().then(v=>v.map(x=>x.trim())), messages.map(m=>m.content.trim()));
                            await page.screenshot({path:path.join(out,`${name}-${width}-top.png`)});
                            await page.locator('#transcription').hover();
                            // Firefox caps a single wheel delta to a few screens.
                            // Use repeated real gestures until the last turn is visible.
                            await expect(async () => {
                                await page.mouse.wheel(0, 1800);
                                await expect(page.locator('#transcription > article').last()).toBeInViewport({timeout:300});
                            }).toPass({timeout:20000, intervals:[150]});
                            await page.screenshot({path:path.join(out,`${name}-${width}-bottom.png`)});
                            await page.reload();
                            await expect(page.locator('#transcription > article')).toHaveCount(28);
                            await expect(page.locator('.strip-action-certificate')).toBeEnabled();
                            await expect(page.locator('#messageInput')).toBeEnabled();
                            await expect(page.locator('#orchestration-error')).toHaveCount(0);
                        } else if (scenario === 'normal') {
                            await expect(page.locator('#messageInput')).toBeEnabled();
                            await page.locator('#messageInput').fill('Unsent synthetic draft');
                            await expect(page.locator('#legacy-transcript-note')).toHaveCount(0);
                            assert.ok(!requests.some(p=>p.endsWith('/feedback_session_resume/')));
                        } else {
                            await expect(page.locator('#orchestration-error')).toContainText('Reload this page');
                            await expect(page.locator('#messageInput')).toBeDisabled();
                            await expect(page.locator('#transcription > article')).toHaveCount(0);
                        }
                        assert.deepEqual(errors, []);
                        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
                        results.push({browser:name,width,scenario,status:'PASS',requests});
                    } catch (error) {
                        await page.screenshot({path:path.join(out,`${name}-${width}-${scenario}-failure.png`)});
                        results.push({browser:name,width,scenario,status:'FAIL',error:error.message,errors,requests});
                        throw error;
                    } finally { await context.close(); }
                }
            }
        } finally { await browser.close(); }
    }
})().catch(error => {console.error(error);process.exitCode=1;}).finally(() => {
    fs.writeFileSync(path.join(out,'synthetic-results.json'), JSON.stringify(results,null,2));
    server.close();
    console.log(JSON.stringify(results.map(({browser,width,scenario,status})=>({browser,width,scenario,status}))));
});
