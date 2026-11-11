#!/usr/bin/env node
//
// Replay-based regression for form-mode slot extraction.
//
// Unlike verify_form_artifact_split.js (which synthesizes a transcript by
// walking a persona through the engine), this script loads a CAPTURED
// transcript fixture and asserts that extractSlots recovers the expected
// answers. Built to lock down the bug reported around `team_reflection_150_*`:
// student answered three sub-fields of section 1.3, two came back as
// "(not captured)".
//
// Usage:
//   node verify_form_artifact_replay.js fixtures/wk6-bug-150-individual.json
//
// Requires the local Django backend on $LEAI_API_HOST (default
// http://localhost:8000) so it can fetch the schema and call
// /openai-structured/.
//
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const https = require('https');

const fixturePath = process.argv[2];
if (!fixturePath) {
    console.error('Usage: node verify_form_artifact_replay.js <fixture.json>');
    process.exit(2);
}
const HOST = process.env.LEAI_API_HOST || 'http://localhost:8000';

const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
const schemaId = (fixture._provenance && fixture._provenance.schema_id) || null;
if (!schemaId) {
    console.error('✗ fixture missing _provenance.schema_id');
    process.exit(2);
}
console.log(`→ fixture: ${fixturePath}`);
console.log(`→ schema:  ${schemaId}`);
console.log(`→ host:    ${HOST}`);
console.log(`→ turns:   ${fixture.transcript.length}`);

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
            timeout: 90000,
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
    const schemaUrl = `${HOST}/datapipeline/api/form_schemas/${encodeURIComponent(schemaId)}/`;
    console.log(`→ fetching schema: ${schemaUrl}`);
    const rec = await request('GET', schemaUrl);
    if (!rec || !rec.body) throw new Error('schema record missing body');
    const schema = rec.body;
    console.log(`✓ schema v${rec.version}: ${rec.title} (${schema.sections.length} sections)`);

    // 2. load engine in a vm sandbox (no docx needed — we only check slot JSON)
    const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'leai-formmode.js'), 'utf8');
    const sandbox = { console, Promise, Buffer, setTimeout, clearTimeout, setImmediate, queueMicrotask };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(engineSrc, sandbox);
    const engine = sandbox.leaiFormMode;
    if (!engine) throw new Error('engine failed to load');

    // 3. init engine state from fixture (no live walk; we only need .schema
    //    and .roster for extractSlots; coverage is irrelevant for extraction)
    const state = engine.init(schema, { team_id: null });

    // 4. extract slots via local /openai-structured/ proxy
    console.log('→ extracting slots ...');
    const t0 = Date.now();
    const callStructured = (prompt, jsonSchema, opts) => request(
        'POST',
        `${HOST}/datapipeline/api/openai-structured/`,
        { user_text: prompt, json_schema: jsonSchema, schema_name: (opts && opts.schemaName) || 'extraction' },
    );
    const slots = await engine.extractSlots(state, fixture.transcript, callStructured);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ extracted ${Object.keys(slots).length} sections in ${dt}s\n`);

    // 5. dump slots for the human reviewer
    console.log('─── EXTRACTED SLOTS ─────────────────────────────────────────────');
    for (const sid of Object.keys(slots)) {
        console.log(`[${sid}]`);
        const slot = slots[sid];
        if (!slot) { console.log('  null'); continue; }
        for (const k of Object.keys(slot)) {
            const v = slot[k];
            const s = typeof v === 'string'
                ? (v.length > 120 ? v.slice(0, 117) + '...' : v)
                : JSON.stringify(v).slice(0, 120);
            console.log(`  ${k}: ${s}`);
        }
    }
    console.log('─────────────────────────────────────────────────────────────────\n');

    // 6. assertions driven by fixture.expected_recoveries
    const checks = [];
    function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: ok ? '' : (detail || '') }); }
    const NOT_CAPTURED = /\(\s*not\s+captured\s*\)/i;

    const expected = fixture.expected_recoveries || {};
    for (const sid of Object.keys(expected)) {
        const slot = slots[sid] || {};
        for (const fieldKey of Object.keys(expected[sid])) {
            const spec = expected[sid][fieldKey];
            const val = slot[fieldKey];
            const valStr = typeof val === 'string' ? val : (val != null ? JSON.stringify(val) : '');
            const captured = !!valStr && !NOT_CAPTURED.test(valStr);
            check(
                `${sid}.${fieldKey} is captured (not "(not captured)")`,
                captured,
                `value=${JSON.stringify(valStr).slice(0, 200)}  // ${spec.rationale}`,
            );
            if (captured && spec.must_contain) {
                const needle = spec.must_contain.toLowerCase();
                // The model is instructed to smooth student wording in the
                // VALUE but to quote verbatim in _evidence. Accept the needle
                // in either — semantic fidelity is what we care about.
                const ev = slot._evidence && slot._evidence[fieldKey];
                const evStr = typeof ev === 'string' ? ev : '';
                const haystack = (valStr + ' ' + evStr).toLowerCase();
                check(
                    `${sid}.${fieldKey} contains "${spec.must_contain}" (value or evidence)`,
                    haystack.includes(needle),
                    `value=${JSON.stringify(valStr).slice(0, 160)}  evidence=${JSON.stringify(evStr).slice(0, 160)}`,
                );
            }
        }
    }

    // 6b. Evidence-integrity checks (P1): a quoted snippet must actually
    //     appear in the transcript (whitespace-normalized), and the slot
    //     value must be consistent with whether evidence exists.
    function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    const transcriptText = norm(fixture.transcript.map(t => t.text).join(' '));
    for (const sid of Object.keys(slots)) {
        const slot = slots[sid] || {};
        const ev = slot._evidence;
        if (!ev || typeof ev !== 'object') continue;
        for (const k of Object.keys(ev)) {
            const quote = norm((ev[k] || '').replace(/^["“]+|["”]+$/g, ''));
            const value = slot[k];
            const isMissing = typeof value === 'string' && NOT_CAPTURED.test(value);
            // Consistency: empty quote ⇔ "(not captured)" value
            check(
                `${sid}.${k} value/evidence consistency`,
                (quote === '' && isMissing) || (quote !== '' && !isMissing),
                `value="${String(value).slice(0, 80)}" quote="${quote.slice(0, 80)}"`,
            );
            // Integrity: if a quote is claimed, every contiguous fragment of
            // it (split on ellipsis "…" / "...") of ≥20 chars must appear in
            // the transcript. Strict enough to catch fabrication, lenient
            // enough to allow the model to elide between two real spans.
            if (quote) {
                const fragments = quote
                    .split(/\s*(?:…|\.{3,})\s*/)
                    .map(f => f.trim())
                    .filter(f => f.length >= 20);
                const probes = fragments.length ? fragments : [quote.slice(0, 40)];
                const missing = probes.filter(p => !transcriptText.includes(p.slice(0, 40)));
                check(
                    `${sid}.${k} evidence quote appears in transcript`,
                    missing.length === 0,
                    `missing fragment(s): ${missing.map(m => '"' + m.slice(0, 50) + '"').join(', ')}`,
                );
            }
        }
    }

    // 7. assertions for expected-genuine-misses (don't recover what isn't there)
    const misses = fixture.expected_genuine_misses || {};
    for (const sid of Object.keys(misses)) {
        const slot = slots[sid] || {};
        // For 1.1/1.2 the only required string field is 'summary' (single-shortform).
        // Mark check on summary; tolerant if some other key is also present.
        const summary = slot.summary;
        if (typeof summary === 'string') {
            check(
                `${sid}.summary stays "(not captured)" (${misses[sid].slice(0, 60)}...)`,
                NOT_CAPTURED.test(summary),
                `value=${JSON.stringify(summary).slice(0, 200)}  // critic must not fabricate`,
            );
        }
    }

    let pass = 0, fail = 0;
    for (const c of checks) {
        const mark = c.ok ? '✓' : '✗';
        console.log(`${mark} ${c.name}${c.detail ? '\n     ' + c.detail : ''}`);
        c.ok ? pass++ : fail++;
    }
    console.log(`\n${pass}/${checks.length} checks passed`);

    // Also surface evidence trail if present (P1)
    let hasEvidence = false;
    for (const sid of Object.keys(slots)) {
        if (slots[sid] && slots[sid]._evidence) { hasEvidence = true; break; }
    }
    if (hasEvidence) {
        console.log('\n─── EVIDENCE TRAIL (P1) ─────────────────────────────────────────');
        for (const sid of Object.keys(slots)) {
            const ev = slots[sid] && slots[sid]._evidence;
            if (!ev) continue;
            console.log(`[${sid}]`);
            for (const k of Object.keys(ev)) {
                const q = ev[k];
                const display = q ? `"${q.slice(0, 100)}"` : '(empty — abstained)';
                console.log(`  ${k}: ${display}`);
            }
        }
        console.log('─────────────────────────────────────────────────────────────────');
    } else {
        console.log('\n(no _evidence trail in slots — P1 not applied yet)');
    }

    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
    console.error('FAILED:', e);
    process.exit(2);
});
