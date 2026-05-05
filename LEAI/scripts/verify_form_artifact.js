#!/usr/bin/env node
//
// End-to-end verification for the form-mode slot extractor + slot-aware
// renderer. Runs against the live /openai-structured/ proxy.
//
// 1. Loads the wk6 schema and the engaged-wk6-form persona.
// 2. Walks the persona turns through the JS engine; each user turn is
//    paired with a synthesized bot reply that exercises the engine's
//    section-header prefix logic.
// 3. Calls extractSlots() against /openai-structured/ on Heroku.
// 4. Renders the structured HTML and writes it to ~/Downloads/.
// 5. Asserts: 2.2 roster rows present, 2.4 rating cells populated, sub-field
//    tables rendered, no "(no response captured)".
//
// Run:
//   node LEAI/scripts/verify_form_artifact.js
//
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const https = require('https');

// Load the engine module by running it inside a dedicated VM context so the
// IIFE's `globalThis` resolves to the sandbox we control. This is identical
// to what a browser does when it includes the script.
const engineSrc = fs.readFileSync(
    path.join(__dirname, '..', 'leai-formmode.js'),
    'utf8'
);
const sandbox = {
    console: console,
    Promise: Promise,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
const engine = sandbox.leaiFormMode;
if (!engine) throw new Error('engine failed to load');

const SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'forms', 'hci271-week6-reflection.json');
const PERSONA_PATH = path.join(__dirname, 'personas', 'engaged-wk6-form.json');
const API = 'https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api';

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const persona = JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf8'));

const state = engine.init(schema, { team_id: persona.team || 'Team Coyote' });
const transcript = [];

function botReplyFor(stateRef, scaffoldText) {
    const post = engine.afterTurn(stateRef, scaffoldText);
    return post.displayedMessage;
}

// Opening turn — engine prefixes "Area 1 of N — Title."
engine.beforeTurn(state, null);
{
    const reply = botReplyFor(state, "Hi! I'll walk you through 10 reflection areas. " + schema.sections[0].opening_prompt);
    transcript.push({ role: 'assistant', text: reply });
}

for (const userMsg of persona.turns) {
    transcript.push({ role: 'user', text: userMsg });
    engine.beforeTurn(state, userMsg);
    const reply = botReplyFor(state, 'Got it, thanks.');
    transcript.push({ role: 'assistant', text: reply });
    if (state.ended) break;
}

console.log(`→ synthesized transcript: ${transcript.length} turns`);
console.log(`→ engine roster: ${JSON.stringify(state.roster)}`);
console.log(`→ engine progress: ${engine.progressLabel(state)}`);
console.log(`→ engine ended: ${state.ended}`);
console.log('→ section markers in transcript:');
for (const t of transcript) {
    if (t.role !== 'assistant') continue;
    const m = t.text.match(/Area\s+\d+\s+of\s+\d+\s+—\s+[^.\n]+\./);
    if (m) console.log(`    ${m[0]}`);
}

function postJson(urlStr, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const data = JSON.stringify(body);
        const req = https.request({
            method: 'POST',
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            timeout: 60000,
        }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                if (res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${chunks.slice(0, 300)}`));
                }
                try { resolve(JSON.parse(chunks)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.write(data);
        req.end();
    });
}

function callStructured(prompt, jsonSchema, opts) {
    return postJson(API + '/openai-structured/', {
        user_text: prompt,
        json_schema: jsonSchema,
        schema_name: (opts && opts.schemaName) || 'extraction',
    });
}

(async () => {
    console.log('\n→ extracting slots via /openai-structured/ ...');
    const t0 = Date.now();
    const slots = await engine.extractSlots(state, transcript, callStructured);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ extracted ${Object.keys(slots).length} sections in ${dt}s`);
    for (const sid of Object.keys(slots)) {
        const s = slots[sid];
        const summary = JSON.stringify(s).slice(0, 110).replace(/\n/g, ' ');
        console.log(`    ${sid}: ${summary}${JSON.stringify(s).length > 110 ? '…' : ''}`);
    }

    const html = engine.renderStructuredHtml(state, transcript, { studentName: 'Priya (verify-test)' });
    const outDir = path.join(os.homedir(), 'Downloads');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
    const outFile = path.join(outDir, `HCI271_Reflection_Week6_VERIFY_${stamp}.html`);
    fs.writeFileSync(outFile, html);
    console.log(`\n✓ wrote: ${outFile}  (${html.length} bytes)`);

    // Save the raw slots too for inspection.
    const slotsFile = outFile.replace(/\.html$/, '.slots.json');
    fs.writeFileSync(slotsFile, JSON.stringify({ roster: state.roster, slots }, null, 2));
    console.log(`✓ wrote: ${slotsFile}`);

    const checks = [];
    function check(name, cond, detail) {
        checks.push({ name, ok: !!cond, detail: cond ? '' : (detail || '') });
    }
    check('2.2 roster row: Marco', /Marco/.test(html));
    check('2.2 roster row: Devi',  /Devi/.test(html));
    check('2.2 roster row: Yusuf', /Yusuf/.test(html));
    check('2.4 rating cells (>= 3 numeric)',
          (html.match(/<td>[1-5]<\/td>/g) || []).length >= 3,
          `found ${(html.match(/<td>[1-5]<\/td>/g) || []).length}`);
    check('2.4 has all 5 ratings',
          (html.match(/<td>[1-5]<\/td>/g) || []).length >= 5,
          `found ${(html.match(/<td>[1-5]<\/td>/g) || []).length}`);
    check('No "no response captured" placeholder', !/no response captured/i.test(html));
    check('Roster freeze captured >=4 names',
          state.roster && state.roster.length >= 4,
          `roster=${JSON.stringify(state.roster)}`);
    check('1.3 sub-field table rendered', /What I thought I knew/.test(html));
    check('2.3 sub-field table rendered', /What was challenging/.test(html));
    check('3.1 has student content',
          slots['3.1'] && JSON.stringify(slots['3.1']).length > 30);
    check('3.2 has student content',
          slots['3.2'] && JSON.stringify(slots['3.2']).length > 30);

    let pass = 0, fail = 0;
    for (const c of checks) {
        const mark = c.ok ? '✓' : '✗';
        console.log(`${mark} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
        c.ok ? pass++ : fail++;
    }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
    console.error('FAILED:', e);
    process.exit(2);
});
