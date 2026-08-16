/* ================================================================
   NovaBlock.io — UI polish pack (shared across all pages)
   Dark/light toggle · scroll progress · back-to-top · floating contact
   skip-to-content · boot loader · announcement banner · last-updated · FAQ
   ================================================================ */
(function () {
    'use strict';

    var CONFIG = {
        /* Announcement banner text. Set to '' to disable. */
        announce: 'Trade stocks & crypto with confidence — new users get a welcome bonus.',
        announceLink: null,                 /* e.g. 'signup.html' */
        contactHref: 'mailto:support@novablock.io',
        contactLabel: 'Contact support',
        lastUpdated: '2026-08-15',
        themeKey: 'novablock_theme'
    };

    /* ---------- Theme ---------- */
    /* Always open in dark mode. The toggle switches to light for the current
       session; a light preference is not restored on the next page load. */
    var stored = 'dark';
    var root = document.documentElement;

    function applyTheme(t) {
        root.classList.toggle('light', t === 'light');
        root.classList.toggle('dark', t !== 'light');
        document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
            var sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
            if (sun) sun.classList.toggle('hidden', t === 'light');
            if (moon) moon.classList.toggle('hidden', t !== 'light');
            btn.setAttribute('title', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
            btn.setAttribute('aria-label', btn.getAttribute('title'));
        });
    }

    function toggleTheme() {
        var next = root.classList.contains('light') ? 'dark' : 'light';
        try { localStorage.setItem(CONFIG.themeKey, next); } catch (e) {}
        applyTheme(next);
    }
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-theme-toggle]');
        if (btn) toggleTheme();
    });

    /* ---------- Scroll progress + back-to-top ---------- */
    var prog = document.createElement('div');
    prog.className = 'scroll-progress';
    document.body.appendChild(prog);

    var backTop = document.createElement('button');
    backTop.className = 'back-to-top';
    backTop.setAttribute('aria-label', 'Back to top');
    backTop.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    backTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.body.appendChild(backTop);

    function onScroll() {
        var doc = document.documentElement;
        var max = doc.scrollHeight - doc.clientHeight;
        prog.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
        prog.classList.toggle('visible', window.scrollY > 40);
        backTop.classList.toggle('visible', window.scrollY > 600);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- Floating contact ---------- */
    var contact = document.createElement('a');
    contact.className = 'floating-contact';
    contact.href = CONFIG.contactHref;
    contact.setAttribute('aria-label', CONFIG.contactLabel);
    contact.innerHTML = '<i class="fa-solid fa-headset"></i><span class="tip">' + CONFIG.contactLabel + '</span>';
    document.body.appendChild(contact);

    /* ---------- Skip to content ---------- */
    var skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = '#main';
    skip.textContent = 'Skip to content';
    document.body.appendChild(skip);
    var mainEl = document.getElementById('main');
    if (!mainEl) {
        var firstMain = document.querySelector('main');
        if (firstMain) { firstMain.id = 'main'; }
    }

    /* ---------- Boot loader ---------- */
    var loader = document.createElement('div');
    loader.className = 'boot-loader';
    loader.innerHTML = '<div class="logo">Nova<span style="color:#8b5cf6;">Block</span>.io</div><div class="spinner"></div>';
    document.body.appendChild(loader);
    function hideLoader() {
        if (loader.dataset.gone) return;
        loader.dataset.gone = '1';
        loader.classList.add('done');
        setTimeout(function () { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 600);
    }
    if (document.readyState === 'complete') hideLoader();
    else window.addEventListener('load', hideLoader);
    setTimeout(hideLoader, 2500); /* safety so it never blocks the page */

    /* ---------- Announcement banner ---------- */
    try {
        if (CONFIG.announce && localStorage.getItem('novablock_announce_hidden') !== '1') {
            var bar = document.createElement('div');
            bar.className = 'announce';
            bar.innerHTML = '<span>' + CONFIG.announce + '</span>'
                + (CONFIG.announceLink ? ' <a href="' + CONFIG.announceLink + '">Learn more</a>' : '')
                + '<button class="close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>';
            document.body.insertBefore(bar, document.body.firstChild);
            bar.querySelector('.close').addEventListener('click', function () {
                try { localStorage.setItem('novablock_announce_hidden', '1'); } catch (e) {}
                bar.parentNode && bar.parentNode.removeChild(bar);
            });
        }
    } catch (e) {}

    /* ---------- Last updated date ---------- */
    document.querySelectorAll('[data-last-updated]').forEach(function (el) {
        var iso = el.getAttribute('data-last-updated') || CONFIG.lastUpdated;
        var d = new Date(iso + 'T00:00:00');
        if (!isNaN(d.getTime())) {
            el.textContent = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        }
    });

    /* ---------- Expandable FAQ ---------- */
    document.addEventListener('click', function (e) {
        var q = e.target.closest('.faq-q');
        if (q) {
            var item = q.parentElement;
            item.classList.toggle('open');
            q.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
        }
    });

    applyTheme(stored);
})();
