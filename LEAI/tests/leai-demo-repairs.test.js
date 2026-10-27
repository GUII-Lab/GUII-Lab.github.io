'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const designer=fs.readFileSync(require.resolve('../PromptDesigner.html'),'utf8');
test('editing a sparse roster preserves numbers and adds above its largest number',()=>{
    const fn=designer.match(/function igTeamNumbers\(count\) \{[\s\S]*?\n    \}/)[0];
    const ctx={originalTeamNumbers:[1,4,6,8,9,11,14]};vm.createContext(ctx);vm.runInContext(fn,ctx);
    assert.deepEqual(Array.from(ctx.igTeamNumbers(7)),[1,4,6,8,9,11,14]);
    assert.deepEqual(Array.from(ctx.igTeamNumbers(8)),[1,4,6,8,9,11,14,15]);
    assert.deepEqual(Array.from(ctx.igTeamNumbers(5)),[1,4,6,8,9]);
    ctx.originalTeamNumbers=[];assert.deepEqual(Array.from(ctx.igTeamNumbers(3)),[1,2,3]);
});
class El{
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.style={};}
    appendChild(child){this.children.push(child);return child;}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(key,fn){this.listeners[key]=fn;}
    click(){this.listeners.click();}
}
function walk(el,predicate){return [...(predicate(el)?[el]:[]),...el.children.flatMap(child=>walk(child,predicate))];}
function teamEvidence(){
    const html=fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'),'utf8');
    const fn=html.slice(html.indexOf('function buildEvidenceQuote('),html.indexOf('function collapseInsightSections('));
    const calls=[];const ctx={document:{createElement:tag=>new El(tag),createTextNode:text=>Object.assign(new El('#text'),{textContent:text})},showQuickTakeCitePopover:(...args)=>calls.push(args)};
    ctx._quickTakePopover=null;
    vm.createContext(ctx);vm.runInContext(fn,ctx);return {render:ctx.buildTeamEvidence,expand:ctx.setTeamEvidenceExpanded,calls};
}
test('all claim sources remain clickable and distinct from all team respondents',()=>{
    const {render,calls}=teamEvidence();
    const rows=[5,6,18,20].map(n=>({rid:'R'+n,display_rid:'R'+n,week_number:4,survey_id:356,session_id:'s'+n,team_name:'Team 6'}));
    rows.push({rid:'R2',team_name:'Team 8',survey_id:356,session_id:'other'});
    const card=render({team_name:'Team 6',evidence_claims:[{text:'Still uneven',source_ids:['R5','R6']},{text:'Communication differs',source_ids:['R18']}],quote:{rid:'R5',text:'exact excerpt'}},rows);
    const summaries=walk(card,x=>x.tag==='summary').map(x=>x.textContent);
    assert.deepEqual(summaries,['Evidence · 2 points · 3 source responses']);
    assert.equal(card.tag,'details');assert.equal(card.open,true);
    assert.equal(walk(card,x=>x.className==='qt-team-evidence-claim').length,2);
    assert.equal(walk(card,x=>x.className==='qt-team-all-heading')[0].textContent,'All team responses · 4');
    const buttons=walk(card,x=>x.tag==='button');assert.equal(buttons.length,7);
    buttons.find(x=>x.textContent.includes('· R18 ·')).listeners.click();assert.equal(calls[0][1],'R18');assert.equal(calls[0][2].survey_id,356);
    assert.ok(buttons.every(x=>!/· R2(?: ·|$)/.test(x.textContent)));
});
test('cross-team or missing source references cannot open a misleading transcript',()=>{
    const {render}=teamEvidence();
    const card=render({team_name:'Team 6',evidence_claims:[{text:'claim',source_ids:['R2']}]},[{rid:'R2',team_name:'Team 8',session_id:'wrong',survey_id:356}]);
    const buttons=walk(card,x=>x.tag==='button');assert.equal(buttons[0].disabled,true);
    assert.equal(buttons[0].textContent,'Source unavailable · R2');
});
test('older quote-only summaries expose the real quote source without inventing claim links',()=>{
    const {render,calls}=teamEvidence();const row={rid:'R1',team_name:'Team 4',session_id:'s',survey_id:354,text:'verbatim'};
    const card=render({team_name:'Team 4',quote:{rid:'R1',text:'verbatim'}},[row]);
    assert.equal(card.children[0].textContent,'Evidence · Quoted response');
    walk(card,x=>x.className==='qt-quote-src')[0].listeners.click();assert.equal(calls[0][3],'verbatim');
});

