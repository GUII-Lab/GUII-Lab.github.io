# Unified Ulia Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute inline, retain one final independent review, preserve unrelated work.

**Goal:** Implement one normal AI call for interpretation and dialogue, record readable justifications, and validate both Ulia schemas through six complete real local browser conversations before remote publication.

**Architecture:** Add execution protocol3, leaving frozen v1/v2 paths unchanged. A unified typed proposal supplies updates, response and short explanations; server-owned input/version binding replaces model-echo identity. Existing reducer, atomic persistence and debug authentication remain authoritative.

**Tech Stack:** Existing Django/Postgres/OpenAI Responses/Pydantic backend, static vanilla-JS LEAI, uv-managed Python3.12 candidate runtime, real Chrome/Puppeteer browser gestures.

**Spec:** `docs/leai-ulia-unified-orchestrator-design-2026-10-14.md` (owner approved and explicitly instructed implementation + local six-run verification, then remote). Preserve the previously selected native execution method; the latest explicit proceed instruction authorizes this implementation, so do not request execution authorization again.

## Global Constraints

- Current branches only; no new branches/worktrees. Work initially in a private production-based source copy, then apply only hash-matched owned files to canonical backend. Other Advisor changes are unrelated.
- Normal1provider call, at most1repair within24s; same actual gpt-5.6-luna model; no mandatory second semantic agent.
- Protocol3 additive schemas preserve the exact11items and0–6frequency of frozen v2. v1/v2 remain routed to their existing engines.
- Short item justification≤600characters; action justification≤400characters. Reasons are explicit auditable output, not hidden chain-of-thought and not proof of truth.
- Chat/resume researcher-only display, same Recorded schema state, full wrapping, actual JSON export; no Analyzer insertion, no screenshots/recordings.
- Real local six = two schemas × serious/rude/noideas. Complete all before final semantic review; retain every message/state/justification and failures. Optional research consent off.
- Local evidence first. Publication only after scoped acceptance; do not publish an unresolved regression or push unrelated backend commits.

## Review Focus

1. Current P2 refusal must not change P1; genuine unnumbered historical corrections and shared/multi-item answers must still work.
2. First/only refusal cannot count as supplied content; earlier valid content and useful current content must survive refusal to elaborate.
3. Reasons must come from the committed proposal; failed proposed explanations must be visibly uncommitted; no old reasons reconstructed.
4. Independent version/input binding must reject stale results and preserve same-request idempotency after deleting model UUID echo.
5. Neutral clarification, meaningful uncertainty, negative practice and score-only/reflection-only answers must not regress under the unified prompt.

## Task1 — New unified contract, reducer checks and additive instrument versions

**Files (backend):** create `leai/services/unified_orchestration.py`, `leai/tests/test_unified_orchestration.py`, fixtures `ulia_conversational_v3.json`, `ulia_likert_v3.json`; modify `services/protocol.py`, `services/orchestration.py`, management command `install_legacy_ulia_reflections.py`.

**Interfaces:** `UnifiedAnswerUpdate(AnswerUpdate)` adds required justification; `UnifiedTurnProposal(TurnProposal)` adds required action_justification and typed updates. `prepare_unified_proposal(protocol,state,messages,raw,referral_policy=None)` returns `(state,reply,base_proposal,decision_explanation)`, using the same reducer after stripping explanation-only fields. `source_binding(protocol,state,messages)` returns server-owned protocol/state/input hashes.

- [x] RED: protocol3 validation; v3 fixture equality to v2 exceptversion; bounded required reasons; original CR108/118 failure patterns; same-message valid answer plus boundary; real prior-answer preservation and historical corrections.
- [x] Implement supportedversion3 without altering old fixture bytes. Add structural consistency checks only forv3: new covered target needs current nonboundary supporting evidence; first supplied component cannot derive solely from refusal evidence. Do not keyword-classify or ban all historical changes.
- [x] GREEN: exact new tests plus existing protocol/orchestration/repair tests. Test example:

