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
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attributes={};}
    appendChild(child){this.children.push(child);return child;}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(key,fn){this.listeners[key]=fn;}
}
function walk(el,predicate){return [...(predicate(el)?[el]:[]),...el.children.flatMap(child=>walk(child,predicate))];}
function teamEvidence(){
    const html=fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'),'utf8');
    const fn=html.slice(html.indexOf('function buildTeamEvidence('),html.indexOf('function collapseInsightSections('));
    const calls=[];const ctx={document:{createElement:tag=>new El(tag)},showQuickTakeCitePopover:(...args)=>calls.push(args)};
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
    const buttons=walk(card,x=>x.tag==='button');assert.equal(buttons.length,8);
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
    const {render,calls}=teamEvidence();const row={rid:'R1',team_name:'Team 4',session_id:'s',survey_id:354};
    const card=render({team_name:'Team 4',quote:{rid:'R1',text:'verbatim'}},[row]);
    assert.equal(card.children[0].textContent,'Evidence · Quoted response');
    walk(card,x=>x.tag==='button')[0].listeners.click();assert.equal(calls[0][3],'verbatim');
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
