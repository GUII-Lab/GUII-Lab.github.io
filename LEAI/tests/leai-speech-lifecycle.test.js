'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../leai-shared.js'), 'utf8');
const speechSource = source.slice(source.indexOf('const leaiSpeech ='), source.indexOf('// ===== TEAMS API'));

function classes() {
    const values = new Set();
    return { add: s => values.add(s), remove: s => values.delete(s),
        toggle(s, on) { if (on) values.add(s); else values.delete(s); }, contains: s => values.has(s) };
}
function environment(live = true) {
    const recognizers = [];
    const recorders = [];
    const requests = [];
    let permissionResolve;
    let responseResolve;
    let stops = 0;
    class Recognition {
        constructor() { recognizers.push(this); }
        start() {}
        stop() { if (this.onend) this.onend(); }
        abort() { if (this.onend) this.onend(); }
        result(text, final = false) { const r = [{ transcript: text }]; r.isFinal = final; this.onresult({ results: [r] }); }
    }
    class Recorder {
        constructor() { recorders.push(this); this.mimeType = 'audio/webm'; }
        static isTypeSupported() { return true; }
        start() {}
        stop() { this.ondataavailable({ data: new Blob(['x'.repeat(8192)]) }); this.onstop(); }
    }
    const context = vm.createContext({ window: live ? { SpeechRecognition: Recognition } : {},
        navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { permissionResolve = resolve; }) } },
        MediaRecorder: Recorder, Blob, FormData, Event, API: 'http://test.invalid',
        console: { log() {}, error() {} }, setTimeout, clearTimeout,
        fetch(url) { requests.push(url); return new Promise(resolve => { responseResolve = resolve; }); } });
    vm.runInContext(speechSource + '\nthis.speech = leaiSpeech;', context);
    const button = { classList: classes(), attrs: {}, listeners: {},
        setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; },
        removeEventListener(k) { delete this.listeners[k]; } };
    const input = { tagName: 'TEXTAREA', value: 'Existing ', selectionStart: 9, classList: classes(),
        dispatchEvent() {}, setSelectionRange(start) { this.selectionStart = start; } };
    const counts = { text: 0, errors: 0, stop: 0 };
    const controller = context.speech.attachMicButton({ buttonEl: button, targetEl: input, mode: 'live',
        onText() { counts.text++; }, onError() { counts.errors++; }, onStop() { counts.stop++; } });
    return { button, input, controller, counts, recognizers, recorders, requests,
        permit() { permissionResolve({ getTracks: () => [{ stop() { stops++; } }] }); },
        respond() { responseResolve({ ok: true, json: async () => ({ text: 'Late transcript' }) }); },
        stops: () => stops };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('live dictation replaces interim text at the caret, preserves draft, and stops', async () => {
    const e = environment();
    await e.controller.start();
    e.recognizers[0].result('need');
    e.recognizers[0].result('need more time', true);
    assert.equal(e.input.value, 'Existing need more time');
    assert.equal(e.button.attrs['aria-pressed'], 'true');
    e.controller.stop();
    assert.equal(e.input.value, 'Existing need more time');
    assert.equal(e.button.attrs['aria-pressed'], 'false');
    assert.equal(e.input.classList.contains('leai-dictating'), false);
    assert.equal(e.requests.length, 0);
});
test('destroyed live controller ignores delayed results and errors across chat changes', async () => {
    const e = environment();
    await e.controller.start();
    e.controller.destroy();
    e.input.value = 'Next draft';
    e.recognizers[0].result('old words', true);
    e.recognizers[0].onerror({ error: 'not-allowed' });
    assert.equal(e.input.value, 'Next draft');
    assert.deepEqual(e.counts, { text: 0, errors: 0, stop: 0 });
    assert.equal(e.button.attrs['aria-pressed'], 'false');
});
test('destroy during pending microphone permission releases the stream without recording', async () => {
    const e = environment(false);
    const start = e.controller.start();
    e.controller.destroy();
    e.permit();
    await start;
    assert.equal(e.stops(), 1);
    assert.equal(e.recorders.length, 0);
    assert.equal(e.requests.length, 0);
});
test('destroy cancels an unfinished recording without sending it for transcription', async () => {
    const e = environment(false);
    const start = e.controller.start(); e.permit(); await start;
    e.controller.destroy();
    await tick();
    assert.equal(e.requests.length, 0);
    assert.equal(e.stops(), 1);
});
test('destroy ignores an already requested transcription when its response arrives', async () => {
    const e = environment(false);
    const start = e.controller.start(); e.permit(); await start;
    e.controller.stop();
    assert.equal(e.requests.length, 1);
    e.controller.destroy();
    e.input.value = 'Next draft';
    e.respond(); await tick();
    assert.equal(e.input.value, 'Next draft');
    assert.equal(e.counts.text, 0);
});
test('recorded fallback still inserts a completed transcript during normal use', async () => {
    const e = environment(false);
    const start = e.controller.start(); e.permit(); await start;
    e.controller.stop(); e.respond(); await tick();
    assert.equal(e.input.value, 'Existing Late transcript');
    assert.equal(e.counts.text, 1);
});
