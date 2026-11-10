'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function gear(readbackFails) {
    let saved = false;
    let reads = 0;
    const context = {window: {}, fetch: async (_, options) => {
        if (options.method === 'PATCH') {
            saved = true;
            throw new Error('Connection lost after commit');
        }
        if (++reads > 1 && readbackFails) throw new Error('Readback unavailable');
        return {ok:true, json:async () => ({enabled:saved})};
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../leai-response-export.js'), 'utf8'), context);
    const input = {checked:false, disabled:false, indeterminate:false};
    const status = {};
    const client = context.window.leaiResponseExport.mountGear('/api', {courseId:'synthetic', response_export_token:'synthetic-only'}, input, status);
    await new Promise(resolve => setImmediate(resolve));
    input.checked = true;
    await assert.rejects(client.save(), /Connection lost/);
    return {input,status,saved};
}

test('ambiguous PATCH failure restores the persisted server value', async () => {
    const {input,saved} = await gear(false);
    assert.equal(saved,true);
    assert.equal(input.checked,true);
    assert.equal(input.disabled,false);
});

test('unavailable readback marks the setting unknown and disables edits', async () => {
    const {input,status} = await gear(true);
    assert.equal(input.indeterminate,true);
    assert.equal(input.disabled,true);
    assert.match(status.textContent,/Couldn’t verify/);
});
