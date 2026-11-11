'use strict';
// Local UI regression using synthetic API fixtures. No remote API requests or writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.web-verify/analyzer-comments-20261023');
fs.mkdirSync(out, {recursive:true});
const quote = 'I made a game with looping choices and three resources.';
const sessions = Object.fromEntries(Array.from({length:7}, (_,i) => ['session-'+(i+1), [
  {sent_by:'ai-message',content:'What did you learn from making the game?'},
  {sent_by:'user-message',content:i===6 ? quote : 'I learned how feedback and choices affect players.'},
  {sent_by:'assistant',content:'How did that affect your experience of the assignment?'},
  {sent_by:'user',content:'The examples helped me connect the ideas to my project.'},
]]));
const surveys = [1,2,3].map(week => ({gpt_id:week, week_number:week, mode:'form',survey_label:'Week '+week+' · Individual reflection',session_count:week===1?7:week===2?4:6,sessions:week===1?sessions:{'session-7':[{sent_by:'user',content:'Different week: never show in Week 1 citation.'}]}}));
const qt = {status:'ready',updated_at:new Date().toISOString(),responses_count_at_generation:7,
 gaps:[{topic:'Course pacing',note:'No direct comments on the overall pace.'}],
 bullets:[
 {text:'Students connected meaningful choices to their projects.',sentiment:'positive',cited_ids:['R7'],quotes:[{rid:'R7',text:quote}]},
 {text:'Some students found the examples useful but wanted more time.',sentiment:'mixed',cited_ids:['R1'],quotes:[{rid:'R1',text:sessions['session-1'][3].content}]},
 {text:'One student wanted clearer assignment instructions.',sentiment:'negative',is_isolated:true,cited_ids:['R2'],quotes:[{rid:'R2',text:sessions['session-2'][1].content}]},
 {text:'Students described their design process.',sentiment:'neutral',cited_ids:['R3'],quotes:[]},
 ], form_sections:[{section_title:'Project experience',summary:'Students discussed connecting the examples to their projects.'}],
 team_health:[{team_name:'Example group',status:'healthy',summary:'Synthetic renderer coverage only.'}],
};
const results=[]; const errors=[]; const unexpected=[]; const shots=[];
function check(name, condition) { assert.ok(condition,name); results.push({name,status:'PASS'}); }
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 let file;
 if(u.pathname==='/before/LEAI/FeedbackAnalyzer.html') file=path.join(out,'FeedbackAnalyzer.before.html');
 else if(u.pathname==='/before/LEAI/leai-shared.css') file=path.join(out,'leai-shared.before.css');
 else file=path.join(root,u.pathname.replace(/^\/before\//,'/'));
 if(!file.startsWith(root+path.sep)||! /\.(html|css|js|png)$/.test(file)) {res.writeHead(404);res.end();return;}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await puppeteer.launch({headless:true, executablePath:process.env.ANALYZER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1042,height:802,deviceScaleFactor:1});
 await page.evaluateOnNewDocument(()=>{sessionStorage.setItem('leai_session',JSON.stringify({courseId:'SYNTHETIC-LOCAL',courseName:'Synthetic UI review'}));localStorage.setItem('leai.fa.mode','form');});
 await page.setRequestInterception(true);
 page.on('request',req=>{
  const u=new URL(req.url());
  if(u.pathname.startsWith('/datapipeline/api/')) {
   let body;
   if(req.method()!=='GET'){unexpected.push(req.method()+' '+u.pathname);return req.abort();}
   if(u.pathname.endsWith('/feedback_messages_by_course/'))body=surveys;
   else if(u.pathname.endsWith('/get_course_customization/'))body={identity_tracking_enabled:false};
   else if(u.pathname.endsWith('/feedback_gpts_by_course/'))body=[];
   else if(u.pathname.endsWith('/leai_quicktake/'))body=qt;
   else if(u.pathname.endsWith('/leai_pdf_ingest_batches/'))body=[];
   else {unexpected.push(req.method()+' '+u.pathname);return req.abort();}
   return req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  }
  // UI dependencies may load; no external application/API requests are allowed.
  if(u.origin===base || ['fonts.googleapis.com','fonts.gstatic.com','cdn.tailwindcss.com','cdn.jsdelivr.net','cdnjs.cloudflare.com'].includes(u.hostname)) return req.continue();
  unexpected.push(req.method()+' '+u.origin+u.pathname);return req.abort();
 });
 async function capture(name){const filename=name+'.png';await page.screenshot({path:path.join(out,filename),fullPage:false});shots.push(filename);}
 async function load(prefix=''){
  await page.goto(base+prefix+'/LEAI/FeedbackAnalyzer.html',{waitUntil:'networkidle0'});
  await page.waitForSelector('#scope-bar [data-week="1"]');
  await page.click('#scope-bar [data-week="1"]');
  await page.waitForSelector('#quick-take-container .quick-take');
 }
 if(fs.existsSync(path.join(out,'FeedbackAnalyzer.before.html'))) {
  await load('/before');await page.$eval('#stats-row',el=>el.scrollIntoView());await capture('before-stats');
  await page.$eval('#quick-take-container',el=>el.scrollIntoView());await capture('before-insights');
 }
 await load();
 check('Text size docks in layout without covering page controls',await page.$eval('#analyzer-text-size-host',host=>{const control=host.querySelector('.leai-font-size-control');return !!control&&getComputedStyle(control).position==='relative'&&host.getBoundingClientRect().bottom<=document.querySelector('.mode-tabs').getBoundingClientRect().top;}));
 await page.click('#analyzer-text-size-host .leai-font-size-trigger');
 check('Expanded text-size options occupy layout space',await page.$eval('.leai-font-size-panel',el=>el.getBoundingClientRect().bottom<=document.querySelector('.mode-tabs').getBoundingClientRect().top));
 await capture('after-display-tools');await page.click('.leai-font-size-trigger');
 check('Single Instructor Insights heading',await page.$$eval('#quick-take-section .section-title, #quick-take-section .card-header span',els=>els.filter(el=>el.textContent.trim()==='Instructor Insights').length===1));
 check('Section rows have separate labels, counts and chevrons',await page.$$eval('.qt-insight-section > summary',els=>els.length===5&&els.every(el=>el.querySelector('.qt-insight-label')&&el.querySelector('.qt-insight-count')&&el.querySelector('.qt-insight-chevron'))));
 check('Chart shows existing counts and week labels',await page.$$eval('.sparkline-week',els=>els.map(el=>el.querySelector('.sparkline-value').textContent).join(',')==='7,4,6'&&els.map(el=>el.querySelector('.sparkline-week-label').textContent).join(',')==='W1,W2,W3'));
 check('Participation removed', !(await page.$eval('#stats-row',el=>el.textContent)).includes('Participation'));
 check('Only selected week highlighted',await page.$$eval('.sparkline-bar',bars=>bars.filter(b=>b.classList.contains('is-current')).length===1 && bars[0].classList.contains('is-current')));
 check('Redundant selected-week caption removed; selected count retained above bar',await page.$('.sparkline-current-label')===null && await page.$eval('.sparkline-week.is-current .sparkline-value',el=>el.textContent==='7'));
 await page.$eval('#stats-row',el=>el.scrollIntoView());await capture('after-stats');
 check('All five major sections closed by default',await page.$$eval('.qt-insight-section',els=>els.length===5 && els.every(el=>!el.open)));
 await page.$eval('#quick-take-container',el=>el.scrollIntoView());await capture('after-collapsed-sections');
 const summaries=await page.$$('.qt-insight-section > summary');
 await summaries[0].click();check('Gaps opens independently',await page.$$eval('.qt-insight-section',els=>els[0].open && !els[1].open));await summaries[0].click();
 await summaries[1].focus();await page.keyboard.press('Enter');
 check('Insights section opens using keyboard',await page.$$eval('.qt-insight-section',els=>els[1].open));
 check('Theme evidence closed initially',await page.$$eval('.qt-evidence',els=>els.every(el=>el.style.display==='none')));
 await page.click('.quick-take-bullets .qt-claim-count');
 check('Expanded theme displays only direct quote',await page.$eval('.qt-evidence',el=>el.textContent.includes('I made a game')&&!el.textContent.includes('How did that affect')));
 check('Citation clearly names the conversation action',await page.$eval('.qt-quote-src',el=>el.textContent==='View conversation · R7 · W1'));
 check('Follow-up is primary and precedes prompt details',await page.$eval('.qt-report-footer',el=>{const a=el.querySelector('.qt-follow-up'),b=el.querySelector('.qt-prompt-toggle');return !!a&&!!b&&a.getBoundingClientRect().top<=b.getBoundingClientRect().top&&getComputedStyle(a).backgroundColor!==getComputedStyle(b).backgroundColor;}));
 await page.click('.qt-prompt-toggle');check('Show prompt still opens its original disclosure',await page.$eval('.prompt-reveal > pre',el=>el.style.display!=='none'));await page.click('.qt-prompt-toggle');
 await capture('after-expanded-quote');
 await page.click('.qt-quote-src');
 await page.waitForSelector('.qt-conversation-popover');
 check('Full conversation with four role-labelled messages',await page.$$eval('.qt-conversation-message',els=>els.length===4 && els.map(e=>e.classList.contains('student')?'student':'ai').join(',')==='ai,student,ai,student'));
 check('Cited message highlighted and correct week',await page.$eval('.qt-conversation-popover',el=>el.querySelectorAll('.is-cited mark').length===1 && !el.textContent.includes('Different week')));
 check('AI and student backgrounds differ',await page.evaluate(()=>getComputedStyle(document.querySelector('.qt-conversation-message.ai')).backgroundColor!==getComputedStyle(document.querySelector('.qt-conversation-message.student')).backgroundColor));
 check('Conversation rows have no borders, outlines, shadows, or gaps',await page.$$eval('.qt-conversation-message',els=>els.every(el=>{const s=getComputedStyle(el);return ['Top','Right','Bottom','Left'].every(side=>parseFloat(s['border'+side+'Width'])===0)&&s.boxShadow==='none'&&parseFloat(s.marginBottom)===0&&parseFloat(s.borderRadius)===0;})));
 check('Compact role labels sit beside message text',await page.$$eval('.qt-conversation-message',els=>els.every(el=>{const a=el.querySelector('.qt-conversation-role').getBoundingClientRect();const b=el.querySelector('.qt-conversation-text').getBoundingClientRect();return a.right<=b.left&&parseFloat(getComputedStyle(el.querySelector('.qt-conversation-role')).fontSize)<parseFloat(getComputedStyle(el.querySelector('.qt-conversation-text')).fontSize);})));
 check('Only cited words have a yellow highlight',await page.$eval('.is-cited',el=>getComputedStyle(el).boxShadow==='none'&&getComputedStyle(el.querySelector('mark')).backgroundColor==='rgb(255, 226, 154)'));
 await capture('after-conversation');
 await page.keyboard.press('Escape');check('Escape dismisses and returns citation focus',await page.evaluate(()=>!document.querySelector('.qt-conversation-popover')&&document.activeElement.classList.contains('qt-quote-src')));
 for(const sentiment of ['positive','mixed','negative','neutral','all']){
  await page.click('.qt-sent-legend button[data-sentiment="'+sentiment+'"]');
  check('Sentiment filter '+sentiment,await page.$$eval('.quick-take-bullets > li',(els,k)=>els.every(el=>el.hidden===(k!=='all'&&el.dataset.sentiment!==k)),sentiment));
 }
 await page.click('.qt-sent-legend button[data-sentiment="mixed"]');await capture('after-sentiment-filter');
 await page.click('.qt-sent-legend button[data-sentiment="all"]');
 await page.click('.qt-quote-src');
 await page.click('#scope-bar [data-week="2"]');
 check('Scope change dismisses previous conversation',await page.$('.qt-conversation-popover')===null);
 check('Highlight follows week changes',await page.$$eval('.sparkline-bar',els=>els[1].classList.contains('is-current')&&!els[0].classList.contains('is-current')));
 await page.click('#scope-bar .scope-chip');check('Course scope has no arbitrary highlighted week',await page.$$eval('.sparkline-bar.is-current',els=>els.length===0));
 await page.click('#scope-bar [data-week="1"]');await page.waitForSelector('.qt-insight-section');
 check('New scope render resets all sections collapsed',await page.$$eval('.qt-insight-section',els=>els.every(e=>!e.open)));
 await page.setViewport({width:390,height:844,deviceScaleFactor:1});
 await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
 await page.click('.leai-font-size-trigger');
 check('Mobile text-size options do not cover mode tabs',await page.$eval('.leai-font-size-panel',el=>el.getBoundingClientRect().bottom<=document.querySelector('.mode-tabs').getBoundingClientRect().top));
 await page.click('.leai-font-size-trigger');
 await page.$eval('#quick-take-container',el=>el.scrollIntoView());await capture('mobile-collapsed');
 await (await page.$$('.qt-insight-section > summary'))[1].click();await page.click('.qt-claim-count');await page.click('.qt-quote-src');
 check('Mobile popup fits viewport',await page.$eval('.qt-conversation-popover',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
 check('Mobile page has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture('mobile-conversation');
 await page.keyboard.press('Escape');
 await page.click('.leai-font-size-trigger');await page.click('.leai-font-size-option[data-size="140"]');await page.click('.leai-font-size-trigger');await page.click('.qt-quote-src');
 check('Enlarged role labels remain on one line without overlap',await page.$$eval('.qt-conversation-message',els=>els.every(el=>{const label=el.querySelector('.qt-conversation-role');const text=el.querySelector('.qt-conversation-text');return label.scrollWidth<=label.clientWidth&&label.getBoundingClientRect().right<=text.getBoundingClientRect().left;})));
 check('Enlarged text popup fits viewport',await page.$eval('.qt-conversation-popover',el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;}));await capture('mobile-large-text-conversation');
 check('Long conversation has an internal scroll area',await page.$eval('.qt-conversation-transcript',el=>el.scrollHeight>el.clientHeight));
 const pageScrollBefore=await page.$eval('.app-main',el=>el.scrollTop);
 await page.hover('.qt-conversation-transcript');await page.mouse.wheel({deltaY:-1600});
 await page.waitForFunction(()=>document.querySelector('.qt-conversation-transcript').scrollTop===0);
 await page.mouse.wheel({deltaY:1600});
 await page.waitForFunction(()=>document.querySelector('.qt-conversation-transcript').scrollTop>0);
 check('Mouse wheel scrolls conversation without moving page',await page.$eval('.app-main',el=>el.scrollTop)===pageScrollBefore);
 await capture('mobile-conversation-scrolled');
 check('Text-size control and conversation do not overlap',await page.evaluate(()=>{const a=document.querySelector('.leai-font-size-control').getBoundingClientRect(),b=document.querySelector('.qt-conversation-popover').getBoundingClientRect();return a.bottom<=b.top||b.bottom<=a.top||a.right<=b.left||b.right<=a.left;}));
 check('Mobile close button is unobstructed',await page.$eval('.qt-conversation-close',el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
 await page.click('.qt-conversation-close');check('Close button dismisses',await page.$('.qt-conversation-popover')===null);
 await page.click('.qt-quote-src');await page.mouse.click(2,2);check('Outside click dismisses',await page.$('.qt-conversation-popover')===null);
 await page.click('.leai-font-size-trigger');await page.click('.leai-font-size-option[data-size="100"]');await page.click('.leai-font-size-trigger');
 await page.click('#hamburger-btn');
 await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().left>=-1);
 await page.click('#sidebar-signout');
 check('Sign-out preserves text-size control on login',await page.$eval('.leai-font-size-control',el=>el.parentElement===document.body&&getComputedStyle(el).position==='fixed'));
 await load();
 if (process.env.ANALYZER_PLAYWRIGHT) {
  const {firefox} = require(process.env.ANALYZER_PLAYWRIGHT);
  const ff = await firefox.launch({headless:true, executablePath:process.env.ANALYZER_FIREFOX});
  try {
   const context = await ff.newContext({viewport:{width:1042,height:802}});
   await context.addInitScript(()=>{sessionStorage.setItem('leai_session',JSON.stringify({courseId:'SYNTHETIC-LOCAL'}));localStorage.setItem('leai.fa.mode','form');});
   await context.route('**/*',async route=>{
    const req=route.request();const u=new URL(req.url());
    if(u.pathname.startsWith('/datapipeline/api/')) {
     let body;
     if(req.method()!=='GET'){unexpected.push('Firefox '+req.method()+' '+u.pathname);return route.abort();}
     if(u.pathname.endsWith('/feedback_messages_by_course/'))body=surveys;
     else if(u.pathname.endsWith('/get_course_customization/'))body={identity_tracking_enabled:false};
     else if(u.pathname.endsWith('/feedback_gpts_by_course/')||u.pathname.endsWith('/leai_pdf_ingest_batches/'))body=[];
     else if(u.pathname.endsWith('/leai_quicktake/'))body=qt;
     else {unexpected.push('Firefox '+req.method()+' '+u.pathname);return route.abort();}
     return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
    }
    if(u.origin===base || ['fonts.googleapis.com','fonts.gstatic.com','cdn.tailwindcss.com','cdn.jsdelivr.net','cdnjs.cloudflare.com'].includes(u.hostname))return route.continue();
    unexpected.push('Firefox '+req.method()+' '+u.origin+u.pathname);return route.abort();
   });
   const fp=await context.newPage();fp.on('pageerror',e=>errors.push('Firefox: '+e.message));
   await fp.goto(base+'/LEAI/FeedbackAnalyzer.html');await fp.locator('#scope-bar [data-week="1"]').click();await fp.locator('.qt-insight-section').first().waitFor();
   check('Firefox: sections start closed',await fp.locator('.qt-insight-section').evaluateAll(els=>els.length===5&&els.every(e=>!e.open)));
   await fp.locator('.qt-insight-section > summary').nth(1).click();await fp.locator('.qt-claim-count').first().click();await fp.locator('.qt-quote-src').first().click();
   check('Firefox: full conversation and cited line',await fp.locator('.qt-conversation-popover').evaluate(el=>el.querySelectorAll('.qt-conversation-message').length===4&&el.querySelectorAll('.is-cited mark').length===1));
   await fp.screenshot({path:path.join(out,'firefox-conversation.png')});shots.push('firefox-conversation.png');await fp.keyboard.press('Escape');
   await fp.locator('.qt-sent-legend button[data-sentiment="mixed"]').click();
   check('Firefox: sentiment filter',await fp.locator('.quick-take-bullets > li').evaluateAll(els=>els.every(el=>el.hidden===(el.dataset.sentiment!=='mixed'))));
   await fp.locator('.qt-sent-legend button[data-sentiment="all"]').click();
   await fp.setViewportSize({width:390,height:844});await fp.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);await fp.locator('.qt-quote-src').first().click();
   check('Firefox: mobile popup fits',await fp.locator('.qt-conversation-popover').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
   await fp.screenshot({path:path.join(out,'firefox-mobile-conversation.png')});shots.push('firefox-mobile-conversation.png');
  } finally {await ff.close();}
 }
 check('No JavaScript errors',errors.length===0);check('No unexpected API requests or writes',unexpected.length===0);
 } finally {await browser.close();server.close();}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Local Chromium and optional Firefox real page with synthetic API fixtures; no provider/persistence/hosted acceptance',results,errors,unexpected,shots},null,2));
 console.log(JSON.stringify({passed:results.length,errors,unexpected,shots},null,2));
})().catch(e=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,results,errors,unexpected,shots},null,2));server.close();console.error(e);process.exitCode=1;});
