/* ---------- Utilities ---------- */
        const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtCompact = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k';
        const $ = id => document.getElementById(id);

        /* ---------- Modal toggle ---------- */
        function toggleModal(id) {
            const modal = $(id);
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                if (id === 'withdrawModal' && typeof updateWithdrawGate === 'function') updateWithdrawGate();
                if (id === 'withdrawModal' && typeof renderWithdrawCoin === 'function') renderWithdrawCoin();
                if (id === 'depositModal' && typeof renderDepositWallet === 'function') renderDepositWallet();
                if (id === 'registerModal' && typeof resetRegisterModal === 'function') resetRegisterModal();
            } else {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }
        }

        /* ---------- Date/time helpers ---------- */
        const todayStr = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const nowStr = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

        /* ---------- Clipboard ---------- */
        function copyText(text) {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            } else fallbackCopy(text);
        }
        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
        }

        /* ---------- Mobile sidebar ---------- */
        function openSidebar() {
            $('sidebar').classList.remove('-translate-x-full');
            $('sidebarBackdrop').classList.remove('hidden');
        }
        function closeSidebar() {
            $('sidebar').classList.add('-translate-x-full');
            $('sidebarBackdrop').classList.add('hidden');
        }

        /* ---------- Balance hide / show ---------- */
        let balanceVisible = true;
        function toggleBalance() {
            balanceVisible = !balanceVisible;
            document.querySelectorAll('.balance-figure').forEach(el => {
                el.textContent = balanceVisible ? el.dataset.amount : '••••••••••';
            });
            document.querySelectorAll('.balance-eye').forEach(icon => {
                icon.classList.toggle('fa-eye', balanceVisible);
                icon.classList.toggle('fa-eye-slash', !balanceVisible);
            });
        }

        /* ---------- Dynamic date & greeting ---------- */
        const dateEl = $('currentDate');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
        const greeting = $('greeting');
        if (greeting) {
            const h = new Date().getHours();
            greeting.textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + '. Here’s your portfolio at a glance.';
        }

        /* ---------- Count-up animation ---------- */
        function animateValue(el, end, duration) {
            const t0 = performance.now();
            const step = t => {
                const p = Math.min(1, (t - t0) / duration);
                const e = 1 - Math.pow(1 - p, 3);
                el.textContent = '$' + fmt(end * e);
                if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }
