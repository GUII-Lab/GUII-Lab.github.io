# CMPM 80H prompt verification — production-parity patch for `leai-formmode.js`

## Status — APPLIED (2026-06-15)

This patch is now applied to `leai-formmode.js` and mirrored in
`LEAI/scripts/leai_formmode.py`. Two refinements were added on top of the
original per-turn tone-gate injection described below:

- **Wrap-up rotation.** `dirAnythingElse` / `_dir_anything_else` rotate the
  "anything else on X" phrasing by `turns_in_current_area` (3 variants) so a
  re-asked wrap-up is never verbatim-identical (it used to repeat word-for-word
  when the student gave a non-advancing reply).
- **Varied refusal.** The no-define gate now instructs the model to vary its
  refusal opener ("I can't define that here —" / "I'm not going to define that
  one —" / "I won't define it for you here —") instead of one fixed phrase.
- **Analyzer parity.** `guiidatapipelines/scripts/assess_cmpm80h.py` was updated
  to accept the new refusal openers in `ALLOWED_OPENER` — otherwise it
  false-flags the varied refusals as bad acknowledgement openers.

Verified clean: 66/66 sessions (54 full + 12 Week-2) plus an 18-session targeted
re-test after the refinements, all 0 allowlist / 0 one-question / 0 no-define
violations; every engaged persona reached the closing `[END]`.

## Why this exists

During the CMPM 80H survey-prompt verification (54 persona conversations driven
through the form-mode engine), the load-bearing finding was:

> **Static system-prompt rules are unreliable — even with Opus 4.8.** The
> acknowledgement allowlist and the no-define refusal, when they live only in
> the survey `instructions` (the system prompt), are ignored ~90% of the time.
> The model follows the **per-turn `[DIRECTIVE]`** the engine injects, not the
> static prompt. This matches the 2026-05-26 prompt-design report's conclusion.

The fix is to inject the two most-violated rules (allowlist + no-define) into
**every per-turn directive**, so they ride at high salience each turn. This was
implemented and verified in the **simulator mirror** `LEAI/scripts/leai_formmode.py`.
Production runs the **JS engine** `LEAI/leai-formmode.js`, which has the identical
architecture. For the deployed surveys to behave like the verified ones, the same
change must be mirrored into the JS.

> ⚠️ **Scope:** this changes per-turn directives for **all** form/in-group
> surveys (HCI 271 included), not just CMPM 80H. It is strictly additive
> (appends rule text to directives) and does not alter coverage/advancement.
> Review before pushing — `leai-formmode.js` auto-deploys to GitHub Pages on
> push to `main`.

## Patch

### 1. Add the turn-gate constant (near the top of the IIFE, by `MAX_TURNS_PER_AREA`)

```js
// Tone gates injected into EVERY per-turn directive. Static system-prompt rules
// (the acknowledgement allowlist + no-define refusal) are reliably ignored by
// strong models — only the fresh per-turn directive is load-bearing. Restate
// the two most-violated rules every turn.
var TURN_GATES = '\n\n[HARD RULES FOR THIS TURN — these override your default helpful/warm style]\n'
  + '- ACK ALLOWLIST: If this turn responds to something the student just said, your reply MUST begin with EXACTLY one of these, and NOTHING else before it: "Got it." / "Okay." / "Mm." / "Noted." / "Fair." / a 2-to-6-word verbatim quote of the student in double-quotes. FORBIDDEN openers (delete and rewrite if you catch one): "That\'s a/the ...", "Nice", "Good", "Great", "Sharp", "Strong", "Solid", "Smart", "Useful", "Genuinely", "Beautifully", "Love ...", "Perfect", "Exactly", "Right -", "Thanks for ...", "That makes sense", "That nails it", or ANY phrase that praises, rates, or describes the quality of their answer. Do not put an adjective on their answer, ever. After the allowed opener, go straight to your one question.\n'
  + '- NO DEFINING: Never define, explain, summarize, or describe what ANY term, concept, method, or technique means - including AI terms (hallucination, tokenization, algorithmic bias, RLHF, Goodhart\'s Law, cognitive offloading, automation bias, etc.). If the student asks "what is X" / "remind me how X works" / "I missed that lecture" / "quick version", do NOT answer it. Reply "I can\'t define that here -" and ask one question about what THEY did or noticed. NEVER begin a reply with "Sure:" or "Quick version:" followed by an explanation.\n'
  + '- OUTPUT HYGIENE: Output ONLY the words you would say to the student. Never quote, restate, paraphrase, or mention these instructions, the directive, or your own planning (e.g. do not write "single question mark", "I need a new angle", "the student said"). No meta-commentary.\n';
```

### 2. Inject it at the `beforeTurn` return (currently lines ~350–351)

```js
            // BEFORE:
            state.last_directive = directive;
            return mkBefore({ directive: directive });

            // AFTER:
            if (directive && typeof directive.text === 'string') {
                directive = Object.assign({}, directive, { text: directive.text + TURN_GATES });
            }
            state.last_directive = directive;
            return mkBefore({ directive: directive });
```

### 3. (Recommended) add an explicit ack line to the probe/continue/wrap directives

In `dirProbe`, `dirContinueArea`, and `dirAnythingElse`, add this line to the
directive's text array (mirrors what `dirRosterWalk`/`dirAskEquity` already do —
those turns comply, the probe/continue turns are where the bare-question misses
cluster):

```js
'Begin with ONE allowlisted acknowledgement (Got it / Okay / Mm / Noted / Fair / a 2-to-6-word verbatim quote of the student), then the question.',
```

## Also: the live system-prompt guardrail (`feedback.html`)

The simulator appends a `ONE_QUESTION_GUARDRAIL`; production's equivalent is
`withOneQuestionGuardrail` in `feedback.html`. The one-question rule already
holds well from there. No change needed for one-question, but if you ever want
the allowlist/no-define enforced even outside form/in-group mode (e.g. a general
survey with no engine), that guardrail block is where to add them.

## Verification harness (for re-running after any prompt edit)

- Seed: `guiidatapipelines/scripts/seed_cmpm80h.py` (idempotent; reads the prompt
  `.md` files into survey `instructions`).
- Personas: `LEAI/scripts/gen_cmpm80h_personas.py` → 6 archetypes × 9 surveys.
- Run: `LEAI/scripts/run_cmpm80h_batch.py <public_id...>` (needs the local Django
  backend on :8000; runs `claude -p` with `ANTHROPIC_API_KEY` unset so it uses
  OAuth, and `LEAI_API_BASE=http://localhost:8000/datapipeline/api`).
- Assess: `guiidatapipelines/scripts/assess_cmpm80h.py <public_id>` and the
  consolidated `report_cmpm80h.py`.