```python
raw = unified_proposal_for_current_refusal()
_, _, proposal, reason = prepare_unified_proposal(protocol3, state, messages, raw)
assert proposal['updates'][0]['satisfied_components'] == []
assert reason['items'][0]['justification'] == raw['updates'][0]['justification']
```

## Task2 — Unified provider and transactional source binding

**Files:** create `datapipeline/orchestration_unified.py`; modify `orchestration_client.py`, `orchestration_diagnostics.py`, `leai_legacy_orchestration.py`; create `leai/tests/test_unified_provider.py`; extend `datapipeline/tests/test_legacy_reliability.py`.

**Interfaces:** `run_unified_orchestration(protocol,state,messages,client=None,model=None,deadline_seconds=24,max_requests=2,referral_policy=None)` returns the existing state/reply/proposal/metrics envelope plus server-generated binding. Protocol3 routes here;2 continues assessed;1 continues old contextual. `validate_result_accounting` verifiesv3binding against actual precommit input and stores it asdecision_binding, not assessment work accounting.

- [x] RED: one normal request for updates+dialogue; no assessor ID/expected_history_ids sent/required; wrong evidence triggers at mostone repair; stale binding and extra/invalid output rejected without commit; providerfailuredoesnotbecomeunknown.
- [x] Implement one prompt with full contextual flexibility, current-item default scope and explicit reasoning for historical updates. No allowed-actions enumeration or forced unchanged history decisions.
- [x] Preserve shared deadline and no SDK retries; retain exact provider stage/model/token/duration diagnostics. Test:

```python
result = run_unified_orchestration(protocol3, state, messages, client=fake_client)
assert fake_client.responses.create.call_count == 1
assert result['binding'] == source_binding(protocol3, state, messages)
assert result['metrics']['decision_explanation']['action']['justification']
```

- [x] GREEN: new provider and registered legacy persistence tests; full candidate backend suite afteralltasks. Capture deterministic original failure regressions and positive counterparts.

## Task3 — Recorded explanations and real chat display

**Files:** backend `leai_legacy_debug.py`, `tests/test_legacy_debug.py`; frontend `LEAI/leai-debug.js`, `LEAI/tests/leai-debug-reliability.test.js`; cache consumers `feedback.html`, `Customizations.html`, `PromptDesigner.html` onlyifdebugassetbyteschange.

- [x] RED: snapshot includesv3decision_binding; safe typed decision_explanation projection drops unknown/raw fields, bounds text and quotes; committed and rejectedproposalmeaningdistinguished; unauthorizedstudentstillgetsnodebug.
- [x] RED: frontend rendersitem/actionjustificationsandquotedstudentreferenceswithtextContent/fullwrapping; oldeventsmissingreasonsareexplicitlyunrecorded; no hidden/rawJSONbody; export retains the same recorded explanation.
- [x] Implement new section before model/timing with finite statuslabels; reuse existing replypanel andexport. Keep all student-facing response text free of researcherjustifications.
- [x] GREEN: all frontend debug tests and complete existing frontend regressioncommand. Candidatehostrealpagecheckat1440/390/320withallreplypanels andactualJSONdownload.

## Task4 — Frozen comparison, real local six and independent review

**Private artifacts:** `.context/ulia-unified-2026-10-14/` owns candidate source, settings, isolatedPostgresdatabase, sourcehashes, runner, localresults and reviewledgers. Use uv-managed Python3.12/productionrequirements. Readkeyfromexistingauthorizedbackend.envwithoutprintingit. Do nottouchthealreadyrunninglocalhost8000server; isolatedbackend8098/frontend8099, routeonlyAPItransportto8098.

