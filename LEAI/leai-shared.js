// ===== API BASE URL =====
const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000/datapipeline/api'
    : 'https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api';

// ===== SESSION HELPERS =====
const SESSION_KEY = 'leai_session';

function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function saveSession(data) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

// ===== UI HELPERS =====
function setMsg(elId, text, type) {
    var el = document.getElementById(elId);
    el.className = 'msg msg-' + type;
    el.textContent = text;
}

function markFieldError(inputId, message) {
    var el = document.getElementById(inputId);
    if (!el) return;
    el.classList.add('input-error');
    var hint = document.getElementById(inputId + '-hint');
    if (hint) {
        hint.textContent = message;
        hint.classList.remove('fading');
        hint.classList.add('visible');
        var timer = setTimeout(function () {
            hint.classList.add('fading');
            setTimeout(function () {
                hint.classList.remove('visible', 'fading');
                hint.textContent = '';
            }, 400);
        }, 3000);
    }
    el.addEventListener('input', function clearErr() {
        el.classList.remove('input-error');
        if (hint) {
            clearTimeout(timer);
            hint.classList.remove('visible', 'fading');
            hint.textContent = '';
        }
    }, { once: true });
}

function clearMsg(elId) {
    var el = document.getElementById(elId);
    el.className = '';
    el.textContent = '';
}

// ===== SECURITY HELPER =====
// Escape a string before using it in text contexts where needed.
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ===== DATE / STATUS HELPERS =====
function formatExpiry(isoString) {
    if (!isoString) return null;
    var d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Returns { label: string, cssClass: string } for a survey's lifecycle state.
// survey must have: is_closed, expires_at, opens_at (all may be null/false).
function surveyStatus(survey) {
    if (survey.is_closed) return { label: 'Closed', cssClass: 'status-closed' };
    var now = new Date();
    if (survey.opens_at && new Date(survey.opens_at) > now)
        return { label: 'Scheduled', cssClass: 'status-scheduled' };
    if (survey.expires_at && new Date(survey.expires_at) < now)
        return { label: 'Expired', cssClass: 'status-expired' };
    return { label: 'Open', cssClass: 'status-open' };
}

// ===== SIDEBAR INITIALISER =====
// activeNavId : ID of the sidebar <a> or <button> to mark active.
// onSignOut   : callback invoked before DOM teardown; clears page-level state vars.
function initSidebar(activeNavId, onSignOut) {
    var stored = getSession();
    if (stored && stored.courseId) {
        document.getElementById('sidebar-course-id').textContent = stored.courseId;
    }
    document.getElementById(activeNavId).classList.add('active');

    if (localStorage.getItem('leai_sidebar_collapsed') === 'true') {
        document.getElementById('sidebar').classList.add('collapsed');
    }

    document.getElementById('sidebar-toggle').addEventListener('click', function () {
        var sb = document.getElementById('sidebar');
        sb.classList.toggle('collapsed');
        localStorage.setItem('leai_sidebar_collapsed', sb.classList.contains('collapsed'));
    });

    document.getElementById('hamburger-btn').addEventListener('click', function () {
        document.getElementById('sidebar').classList.toggle('mobile-open');
        document.getElementById('sidebar-scrim').classList.toggle('visible');
    });

    document.getElementById('sidebar-scrim').addEventListener('click', function () {
        document.getElementById('sidebar').classList.remove('mobile-open');
        document.getElementById('sidebar-scrim').classList.remove('visible');
    });

    document.getElementById('sidebar-signout').addEventListener('click', function () {
        if (onSignOut) onSignOut();
        clearSession();
        document.getElementById('app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
    });
}

// ===== TAG CHIP INPUT =====
// containerId  : ID of an empty <div> that will become the tag input.
// placeholder  : placeholder text shown in the inner text input.
// Returns      : { getTags(), setTags(arr) }
function initTagInput(containerId, placeholder) {
    var container = document.getElementById(containerId);
    var tags = [];

    var input = document.createElement('input');
    input.className = 'tag-chip-input';
    input.placeholder = placeholder || 'Add tag, press Enter...';
    container.appendChild(input);

    container.addEventListener('click', function () { input.focus(); });
    input.addEventListener('focus', function () { container.classList.add('focused'); });
    input.addEventListener('blur',  function () { container.classList.remove('focused'); addTag(input.value); });
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(input.value);
        } else if (e.key === 'Backspace' && !input.value && tags.length) {
            removeTag(tags.length - 1);
        }
    });

    function addTag(val) {
        val = val.trim().replace(/,+$/, '');
        if (!val || tags.includes(val)) { input.value = ''; return; }
        tags.push(val);
        render();
        input.value = '';
    }

    function removeTag(idx) {
        tags.splice(idx, 1);
        render();
    }

    function render() {
        Array.from(container.querySelectorAll('.tag-chip')).forEach(function (c) { c.remove(); });
        tags.forEach(function (t, i) {
            var chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.appendChild(document.createTextNode(t));

            var removeBtn = document.createElement('button');
            removeBtn.className = 'tag-chip-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.type = 'button';
            (function (idx) {
                removeBtn.addEventListener('click', function (e) { e.stopPropagation(); removeTag(idx); });
            }(i));
            chip.appendChild(removeBtn);
            container.insertBefore(chip, input);
        });
    }

    return {
        getTags: function () { return tags.slice(); },
        setTags: function (arr) { tags = arr ? arr.slice() : []; render(); }
    };
}

// ===== LEAI ANALYSIS HELPERS (client-side, no network) =====

var STOPWORDS = new Set([
    'a','about','above','after','again','against','all','am','an','and','any',
    'are','as','at','be','because','been','before','being','below','between',
    'both','but','by','can','could','did','do','does','doing','down','during',
    'each','few','for','from','further','get','got','had','has','have','having',
    'he','her','here','hers','herself','him','himself','his','how','i','if',
    'in','into','is','it','its','itself','just','like','ll','me','might','more',
    'most','my','myself','no','nor','not','now','of','off','on','once','only',
    'or','other','our','ours','ourselves','out','over','own','re','s','same',
    'she','should','so','some','such','t','than','that','the','their','theirs',
    'them','themselves','then','there','these','they','this','those','through',
    'to','too','under','until','up','ve','very','was','we','were','what','when',
    'where','which','while','who','whom','why','will','with','would','you',
    'your','yours','yourself','yourselves','also','been','being','come','could',
    'did','does','done','going','gonna','got','gotta','had','has','have',
    'just','keep','let','make','many','may','much','must','need','really',
    'say','said','shall','since','still','sure','take','tell','thing','think',
    'try','use','want','way','well','went','work','yeah','yes',
]);

