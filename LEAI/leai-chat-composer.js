/* Progressive enhancement for the existing production chat controls.
 * Move the original textarea/buttons so all application handlers stay intact. */
(function () {
    'use strict';
    const mounted = new WeakMap();
    const controllers = new Set();
    const svgNS = 'http://www.w3.org/2000/svg';

    function icon(kind) {
        const svg = document.createElementNS(svgNS, 'svg');
        for (const [key, value] of Object.entries({viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'2', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true'})) svg.setAttribute(key, value);
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', {send:'M12 19V5m-7 7 7-7 7 7', expand:'M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7', collapse:'M4 14h6v6m0-6-7 7M20 10h-6V4m0 6 7-7', close:'m6 6 12 12M6 18 18 6'}[kind]);
        svg.appendChild(path);
        return svg;
    }

    function mount(input) {
        const existing = mounted.get(input);
        if (existing) { existing.resume(); return; }
        const host = input.closest('.input-area, .chat-input-row');
        const send = host && host.querySelector('#sendMessage, #send-btn');
        if (!host || !send) return;
        const mic = host.querySelector('#micButton');
        const region = document.createElement('div');
        region.className = 'leai-composer-region';
        const writing = document.createElement('div');
        writing.className = 'leai-composer-writing';
        const actions = document.createElement('div');
        actions.className = 'leai-composer-actions';
        const expand = document.createElement('button');
        expand.type = 'button'; expand.className = 'leai-composer-expand'; expand.hidden = true;
        expand.setAttribute('aria-label', 'Expand message editor'); expand.setAttribute('aria-haspopup', 'dialog');
        expand.appendChild(icon('expand'));
        const notice = document.createElement('p');
        notice.className = 'leai-composer-notice'; notice.textContent = 'LEAI is AI and can make mistakes.';
        const dialog = document.createElement('dialog');
        dialog.className = 'leai-composer-dialog';
        const title = document.createElement('p');
        title.className = 'leai-composer-sr-only'; title.id = 'leai-editor-title-' + input.id; title.textContent = 'Message editor';
        dialog.setAttribute('aria-labelledby', title.id); dialog.appendChild(title);
        const dialogNotice = notice.cloneNode(true);
        dialog.appendChild(dialogNotice);
        const placeholder = document.createComment('Original composer position');
        let selection = [0, 0];
        let resizeFrame = 0;
        let collapsedScroll = 0;
        let disposed = false;
        host.before(region); region.appendChild(placeholder); region.appendChild(host); region.appendChild(notice);
        host.classList.add('leai-composer');
        input.classList.add('leai-composer-input'); input.rows = 1;
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', 'Message');
        writing.appendChild(input); writing.appendChild(expand);
        host.appendChild(writing);
        if (mic) actions.appendChild(mic);
        actions.appendChild(send); host.appendChild(actions);
        send.type = 'button'; send.removeAttribute('style'); send.setAttribute('aria-label', 'Send'); send.replaceChildren(icon('send'));
        document.body.appendChild(dialog);

        function edges() {
            input.dataset.scrollAbove = String(input.scrollTop > 1);
            input.dataset.scrollBelow = String(input.scrollHeight - input.clientHeight - input.scrollTop > 1);
        }
        function resize() {
            if (disposed) return;
            if (!dialog.open) {
                input.style.height = 'auto';
                input.style.height = Math.max(44, input.value ? input.scrollHeight : 44) + 'px';
            }
            const overflow = !!input.value.trim() && input.scrollHeight > input.clientHeight + 1;
            host.classList.toggle('has-overflow', overflow);
            expand.hidden = !dialog.open && !overflow;
            expand.disabled = !dialog.open && input.disabled;
            edges();
        }
        function schedule() {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(resize);
        }
        function fitViewport() {
            if (dialog.open && window.innerWidth < 640 && window.visualViewport) {
                dialog.style.height = window.visualViewport.height + 'px';
                dialog.style.top = window.visualViewport.offsetTop + 'px';
                dialog.style.bottom = 'auto';
            } else { dialog.style.removeProperty('height'); dialog.style.removeProperty('top'); dialog.style.removeProperty('bottom'); }
            schedule();
        }
        function collapse() {
            if (!dialog.open) return;
            selection = [input.selectionStart, input.selectionEnd];
            dialog.close();
            placeholder.after(host);
            host.classList.remove('is-expanded');
            expand.setAttribute('aria-label', 'Expand message editor'); expand.setAttribute('aria-haspopup', 'dialog');
            expand.replaceChildren(icon('expand'));
            resize();
            input.focus({preventScroll:true}); input.setSelectionRange(...selection); input.scrollTop = collapsedScroll;
            edges();
        }
        function open() {
            if (input.disabled) return;
            selection = [input.selectionStart, input.selectionEnd]; collapsedScroll = input.scrollTop;
            dialogNotice.before(host);
            host.classList.add('is-expanded'); input.style.removeProperty('height');
            expand.hidden = false; expand.disabled = false;
            expand.setAttribute('aria-label', 'Collapse message editor'); expand.removeAttribute('aria-haspopup'); expand.replaceChildren(icon('collapse'));
            dialog.showModal(); fitViewport();
            input.focus({preventScroll:true}); input.setSelectionRange(...selection); edges();
        }
        function canSend() { return !input.disabled && !send.disabled && !send.classList.contains('loading') && !!input.value.trim(); }
        function afterSend() {
            if (!canSend()) return;
            const wasExpanded = dialog.open;
            requestAnimationFrame(() => { if (wasExpanded) collapse(); resize(); });
        }
        input.addEventListener('input', resize);
        input.addEventListener('focus', schedule);
        input.addEventListener('scroll', edges);
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.stopImmediatePropagation();
            if (event.isComposing || event.keyCode === 229 || input.disabled || window.innerWidth < 640 || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
                input.dispatchEvent(new Event('input', {bubbles:true}));
            } else if (canSend()) send.click();
        }, true);
        input.addEventListener('keypress', event => { if (event.key === 'Enter' || event.which === 13) event.stopImmediatePropagation(); }, true);
        expand.addEventListener('click', () => dialog.open ? collapse() : open());
        dialog.addEventListener('cancel', event => { event.preventDefault(); collapse(); });
        send.addEventListener('click', afterSend, true);
        let width = input.getBoundingClientRect().width;
        const sizeObserver = new ResizeObserver(() => {
            const next = input.getBoundingClientRect().width;
            if (width !== next) { width = next; schedule(); }
            else edges();
        });
        sizeObserver.observe(input);
        const disabledObserver = new MutationObserver(schedule);
        disabledObserver.observe(input, {attributes:true, attributeFilter:['disabled']});
        window.addEventListener('resize', fitViewport);
        window.visualViewport?.addEventListener('resize', fitViewport);
        window.visualViewport?.addEventListener('scroll', fitViewport);
        const controller = {input, region, resize, resume() {
            if (!disposed) return;
            disposed = false;
            document.body.appendChild(dialog);
            sizeObserver.observe(input);
            disabledObserver.observe(input, {attributes:true, attributeFilter:['disabled']});
            window.addEventListener('resize', fitViewport);
            window.visualViewport?.addEventListener('resize', fitViewport);
            window.visualViewport?.addEventListener('scroll', fitViewport);
            controllers.add(controller); resize();
        }, dispose() {
            // The orchestrated team picker temporarily detaches and later
            // restores the same app. Keep its original controls resumable.
            if (dialog.open) collapse();
            disposed = true; cancelAnimationFrame(resizeFrame); sizeObserver.disconnect(); disabledObserver.disconnect();
            window.removeEventListener('resize', fitViewport);
            window.visualViewport?.removeEventListener('resize', fitViewport);
            window.visualViewport?.removeEventListener('scroll', fitViewport);
            if (dialog.open) dialog.close(); dialog.remove(); controllers.delete(controller);
        }};
        mounted.set(input, controller); controllers.add(controller); resize();
        document.fonts?.ready.then(schedule);
    }

    function refresh() {
        for (const controller of controllers) if (!controller.region.isConnected) controller.dispose();
        document.querySelectorAll('#messageInput, #chat-input').forEach(mount);
        document.querySelectorAll('.leai-revise-hint').forEach(hint => {
            if (hint.querySelector('.leai-revise-dismiss')) return;
            hint.querySelector('.revise-hint-icon')?.remove();
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'leai-revise-dismiss'; button.setAttribute('aria-label', 'Dismiss revision tip'); button.appendChild(icon('close'));
            button.addEventListener('click', () => { hint.hidden = true; hint.style.display = 'none'; });
            hint.appendChild(button);
        });
    }
    window.leaiChatComposer = {resize(input) { mounted.get(input)?.resize(); }, refresh};
    function init() { refresh(); new MutationObserver(refresh).observe(document.body, {childList:true, subtree:true}); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
