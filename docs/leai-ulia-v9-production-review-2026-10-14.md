# Ulia v9: production release and six-conversation review

Date: 2026-10-14, America/Chicago. **The release and requested six runs are complete; orchestrator acceptance remains HOLD.** Completing the conversations does not establish semantic correctness or reliable operation.

## Released scope

Heroku `guiidata` v86 succeeded, using the production v85 source as baseline plus 19 scoped source files. Actual dyno file hashes, `orchestrator-v9-historical-source`, and `gpt-5.6-luna` were verified. No additional migrations, dependency/runtime changes, or unrelated canonical Advisor changes were released. The production-based candidate passed all 398 tests; frontend regression passed 107 tests before deployment.

GitHub Pages deployed `dca1e92006c63b2fa063dc648e317e259710a7dd`; its debug script and three consuming pages matched live bytes. Only `cmpm80h-wi27` (course 133) has debug enabled. Additive surveys 312 and 313 use the v2 conversational and rate-and-reflect schemas. V1 surveys and historical agreement-scale data remain unchanged. V2 preserves the original Doc's frequency scale: 0 Never, 1 Rarely, 2 Occasionally, 3 Usually, 4 Often, 5 Frequently, 6 Always.

Before starting the new sessions, the exact previous six synthetic sessions (PK 9–14) were soft archived. Their 182 messages and 93 debug events remain retained; none are visible through normal queries. Week 0 survey 277 remains at 86 messages. Final production readback confirmed these counts and release v86.

## Six real browser runs

Each session used the actual deployed GitHub Pages page, production backend, and real provider. Required Terms/Privacy acceptance was explicitly authorized for these six sessions; optional research consent remained false. No interception, mock service, screenshots or recordings were used.

| Schema | Style | Messages | Successful student turns | State events | Rejected attempts |
|---|---|---:|---:|---:|---:|
| Conversational | Serious | 26 | 12 | 16 | 3 |
| Conversational | Rude | 24 | 11 | 12 | 0 |
| Conversational | No ideas | 30 | 14 | 15 | 0 |
| Rate and reflect | Serious | 26 | 12 | 13 | 0 |
| Rate and reflect | Rude | 24 | 11 | 12 | 0 |
| Rate and reflect | No ideas | 34 | 16 | 23 | 6 |
| **Total** | | **164** | **76** | **91** | **9** |

All six reached the 11-item review-ready state and restored on reload. They remain unfinalized so their conversations can still be reviewed. Every saved message links to recorded state: the two opening AI messages share the initial event, and each subsequent student/AI pair links to its turn's before/after snapshots. There are 76 distinct successful receipts, contiguous message/version chains, and no missing state or duplicate committed turn. Every rejected attempt kept before/after state identical.

The serious Conversational clarification initially failed three times under the same pending request. Reopening the same session and resending the same text succeeded. The no-ideas rating session's final answer failed six times across two pending requests; a more explicit no-memory/no-rating rephrasing in the same session succeeded. These are retained failures, not six uninterrupted successful journeys.

## Review method and confirmed findings

The original Google Doc was read live: **LEAI AI Usage & Metacognition Pilot Study Protocol**, document `1W9dgKfqWHDkETiB4j5pvkP2UUGgqN8T3GjNgBz4q5ic`, tab `t.gjss96n71ypj`. Its authored instrument and each session's frozen protocol are the acceptance references. Example probes are optional; a sufficient general practice does not require an anecdote.

After all six completed, the parent reviewed every full utterance and lossless state change, traversed every snapshot field, and checked unchanged-state chains. Three independent reviewers separately reviewed all six conversations and all recorded before/after events, with explicit message/event coverage ledgers.

1. **Important: valid inputs can repeatedly fail assessment identity validation.** Serious Conversational event IDs 99/101/103 and no-ideas rating events 178–183 each returned `assessment_unavailable`. All nine record two `stale_assessment` diagnostics, including their bounded repair attempt. State protection worked, but a normal student can be blocked by internal model/contract handling. The telemetry identifies the rejected category; it does not retain raw returned identities, so it does not by itself prove the exact mechanism producing the mismatch. Passing after reopening or rephrasing does not resolve this defect.