var leaiAnalysis = {
    tokenize: function(text) {
        return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ')
            .split(/\s+/).filter(function(t) { return t.length > 1 && !STOPWORDS.has(t); });
    },

    computeNgrams: function(responses, n) {
        var counts = {};
        responses.forEach(function(r) {
            var tokens = leaiAnalysis.tokenize(r.text);
            for (var i = 0; i <= tokens.length - n; i++) {
                var gram = tokens.slice(i, i + n).join(' ');
                counts[gram] = (counts[gram] || 0) + 1;
            }
        });
        return Object.keys(counts).map(function(term) {
            return { term: term, count: counts[term] };
        }).sort(function(a, b) { return b.count - a.count; });
    },

    computeKeyness: function(targetCounts, targetTotal, baselineCounts, baselineTotal) {
        var results = [];
        var allTerms = new Set(Object.keys(targetCounts).concat(Object.keys(baselineCounts)));
        allTerms.forEach(function(term) {
            var a = targetCounts[term] || 0;
            var b = baselineCounts[term] || 0;
            if (a === 0) return;
            var e1 = targetTotal * (a + b) / (targetTotal + baselineTotal);
            var e2 = baselineTotal * (a + b) / (targetTotal + baselineTotal);
            var ll = 0;
            if (a > 0 && e1 > 0) ll += a * Math.log(a / e1);
            if (b > 0 && e2 > 0) ll += b * Math.log(b / e2);
            ll *= 2;
            results.push({ term: term, ll: Math.round(ll * 10) / 10, count: a });
        });
        return results.sort(function(a, b) { return b.ll - a.ll; });
    },

    matchResponsesForTerm: function(responses, term) {
        // Normalize both sides with the same regex used in tokenize() so that
        // punctuation between tokens (e.g. "Dr. John") doesn't prevent the
        // substring match for a bigram like "dr john".
        function normalize(s) {
            return s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }
        var needle = normalize(term);
        if (!needle) return [];
        return responses.filter(function(r) {
            var hay = ' ' + normalize(r.text) + ' ';
            return hay.indexOf(' ' + needle + ' ') !== -1;
        });
    },

    buildResponseIndex: function(allSurveys, scopeKind, scopeWeekNumber) {
        var responses = [];
        var counter = 1;
        var surveys = allSurveys;
        if (scopeKind === 'week' && scopeWeekNumber != null) {
            surveys = allSurveys.filter(function(s) {
                return s.week_number === scopeWeekNumber;
            });
        }
        surveys.forEach(function(s) {
            var sids = Object.keys(s.sessions).sort();
            sids.forEach(function(sid) {
                var msgs = s.sessions[sid];
                var studentMsgs = msgs.filter(function(m) {
                    return m.sent_by === 'user-message';
                }).map(function(m) { return m.content; });
                if (studentMsgs.length) {
                    responses.push({
                        rid: 'R' + counter,
                        survey_id: s.gpt_id,
                        session_id: sid,
                        week_number: s.week_number || 0,
                        text: studentMsgs.join(' | '),
                    });
                    counter++;
                }
            });
        });
        return responses;
    },

    renderCitationPill: function(pillIndex, verdict) {
        var span = document.createElement('span');
        span.className = 'cite' + (verdict === 'verified' ? ' verified' :
            verdict === 'partial' || verdict === 'unsupported' ? ' warn' : '');
        span.textContent = pillIndex;
        span.setAttribute('tabindex', '0');
        return span;
    },

    // Assigns pill indices per AI response: first-appearance order across all
    // bullets, shared so duplicate rids always get the same number.
    // Input:  [{ text, cited_ids:[rid, ...] }, ...]
    // Output: {
    //   ridToPill: { rid: pillIndex },   // 1-based, in first-appearance order
    //   orderedRids: [rid, ...],         // index 0 → pill 1, etc.
    //   bulletPills: [[pillIndex, ...], ...] // per-bullet pill sequence preserving duplicates
    // }
    assignPillIndices: function(bullets) {
        var ridToPill = {};
        var orderedRids = [];
        var bulletPills = [];
        (bullets || []).forEach(function(b) {
            var seq = [];
            (b.cited_ids || []).forEach(function(rid) {
                if (!(rid in ridToPill)) {
                    orderedRids.push(rid);
                    ridToPill[rid] = orderedRids.length;
                }
                seq.push(ridToPill[rid]);
            });
            bulletPills.push(seq);
        });
        return { ridToPill: ridToPill, orderedRids: orderedRids, bulletPills: bulletPills };
    },

    // Shared source-card renderer for the drawer on both QuickTake and Chat.
    // Renders:  [n]  R-id · Week X
    //           "response text"
    renderSourceCard: function(localIdx, src) {
        var card = document.createElement('div');
        card.className = 'source-card';
        if (src && src.rid) card.setAttribute('data-cite', src.rid);

        var meta = document.createElement('div');
        meta.className = 'source-meta';

        var idxEl = document.createElement('span');
        idxEl.className = 'source-idx';
        idxEl.textContent = '[' + localIdx + ']';
        meta.appendChild(idxEl);

        var parts = [];
        if (src && src.rid) parts.push(src.rid);
        if (src && src.week_number != null) parts.push('Week ' + src.week_number);
        if (parts.length) {
            meta.appendChild(document.createTextNode(' ' + parts.join(' \u00b7 ')));
        }

        var text = document.createElement('div');
        text.className = 'source-text';
        text.textContent = (src && (src.text || src.content)) || '';

        card.appendChild(meta);
        card.appendChild(text);
        return card;
    },
};

// ===== LEAI CHAT HELPERS (async fetch wrappers) =====

var DEFAULT_FEEDBACK_CHAT_SYSTEM_PROMPT = (
    'You are LEAI, a research assistant helping a university instructor ' +
    'understand student feedback from their course.\n\n' +
    'You have access to student responses from the scope the instructor ' +
    'selected. Each response is tagged R1, R2, … R<N>.\n\n' +
    'Rules:\n' +
    '- Answer the instructor\'s question concisely and directly.\n' +
    '- Every factual claim about what students said MUST cite the exact ' +
    'response IDs that support it, using bracket markers like [R17].\n' +
    '- Do not invent response IDs. Only cite IDs you were given.\n' +
    '- Quote fragments must be verbatim from the responses.\n' +
    '- If the responses don\'t support an answer, say so.'
);

