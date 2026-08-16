/* ---------- Login / logout gate ---------- */
/* Credentials are validated against the backend. The session secret lives only
   in the HttpOnly `sb_session` cookie — JS never sees or stores it; the server
   authenticates every request from the cookie. hasSession() (see store.js) reads
   the non-HttpOnly companion flag so the UI can show the right screen. */

const ACCOUNT_KEY = 'proderiv_account';

function getAccount() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) || {}; } catch { return {}; }
}
function setAccount(a) {
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); } catch {}
}

/* ---------- Sign-up email verification ---------- */
/* A fresh registration/login token for an unverified account is held here in
   memory (NOT stored) until the email code is confirmed — so closing the page
   mid-verification simply drops you back at login. */
let pendingVerifyToken = null;

function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* showToast lives in profile.js, which only the main app page loads. Standalone
   pages (signup.html) have no toast element, so provide a harmless no-op
   fallback — otherwise the verify/register success path would throw
   `ReferenceError: showToast is not defined` and skip the redirect to the app. */
if (typeof showToast === 'undefined') {
  var showToast = function () {};
}

/* Replaces a card's content with a "verify your email" panel. */
let verifyContainer = null;
function showVerifyEmail(container, email, onDone) {
    if (!container) return;
    verifyContainer = container;
    container.innerHTML = `
        <div class="text-center mb-6">
            <div class="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500 flex items-center justify-center mb-4">
                <i class="fa-solid fa-envelope-circle-check text-xl text-white"></i>
            </div>
            <h1 class="font-display text-xl font-bold text-white">Verify your email</h1>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
                We sent a 6-digit code to<br>
                <span class="text-slate-200 font-semibold">${escHtml(email)}</span>.
            </p>
        </div>
        <div class="space-y-4">
            <div>
                <label class="block text-xs text-slate-300 mb-1.5" for="verifyCode">Verification code</label>
                <input id="verifyCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" class="inp text-center text-lg font-semibold tracking-[0.4em] fig">
            </div>
            <p id="verifyError" class="hidden text-[11px] text-rose-300"><i class="fa-solid fa-circle-exclamation mr-1"></i><span id="verifyErrorText"></span></p>
            <button id="verifyBtn" onclick="verifyEmailSubmit()" class="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-sm font-semibold text-white shadow-accent transition">Verify Email</button>
            <p class="text-center text-xs text-slate-500">
                Didn't get it?
                <button onclick="resendVerifyCode()" class="text-indigo-300 hover:text-indigo-200 font-medium transition">Resend code</button>
            </p>
        </div>`;
    container._verifyDone = onDone || null;
    const input = $('verifyCode');
    if (input) setTimeout(() => input.focus(), 100);
}

function verifyEmailSubmit() {
    const input = $('verifyCode');
    const code = input ? input.value.trim() : '';
    const err = $('verifyError'), errText = $('verifyErrorText');
    const showErr = m => { if (errText) errText.textContent = m; if (err) err.classList.remove('hidden'); };
    if (err) err.classList.add('hidden');
    if (!/^\d{6}$/.test(code)) { showErr('Enter the 6-digit code from your email.'); return; }
    const btn = $('verifyBtn');
    const setLoading = on => {
        if (!btn) return;
        btn.disabled = on;
        btn.textContent = on ? 'Verifying…' : 'Verify Email';
        btn.classList.toggle('opacity-60', on);
    };
    setLoading(true);

    const send = () => fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (pendingVerifyToken || getToken()) },
        body: JSON.stringify({ code })
    });

    /* Retry a couple of times on network blips (e.g. the server restarting) so a
       brief outage doesn't look like a permanent failure. Real server answers
       (wrong/expired code) are shown immediately, no retry. */
    (async () => {
        let failMsg = 'Could not reach the server — try again.';
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) { showErr('Server not responding — retrying…'); await new Promise(r => setTimeout(r, 1200)); }
            let res;
            try { res = await send(); } catch { continue; }
            let text;
            try { text = await res.text(); } catch { continue; }
            let d = {};
            try { d = JSON.parse(text); } catch { continue; }
            if (d.verified) {
                /* Store the session, then redirect to the app — every step is
                   guarded so nothing can silently block the redirect. */
                try { if (pendingVerifyToken) { setToken(pendingVerifyToken); pendingVerifyToken = null; } } catch {}
                try { showToast('Email verified — welcome aboard!'); } catch {}
                const done = verifyContainer && verifyContainer._verifyDone;
                if (typeof done === 'function') { try { done(); } catch {} return; }
                setTimeout(() => { window.location.reload(); }, 800);
                return;
            }
            setLoading(false);
            showErr(d.error || 'Verification failed — try again.');
            return;
        }
        setLoading(false);
        showErr(failMsg);
    })();
}

function resendVerifyCode() {
    fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (pendingVerifyToken || getToken()) }
    }).then(r => r.json()).then(d => {
        showToast(d.error || 'New code sent to your email');
    }).catch(() => showToast('Could not reach the server — wait a moment and try again'));
}