2. **Important: a current-question refusal changes an unrelated historical answer's metadata.** In rude Conversational event 108 (student message 5 → AI message 6), “Skip this question. I refuse to answer either part.” refers to P2. The committed state also adds a P1 `refused` closure citing that P2 message and changes P1 `decision_process` from `not_applicable` to `covered`. The student's P1 answer was explicitly negative and was not withdrawn. P1's raw answer/status remain retained, but its closure and coverage provenance become incorrect and persist to the end. The v9 requirement for a latest-message citation blocks old-only regrading; it does not establish that the latest quote actually concerns the historical item.

3. **Moderate: a refusal is incorrectly marked as supplied answer content.** Rude Conversational event 118 (student message 15 → AI message 16) correctly marks M3 `declined` with a refusal closure, but also stores `satisfied_components: ["answer"]`. The utterance only refuses to discuss the question. The state should distinguish a closed missing answer from a supplied substantive answer. The readable panel still says declined; consumers of the JSON component flags receive contradictory metadata.

Lower-priority observations: serious Conversational acknowledgements sometimes praise the practice (“thoughtful”, “useful”), which can weaken a neutral interview register. Serious rating AI message 4 paraphrases the next item and repeats scale guidance before the exact server-rendered item/scale. These are wording improvements, separate from the three confirmed acceptance findings.

CS event 152 lists E3 in `assessment.completed_ids` before the E3 response. This was considered and **not accepted as an answer-completion defect**: those IDs account for assessor work, which may include an additional known item's no-update decision. No E3 answer was invented and the main E3 was still presented. Work completion and student answer satisfaction are distinct.

One reviewer also raised LN M3 as a construct-specific overcredit concern: recognizing a bias does not establish checking it. The parent retains this as an interpretation boundary rather than a fourth confirmed defect. This frozen Likert schema permits a relevant reason/example as reflection, and the state keeps the item partial with no rating; it does not claim the student performed a checking action. The conversational version appropriately asks about the missing checking behavior. Future goal-specific assessment should preserve that distinction rather than discard the useful qualified explanation.

## What worked

All 11 authored main items appeared in order. The 0–6 frequency scale remained correct, including explicit values 0 and 6. Serious rating answers saved 4; the no-ideas rating session never acquired an invented score. Pure clarification did not create an answer, explicit negative practices were usually accepted without moralizing, and explicit inability/refusal boundaries generally stopped further probing. Useful earlier reflection was retained when the student could not add a rating. Overlapping spans did not duplicate exported answer text.

The researcher pass opened **all 88 per-reply debug panels** on the real production pages and downloaded all six debug JSON files through the UI. Every exported event's before/after state and metrics matched the database. At 390px and 320px viewport widths all expanded panels stayed within their own width. Anonymous student passes displayed zero researcher panels. The review pass created no new student turn, receipt or debug event.

Researcher UI access used an existing server-issued course-scoped capability minted through authorized operator access in an isolated browser context. This exercises deployed server authorization and the actual panel/export UI; it is **not** a normal teacher password-login test. Chromium viewport checks are not physical-phone, touch, WebKit or Firefox acceptance. No final reflection/certificate download, microphone, canonical React/Advisor acceptance, or universal model correctness is claimed. The browser observer produced 12 harmless OPTIONS-body read warnings; these were classified separately from product runtime errors (zero).

## Recommended next repair boundary

Keep the server-owned task receipt and input/version checks, but avoid requiring the model to reproduce an opaque work identity as a semantic output. Bind the returned assessment to its dispatched work in application code and preserve stale-work rejection. Separately, require item-specific semantic support before a historical closure/coverage change can commit; a fresh quote alone is insufficient. Validate component satisfaction independently from closure so a refusal cannot supply a missing answer. Add regressions for these exact retained cases, then perform another unchanged-version six-run evaluation rather than editing these records into a passing result.

Private evidence: `.context/ulia-release-v9-2026-10-14/`, including manifests, release and archive receipts, full DB JSON, six actual UI exports, all-panel DOM records, deterministic audit, parent and independent coverage ledgers. Tokens, production source copies and raw synthetic conversations are excluded from Git and Linear. This legacy result does not close canonical HAR-198/React acceptance.