var leaiChat = {
    _fetch: function(path, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        if (opts.body && !opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
        }
        return fetch(API + path, opts).then(function(r) {
            if (r.status === 204) return null;
            if (r.status === 404 && opts._allow404) return null;
            if (!r.ok) return r.json().then(function(err) {
                throw new Error(err.error || 'Request failed: ' + r.status);
            });
            return r.json();
        });
    },

    listSessions: function(courseId) {
        return leaiChat._fetch('/leai_chat_sessions/?course_id=' + encodeURIComponent(courseId));
    },
    getSession: function(sessionId) {
        return leaiChat._fetch('/leai_chat_sessions/' + sessionId + '/');
    },
    createSession: function(courseId, opts) {
        var body = {
            course_id: courseId,
            title: opts.title || 'New chat',
            scope: opts.scope || { kind: 'course' },
            seed_system_message: opts.seedSystemMessage || null,
        };
        if (opts.seedAssistantMessage) {
            body.seed_assistant_message = opts.seedAssistantMessage;
        }
        return leaiChat._fetch('/leai_chat_sessions/', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },
    updateSession: function(sessionId, patch) {
        return leaiChat._fetch('/leai_chat_sessions/' + sessionId + '/', {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
    },
    deleteSession: function(sessionId) {
        return leaiChat._fetch('/leai_chat_sessions/' + sessionId + '/', {
            method: 'DELETE',
        });
    },
    // Plain chat proxy — wraps /openai-chat/
    chat: function(userText, opts) {
        opts = opts || {};
        var body = { user_text: userText };
        if (opts.chatHistory) body.chat_history = opts.chatHistory;
        if (opts.model) body.model = opts.model;
        if (opts.temperature != null) body.temperature = opts.temperature;
        return leaiChat._fetch('/openai-chat/', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },

    // Structured JSON response — wraps /openai-structured/
    structured: function(userText, jsonSchema, opts) {
        opts = opts || {};
        var body = { user_text: userText, json_schema: jsonSchema };
        if (opts.schemaName) body.schema_name = opts.schemaName;
        if (opts.chatHistory) body.chat_history = opts.chatHistory;
        if (opts.model) body.model = opts.model;
        if (opts.temperature != null) body.temperature = opts.temperature;
        return leaiChat._fetch('/openai-structured/', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },

    sendTurn: function(sessionId, userText) {
        return leaiChat._fetch('/leai_chat_sessions/' + sessionId + '/turn/', {
            method: 'POST',
            body: JSON.stringify({ user_text: userText }),
        });
    },

    getQuickTake: function(courseId, scopeKey) {
        return leaiChat._fetch(
            '/leai_quicktake/?course_id=' + encodeURIComponent(courseId) +
            '&scope_key=' + encodeURIComponent(scopeKey),
            { _allow404: true },
        );
    },
    generateQuickTake: function(courseId, scopeKey, scope) {
        return leaiChat._fetch('/leai_quicktake/generate/', {
            method: 'POST',
            body: JSON.stringify({
                course_id: courseId,
                scope_key: scopeKey,
                scope: scope,
            }),
        });
    },
    pollQuickTake: function(courseId, scopeKey, opts) {
        // Poll getQuickTake until status is ready/failed, then resolve/reject.
        // opts: { intervalMs=2000, timeoutMs=300000, onTick(qt) }
        opts = opts || {};
        var intervalMs = opts.intervalMs || 2000;
        var timeoutMs = opts.timeoutMs || 300000;
        var onTick = typeof opts.onTick === 'function' ? opts.onTick : null;
        var startedAt = Date.now();
        return new Promise(function (resolve, reject) {
            function tick() {
                leaiChat.getQuickTake(courseId, scopeKey)
                    .then(function (qt) {
                        if (!qt) {
                            // 404: the row vanished (e.g. deleted). Treat as failure.
                            reject(new Error('QuickTake job not found'));
                            return;
                        }
                        if (onTick) {
                            try { onTick(qt); } catch (_) {}
                        }
                        if (qt.status === 'ready') {
                            resolve(qt);
                            return;
                        }
                        if (qt.status === 'failed') {
                            reject(new Error(qt.error || 'Generation failed'));
                            return;
                        }
                        if (Date.now() - startedAt > timeoutMs) {
                            reject(new Error('Generation timed out'));
                            return;
                        }
                        setTimeout(tick, intervalMs);
                    })
                    .catch(function (err) {
                        if (Date.now() - startedAt > timeoutMs) {
                            reject(err);
                            return;
                        }
                        // Transient fetch error: retry on next tick.
                        setTimeout(tick, intervalMs);
                    });
            }
            tick();
        });
    },
    deleteQuickTake: function(courseId, scopeKey) {
        return leaiChat._fetch(
            '/leai_quicktake/?course_id=' + encodeURIComponent(courseId) +
            '&scope_key=' + encodeURIComponent(scopeKey),
            { method: 'DELETE' },
        );
    },

    exportAsMarkdown: function(session) {
        var lines = ['# ' + session.title, ''];
        (session.messages || []).forEach(function(m) {
            if (m.role === 'system') return;
            lines.push('## ' + (m.role === 'user' ? 'Instructor' : 'LEAI'));
            lines.push('');
            lines.push(m.text);
            lines.push('');
        });
        return lines.join('\n');
    },

    cheapAutoTitle: function(text) {
        var trimmed = text.trim().replace(/\s+/g, ' ');
        if (trimmed.length <= 28) return trimmed;
        var cut = trimmed.slice(0, 28);
        var lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut) + '\u2026';
    },
};

// ---------------------------------------------------------------------------
// leaiInsights \u2014 per-submission instructor insights report (F5) + TTS (F6)
// Spec: LEAI/docs/instructor-clarifications/wk6-form-mode-SPEC.md \u00a79
//
// F5 generates a 350\u2013500-word "data-insights brief" via /openai-chat/ over a
// student's form-mode transcript. F6 plays that brief through OpenAI TTS using
// the openaiKey served by /getOAI/ \u2014 no Heroku change needed (per H3, \u00a71).
// ---------------------------------------------------------------------------
var leaiInsights = (function () {
    'use strict';

    // Engine prefix written by leai-formmode.js \u2014 used to recognize form-mode
    // submissions in FeedbackAnalyzer without needing a survey-mode flag.
    var FORM_PREFIX_RE = /^Area\s+\d+\s+of\s+\d+\s+\u2014\s+/i;

    var ANALYST_SYSTEM_PROMPT = [
        'You are an instructional analyst writing a per-submission insights brief for an instructor reviewing a student\'s structured reflection. You will be given the schema (the reflection areas the bot walked the student through) and the full conversation transcript. The number and titles of areas come from the schema \u2014 do not assume a fixed count. Produce a written brief \u2014 not a grade \u2014 that helps the instructor see what the student actually surfaced.',
        '',
        'OUTPUT FORMAT (strict \u2014 do not deviate):',
        '',
        '# Insights Brief \u2014 [Student name or session id]',
        '',
        '**TL;DR.** One sentence: overall reflection quality (substantive / mixed / thin) + the single most striking finding from THIS student\'s reflection.',
        '',
        '## Per-area findings',
        '',
        'For each area in the schema, in order, ONE bullet shaped as:',
        '- **[Area number] [Area title]:** [finding sentence \u2014 what the student actually said/learned/struggled with]. Evidence: "[verbatim quote from the student, \u2264 25 words, no paraphrase, no [...] elision]"',
        '',
        'If the student\'s response on an area was empty or skipped, write:',
        '- **[Area number] [Area title]:** No substantive response captured. _(Coverage gap.)_',
        '',
        '## Coverage flags',
        '',
        'A bulleted list of every area that was thinly answered, off-topic, or skipped. For each flag, name the area and ONE sentence on what was missing. If coverage was strong everywhere, write "No coverage gaps."',
        '',
        '## Team-process signals',
        '',
        'INCLUDE this section ONLY if the schema contains team-process areas (planning, roles & contributions, collaboration, team health, open team question, team commitment). Otherwise OMIT this section entirely.',
        'When included, write 2 to 3 sentences synthesizing what the conversation revealed about the student\'s TEAM dynamics this week. Be specific \u2014 name moments, contributions, or breakdowns the student described. No grading judgments.',
        '',
        'CONSTRAINTS:',
        '- Total length: 350\u2013500 words. Aim for the middle (~420).',
        '- Tone: analytical, third-person ("the student described\u2026"). NOT casual. NOT advice. NOT grading.',
        '- All quotes are VERBATIM. If you have to shorten, mark with [paraphrased] inline.',
        '- No method-explanations. No comments on the bot\'s behavior.',
        '- This brief will be read aloud by TTS to a busy instructor \u2014 write so it sounds natural when spoken: short sentences, evidenced claims, no jargon stacking.',
    ].join('\n');

    var _reportCache = {};   // sessionId -> { markdown, wordCount }
    var _audioCache = {};    // sessionId+voice -> Blob (URL revoked on regen)
    var _schemaCache = {};   // schemaId -> schema JSON

    function isFormSession(messages) {
        if (!messages || !messages.length) return false;
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            var role = m.sent_by || m.role;
            var text = m.content || m.text || '';
            if (role === 'AI-message' || role === 'assistant') {
                if (FORM_PREFIX_RE.test(String(text).trim())) return true;
            }
        }
        return false;
    }

    function loadSchema(schemaId) {
        if (_schemaCache[schemaId]) return Promise.resolve(_schemaCache[schemaId]);
        // Registry is the sole source of truth (DB-backed, admin-editable).
        // The legacy docs/forms/ JSON fallback was retired with migration 0025.
        return fetch(API + '/form_schemas/' + encodeURIComponent(schemaId) + '/').then(function (r) {
            if (!r.ok) throw new Error('form_schemas registry ' + r.status + ' for ' + schemaId);
            return r.json();
        }).then(function (rec) {
            if (!rec || !rec.body) throw new Error('form_schemas registry returned no body for ' + schemaId);
            _schemaCache[schemaId] = rec.body;
            return rec.body;
        });
    }

    function transcriptToTurns(messages) {
        // messages can be in either FeedbackAnalyzer shape (sent_by + content)
        // or chat history shape (role + text). Normalize and skip system msgs.
        return (messages || []).map(function (m) {
            var role = m.sent_by || m.role;
            var text = m.content || m.text || '';
            var who;
            if (role === 'user-message' || role === 'user') who = 'Student';
            else if (role === 'AI-message' || role === 'assistant') who = 'Remi';
            else return null;
            return { who: who, text: String(text) };
        }).filter(Boolean);
    }

    function buildPayload(schema, messages, ctx) {
        ctx = ctx || {};
        var turns = transcriptToTurns(messages);
        var sectionList = (schema.sections || []).map(function (s, i) {
            return '  Area ' + (i + 1) + ' of ' + schema.sections.length + ' \u2014 ' + s.title;
        }).join('\n');
        var convo = turns.map(function (t) { return t.who + ': ' + t.text; }).join('\n');
        return [
            '=== SCHEMA ===',
            schema.title || schema.schema_id,
            'Course: ' + (schema.course || ''),
            'Instructor: ' + (schema.instructor || ''),
            'Week: ' + (schema.week || ''),
            '',
            'Areas (in order):',
            sectionList,
            '',
            '=== STUDENT ===',
            (ctx.studentName || ctx.sessionId || '(anonymous)'),
            '',
            '=== TRANSCRIPT ===',
            convo,
        ].join('\n');
    }

    function wordCount(text) {
        return (String(text || '').match(/\S+/g) || []).length;
    }

    // Generate the insights brief. Returns { markdown, wordCount }.
    function generateReport(schemaId, messages, ctx) {
        ctx = ctx || {};
        var cacheKey = ctx.sessionId || ('anon-' + (messages && messages.length));
        if (!ctx.force && _reportCache[cacheKey]) {
            return Promise.resolve(_reportCache[cacheKey]);
        }
        return loadSchema(schemaId).then(function (schema) {
            var payload = buildPayload(schema, messages, ctx);
            return leaiChat.chat(payload, {
                chatHistory: [{ role: 'system', content: ANALYST_SYSTEM_PROMPT }],
                temperature: 0.3,
            });
        }).then(function (resp) {
            var markdown = (resp && resp.response ? resp.response : '').trim();
            if (!markdown) throw new Error('empty insights response');
            var entry = { markdown: markdown, wordCount: wordCount(markdown) };
            _reportCache[cacheKey] = entry;
            // Invalidate cached audio for this session \u2014 text changed.
            Object.keys(_audioCache).forEach(function (k) {
                if (k.indexOf(cacheKey + '|') === 0) {
                    try { URL.revokeObjectURL(_audioCache[k].url); } catch (e) {}
                    delete _audioCache[k];
                }
            });
            return entry;
        });
    }

    function getCachedReport(sessionId) {
        return _reportCache[sessionId] || null;
    }

    function clearReport(sessionId) {
        delete _reportCache[sessionId];
        Object.keys(_audioCache).forEach(function (k) {
            if (k.indexOf(sessionId + '|') === 0) {
                try { URL.revokeObjectURL(_audioCache[k].url); } catch (e) {}
                delete _audioCache[k];
            }
        });
    }

    // Strip markdown so TTS reads natural prose, not "asterisk asterisk".
    function stripMarkdown(md) {
        return String(md || '')
            .replace(/^#+\s+/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/^[\-\*]\s+/gm, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // F6 \u2014 Synthesize TTS audio from the insights report. Returns
    // { url, blob, voice }. Audio is cached per (sessionId, voice).
    // Routes through the backend proxy so the OpenAI key never reaches the
    // browser.
    function synthesizeAudio(sessionId, opts) {
        opts = opts || {};
        var voice = opts.voice || 'nova';   // \u00a79 / O5 default
        var entry = _reportCache[sessionId];
        if (!entry) return Promise.reject(new Error('no insights report cached'));

        var cacheKey = sessionId + '|' + voice;
        if (_audioCache[cacheKey]) return Promise.resolve(_audioCache[cacheKey]);

        var spoken = stripMarkdown(entry.markdown);
        return fetch(API + '/openai-tts/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: spoken,
                voice: voice,
                format: 'mp3',
            }),
        }).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) {
                    throw new Error('TTS failed (' + r.status + '): ' + t.slice(0, 200));
                });
            }
            return r.blob();
        }).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var audioEntry = { url: url, blob: blob, voice: voice };
            _audioCache[cacheKey] = audioEntry;
            return audioEntry;
        });
    }

    return {
        FORM_PREFIX_RE: FORM_PREFIX_RE,
        isFormSession: isFormSession,
        loadSchema: loadSchema,
        generateReport: generateReport,
        getCachedReport: getCachedReport,
        clearReport: clearReport,
        synthesizeAudio: synthesizeAudio,
        stripMarkdown: stripMarkdown,
    };
})();

