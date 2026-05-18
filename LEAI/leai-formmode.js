// LEAI Form-Mapping Mode — engine module.
//
// Pure state-transition module. Browser and the Python sim consume the same
// schema JSON and follow the same rules so both flows are testable end-to-end.
//
// Spec: LEAI/docs/instructor-clarifications/wk6-form-mode-SPEC.md §4
//
// Activation in browser: feedback.html reads ?form=<schema_id> from the URL.
// If present, this module wraps the chat flow. If absent, behavior is unchanged.

(function (global) {
    'use strict';

    // Cap on student turns within a single area before the engine
    // force-advances. Tuned for Area 6 (Roles & Contributions) which
    // walks teammate-by-teammate (~12 turns in the engaged sim).
    var MAX_TURNS_PER_AREA = 14;

    // Hard total-turn cap is scaled per-schema (see totalTurnBudget()).
    // Floor for any schema, regardless of size:
    var MIN_TOTAL_TURN_BUDGET = 24;
    // Per-section turn budget used when computing the cap.
    var TURNS_PER_SECTION_BUDGET = 5;

    function totalTurnBudget(state) {
        var n = (state && state.schema && state.schema.sections) ? state.schema.sections.length : 6;
        var v = n * TURNS_PER_SECTION_BUDGET;
        return v > MIN_TOTAL_TURN_BUDGET ? v : MIN_TOTAL_TURN_BUDGET;
    }

    // ─── public surface ────────────────────────────────────────────────────

    var leaiFormMode = {
        // Resolve a schema id to its JSON definition by fetching from the
        // backend FormSchema registry. Pages should fetch once and cache.
        loadSchema: function (schemaId) {
            // Schemas are owned by the FormSchema registry on the Django
            // backend; the legacy ship-time JSON fallback was retired in
            // favor of a single source of truth (see migration 0024 / 0025).
            var apiBase = (typeof API !== 'undefined') ? API : null;
            if (!apiBase) {
                return Promise.reject(new Error('cannot load form schema: API base URL is not configured'));
            }
            return fetch(apiBase + '/form_schemas/' + encodeURIComponent(schemaId) + '/').then(function (r) {
                if (!r.ok) throw new Error('form_schemas registry ' + r.status + ' for ' + schemaId);
                return r.json();
            }).then(function (rec) {
                if (!rec || !rec.body) throw new Error('form_schemas registry returned no body for ' + schemaId);
                return rec.body;
            });
        },

        // Build a fresh engine state for a new conversation.
        init: function (schema, ctx) {
            var coverage = {};
            schema.sections.forEach(function (s) {
                coverage[s.id] = {
                    opened: false,
                    response_received: false,
                    probe_used: false,
                    sub_signals: {},  // free-form bag for E9 thresholds
                };
            });
            return {
                schema: schema,
                current_area_index: 1,
                coverage: coverage,
                ended: false,
                team_id: (ctx && ctx.team_id) || null,
                team_member_slot: (ctx && ctx.team_member_slot) || null,
                last_directive: null,  // what we asked the LLM to do last turn
                awaiting_anything_else: false,  // true after we asked the wrap-up Q
                closing_feedback_asked: false, // bot has emitted the closing question
                turn: 0,
                // Safety net counter — see MAX_TURNS_PER_AREA.
                turns_in_current_area: 0,
                // Canonical roster, frozen once captured in Area 2.2. Bot
                // turns afterward must reference these exact names — prevents
                // Lewis→Louise drift seen in production transcripts.
                roster: null,
            };
        },

        // Return a thin form-mode prompt tail that adapts the survey's existing
        // instructions. The full structural enforcement happens via per-turn
        // directives, not the system prompt — keep this minimal.
        systemPromptTail: function (schema) {
            var n = schema.sections.length;
            var titles = schema.sections.map(function (s, i) {
                return '  Area ' + (i + 1) + ' of ' + n + ' — ' + s.title;
            }).join('\n');
            return [
                '',
                '',
                '==== FORM-MAPPING MODE (engine-controlled) ====',
                'You are now operating under an external state machine that tracks which of the ' + n + ' reflection areas the student is on. Each turn you will receive a [DIRECTIVE] block telling you exactly what to do this turn. Follow the directive exactly.',
                'Areas (canonical titles — do NOT rename, paraphrase, invent):',
                titles,
                'Constraints:',
                '- Stay on the directive\'s area. Do not skip ahead.',
                '- Ask AT MOST one question per turn.',
                '- Keep messages under 350 characters unless the directive says otherwise.',
                '- Do NOT write the reflection for the student. Redirect off-topic asks back to their reflection.',
                '- Do NOT emit any control token, sentinel, or end marker. The engine decides when the conversation is complete; you just keep responding.',
                '- NEVER emit a section header like "Area X of N — Title" anywhere in your reply. The engine prepends section headers automatically when (and only when) advancing. Emitting your own header — including out-of-order ones — corrupts the structured reflection download.',
                '- Section progression is strictly monotonic: 1 → 2 → 3 → ... → N. Do NOT regress to an earlier area, even if the student asks to "go back" or seems to revisit one. Acknowledge the revision in place, but stay on the current area.',
                '- ROSTER NAMES ARE FROZEN. Once the student names their teammates (Area 2.2), refer to those exact names verbatim everywhere afterward — same spelling, same form. Do NOT substitute a similar-sounding name (e.g. "Lewis" → "Louise"), invent pronouns the student didn\'t state, or merge / split names. If a directive includes a [ROSTER] line, those names are the only acceptable references.',
                '',
                '==== METHOD-EXPLANATION REFUSAL (NON-NEGOTIABLE) ====',
                'You MUST NOT define, summarize, explain, paraphrase, or describe how to do any method, framework, concept, or reading. This includes (non-exhaustive): affinity diagramming, thematic analysis, triangulation, observation vs. insight, contextual inquiry, journey mapping, NN/g articles, Braun & Clarke, design thinking, qualitative coding, axial coding, etc. If the student asks ANY variant of "explain X", "what does X mean", "summarize the article", "give me a quick version", "refresh me on X", "how do you do X", "what\'s the right way to do X", "I missed that lecture", "can you remind me", or similar — REFUSE.',
                'Refusal template (paraphrase tightly, do not over-explain the refusal): "I can\'t define that here — what part felt unclear when YOU tried it this week?" Then return to the current area\'s question.',
                'Examples of WRONG behavior (these have happened in past runs and are unacceptable):',
                '  ❌ "Quick version: affinity diagramming is when you put each observation on a sticky note and group them..."',
                '  ❌ "Quick distinction: an observation is what you literally saw/heard..."',
                '  ❌ "Thematic analysis = reading through your data, tagging recurring patterns..."',
                'Examples of CORRECT behavior:',
                '  ✅ "I can\'t define affinity diagramming for you — what part of doing it this week felt unclear?"',
                '  ✅ "I\'ll skip the summary — what was the one thing from the article that did or didn\'t land for you?"',
                'Even if the student insists, says they missed the lecture, says they\'re behind, or threatens to give up — DO NOT explain. Redirect every time.',
            ].join('\n');
        },

        // Called before the LLM is invoked. Returns:
        //   { shortCircuit: bool, syntheticResponse: str, directive: str, ended: bool }
        // - If shortCircuit is true, skip the LLM call entirely and emit
        //   syntheticResponse to the student.
        // - Otherwise, prepend `directive` (a [DIRECTIVE] block) to the messages
        //   sent to the LLM so it knows what to do this turn.
        beforeTurn: function (state, studentMessage) {
            // Post-end passthrough: every section is captured and the engine
            // already emitted [END] on a previous turn, but the student kept
            // chatting (we no longer hard-lock the input — they may want to
            // revise or add). Hand the LLM a "post-end" directive that lets
            // it respond conversationally without re-opening sections,
            // re-emitting headers, or firing [END] again. The structured
            // download reads the live transcript, so anything they add here
            // still flows into the artifact.
            if (state.ended) {
                state._post_end_passthrough = true;
                state.last_directive = { kind: 'post_end' };
                return mkBefore({ directive: dirPostEnd(state) });
            }

            state.turn += 1;
            var schema = state.schema;
            var sections = schema.sections;
            var n = sections.length;
            var i = state.current_area_index;
            var area = sections[i - 1];

            // Treat null/empty student message as the opening turn.
            var msg = (studentMessage || '').trim();

            // No student-driven termination: students who want to leave just
            // close the tab. Ending is decided by coverage state, not by a
            // typed keyword. (Previously: STOP intercept + "I'm done" early-
            // exit signal both forced an end and were a footgun — e.g. the
            // student says "that's all" meaning "nothing more on this area"
            // and the engine treated it as "end the entire survey".)

            // ── interpret last turn's effects on coverage ────────────────
            applyStudentResponseToCoverage(state, msg);

            // Count student turns within the current area for safety-net cap.
            if (msg) state.turns_in_current_area = (state.turns_in_current_area || 0) + 1;

            // ── advance if appropriate ──────────────────────────────────
            var advanced = false;
            if (msg && isNoAdditionResponse(msg)) {
                // Advance whenever the student emits a no-addition signal
                // AND the current area is genuinely satisfied. The earlier
                // version required `awaiting_anything_else` to be true, which
                // missed cases like: probe (kind=probe → awaiting unset) →
                // "Move on." in the next turn. That used to silently push
                // the substantive 3.1/3.2 answers into the wrong section
                // because the area didn't transition until two turns later.
                var thisCov = state.coverage[area.id];
                var canAdvance = state.awaiting_anything_else
                    || (thisCov.opened && thisCov.response_received && areaResponseSatisfied(state, area));
                if (canAdvance) {
                    thisCov.response_received = true;
                    state.awaiting_anything_else = false;
                    state.current_area_index = Math.min(i + 1, n);
                    i = state.current_area_index;
                    area = sections[i - 1];
                    state.turns_in_current_area = 0;
                    advanced = true;
                } else if (state.awaiting_anything_else) {
                    // No-add but threshold not yet met (e.g. 2.4 with < 5
                    // ratings, or area without any substantive answer yet).
                    // Drop the wait flag so the directive selector falls
                    // through to the "continue gathering" branch.
                    state.awaiting_anything_else = false;
                }
            } else if (state.awaiting_anything_else && msg) {
                // Substantive response while waiting — student added more.
                state.awaiting_anything_else = false;
            }

            // Safety net: cap time spent in any one area so a disengaged or
            // confused student can't hold the interview hostage.
            if (!advanced
                    && (state.turns_in_current_area || 0) >= MAX_TURNS_PER_AREA
                    && state.coverage[area.id].response_received
                    && i < n) {
                state.awaiting_anything_else = false;
                state.current_area_index = Math.min(i + 1, n);
                i = state.current_area_index;
                area = sections[i - 1];
                state.turns_in_current_area = 0;
                advanced = true;
            }

            // Magy spec M2: "One-line answers OK; bot probes deeper once;
            // moves on if student doesn't take it." Once we've already
            // probed AND the student's reply to the wrap-up "anything else?"
            // is itself a short non-advance answer (e.g. "it'll help",
            // "communicate more"), treat that as "doesn't take it" and
            // advance. Without this, the shallow persona stalls at area 1
            // because its replies never include an explicit "no".
            if (!advanced
                    && state.coverage[area.id].probe_used
                    && state.coverage[area.id].response_received
                    && areaResponseSatisfied(state, area)
                    && msg
                    && msg.split(/\s+/).filter(Boolean).length <= 6
                    && i < n) {
                state.awaiting_anything_else = false;
                state.current_area_index = Math.min(i + 1, n);
                i = state.current_area_index;
                area = sections[i - 1];
                state.turns_in_current_area = 0;
                advanced = true;
            }

            // Hard total-turn safety net: if the student has spent too many
            // turns and we still haven't reached coverage, force-cover-all so
            // the next branch fires dirClose. Budget scales with schema size
            // (5 turns per section, floor 24) — so a 10-section schema gets
            // 50 turns, while a 6-section schema gets the original 24.
            if (state.turn >= totalTurnBudget(state)
                    && !allCovered(state)
                    && !state.closing_feedback_asked) {
                forceCoverAll(state);
                i = state.current_area_index;
                area = sections[i - 1];
            }

            // ── determine this turn's directive ─────────────────────────
            var directive;
            if (state.turn === 1) {
                // opening turn
                state.coverage[area.id].opened = true;
                directive = dirOpening(state, area);
            } else if (state.closing_feedback_asked) {
                // The closing-feedback question already ran last bot turn and
                // the student just replied to it. Engine takes over: emit a
                // one-sentence ack and mark the chat complete (download bar
                // surfaces in the footer; input stays open for revisions).
                // NO new question, NO section header, NO sentinel.
                directive = dirFinalAck(state);
            } else if (allCovered(state)) {
                directive = dirClose(state);
            } else if (!state.coverage[area.id].opened) {
                state.coverage[area.id].opened = true;
                directive = dirOpenArea(state, area, i, n);
            } else if (shouldProbe(state, area, msg)) {
                state.coverage[area.id].probe_used = true;
                directive = dirProbe(state, area);
            } else if (areaResponseSatisfied(state, area)) {
                state.awaiting_anything_else = true;
                directive = dirAnythingElse(state, area);
            } else {
                directive = dirContinueArea(state, area, i, n);
            }

            state.last_directive = directive;
            return mkBefore({ directive: directive });
        },

        // Called after the LLM responds. Returns:
        //   { displayedMessage: str, ended: bool, lockChat: bool }
        afterTurn: function (state, llmResponse) {
            var raw = (llmResponse || '').trim();
            var hadEnd = /\[END\]/i.test(raw);
            var stripped = raw.replace(/\[END\]/gi, '').trim();

            // Post-end passthrough: the chat is in "completed but still open"
            // mode. Skip header injection, area advance, and [END] handling.
            // The download bar already exists; the student's reply is just
            // letting them revise/add. Do NOT lock the chat again.
            if (state._post_end_passthrough) {
                state._post_end_passthrough = false;
                return {
                    displayedMessage: stripped,
                    ended: false,
                    lockChat: false,
                };
            }

            var schema = state.schema;
            var n = schema.sections.length;
            var i = state.current_area_index;
            var area = schema.sections[i - 1];

            var ended = false;
            var displayed = stripped;

            // Engine-injected "Area N of N — Title." prefix on transitions.
            // Apply when:
            //   - opening turn (turn 1), or
            //   - we just advanced (last directive was opening a fresh area)
            var directiveKind = state.last_directive ? state.last_directive.kind : null;

            // The LLM is the prime mover for section progression — it walks
            // through the 6 sections naturally. The engine's auto-advance
            // logic only fires on explicit "move on" / no-addition signals
            // from the student, which cooperative students rarely emit.
            //
            // First sync: if the bot just asked the closing feedback question
            // (the schema's closing.feedback_prompt or a close paraphrase),
            // mark ALL sections as covered AND flag that we've asked the
            // closing-feedback question. The next student message is the
            // student's reply to that, after which the engine must emit
            // [END] without asking another question.
            var closingPrompt = (state.schema.closing && state.schema.closing.feedback_prompt) || '';
            if (closingPrompt && looksLikeClosingFeedback(displayed, closingPrompt)) {
                forceCoverAll(state);
                state.closing_feedback_asked = true;
                i = state.current_area_index;
                area = state.schema.sections[i - 1];
            }

            // Second sync: when the LLM legitimately advances by emitting a
            // valid forward section header, sync the engine state to match.
            // Hard rule: advance by AT MOST one step at a time, and only if
            // the previous area genuinely satisfied the engine. Without this,
            // an LLM that hallucinates "Area 6 of 6" while still mid-Area-4
            // skips over sections that never received a student answer, and
            // the artifact comes out empty for those sections. We also do NOT
            // whitewash the previous area's response_received flag — if the
            // student never answered it, leave it false so the review-pending
            // pass (beforeTurn) can re-ask before close.
            var advancedToIdx = detectForwardAdvance(state, displayed);
            if (advancedToIdx > i) {
                var allowAdvance = (advancedToIdx === i + 1)
                    && areaResponseSatisfied(state, area);
                if (allowAdvance) {
                    state.coverage[area.id].response_received = true;
                    state.current_area_index = advancedToIdx;
                    state.coverage[state.schema.sections[advancedToIdx - 1].id].opened = true;
                    state.turns_in_current_area = 0;
                    state.awaiting_anything_else = false;
                    i = advancedToIdx;
                    area = state.schema.sections[i - 1];
                } else {
                    // LLM tried to skip ahead — strip the bogus header so the
                    // student doesn't see a section title that hasn't been
                    // earned. The prefix logic below will re-emit the correct
                    // current-area header.
                    displayed = displayed.replace(
                        /Area\s+\d+\s+of\s+\d+\s+[—\-]\s+[^.\n]+?\s*\.\s*/gi, '').trim();
                }
            }

            // Defensively strip any LLM-emitted section headers that don't
            // match the engine's current area index. After detectForwardAdvance
            // syncs the engine forward, anything else is a hallucinated regression
            // and gets removed.
            displayed = stripWrongSectionHeaders(displayed, i, n, area.title);

            // Salvage missing forward question. Production transcripts
            // showed the bot ack-only on non-final_ack turns ("Thanks, I've
            // captured all five ratings.") and stalling — the student then
            // had to type "what next?" to unstick it. If the directive
            // requires a question and the bot's reply has none, append a
            // deterministic follow-up pulled from the schema so the chat
            // keeps moving on its own.
            displayed = ensureForwardQuestion(state, displayed, directiveKind, area, n, i);

            // Emit a section marker whenever the engine's current area
            // changed since the last emitted one — even if it changed
            // silently via forceCoverAll, MAX_TURNS_PER_AREA cap, or
            // awaiting-anything-else advance. This guarantees the
            // structured-extraction logic always finds a marker for each
            // visited section.
            var prevEmitted = state._last_emitted_area || 0;
            var shouldEmitHeader = (
                directiveKind === 'opening' ||
                directiveKind === 'open_area' ||
                i !== prevEmitted
            );
            if (shouldEmitHeader) {
                var prefix = 'Area ' + i + ' of ' + n + ' — ' + area.title + '.';
                // Don't double-emit if the displayed text already starts
                // with the same area's correct header.
                var alreadyAtStart = startsWithPrefix(displayed, prefix);
                var anyHeaderAtStart = /^Area\s+\d+\s+of\s+\d+\s+[—\-]\s+/i.test(displayed);
                if (!alreadyAtStart && !anyHeaderAtStart) {
                    displayed = prefix + ' ' + displayed;
                } else if (anyHeaderAtStart && !alreadyAtStart) {
                    // model emitted a (possibly wrong) header — replace it
                    // with the engine-canonical one.
                    displayed = displayed.replace(/^Area\s+\d+\s+of\s+\d+\s+[—\-]\s+[^.\n]+\.\s*/i, prefix + ' ');
                }
                state._last_emitted_area = i;
            }

            // Handle a stray LLM-emitted [END]:
            // The literal "[END]" is already stripped from `displayed` above
            // (`raw.replace(/\[END\]/gi, '').trim()`). Here we decide whether
            // to honor it as an end signal. Rule: a stray [END] is NEVER
            // sufficient on its own to end the chat — only the canonical
            // final_ack branch below does that. Without this, an LLM that
            // tags the closing-question turn with [END] (a frequent
            // hallucination) would lock the chat before the student could
            // answer the closing question. If the LLM emitted [END] before
            // everything is covered, leave a small inline hint so it knows
            // to keep going.
            if (hadEnd && !allCovered(state)) {
                var remaining = countRemaining(state);
                displayed += '\n\n(continuing — ' + remaining + ' of ' + n + ' areas left.)';
            }
            if (directiveKind === 'final_ack' && allCovered(state)) {
                // Post-feedback ack ran and all areas covered — engine owns
                // closing. We do NOT append any literal sentinel ("[END]")
                // to the displayed text — completion is signaled internally
                // via `ended: true`, which the chat layer uses to surface
                // the download bar. Showing "[END]" to the student leaks an
                // engine implementation detail and looks like a bug.
                //
                // dirClose intentionally does NOT end here — it asks the
                // closing-feedback question and needs the student's reply
                // before final_ack runs.
                state.ended = true;
                ended = true;
            }

            // If we just emitted the synthetic closing in beforeTurn (STOP-honored),
            // mark ended.
            if (state.ended) ended = true;

            return {
                displayedMessage: displayed,
                ended: ended,
                lockChat: ended,
            };
        },

        isComplete: function (state) { return allCovered(state); },
        isEnded: function (state) { return !!state.ended; },
        progressLabel: function (state) {
            var n = state.schema.sections.length;
            var i = state.current_area_index;
            var area = state.schema.sections[i - 1];
            return 'Area ' + i + ' of ' + n + ' — ' + area.title;
        },
        currentArea: function (state) {
            return state.schema.sections[state.current_area_index - 1];
        },

        // Render the structured form-mapped output for download (F4).
        // Returns plain Markdown; PDF rendering is the caller's job.
        // opts.slots, when present, populates structured fields from the
        // extractor's output instead of the legacy raw-transcript dump.
        renderStructuredMarkdown: function (state, transcript, opts) {
            opts = opts || {};
            var slots = opts.slots || (state && state.slots) || null;
            var schema = state.schema;
            var lines = [];
            lines.push('# ' + schema.title);
            lines.push('');
            lines.push('- **Course:** ' + schema.course);
            lines.push('- **Instructor:** ' + schema.instructor);
            lines.push('- **Week:** ' + schema.week);
            if (state.team_id) lines.push('- **Team:** ' + state.team_id);
            if (state.team_member_slot) lines.push('- **Member slot:** ' + state.team_member_slot);
            if (state.roster && state.roster.length) {
                lines.push('- **Team roster:** ' + state.roster
                    .filter(function (n) { return n !== 'self'; })
                    .join(', ') + (state.roster.indexOf('self') !== -1 ? ', + self' : ''));
            }
            lines.push('- **Date submitted:** ' + new Date().toISOString().slice(0, 10));
            lines.push('');
            lines.push('---');
            lines.push('');
            schema.sections.forEach(function (s) {
                lines.push('## ' + s.id + '. ' + s.title);
                lines.push('');
                var slot = slots ? slots[s.id] : null;
                var rendered = renderSectionMarkdown(s, slot, extractSectionAnswer(s, transcript));
                lines.push(rendered);
                lines.push('');
            });
            lines.push('---');
            lines.push('');
            lines.push('## Raw Conversation Transcript');
            lines.push('');
            transcript.forEach(function (t) {
                var role = t.role === 'user' ? 'Student' : 'Remi';
                lines.push('**' + role + ':** ' + t.text);
                lines.push('');
            });
            return lines.join('\n');
        },

        // Render the same artifact as a self-contained HTML document
        // (the file the student uploads to Canvas). Browser print-to-PDF
        // produces a clean PDF on demand.
        // opts.slots — typed slot store from extractSlots(). When present,
        // 2.2 / 2.4 tables are populated from slots instead of left blank,
        // and section narratives use the cleaned summary instead of raw
        // student turns.
        renderStructuredHtml: function (state, transcript, opts) {
            opts = opts || {};
            var slots = opts.slots || (state && state.slots) || null;
            var schema = state.schema;
            var esc = function (s) {
                return String(s == null ? '' : s)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            };
            var date = new Date().toISOString().slice(0, 10);
            var html = '';
            html += '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">';
            html += '<title>' + esc(schema.title) + '</title>';
            html += '<style>'
                  + 'body{font-family:Inter,system-ui,sans-serif;max-width:780px;margin:0 auto;padding:40px 28px;color:#1f2a2e;background:#fff;line-height:1.55;}'
                  + 'h1{font-size:1.6rem;margin:0 0 4px;letter-spacing:-0.01em;}'
                  + 'h2{font-size:1.05rem;margin:28px 0 8px;color:#0a2333;border-bottom:1px solid #e2e8eb;padding-bottom:4px;}'
                  + '.meta{font-size:0.85rem;color:#5a6669;margin:0 0 18px;}'
                  + '.meta div{margin:2px 0;}'
                  + 'table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:0.92rem;}'
                  + 'th,td{border:1px solid #d8e0e3;padding:8px 10px;text-align:left;vertical-align:top;}'
                  + 'th{background:#f3f7f8;font-weight:700;}'
                  + 'p{margin:6px 0;}'
                  + '.section-body{font-size:0.95rem;}'
                  + '.transcript{margin-top:32px;padding-top:18px;border-top:2px solid #c8d2d6;}'
                  + '.turn{margin:0 0 12px;font-size:0.9rem;}'
                  + '.turn .who{font-weight:700;color:#0a2333;}'
                  + '.turn.bot .who{color:#006493;}'
                  + '.turn.user{padding:6px 12px;background:#f0f4f6;border-radius:8px;}'
                  + '@media print{body{padding:24px;}.section-body{page-break-inside:avoid;}}'
                  + '</style></head><body>';
            html += '<h1>' + esc(schema.title) + '</h1>';
            html += '<div class="meta">';
            html += '<div><strong>Course:</strong> ' + esc(schema.course) + '</div>';
            html += '<div><strong>Instructor:</strong> ' + esc(schema.instructor) + '</div>';
            html += '<div><strong>Week:</strong> ' + esc(schema.week) + '</div>';
            if (opts.studentName) html += '<div><strong>Name:</strong> ' + esc(opts.studentName) + '</div>';
            if (state.team_id) html += '<div><strong>Team:</strong> ' + esc(state.team_id) + '</div>';
            if (state.team_member_slot) html += '<div><strong>Member slot:</strong> ' + esc(state.team_member_slot) + '</div>';
            if (state.roster && state.roster.length) {
                var rosterPretty = state.roster
                    .filter(function (n) { return n !== 'self'; })
                    .join(', ') + (state.roster.indexOf('self') !== -1 ? ', + self' : '');
                html += '<div><strong>Team roster:</strong> ' + esc(rosterPretty) + '</div>';
            }
            html += '<div><strong>Date submitted:</strong> ' + date + '</div>';
            html += '</div>';

            schema.sections.forEach(function (s) {
                html += '<h2>' + esc(s.id) + '. ' + esc(s.title) + '</h2>';
                var slot = slots ? slots[s.id] : null;
                html += renderSectionHtml(s, slot, extractSectionAnswer(s, transcript), esc);
            });

            html += '<div class="transcript">';
            html += '<h2>Raw Conversation Transcript</h2>';
            transcript.forEach(function (t) {
                var who = t.role === 'user' ? 'Student' : 'Remi';
                var cls = t.role === 'user' ? 'user' : 'bot';
                html += '<div class="turn ' + cls + '">';
                html += '<span class="who">' + esc(who) + ':</span> ' + esc(t.text);
                html += '</div>';
            });
            html += '</div>';
            html += '</body></html>';
            return html;
        },
    };

    function paragraphsToHtml(text, esc) {
        var parts = String(text).split(/\n\s*\n/);
        return parts.map(function (p) {
            return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
        }).join('');
    }

    function renderSectionHtml(section, slot, fallbackAnswer, esc) {
        var html = '';
        if (section.id === '2.2') {
            html += '<table><thead><tr><th>Team Member</th><th>Primary Role / Contribution This Week</th></tr></thead><tbody>';
            var rows = (slot && slot.roster) ? slot.roster : [];
            if (rows.length) {
                rows.forEach(function (r) {
                    html += '<tr><td>' + esc(r.name || '') + '</td><td>' + esc(r.contribution || '') + '</td></tr>';
                });
            } else {
                html += '<tr><td colspan="2"><em>(no roster captured)</em></td></tr>';
            }
            html += '</tbody></table>';
            if (slot && slot.equity) {
                html += '<p><strong>Equity of distribution:</strong> ' + esc(slot.equity) + '</p>';
            } else if (!slot && fallbackAnswer) {
                html += '<div class="section-body">' + paragraphsToHtml(fallbackAnswer, esc) + '</div>';
            }
            return html;
        }
        if (section.id === '2.4') {
            html += '<table><thead><tr><th>Dimension</th><th>Rating (1–5)</th><th>Brief Justification</th></tr></thead><tbody>';
            var ratings = (slot && slot.ratings) || {};
            section.fields.forEach(function (f) {
                if (!f.dimension) return;
                var key = f.id.split('.').pop();
                var r = ratings[key] || {};
                var rating = (r.rating != null && r.rating !== '') ? String(r.rating) : '';
                var just = r.justification || '';
                html += '<tr><td>' + esc(f.dimension) + '</td><td>' + esc(rating) + '</td><td>' + esc(just) + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        }
        if (section.id === '1.3' && slot) {
            html += '<table><thead><tr><th>Prompt</th><th>Student response</th></tr></thead><tbody>';
            var subs = [
                { key: 'thought_i_knew',  label: 'What I thought I knew' },
                { key: 'surprised_by',    label: 'What I was surprised by' },
                { key: 'still_uncertain', label: 'What I am still uncertain about' }
            ];
            subs.forEach(function (sub) {
                html += '<tr><td>' + esc(sub.label) + '</td><td>' + esc(slot[sub.key] || '') + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        }
        if (section.id === '2.3' && slot) {
            html += '<table><thead><tr><th>Prompt</th><th>Student response</th></tr></thead><tbody>';
            var subs23 = [
                { key: 'worked',      label: 'What worked well (concrete)' },
                { key: 'challenge',   label: 'What was challenging (specific)' },
                { key: 'improvement', label: 'One actionable improvement for next week (measurable)' }
            ];
            subs23.forEach(function (sub) {
                html += '<tr><td>' + esc(sub.label) + '</td><td>' + esc(slot[sub.key] || '') + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        }
        var body = (slot && slot.summary) ? slot.summary : fallbackAnswer;
        if (!body) return '<p><em>(no response captured)</em></p>';
        return '<div class="section-body">' + paragraphsToHtml(body, esc) + '</div>';
    }

    function renderSectionMarkdown(section, slot, fallbackAnswer) {
        if (section.id === '2.2') {
            var lines = ['| Team Member | Primary Role / Contribution This Week |', '|---|---|'];
            var rows = (slot && slot.roster) ? slot.roster : [];
            if (rows.length) {
                rows.forEach(function (r) { lines.push('| ' + (r.name || '') + ' | ' + (r.contribution || '') + ' |'); });
            } else {
                lines.push('| _(no roster captured)_ |  |');
            }
            if (slot && slot.equity) { lines.push(''); lines.push('**Equity of distribution:** ' + slot.equity); }
            else if (!slot && fallbackAnswer) { lines.push(''); lines.push(fallbackAnswer); }
            return lines.join('\n');
        }
        if (section.id === '2.4') {
            var rl = ['| Dimension | Rating (1–5) | Brief Justification |', '|---|---|---|'];
            var ratings = (slot && slot.ratings) || {};
            section.fields.forEach(function (f) {
                if (!f.dimension) return;
                var key = f.id.split('.').pop();
                var r = ratings[key] || {};
                rl.push('| ' + f.dimension + ' | ' + (r.rating != null && r.rating !== '' ? r.rating : '') + ' | ' + (r.justification || '') + ' |');
            });
            return rl.join('\n');
        }
        if (section.id === '1.3' && slot) {
            return [
                '**What I thought I knew:** ' + (slot.thought_i_knew || ''),
                '',
                '**What I was surprised by:** ' + (slot.surprised_by || ''),
                '',
                '**What I am still uncertain about:** ' + (slot.still_uncertain || '')
            ].join('\n');
        }
        if (section.id === '2.3' && slot) {
            return [
                '**What worked:** ' + (slot.worked || ''),
                '',
                '**What was challenging:** ' + (slot.challenge || ''),
                '',
                '**Improvement next week:** ' + (slot.improvement || '')
            ].join('\n');
        }
        var body = (slot && slot.summary) ? slot.summary : fallbackAnswer;
        return body || '_(no response captured)_';
    }

    // ─── DOCX rendering (real OOXML, editable in Word / Google Docs) ─────
    //
    // Requires the `docx` UMD library to be loaded on `globalThis.docx`
    // (added via <script src="https://unpkg.com/docx@8.5.0/build/index.umd.js">
    // in feedback.html). Returns a Promise<Blob> ready for download.
    leaiFormMode.renderStructuredDocx = function (state, transcript, opts) {
        opts = opts || {};
        var d = (typeof globalThis !== 'undefined' ? globalThis.docx : null) ||
                (typeof window !== 'undefined' ? window.docx : null);
        if (!d) return Promise.reject(new Error('docx library not loaded'));

        var slots = opts.slots || (state && state.slots) || null;
        var schema = state.schema;
        var sections = schema.sections;

        function P(text, opts2) {
            opts2 = opts2 || {};
            return new d.Paragraph({
                children: [new d.TextRun({ text: String(text == null ? '' : text), bold: !!opts2.bold, italics: !!opts2.italics })],
                heading: opts2.heading || undefined,
                spacing: { after: 120 },
            });
        }

        function metaP(label, value) {
            return new d.Paragraph({
                children: [
                    new d.TextRun({ text: label + ' ', bold: true }),
                    new d.TextRun({ text: String(value == null ? '' : value) }),
                ],
                spacing: { after: 60 },
            });
        }

        function cell(text, opts2) {
            opts2 = opts2 || {};
            return new d.TableCell({
                children: [new d.Paragraph({
                    children: [new d.TextRun({ text: String(text == null ? '' : text), bold: !!opts2.bold })],
                })],
                shading: opts2.bold ? { fill: 'F3F7F8' } : undefined,
                margins: { top: 80, bottom: 80, left: 100, right: 100 },
            });
        }

        function table(headers, rows) {
            var headerRow = new d.TableRow({
                children: headers.map(function (h) { return cell(h, { bold: true }); }),
                tableHeader: true,
            });
            var bodyRows = rows.map(function (r) {
                return new d.TableRow({ children: r.map(function (c) { return cell(c); }) });
            });
            return new d.Table({
                rows: [headerRow].concat(bodyRows),
                width: { size: 100, type: d.WidthType ? d.WidthType.PERCENTAGE : 'pct' },
            });
        }

        var children = [];
        children.push(new d.Paragraph({
            children: [new d.TextRun({ text: schema.title, bold: true, size: 32 })],
            spacing: { after: 200 },
        }));
        children.push(metaP('Course:', schema.course));
        children.push(metaP('Instructor:', schema.instructor));
        children.push(metaP('Week:', schema.week));
        if (opts.studentName) children.push(metaP('Name:', opts.studentName));
        if (state.team_id) children.push(metaP('Team:', state.team_id));
        if (state.team_member_slot) children.push(metaP('Member slot:', state.team_member_slot));
        if (state.roster && state.roster.length) {
            var rosterPretty = state.roster
                .filter(function (n) { return n !== 'self'; })
                .join(', ') + (state.roster.indexOf('self') !== -1 ? ', + self' : '');
            children.push(metaP('Team roster:', rosterPretty));
        }
        children.push(metaP('Date submitted:', new Date().toISOString().slice(0, 10)));
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: '' })], spacing: { after: 120 } }));

        sections.forEach(function (s) {
            children.push(new d.Paragraph({
                children: [new d.TextRun({ text: s.id + '. ' + s.title, bold: true, size: 24 })],
                spacing: { before: 200, after: 100 },
            }));
            var slot = slots ? slots[s.id] : null;
            var fallback = extractSectionAnswer(s, transcript);

            if (s.id === '2.2') {
                var rows = (slot && slot.roster) ? slot.roster : [];
                if (rows.length) {
                    children.push(table(['Team Member', 'Primary Role / Contribution This Week'],
                        rows.map(function (r) { return [r.name || '', r.contribution || '']; })));
                } else {
                    children.push(P('(no roster captured)', { italics: true }));
                }
                if (slot && slot.equity) {
                    children.push(new d.Paragraph({
                        children: [
                            new d.TextRun({ text: 'Equity of distribution: ', bold: true }),
                            new d.TextRun({ text: slot.equity }),
                        ],
                        spacing: { before: 100, after: 100 },
                    }));
                }
                return;
            }
            if (s.id === '2.4') {
                var ratings = (slot && slot.ratings) || {};
                var rRows = (s.fields || []).filter(function (f) { return f.dimension; }).map(function (f) {
                    var key = f.id.split('.').pop();
                    var r = ratings[key] || {};
                    return [f.dimension, r.rating != null ? String(r.rating) : '', r.justification || ''];
                });
                children.push(table(['Dimension', 'Rating (1–5)', 'Brief Justification'], rRows));
                return;
            }
            if (s.id === '1.3' && slot) {
                children.push(table(['Prompt', 'Student response'], [
                    ['What I thought I knew', slot.thought_i_knew || ''],
                    ['What I was surprised by', slot.surprised_by || ''],
                    ['What I am still uncertain about', slot.still_uncertain || ''],
                ]));
                return;
            }
            if (s.id === '2.3' && slot) {
                children.push(table(['Prompt', 'Student response'], [
                    ['What worked well (concrete)', slot.worked || ''],
                    ['What was challenging (specific)', slot.challenge || ''],
                    ['One actionable improvement for next week (measurable)', slot.improvement || ''],
                ]));
                return;
            }
            var body = (slot && slot.summary) ? slot.summary : fallback;
            if (body) {
                String(body).split(/\n\s*\n/).forEach(function (para) { children.push(P(para)); });
            } else {
                children.push(P('(no response captured)', { italics: true }));
            }
        });

        children.push(new d.Paragraph({
            children: [new d.TextRun({ text: 'Raw Conversation Transcript', bold: true, size: 24 })],
            spacing: { before: 320, after: 120 },
        }));
        transcript.forEach(function (t) {
            var who = t.role === 'user' ? 'Student' : 'Remi';
            children.push(new d.Paragraph({
                children: [
                    new d.TextRun({ text: who + ': ', bold: true }),
                    new d.TextRun({ text: t.text }),
                ],
                spacing: { after: 80 },
            }));
        });

        var doc = new d.Document({ sections: [{ properties: {}, children: children }] });
        // Browsers: Packer.toBlob works (Blob support detected by jszip).
        // Node test harness: fall back to toBuffer (returns a Buffer) so
        // verify_docx_artifact.js can run without a browser.
        if (typeof Blob !== 'undefined') return d.Packer.toBlob(doc);
        return d.Packer.toBuffer(doc);
    };

    leaiFormMode.extractSlots = function (state, transcript, callStructured) {
        var schema = state.schema;
        var sections = schema.sections;
        var slots = {};
        var promise = Promise.resolve();
        // One-shot diagnostic so it's obvious in the console whether the
        // engine is using markered slicing or the no-markers full-transcript
        // fallback for THIS extraction run.
        if (typeof console !== 'undefined') {
            if (!transcriptHasAnyMarkers(transcript)) {
                console.info('[formmode] no section markers in transcript — extracting each section from the full conversation by topic');
            }
        }
        sections.forEach(function (s) {
            promise = promise.then(function () {
                var jsonSchema = buildSectionJsonSchema(s);
                var excerpt = extractSectionExcerpt(s, transcript);
                var prompt = buildSectionExtractionPrompt(s, excerpt, state);
                return callStructured(prompt, jsonSchema, { schemaName: 'section_' + s.id.replace(/\W/g, '_') })
                    .then(function (result) {
                        // /openai-structured/ returns { status, response: <jsonStr>, parsed: <obj> }.
                        var data = null;
                        if (result && result.parsed && typeof result.parsed === 'object') {
                            data = result.parsed;
                        } else if (result && typeof result.response === 'string') {
                            try { data = JSON.parse(result.response); } catch (_e) { data = null; }
                        } else if (result && typeof result === 'object' && !result.status) {
                            data = result;
                        }
                        if (data && typeof data === 'object') {
                            slots[s.id] = data;
                            // If this section captured a roster (kind=table on 2.2)
                            // and the running state doesn't have one yet — e.g. the
                            // conversation was conducted before this form schema was
                            // bound, so afterTurn never built state.roster live —
                            // promote the freshly extracted roster onto state now.
                            // Subsequent section prompts then get the canonical
                            // names line and produce consistent spellings.
                            if (!state.roster && Array.isArray(data.roster) && data.roster.length) {
                                var names = data.roster
                                    .map(function (r) { return (r && r.name) || ''; })
                                    .filter(function (n) { return n && n.trim(); });
                                if (names.length) state.roster = names;
                            }
                        }
                    })
                    .catch(function (err) {
                        if (typeof console !== 'undefined') {
                            console.warn('extractSlots failed for ' + s.id + ':', err && err.message ? err.message : err);
                        }
                    });
            });
        });
        return promise.then(function () {
            state.slots = slots;
            return slots;
        });
    };

    // Mirror of the per-section field→JSON-key derivation. Kept as a separate
    // helper so the critic pass (verifyMissingSlots) can map back from a JSON
    // key to its human-readable label when re-prompting.
    function sectionStringFieldKey(sectionId, fieldId) {
        if (sectionId === '1.3') {
            if (fieldId === '1.3a') return 'thought_i_knew';
            if (fieldId === '1.3b') return 'surprised_by';
            if (fieldId === '1.3c') return 'still_uncertain';
        } else if (sectionId === '2.3') {
            if (fieldId === '2.3.worked') return 'worked';
            if (fieldId === '2.3.challenge') return 'challenge';
            if (fieldId === '2.3.improvement') return 'improvement';
        } else if (sectionId === '2.2' && fieldId === '2.2.equity') {
            return 'equity';
        }
        return String(fieldId || '').split('.').pop().replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function buildSectionJsonSchema(section) {
        var props = {};
        var required = [];
        var hasStructured = false;
        var stringKeys = [];  // string-typed slots that need an evidence trail
        (section.fields || []).forEach(function (f) {
            if (f.kind === 'shortform') {
                hasStructured = true;
                var key = sectionStringFieldKey(section.id, f.id);
                props[key] = { type: 'string', description: f.label || ('Student answer: ' + key) };
                required.push(key);
                stringKeys.push(key);
            } else if (f.kind === 'table') {
                hasStructured = true;
                props.roster = {
                    type: 'array',
                    description: 'One row per teammate (including the student themselves). Use the EXACT names the student listed.',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Teammate name as the student stated it.' },
                            contribution: { type: 'string', description: 'Primary role or contribution this week, one or two sentences.' }
                        },
                        required: ['name', 'contribution'],
                        additionalProperties: false
                    }
                };
                required.push('roster');
            } else if (f.kind === 'rating_with_justification') {
                hasStructured = true;
                if (!props.ratings) {
                    props.ratings = { type: 'object', properties: {}, required: [], additionalProperties: false };
                    required.push('ratings');
                }
                var rk = f.id.split('.').pop();
                props.ratings.properties[rk] = {
                    type: 'object',
                    description: f.dimension,
                    properties: {
                        rating: { type: 'integer', minimum: 1, maximum: 5, description: 'The 1-5 rating the student stated for: ' + f.dimension },
                        justification: { type: 'string', description: 'The student’s justification for this rating, in their own words.' }
                    },
                    required: ['rating', 'justification'],
                    additionalProperties: false
                };
                props.ratings.required.push(rk);
            }
        });
        if (!hasStructured) {
            props.summary = {
                type: 'string',
                description: 'A clean 2-4 sentence narrative of what the student said about this section. Use their words and meaning; smooth voice-to-text disfluencies. Do NOT invent content.'
            };
            required.push('summary');
            stringKeys.push('summary');
        }
        // Sibling evidence object: for every required string slot, force the
        // model to produce a short verbatim quote from the supporting student
        // turn (or "" when the slot is genuinely "(not captured)"). Catches
        // the silent-drop failure mode where weaker models reach for the
        // "(not captured)" fallback rather than do the semantic match across
        // multiple sub-fields in one call. See the wk6-bug-150 regression
        // fixture for the original repro.
        if (stringKeys.length) {
            var evProps = {};
            stringKeys.forEach(function (k) {
                evProps[k] = {
                    type: 'string',
                    description: 'Verbatim ≤30-word snippet from the STUDENT turn that supports `' + k +
                        '`. Empty string ONLY when `' + k + '` is "(not captured)" AND no student turn semantically addresses the field.'
                };
            });
            props._evidence = {
                type: 'object',
                description: 'Per-field evidence trail. For every required string slot above, quote the student turn that supports your extraction (or "" if the slot is genuinely "(not captured)").',
                properties: evProps,
                required: stringKeys.slice(),
                additionalProperties: false
            };
            required.push('_evidence');
        }
        return {
            type: 'object',
            properties: props,
            required: required,
            additionalProperties: false
        };
    }

    function buildSectionExtractionPrompt(section, excerpt, state) {
        var rosterLine = '';
        if (state && state.roster && state.roster.length) {
            rosterLine = '\nCanonical roster (use these spellings exactly when extracting names): ' +
                state.roster.filter(function (n) { return n !== 'self'; }).join(', ') + '\n';
        }
        return [
            'You are extracting structured answers for ONE section of a student team-reflection form.',
            '',
            'Section: ' + section.id + '. ' + section.title,
            'Topic: ' + (section.topic || section.title),
            'Opening question: ' + (section.opening_prompt || ''),
            rosterLine,
            'Below is conversation content the engine pulled for this section. It is usually pre-sliced to just this section, but when the conversation lacks section markers (e.g. it predates this form schema being bound to the survey) the engine falls back to passing the FULL conversation here. In that case: ignore parts that clearly belong to other sections, and extract only content that addresses THIS section\'s topic and opening question. Match by meaning, not just by keyword — the student may answer this section\'s question without echoing the section\'s wording.',
            '',
            'Rules:',
            '- Use the student’s own words and meaning. Smooth voice-to-text disfluencies but do NOT invent content.',
            '- For ratings: "four" or "4" both mean 4. If the student gave the rating in a separate turn from the justification, pair them by which dimension the bot most recently asked about.',
            '- If a required field cannot be determined from this conversation, use a brief placeholder like "(not captured)" for strings. Do NOT mark a field "(not captured)" if any student turn semantically answers it — even when the student\'s wording differs from the field label (e.g. a turn beginning "what shifted my thinking" answers a field labeled "What I was surprised by"; a turn beginning "I am still uncertain about" answers a field labeled "What I am still uncertain about"). For required integer ratings where the student never stated a number, still pair the nearest dimension/justification — only fall back to a placeholder rating if the student truly never gave any 1-5 number for that dimension.',
            '- Names: use the exact spellings the student used.',
            '- Be inclusive when extracting: if the student says ANYTHING that addresses this section, capture it. For sections with a SINGLE required string field, the first substantive student turn after the section header is usually the answer. For sections with MULTIPLE required string sub-fields, DIFFERENT student turns typically answer DIFFERENT sub-fields — map each sub-field by semantic content, not by the order of turns or by exact label keywords.',
            '- The ONLY turns to skip are turns that explicitly give feedback about the chat itself (e.g. "this conversation surfaced more honest reflection than the PDF would have") — those belong to the closing-feedback step, not this section.',
            '- If the student answers with a structured "(a) ... (b) ..." or "if X then Y" form, preserve that structure verbatim in the summary.',
            '- For each required string slot, you MUST also populate `_evidence.<slot>` with a verbatim ≤30-word snippet from the supporting STUDENT turn. The snippet may be empty ONLY when the slot value is "(not captured)" AND no student turn semantically addresses the field. A non-empty value paired with an empty snippet — or a "(not captured)" value paired with a non-empty matching snippet — are both invalid.',
            '',
            'CONVERSATION:',
            excerpt || '(no turns for this section)'
        ].join('\n');
    }

    function transcriptHasAnyMarkers(transcript) {
        var probe = /Area\s+\d+\s+of\s+\d+\s+[—\-]\s+/i;
        for (var i = 0; i < transcript.length; i++) {
            var t = transcript[i];
            if (t.role === 'assistant' && probe.test(t.text)) return true;
        }
        return false;
    }

    function transcriptToText(transcript) {
        var lines = [];
        for (var p = 0; p < transcript.length; p++) {
            var who = transcript[p].role === 'user' ? 'STUDENT' : 'REMI';
            lines.push(who + ': ' + transcript[p].text);
        }
        return lines.join('\n\n');
    }

    function extractSectionExcerpt(section, transcript) {
        var markerRe = /Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\./gi;
        var titleKey = section.title.toLowerCase().slice(0, 12);
        var startTurn = -1;
        var endTurn = transcript.length;
        for (var i = 0; i < transcript.length; i++) {
            var t = transcript[i];
            if (t.role !== 'assistant') continue;
            markerRe.lastIndex = 0;
            var m;
            while ((m = markerRe.exec(t.text)) !== null) {
                var emittedTitle = (m[3] || '').trim().toLowerCase().slice(0, 12);
                if (emittedTitle === titleKey && startTurn === -1) {
                    startTurn = i;
                } else if (startTurn !== -1 && emittedTitle !== titleKey) {
                    endTurn = i;
                    break;
                }
            }
            if (startTurn !== -1 && endTurn !== transcript.length) break;
        }
        if (startTurn !== -1) {
            var lines = [];
            for (var p = startTurn; p < endTurn; p++) {
                var who = transcript[p].role === 'user' ? 'STUDENT' : 'REMI';
                lines.push(who + ': ' + transcript[p].text);
            }
            return lines.join('\n\n');
        }
        // No marker for this section. If the WHOLE transcript carries zero
        // "Area N of N — Title." markers (the conversation ran before the
        // survey was bound to a form schema, or was started on a non-form
        // survey that the instructor later upgraded to form mode), hand the
        // LLM the full transcript so it can find this section's content by
        // topic — the per-section JSON schema + topic line in the prompt
        // are enough for it to pick the right turns. If markers exist for
        // OTHER sections but not this one, the section truly wasn't reached
        // in the conversation; return empty as before.
        if (!transcriptHasAnyMarkers(transcript)) {
            return transcriptToText(transcript);
        }
        return '';
    }

    // ─── helpers ──────────────────────────────────────────────────────────

    // "Strong" advance signals — when these start a SHORT (≤8 words) message,
    // treat the whole message as a no-addition signal.
    var STRONG_NO_ADD = /^(no|nope|nah|move on|moving on|let'?s? move on|let'?s go|go next|next( one| please)?|skip|skip( ahead| this)?|i'?m done|i think we'?re done|that'?s it|that'?s all|nothing more|nothing else|nothing( more)? to add|nothing( more)? on this( one)?|i think we are done|we'?re done)\b/i;
    // "Weak" signals — natural at the start of substantive responses. Treat
    // as no-addition only when they are essentially the WHOLE message.
    var WEAK_NO_ADD_WHOLE = /^(done|good|fine|ready|ok|okay|sure|yep|yeah|cool|got it|got it\.?)$/i;

    function isNoAdditionResponse(s) {
        if (!s) return false;
        var t = s.replace(/^[\s,.\-—!?]+|[\s,.\-—!?]+$/g, '').trim();
        if (!t) return false;
        var words = t.split(/\s+/).filter(Boolean);
        if (!words.length) return false;
        // STRONG signal at start, but only when the whole message is short
        // (≤ 10 words). Substantive responses can legitimately START with
        // a STRONG-matching phrase — e.g. "Next week's commitment: …" for
        // section 3.2 begins with "Next" and was previously misclassified
        // as advance-now, dropping the entire 3.2 answer on the floor.
        if (words.length <= 10 && STRONG_NO_ADD.test(t)) return true;
        // WEAK signals are advance-worthy only as the whole short message.
        if (words.length <= 3 && WEAK_NO_ADD_WHOLE.test(t)) return true;
        return false;
    }

    function applyStudentResponseToCoverage(state, msg) {
        if (!msg) return;
        var i = state.current_area_index;
        var area = state.schema.sections[i - 1];
        var cov = state.coverage[area.id];
        if (!cov.opened) return;  // we haven't asked yet

        // Heuristic substantive-response detector: any non-trivial,
        // non-"move-on" message counts as a response.
        if (!isNoAdditionResponse(msg) && msg.length >= 2) {
            cov.response_received = true;
            // Track substantive-turn count for sub-field-aware sections
            // (e.g. 2.3 needs at least 3 substantive answers to fill
            // worked/challenge/improvement).
            cov.sub_signals.substantive_turns =
                (cov.sub_signals.substantive_turns || 0) + 1;
        }

        // Section-specific sub-signal capture for E9 thresholds.
        if (area.id === '2.2') {
            // Look for teammate-list patterns: comma-separated names, "X did Y",
            // or "Member: contribution".
            cov.sub_signals.has_roster = cov.sub_signals.has_roster ||
                /[,–—:]/.test(msg) || /\b(and|&)\b/i.test(msg);
            // Freeze the canonical roster the FIRST time the student lists
            // teammate names. Subsequent directives inject these names so the
            // bot can't drift (Lewis→Louise) or invent pronouns.
            if (!state.roster) {
                var names = extractRosterNames(msg);
                if (names && names.length >= 2) state.roster = names;
            }
        }
        if (area.id === '2.4') {
            // Count rating mentions (1-5).
            var nums = (msg.match(/\b[1-5]\b/g) || []).length;
            cov.sub_signals.ratings_count = (cov.sub_signals.ratings_count || 0) + nums;
        }
    }

    // Extract a roster from a free-form student message. Heuristic only:
    // looks for capitalized name tokens with optional "(me)" annotation.
    // Returns canonical name strings, or null if no plausible roster
    // shape is detected.
    //
    // Each capitalized token is treated as a separate name. We do NOT
    // glue adjacent capitalized tokens into a multi-word name, because
    // students often list "Emily Amy" meaning two people without a comma.
    // Multi-word names (e.g. "Maria Garcia") are vanishingly rare in this
    // context, so we err on the side of splitting.
    function extractRosterNames(msg) {
        if (!msg || msg.length > 500) return null;
        var stripped = msg.replace(/^[\s\-—–:•]+/, '').trim();
        // Strip leading conversational noise.
        stripped = stripped.replace(/^(?:it'?s|i'?m|we'?re|i\s+have|we\s+have|so\s+|on\s+my\s+team\s+(?:is|are|it'?s)?\s*)+/i, '').trim();
        // Find each capitalized token + flag whether "(me)" or "me"/"myself"
        // appears anywhere in the message.
        var hasSelf = /\b(?:me|myself)\b/i.test(stripped) || /\(\s*me\s*\)/i.test(stripped);
        // Tokenize on whitespace + common separators (",", ";", "&", " and ")
        var tokens = stripped
            .replace(/\(\s*me\s*\)/ig, ' ')
            .split(/\s*[,;&]\s*|\s+and\s+|\s+/i)
            .map(function (t) { return t.replace(/[^A-Za-z'\-]/g, ''); })
            .filter(Boolean);
        var STOPLIST = /^(I|We|And|Or|The|A|An|My|Our|Team|Member|Members|Roster|Teammates|Plus|Including|Hi|Hello|Yes|No|Ok|Okay|Sure|Yeah|It|Is|Are|Be|Was|So|Total|All|Of|Us|Me|Myself)$/i;
        var names = [];
        tokens.forEach(function (tok) {
            if (!/^[A-Z][a-zA-Z'\-]*$/.test(tok)) return;
            if (tok.length < 2) return;
            if (STOPLIST.test(tok)) return;
            names.push(tok);
        });
        // Dedupe preserving order.
        var seen = {}; var out = [];
        names.forEach(function (n) { if (!seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } });
        if (hasSelf) out.push('self');
        // Plausibility: at least 2 distinct entries.
        return out.length >= 2 ? out : null;
    }

    function areaResponseSatisfied(state, area) {
        var cov = state.coverage[area.id];
        if (!cov.response_received) return false;
        if (area.id === '2.4') {
            // Spec M6: collect all five 1–5 ratings + justifications. Lowering
            // this threshold lets the LLM declare 2.4 "done" after only a
            // couple of ratings and skip the remaining dimensions.
            return (cov.sub_signals.ratings_count || 0) >= 5;
        }
        if (area.id === '2.2') {
            return !!cov.sub_signals.has_roster;
        }
        // Sections with multiple labeled `shortform` sub-fields (e.g. 2.3
        // worked/challenge/improvement) need at least N substantive
        // student turns before we can claim coverage. A single answer
        // doesn't fill 3 fields. Without this, the bot moves on after
        // one or two answers and the third sub-field renders as
        // "(not captured)".
        var shortformCount = 0;
        (area.fields || []).forEach(function (f) {
            if (f.kind === 'shortform') shortformCount++;
        });
        if (shortformCount >= 2) {
            var turns = cov.sub_signals.substantive_turns || 0;
            return turns >= shortformCount;
        }
        return true;
    }

    function shouldProbe(state, area, lastMsg) {
        var cov = state.coverage[area.id];
        if (cov.probe_used) return false;
        if (!cov.response_received) return false;
        if (areaResponseSatisfied(state, area) === false) return false;
        // Probe if the most recent answer was thin and the area still has only
        // the opening response. We use word count as a proxy for shallowness.
        var threshold = (state.schema.shallow_word_threshold) || 25;
        var wc = (lastMsg || '').split(/\s+/).filter(Boolean).length;
        return wc > 0 && wc < threshold;
    }

    function allCovered(state) {
        var sections = state.schema.sections;
        for (var k = 0; k < sections.length; k++) {
            var s = sections[k];
            var cov = state.coverage[s.id];
            if (!cov.response_received) return false;
            if (!areaResponseSatisfied(state, s)) return false;
        }
        return true;
    }

    function countRemaining(state) {
        var sections = state.schema.sections;
        var c = 0;
        for (var k = 0; k < sections.length; k++) {
            var s = sections[k];
            if (!state.coverage[s.id].response_received || !areaResponseSatisfied(state, s)) c++;
        }
        return c;
    }

    function startsWithPrefix(s, prefix) {
        return (s || '').slice(0, prefix.length) === prefix;
    }

    // Heuristic: does this bot reply look like the closing-feedback question?
    // We compare against the schema's closing.feedback_prompt by extracting
    // a few salient phrases (the longest distinctive substring) and checking
    // if displayed contains it. Falls back to keyword overlap.
    function looksLikeClosingFeedback(displayed, closingPrompt) {
        if (!displayed || !closingPrompt) return false;
        var d = displayed.toLowerCase();
        // Pull a salient phrase from the closing prompt — first 40 chars after
        // any leading "Last thing —" or "Final question:"-style preamble.
        var key = closingPrompt.toLowerCase().replace(/^[^a-z]+/, '');
        // Try increasingly long substrings of the key as fingerprints.
        var candidates = [
            'surface more honest reflection than filling out the pdf',
            'work better next week',
            'more honest reflection',
            'filling out the pdf',
        ];
        for (var k = 0; k < candidates.length; k++) {
            if (d.indexOf(candidates[k]) !== -1) return true;
        }
        // Fallback: the schema's exact phrase (truncated to 30 chars).
        if (key.length >= 20 && d.indexOf(key.slice(0, 30)) !== -1) return true;
        return false;
    }

    // Force-mark every section as covered. Used when the engine needs to
    // synthetically conclude the conversation (e.g. after the bot has asked
    // the closing-feedback question).
    function forceCoverAll(state) {
        var sections = state.schema.sections;
        for (var k = 0; k < sections.length; k++) {
            var s = sections[k];
            var cov = state.coverage[s.id];
            cov.opened = true;
            cov.response_received = true;
            if (s.id === '2.4') {
                cov.sub_signals.ratings_count = Math.max(cov.sub_signals.ratings_count || 0, 5);
            }
            if (s.id === '2.2') {
                cov.sub_signals.has_roster = true;
            }
        }
        state.current_area_index = sections.length;
        state.awaiting_anything_else = false;
    }

    // Detect a "natural advance" header emitted by the LLM. Returns the
    // largest forward area index (1-based) the LLM is plausibly moving to,
    // or the engine's current index if no forward advance is detected.
    function detectForwardAdvance(state, displayed) {
        var n = state.schema.sections.length;
        var current = state.current_area_index;
        var headerRe = /Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\./gi;
        var m;
        var bestForward = current;
        while ((m = headerRe.exec(displayed)) !== null) {
            var idx = parseInt(m[1], 10);
            var total = parseInt(m[2], 10);
            if (total !== n) continue;
            if (idx <= current) continue;
            if (idx > n) continue;
            var schemaTitle = state.schema.sections[idx - 1].title;
            var emittedTitle = (m[3] || '').trim();
            var lhs = schemaTitle.toLowerCase().slice(0, 8);
            var rhs = emittedTitle.toLowerCase().slice(0, 8);
            if (lhs === rhs && idx > bestForward) bestForward = idx;
        }
        return bestForward;
    }

    // Remove any "Area X of N — Title" header from `text` whose index does NOT
    // match the engine's current area. Tolerates either ASCII hyphen or em-dash.
    function stripWrongSectionHeaders(text, currentIdx, totalN, currentTitle) {
        if (!text) return text;
        var headerRe = /Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\./gi;
        return text.replace(headerRe, function (match, idx, total, title) {
            var idxN = parseInt(idx, 10);
            var totalNum = parseInt(total, 10);
            if (idxN === currentIdx && totalNum === totalN) {
                return match;  // matches engine — keep
            }
            // Out-of-order or wrong-N — drop entirely (strip trailing ws too).
            return '';
        }).replace(/\n{3,}/g, '\n\n').trim();
    }

    // ─── directive builders ──────────────────────────────────────────────

    function dirOpening(state, area) {
        var schema = state.schema;
        var partsBlurb = (typeof schema.parts_blurb === 'string' && schema.parts_blurb.trim())
            ? schema.parts_blurb.trim()
            : 'from this week\'s template';
        return {
            kind: 'opening',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'This is the OPENING turn.',
                '1. Greet the student briefly.',
                '2. Tell them: "I\'ll walk you through ' + schema.sections.length + ' reflection areas ' + partsBlurb + '. You can ask to revise an earlier answer at any time, and you\'ll get a downloadable artifact at the end."',
                '3. Then ask the opening question for Area 1: ' + area.title + '. Use this question or rephrase tightly: "' + area.opening_prompt + '"',
                'Do NOT include the "Area 1 of ' + schema.sections.length + ' — ' + area.title + '." prefix yourself — engine will prepend it.',
                'One question only. Under 350 characters.',
                'REQUIRED: your reply MUST end with that opening question.',
            ].join('\n'),
        };
    }

    function dirOpenArea(state, area, i, n) {
        return {
            kind: 'open_area',
            text: withRoster(state, [
                '[DIRECTIVE FOR THIS TURN]',
                'You just finished the previous area. Now open Area ' + i + ' of ' + n + ': ' + area.title + '.',
                'Ask this opening question (rephrase tightly if needed, but keep the substance): "' + area.opening_prompt + '"',
                'Do NOT include the "Area ' + i + ' of ' + n + ' — ' + area.title + '." prefix — engine will prepend it.',
                'One question only. Under 350 characters.',
                'REQUIRED: your reply MUST end with the opening question. A pure ack ("Got it, sounds like we\'ve captured that.") strands the student and breaks the flow — always pivot into the next area\'s question.',
            ]).join('\n'),
        };
    }

    function dirProbe(state, area) {
        return {
            kind: 'probe',
            text: withRoster(state, [
                '[DIRECTIVE FOR THIS TURN]',
                'The student\'s answer was thin. Probe ONCE for specificity. Use the area\'s probe text or rephrase: "' + (area.depth_probe || 'Can you anchor that in a specific moment, example, or piece of evidence?') + '"',
                'After this probe, regardless of the student\'s response, the engine will move on. Do not probe again.',
                'One question only. Under 350 characters.',
                'REQUIRED: your reply MUST contain the probe question. Do not end on an ack alone — always ask.',
            ]).join('\n'),
        };
    }

    function dirAnythingElse(state, area) {
        return {
            kind: 'anything_else',
            text: withRoster(state, [
                '[DIRECTIVE FOR THIS TURN]',
                'The student has answered the area substantively. Now ask the wrap-up question: "Anything else on ' + area.topic + ' before we move on?"',
                'Do NOT advance to the next area in this message — engine handles that on the next turn based on the student\'s reply.',
                'Brief acknowledgement of what they said + the wrap-up question. Under 350 characters.',
                'REQUIRED: your reply MUST end with that wrap-up question. Acknowledgement-only replies (e.g. "Thanks, I\'ve captured that.") leave the student stranded — the chat stalls until they type "what next?". Always include the question.',
            ]).join('\n'),
        };
    }

    function dirContinueArea(state, area, i, n) {
        return {
            kind: 'continue',
            text: withRoster(state, [
                '[DIRECTIVE FOR THIS TURN]',
                'You are still on Area ' + i + ' of ' + n + ': ' + area.title + '. Continue gathering substantive content for this area.',
                'Reference: opening prompt was "' + area.opening_prompt + '"',
                'Ask exactly one question that moves the area forward. Do NOT advance to the next area.',
                'REQUIRED: your reply MUST contain a question (one ?). Acknowledgement-only replies stall the chat and force the student to type "what next?" — never end on an ack alone.',
                'Under 350 characters.',
            ]).join('\n'),
        };
    }

    // Prepend a [ROSTER] block to a directive's body lines if the engine has
    // a frozen roster. The bot must reference these names verbatim — this
    // shuts down the Lewis→Louise drift seen in production transcripts.
    function withRoster(state, lines) {
        if (!state.roster || !state.roster.length) return lines;
        var pretty = state.roster.filter(function (n) { return n !== 'self'; });
        var hasSelf = state.roster.indexOf('self') !== -1;
        var rosterStr = pretty.join(', ') + (hasSelf ? ' (plus the student themselves)' : '');
        var rosterBlock = [
            '[ROSTER — frozen, use exactly these spellings]',
            rosterStr,
            'When referring to teammates, use these EXACT names. Do not substitute similar-sounding names. Do not invent pronouns the student didn\'t state. If unsure of a teammate\'s gender, refer to them by name only.',
            '',
        ];
        return rosterBlock.concat(lines);
    }

    function dirClose(state) {
        return {
            kind: 'close',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'All ' + state.schema.sections.length + ' areas have been covered. Wrap up by asking ONE question: "' + (state.schema.closing && state.schema.closing.feedback_prompt ? state.schema.closing.feedback_prompt : 'Did this conversation surface more honest reflection than filling out the PDF would have, and what would make it work better next week?') + '"',
                'The engine handles closing internally — you do not need to signal completion. Just ask the closing question and wait for the student\'s answer.',
                'REQUIRED: your reply MUST end with that closing question. The student needs the chance to answer it before the chat completes.',
                'Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirFinalAck(state) {
        return {
            kind: 'final_ack',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'The student just answered the closing-feedback question. Your reply MUST be a single short acknowledgement (≤ 1 sentence, no question, no section header).',
                'The engine will mark the conversation complete internally after this turn — do not emit any sentinel or end marker.',
                'Examples: "Thanks, noted." / "Got it, that\'s helpful — appreciate the time."',
            ].join('\n'),
        };
    }

    function dirPostEnd(state) {
        var n = state.schema.sections.length;
        return {
            kind: 'post_end',
            text: [
                '[DIRECTIVE FOR THIS TURN — POST-END]',
                'All ' + n + ' reflection areas are already captured and the structured download is available to the student. They are still chatting because they may want to revise an earlier answer, add a clarification, or ask a question about the reflection.',
                'Respond conversationally and briefly (≤ 350 characters).',
                'Do NOT re-open completed sections. Do NOT emit a section header (no "Area X of N — Title."). Do NOT emit any control sentinel or end marker. Do NOT explain course methods or readings — refuse and redirect.',
                'If the student asks where the download is: tell them the "Download my reflection" button is in the chat footer below.',
                'If the student revises a teammate name, role, rating, open question, or commitment: acknowledge briefly ("Got it — updating to <X>.") so the new wording lands in the transcript and is picked up when they re-download.',
            ].join('\n'),
        };
    }

    // Append a deterministic forward-moving question if the LLM's reply
    // dropped it. Only fires for directive kinds that require a question.
    // Skips final_ack (intentionally ack-only) and post_end (free-form).
    function ensureForwardQuestion(state, displayed, directiveKind, area, n, i) {
        if (!directiveKind) return displayed;
        if (directiveKind === 'final_ack' || directiveKind === 'post_end') return displayed;
        // Quick check — if any '?' or '？' is present we accept the reply.
        if (/[?？]/.test(displayed)) return displayed;
        var q = '';
        if (directiveKind === 'opening' || directiveKind === 'open_area' || directiveKind === 'continue') {
            q = area && area.opening_prompt ? area.opening_prompt : '';
        } else if (directiveKind === 'anything_else') {
            var topic = (area && (area.topic || area.title)) || 'this area';
            q = 'Anything else on ' + topic + ' before we move on?';
        } else if (directiveKind === 'probe') {
            q = (area && area.depth_probe) ||
                'Can you anchor that in a specific moment, example, or piece of evidence?';
        } else if (directiveKind === 'close') {
            q = (state.schema.closing && state.schema.closing.feedback_prompt) ||
                'Last thing — was this conversation useful, and what would make it work better next week?';
        }
        if (!q) return displayed;
        // If the reply is empty or near-empty, just emit the question. Else
        // append after a separator so the ack reads naturally.
        var trimmed = (displayed || '').trim();
        if (!trimmed) return q;
        return trimmed + ' ' + q;
    }

    function mkBefore(opts) {
        return {
            shortCircuit: !!opts.shortCircuit,
            syntheticResponse: opts.syntheticResponse || '',
            directive: opts.directive || null,
            ended: !!opts.ended,
        };
    }

    function extractSectionAnswer(section, transcript) {
        // Build a list of (turn_index, section_number) markers by scanning
        // every bot turn for "Area X of N — Title" — anywhere in the text,
        // not just at the start. Then capture all student turns between this
        // section's marker and the next section's marker.
        var markerRe = /Area\s+(\d+)\s+of\s+(\d+)\s+[—\-]\s+([^.\n]+?)\s*\./gi;
        var markers = [];
        for (var i = 0; i < transcript.length; i++) {
            var t = transcript[i];
            if (t.role !== 'assistant') continue;
            markerRe.lastIndex = 0;
            var m;
            while ((m = markerRe.exec(t.text)) !== null) {
                markers.push({ turn: i, sectionNum: parseInt(m[1], 10), title: (m[3] || '').trim() });
            }
        }
        // Find this section's index in the schema (1-based).
        var sectionNum = section.id;
        // The markers carry "Area X of N" where X is the schema position
        // (1-based ordinal), not section.id. Map by position.
        // Caller passes section objects in schema order — find index by id.
        // We need the schema ordinal. Walk transcript to find first marker
        // with a matching title (loose, first 8 chars).
        var titleKey = section.title.toLowerCase().slice(0, 12);
        var startTurn = -1;
        var endTurn = transcript.length;
        for (var k = 0; k < markers.length; k++) {
            var mk = markers[k];
            var mkKey = mk.title.toLowerCase().slice(0, 12);
            if (mkKey === titleKey) {
                startTurn = mk.turn;
                // Find the next marker with a different title.
                for (var j = k + 1; j < markers.length; j++) {
                    var nextKey = markers[j].title.toLowerCase().slice(0, 12);
                    if (nextKey !== titleKey) { endTurn = markers[j].turn; break; }
                }
                break;
            }
        }
        if (startTurn === -1) return '';
        var captured = [];
        for (var p = startTurn + 1; p < endTurn; p++) {
            if (transcript[p].role === 'user') captured.push(transcript[p].text);
        }
        return captured.join('\n\n');
    }

    function escapeRegex(s) { return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // ─── exports ──────────────────────────────────────────────────────────

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = leaiFormMode;
    }
    global.leaiFormMode = leaiFormMode;

})(typeof window !== 'undefined' ? window : globalThis);
