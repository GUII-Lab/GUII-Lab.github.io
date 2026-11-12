'use strict';
// Real production HTML with isolated synthetic API transport. No remote writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
// Reuse installed browser tooling only; the React app is not a build input.
const tooling = createRequire(path.join(root, '../LEAI/package.json'));
const {chromium, firefox, webkit, expect} = tooling('@playwright/test');
const arg = name => process.argv.find(item => item.startsWith('--' + name + '='))?.split('=')[1];
const out = path.resolve(root, arg('out') || '.web-verify/production-compact-chat-20261111');
fs.mkdirSync(out, {recursive:true});
const certificates = arg('certificates') !== 'false';
const engines = arg('browser') ? [arg('browser')] : ['chromium', 'firefox', 'webkit'];
const surfaces = arg('surface') ? [arg('surface')] : ['student', 'group', 'group-orchestrated', 'feedback'];
const widths = arg('width') ? [Number(arg('width'))] : [390, 820, 1022, 1440];
const results = [], shots = [];
const surveyId = 'synthetic-composer-survey', courseId = 'SYNTHETIC-COMPOSER';
const chatId = '550e8400-e29b-41d4-a716-446655440020';
const stamp = '2026-11-11T12:00:00Z';
const question = 'What helped you learn this week?';
const schema = {engine:'orchestrator-v1', schema_id:'synthetic-composer', version:'1', title:'Weekly reflection', sections:[{id:'learning', title:'Learning', fields:[{id:'P1',kind:'shortform',label:question}]}]};
const draft = Array.from({length:32}, (_,i) => `Draft line ${i + 1}: I want to explain this experience in more detail.`).join('\n');
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let name = decodeURIComponent(url.pathname);
    let file;
    if (name.startsWith('/before/LEAI/') && /\/(feedback|FeedbackChat)\.html$/.test(name)) file = path.join(out, 'before', name.slice('/before/'.length));
    else file = path.resolve(root, '.' + name.replace(/^\/before\//, '/'));
    if (!file.startsWith(root + path.sep) || !/\.(html|js|css|png|svg|mp4)$/.test(file)) { res.writeHead(404); res.end(); return; }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'image/svg+xml');
        res.end(data);
    });
});

async function fixtures(context, base, surface) {
    const unexpected = [], errors = [], submitted = [];
    let seq = 1;
    const state = {version:1, status:'active', review_ready:false, schema, slots:{learning:{}}, progress:{section_index:1,item_id:'P1',complete:false,label:'Question 1 of 1 · Learning'}, messages:[{sequence:1,sent_by:'ai-message',content:question,form_field_id:'P1',created_at:stamp}]};
    if (surface === 'group-orchestrated') state.team_context = {survey_team_id:1,name:'Example team',anonymity_mode:'anonymous'};
    const summary = {id:chatId,title:'Weekly feedback',scope:{kind:'course'},updated_at:stamp};
    const chat = {...summary,corpus:[],messages:[{id:1,role:'assistant',text:'What would you like to know about this feedback?',created_at:stamp}]};
    await context.addInitScript(({courseId}) => {
        sessionStorage.setItem('leai_session', JSON.stringify({courseId,courseName:'Synthetic UI review',response_export_token:'synthetic-fixture-token'}));
        class Recognition { start() {} stop() {} abort() {} }
        window.SpeechRecognition = Recognition;
    }, {courseId});
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
        if (pathname.startsWith('/datapipeline/api/')) {
            const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Content-Type':'application/json'};
            if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers});
            let json;
            if (pathname.endsWith('/get_feedback_gpt_by_public_id/')) json = {id:101,public_id:surveyId,name:'Weekly reflection',survey_label:'Weekly reflection with a longer course title',is_active:true,mode:surface.startsWith('group') ? 'group' : 'form',instructions:'Ask one reflection question.',identity_tracking_enabled:false,completion_certificate_enabled:certificates,parsed_document_download_enabled:false,
                ...(surface.startsWith('group') ? {team_snapshot:{name:'Course teams',color:'forest',label_prefix:'Team',teams:[{id:1,number:1,display_name:'Example team'}]}} : {}),
                ...(surface !== 'group' ? {form_schema_id:'synthetic-composer',form_schema:{schema_id:'synthetic-composer',body:schema}} : {})};
            else if (pathname.endsWith('/form_orchestration/session/')) json = state;
            else if (pathname.endsWith('/form_orchestration/turn/')) {
                const data = request.postDataJSON(); submitted.push(data.text);
                state.review_ready=true; state.progress.complete=true;
                state.version++;state.messages.push({sequence:++seq,sent_by:'user-message',content:data.text,form_field_id:'P1',created_at:stamp});
                state.messages.push({sequence:++seq,sent_by:'ai-message',content:'Thank you. Is there anything else you would like to add?',form_field_id:'P1',created_at:stamp}); json = state;
            }
            else if (pathname.endsWith('/openai-chat/')) { const data=request.postDataJSON();submitted.push(data.user_text);json={response:question}; }
            else if (pathname.endsWith('/feedback_message_api/')) json = {id:++seq};
            else if (pathname.endsWith('/session_team_assignment/')) json = {ok:true};
            else if (pathname.endsWith('/legacy_analyzer/surveys/')) json = {surveys:[]};
            else if (pathname.endsWith('/leai_chat_sessions/')) json = {sessions:[summary]};
            else if (pathname.endsWith(`/leai_chat_sessions/${chatId}/`) && request.method() === 'PATCH') json = {...summary,...request.postDataJSON()};
            else if (pathname.endsWith(`/leai_chat_sessions/${chatId}/`)) json = chat;
            else if (pathname.endsWith(`/leai_chat_sessions/${chatId}/turn/`)) { const data=request.postDataJSON();submitted.push(data.user_text);json={message:{id:2},user_message:{id:3},session_updated_at:stamp}; }
            else if (pathname.endsWith(`/leai_chat_sessions/${chatId}/messages/2/`)) json = {id:2,role:'assistant',status:'ready',text:'Here is a synthetic reply.',created_at:stamp};
            else { unexpected.push(request.method() + ' ' + pathname); return route.fulfill({status:501,headers,body:JSON.stringify({error:'Unexpected fixture request'})}); }
            return route.fulfill({status:200,headers,body:JSON.stringify(json)});
        }
        if (url.origin === base || ['code.jquery.com','cdn.tailwindcss.com','cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) return route.continue();
        unexpected.push(request.method() + ' ' + url.origin + pathname); return route.abort();
    });
    return {unexpected, errors, submitted};
}

