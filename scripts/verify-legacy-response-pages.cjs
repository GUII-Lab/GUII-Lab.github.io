// Real local Django + PostgreSQL verification. No business API interception.
// Optional: LEAI_PLAYWRIGHT_MODULE=/path/to/playwright if not locally installed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium, firefox, webkit} = require(process.env.LEAI_PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.LEAI_RESPONSE_VERIFY_DIR || '.web-verify/response-pagination-20261111');
fs.mkdirSync(output, {recursive:true});
const origin = process.env.LEAI_RESPONSE_VERIFY_ORIGIN || 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(origin).hostname)) throw Error('Synthetic verification is local-only.');
const results = {engines:[], failures:[]};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(name, engine) {
    const browser = await engine.launch({headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    const calls=[];const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.url().includes('/datapipeline/api/')) calls.push({method:request.method(),path:new URL(request.url()).pathname});
    });
    await context.route('**/*', async route => {
        const request=route.request(),url=new URL(request.url());
        if (url.pathname.startsWith('/datapipeline/api/') && request.method()!=='GET' && request.method()!=='OPTIONS' && !url.pathname.endsWith('/verify_course_password/')) {
            errors.push('Unexpected mutation '+url.pathname);return route.abort();
        }
        return route.continue();
    });
    const captures=[];
    async function capture(label) {
        const filename=name+'-'+label+'.png';
        await page.screenshot({path:path.join(output,filename),fullPage:false});captures.push(filename);
    }
    try {
        await page.goto(origin+'/LEAI/FeedbackAnalyzer.html',{waitUntil:'domcontentloaded'});
        await page.locator('#login-course-id').fill(process.env.LEAI_RESPONSE_VERIFY_COURSE || 'synthetic-pagination');
        await page.locator('#login-password').fill(process.env.LEAI_RESPONSE_VERIFY_PASSWORD || 'synthetic-pagination-only');
        await page.locator('#login-btn').click();
        await page.locator('#student-responses-list .student-card').first().waitFor({timeout:20000});
        await page.waitForFunction(()=>document.querySelector('#response-page-controls [role="status"]')?.textContent==='25 of 74 responses loaded');
        assert.equal(await page.locator('#student-responses-list .student-card').count(),25);
        assert.equal(calls.filter(c=>c.path.endsWith('/legacy_analyzer/detail/')).length,0,'Collapsed cards must not fetch details');
        assert.equal(calls.filter(c=>c.path.endsWith('/feedback_messages_by_course/')).length,0,'Initial UI must not use full-course transcript endpoint');
        assert.equal(calls.filter(c=>c.path.endsWith('/legacy_analyzer/corpus/')).length,0,'Closed analysis must not download response text');
        const metrics=await page.locator('#stats-row').innerText();assert.match(metrics,/74/);
        await page.locator('#quick-take-container .sources-toggle').click();
        await page.locator('#quick-take-container .sources-list').filter({hasText:'Synthetic answer form1-s000'}).waitFor();
        assert.equal(calls.filter(c=>c.path.endsWith('/legacy_analyzer/detail/')).length,1);
        await capture('source-drawer');
        await page.locator('#quick-take-container .sources-toggle').click();
        await page.locator('#quick-take-container .qt-insight-section > summary').filter({hasText:'What students are saying'}).click();
        await page.locator('#quick-take-container .qt-claim-count').first().click();
        await page.locator('#quick-take-container .qt-quote-src').first().click();
        await page.getByRole('dialog',{name:'Cited conversation'}).filter({hasText:process.env.LEAI_RESPONSE_VERIFY_ASSISTANT || 'Synthetic assistant-only detail form1-s000'}).waitFor();
        await capture('citation');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog',{name:'Cited conversation'}).waitFor({state:'hidden'});
        await page.locator('#traditional-analysis-section > summary').click();
        await page.locator('#ngram-chart .ngram-row').first().waitFor();
        assert.equal(calls.filter(c=>c.path.endsWith('/legacy_analyzer/corpus/')).length,1);
        await page.locator('#keyness-btn').click();
        await page.waitForFunction(()=>document.querySelector('#ngram-chart .ngram-row'));
        await page.locator('#traditional-analysis-section > summary').click();
        await page.locator('#student-responses-list .student-card-header').first().click();
        await page.locator('#student-responses-list .student-card').first().locator('.convo-msg').first().waitFor();
        assert.equal(calls.filter(c=>c.path.endsWith('/legacy_analyzer/detail/')).length,1);
        await capture('expanded');
        const firstText=await page.locator('#student-responses-list .student-card').first().innerText();
        assert.match(firstText,/Synthetic answer form1-s000/);assert.ok(firstText.includes(process.env.LEAI_RESPONSE_VERIFY_ASSISTANT || 'Synthetic assistant-only detail form1-s000'));
        // Actual wheel movement triggers the IntersectionObserver; subsequent button
        // gesture is a fallback only when the sentinel is below the new viewport.
        await page.locator('#response-page-controls').scrollIntoViewIfNeeded();
        await page.mouse.wheel(0,500);
        await page.waitForFunction(()=>document.querySelectorAll('#student-responses-list .student-card').length>=50);
        assert.equal(await page.locator('#student-responses-list .student-card').first().evaluate(card=>card.classList.contains('open')),true);
        await page.locator('#response-page-controls').scrollIntoViewIfNeeded();await page.mouse.wheel(0,500);
        await page.waitForFunction(()=>document.querySelectorAll('#student-responses-list .student-card').length===74);
        const ids=await page.locator('#student-responses-list .student-card').evaluateAll(cards=>cards.map(c=>c.dataset.sessionId));
        assert.equal(new Set(ids).size,74);
        const labels=await page.locator('#student-responses-list .student-card-label').allTextContents();
        assert.deepEqual(labels,Array.from({length:74},(_,i)=>'R'+(i+1)));
        await capture('all-loaded');
        // Scope changes leave full-scope counts and independent analysis intact.
        await page.locator('#scope-bar .scope-chip').filter({hasText:'Week 2'}).click();
        await page.waitForFunction(()=>document.querySelector('#response-page-controls [role="status"]')?.textContent==='12 of 12 responses loaded');
        assert.match(await page.locator('#stats-row').innerText(),/12/);
        assert.match(await page.locator('#student-responses-list .student-card-label').first().innerText(),/^R1$/);
        // Source/nudge filters must not narrow totals or renumber surviving R labels.
        await page.locator('#scope-bar .scope-chip').filter({hasText:'Week 1'}).click();
        await page.waitForFunction(()=>document.querySelector('#response-page-controls [role="status"]')?.textContent==='25 of 74 responses loaded');
        const nudged=page.locator('#student-responses-toolbar button').filter({hasText:'Nudged only'});
        await nudged.click();
        await page.waitForFunction(()=>document.querySelector('#response-page-controls [role="status"]')?.textContent==='7 of 7 responses loaded');
        assert.match(await page.locator('#stats-row').innerText(),/74/);
        assert.deepEqual(await page.locator('#student-responses-list .student-card-label').allTextContents(),['R1','R12','R23','R34','R45','R56','R67']);
        await capture('filtered');
        // Direct-link target is beyond the first page and ignores saved view filters.
        await page.goto(origin+'/LEAI/FeedbackAnalyzer.html#response=1&mode=form&week=1&session=pdf-only',{waitUntil:'domcontentloaded'});
        await page.locator('#response-detail-card .pdf-document').waitFor({timeout:20000}).catch(async()=>{
            await page.locator('#response-detail-card').filter({hasText:'Synthetic PDF reflection'}).waitFor({timeout:20000});
        });
        assert.match(await page.locator('#response-detail-card').innerText(),/Synthetic PDF reflection/);
        await capture('pdf-direct-link');
        await page.goBack();
        await page.locator('.mode-tabs').waitFor();
        assert.equal(await page.locator('#mode-panel-response-detail').isVisible(),false);
        await page.goto(origin+'/LEAI/FeedbackAnalyzer.html#response=1&mode=form&week=1&session=pdf-only&survey=1',{waitUntil:'domcontentloaded'});
        await page.locator('#response-detail-card').filter({hasText:'Synthetic PDF reflection'}).waitFor();
        await page.locator('#response-detail-back').click();
        await page.locator('#student-responses-toolbar button').filter({hasText:'All responses'}).click();
        await page.waitForFunction(()=>document.querySelectorAll('#student-responses-list .student-card').length===25);
        // One deliberate transport fault, only after real positive controls, verifies retry.
        let failed=false;
        await page.route('**/legacy_analyzer/responses/**',async route=>{
            if(!failed && new URL(route.request().url()).searchParams.has('cursor')){failed=true;return route.abort('failed');}
            return route.continue();
        });
        await page.locator('#response-page-controls').scrollIntoViewIfNeeded();await page.mouse.wheel(0,500);
        await page.getByRole('button',{name:'Retry loading',exact:true}).waitFor();
        assert.equal(await page.locator('#student-responses-list .student-card').count(),25);
        await page.getByRole('button',{name:'Retry loading',exact:true}).click();
        await page.waitForFunction(()=>document.querySelectorAll('#student-responses-list .student-card').length>=50);
        await page.unroute('**/legacy_analyzer/responses/**');
        // Verify phone layout and a real card gesture without forcing all content open.
        await page.setViewportSize({width:390,height:844});
        await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=1);
        await page.locator('#student-responses-section').scrollIntoViewIfNeeded();
        await page.locator('#student-responses-list .student-card-header').first().click();
        await capture('phone');
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
        assert.equal(overflow,false,'Phone must not horizontally overflow');
        const headerBounds=await page.locator('#student-responses-list .student-card-header').first().boundingBox();
        assert.ok(headerBounds.x>=-1 && headerBounds.x+headerBounds.width<=391,'Phone response header must remain inside the viewport');
        assert.deepEqual(errors,[]);
        results.engines.push({name,passed:true,requests:calls.length,detailRequests:calls.filter(c=>c.path.endsWith('/legacy_analyzer/detail/')).length,captures,checks:['summary-only initial load','source drawer loads actual response','citation opens full transcript with Escape','analysis deferred until opened','selected-scope frequency and keyness loading','lazy chat detail','native infinite scroll','complete unique 74-row traversal','expansion preserved','full-scope counts','stable filtered labels','later-page PDF direct link','browser Back restores list','failed-page retry','390px layout'],faultInjection:'One next-page request aborted after positive control; all other business requests used real Django/PostgreSQL.'});
    } catch(error) {
        await capture('failure').catch(()=>{});
        results.failures.push({name,error:error.message,stack:error.stack,errors,captures});
        throw error;
    } finally {
        fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));
        await browser.close();
    }
}
(async()=>{
    for(const [name,engine] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]) await run(name,engine);
    console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
