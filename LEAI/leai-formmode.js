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

    // ─── public surface ────────────────────────────────────────────────────

    var leaiFormMode = {
        // Resolve a schema id to its JSON definition. Pages should fetch and
        // cache; this is a thin convenience for tests and the UI.
        loadSchema: function (schemaId) {
            var url = 'docs/forms/' + schemaId + '.json';
            return fetch(url).then(function (r) {
                if (!r.ok) throw new Error('schema fetch failed: ' + r.status);
                return r.json();
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
                stop_warn_issued: false,
                ended: false,
                team_id: (ctx && ctx.team_id) || null,
                team_member_slot: (ctx && ctx.team_member_slot) || null,
                last_directive: null,  // what we asked the LLM to do last turn
                awaiting_anything_else: false,  // true after we asked the wrap-up Q
                turn: 0,
                // Safety net counter — see MAX_TURNS_PER_AREA.
                turns_in_current_area: 0,
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
                '- Do NOT emit the [END] token. The engine handles closing.',
                '- The opening line "Area N of N — [Title]." will be added in code, so you do NOT need to include it yourself in transition messages — focus on the question.',
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
            state.turn += 1;
            var schema = state.schema;
            var sections = schema.sections;
            var n = sections.length;
            var i = state.current_area_index;
            var area = sections[i - 1];

            // Treat null/empty student message as the opening turn.
            var msg = (studentMessage || '').trim();
            var isStop = isStopWord(msg);

            // ── STOP intercept ───────────────────────────────────────────
            if (isStop) {
                if (allCovered(state)) {
                    // Coverage complete — let the LLM produce the closing.
                    return mkBefore({ directive: dirClose(state) });
                }
                if (!state.stop_warn_issued) {
                    state.stop_warn_issued = true;
                    var remaining = countRemaining(state);
                    return mkBefore({
                        shortCircuit: true,
                        syntheticResponse: 'We\'ve still got ' + remaining + ' of ' + n + ' areas left — really stop? Type STOP again to end here, or share anything more on the current area to keep going.',
                    });
                }
                // Second STOP after warn — honor it.
                state.ended = true;
                return mkBefore({
                    shortCircuit: true,
                    syntheticResponse: 'Got it — ending the reflection here. Thanks for what you shared. You can still download a transcript of what we covered.',
                    ended: true,
                });
            }

            // Any non-STOP message clears a previous warn.
            if (state.stop_warn_issued) state.stop_warn_issued = false;

            // ── interpret last turn's effects on coverage ────────────────
            applyStudentResponseToCoverage(state, msg);

            // Count student turns within the current area for safety-net cap.
            if (msg) state.turns_in_current_area = (state.turns_in_current_area || 0) + 1;

            // ── advance if appropriate ──────────────────────────────────
            var advanced = false;
            if (state.awaiting_anything_else && msg) {
                if (isNoAdditionResponse(msg)) {
                    // student said "move on / nothing more" — advance
                    state.coverage[area.id].response_received = true;
                    state.awaiting_anything_else = false;
                    state.current_area_index = Math.min(i + 1, n);
                    i = state.current_area_index;
                    area = sections[i - 1];
                    state.turns_in_current_area = 0;
                    advanced = true;
                } else {
                    // student added more substance — keep area, stop waiting
                    state.awaiting_anything_else = false;
                }
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
            }

            // ── determine this turn's directive ─────────────────────────
            var directive;
            if (state.turn === 1) {
                // opening turn
                state.coverage[area.id].opened = true;
                directive = dirOpening(state, area);
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
            if (directiveKind === 'opening' || directiveKind === 'open_area') {
                var prefix = 'Area ' + i + ' of ' + n + ' — ' + area.title + '.';
                if (!startsWithPrefix(displayed, prefix)) {
                    // Avoid double-prefixing if the model produced one anyway.
                    var altPrefix = new RegExp('^Area\\s+' + i + '\\s+of\\s+' + n + '\\s+—\\s+', 'i');
                    if (altPrefix.test(displayed)) {
                        // model produced its own prefix — leave as is
                    } else {
                        displayed = prefix + ' ' + displayed;
                    }
                }
            }

            // Handle [END]:
            if (hadEnd) {
                if (allCovered(state)) {
                    state.ended = true;
                    ended = true;
                } else {
                    // Strip and continue. Do NOT lock chat.
                    var remaining = countRemaining(state);
                    displayed += '\n\n(continuing — ' + remaining + ' of ' + n + ' areas left.)';
                }
            } else if (directiveKind === 'close' && allCovered(state)) {
                // Close directive ran and all areas covered — engine owns
                // closing. Append [END] so the chat-lock downstream fires.
                state.ended = true;
                ended = true;
                displayed = displayed + '\n\n[END]';
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
        renderStructuredMarkdown: function (state, transcript) {
            var schema = state.schema;
            var lines = [];
            lines.push('# ' + schema.title);
            lines.push('');
            lines.push('- **Course:** ' + schema.course);
            lines.push('- **Instructor:** ' + schema.instructor);
            lines.push('- **Week:** ' + schema.week);
            if (state.team_id) lines.push('- **Team:** ' + state.team_id);
            if (state.team_member_slot) lines.push('- **Member slot:** ' + state.team_member_slot);
            lines.push('- **Date submitted:** ' + new Date().toISOString().slice(0, 10));
            lines.push('');
            lines.push('---');
            lines.push('');
            schema.sections.forEach(function (s) {
                lines.push('## ' + s.id + '. ' + s.title);
                lines.push('');
                var answer = extractSectionAnswer(s, transcript);
                if (s.id === '2.2') {
                    lines.push('| Team Member | Primary Role / Contribution This Week |');
                    lines.push('|---|---|');
                    lines.push('| _(see narrative below — auto-extraction may need cleanup)_ | |');
                    lines.push('');
                    lines.push(answer || '_(no response captured)_');
                } else if (s.id === '2.4') {
                    lines.push('| Dimension | Rating (1–5) | Brief Justification |');
                    lines.push('|---|---|---|');
                    s.fields.forEach(function (f) {
                        if (f.dimension) {
                            lines.push('| ' + f.dimension + ' | _(see narrative below)_ | |');
                        }
                    });
                    lines.push('');
                    lines.push(answer || '_(no response captured)_');
                } else {
                    lines.push(answer || '_(no response captured)_');
                }
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
        renderStructuredHtml: function (state, transcript, opts) {
            opts = opts || {};
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
            html += '<div><strong>Date submitted:</strong> ' + date + '</div>';
            html += '</div>';

            schema.sections.forEach(function (s) {
                html += '<h2>' + esc(s.id) + '. ' + esc(s.title) + '</h2>';
                var answer = extractSectionAnswer(s, transcript);
                var bodyHtml;
                if (!answer) {
                    bodyHtml = '<p><em>(no response captured)</em></p>';
                } else {
                    bodyHtml = '<div class="section-body">' + paragraphsToHtml(answer, esc) + '</div>';
                }
                if (s.id === '2.2') {
                    html += '<table><thead><tr><th>Team Member</th><th>Primary Role / Contribution This Week</th></tr></thead>';
                    html += '<tbody><tr><td colspan="2"><em>Captured below in narrative form — instructor may transcribe to this table for grading.</em></td></tr></tbody></table>';
                    html += bodyHtml;
                } else if (s.id === '2.4') {
                    html += '<table><thead><tr><th>Dimension</th><th>Rating (1–5)</th><th>Brief Justification</th></tr></thead><tbody>';
                    s.fields.forEach(function (f) {
                        if (f.dimension) {
                            html += '<tr><td>' + esc(f.dimension) + '</td><td></td><td><em>see narrative</em></td></tr>';
                        }
                    });
                    html += '</tbody></table>';
                    html += bodyHtml;
                } else {
                    html += bodyHtml;
                }
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

    // ─── helpers ──────────────────────────────────────────────────────────

    function isStopWord(s) {
        if (!s) return false;
        return /^\s*stop\s*[.!?]?\s*$/i.test(s);
    }

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
        // STRONG signal at start → advance, no length cap (substantive
        // content never starts with a STRONG phrase).
        if (STRONG_NO_ADD.test(t)) return true;
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
        }

        // Section-specific sub-signal capture for E9 thresholds.
        if (area.id === '2.2') {
            // Look for teammate-list patterns: comma-separated names, "X did Y",
            // or "Member: contribution".
            cov.sub_signals.has_roster = cov.sub_signals.has_roster ||
                /[,–—:]/.test(msg) || /\b(and|&)\b/i.test(msg);
        }
        if (area.id === '2.4') {
            // Count rating mentions (1-5).
            var nums = (msg.match(/\b[1-5]\b/g) || []).length;
            cov.sub_signals.ratings_count = (cov.sub_signals.ratings_count || 0) + nums;
        }
    }

    function areaResponseSatisfied(state, area) {
        var cov = state.coverage[area.id];
        if (!cov.response_received) return false;
        if (area.id === '2.4') {
            // Need at least 3 of 5 ratings before we let the engine wrap up.
            return (cov.sub_signals.ratings_count || 0) >= 3;
        }
        if (area.id === '2.2') {
            return !!cov.sub_signals.has_roster;
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

    // ─── directive builders ──────────────────────────────────────────────

    function dirOpening(state, area) {
        var schema = state.schema;
        return {
            kind: 'opening',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'This is the OPENING turn.',
                '1. Greet the student briefly.',
                '2. Tell them: "I\'ll walk you through ' + schema.sections.length + ' reflection areas covering Parts 1, 2, and 3 of your template. You can type STOP at any time, can ask to revise an earlier answer, and will get a downloadable artifact at the end."',
                '3. Then ask the opening question for Area 1: ' + area.title + '. Use this question or rephrase tightly: "' + area.opening_prompt + '"',
                'Do NOT include the "Area 1 of ' + schema.sections.length + ' — ' + area.title + '." prefix yourself — engine will prepend it.',
                'One question only. Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirOpenArea(state, area, i, n) {
        return {
            kind: 'open_area',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'You just finished the previous area. Now open Area ' + i + ' of ' + n + ': ' + area.title + '.',
                'Ask this opening question (rephrase tightly if needed, but keep the substance): "' + area.opening_prompt + '"',
                'Do NOT include the "Area ' + i + ' of ' + n + ' — ' + area.title + '." prefix — engine will prepend it.',
                'One question only. Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirProbe(state, area) {
        return {
            kind: 'probe',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'The student\'s answer was thin. Probe ONCE for specificity. Use the area\'s probe text or rephrase: "' + (area.depth_probe || 'Can you anchor that in a specific moment, example, or piece of evidence?') + '"',
                'After this probe, regardless of the student\'s response, the engine will move on. Do not probe again.',
                'One question only. Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirAnythingElse(state, area) {
        return {
            kind: 'anything_else',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'The student has answered the area substantively. Now ask the wrap-up question: "Anything else on ' + area.topic + ' before we move on?"',
                'Do NOT advance to the next area in this message — engine handles that on the next turn based on the student\'s reply.',
                'Brief acknowledgement of what they said + the wrap-up question. Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirContinueArea(state, area, i, n) {
        return {
            kind: 'continue',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'You are still on Area ' + i + ' of ' + n + ': ' + area.title + '. Continue gathering substantive content for this area.',
                'Reference: opening prompt was "' + area.opening_prompt + '"',
                'Ask one question that moves the area forward, or briefly acknowledge if the student is mid-thought. Do NOT advance to the next area.',
                'Under 350 characters.',
            ].join('\n'),
        };
    }

    function dirClose(state) {
        return {
            kind: 'close',
            text: [
                '[DIRECTIVE FOR THIS TURN]',
                'All ' + state.schema.sections.length + ' areas have been covered. Wrap up by asking ONE question: "' + (state.schema.closing && state.schema.closing.feedback_prompt ? state.schema.closing.feedback_prompt : 'Did this conversation surface more honest reflection than filling out the PDF would have, and what would make it work better next week?') + '"',
                'Engine will append [END] in code — do NOT emit [END] yourself.',
                'Under 350 characters.',
            ].join('\n'),
        };
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
        // Naive extractor: concatenate all student turns that fell after this
        // section's "Area N of N — Title." prefix appeared in a bot turn, until
        // the next prefix or end of transcript. Good enough for v1; the
        // insights-report path will refine this server-side.
        var prefixRe = new RegExp('Area\\s+\\d+\\s+of\\s+\\d+\\s+—\\s+' + escapeRegex(section.title), 'i');
        var inSection = false;
        var captured = [];
        for (var k = 0; k < transcript.length; k++) {
            var t = transcript[k];
            if (t.role === 'assistant' && prefixRe.test(t.text)) { inSection = true; continue; }
            if (t.role === 'assistant' && /^Area\s+\d+\s+of\s+\d+\s+—\s+/i.test(t.text) && !prefixRe.test(t.text)) {
                inSection = false;
            }
            if (inSection && t.role === 'user') captured.push(t.text);
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
