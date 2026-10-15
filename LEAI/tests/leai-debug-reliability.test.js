'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeState}=require('../leai-debug.js');
const {describeDecision}=require('../leai-debug.js');

test('recorded decision explains current scope with exact student quotes',()=>{
    assert.equal(typeof describeDecision,'function');
    const decision=describeDecision({event:'turn',metrics:{decision_explanation:{submission:'committed',attempt:1,
        action:{action:'ask_main',item_id:'P3',justification:'P2 was declined, so continue.'},
        items:[{item_id:'P2',status:'declined',justification:'The student explicitly refuses the current question.',
            satisfied_components:[],evidence:[{sequence:5,quote:'Skip this question.'}]}]}}});
    assert.equal(decision.label,'Saved decision');
    assert.equal(decision.actionJustification,'P2 was declined, so continue.');
    assert.deepEqual(decision.items[0].evidence,[{sequence:5,quote:'Skip this question.'}]);
    assert.equal(decision.items[0].id,'P2');
});

test('rejected proposal explanations are visibly uncommitted and never reconstructed',()=>{
    assert.equal(typeof describeDecision,'function');
    const d=describeDecision({event:'attempt',metrics:{decision_explanation:{submission:'uncommitted',attempt:2,
        action:{action:'follow_up',item_id:'P2',justification:'Proposed a question.'},items:[]}}});
    assert.equal(d.label,'Uncommitted proposal');assert.equal(d.attempt,2);
    const old=describeDecision({event:'turn',after:{results:{P1:{status:'answered'}}},metrics:{reasoning_tokens:300}});
    assert.equal(old.available,false);assert.equal(old.items.length,0);
});

test('debug explains a missing-rating closure without relabeling retained reflection',()=>{
    const data={items:[{id:'P1',prompt:'Question',response:{kind:'likert'},scale:[{value:0,label:'Never'}]}],
        current:{phase:'complete',results:{P1:{status:'partial',rating:null,probes:1,
            closure:{reason:'no_more_detail',components:['rating'],evidence:[{sequence:5,start:0,end:12}]}}},
            evidence:{P1:[{sequence:3,start:0,end:20}]}}};
    const result=describeState(data).results[0];
    assert.equal(result.status,'Partial answer');
    assert.equal(result.rating,'Not given');
    assert.equal(result.closure.label,'No more detail available');
    assert.deepEqual(result.closure.components,['Rating']);
    assert.deepEqual(result.closure.messages,[5]);
    assert.deepEqual(result.messages,[3]);
});

test('zero is a provided authored rating in the researcher panel',()=>{
    const data={items:[{id:'P1',prompt:'Question',response:{kind:'likert'},scale:[{value:0,label:'Never'}]}],
        current:{phase:'complete',results:{P1:{status:'answered',rating:0,probes:0}}}};
    assert.equal(describeState(data).results[0].rating,'0 — Never');
});