// ---------------------------------------------------------------------------
// leaiMarkdown — lightweight Markdown → HTML for chat messages
// Handles: **bold**, *italic*, `code`, - / * unordered lists, 1. ordered lists,
// line breaks, and paragraphs. Strips extra whitespace around block elements.
// ---------------------------------------------------------------------------
var leaiMarkdown = {
    /**
     * Convert a Markdown string to sanitised HTML.
     * Only a safe subset of inline/block Markdown is supported.
     */
    render: function (md) {
        if (!md) return '';

        // Normalise line endings
        var lines = md.replace(/\r\n?/g, '\n').split('\n');
        var html = [];
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            // Blank line → close current context, skip
            if (line.trim() === '') { i++; continue; }

            // Unordered list (- or * at start)
            if (/^\s*[-*]\s+/.test(line)) {
                html.push('<ul>');
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                    html.push('<li>' + leaiMarkdown._inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>');
                    i++;
                }
                html.push('</ul>');
                continue;
            }

            // Ordered list (1. 2. etc)
            if (/^\s*\d+[.)]\s+/.test(line)) {
                html.push('<ol>');
                while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
                    html.push('<li>' + leaiMarkdown._inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
                    i++;
                }
                html.push('</ol>');
                continue;
            }

            // Regular paragraph — collect consecutive non-blank, non-list lines
            var para = [];
            while (i < lines.length && lines[i].trim() !== '' &&
                   !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) {
                para.push(lines[i]);
                i++;
            }
            html.push('<p>' + leaiMarkdown._inline(para.join(' ')) + '</p>');
        }

        return html.join('');
    },

    /** Convert inline Markdown (bold, italic, code) to HTML. Text is escaped first. */
    _inline: function (text) {
        // Escape HTML entities
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // `code`
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        // **bold**
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // *italic* (but not inside **)
        text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        return text;
    },
};

