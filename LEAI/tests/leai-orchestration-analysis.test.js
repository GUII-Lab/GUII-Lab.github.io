const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{location:{hostname:'localhost'}}, Set, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../leai-shared.js'),'utf8'),context);
test('analysis uses active server excerpts instead of withdrawn transcript',()=>{
    const survey={gpt_id:1,week_number:3,sessions:{a:[{sent_by:'user-message',content:'Withdrawn'}]},structured_sessions:{a:{answer_excerpts:{P1:['Current']},results:{P1:{rating:4}}}}};
    assert.equal(context.leaiAnalysis.buildResponseIndex([survey],'course')[0].text,'Current');
});
