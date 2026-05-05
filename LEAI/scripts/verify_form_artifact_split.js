#!/usr/bin/env node
//
// End-to-end verify against a SPLIT FormSchema row served by the local Django
// backend (port 8000 by default). Runs in two modes:
//
//   node verify_form_artifact_split.js individual
//     → pulls hci271-week6-reflection (Part 1) and walks engaged-wk6-individual.json
//
//   node verify_form_artifact_split.js team
//     → pulls hci271-week6-team-reflection (Parts 2 & 3) and walks engaged-wk6-team.json
//
// Both modes:
//  1. fetch /datapipeline/api/form_schemas/<id>/ for the schema body
//  2. walk persona turns through the engine
//  3. call /datapipeline/api/openai-structured/ to extract slots
//  4. render the structured DOCX and write to ~/Downloads/
//  5. assert per-section coverage based on the schema's section list
//
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const http = require('http');
const https = require('https');

const MODE = (process.argv[2] || '').toLowerCase();
const HOST = process.env.LEAI_API_HOST || 'http://localhost:8000';

const PROFILES = {
    individual: {
        schemaId: 'hci271-week6-reflection',
        personaPath: 'personas/engaged-wk6-individual.json',
        expectedSectionIds: ['1.1', '1.2', '1.3', '1.4'],
        expectedRosterPresent: false,
        expectedRatings: 0,
        labelTag: 'INDIVIDUAL',
    },
    team: {
        schemaId: 'hci271-week6-team-reflection',
        personaPath: 'personas/engaged-wk6-team.json',
        expectedSectionIds: ['2.1', '2.2', '2.3', '2.4', '3.1', '3.2'],
        expectedRosterPresent: true,
        expectedRatings: 5,
        labelTag: 'TEAM',
    },
};

if (!PROFILES[MODE]) {
    console.error('Usage: node verify_form_artifact_split.js [individual|team]');
    process.exit(2);
}
const profile = PROFILES[MODE];
console.log(`→ mode: ${MODE} (${profile.labelTag})`);
console.log(`→ host: ${HOST}`);

function request(method, urlStr, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const lib = u.protocol === 'https:' ? https : http;
        const data = body ? JSON.stringify(body) : null;
        const req = lib.request({
            method,
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: data
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                : {},
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
        if (data) req.write(data);
        req.end();
    });
}