// ===== LEAI SPEECH (mic dictation -> text) =====
// Two-tier dictation:
//   1. If the browser exposes the Web Speech API (Chrome/Edge/Safari), use it
//      for *live* in-place transcription — interim results appear in the
//      target input as the user talks.
//   2. Otherwise (or if Web Speech fails), fall back to MediaRecorder ->
//      backend Whisper proxy (/openai-stt/) and insert the final transcript
//      after stop. The OpenAI key never leaves the server.
//
//   leaiSpeech.attachMicButton({
//       buttonEl: document.getElementById('mic-btn'),
//       targetEl: document.getElementById('messageInput'),
//       language: 'en-US',                 // optional BCP-47 / ISO-639-1
//       prompt: 'mid-course feedback',     // optional bias prompt for Whisper
//       onStart, onStop, onError, onText, onInterim,
//   });
const leaiSpeech = (function () {
    var DEBUG = true;
    function log() {
        if (!DEBUG || typeof console === 'undefined') return;
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[leaiSpeech]');
            console.log.apply(console, args);
        } catch (e) {}
    }

    var SpeechRecognitionImpl = (typeof window !== 'undefined') && (
        window.SpeechRecognition || window.webkitSpeechRecognition
    );

    // Singletons enforced across the whole page. Chrome only allows ONE active
    // SpeechRecognition per origin — when the page swaps modes (e.g. wipes the
    // DOM and rebuilds the in-group view), the previous recognizer keeps
    // holding the mic and silently aborts the new one. We track the active
    // recognizer here and abort it before starting a new one. We also track
    // every active controller so callers can stop them all on mode change.
    var activeRecognizer = null;
    var activeControllers = [];

    function abortActiveRecognizer() {
        if (!activeRecognizer) return;
        try { activeRecognizer.abort(); }
        catch (e) {
            try { activeRecognizer.stop(); } catch (e2) {}
        }
        activeRecognizer = null;
    }

    // -------- mime selection (MediaRecorder) --------
    function pickMime() {
        if (typeof MediaRecorder === 'undefined') return null;
        var prefs = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/ogg;codecs=opus',
        ];
        for (var i = 0; i < prefs.length; i++) {
            try { if (MediaRecorder.isTypeSupported(prefs[i])) return prefs[i]; }
            catch (e) {}
        }
        return '';
    }

    // Strip ";codecs=..." — OpenAI's Whisper rejects mime strings with
    // codec parameters even though the underlying container is supported.
    function baseMime(mime) {
        if (!mime) return 'audio/webm';
        return String(mime).split(';')[0].trim().toLowerCase() || 'audio/webm';
    }

    function extFor(mime) {
        var base = baseMime(mime);
        if (base.indexOf('webm') !== -1) return 'webm';
        if (base.indexOf('mp4') !== -1) return 'mp4';
        if (base.indexOf('ogg') !== -1) return 'ogg';
        if (base.indexOf('wav') !== -1) return 'wav';
        if (base.indexOf('mpeg') !== -1) return 'mp3';
        return 'webm';
    }

    // Whisper has issues with very short clips (<1s) — surface a friendly
    // error rather than the opaque "could not be decoded".
    var MIN_RECORDING_BYTES = 4 * 1024;

    // -------- support detection --------
    function isWhisperSupported() {
        return typeof MediaRecorder !== 'undefined'
            && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
    function isLiveSupported() {
        return !!SpeechRecognitionImpl;
    }
    function isSupported() {
        return isLiveSupported() || isWhisperSupported();
    }

    // -------- post-stop Whisper transcription --------
    function transcribe(blob, opts) {
        opts = opts || {};
        var mime = baseMime(blob.type);
        var ext = extFor(blob.type);
        var fd = new FormData();
        // Re-wrap so the part's Content-Type is the codec-free base mime
        // and the filename extension matches it. Whisper validates both.
        var clean = new Blob([blob], { type: mime });
        fd.append('file', clean, 'audio.' + ext);
        if (opts.language) fd.append('language', opts.language.split('-')[0]);
        if (opts.prompt) fd.append('prompt', opts.prompt);
        if (opts.model) fd.append('model', opts.model);

        return fetch(API + '/openai-stt/', { method: 'POST', body: fd })
            .then(function (r) {
                return r.json().then(function (data) {
                    if (!r.ok) {
                        var msg = (data && data.error) || ('STT failed (' + r.status + ')');
                        throw new Error(msg);
                    }
                    return data.text || '';
                });
            });
    }

    // -------- target text insertion --------
    // Session-based model: a single contiguous region of the textarea is
    // owned by the current dictation session. Each onresult rebuilds the
    // *entire* transcript from event.results and replaces the session region
    // in one shot. This avoids Chrome's "progressive finals" problem where a
    // single utterance is split across multiple final results — committing
    // each one separately would concatenate them with leading-space
    // separators, producing output like "now now I now I think...".
    //
    // API:
    //   replaceSession(text)  — set the live region to `text`. Anchors at the
    //                           caret on first call; replaces in place after.
    //   endSession([finalize=true]) — drop the live tint and release the
    //                           anchor. Existing text in the region stays put
    //                           and becomes part of the textarea's value.
    //                           If finalize=false, the region is removed
    //                           (used for hard errors / cancellations).
    //   reset()               — alias for endSession(false).
    //   insertAt Caret(text)  — used by Whisper path (no live region).
    function makeInserter(target) {
        var sessionAnchor = null;
        var sessionLength = 0;
        var isTextField = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

        function dispatchInput() {
            target.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function ensureAnchor() {
            if (sessionAnchor !== null) return true;
            if (!isTextField) return false;
            var s = (typeof target.selectionStart === 'number')
                ? target.selectionStart : (target.value || '').length;
            var v = target.value || '';
            var pre = v.slice(0, s);
            var sep = (pre && !/\s$/.test(pre)) ? ' ' : '';
            target.value = pre + sep + v.slice(s);
            sessionAnchor = s + sep.length;
            sessionLength = 0;
            target.classList.add('leai-dictating');
            return true;
        }

        function replaceSession(text) {
            text = text || '';
            if (!isTextField) {
                // Non-input targets (rare) — just append the latest text.
                target.value = (target.value || '') + (text ? ' ' + text : '');
                dispatchInput();
                return;
            }
            if (!ensureAnchor()) return;
            var v = target.value || '';
            target.value = v.slice(0, sessionAnchor) + text + v.slice(sessionAnchor + sessionLength);
            sessionLength = text.length;
            try {
                var caret = sessionAnchor + sessionLength;
                target.setSelectionRange(caret, caret);
            } catch (e) {}
            dispatchInput();
        }

        function endSession(finalize) {
            if (finalize !== false) finalize = true;
            if (!finalize && sessionAnchor !== null && isTextField) {
                // Cancel: remove the in-progress region from the textarea.
                var v = target.value || '';
                target.value = v.slice(0, sessionAnchor) + v.slice(sessionAnchor + sessionLength);
            }
            sessionAnchor = null;
            sessionLength = 0;
            target.classList.remove('leai-dictating');
        }

        function reset() { endSession(false); }

        // Used only by the Whisper engine, which has no live region — drop
        // the final transcript at the current caret.
        function insertAtCaret(text) {
            if (!text) return;
            if (!isTextField) {
                target.value = (target.value || '') + ' ' + text;
                dispatchInput();
                return;
            }
            var s = (typeof target.selectionStart === 'number')
                ? target.selectionStart : (target.value || '').length;
            var v = target.value || '';
            var pre = v.slice(0, s);
            var post = v.slice(s);
            var sep = (pre && !/\s$/.test(pre)) ? ' ' : '';
            target.value = pre + sep + text + post;
            var caret = (pre + sep + text).length;
            try { target.setSelectionRange(caret, caret); } catch (e) {}
            dispatchInput();
        }

        return {
            replaceSession: replaceSession,
            endSession: endSession,
            reset: reset,
            insertAtCaret: insertAtCaret,
        };
    }

    // ============================================================
    // Engine A — Web Speech API (live, in-place interim transcripts)
    // ============================================================
    // Chrome auto-ends a 'continuous' recognizer after ~60s or a few seconds
    // of silence, even if the user is still talking. We track user intent
    // (`ctx.userRecording`) separately from the recognizer's actual lifetime
    // and silently restart the recognizer on premature ends so dictation
    // looks unbroken to the user.
    var WEB_SPEECH_MAX_RUN_MS = 5 * 60 * 1000;   // hard ceiling per dictation
    var WEB_SPEECH_RESTART_DEBOUNCE_MS = 250;    // back-off between restarts
    var WEB_SPEECH_MAX_RAPID_RESTARTS = 40;      // safety cap

    // Whitespace-collapse the SpeechRecognition transcripts into a clean
    // single-spaced string. Handles Chrome's habit of inserting double spaces
    // when concatenating multiple result entries.
    function joinTranscripts(results) {
        var s = '';
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var t = (r[0] && r[0].transcript) ? r[0].transcript : '';
            s += t;
        }
        return s.replace(/\s+/g, ' ').trim();
    }

    function buildRecognizer(opts, ctx) {
        var rec = new SpeechRecognitionImpl();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        if (opts.language) {
            // Web Speech wants BCP-47; accept ISO-639-1 too ('en' -> 'en-US').
            rec.lang = (/-/).test(opts.language) ? opts.language
                : (opts.language === 'en' ? 'en-US' : opts.language);
        }

        // Each onresult rebuilds the FULL transcript from event.results and
        // replaces the live session region in one shot. This handles every
        // Chrome quirk (progressive finals, cumulative interims, results that
        // get re-emitted) because we never accumulate state across events —
        // the textarea always reflects the recognizer's current view of the
        // full session transcript.
        rec.onresult = function (event) {
            ctx._gotAnyResultThisSession = true;
            var fullText = joinTranscripts(event.results);
            // Keep track of how much of the session has been finalised so we
            // can lock that prefix in if the recognizer auto-ends.
            var allFinal = true;
            for (var i = 0; i < event.results.length; i++) {
                if (!event.results[i].isFinal) { allFinal = false; break; }
            }
            log(allFinal ? 'final:' : 'interim:', JSON.stringify(fullText));
            ctx._sessionFinalText = allFinal ? fullText : (ctx._sessionFinalText || '');
            ctx._sessionLatestText = fullText;
            ctx.inserter.replaceSession(fullText);
            if (allFinal && opts.onText) opts.onText(fullText);
            if (!allFinal && opts.onInterim) opts.onInterim(fullText);
        };

        rec.onaudiostart  = function () { log('audiostart'); };
        rec.onsoundstart  = function () { log('soundstart'); };
        rec.onspeechstart = function () { log('speechstart'); };
        rec.onspeechend   = function () { log('speechend'); };

        rec.onerror = function (e) {
            log('error:', e && e.error, e && e.message);
            // 'aborted' & 'no-speech' are benign; onend decides what to do.
            if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
                ctx.userRecording = false;
                ctx.inserter.endSession(true);
                if (opts.onError) opts.onError(new Error('Microphone permission denied.'));
            } else if (e && (e.error === 'network' || e.error === 'audio-capture')) {
                ctx.userRecording = false;
                ctx._oneShotWhisper = true;
                ctx.inserter.endSession(false);
                if (opts.onError) opts.onError(new Error(
                    'Live dictation unavailable (' + e.error + ') — using recorded transcription this time.'
                ));
            } else if (opts.onError && e && e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
                if (opts.onError) opts.onError(new Error('Live dictation error: ' + e.error));
            }
        };

        rec.onend = function () {
            log('end (userRecording=' + ctx.userRecording + ', got=' + ctx._gotAnyResultThisSession + ')');
            if (activeRecognizer === rec) activeRecognizer = null;
            ctx.recognizer = null;

            // User stop / hard error / 5-min ceiling → finalise + emit onStop.
            var stoppedIntentionally = !ctx.userRecording
                || (Date.now() - (ctx._sessionStartedAt || 0)) >= WEB_SPEECH_MAX_RUN_MS;
            if (stoppedIntentionally) {
                ctx.userRecording = false;
                ctx.inserter.endSession(true);
                ctx.setRecording(false);
                ctx._restartCount = 0;
                if (opts.onStop) opts.onStop(null);
                return;
            }

            // Browser auto-ended mid-dictation. Lock in whatever we've got so
            // far as final committed text (so it doesn't get replaced by the
            // next session's transcript), then spawn a new recognizer that
            // will start a fresh session region after it.
            ctx._restartCount = (ctx._restartCount || 0) + 1;
            if (ctx._restartCount > WEB_SPEECH_MAX_RAPID_RESTARTS) {
                log('too many rapid restarts — giving up');
                ctx.userRecording = false;
                ctx.inserter.endSession(true);
                ctx.setRecording(false);
                ctx._restartCount = 0;
                if (opts.onError) opts.onError(new Error(
                    'Dictation kept dropping — please try again.'
                ));
                if (opts.onStop) opts.onStop(null);
                return;
            }
            log('auto-restarting (#' + ctx._restartCount + ')');
            // Lock in whatever the recognizer last gave us — even if not all
            // results were final, it's the user's best transcript so far.
            ctx.inserter.endSession(true);
            ctx._sessionFinalText = '';
            ctx._sessionLatestText = '';
            ctx._gotAnyResultThisSession = false;
            setTimeout(function () {
                if (!ctx.userRecording) return;
                spawnRecognizer(opts, ctx);
            }, WEB_SPEECH_RESTART_DEBOUNCE_MS);
        };

        return rec;
    }

    function spawnRecognizer(opts, ctx) {
        abortActiveRecognizer();
        var rec;
        try { rec = buildRecognizer(opts, ctx); }
        catch (e) {
            log('buildRecognizer threw:', e && e.message);
            ctx.userRecording = false;
            if (opts.onError) opts.onError(e);
            return null;
        }
        try { rec.start(); }
        catch (e) {
            log('start() threw:', e && e.message);
            // InvalidStateError can fire if a previous recognizer hadn't
            // fully released. Retry once after a short delay.
            setTimeout(function () {
                if (!ctx.userRecording) return;
                try {
                    var rec2 = buildRecognizer(opts, ctx);
                    rec2.start();
                    activeRecognizer = rec2;
                    ctx.recognizer = rec2;
                } catch (e2) {
                    ctx.userRecording = false;
                    ctx.setRecording(false);
                    if (opts.onError) opts.onError(e2);
                }
            }, 300);
            return null;
        }
        activeRecognizer = rec;
        ctx.recognizer = rec;
        return rec;
    }

    function startWebSpeech(opts, ctx) {
        // Free any leftover recognizer from a prior page state (e.g. the
        // main-mode mic was active when the in-group view wiped the DOM).
        abortActiveRecognizer();

        ctx.userRecording = true;
        ctx._sessionStartedAt = Date.now();
        ctx._restartCount = 0;
        ctx._gotAnyResultThisSession = false;

        var rec = spawnRecognizer(opts, ctx);
        if (!rec) return null;
        ctx.setRecording(true);
        log('started Web Speech (' + (rec.lang || 'default') + ')');
        if (opts.onStart) opts.onStart();
        return rec;
    }

    // ============================================================
    // Engine B — MediaRecorder + backend Whisper (post-stop)
    // ============================================================
    function startWhisper(opts, ctx) {
        return navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (s) {
                ctx.stream = s;
                var mime = pickMime();
                var recorder;
                try {
                    recorder = mime
                        ? new MediaRecorder(s, { mimeType: mime })
                        : new MediaRecorder(s);
                } catch (e) {
                    recorder = new MediaRecorder(s);
                }
                ctx.recorder = recorder;
                ctx.chunks = [];

                recorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) ctx.chunks.push(ev.data);
                };
                recorder.onstop = function () {
                    var type = baseMime((ctx.recorder && ctx.recorder.mimeType) || pickMime());
                    var blob = new Blob(ctx.chunks, { type: type });
                    ctx.chunks = [];
                    ctx.cleanupStream();
                    ctx.setRecording(false);
                    if (!blob.size || blob.size < MIN_RECORDING_BYTES) {
                        var err = new Error('Recording too short — please hold the mic longer.');
                        if (opts.onError) opts.onError(err);
                        return;
                    }
                    if (opts.onStop) opts.onStop(blob);
                    transcribe(blob, opts).then(function (text) {
                        // Whisper has no live region — drop the final
                        // transcript at the textarea caret directly.
                        ctx.inserter.insertAtCaret(text);
                        if (opts.onText) opts.onText(text);
                    }).catch(function (err) {
                        if (opts.onError) opts.onError(err);
                        else console.error('STT error:', err);
                    });
                };
                // Use a timeslice so Chrome flushes data periodically — without
                // it the EBML container occasionally lacks duration metadata,
                // which causes Whisper to 400 with "could not be decoded".
                try { recorder.start(250); } catch (e) { recorder.start(); }
                ctx.setRecording(true);
                if (opts.onStart) opts.onStart();
            })
            .catch(function (err) {
                ctx.cleanupStream();
                ctx.setRecording(false);
                if (opts.onError) opts.onError(err);
                throw err;
            });
    }

    // -------- public: attachMicButton --------
    function attachMicButton(opts) {
        opts = opts || {};
        var btn = opts.buttonEl;
        var target = opts.targetEl;
        if (!btn) throw new Error('attachMicButton: buttonEl required');

        var ctx = {
            stream: null,
            recorder: null,
            recognizer: null,
            chunks: [],
            recording: false,
            inserter: makeInserter(target),
            cleanupStream: function () {
                if (ctx.stream) {
                    try { ctx.stream.getTracks().forEach(function (t) { t.stop(); }); }
                    catch (e) {}
                    ctx.stream = null;
                }
            },
            setRecording: function (on) {
                ctx.recording = on;
                btn.classList.toggle('is-recording', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            },
        };

        var mode = (opts.mode || 'auto');  // 'live' | 'whisper' | 'auto'

        function shouldUseLive() {
            if (mode === 'whisper') return false;
            if (mode === 'live') return isLiveSupported();
            // auto: always prefer live when supported. One-shot Whisper
            // fallback (set by network/audio-capture errors) applies only to
            // the very next start; we clear it once consumed below.
            if (ctx._oneShotWhisper) return false;
            return isLiveSupported();
        }

        function start() {
            if (ctx.recording) return Promise.resolve();
            var live = shouldUseLive();
            // Consume the one-shot fallback flag so the click after this one
            // returns to Web Speech.
            ctx._oneShotWhisper = false;
            if (live) {
                log('attach: using Web Speech (live)');
                startWebSpeech(opts, ctx);
                return Promise.resolve();
            }
            if (isWhisperSupported()) {
                log('attach: using MediaRecorder + Whisper (post-stop)');
                return startWhisper(opts, ctx);
            }
            var err = new Error('Microphone recording is not supported in this browser.');
            if (opts.onError) opts.onError(err);
            return Promise.reject(err);
        }

        function stop() {
            if (!ctx.recording) return;
            if (ctx.recognizer) {
                // Tell the auto-restart loop in onend that this stop was
                // user-initiated, so the recognizer doesn't immediately respawn.
                ctx.userRecording = false;
                try { ctx.recognizer.stop(); }
                catch (e) {
                    // stop() threw — finalise the session so the user keeps
                    // whatever text they've already dictated.
                    ctx.inserter.endSession(true);
                    ctx.setRecording(false);
                }
                return;
            }
            if (ctx.recorder) {
                try { ctx.recorder.stop(); }
                catch (e) {
                    ctx.cleanupStream();
                    ctx.setRecording(false);
                }
            }
        }

        function toggle() {
            if (ctx.recording) stop();
            else start().catch(function () {});
        }

        btn.addEventListener('click', toggle);

        function destroy() {
            ctx.userRecording = false;   // suppress any auto-restart in onend
            stop();
            // Hard abort if Web Speech is still active in the background
            // (e.g. caller wipes the DOM and forgets to await stop()).
            if (ctx.recognizer) {
                try { ctx.recognizer.abort(); } catch (e) {}
                ctx.recognizer = null;
            }
            // Keep whatever text the user already dictated; just drop the
            // dictating tint and release the anchor.
            ctx.inserter.endSession(true);
            ctx.setRecording(false);
            btn.removeEventListener('click', toggle);
            ctx.cleanupStream();
            var idx = activeControllers.indexOf(controller);
            if (idx !== -1) activeControllers.splice(idx, 1);
        }

        // Flush the current dictation context without stopping the mic.
        //
        // After the host page sends a message and clears the input, the
        // SpeechRecognition keeps running (continuous = true) and its
        // event.results list still contains every prior result. The next
        // onresult would replay "message A message B" into the cleared
        // textarea. resetSession() drops the inserter's session anchor and
        // aborts the recognizer; onend's existing auto-restart path then
        // spawns a fresh one with a clean results list.
        function resetSession() {
            log('resetSession (recording=' + ctx.recording + ')');
            ctx.inserter.endSession(true);
            ctx._sessionFinalText = '';
            ctx._sessionLatestText = '';
            ctx._gotAnyResultThisSession = false;
            // Explicit Sends mustn't accumulate towards the rapid-restart
            // safety cap — the user could legitimately Send 40+ times in a
            // long survey conversation.
            ctx._restartCount = 0;

            if (!ctx.userRecording || !ctx.recognizer) return;
            try { ctx.recognizer.abort(); }
            catch (e) { try { ctx.recognizer.stop(); } catch (e2) {} }
            // onend will fire shortly and, because userRecording is still
            // true, auto-restart will spawn a fresh recognizer. Its
            // event.results list starts empty.
        }

        var controller = {
            start: start,
            stop: stop,
            destroy: destroy,
            resetSession: resetSession,
            isRecording: function () { return ctx.recording; },
            getMode: function () { return shouldUseLive() ? 'live' : 'whisper'; },
        };
        activeControllers.push(controller);
        return controller;
    }

    // Stop and detach every controller created by attachMicButton — call this
    // before tearing down the DOM (e.g. document.body.textContent = '') so the
    // OS mic is released before a new view tries to claim it.
    function destroyAll() {
        log('destroyAll (' + activeControllers.length + ' controllers)');
        // Snapshot before iterating since destroy() mutates the array.
        var snapshot = activeControllers.slice();
        for (var i = 0; i < snapshot.length; i++) {
            try { snapshot[i].destroy(); } catch (e) {}
        }
        abortActiveRecognizer();
    }

    return {
        isSupported: isSupported,
        isLiveSupported: isLiveSupported,
        isWhisperSupported: isWhisperSupported,
        transcribe: transcribe,
        attachMicButton: attachMicButton,
        destroyAll: destroyAll,
    };
})();

