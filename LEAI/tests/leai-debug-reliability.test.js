'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeState}=require('../leai-debug.js');

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
