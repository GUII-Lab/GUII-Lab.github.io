const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engines=require(process.env.LEAI_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.LEAI_LOADING_REPORT_DIR||'.web-verify/priority-loading-20261111/insights');
const origin=process.env.LEAI_LOADING_ORIGIN||'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Synthetic verification is local-only.');
fs.mkdirSync(out,{recursive:true});
const results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function login(page,url='FeedbackAnalyzer.html'){
 await page.goto(origin+'/LEAI/'+url,{waitUntil:'domcontentloaded'});
 await page.locator('#login-course-id').fill('synthetic-priority');await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-btn').click();
}
async function insights(name){
 const browser=await engines[name].launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const captures=[];
 const shot=async label=>{const file=name+'-'+label+'.png';await page.screenshot({path:path.join(out,file),animations:'disabled'});captures.push(file);};
 let release=()=>{},held=false;
 const reply=async(route,response,data)=>route.fulfill({response,json:data}).catch(()=>{});
 const holdReads=()=>{
  const gate=new Promise(resolve=>{release=resolve;});
  return async route=>{const response=await route.fetch();const data=await response.json();held=true;await gate;await reply(route,response,data);};
 };
 try{
  await page.route('**/leai_quicktake/**',async route=>{
   const key=new URL(route.request().url()).searchParams.get('scope_key');const response=await route.fetch();const data=await response.json();
   if(key==='form:week-1'&&!held){held=true;await new Promise(resolve=>{release=resolve;});}
   await reply(route,response,data);
  });
  await login(page);await page.locator('#student-responses-list .student-card').first().waitFor();
  await page.waitForFunction(()=>!!document.querySelector('#scope-bar .scope-chip[data-week="2"]'));
  await page.locator('#scope-bar .scope-chip[data-week="2"]').click();
  await page.waitForFunction(()=>document.querySelector('#quick-take-container').textContent.includes('CURRENT WEEK 2 INSIGHT'));
  release();await sleep(150);
  assert.ok(!(await page.locator('#quick-take-container').textContent()).includes('CURRENT WEEK 1 INSIGHT'));
  await page.locator('#quick-take-container .qt-insight-section > summary').first().click();await shot('late-read-rejected');
  await page.unroute('**/leai_quicktake/**');
  let weekOneReads=0;held=false;
  await page.route('**/leai_quicktake/**',async route=>{
   const key=new URL(route.request().url()).searchParams.get('scope_key');const response=await route.fetch();const data=await response.json();
   if(key==='form:week-1'){
    weekOneReads++;
    if(weekOneReads===1)data.status='pending';
    else if(weekOneReads===2){held=true;await new Promise(resolve=>{release=resolve;});}
   }
   await reply(route,response,data);
  });
  await page.locator('#scope-bar .scope-chip[data-week="1"]').click();
  for(let i=0;i<60&&!held;i++)await sleep(100);assert.ok(held,'Expected actual poll request after pending result');
  await page.locator('#scope-bar .scope-chip[data-week="2"]').click();
  await page.waitForFunction(()=>document.querySelector('#quick-take-container').textContent.includes('CURRENT WEEK 2 INSIGHT'));
  release();await sleep(2150);assert.equal(weekOneReads,2,'Leaving the scope must stop its polling');
  assert.ok(!(await page.locator('#quick-take-container').textContent()).includes('CURRENT WEEK 1 INSIGHT'));await shot('poll-cancelled');
  await page.unroute('**/leai_quicktake/**');
  held=false;
  await page.route('**/leai_quicktake/**',holdReads());
  await page.locator('#scope-bar .scope-chip[data-week="1"]').click();
  for(let i=0;i<30&&!held;i++)await sleep(50);assert.ok(held);
  await page.locator('.mode-tab[data-mode="group"]').click();release();await sleep(100);
  assert.equal(await page.locator('#mode-panel-group').isVisible(),true);
  assert.ok(!(await page.locator('#quick-take-container').textContent()).includes('CURRENT WEEK 1 INSIGHT'));await shot('mode-change-rejected');
  await page.unrouteAll({behavior:'wait'});
  await page.locator('.mode-tab[data-mode="form"]').click();
  await page.waitForFunction(()=>document.querySelector('#quick-take-container').textContent.includes('CURRENT WEEK 1 INSIGHT'));
  held=false;
  await page.route('**/leai_quicktake/**',holdReads());
  await page.locator('#scope-bar .scope-chip[data-week="2"]').click();
  for(let i=0;i<30&&!held;i++)await sleep(50);assert.ok(held);
  await page.locator('#sidebar-signout').click();release();await sleep(100);
  assert.equal(await page.locator('#login-screen').isVisible(),true);assert.equal(await page.locator('#app').isVisible(),false);
  assert.deepEqual(errors,[]);await shot('signed-out');
  results.push({engine:name,stage:'insights',passed:true,captures,checks:['late read rejected','late polling result rejected','old polling stopped','mode change rejects old render','signout rejects old render'],boundary:'Actual local read endpoints; controlled delay and one pending-status response. No generation/provider request.'});
 }catch(error){release();await shot('failure').catch(()=>{});results.push({engine:name,stage:'insights',passed:false,error:error.message,errors,captures});throw error;}
 finally{release();await page.unrouteAll({behavior:'wait'});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));await browser.close();}
}
async function chat(name){
 const browser=await engines[name].launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],requests=[],captures=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/datapipeline/api/'))requests.push(new URL(r.url()).pathname);});
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'.web-verify/priority-loading-20261111/fixtures.json')));
 let release=()=>{},held=false;
 try{
  await page.route('**/legacy_analyzer/surveys/**',async route=>{const response=await route.fetch();held=true;await new Promise(r=>{release=r;});await route.fulfill({response}).catch(()=>{});});
  await login(page,'FeedbackChat.html?session='+fixture.chat_id);
  await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('Week two students described teamwork'));
  assert.ok(held,'The independent survey index is deliberately still pending');
  assert.equal(requests.filter(p=>p.endsWith('/feedback_messages_by_course/')).length,0);
  await page.screenshot({path:path.join(out,name+'-chat-before-index.png'),animations:'disabled'});captures.push(name+'-chat-before-index.png');
  await page.locator('#rename-btn').click();
  await page.locator('#chat-title').fill('Draft while surveys load');
  await page.locator('#chat-scope-bar').evaluate(el=>{
   window.__surveyScopeUpdated=false;
   const observer=new MutationObserver(()=>{window.__surveyScopeUpdated=true;observer.disconnect();});
   observer.observe(el,{childList:true,subtree:true});
  });
  release();await page.unrouteAll({behavior:'wait'});
  await page.waitForFunction(()=>window.__surveyScopeUpdated===true);
  assert.equal(await page.locator('#chat-title').textContent(),'Draft while surveys load');
  assert.equal(await page.locator('#chat-title').getAttribute('contenteditable'),'true');
  // Restore the synthetic title before blur; no rename write is needed here.
  await page.locator('#chat-title').evaluate(el=>{el.textContent='Synthetic week 2 chat';el.contentEditable='false';});
  await page.locator('#chat-messages .cite').first().click();
  await page.locator('.cite-popover').filter({hasText:'Synthetic answer form2-s000'}).waitFor();
  assert.ok(!(await page.locator('.cite-popover').textContent()).includes('Synthetic answer form1-s000'));
  await page.screenshot({path:path.join(out,name+'-chat-exact-source.png'),animations:'disabled'});captures.push(name+'-chat-exact-source.png');
  await page.locator('#chat-header').click({position:{x:5,y:5}});
  let indexReads=0;
  await page.route('**/legacy_analyzer/surveys/**',async route=>{indexReads++;if(indexReads<=2)return route.fulfill({status:503,json:{error:'synthetic_unavailable'}});const response=await route.fetch();await route.fulfill({response});});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('Week two students described teamwork'));
  await page.locator('#chat-data-load-state').getByRole('button',{name:'Retry'}).waitFor();
  await page.locator('#chat-scope-bar .scope-chip').click();
  await page.locator('#scope-picker-list').getByRole('button',{name:'Retry'}).waitFor();
  await sleep(200);assert.equal(indexReads,2,'Failed picker must wait for explicit retry, without request loops');
  await page.locator('#scope-picker-list').getByRole('button',{name:'Retry'}).click();
  await page.locator('#scope-picker-list input[type="checkbox"]').first().waitFor();
  await page.locator('#scope-picker-cancel').click();
  assert.ok((await page.locator('#chat-messages').textContent()).includes('Week two students described teamwork'));
  assert.deepEqual(errors,[]);
  results.push({engine:name,stage:'chat',passed:true,captures,checks:['chat shown while survey index delayed','no full-course transcript preload','late metadata preserves title draft','scope-exact week2 citation','repeated metadata failures wait for explicit retry and preserve chat'],boundary:'Actual local Django/PostgreSQL; survey-index delay and two503 responses injected; no provider call.'});
 }catch(error){release();const file=name+'-chat-failure.png';await page.screenshot({path:path.join(out,file)}).catch(()=>{});captures.push(file);results.push({engine:name,stage:'chat',passed:false,error:error.message,errors,captures});throw error;}
 finally{release();await page.unrouteAll({behavior:'wait'});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));await browser.close();}
}
(async()=>{for(const name of (process.env.LEAI_LOADING_ENGINES||'chromium,firefox,webkit').split(',')){if(process.env.LEAI_LOADING_STAGE!=='chat')await insights(name);if(process.env.LEAI_LOADING_STAGE!=='insights')await chat(name);}console.log(JSON.stringify(results,null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
