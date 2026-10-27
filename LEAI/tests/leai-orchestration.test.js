'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../leai-orchestration.js');
const form = require('../leai-formmode.js');

test('failed turn retries the exact frozen request and consumes only success', async () => {
    const bodies=[]; let fail=true;
    const client=createClient({api:'/api',publicId:'survey',sessionId:'session',fetch:async (url,opts)=>{
        const body=JSON.parse(opts.body); bodies.push(body);
        if(url.endsWith('/session/')) return {ok:true,json:async()=>({version:1,messages:[]})};
        if(fail) { fail=false; throw new Error('network'); }
        return {ok:true,json:async()=>({version:2,messages:[]})};
    }});
    await client.start({terms_consent:true});
    await assert.rejects(client.send('four because I checked'));
    assert.equal(client.getPending().text,'four because I checked');
    await assert.rejects(client.send('different'),/pending/);
    await client.retry();
    const turns=bodies.filter(body=>body.request_id);
    assert.deepEqual(turns[0],turns[1]);
    assert.equal(client.getPending(),null);
});

test('retryable 503 checks saved state and retries the same request only once',async()=>{
    const turns=[];let attempts=0;
    const client=createClient({api:'/api',publicId:'survey',sessionId:'session',fetch:async(url,opts)=>{
        if(url.endsWith('/session/'))return {ok:true,json:async()=>({version:1,messages:[]})};
        turns.push(JSON.parse(opts.body));attempts++;
        if(attempts===1)return {ok:false,status:503,json:async()=>({error:'assessment_unavailable',retryable:true})};
        return {ok:true,json:async()=>({version:2,messages:[]})};
    }});
    await client.start({terms_consent:true});
    assert.equal((await client.send('specific account')).version,2);
    assert.deepEqual(turns[0],turns[1]);assert.equal(client.getPending(),null);
});

test('second 503 stops with the original request available for deliberate retry',async()=>{
    let attempts=0;
    const client=createClient({api:'/api',publicId:'s',sessionId:'c',fetch:async(url)=>{
        if(url.endsWith('/session/'))return {ok:true,json:async()=>({version:1,messages:[]})};
        attempts++;return {ok:false,status:503,json:async()=>({error:'assessment_unavailable',retryable:true})};
    }});
    await client.start({terms_consent:true});await assert.rejects(client.send('draft'));
    assert.equal(attempts,2);assert.equal(client.getPending().text,'draft');
});

test('lost success is recovered from saved messages without a second turn',async()=>{
    let committed=false;let attempts=0;
    const client=createClient({api:'/api',publicId:'s',sessionId:'c',fetch:async(url)=>{
        if(url.endsWith('/session/'))return {ok:true,json:async()=>({version:committed?2:1,messages:committed?[{sent_by:'user-message',content:'draft'},{sent_by:'ai-message',content:'reply'}]:[]})};
        attempts++;committed=true;throw new Error('disconnected');
    }});
    await client.start({terms_consent:true});assert.equal((await client.send('draft')).version,2);
    assert.equal(attempts,1);assert.equal(client.getPending(),null);
});

test('uncertain failure never replays against another answer or new question',async()=>{
    let sent=false;let attempts=0;
    const client=createClient({api:'/api',publicId:'s',sessionId:'c',fetch:async(url)=>{
        if(url.endsWith('/session/'))return {ok:true,json:async()=>({version:sent?2:1,messages:sent?[{sent_by:'user-message',content:'different'}]:[]})};
        attempts++;sent=true;throw new Error('disconnected');
    }});
    await client.start({terms_consent:true});await assert.rejects(client.send('draft'),error=>error.status===409);
    assert.equal(attempts,1);assert.equal(client.getPending(),null);
});

test('409 refreshes authoritative state without replaying text automatically', async()=>{
    let count=0;
    const client=createClient({api:'/api',publicId:'survey',sessionId:'session',fetch:async(url)=>{
        if(url.endsWith('/session/')) return {ok:true,json:async()=>({version:++count,messages:[]})};
        return {ok:false,status:409,json:async()=>({error:'stale_turn'})};
    }});
    await client.start({terms_consent:true});
    await assert.rejects(client.send('draft'));
    assert.equal(client.getState().version,2);
    assert.equal(client.getPending(),null);
});

test('orchestrated downloads use current server slots over stale transcript',()=>{
    const schema={title:'Reflection',course:'Course',instructor:'Teacher',week:3,
        sections:[{id:'planning',title:'Planning',answer_source:'orchestrator',fields:[{id:'P1',kind:'shortform',label:'Exact question'}]}]};
    const state={schema,slots:{planning:{P1:'4 — Agree\nCurrent supported answer'}}};
    const transcript=[{role:'user',text:'Withdrawn old answer',form_field_id:'P1',form_section_id:'planning',form_response_phase:'primary'}];
    const md=form.renderStructuredMarkdown(state,transcript);
    assert.match(md,/Current supported answer/);
    assert.match(md,/4 — Agree/);
    const body=md.split('## Raw Conversation Transcript')[0];
    assert.doesNotMatch(body,/Withdrawn old answer/);
});

test('stale finalize refreshes state and requires a deliberate second download', async()=>{
    let version=1; const submitted=[];
    const client=createClient({api:'/api',publicId:'survey',sessionId:'session',fetch:async(url,opts)=>{
        if(url.endsWith('/session/')) return {ok:true,json:async()=>({version,messages:[]})};
        submitted.push(JSON.parse(opts.body).expected_version);
        if(submitted.length===1){version=2;return {ok:false,status:409,json:async()=>({error:'stale_turn'})};}
        return {ok:true,json:async()=>({results:{}})};
    }});
    await client.start({terms_consent:true});
    await assert.rejects(client.finalize());
    assert.equal(client.getState().version,2);
    await client.finalize();
    assert.deepEqual(submitted,[1,2]);
});

test('certificate success refreshes and renders the finalized server session',()=>{
    const source=require('node:fs').readFileSync(require.resolve('../feedback.html'),'utf8');
    assert.ok(/Certificate downloaded:[\s\S]{0,200}orchestratedClient\.resume\(\)\.then\(applyOrchestratedPayload\)/.test(source),'certificate success must refresh the finalized state');
});

test('finalized orchestrated input is disabled even when legacy chat is locked',()=>{
    const vm=require('node:vm');
    const source=require('node:fs').readFileSync(require.resolve('../feedback.html'),'utf8');
    const fn=source.match(/function setInputBusy\(busy\) \{[\s\S]*?\n        \}/)[0];
    const values={};
    const context={chatLocked:true,orchestratedClient:{},$:selector=>({prop:(key,value)=>{values[selector]=value;}})};
    vm.createContext(context);vm.runInContext(fn+';setInputBusy(false);',context);
    assert.equal(values['#messageInput'],true);
    assert.equal(values['#sendMessage'],true);
});

test('a rejected invalid input can be edited rather than retrying it forever',async()=>{
    let rejected=false;
    const client=createClient({api:'/api',publicId:'survey',sessionId:'session',fetch:async(url)=>{
        if(url.endsWith('/session/'))return {ok:true,json:async()=>({version:1,messages:[]})};
        if(!rejected){rejected=true;return {ok:false,status:400,json:async()=>({error:'invalid_text'})};}
        return {ok:true,json:async()=>({version:2,messages:[]})};
    }});
    await client.start({terms_consent:true});await assert.rejects(client.send('invalid input'));
    assert.equal(client.getPending(),null);
    assert.equal((await client.send('edited valid input')).version,2);
});
