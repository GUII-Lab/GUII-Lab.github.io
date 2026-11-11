const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function shared() {
    const storage={getItem:()=>null,setItem(){},removeItem(){}};
    const ctx={window:{location:{hostname:'localhost'}},document:{},sessionStorage:storage,localStorage:storage,
        AbortController,DOMException,setTimeout,clearTimeout,URLSearchParams,Set,console};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../leai-shared.js'),'utf8')+';globalThis.api={state:leaiLoadState,chat:leaiChat};',ctx);
    return ctx.api;
}
function analyzer() {
    const api=shared(),queue=[],renders=[],container={isConnected:true,textContent:''};
    let key='form:week-1';
    const ctx={leaiLoadState:api.state,AbortController,DOMException,session:{courseId:'synthetic'},
        document:{getElementById:()=>container},currentScope:{kind:'week'},currentResponses:Array(5).fill({}),
        scopeKey:()=>key,leaiChat:{getQuickTake:(course,scope,opts)=>new Promise((resolve,reject)=>queue.push({resolve,reject,scope,signal:opts.signal}))},
        renderQuickTakeCTA:()=>renders.push('cta'),renderWeekPicker(){},renderQuickTakeShimmer(){},attachQuickTakePoll(){},
        renderQuickTakeErrorCard:()=>renders.push('error'),renderQuickTakeLoaded:(c,qt)=>renders.push(qt.label)};
    const source=fs.readFileSync(path.join(__dirname,'../FeedbackAnalyzer.html'),'utf8');
    const guards=source.slice(source.indexOf('    const insightsGuard ='),source.indexOf('    let responseExportControl ='));
    const render=source.slice(source.indexOf('    function renderQuickTake() {'),source.indexOf('    // Resolve the exact survey/session pair'));
    vm.createContext(ctx);vm.runInContext(guards+render+';globalThis.guard=insightsGuard;',ctx);
    return {ctx,queue,renders,setKey:value=>{key=value;},container};
}
test('late week result and late failure cannot replace the active Insights scope', async()=>{
    const a=analyzer();a.ctx.renderQuickTake();a.setKey('form:week-2');a.ctx.renderQuickTake();
    assert.equal(a.queue[0].signal.aborted,true);
    a.queue[1].resolve({status:'ready',label:'week-2'});await tick();
    a.queue[0].resolve({status:'ready',label:'week-1'});await tick();
    assert.deepEqual(a.renders,['week-2']);
    a.ctx.renderQuickTake();a.setKey('group:week-1');a.ctx.renderQuickTake();
    a.queue[3].resolve({status:'ready',label:'group'});a.queue[2].reject(Error('old failure'));await tick();
    assert.deepEqual(a.renders,['week-2','group']);
});
test('leaving a scope, signing out, or disconnecting its panel invalidates late results',async()=>{
    for(const leave of [a=>{a.ctx.guard.cancel();a.ctx.session=null;},a=>{a.ctx.currentScope.kind='course';a.ctx.renderQuickTake();},a=>{a.container.isConnected=false;}]){
        const a=analyzer();a.ctx.renderQuickTake();leave(a);a.queue[0].resolve({status:'ready',label:'stale'});await tick();assert.deepEqual(a.renders,[]);
    }
});
test('Insights polling aborts in-flight reads without applying or retrying a late result',async()=>{
    const {chat}=shared();let resolve,calls=0;
    chat.getQuickTake=()=>{calls++;return new Promise(r=>{resolve=r;});};
    const controller=new AbortController();let ticks=0;
    const promise=chat.pollQuickTake('synthetic','week-1',{signal:controller.signal,intervalMs:5,onTick:()=>{ticks++;}});
    controller.abort();await assert.rejects(promise,{name:'AbortError'});
    resolve({status:'pending'});await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.equal(ticks,0);
});
test('Insights polling clears a scheduled retry when its scope is cancelled',async()=>{
    const {chat}=shared();let calls=0;chat.getQuickTake=async()=>{calls++;return {status:'pending'};};
    const controller=new AbortController();const promise=chat.pollQuickTake('synthetic','week-1',{signal:controller.signal,intervalMs:20});
    await tick();controller.abort();await assert.rejects(promise,{name:'AbortError'});await new Promise(r=>setTimeout(r,40));assert.equal(calls,1);
});
test('late generation acceptance cannot start polling or render after a scope change',async()=>{
    const a=analyzer();let accepted,polls=0;
    a.ctx.activeSurveyIds=()=>[1];
    a.ctx.leaiChat.generateQuickTake=()=>new Promise(r=>{accepted=r;});
    a.ctx.leaiChat.pollQuickTake=async()=>{polls++;return {status:'ready',label:'old generation'};};
    const source=fs.readFileSync(path.join(__dirname,'../FeedbackAnalyzer.html'),'utf8');
    vm.runInContext(source.slice(source.indexOf('    function generateQuickTake(container) {'),source.indexOf('    // Compact relative-time formatter')),a.ctx);
    a.ctx.generateQuickTake(a.container);a.setKey('form:week-2');a.ctx.renderQuickTake();
    accepted();await tick();assert.equal(polls,0);assert.deepEqual(a.renders,[]);
});
test('late generated Insights and its errors cannot replace a newer scope',async()=>{
    for(const fail of [false,true]){
        const a=analyzer();let resolve,reject;
        a.ctx.activeSurveyIds=()=>[1];a.ctx.leaiChat.generateQuickTake=async()=>({});
        a.ctx.leaiChat.pollQuickTake=()=>new Promise((r,j)=>{resolve=r;reject=j;});
        const source=fs.readFileSync(path.join(__dirname,'../FeedbackAnalyzer.html'),'utf8');
        vm.runInContext(source.slice(source.indexOf('    function generateQuickTake(container) {'),source.indexOf('    // Compact relative-time formatter')),a.ctx);
        a.ctx.generateQuickTake(a.container);await tick();a.setKey('form:week-2');a.ctx.renderQuickTake();
        if(fail)reject(Error('old job failed'));else resolve({status:'ready',label:'old job'});
        await tick();assert.deepEqual(a.renders,[]);
    }
});
