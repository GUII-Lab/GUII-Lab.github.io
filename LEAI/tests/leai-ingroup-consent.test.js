'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../feedback.html'),'utf8');
function setup(consent){
 const calls=[];const c={sessionStorage:{getItem:()=>consent===null?null:JSON.stringify(consent)},showConsentModal:(cb,mode)=>calls.push(['consent',mode]),leaiTeamsApi:{getSurveyTeamSnapshot:()=>{calls.push(['snapshot']);return Promise.resolve(null)}}};
 const has=source.slice(source.indexOf('function hasSessionConsent('),source.indexOf('function storeSessionConsent('));
 const get=source.slice(source.indexOf('function getResearchConsent('),source.indexOf("document.addEventListener('DOMContentLoaded'",source.indexOf('function getResearchConsent(')));
 const start=source.slice(source.indexOf('function startInGroupFlow('),source.indexOf('// Helper: build a paragraph',source.indexOf('function startInGroupFlow(')));
 vm.createContext(c);vm.runInContext(has+get+start,c);return {c,calls};
}
for(const [name,consent,expected] of [['terms only',{research:false,anonymityMode:'anonymous'},false],['research opted in',{research:true,anonymityMode:'anonymous'},true],['missing choice',null,false]]){
 test('in-group persistence reads optional research choice: '+name,()=>{const {c}=setup(consent);const expr=source.match(/(?:const|var) researchConsent = [^;\n]+;/)[0];assert.equal(vm.runInContext(expr+'\nresearchConsent',c),expected);});
}
test('group entry without consent stops before snapshot/team screens',()=>{const {c,calls}=setup(null);c.startInGroupFlow({id:1});assert.deepEqual(calls,[['consent','anonymous']]);});
test('identified group cannot reuse anonymous consent',()=>{const {c,calls}=setup({research:true,anonymityMode:'anonymous'});c.startInGroupFlow({id:1,anonymity_mode:'identified'});assert.deepEqual(calls,[['consent','identified']]);});
