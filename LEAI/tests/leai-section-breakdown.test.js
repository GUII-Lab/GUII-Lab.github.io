const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../FeedbackAnalyzer.html'), 'utf8');
const block = html.slice(html.indexOf('        if (qt.form_sections && qt.form_sections.length) {'), html.indexOf('        // Phase 7: team health map'));
function render(sections) {
    const create = tag => ({ tag, children: [], appendChild(child) { this.children.push(child); }, textContent: '' });
    const accent = create('div');
    vm.runInNewContext(block, { qt: { form_sections: sections }, accent, document: { createElement: create } });
    const nodes = [];
    const visit = n => { nodes.push(n); n.children.forEach(visit); };
    visit(accent);
    return nodes;
}
test('section breakdown renders ordered questions and aggregate counts without quotes or source IDs', () => {
    const nodes = render([{section_number:1, section_title:'Class learning', summary:'Overview',
        quote:{rid:'R1',text:'Old representative quote'}, questions:[{question_number:1,
        question_label:'What felt unclear?', response_count:24, summary:'Combined experiences.'}]}]);
    const texts = nodes.map(n => n.textContent);
    assert(texts.includes('Section 1 · Class learning'));
    assert(texts.includes('Question 1 · What felt unclear?'));
    assert(texts.includes('24 responses summarized'));
    assert(texts.includes('Combined experiences.'));
    assert(!texts.some(t => t.includes('R1') || t.includes('Old representative')));
    assert(!nodes.some(n => ['a','button','blockquote'].includes(n.tag)));
});
test('legacy summaries remain readable while their old reference is omitted', () => {
    const texts = render([{section_title:'Methods',summary:'Original overview',quote:{rid:'R3',text:'old'}}]).map(n=>n.textContent);
    assert(texts.includes('Original overview'));assert(!texts.includes('old'));
});
