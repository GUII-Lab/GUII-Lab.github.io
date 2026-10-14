'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('../leai-orchestration.js');
const fs=require('node:fs'),vm=require('node:vm');
const {describeState,describeEvent,messageSnapshots}=require('../leai-debug.js');

test('per-reply state uses the recorded assistant sequence and never fills a missing turn with current state',()=>{
    const started={event:'started',after:{item_id:'P1',phase:'rating'}};
    const turn={event:'turn',assistant_sequence:4,after:{item_id:'P2',phase:'answer'}};
    const messages=[{sequence:1,sent_by:'ai-message',form_field_id:null},{sequence:2,sent_by:'ai-message',form_field_id:'P1'},
        {sequence:3,sent_by:'user-message',form_field_id:'P1'},{sequence:4,sent_by:'ai-message',form_field_id:'P2'},
        {sequence:6,sent_by:'ai-message',form_field_id:'P3'},{sequence:8,sent_by:'ai-message',form_field_id:null}];
    const mapped=messageSnapshots({events:[started,turn],current:{phase:'complete',status:'finalized'}},messages);
    assert.deepEqual(mapped.map(m=>m.sequence),[1,2,4,6,8]);
    assert.equal(mapped[0].event,started);assert.equal(mapped[1].event,started);
    assert.equal(mapped[2].event,turn);
    assert.equal(mapped[3].event,null);
});

test('Experimental Save uses the course capability and latest settings version, and preserves conflicts',async()=>{
    let calls=[],conflict=false,version=3;
    const sandbox={URLSearchParams,localStorage:{getItem:()=>JSON.stringify({token:'signed-fixture',courseId:'course-a',expiresAt:'2099-01-01T00:00:00Z'})},
        fetch:async(url,options)=>{calls.push({url,...options});
            if(conflict && options.method==='PATCH')return {ok:false,status:409,json:async()=>({error:'settings_conflict'})};
            return {ok:true,json:async()=>({enabled:options.method==='PATCH'?JSON.parse(options.body).enabled:true,version:options.method==='PATCH'?++version:version})};}};
    vm.runInNewContext(fs.readFileSync('LEAI/leai-debug.js','utf8'),sandbox);
    const client=sandbox.leaiDebug.createSettingsClient('/api','course-a');
    await client.load();await client.save(false);
    assert.equal(calls[1].headers.Authorization,'Bearer signed-fixture');
    assert.deepEqual(JSON.parse(calls[1].body),{course_id:'course-a',enabled:false,expected_version:3});
    conflict=true;await assert.rejects(client.save(true),/another window/);
    assert.equal(JSON.parse(calls[2].body).expected_version,4);
});

test('readable state distinguishes review readiness, submission and unanswered results',()=>{
    const items=[{id:'P1',prompt:'Authored question',section_title:'Planning',response:{kind:'likert'},scale:[{value:4,label:'Agree'}]},
        {id:'P2',prompt:'Second question',section_title:'Planning',response:{kind:'text'}}];
    const data={items,current:{status:'active',phase:'answer',item_id:'P2',results:{P1:{status:'unknown',rating:null,probes:2}},coverage_seen:{}}};
    let view=describeState(data);
    assert.equal(view.phase,'Waiting for an answer');
    assert.equal(view.question.prompt,'Second question');
    assert.equal(view.results[0].status,'No answer known');
    assert.equal(view.results[0].rating,'Not given');
    assert.equal(view.results[1].status,'Not recorded');
    data.current.phase='complete';data.current.item_id=null;
    assert.equal(describeState(data).phase,'Ready for review');
    data.current.status='finalized';
    assert.equal(describeState(data).phase,'Submitted');
    assert.equal(describeState(data).action,'Submitted reflection');
    data.current.results.P1={status:'answered',rating:4,probes:1};
    assert.equal(describeState(data).results[0].rating,'4 — Agree');
});