// ===== TEAMS API (in-group feedback) =====
// Phase 1 uses a mock backed by localStorage so the full UX can be demoed
// before Django endpoints exist. When backend ships, set USE_MOCK=false and
// the fetch() paths take over. Shapes match the backend contract doc 1:1.
const leaiTeamsApi = (function () {
    // Backend is now wired end-to-end. Flip back to true only if you need to
    // run the UI in a no-backend fallback (localStorage-only) for demos.
    const USE_MOCK = false;
    const K_CONFIGS = 'leai.mock.teamConfigurations';
    const K_SNAPSHOTS = 'leai.mock.surveyTeamSnapshots';
    const K_ASSIGNMENTS = 'leai.mock.sessionTeamAssignments';

    // Palette cycled through when auto-assigning colors to new team configurations.
    // Adjacent slots sit opposite on the color wheel so back-to-back configs look
    // clearly different, not like variants of the same hue. Cycles back at #9.
    const CONFIG_COLOR_PALETTE = ['forest', 'plum', 'amber', 'teal', 'rose', 'indigo', 'brown', 'slate'];
    function colorForIndex(idx) {
        return CONFIG_COLOR_PALETTE[idx % CONFIG_COLOR_PALETTE.length];
    }
    function pickNextConfigColor(existingConfigs) {
        // Choose the first palette slot not already in use among siblings; if all
        // 8 slots are taken, wrap around by count.
        const used = existingConfigs.map(function (c) { return c.color; });
        for (let i = 0; i < CONFIG_COLOR_PALETTE.length; i++) {
            if (used.indexOf(CONFIG_COLOR_PALETTE[i]) === -1) return CONFIG_COLOR_PALETTE[i];
        }
        return colorForIndex(existingConfigs.length);
    }
    function dedupeName(name, existingNames) {
        if (existingNames.indexOf(name) === -1) return name;
        let n = 2;
        while (existingNames.indexOf(name + ' ' + n) !== -1) n++;
        return name + ' ' + n;
    }

    function _read(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }
    function _write(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    function _nextId(collection) {
        return (collection.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0)) + 1;
    }

    function listTeamConfigurations(courseId, opts) {
        opts = opts || {};
        if (USE_MOCK) {
            const all = _read(K_CONFIGS, []);
            // Per-course migration: reassign every config's color by creation order
            // using the current palette. Guarantees adjacent configs get maximally
            // distinct hues and that a palette redesign visually propagates to
            // existing mock data without requiring users to clear storage.
            let dirty = false;
            const byCourse = {};
            all.forEach(function (c) {
                (byCourse[c.courseId] = byCourse[c.courseId] || []).push(c);
            });
            Object.keys(byCourse).forEach(function (cid) {
                const siblings = byCourse[cid].slice().sort(function (a, b) {
                    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
                });
                siblings.forEach(function (c, i) {
                    const want = colorForIndex(i);
                    if (c.color !== want) { c.color = want; dirty = true; }
                });
            });
            if (dirty) _write(K_CONFIGS, all);
            return Promise.resolve(all.filter(function (c) {
                return c.courseId === courseId && (opts.includeArchived || !c.archived);
            }));
        }
        var q = new URLSearchParams({ course_id: String(courseId) });
        if (opts.includeArchived) q.set('include_archived', '1');
        return fetch(API + '/team_configurations/?' + q.toString())
            .then(function (r) { return r.json(); });
    }

    function createTeamConfiguration(courseId, payload) {
        if (USE_MOCK) {
            const all = _read(K_CONFIGS, []);
            const siblings = all.filter(function (c) { return c.courseId === courseId && !c.archived; });
            const siblingNames = siblings.map(function (c) { return c.name; });
            const config = {
                id: _nextId(all),
                courseId: courseId,
                name: dedupeName(payload.name, siblingNames),
                label_prefix: payload.label_prefix,
                color: payload.color || pickNextConfigColor(siblings),
                teams: payload.teams.map(function (t, i) {
                    return { id: Date.now() * 10 + i, number: t.number, size: t.size };
                }),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                archived: false,
            };
            all.push(config);
            _write(K_CONFIGS, all);
            return Promise.resolve(config);
        }
        return fetch(API + '/team_configurations/create/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ course_id: courseId }, payload)),
        }).then(function (r) { return r.json(); });
    }

    function updateTeamConfiguration(configId, patch) {
        if (USE_MOCK) {
            const all = _read(K_CONFIGS, []);
            const idx = all.findIndex(function (c) { return c.id === configId; });
            if (idx === -1) return Promise.reject(new Error('not found'));
            const current = all[idx];
            // When teams array is replaced, regenerate team ids for new entries
            if (patch.teams) {
                const oldByNumber = {};
                current.teams.forEach(function (t) { oldByNumber[t.number] = t; });
                patch.teams = patch.teams.map(function (t, i) {
                    const existing = oldByNumber[t.number];
                    return {
                        id: existing ? existing.id : Date.now() * 10 + i,
                        number: t.number, size: t.size,
                    };
                });
            }
            // Dedupe name against siblings if renaming
            if (patch.name && patch.name !== current.name) {
                const siblingNames = all
                    .filter(function (c) { return c.courseId === current.courseId && c.id !== configId && !c.archived; })
                    .map(function (c) { return c.name; });
                patch.name = dedupeName(patch.name, siblingNames);
            }
            all[idx] = Object.assign({}, current, patch, { updated_at: new Date().toISOString() });
            _write(K_CONFIGS, all);
            return Promise.resolve(all[idx]);
        }
        return fetch(API + '/team_configurations/update/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ id: configId }, patch)),
        }).then(function (r) { return r.json(); });
    }

    function archiveTeamConfiguration(configId) {
        if (USE_MOCK) return updateTeamConfiguration(configId, { archived: true });
        return fetch(API + '/team_configurations/archive/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: configId }),
        }).then(function (r) { return r.json(); });
    }

    function deleteTeamConfiguration(configId) {
        if (USE_MOCK) {
            const snaps = _read(K_SNAPSHOTS, []);
            if (snaps.some(function (s) { return s.source_configuration_id === configId; })) {
                return Promise.reject(new Error('configuration is referenced by surveys; archive instead'));
            }
            const all = _read(K_CONFIGS, []).filter(function (c) { return c.id !== configId; });
            _write(K_CONFIGS, all);
            return Promise.resolve({ ok: true });
        }
        return fetch(API + '/team_configurations/delete/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: configId }),
        }).then(function (r) {
            return r.json().then(function (body) {
                if (!r.ok) throw new Error(body.error || 'delete failed');
                return body;
            });
        });
    }

    function createSurveyTeamSnapshot(surveyId, sourceConfigId) {
        if (USE_MOCK) {
            const configs = _read(K_CONFIGS, []);
            const src = configs.find(function (c) { return c.id === sourceConfigId; });
            if (!src) return Promise.reject(new Error('source config not found'));
            const snaps = _read(K_SNAPSHOTS, []);
            const snap = {
                id: _nextId(snaps),
                survey_id: surveyId,
                source_configuration_id: src.id,
                name: src.name,
                label_prefix: src.label_prefix,
                color: src.color || 'forest',
                teams: src.teams.map(function (t) {
                    return { id: t.id, number: t.number, size: t.size };
                }),
                created_at: new Date().toISOString(),
            };
            snaps.push(snap);
            _write(K_SNAPSHOTS, snaps);
            return Promise.resolve(snap);
        }
        return Promise.resolve(null);
    }

    function getSurveyTeamSnapshot(surveyIdOrPublicId) {
        if (USE_MOCK) {
            const snaps = _read(K_SNAPSHOTS, []);
            const snap = snaps.find(function (s) { return String(s.survey_id) === String(surveyIdOrPublicId); });
            return Promise.resolve(snap || null);
        }
        // The caller may pass either a numeric survey id or a public_id string.
        // The backend accepts both via query param.
        var sid = String(surveyIdOrPublicId || '');
        var isNumeric = /^\d+$/.test(sid);
        var q = new URLSearchParams();
        q.set(isNumeric ? 'survey_id' : 'public_id', sid);
        return fetch(API + '/survey_team_snapshot/?' + q.toString())
            .then(function (r) {
                if (r.status === 404) return null;
                return r.json();
            });
    }

    function assignSessionToTeam(sessionId, surveyTeamId) {
        if (USE_MOCK) {
            const all = _read(K_ASSIGNMENTS, []);
            const existing = all.find(function (a) { return a.session_id === sessionId; });
            if (existing) {
                existing.survey_team_id = surveyTeamId;
                existing.assigned_at = new Date().toISOString();
            } else {
                all.push({
                    id: _nextId(all),
                    session_id: sessionId,
                    survey_team_id: surveyTeamId,
                    assigned_at: new Date().toISOString(),
                });
            }
            _write(K_ASSIGNMENTS, all);
            return Promise.resolve({ ok: true });
        }
        return fetch(API + '/session_team_assignment/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, survey_team_id: surveyTeamId }),
        }).then(function (r) { return r.json(); });
    }

    function listAssignmentsForSurvey(surveyIdOrPublicId) {
        if (USE_MOCK) {
            const snap = _read(K_SNAPSHOTS, [])
                .find(function (s) { return String(s.survey_id) === String(surveyIdOrPublicId); });
            if (!snap) return Promise.resolve([]);
            const teamIds = snap.teams.map(function (t) { return t.id; });
            const all = _read(K_ASSIGNMENTS, [])
                .filter(function (a) { return teamIds.indexOf(a.survey_team_id) !== -1; });
            return Promise.resolve(all);
        }
        var sid = String(surveyIdOrPublicId || '');
        var isNumeric = /^\d+$/.test(sid);
        var q = new URLSearchParams();
        q.set(isNumeric ? 'survey_id' : 'public_id', sid);
        return fetch(API + '/survey_team_assignments/?' + q.toString())
            .then(function (r) { return r.json(); });
    }

    // Mock-only surveys (phase 1 only — real backend uses create_new_gpt/).
    // This section provides the CRUD + housekeeping endpoints that PromptDesigner's
    // right-column "Your In-Group Surveys" list needs. When USE_MOCK flips to false,
    // these should be replaced with calls to the corresponding real endpoints.
    function listMockInGroupSurveys() {
        return _read('leai.mock.surveys', []);
    }
    function saveMockInGroupSurvey(survey) {
        const all = _read('leai.mock.surveys', []);
        all.push(survey);
        _write('leai.mock.surveys', all);
    }
    function getMockInGroupSurvey(surveyId) {
        return _read('leai.mock.surveys', [])
            .find(function (s) { return String(s.id) === String(surveyId); }) || null;
    }
    function updateMockInGroupSurvey(surveyId, patch) {
        const all = _read('leai.mock.surveys', []);
        const idx = all.findIndex(function (s) { return String(s.id) === String(surveyId); });
        if (idx === -1) return Promise.reject(new Error('survey not found'));
        all[idx] = Object.assign({}, all[idx], patch, { updated_at: new Date().toISOString() });
        _write('leai.mock.surveys', all);
        return Promise.resolve(all[idx]);
    }
    function deleteMockInGroupSurvey(surveyId) {
        // Cascade: remove survey, its snapshot, session assignments referencing that
        // snapshot's SurveyTeams, and the chat log.
        const surveys = _read('leai.mock.surveys', [])
            .filter(function (s) { return String(s.id) !== String(surveyId); });
        _write('leai.mock.surveys', surveys);

        const snaps = _read(K_SNAPSHOTS, []);
        const removedSnap = snaps.find(function (s) { return String(s.survey_id) === String(surveyId); });
        const remainingSnaps = snaps.filter(function (s) { return String(s.survey_id) !== String(surveyId); });
        _write(K_SNAPSHOTS, remainingSnaps);

        if (removedSnap) {
            const teamIds = removedSnap.teams.map(function (t) { return t.id; });
            const remainingAssignments = _read(K_ASSIGNMENTS, [])
                .filter(function (a) { return teamIds.indexOf(a.survey_team_id) === -1; });
            _write(K_ASSIGNMENTS, remainingAssignments);
        }

        try { localStorage.removeItem('leai.mock.chatLog.' + surveyId); } catch (e) {}
        return Promise.resolve({ ok: true });
    }
    function duplicateMockInGroupSurvey(surveyId) {
        const src = getMockInGroupSurvey(surveyId);
        if (!src) return Promise.reject(new Error('survey not found'));
        const newId = Date.now();
        const copy = Object.assign({}, src, {
            id: newId,
            label: (src.label || 'Untitled') + ' (copy)',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_closed: false,
        });
        saveMockInGroupSurvey(copy);
        // Create a fresh snapshot cloned from the same source configuration, so the
        // duplicate sees current team sizes / colors.
        return createSurveyTeamSnapshot(newId, src.team_configuration_id)
            .then(function () { return copy; });
    }
    function setMockInGroupSurveyStatus(surveyId, action) {
        const patch = (action === 'close') ? { is_closed: true } : { is_closed: false };
        return updateMockInGroupSurvey(surveyId, patch);
    }
    function exportMockInGroupSurveys(courseId) {
        // Bundle surveys + their snapshots + assignments so a round-trip import
        // recovers the full analyzer view.
        const surveys = _read('leai.mock.surveys', [])
            .filter(function (s) { return String(s.courseId) === String(courseId); });
        const surveyIds = surveys.map(function (s) { return String(s.id); });
        const snaps = _read(K_SNAPSHOTS, [])
            .filter(function (s) { return surveyIds.indexOf(String(s.survey_id)) !== -1; });
        const teamIds = snaps.reduce(function (acc, s) {
            return acc.concat(s.teams.map(function (t) { return t.id; }));
        }, []);
        const assignments = _read(K_ASSIGNMENTS, [])
            .filter(function (a) { return teamIds.indexOf(a.survey_team_id) !== -1; });
        return {
            version: 1,
            kind: 'leai.in-group-surveys',
            courseId: courseId,
            exported_at: new Date().toISOString(),
            surveys: surveys,
            snapshots: snaps,
            assignments: assignments,
        };
    }
    function importMockInGroupSurveys(bundle) {
        if (!bundle || bundle.kind !== 'leai.in-group-surveys') {
            return Promise.reject(new Error('Not a LEAI in-group survey export'));
        }
        const existingSurveys = _read('leai.mock.surveys', []);
        const existingSurveyIds = new Set(existingSurveys.map(function (s) { return String(s.id); }));
        const existingSnaps = _read(K_SNAPSHOTS, []);
        const existingAssignments = _read(K_ASSIGNMENTS, []);

        let imported = 0, skipped = 0;
        (bundle.surveys || []).forEach(function (s) {
            if (existingSurveyIds.has(String(s.id))) { skipped++; return; }
            existingSurveys.push(s);
            imported++;
        });
        (bundle.snapshots || []).forEach(function (snap) {
            if (existingSnaps.some(function (x) { return String(x.survey_id) === String(snap.survey_id); })) return;
            existingSnaps.push(snap);
        });
        (bundle.assignments || []).forEach(function (a) {
            if (existingAssignments.some(function (x) { return x.session_id === a.session_id; })) return;
            existingAssignments.push(a);
        });
        _write('leai.mock.surveys', existingSurveys);
        _write(K_SNAPSHOTS, existingSnaps);
        _write(K_ASSIGNMENTS, existingAssignments);
        return Promise.resolve({ imported: imported, skipped: skipped });
    }

    return {
        USE_MOCK: USE_MOCK,
        listTeamConfigurations: listTeamConfigurations,
        createTeamConfiguration: createTeamConfiguration,
        updateTeamConfiguration: updateTeamConfiguration,
        archiveTeamConfiguration: archiveTeamConfiguration,
        deleteTeamConfiguration: deleteTeamConfiguration,
        createSurveyTeamSnapshot: createSurveyTeamSnapshot,
        getSurveyTeamSnapshot: getSurveyTeamSnapshot,
        assignSessionToTeam: assignSessionToTeam,
        listAssignmentsForSurvey: listAssignmentsForSurvey,
        listMockInGroupSurveys: listMockInGroupSurveys,
        saveMockInGroupSurvey: saveMockInGroupSurvey,
        getMockInGroupSurvey: getMockInGroupSurvey,
        updateMockInGroupSurvey: updateMockInGroupSurvey,
        deleteMockInGroupSurvey: deleteMockInGroupSurvey,
        duplicateMockInGroupSurvey: duplicateMockInGroupSurvey,
        setMockInGroupSurveyStatus: setMockInGroupSurveyStatus,
        exportMockInGroupSurveys: exportMockInGroupSurveys,
        importMockInGroupSurveys: importMockInGroupSurveys,
    };
})();