- [x] Build comparison fixtures from immutable v86 records forCR108/118, pureP2clarification, oldLNE3no-memory input, score0/6, meaningfuluncertainty, genuine historicalcorrection and multi-itemupdates. Identical student inputs and normalized protocolversion state between engines; separately report version-dependent contract changes.
- [x] Run full candidatebackend suite and complete frontend suite, migrationdrift check. Record actual command results; no runtime acceptance from test mocks.
- [x] Start ownedlocalservices, migrate independentlocalDB, seed synthetic course with real passwordlogin andtwoV3surveys. Verify no production connection beforewrites.
- [x] RealbrowserpreflightatrequiredTerms gate; obtain specific six-session acceptance confirmation if not already included by browser policy. Optionalresearchoff.
- [x] Complete CS,CR,CN,LS,LR,LN with actual click/type/Enter andactualprovider. Initial wording matches saved productionv86fixtures, including original LNE3input, no successful-input substitution. Followups remain actual context-responsive studentanswers. Bound retries, retain failures.
- [x] Afterall6: readbackALLmessages/receipts/events/reasons, verifybindings/idempotency/statecoverage, openALLreplydebugpanels anddownloadallJSON. Inspectdesktopand390/320pxwithnoscreenshots. Do not finalize while revisions/reviewremainnecessary.
- [x] Fresh independent full review under the preserved native method. Review every message andbefore/afterJSON/reason; locate findings and verify ledgercoverage. Include exact-instrument Doc snapshot. Compare counts withv86, distinguish defectintroductions from persistentcopies and retriesfromindependentsamples.

## Task5 — Focused integration and conditional remote release

- [x] Apply owned files to current canonicalbackend only after matchingoriginalhashes; preserve unrelateddirtyfiles. Run applicable canonicalfulltests and frontendfullchecks. Focusedcommitsonly, noCoAuthortrailers.
- [x] Summarize localoutcome: observedrates, semanticfindings, correctlegitimatecornercases, explanationquality, limitations. If importantfailuresremain, preserveevidenceandrepaircandidate; do notcallreadyor publishfailedcandidate.
- [x] For acceptedcandidate, inspectcurrentHerokuproductionagain, buildonlyscopedpayloadand exactfrontendcommits, preserveotherwork. User explicitly requestedremoteafterlocaltesting; publishonlytheacceptedscopedcandidate, readbacksourcehashes/release/deployedbytesand additivelyinstallnewversionsfortargetcourse. Do notarchivecurrentremote sixwithoutnewmatchingauthorization.
- [x] Updatecontext/memoryandreadLinear; noissueclosurefromlegacyscope. Stoponlyownedserviceswhenunneeded; reportconcreteverificationboundariesandremote deploycompletion.

## Execution ruling

The owner approved the written design and explicitly said to proceed, locally test the six real conversations, then advance remote. That supplies implementation/test authorization and preserves native execution; do not stop for another execution-method confirmation. Owner standing authorization now covers required Terms/Privacy for equivalent authorized synthetic tests; proceed without asking again, optional research consent off. Plan is stored in normal tracked docs because this project intentionally ignores docs/superpowers; no force-add of ignored files.


## Final local gate · 2026-10-15

V13 unchanged full six:170messages/79committedturns/85events,0failedrequests,4internalrepairs. All91AIpanels/6realJSONexports,1440/390/320px,0pageerrors; all85exportedbeforeafter/metrics equalDB. Independent170message/85event/170snapshot/79receipt review: noCritical/Importantin twoUliainstruments; generic nonfrequencyLikertwording Minor explicitlydeferred. Final430candidatebackend/1994fullfrozencanonical/109frontendPASS. Twelvefinalexact-inputproviderreplays allPASS plus4positivecontrols; singletrials, notpopulationerrorrates. See release report for failedtrials/limits and eventualremote receipts.

Remote release: guiidatav87 succeeded/all116sourcehashes match; Pagespublic7c9723e built/all5bytesmatch. Targetcourse additivev3surveys314/315,fullprotocolsexactfixtures; alloldrowhashespreserved,18sessions/624messages/184events/251receiptsunchanged,Week0=86;debugonlytarget. BothhostedChromeentriespass390px/anonymousnodebug/zeroerrors/noPOST. No remotesixrerun orarchive. Final closeout/memory/localdocscommit follows; canonicalHAR198 remainsOPEN.