test('readable history shows real result changes and unchanged rejected requests',()=>{
    const data={items:[{id:'P1',prompt:'Question',response:{kind:'text'}}]};
    const before={phase:'answer',item_id:'P1',results:{},evidence:{}};
    const after={phase:'probe',item_id:'P1',results:{P1:{status:'partial',rating:null,probes:1}},evidence:{P1:[{sequence:3,start:0,end:6}]}};
    let event=describeEvent(data,{event:'turn',action:'follow_up',outcome:'committed',before,after});
    assert.equal(event.action,'Asked a follow-up');
    assert.equal(event.changes[0].status,'Partial answer');
    assert.deepEqual(event.changes[0].messages,[3]);
    event=describeEvent(data,{event:'attempt',outcome:'invalid_text',before,after:before});
    assert.equal(event.action,'Input rejected');
    assert.equal(event.outcome,'No answer saved; state unchanged');
    assert.deepEqual(event.changes,[]);
});

test('course login saves debug capability across tabs and signout clears it',()=>{
    const values=new Map();const local={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
    const session={...local,getItem:k=>values.get('s:'+k)||null,setItem:(k,v)=>values.set('s:'+k,v),removeItem:k=>values.delete('s:'+k)};
    const sandbox={window:{location:{hostname:'localhost'}},document:{},sessionStorage:session,localStorage:local,setTimeout,clearTimeout,URLSearchParams,Set,console};
    vm.runInNewContext(fs.readFileSync('LEAI/leai-shared.js','utf8'),sandbox);
    sandbox.saveSession({courseId:'course-a',courseName:'Course',debug_token:'signed-fixture',debug_token_expires_at:'2099-01-01T00:00:00Z'});
    assert.equal(JSON.parse(local.getItem('leai_debug_auth')).token,'signed-fixture');
    sandbox.clearSession();assert.equal(local.getItem('leai_debug_auth'),null);
});

test('transport reports waiting, saved and failed without placing debug auth in student requests',async()=>{
    const stages=[];let fail=false;const bodies=[];
    const c=createClient({api:'/api',publicId:'survey',sessionId:'session',onStatus:s=>stages.push(s),fetch:async(url,opts)=>{
        bodies.push(JSON.parse(opts.body));
        return {ok:!fail,status:fail?503:200,json:async()=>fail?{error:'assessment_unavailable'}:{version:url.endsWith('/session/')?1:2}};
    }});
    await c.start({terms_consent:true});await c.send('answer');fail=true;await assert.rejects(c.send('second'));
    assert.deepEqual(stages.map(s=>s.phase),['waiting','saved','waiting','saved','waiting','failed']);
    assert.equal(stages.at(-1).operation,'turn');assert.equal(stages.at(-1).status,503);
    assert.ok(bodies.every(b=>!('debug_token' in b)));
});

test('successful document finalization refreshes the live panel to the authoritative submitted state',async()=>{
    class Element {
        constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};}
        appendChild(child){this.children.push(child);return child;}
        append(...children){children.forEach(c=>this.appendChild(c));}
        replaceChildren(...children){this.children=[];this.append(...children);}
        setAttribute(){}
        addEventListener(){}
        querySelector(selector){
            for(const child of this.children){
                if((selector==='summary' && child.tag==='summary') || (selector==='.debug-stage' && child.className==='debug-stage'))return child;
                const found=child.querySelector?.(selector);if(found)return found;
            }
            return null;
        }
    }
    let submitted=false,reads=0;
    const sandbox={document:{createElement:tag=>new Element(tag)},URLSearchParams,
        localStorage:{getItem:()=>JSON.stringify({token:'signed-fixture',courseId:'course',expiresAt:'2099-01-01T00:00:00Z'})},
        fetch:async()=>{reads++;return {ok:true,json:async()=>({version:4,items:[],events:[],schema_id:'test',schema_version:1,
            current:{phase:'complete',status:submitted?'finalized':'active',results:{}}})};}};
    vm.runInNewContext(fs.readFileSync('LEAI/leai-debug.js','utf8'),sandbox);
    const panel=sandbox.leaiDebug.createPanel('/api','survey','session',{live:true});
    await panel.update({version:4});
    assert.equal(panel.element.querySelector('.debug-stage').textContent,'Ready for review');
    panel.status({phase:'waiting',operation:'finalize'});
    assert.equal(panel.element.querySelector('.debug-stage').textContent,'Waiting for the server');
    submitted=true;panel.status({phase:'saved',operation:'finalize'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.element.querySelector('.debug-stage').textContent,'Submitted');
    assert.equal(reads,2);
});
