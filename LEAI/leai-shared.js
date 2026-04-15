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
        return leaiChat._fetch('/leai_chat_sessions/', {
            method: 'POST',
            body: JSON.stringify({
                course_id: courseId,
                title: opts.title || 'New chat',
                scope: opts.scope || { kind: 'course' },
                seed_system_message: opts.seedSystemMessage || null,
            }),
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
