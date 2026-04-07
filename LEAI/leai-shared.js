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
