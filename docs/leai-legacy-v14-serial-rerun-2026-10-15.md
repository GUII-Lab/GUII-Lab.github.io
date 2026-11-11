# GUII Lab legacy: v14 deployment and fresh serial six-dialogue test

GUII Lab’s static `LEAI/` frontend now calls the improved shared v14 orchestrator on production `guiidata` release **v88**. All **24 prior Ulia synthetic sessions** in `cmpm80h-wi27` are soft archived. Six fresh hosted conversations were then run serially, with the operator reading each actual AI reply before choosing the next synthetic student response. This report concerns the legacy product; canonical React LEAI QA is a separate deployment.

## Deployment and scope

- Release v88 succeeded; build `9bf12519-fbd0-4cae-89f7-7eaba1b2c28e`, slug `92f30f69-a110-4f52-9e51-f842d56a749d`.
- Actual prompt: `orchestrator-v14-authored-scale-context`. Existing legacy model configuration remains `gpt-5.6-luna`.
- Exact frozen archive SHA256: `1925a6f502c21e39f88ecbe42ada925403dff9026fadf2932a430b1b26a795a0`. All **117 deployed source files** matched the frozen payload after deployment and again after browser review.
- Payload is the verified v87 production baseline plus five changed source files and one new regression-test file. Four shared executor files are byte-identical to the current canonical backend. The legacy-only diagnostic projection and tests were reconciled in focused backend commit `2fd8fde`.
- v14 preserves authored frequency/agreement/custom scale meaning, bounds and retains attempt explanations and invalid-reference details, and improves instructions about probe counts and neutral qualifiers. It retains the unified decision/dialogue architecture, server validation and bounded repair; these changes do not guarantee perfect semantic judgments.
- Course allowlists/debug remain limited to `cmpm80h-wi27`. Schemas 314/315 retain their existing protocol-3 bodies and all 11 items. Historical protocol1/2 sources and frozen sessions were not silently rewritten. No frontend changes, new migrations, canonical QA promotion or unrelated backend changes were included. Production backup `b021` completed before release.

## Soft archive and preservation

Eighteen earlier synthetic sessions were already archived. The six remaining v13 sessions (`1a5d36b9`) and their **168 messages** were explicitly soft archived after v88 deployment. All 24 old synthetic sessions and **706 messages** are now archived, with their contents, debug records and receipts retained. This does not delete original Week 0 records.

All preexisting target-course row-content hashes matched before/after deployment, after archival and after the six new tests. The course still has seven surveys/seven schemas, and Week 0 still has **86 messages**. Course-scoped totals changed only by the six new sessions, 170 messages, 85 debug events and 79 receipts:

| Records | Before fresh six | After fresh six |
| --- | ---: | ---: |
| Sessions, including archived | 24 | 30 |
| Messages, including archived and Week 0 | 792 | 962 |
| Debug events | 270 | 355 |
| Turn receipts | 329 | 408 |

## Actual fresh browser execution

Nonce **3333427f**. Six distinct Chrome browser contexts were used one after another. Each next response was selected after reading the real previous AI reply; browser automation performed the actual typing, Enter and debug-panel clicks. Required Terms/Privacy were accepted under the owner’s standing synthetic-test authorization; optional research consent stayed off. No mocked business responses, intercepted replacement APIs, screenshots or recordings were used.

Execution ran **14:48:37.849–15:12:46.504 UTC on October 15**, about **24 minutes 9 seconds**. Earlier v13 records were not relabeled as this batch. Resume links below open the new online records.