test('team evidence reuses original quote markup with literal text and keyboard source navigation',()=>{
    const {render,calls}=teamEvidence();
    const row={rid:'R5',display_rid:'R5',team_name:'Team 6',session_id:'s',survey_id:356,week_number:4,text:'I am tired. I made most of it.'};
    const card=render({team_name:'Team 6',evidence_claims:[{text:'Uneven work',source_ids:['R5'],quotes:[{rid:'R5',text:'I am tired.'},{rid:'R5',text:'I made most of it.'}]}]},[row]);
    const quotes=walk(card,x=>x.className==='qt-quote');assert.equal(quotes.length,2);
    assert.equal(quotes[0].children[0].className,'qt-quote-body');
    assert.equal(quotes[0].children[0].children[0].textContent,'I am tired.');
    const link=walk(card,x=>x.className==='qt-quote-src')[0];
    assert.equal(link.textContent,'View conversation · R5 · W4');
    assert.equal(link.attributes['aria-expanded'],'false');
    let prevented=false;link.listeners.keydown({key:'Enter',preventDefault(){prevented=true;}});
    assert.ok(prevented);assert.equal(calls[0][3],'I am tired.');
    assert.equal(walk(card,x=>x.className==='qt-team-evidence-quote').length,0);
    const html=fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'),'utf8');
    assert.match(html,/buildEvidenceQuote\(g\.text, srcParts\.join/);
    const css=fs.readFileSync(require.resolve('../leai-shared.css'),'utf8');
    assert.ok(!css.includes('.qt-team-evidence-quote'));
});

test('summaries, invented excerpts and cross-team quotes never receive quotation marks',()=>{
    const {render}=teamEvidence();
    const card=render({team_name:'Team 6',evidence_claims:[{text:'AI summary',source_ids:['R5'],quotes:[{rid:'R5',text:'invented'},{rid:'R8',text:'actual'}]}]},[{rid:'R5',text:'actual',team_name:'Team 6',session_id:'s',survey_id:356},{rid:'R8',text:'actual',team_name:'Team 8',session_id:'other',survey_id:356}]);
    assert.equal(walk(card,x=>x.className==='qt-quote').length,0);
    assert.equal(walk(card,x=>x.className==='qt-claim')[0].textContent,'AI summary');
    assert.ok(walk(card,x=>x.tag==='button').some(x=>x.textContent==='View conversation · R5'));
});

test('bulk collapse hides all team evidence together and expand restores every team',()=>{
    const {render,expand}=teamEvidence();
    const cards=[render({team_name:'Team 1',evidence_claims:[]},[]),render({team_name:'Team 6',evidence_claims:[]},[])];
    const section={querySelectorAll:selector=>{assert.equal(selector,'.qt-team-evidence');return cards;}};
    expand(section,false);assert.ok(cards.every(card=>card.open===false));
    expand(section,true);assert.ok(cards.every(card=>card.open===true));
});

test('an unnumbered activity scope excludes historical weeks from stats and insight requests',()=>{
    const html=fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'),'utf8');
    const start=html.indexOf('function scopedSurveys()');
    const end=html.indexOf('// ===== SCOPE CHIPS =====',start);
    const surveys=[{gpt_id:354,week_number:2},{gpt_id:355,week_number:3},{gpt_id:358,week_number:null}];
    const ctx={activeSurveys:()=>surveys,currentScope:{kind:'week',weekNumber:null}};
    vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
    assert.deepEqual(Array.from(ctx.activeSurveyIds()),[358]);
    assert.equal(ctx.scopedSurveys().length,1);
    ctx.currentScope={kind:'week',weekNumber:2};assert.deepEqual(Array.from(ctx.activeSurveyIds()),[354]);
    ctx.currentScope={kind:'course',weekNumber:null};assert.deepEqual(Array.from(ctx.activeSurveyIds()),[354,355,358]);
    assert.match(html,/currentResponses = leaiAnalysis.buildResponseIndex\(\s*scopedSurveys\(\)/);
});

test('activity chart counts saved answers consistently and excludes empty ready conversations',()=>{
    const html=fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'),'utf8');
    const shared=fs.readFileSync(require.resolve('../leai-shared.js'),'utf8');
    const start=shared.indexOf('buildResponseIndex: function(');
    const end=shared.indexOf('renderCitationPill:',start);
    const analysis=vm.runInNewContext('({' + shared.slice(start,end) + '})');
    const fn=html.match(/function surveyResponseCount\(survey\) \{[\s\S]*?\n    \}/)[0];
    const ctx={leaiAnalysis:analysis};vm.createContext(ctx);vm.runInContext(fn,ctx);
    const survey={gpt_id:357,week_number:null,session_count:3,sessions:{empty:[{sent_by:'assistant',content:'Question?'}],complete:[{sent_by:'assistant',content:'Question?'},{sent_by:'user',content:'My answer.'}],partial:[{sent_by:'user-message',content:'Still unclear.'}]}};
    assert.equal(ctx.surveyResponseCount(survey),2);
});

test('certificate hint matches the required completion gate before and after an answer',()=>{
    const html=fs.readFileSync(require.resolve('../feedback.html'),'utf8');
    const fn=html.slice(html.indexOf('function updateDownloadStripUi('),html.indexOf('function buildCertificateProgressSnapshot('));
    const node=()=>{const e=new El('div');e.classList={add(){},remove(){}};return e;};
    const ctx={document:{createElement:node,createTextNode:text=>({textContent:text})},setDownloadStripNote(){}};
    vm.createContext(ctx);vm.runInContext(fn,ctx);
    for(const persisted of [0,1]){
        const ui={strip:node(),statusEl:node(),documentBtn:node(),certificateBtn:node(),celebrateEl:node(),helpEl:node()};
        const state={showStrip:true,showDocument:false,showCertificate:true,persistedStudentMessageCount:persisted,presentation:'normal',document:{visible:false,enabled:false},certificate:{visible:true,enabled:false,label:'Finish the reflection for a certificate'}};
        ctx.updateDownloadStripUi(ui,state,{certificateRequiresCompletion:true});
        const label=ui.statusEl.children.map(e=>e.textContent).join('');
        assert.match(label,/finish the reflection/);assert.doesNotMatch(label,/respond once/);
        assert.equal(ui.certificateBtn.disabled,true);
    }
    // Ordinary chat retains its existing first-response contract.
    const legacy={strip:node(),statusEl:node(),documentBtn:node(),certificateBtn:node(),celebrateEl:node(),helpEl:node()};
    ctx.updateDownloadStripUi(legacy,{showStrip:true,showDocument:false,showCertificate:true,presentation:'normal',document:{visible:false,enabled:false},certificate:{visible:true,enabled:false}},{certificateRequiresCompletion:false});
    assert.match(legacy.statusEl.children.map(e=>e.textContent).join(''),/respond once/);
});

test('confirmed retry clears both error surfaces before rendering but failed retry preserves text',async()=>{
    const html=fs.readFileSync(require.resolve('../feedback.html'),'utf8');
    const fn=html.slice(html.indexOf('function sendOrchestratedMessage('),html.indexOf('function downloadOrchestratedReflection('));
    for(const fails of [false,true]){
        let value='My saved response',removed=false,renderedNote=null;
        const input={prop:()=>false,val(next){if(next!==undefined){value=next;return input;}return value;},css:()=>input};
        const ctx={_mainStripNoteText:'Old failed reply',chatLocked:false,$:()=>input,
            orchestratedClient:{getPending:()=>({text:value}),retry:()=>fails?Promise.reject({status:503}):Promise.resolve({version:6})},
            setInputBusy(){},showTypingIndicator(){},hideTypingIndicator(){},window:{},
            document:{getElementById:()=>({remove(){removed=true;}})},
            applyOrchestratedPayload(){renderedNote=ctx._mainStripNoteText;},orchestrationError(){}};
        vm.createContext(ctx);vm.runInContext(fn,ctx);ctx.sendOrchestratedMessage();
        await new Promise(resolve=>setImmediate(resolve));
        if(fails){assert.equal(value,'My saved response');assert.equal(removed,false);assert.equal(ctx._mainStripNoteText,'Old failed reply');}
        else{assert.equal(renderedNote,'');assert.equal(ctx._mainStripNoteText,'');assert.equal(value,'');assert.equal(removed,true);}
    }
});