async function enter(page, base, surface, prefix='') {
    if (surface === 'feedback') {
        await page.goto(base + prefix + '/LEAI/FeedbackChat.html?session=' + chatId);
        await expect(page.locator('#chat-input-area')).toBeVisible();
    } else {
        await page.goto(base + prefix + '/LEAI/feedback.html?id=' + surveyId);
        await expect(page.locator('#consent-modal')).toBeVisible();
        await page.locator('#consent-required').check();
        await page.locator('#consent-continue-btn').click();
        if (surface.startsWith('group')) {
            await page.getByRole('button', {name:'I understand, continue →'}).click();
            await page.locator('#tp-select').selectOption('1');
            await page.getByRole('button', {name:'Continue',exact:true}).click();
        }
        await expect(page.locator('#messageInput')).toBeEnabled();
        await expect(page.locator('#transcription')).toContainText(question);
    }
}

async function capture(page, name) {
    await page.screenshot({path:path.join(out,name + '.png'),animations:'disabled'});
    shots.push(name + '.png');
}

(async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:' + server.address().port;
    let failed = false;
    try {
        for (const engine of engines) {
            const browser = await ({chromium,firefox,webkit}[engine]).launch({headless:true});
            try {
                for (const surface of surfaces) for (const width of widths) {
                    const label = `${engine}-${surface}-${width}`;
                    const context = await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true,locale:'en-US'});
                    const fixture = await fixtures(context,base,surface);
                    const page = await context.newPage();
                    page.on('pageerror', error => fixture.errors.push(error.message));
                    try {
                        await enter(page,base,surface);
                        const input = page.locator(surface === 'feedback' ? '#chat-input' : '#messageInput');
                        const expand = page.getByRole('button',{name:'Expand message editor',exact:true});
                        const tip = page.getByRole('note',{name:'Revision tip'});
                        await expect(page.locator('.leai-composer-notice').first()).toBeVisible();
                        await expect(expand).toBeHidden();
                        const compact = async () => {
                            const rects = await page.locator('.leai-composer').evaluate(el => {
                                const box = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
                                return {host:box(el),input:box(el.querySelector('textarea')),send:box(el.querySelector('#sendMessage, #send-btn')),mic:el.querySelector('#micButton') ? box(el.querySelector('#micButton')) : null};
                            });
                            assert.ok(rects.host.height <= 64, 'Empty/short composer is a single compact row');
                            assert.ok(Math.abs(rects.input.y-rects.send.y)<=2, 'Input and send share a row');
                            assert.ok(rects.input.x+rects.input.width<=rects.send.x,'Input does not overlap send');
                            if(rects.mic) assert.ok(rects.input.x+rects.input.width<=rects.mic.x,'Input does not overlap mic');
                        };
                        await compact();
                        if(engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-empty');
                        const disclosure = page.locator('.leai-download-disclosure');
                        if (surface !== 'feedback' && certificates) {
                            await expect(disclosure).toBeVisible();
                            await expect(disclosure).toHaveAttribute('open','');
                            await expect(disclosure.locator('.strip-action-certificate')).toBeDisabled();
                            if(engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-first-open');
                            await disclosure.locator('summary').click();
                            await expect(disclosure).not.toHaveAttribute('open');
                            await disclosure.locator('summary').focus();
                            await page.keyboard.press('Enter');
                            await expect(disclosure).toHaveAttribute('open','');
                        } else await expect(disclosure).toHaveCount(0);
                        await input.fill('Short thought.');
                        await compact();
                        if(surface !== 'feedback' && certificates) {
                            await expect(disclosure).not.toHaveAttribute('open');
                            await disclosure.locator('summary').click();
                            await input.fill('I can reopen the panel while writing.');
                            await expect(disclosure).toHaveAttribute('open','');
                            await disclosure.locator('summary').click();
                        }
                        await input.fill('Short thought.');
                        await compact();
                        if(engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-single-row');
                        await input.fill('One line.\nA second line.');
                        await expect(expand).toBeHidden();
                        if (surface !== 'feedback') {
                            await expect(tip.locator('.revise-hint-icon')).toHaveCount(0);
                            if (engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-tip');
                            await page.getByRole('button',{name:'Dismiss revision tip'}).click();
                            await expect(tip).toBeHidden();
                            const header = await page.locator('#chat-app > .chat-header').boundingBox();
                            const messages = await page.locator('.main-content').boundingBox();
                            assert.ok(header.bottom === undefined ? header.y+header.height<=messages.y+1 : header.bottom<=messages.y+1,'Header stays above messages/progress');
                            if(surface==='student') {
                                const progress = await page.locator('#formmode-progress').boundingBox();
                                assert.ok(header.y+header.height<=progress.y+1,'Header and progress do not overlap');
                            }
                        }
                        if (engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-compact');
                        await input.fill(draft);
                        await expect(expand).toBeVisible();
                        const size = await input.evaluate(el=>({height:el.clientHeight,content:el.scrollHeight}));
                        assert.ok(size.content>size.height && size.height<=(width<640?160:256),'Capped internal scroll');
                        await input.hover();
                        await page.mouse.wheel(0,-10000);
                        await page.mouse.wheel(0,120);
                        await expect(expand).toBeVisible();
                        assert.equal(await page.locator('.leai-composer').getByRole('button',{name:/attach/i}).count(),0,'No attachment button');
                        if (engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-long');
                        await expand.click();
                        const dialog=page.getByRole('dialog',{name:'Message editor'});
                        await expect(dialog).toBeVisible();
                        assert.equal(await dialog.locator('textarea').inputValue(),draft,'Same draft in modal');
                        await expect(dialog.locator('textarea')).toBeFocused();
                        const rect=await dialog.boundingBox();
                        if(width<640){assert.equal(Math.round(rect.width),width);assert.equal(Math.round(rect.height),900);assert.equal(Math.round(rect.y),0);}
                        await input.press('End'); await input.pressSequentially(' More.');
                        if (engine==='chromium' && [390,1440].includes(width)) await capture(page,label+'-expanded');
                        if(width<640){await page.setViewportSize({width,height:460});await expect.poll(async()=>Math.round((await dialog.boundingBox()).height)).toBe(460);await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeInViewport();await page.setViewportSize({width,height:900});}
                        await page.getByRole('button',{name:'Collapse message editor'}).click();
                        await expect(dialog).not.toBeVisible();
                        assert.ok((await input.inputValue()).includes(' More.'),'Edited draft survives collapse');
                        await expect(input).toBeFocused();
                        await input.fill('Short again.'); await expect(expand).toBeHidden();
                        await input.fill(''); await expect(expand).toBeHidden();
                        await input.fill(draft); await expand.click();
                        const before=fixture.submitted.length;
                        await input.fill('A final thought from the expanded editor.');
                        if(width<640){await input.press('Enter');assert.equal(fixture.submitted.length,before,'Mobile Enter does not send');await dialog.getByRole('button',{name:'Send',exact:true}).click();}
                        else await input.press('Enter');
                        await expect(dialog).not.toBeVisible();
                        await expect.poll(()=>fixture.submitted.length).toBe(before+1);
                        await expect(input).toHaveValue(''); await expect(expand).toBeHidden();
                        await compact();
                        if(surface!=='feedback' && certificates) {
                            await expect(disclosure.locator('.strip-action-certificate')).toBeEnabled();
                            await expect(disclosure).toHaveAttribute('open','');
                            await expect(disclosure.locator('summary')).toContainText('ready');
                            await disclosure.locator('summary').click();
                            await expect(disclosure).not.toHaveAttribute('open');
                        }
                        if(surface!=='feedback') await expect(tip).toBeHidden();
                        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow');
                        assert.deepEqual(fixture.errors,[],'No page errors');assert.deepEqual(fixture.unexpected,[],'No unexpected API/provider requests');
                        results.push({name:label,status:'PASS',checks:['single-row empty/short/reset','certificate first-open/manual toggle/first-edit collapse/unlock reopen','short/empty hidden','overflow-only expand','internal scroll','draft/focus','full-screen mobile','send once','notice','tip dismissal','header/progress','no attachments','no horizontal overflow']});
                        console.log('PASS ' + label);
                    } catch(error) { failed=true;await capture(page,label+'-FAIL');results.push({name:label,status:'FAIL',error:error.message,errors:fixture.errors,unexpected:fixture.unexpected});console.error('FAIL '+label+' '+error.message);throw error; }
                    finally { await context.close(); }
                }
            } finally { await browser.close(); }
        }
    } catch(error) { process.exitCode=1; }
    finally { server.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,shots,failed,boundary:'Actual production HTML on local ephemeral server; synthetic API transport only. No remote API/provider writes or deployment.'},null,2)); }
})();
