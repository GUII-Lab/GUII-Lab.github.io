// LEAI version + last-updated date — single source of truth.
//
// Bump these two lines whenever you cut a new release; every page that
// includes this script and carries an element with `data-leai-version`
// will be updated automatically on next load.
//
// The legal documents (Terms of Use, Privacy Policy) carry the same
// version number in their document text; that value is hardcoded in
// LEAI/legal/scripts/build_docx.py and must be updated in lockstep.

window.LEAI_VERSION = 'v0.3.0';
window.LEAI_UPDATED = '2026-08-13';

// IMPORTANT: when bumping LEAI_VERSION above, also update the `?v=` query
// string on every versioned shared CSS/JS reference in the LEAI/*.html files
// (including leai-shared, leai-tailwind-config, leai-completion, form-mode,
// progress, and PDF-ingest assets). Those query strings bust browser caches
// after a deploy. GitHub Pages serves the files raw, so there is no build step
// to do this automatically.

(function () {
    function applyVersionText() {
        var text = 'LEAI ' + window.LEAI_VERSION + ' \u00B7 Updated ' + window.LEAI_UPDATED;
        var nodes = document.querySelectorAll('[data-leai-version]');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = text;
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyVersionText);
    } else {
        applyVersionText();
    }
})();
