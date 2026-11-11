const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pager, client, hydrate} = require('../leai-response-pages.js');
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};

test('late old scope cannot append to a new scope; concurrent loads deduplicate', async () => {
    const old=deferred(), fresh=deferred();let state;let calls=0;
    const p=pager(params=>{calls++;return params.mode==='form'?old.promise:fresh.promise;},s=>{state=s;});
    const first=p.reset({mode:'form'});await Promise.resolve();
    assert.equal(p.loadMore(),first);
    const second=p.reset({mode:'group'});await Promise.resolve();
    fresh.resolve({results:[{gpt_id:2,session_id:'same'}],total:1,has_more:false});await second;
    old.resolve({results:[{gpt_id:1,session_id:'same'}],total:1,has_more:false});await first;
    assert.equal(calls,2);assert.deepEqual(state.rows,[{gpt_id:2,session_id:'same'}]);
});
test('failed next page retries its cursor and retains previous rows', async () => {
    let state;const cursors=[];let attempt=0;
    const p=pager(async params=>{cursors.push(params.cursor);attempt++;
        if(attempt===2) throw Error('offline');
        return attempt===1?{results:[{gpt_id:1,session_id:'same'}],total:2,has_more:true,next_cursor:'next'}:
            {results:[{gpt_id:1,session_id:'same'},{gpt_id:2,session_id:'same'}],total:2,has_more:false};},s=>{state=s;});
    await p.reset({});await p.loadMore();assert.equal(state.rows.length,1);assert.ok(state.error);
    await p.loadMore();assert.equal(state.rows.length,2);assert.deepEqual(cursors,[undefined,'next','next']);
});
test('detail cache is scoped by survey and session and concurrent requests share one fetch', async () => {
    const calls=[];const c=client('/api',{courseId:'synthetic',response_export_token:'fixture'},async(url,options)=>{
        calls.push({url,options});return {ok:true,json:async()=>url.includes('bootstrap')?{snapshot:'s',surveys:[]}:{messages:[{content:url}]}};
    });
    await c.bootstrap();const row={survey_id:1,session_id:'same'};
    const [a,b]=await Promise.all([c.detail(row),c.detail(row)]);assert.equal(a,b);
    await c.detail({...row,survey_id:2});assert.equal(calls.length,3);
    assert.equal(calls[1].options.cache,'no-store');assert.match(calls[1].url,/snapshot=s/);
    c.destroy();assert.equal(c.peek(row),undefined);
});
test('metadata supports mixed PDF/chat and nudge semantics without transcript text', () => {
    const [survey]=hydrate([{gpt_id:1,response_summaries:{s:{student_count:2,pdf_count:1,chat_count:3,nudged:true,first_at:'2026-01-01'}}}]);
    assert.ok(survey.sessions.s.some(r=>r.source==='pdf'));
    assert.ok(survey.sessions.s.some(r=>r.sent_by==='user'));
    assert.ok(survey.sessions.s.some(r=>r.referred));
    assert.ok(survey.sessions.s.every(r=>r.summary_only && !r.content));
});

test('destroyed readers and stale observer callbacks cannot start another request', async () => {
    let count=0;
    const p=pager(async()=>{count++;return {results:[],total:1,has_more:true,next_cursor:'next'};},()=>{});
    await p.reset({});p.destroy();await p.loadMore();assert.equal(count,1);
    const c=client('/api',{courseId:'synthetic'},async()=>{count++;return {ok:true,json:async()=>({messages:[]})};});
    c.destroy();await assert.rejects(c.detail({survey_id:1,session_id:'x'}),{name:'AbortError'});assert.equal(count,1);
});

test('bulk detail reads use at most four concurrent requests', async () => {
    const gates=[];let active=0,max=0;
    const c=client('/api',{courseId:'synthetic'},()=>new Promise(resolve=>{
        active++;max=Math.max(max,active);
        gates.push(()=>{active--;resolve({ok:true,json:async()=>({messages:[]})});});
    }));
    const promises=Array.from({length:9},(_,i)=>c.detail({survey_id:1,session_id:'s'+i}));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(gates.length,4);
    while(gates.length){gates.splice(0).forEach(release=>release());await new Promise(resolve=>setImmediate(resolve));}
    await Promise.all(promises);assert.equal(max,4);c.destroy();
});

test('regenerating an open Insights panel keeps its transcript after detail-cache eviction', async () => {
    const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
    const source=fs.readFileSync(path.join(__dirname,'../FeedbackAnalyzer.html'),'utf8');
    const start=source.indexOf('    function renderInsightsLoaded('),end=source.indexOf('    function triggerInsightsTTS(',start);
    const c=client('/api',{courseId:'synthetic',response_export_token:'fixture'},async url=>({ok:true,json:async()=>({messages:[{content:url}]})}));
    const row={survey_id:1,session_id:'repeated'};const detail=await c.detail(row);
    for(let i=2;i<=102;i++)await c.detail({survey_id:i,session_id:'repeated'});
    assert.equal(c.peek(row),undefined);
    const children=[];let submitted;
    const context={document:{createElement:()=>({style:{},setAttribute(){},addEventListener(event,fn){this[event]=fn;},appendChild(){}})},
        clearChildren(){},renderMarkdownInto(){},triggerInsightsGeneration(...args){submitted=args;},triggerInsightsTTS(){}};
    vm.createContext(context);vm.runInContext(source.slice(start,end),context);
    const panel={_responseMessages:detail.messages,_responseSchemaId:'exact-survey-schema'};
    context.renderInsightsLoaded(panel,{appendChild(){}},{appendChild(node){children.push(node);}},'repeated',{wordCount:3,markdown:'Saved report'});
    children.find(node=>node.textContent==='Regenerate').click({stopPropagation(){}});
    assert.equal(submitted[4],detail.messages);assert.equal(submitted[0]._responseSchemaId,'exact-survey-schema');
    c.destroy();
});
