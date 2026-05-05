#!/usr/bin/env node
// Verify the .docx renderer produces a real OOXML zip that opens in Word.
// Reuses the slot-extraction work the verify_form_artifact run already did
// (reads its companion .slots.json) so we don't burn another ~30s of LLM time.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const slotsCandidates = fs.readdirSync(DOWNLOADS)
    .filter(f => /VERIFY_.*\.slots\.json$/.test(f))
    .map(f => path.join(DOWNLOADS, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
if (!slotsCandidates.length) {
    console.error('No prior VERIFY .slots.json found — run verify_form_artifact.js first.');
    process.exit(2);
}
const slotsFile = slotsCandidates[0];
console.log(`→ reusing slots from ${slotsFile}`);
const { roster, slots } = JSON.parse(fs.readFileSync(slotsFile, 'utf8'));

// Load engine + docx UMD into a sandbox.
const sandbox = { console, Promise, Buffer, setTimeout, clearTimeout, setImmediate, queueMicrotask };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'leai-formmode.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('/tmp/docx.js', 'utf8'), sandbox);
const engine = sandbox.leaiFormMode;
if (!sandbox.docx) { console.error('docx UMD not available in sandbox'); process.exit(2); }

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'forms', 'hci271-week6-reflection.json'), 'utf8'));
const persona = JSON.parse(fs.readFileSync(path.join(__dirname, 'personas', 'engaged-wk6-form.json'), 'utf8'));

// Reconstruct a state + transcript by walking the engine again (same as
// verify_form_artifact does). Then attach the cached slots so we don't
// re-call /openai-structured/.
const state = engine.init(schema, { team_id: persona.team || 'Team Coyote' });
const transcript = [];
engine.beforeTurn(state, null);
{
    const post = engine.afterTurn(state, "Hi! I'll walk you through 10 reflection areas. " + schema.sections[0].opening_prompt);
    transcript.push({ role: 'assistant', text: post.displayedMessage });
}
for (const u of persona.turns) {
    transcript.push({ role: 'user', text: u });
    engine.beforeTurn(state, u);
    const post = engine.afterTurn(state, 'Got it, thanks.');
    transcript.push({ role: 'assistant', text: post.displayedMessage });
    if (state.ended) break;
}
state.slots = slots;
state.roster = roster;

console.log('→ rendering .docx ...');
engine.renderStructuredDocx(state, transcript, { studentName: 'Priya (verify-test)' })
    .then(blob => blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob))
    .then(buf => {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
        const out = path.join(DOWNLOADS, `HCI271_Reflection_Week6_VERIFY_${stamp}.docx`);
        fs.writeFileSync(out, Buffer.from(buf));
        const head = fs.readFileSync(out).slice(0, 4);
        const isZip = head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04;
        const checks = [];
        checks.push({ n: 'File written',     ok: fs.existsSync(out) });
        checks.push({ n: 'OOXML zip header', ok: isZip });
        checks.push({ n: 'Size reasonable (>5KB)', ok: fs.statSync(out).size > 5000 });
        let pass = 0;
        for (const c of checks) {
            console.log(`${c.ok ? '✓' : '✗'} ${c.n}`);
            if (c.ok) pass++;
        }
        console.log(`\n${pass}/${checks.length} checks passed`);
        console.log(`✓ wrote: ${out}  (${fs.statSync(out).size} bytes)`);
        process.exit(pass === checks.length ? 0 : 1);
    })
    .catch(err => { console.error('FAILED:', err); process.exit(2); });