(async () => {
    // 1. fetch schema
    const schemaUrl = `${HOST}/datapipeline/api/form_schemas/${encodeURIComponent(profile.schemaId)}/`;
    console.log(`→ fetching schema: ${schemaUrl}`);
    const rec = await request('GET', schemaUrl);
    if (!rec || !rec.body) throw new Error('schema record missing body');
    const schema = rec.body;
    console.log(`✓ schema v${rec.version}: ${rec.title} (${schema.sections.length} sections)`);

    // sanity: schema sections match expected IDs
    const ids = schema.sections.map(s => s.id);
    const idsMatch =
        ids.length === profile.expectedSectionIds.length &&
        ids.every((id, i) => id === profile.expectedSectionIds[i]);
    if (!idsMatch) {
        console.error(`✗ schema section IDs mismatch: got ${JSON.stringify(ids)}, expected ${JSON.stringify(profile.expectedSectionIds)}`);
        process.exit(1);
    }
    console.log(`✓ section IDs match expected: ${ids.join(', ')}`);

    // 2. load engine + docx UMD into a sandbox
    const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'leai-formmode.js'), 'utf8');
    const docxPath = '/tmp/docx.js';
    if (!fs.existsSync(docxPath)) {
        console.error(`✗ ${docxPath} not found — fetch docx UMD before running this script`);
        process.exit(2);
    }
    const sandbox = { console, Promise, Buffer, setTimeout, clearTimeout, setImmediate, queueMicrotask };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(engineSrc, sandbox);
    vm.runInContext(fs.readFileSync(docxPath, 'utf8'), sandbox);
    const engine = sandbox.leaiFormMode;
    if (!engine) throw new Error('engine failed to load');
    if (!sandbox.docx) throw new Error('docx UMD failed to load');

    // 3. walk persona
    const persona = JSON.parse(fs.readFileSync(path.join(__dirname, profile.personaPath), 'utf8'));
    const state = engine.init(schema, { team_id: persona.team || 'Team Coyote' });
    const transcript = [];
    engine.beforeTurn(state, null);
    {
        const post = engine.afterTurn(state, `Hi! I'll walk you through ${schema.sections.length} reflection areas. ${schema.sections[0].opening_prompt}`);
        transcript.push({ role: 'assistant', text: post.displayedMessage });
    }
    for (const userMsg of persona.turns) {
        transcript.push({ role: 'user', text: userMsg });
        engine.beforeTurn(state, userMsg);
        const post = engine.afterTurn(state, 'Got it, thanks.');
        transcript.push({ role: 'assistant', text: post.displayedMessage });
        if (state.ended) break;
    }
    console.log(`→ synthesized transcript: ${transcript.length} turns; engine progress: ${engine.progressLabel(state)}`);

    // 4. extract slots via local /openai-structured/ proxy
    console.log('→ extracting slots ...');
    const t0 = Date.now();
    const callStructured = (prompt, jsonSchema, opts) => request(
        'POST',
        `${HOST}/datapipeline/api/openai-structured/`,
        { user_text: prompt, json_schema: jsonSchema, schema_name: (opts && opts.schemaName) || 'extraction' },
    );
    const slots = await engine.extractSlots(state, transcript, callStructured);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ extracted ${Object.keys(slots).length} sections in ${dt}s`);

    // 5. render DOCX + HTML
    const html = engine.renderStructuredHtml(state, transcript, { studentName: 'Priya (verify-test)' });
    const docxBuf = await engine.renderStructuredDocx(state, transcript, { studentName: 'Priya (verify-test)' })
        .then(blob => blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob))
        .then(buf => Buffer.from(buf));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
    const outDir = path.join(os.homedir(), 'Downloads');
    const base = `HCI271_VERIFY_${profile.labelTag}_${stamp}`;
    const outDocx = path.join(outDir, base + '.docx');
    const outHtml = path.join(outDir, base + '.html');
    const outSlots = path.join(outDir, base + '.slots.json');
    fs.writeFileSync(outDocx, docxBuf);
    fs.writeFileSync(outHtml, html);
    fs.writeFileSync(outSlots, JSON.stringify({ schemaId: profile.schemaId, roster: state.roster, slots }, null, 2));
    console.log(`✓ wrote: ${outDocx}  (${docxBuf.length} bytes)`);
    console.log(`✓ wrote: ${outHtml}  (${html.length} bytes)`);
    console.log(`✓ wrote: ${outSlots}`);

    // 6. assertions
    const checks = [];
    function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail: cond ? '' : (detail || '') }); }

    // DOCX is a zip
    check('DOCX OOXML zip header', docxBuf[0] === 0x50 && docxBuf[1] === 0x4B && docxBuf[2] === 0x03 && docxBuf[3] === 0x04);
    check('DOCX size > 5KB', docxBuf.length > 5000, `size=${docxBuf.length}`);

    // every expected section has at least one slot value
    for (const sid of profile.expectedSectionIds) {
        const has = slots[sid] && JSON.stringify(slots[sid]).length > 30;
        check(`slot ${sid} populated`, has, has ? '' : `slot=${JSON.stringify(slots[sid] || null)}`);
    }

    // HTML must contain each section's title (compare against an HTML-escaped
    // form, since the renderer escapes & → &amp; etc.).
    function htmlEsc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    for (const s of schema.sections) {
        check(`HTML contains "${s.title}"`, html.indexOf(htmlEsc(s.title)) !== -1);
    }

    check('No "no response captured" placeholder', !/no response captured/i.test(html));

    if (profile.expectedRosterPresent) {
        check('2.2 roster row: Marco', /Marco/.test(html));
        check('2.2 roster row: Devi',  /Devi/.test(html));
        check('2.2 roster row: Yusuf', /Yusuf/.test(html));
        check('Roster freeze captured >=4 names', state.roster && state.roster.length >= 4, `roster=${JSON.stringify(state.roster)}`);
    }
    if (profile.expectedRatings > 0) {
        const matches = html.match(/<td>[1-5]<\/td>/g) || [];
        check(`2.4 has all ${profile.expectedRatings} ratings`, matches.length >= profile.expectedRatings, `found ${matches.length}`);
    }

    // PDF-alignment: every section's PDF-derived opening_prompt should appear
    // verbatim somewhere in the rendered transcript (proves the schema body
    // we just upserted is what's driving the bot — no stale fallback).
    for (const s of schema.sections) {
        const needle = (s.opening_prompt || '').slice(0, 60);
        check(`transcript contains opening_prompt prefix for ${s.id}`, needle && html.indexOf(needle) !== -1);
    }

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