| Run | Schema and style | Browser period, UTC | Student turns | Messages | Resume |
| --- | --- | --- | ---: | ---: | --- |
| CS | Conversational, serious | 14:48:37–14:52:00 | 12 | 26 | [Open CS](https://guii-lab.github.io/LEAI/feedback.html?id=0QRWZ9IEOgnF#cid=ulia-v14-live-cs-20261015-3333427f) |
| CR | Conversational, rude/refusal | 14:52:00–14:54:53 | 11 | 24 | [Open CR](https://guii-lab.github.io/LEAI/feedback.html?id=0QRWZ9IEOgnF#cid=ulia-v14-live-cr-20261015-3333427f) |
| CN | Conversational, uncertain/no ideas | 14:54:53–14:59:54 | 16 | 34 | [Open CN](https://guii-lab.github.io/LEAI/feedback.html?id=0QRWZ9IEOgnF#cid=ulia-v14-live-cn-20261015-3333427f) |
| LS | Rate and reflect, serious | 14:59:55–15:03:28 | 12 | 26 | [Open LS](https://guii-lab.github.io/LEAI/feedback.html?id=gLcPJjShTgC4#cid=ulia-v14-live-ls-20261015-3333427f) |
| LR | Rate and reflect, rude/refusal | 15:03:28–15:06:38 | 11 | 24 | [Open LR](https://guii-lab.github.io/LEAI/feedback.html?id=gLcPJjShTgC4#cid=ulia-v14-live-lr-20261015-3333427f) |
| LN | Rate and reflect, uncertain/no ideas | 15:06:38–15:12:46 | 17 | 36 | [Open LN](https://guii-lab.github.io/LEAI/feedback.html?id=gLcPJjShTgC4#cid=ulia-v14-live-ln-20261015-3333427f) |

All six reached review-ready. They remain online and unarchived; final document download was not forced, so students can still revise. There were **79 committed student turns, 82 real provider calls, three successful internal repairs and zero failed HTTP turn requests**. The three repairs were LS/P1 event314, LS/M4 event322 and LN/M3 event348. The first two retained exact `outside_active_answer` paths for rating evidence. The last retained both explanations and `proposal_validation`; the exact original invalid proposal field is not established by that category alone.

## Debug and verification coverage

- All **170 messages, 85 events, 170 complete before/after JSON snapshot trees and 79 receipts** were structurally checked. Input/protocol bindings, sequence/version continuity, quote spans, supplied/closed components and probe limits were checked against actual stored records. The complete hidden/unprojected runtime state hash is not independently reconstructable from debug projections alone.
- Every committed turn has an explicit item/action explanation as applicable. All **91 AI debug panels** were opened in the real hosted UI; six actual JSON downloads matched all exported states and metrics against the database. Desktop and 390/320-pixel checks had no panel overflow or page errors. This is Chrome verification, not a physical-phone or fresh multi-engine acceptance claim.
- Candidate full suite **433 PASS**; independent reviewer’s full suite **433 PASS**. A separate run using Python3.12/Django4.2.7 and the production requirements also passed **433**. This verifies requirements compatibility, not a claim that every transitive installed package exactly matches production. No migration changes; collectstatic passed.
- Two real local provider smoke calls (one per schema, including a valid zero rating) passed without repair before release. These are separate from the 82 hosted calls.
- The original reused audit first failed because it still expected the v13 prompt and all-LS ratings of4. The original oracle file and failure are retained; the scoped v14 checker expects the actual v14 identity and the deliberately submitted LS ratings0/4/6. No product data or acceptance checks were removed to obtain a pass.

## Semantic review

The independent verdict is **scoped ACCEPT for this completed batch and the two authored protocols**, with no Critical or Important committed-answer defect established. Every message, event, stored attempt and snapshot was reviewed against the frozen original Google Doc tab and actual schemas. This is not zero-defect or whole-product acceptance.

Three Minor researcher-facing fidelity/provenance findings remain in the retained records:

| Location | Observation | Practical boundary |
| --- | --- | --- |
| CR293, student sequence19 | Action reason says E2 was already presented, although this response first presents it. | Next question and saved answer are correct; the historical premise in the reason is false. |
| CN309, sequence27 | Student says experience “affects” later wording; reason says “improve or adapt.” | Adaptation is supported; demonstrated improvement is not. This wording is weaker than v13’s unqualified “improves.” |
| LN344/352, sequences13/29 | Inability to choose a rating is categorized as `refused`, with explicit leave-blank/move-on requests. | Null rating and closure are correct, but the label should not establish unwillingness rather than inability. |

**M3 interpretation boundary:** LN348/349 retains a causal observation about preferring familiar conclusions as a Likert reflection, keeps the rating null and the item partial, and does not claim the student checks/counters bias. Its authored goal invites a reason/example independently of frequency. The text-mode CN306/307 goal specifically asks whether/how checking occurs; it correctly leaves that answer unsupplied. The initial concern that LN fabricated a checking practice was not established after inspecting both schemas. Downstream analysis must not treat `reflection` supplied as evidence of positive checking frequency. The original source Doc does not define a narrower machine-level rule for that edge case.

Clarification-only handling, exact authored scales, explicit zero/six values, refusals without invented scores, example-only limitations and component-specific closure all support the scoped verdict. The former false probe-limit claim was not observed in the new end states. The pre-release source review separately retains one minor diagnostic limitation around automatically retired old-rating evidence; that input was not exercised in this hosted batch.

The old v13 batch needed two external retries out of80 attempted requests; this batch had zero out of79. Inputs and execution differ, so this is an observation about these two batches, not a controlled error-rate improvement or a general reliability estimate. Full independent report and message/event/attempt coverage are in `independent-review/` under the private phase folder.

Private reproducible evidence: `.context/ulia-legacy-v14-2026-10-15/` contains frozen source hashes, deployment receipt, archive receipt, preservation hashes, serial browser traces, raw six-session exports, lossless state views, downloaded debug JSON and independent reviews. Owned browsers are closed and the temporary course-debug capability file has been deleted. Unrelated files/processes and the original failure evidence are preserved.