function isLoggedIn() {
    return hasSession();
}

function showLoginScreen() {
    const s = $('loginScreen');
    if (s) s.classList.remove('hidden');
    document.title = 'Log In — NovaBlock.io';
}

function hideLoginScreen() {
    const s = $('loginScreen');
    if (s) s.classList.add('hidden');
}

function setBtnLoading(btn, label, orig) {
    if (!btn) return;
    btn.dataset.orig = orig !== undefined ? orig : btn.textContent;
    btn.disabled = true;
    btn.classList.add('opacity-60');
    btn.textContent = label;
}
function btnDone(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('opacity-60');
    btn.textContent = btn.dataset.orig || 'Sign in';
}

function handleLogin(e) {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const pass = $('loginPassword').value;
    const err = $('loginError');
    const btn = e.target.querySelector('button[type=submit]');
    if (err) err.classList.add('hidden');
    setBtnLoading(btn, 'Signing in…');

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
    }).then(r => r.json()).then(d => {
        if (!d.token) throw new Error(d.error || 'Login failed');
        /* Unverified account: hold the token in memory and ask for the email code
           before granting access. */
        if (d.user && d.user.emailVerified === false) {
            pendingVerifyToken = d.token;
            setAccount({ name: d.user.name, email: d.user.email, phone: d.user.phone });
            showVerifyEmail($('loginScreen').querySelector('.glass'), d.user.email, () => { window.location.reload(); });
            return;
        }
        setToken(d.token);
        setAccount({ name: d.user.name, email: d.user.email, phone: d.user.phone });
        applyServerUser(d.user);
        hideLoginScreen();
        refreshApp();
        const first = ((d.user.state && d.user.state.profile && d.user.state.profile.fullName) || d.user.name || 'there').split(' ')[0];
        showToast('Welcome back, ' + first + '!');
        showView('dashboard');
    }).catch(() => {
        if (err) err.classList.remove('hidden');
    }).finally(() => {
        btnDone(btn);
    });
}

function toggleLoginPassword() {
    const inp = $('loginPassword');
    const icon = $('loginPassIcon');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    icon.className = 'fa-regular ' + (show ? 'fa-eye-slash' : 'fa-eye');
}

function logout() {
    /* The server reads the session from the HttpOnly cookie and clears both
       cookies; the client clears the non-HttpOnly flag too (immediate UI). */
    try { fetch('/api/logout', { method: 'POST' }).catch(() => {}); } catch {}
    clearSessionFlag();
    ['registerModal', 'depositModal', 'withdrawModal', 'editProfileModal'].forEach(id => {
        const m = $(id);
        if (m) { m.classList.remove('flex'); m.classList.add('hidden'); }
    });
    showLoginScreen();
    showView('dashboard');
    document.title = 'Log In — NovaBlock.io';
    showToast('Logged out — see you soon');
}

function initAuth() {
    if (isLoggedIn()) hideLoginScreen();
    else showLoginScreen();
}

/* ---------- Registration ---------- */
/* The in-app "Create account" modal creates a real account on the backend
   (which sends the welcome email) and logs you straight in. */
function registerSubmit(e) {
    e.preventDefault();
    const name = $('regName').value.trim();
    const email = $('regEmail').value.trim();
    const phone = $('regPhone').value.trim();
    const pass = $('regPass').value;
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone || pass.length < 6) {
        showToast('Fill all fields — password must be 6+ characters');
        return;
    }
    const btn = e.target.querySelector('button[type=submit]');
    setBtnLoading(btn, 'Creating account…');

    fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password: pass })
    }).then(r => r.json()).then(d => {
        if (!d.token) { showToast(d.error || 'Could not create account'); return; }
        /* New accounts must confirm their email code before entering the app. */
        if (d.user && d.user.emailVerified === false) {
            pendingVerifyToken = d.token;
            setAccount({ name, email, phone });
            const form = $('registerForm');
            if (form) form.classList.add('hidden');
            const icon = $('registerHeadIcon'); if (icon) icon.innerHTML = '<i class="fa-solid fa-envelope-circle-check"></i>';
            const title = $('registerHeadTitle'); if (title) title.textContent = 'Verify your email';
            const sub = $('registerHeadSub'); if (sub) sub.textContent = 'Enter the code we emailed you to activate your account.';
            let box = $('registerVerifyBox');
            if (!box && form) { box = document.createElement('div'); box.id = 'registerVerifyBox'; form.parentNode.insertBefore(box, form.nextSibling); }
            showVerifyEmail(box, d.user.email, () => { window.location.reload(); });
            return;
        }
        setToken(d.token);
        setAccount({ name, email, phone });
        applyServerUser(d.user);
        toggleModal('registerModal');
        hideLoginScreen();
        refreshApp();
        showView('dashboard');
        showToast('Account created — welcome, ' + name.split(' ')[0] + '!');
    }).catch(() => {
        showToast('Could not create account — check the server is running');
    }).finally(() => {
        btnDone(btn);
    });
}

function resetRegisterModal() {
    const form = $('registerForm');
    if (form) form.reset();
}
