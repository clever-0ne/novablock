/* ---------- Super-admin panel ---------- */
/* Manages every registered user. Users live server-side; opening a user loads
   their data into the shared store (js/store.js) and every edit is pushed back
   to /api/admin/users/:id/state, so records are stored on the server. */

/* ---------- Local helpers (profile.js is not loaded on admin.html) ---------- */
const NAV_ACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white font-medium border border-indigo-500/25 shadow-[0_8px_24px_-12px_rgba(99,102,241,0.5)]';
const NAV_INACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-white/5 hover:text-slate-100 transition';

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initials(name) {
    return name.trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
}

function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    $('toastText').textContent = msg;
    t.classList.remove('opacity-0', 'pointer-events-none');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none'), 2400);
}

/* ---------- Admin auth (password-only login → server admin cookie) ---------- */
/* The password check happens ONLY on the server (rate-limited, logged). The
   admin session secret lives in the HttpOnly `sb_admin_session` cookie — JS
   never stores a token; hasAdminSession() reads its non-HttpOnly companion
   flag. The admin cookie is SEPARATE from the user's sb_session, so logging
   into the panel never kicks the user app's session in the same browser. */
const ADMIN_VIEWS = ['users', 'overview', 'transactions', 'kyc', 'profile', 'referrals', 'email'];

function getAdminToken() { return ''; }
function setAdminToken(t) { /* no-op — session is the HttpOnly cookie */ }
function isAdminLoggedIn() { return hasAdminSession(); }

function showAdminLoginScreen() { $('adminLoginScreen').classList.remove('hidden'); }
function hideAdminLoginScreen() { $('adminLoginScreen').classList.add('hidden'); }
function showAdminApp() { $('adminApp').classList.remove('hidden'); }
function hideAdminApp() { $('adminApp').classList.add('hidden'); }

function toggleAdminPassword() {
    const pw = $('adminLoginPassword');
    const icon = $('adminLoginPassIcon');
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    icon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
}

function handleAdminLogin(e) {
    e.preventDefault();
    const pass = $('adminLoginPassword').value;
    const btn = e.target.querySelector('button[type=submit]');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
    }).then(r => r.json()).then(d => {
        if (!d.ok && !d.token) throw new Error('Admin login failed');
        hideAdminLoginScreen();
        showAdminApp();
        adminShowView('users');
        adminLoadUsers();
        showToast('Welcome, Administrator');
    }).catch(() => { $('adminLoginError').classList.remove('hidden'); })
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = orig; } });
}

function adminLogout() {
    try { fetch('/api/logout', { method: 'POST' }).catch(() => {}); } catch {}
    clearAdminSessionFlag();
    setAdminMode(null);
    hideAdminApp();
    showAdminLoginScreen();
    $('adminLoginForm').reset();
    document.title = 'Admin Login — NovaBlock.io';
}

/* ---------- Admin view switching (mirrors showView, uses [data-anav]) ---------- */
function adminShowView(name) {
    /* Per-user views need a user open first. */
    if (['overview', 'transactions', 'kyc', 'profile', 'referrals'].includes(name) && !getAdminMode()) {
        showToast('Open a user from the Users tab first');
        name = 'users';
    }
    ADMIN_VIEWS.forEach(v => {
        const el = $('adminview-' + v);
        if (el) el.classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('[data-anav]').forEach(a => {
        a.className = a.dataset.anav === name ? NAV_ACTIVE : NAV_INACTIVE;
    });
    /* Mobile bottom taskbar items get a lighter active state via `.active`. */
    document.querySelectorAll('[data-bnav]').forEach(a => {
        a.classList.toggle('active', a.dataset.bnav === name);
    });
    if ($('adminCrumb')) $('adminCrumb').textContent = name[0].toUpperCase() + name.slice(1);
    document.title = 'Admin — ' + name[0].toUpperCase() + name.slice(1) + ' — NovaBlock.io';
    const chip = $('adminManaging');
    if (chip) chip.classList.toggle('hidden', !getAdminMode());
}

/* ---------- Users (arranged record store) ---------- */
let ADMIN_USERS = [];
let ADMIN_STATS = null;
let EMAIL_LOG = [];

function adminLoadUsers() {
    const q = $('adUserSearch') ? $('adUserSearch').value.trim().toLowerCase() : '';
    fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + getAdminToken() } })
        .then(r => r.json()).then(d => {
            ADMIN_USERS = (d.users || []).filter(u => !q || (u.name + ' ' + u.email + ' ' + u.phone).toLowerCase().includes(q));
            renderAdminUsers();
            if (!q) renderAdminStats();
        }).catch(() => showToast('Could not load users'));
}

function renderAdminStats() {
    fetch('/api/admin/stats', { headers: { 'Authorization': 'Bearer ' + getAdminToken() } })
        .then(r => r.json()).then(s => {
            ADMIN_STATS = s;
            const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
            set('adStatsUsers', s.totalUsers);
            set('adStatsBalance', '$' + fmt(s.totalBalance || 0));
            set('adStatsPending', s.pendingApprovals);
            set('adStatsEmails', s.emailsSent);
            adminRenderMailConfig();
            adminRenderEmailLog();
        }).catch(() => {});
}

function renderAdminUsers() {
    const body = $('adUsersBody');
    if (body) {
        body.innerHTML = ADMIN_USERS.map(u => {
            const kycBadge = u.kycDone === 3
                ? '<span class="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-md">Full</span>'
                : u.kycDone > 0
                    ? '<span class="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-md">' + u.kycDone + '/3</span>'
                    : '<span class="px-2 py-0.5 text-[10px] font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-md">None</span>';
            const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
            return `<tr class="hover:bg-white/[0.03] transition border-b border-white/5">
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-2.5">
                        <span class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-[10px] font-bold">${initials(u.name || '?')}</span>
                        <span class="text-slate-200 font-semibold">${esc(u.name) || '—'}</span>
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-400">${esc(u.email)}</td>
                <td class="px-4 py-3 text-slate-400 hidden md:table-cell">${esc(u.phone) || '—'}</td>
                <td class="px-4 py-3 text-right text-white font-semibold fig">$${fmt(u.balance)}</td>
                <td class="px-4 py-3">${kycBadge}</td>
                <td class="px-4 py-3 text-slate-400 hidden lg:table-cell">${joined}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button onclick="adminSelectUser(${u.id})" class="px-2.5 py-1.5 rounded-lg text-xs text-emerald-300/80 hover:bg-emerald-500/10 hover:text-emerald-300 transition" title="Manage user"><i class="fa-solid fa-arrow-right"></i></button>
                    <button onclick="adminEmailUser(${u.id})" class="px-2.5 py-1.5 rounded-lg text-xs text-sky-300/80 hover:bg-sky-500/10 hover:text-sky-300 transition" title="Send email"><i class="fa-solid fa-envelope"></i></button>
                    <button onclick="adminDeleteUser(${u.id})" class="px-2.5 py-1.5 rounded-lg text-xs text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-300 transition" title="Delete user"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
        const count = $('adUsersCount');
        if (count) count.textContent = ADMIN_USERS.length + (ADMIN_USERS.length === 1 ? ' account' : ' accounts');
        const empty = $('adUsersEmpty');
        if (empty) empty.classList.toggle('hidden', ADMIN_USERS.length > 0);
    }
}

/* Loads a user's full record into the shared store and starts managing them. */
function adminSelectUser(id, goTo) {
    fetch('/api/admin/users/' + id, { headers: { 'Authorization': 'Bearer ' + getAdminToken() } })
        .then(r => r.json()).then(d => {
            if (!d.user) { showToast('User not found'); return; }
            setAdminMode(d.user.id);
            if (typeof applyServerUser === 'function') applyServerUser(d.user);
            adminRenderAll();
            adminShowView(goTo || 'overview');
            const name = ((d.user.state && d.user.state.profile && d.user.state.profile.fullName) || d.user.name || d.user.email || '');
            const nm = $('adminManagingName');
            if (nm) nm.textContent = name + ' · ' + d.user.email;
            const chip = $('adminManaging');
            if (chip) chip.classList.remove('hidden');
            showToast('Managing ' + name);
        }).catch(() => showToast('Could not open user'));
}

function adminEmailUser(id) {
    adminSelectUser(id, 'email');
}

function adminBackToUsers() {
    setAdminMode(null);
    adminShowView('users');
    adminLoadUsers();
}

/* ---------- Add / delete users ---------- */
function openAdminAddUser() { const m = $('adAddUserModal'); if (m) m.classList.remove('hidden'); }
function closeAdminAddUser() {
    const m = $('adAddUserModal');
    if (m) m.classList.add('hidden');
    ['adAddName', 'adAddEmail', 'adAddPhone', 'adAddPass'].forEach(id => { const el = $(id); if (el) el.value = ''; });
}
function adminAddUser() {
    const name = $('adAddName').value.trim();
    const email = $('adAddEmail').value.trim();
    const phone = $('adAddPhone').value.trim();
    const pass = $('adAddPass').value;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Enter a valid email'); return; }
    if (pass.length < 6) { showToast('Password must be 6+ characters'); return; }
    fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAdminToken() },
        body: JSON.stringify({ name, email, phone, password: pass })
    }).then(r => r.json()).then(d => {
        if (!d.ok) { showToast(d.error || 'Could not create user'); return; }
        closeAdminAddUser();
        adminLoadUsers();
        showToast('Account created — welcome email ' + (ADMIN_STATS && ADMIN_STATS.emailConfigured ? 'sent' : 'logged'));
    }).catch(() => showToast('Could not create user'));
}

function adminDeleteUser(id) {
    const u = ADMIN_USERS.find(x => x.id === id);
    if (!confirm('Delete ' + ((u && u.name) || 'this user') + ' and ALL their records? This cannot be undone.')) return;
    fetch('/api/admin/users/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getAdminToken() } })
        .then(r => r.json()).then(d => {
            if (getAdminMode() === id) { setAdminMode(null); adminShowView('users'); }
            adminLoadUsers();
            showToast('User deleted');
        }).catch(() => showToast('Could not delete user'));
}

/* ---------- Email view ---------- */
function adminRenderMailConfig() {
    const b = $('adMailStatus');
    if (!b || !ADMIN_STATS) return;
    if (ADMIN_STATS.emailConfigured) {
        b.className = 'px-4 py-3 rounded-xl border text-sm bg-emerald-500/10 border-emerald-500/25 text-emerald-200';
        b.innerHTML = '<i class="fa-solid fa-circle-check mr-2"></i><b>Email is configured and live.</b> Messages are delivered via SMTP.';
    } else {
        b.className = 'px-4 py-3 rounded-xl border text-sm bg-amber-500/10 border-amber-500/25 text-amber-200';
        b.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i><b>Email delivery not configured.</b> Messages are stored in the log below (status "Logged") until you add SMTP credentials in <code class="font-mono">backend/email-config.js</code> or set SMTP_HOST / SMTP_USER / SMTP_PASS.';
    }
}

function adMailTemplateChanged() {
    const t = $('adMailTemplate').value;
    const subj = $('adMailSubject'), msg = $('adMailMessage');
    if (!subj || !msg) return;
    if (t === 'welcome') {
        subj.value = 'Welcome to NovaBlock.io — your account is ready';
        msg.value = 'Hi {{name}},\n\nYour NovaBlock.io account has been created successfully.\n\nAccount ID: {{accountId}}\n\nNext steps:\n1. Complete your email & phone verification in the KYC section\n2. Make a deposit to fund your account\n3. Start trading stocks and crypto\n\nIf you have any questions, just reply to this email.\n\n— The NovaBlock.io Team';
    } else if (t === 'verify-code') {
        subj.value = 'Your NovaBlock.io verification code';
        msg.value = 'Use this template to email the user a fresh verification code.\n\nA new 6-digit code is generated automatically and embedded in the email.\n\n(It is also sent automatically when the user completes KYC Level 1 — email verification.)';
    } else if (t === 'kyc-verified') {
        subj.value = 'Your identity has been verified';
        msg.value = 'Hi {{name}},\n\nGood news — your verification has been approved.\n\nVerification status: Level 3 — Verified ✓\nYou are now fully verified — deposits, withdrawals and external transfers are unlocked.\n\n— The NovaBlock.io Team';
    } else {
        subj.value = '';
        msg.value = '';
    }
    const h = $('adMailHint');
    if (h) h.textContent = '';
}

function adminSendEmail() {
    if (!getAdminMode()) { showToast('Select a user first'); return; }
    const template = $('adMailTemplate').value;
    const subject = $('adMailSubject').value.trim();
    const message = $('adMailMessage').value.trim();
    if (!subject) { showToast('Enter a subject'); return; }
    fetch('/api/admin/users/' + getAdminMode() + '/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAdminToken() },
        body: JSON.stringify({ template, subject, message })
    }).then(r => r.json()).then(d => {
        const hint = $('adMailHint');
        if (d.status === 'sent') { if (hint) hint.textContent = 'Delivered ✓'; showToast('Email sent'); }
        else if (d.status === 'logged') { if (hint) hint.textContent = 'Stored in the log (SMTP not configured)'; showToast('Email stored in the log'); }
        else { if (hint) hint.textContent = d.error || 'Send failed'; showToast('Email failed — see hint'); }
        adminRenderEmailLog();
        renderAdminStats();
    }).catch(() => showToast('Could not send email'));
}

function adminRenderEmailLog() {
    const body = $('adMailLogBody');
    if (!body) return;
    fetch('/api/admin/emails', { headers: { 'Authorization': 'Bearer ' + getAdminToken() } })
        .then(r => r.json()).then(d => {
            EMAIL_LOG = d.emails || [];
            const stMap = {
                sent:   ['Sent',   'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'],
                logged: ['Logged', 'bg-amber-500/15 text-amber-300 border-amber-500/20'],
                failed: ['Failed', 'bg-rose-500/15 text-rose-300 border-rose-500/20']
            };
            body.innerHTML = EMAIL_LOG.map(e => {
                const st = stMap[e.status] || stMap.logged;
                const time = e.createdAt ? new Date(e.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
                return `<tr class="hover:bg-white/[0.03] transition border-b border-white/5">
                    <td class="px-4 py-3 text-slate-300">${esc(e.toEmail)}</td>
                    <td class="px-4 py-3"><span class="px-2 py-0.5 text-[10px] font-semibold bg-white/5 text-slate-300 border border-white/10 rounded-md">${esc(e.template)}</span></td>
                    <td class="px-4 py-3 text-slate-200 max-w-[220px] truncate" title="${esc(e.subject)}">${esc(e.subject)}</td>
                    <td class="px-4 py-3"><span class="px-2 py-0.5 text-[10px] font-semibold ${st[1]} border rounded-md">${st[0]}</span></td>
                    <td class="px-4 py-3 text-slate-500 hidden md:table-cell">${time}</td>
                    <td class="px-4 py-3 text-right"><button onclick="adminToggleMailBody(${e.id})" class="px-2.5 py-1.5 rounded-lg text-xs text-indigo-300/80 hover:bg-indigo-500/10 hover:text-indigo-300 transition" title="Preview"><i class="fa-solid fa-eye"></i></button></td>
                </tr>
                <tr id="adMailBody${e.id}" class="hidden"><td colspan="6" class="px-4 pb-4">
                    <div class="rounded-xl border border-white/10 bg-[#060913] overflow-hidden">
                        <div class="px-3 py-1.5 text-[10px] text-slate-500 uppercase tracking-wider border-b border-white/10 flex items-center justify-between">
                            <span>Styled preview</span>
                            <button onclick="adminToggleMailBody(${e.id})" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-chevron-up"></i></button>
                        </div>
                        <iframe data-mailid="${e.id}" class="w-full h-80 block border-0" sandbox=""></iframe>
                    </div>
                </td></tr>`;
            }).join('') || '<tr><td colspan="6" class="text-center text-slate-500 py-10">No emails yet — welcome and verification emails will appear here.</td></tr>';
            const c = $('adMailLogCount');
            if (c) c.textContent = EMAIL_LOG.length + (EMAIL_LOG.length === 1 ? ' email' : ' emails');
        }).catch(() => {});
}

/* Empty the email log. Asks first — this permanently deletes every logged
   email from the database. */
function adminClearEmails() {
    if (!confirm('Delete ALL logged emails? This cannot be undone.')) return;
    fetch('/api/admin/emails/clear', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getAdminToken() }
    }).then(r => r.json()).then(d => {
        if (!d.ok) return showToast('Could not clear the email log');
        EMAIL_LOG = [];
        const body = $('adMailLogBody');
        if (body) body.innerHTML = '<tr><td colspan="6" class="text-center text-slate-500 py-10">No emails — the log is empty.</td></tr>';
        const c = $('adMailLogCount');
        if (c) c.textContent = '0 emails';
        const s = $('adStatsEmails');
        if (s) s.textContent = '0';
        showToast('Email log cleared');
    }).catch(() => showToast('Could not reach the server'));
}

function adminToggleMailBody(id) {
    const el = $('adMailBody' + id);
    if (!el) return;
    if (el.classList.contains('hidden')) {
        /* Load the styled HTML into the iframe on first open. */
        const iframe = el.querySelector('iframe');
        if (iframe && !iframe.getAttribute('data-loaded')) {
            const row = EMAIL_LOG.find(x => x.id === id);
            iframe.srcdoc = (row && row.html) || (row && row.body) || '';
            iframe.setAttribute('data-loaded', '1');
        }
    }
    el.classList.toggle('hidden');
}

/* ---------- Reset ---------- */
function adminResetUser() {
    if (!getAdminMode()) { showToast('Open a user from the Users tab first'); return; }
    if (!confirm('Reset this user\'s data (balances, transactions, profile, referrals, KYC)?')) return;
    const fresh = seedApp();
    fresh.profile = { ...fresh.profile, ...profile };
    localStorage.removeItem('proderiv_kyc_v1');
    applyServerUser({ state: fresh, kyc: {} });
    fetch('/api/admin/users/' + getAdminMode() + '/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAdminToken() },
        body: JSON.stringify(fresh)
    }).catch(() => {});
    adminRenderAll();
    showToast('User data reset to defaults');
}

function adminResetPlatform() {
    if (!confirm('Reset the platform — delete ALL users, transactions and emails? This cannot be undone.')) return;
    fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getAdminToken() }
    }).then(r => r.json()).then(d => {
        setAdminMode(null);
        applyServerUser({ state: seedApp(), kyc: {} });
        localStorage.removeItem('proderiv_kyc_v1');
        adminLoadUsers();
        showToast('Platform reset — no users');
    }).catch(() => showToast('Could not reset platform'));
}

/* ---------- Render everything for the currently-managed user ---------- */
function adminRenderAll() {
    adminRenderBalance();
    adminRenderTxTable();
    adminRenderKYC();
    adminRenderProfileForm();
    adminRenderReferrals();
    adminRenderAccountSummary();
    adminRenderDepositAddresses();
    adminRenderHoldings();
    updateAdminPendingBar();
}

/* Crypto holdings — what the managed user holds per coin (deposit-driven). */
function adminRenderHoldings() {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = '$' + fmt(v || 0); };
    set('adHoldBTC', HOLDINGS.BTC);
    set('adHoldETH', HOLDINGS.ETH);
    set('adHoldUSDT', HOLDINGS.USDT);
    set('adHoldBNB', HOLDINGS.BNB);
}

/* ---------- Deposit addresses (shown to the user in the deposit modal) ---------- */
function adminRenderDepositAddresses() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
    set('adDepositBTC', DEPOSIT_ADDRESSES.Bitcoin);
    set('adDepositUSDT', DEPOSIT_ADDRESSES.USDT);
    set('adDepositETH', DEPOSIT_ADDRESSES.Ethereum);
}

function adminSaveDepositAddresses() {
    DEPOSIT_ADDRESSES.Bitcoin = $('adDepositBTC').value.trim();
    DEPOSIT_ADDRESSES.USDT = $('adDepositUSDT').value.trim();
    DEPOSIT_ADDRESSES.Ethereum = $('adDepositETH').value.trim();
    saveApp();
    adminRenderDepositAddresses();
    showToast('Deposit addresses saved — user sees them on the deposit modal');
}

/* ---------- Pending approvals (deposit / withdrawal submitted by the user) ---------- */
function pendingTxCount() {
    return TX_DATA.filter(t => t.status === 'pending' && (t.type === 'deposit' || t.type === 'withdrawal')).length;
}

function updateAdminPendingBar() {
    const n = pendingTxCount();
    const bar = $('adminPendingBar'), text = $('adminPendingText');
    if (bar && text) {
        const nouns = n === 1 ? 'approval' : 'approvals';
        text.textContent = n ? n + ' deposit/withdrawal request' + (n === 1 ? '' : 's') + ' pending your review (' + nouns + ')' : 'No pending approvals';
        bar.classList.toggle('hidden', n === 0);
        bar.classList.toggle('flex', n > 0);
    }
    const bell = $('adminBellCount');
    if (bell) {
        bell.textContent = n;
        bell.classList.toggle('hidden', n === 0);
    }
    const side = $('adminPendingCount');
    if (side) {
        side.textContent = n;
        side.classList.toggle('hidden', n === 0);
    }
}

/* Applies a completed deposit/withdrawal's effect on holdings + fiat balances. */
function applyTxFunds(t) {
    const amt = Math.abs(t.amount);
    const key = assetToKey(t.asset);
    if (t.type === 'deposit') {
        if (key && HOLDINGS[key] !== undefined) HOLDINGS[key] += amt;
        BALANCE.amount += amt;
        BALANCE.deposit += amt;
    } else if (t.type === 'withdrawal') {
        if (key && HOLDINGS[key] !== undefined) HOLDINGS[key] = Math.max(0, HOLDINGS[key] - amt);
        BALANCE.amount = Math.max(0, BALANCE.amount - amt);
        BALANCE.withdrawal += amt;
    }
}

/* Reverses applyTxFunds — used when deleting a completed deposit/withdrawal. */
function reverseTxFunds(t) {
    const amt = Math.abs(t.amount);
    const key = assetToKey(t.asset);
    if (t.type === 'deposit') {
        if (key && HOLDINGS[key] !== undefined) HOLDINGS[key] = Math.max(0, HOLDINGS[key] - amt);
        BALANCE.amount = Math.max(0, BALANCE.amount - amt);
        BALANCE.deposit = Math.max(0, BALANCE.deposit - amt);
    } else if (t.type === 'withdrawal') {
        if (key && HOLDINGS[key] !== undefined) HOLDINGS[key] += amt;
        BALANCE.amount += amt;
        BALANCE.withdrawal = Math.max(0, BALANCE.withdrawal - amt);
    }
}

function adminApproveTx(i) {
    const t = TX_DATA[i];
    if (!t) return;
    t.status = 'completed';
    applyTxFunds(t);
    saveApp();
    if (typeof notifyTransaction === 'function') notifyTransaction(t);
    renderBalance();
    adminRenderBalance();
    adminRenderHoldings();
    adminRenderTxTable();
    updateAdminPendingBar();
    showToast('Transaction approved — user balance & holdings updated');
}

function adminDeclineTx(i) {
    const t = TX_DATA[i];
    if (!t) return;
    t.status = 'failed';
    saveApp();
    adminRenderTxTable();
    updateAdminPendingBar();
    showToast('Transaction declined');
}

/* Live two-tab sync: when the managed user edits in this browser, re-render. */
window.addEventListener('storage', e => {
    if (e.key === 'proderiv_app_v2' || e.key === 'proderiv_kyc_v1') {
        if (typeof refreshApp === 'function') refreshApp();
    }
});

function adminRenderAccountSummary() {
    const who = $('adminWho'), email = $('adminEmail');
    if (who) who.textContent = profile.fullName;
    if (email) email.textContent = profile.email;
}

/* ---------- Overview: balances ---------- */
function adminRenderBalance() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('adminBalance', BALANCE.amount);
    set('adminBonus', BALANCE.bonus);
    set('adminDeposit', BALANCE.deposit);
    set('adminWithdrawal', BALANCE.withdrawal);
}

function adminSaveBalance() {
    setBalances({
        amount: parseFloat($('adminBalance').value) || 0,
        bonus: parseFloat($('adminBonus').value) || 0,
        deposit: parseFloat($('adminDeposit').value) || 0,
        withdrawal: parseFloat($('adminWithdrawal').value) || 0
    });
    adminRenderBalance();
    showToast('Balances updated — will show on the user dashboard');
}

/* ---------- Transactions ---------- */
const ADMIN_TX_TYPES = {
    deposit:    { label: 'Deposit',        icon: 'fa-arrow-down-long', cls: 'bg-emerald-500/15 text-emerald-300' },
    withdrawal: { label: 'Withdrawal',     icon: 'fa-arrow-up-long',   cls: 'bg-rose-500/15 text-rose-300' },
    swap:       { label: 'Swap',           icon: 'fa-rotate',          cls: 'bg-indigo-500/15 text-indigo-300' },
    bonus:      { label: 'Referral Bonus', icon: 'fa-users',           cls: 'bg-amber-500/15 text-amber-300' },
    transfer:   { label: 'Transfer',       icon: 'fa-paper-plane',     cls: 'bg-sky-500/15 text-sky-300' },
    trade:      { label: 'Trade',          icon: 'fa-chart-line',      cls: 'bg-sky-500/15 text-sky-300' }
};
const ADMIN_TX_STATUS = {
    completed: { label: 'Completed', icon: 'fa-check', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' },
    pending:   { label: 'Pending',   icon: 'fa-clock', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/20' },
    failed:    { label: 'Failed',    icon: 'fa-xmark', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/20' }
};
const ADMIN_TX_ASSET_ICON = {
    'Bitcoin':  { icon: 'fa-brands fa-bitcoin',    cls: 'text-amber-500' },
    'Ethereum': { icon: 'fa-brands fa-ethereum',   cls: 'text-indigo-400' },
    'USDT':     { icon: 'fa-solid fa-dollar-sign', cls: 'text-emerald-400' },
    'BNB':      { icon: 'fa-solid fa-coins',       cls: 'text-amber-400' },
    'Reward':   { icon: 'fa-solid fa-gift',        cls: 'text-amber-400' }
};

function adminAddTx() {
    const amount = parseFloat($('adminTxAmount').value) || 0;
    if (!amount) { showToast('Enter a transaction amount'); return; }
    const tx = {
        type: $('adminTxType').value,
        asset: $('adminTxAsset').value,
        amount,
        date: $('adminTxDate').value || todayStr(),
        time: $('adminTxTime').value || nowStr(),
        status: $('adminTxStatus').value
    };
    TX_DATA.unshift(tx);
    if (tx.status === 'completed') {
        applyTxFunds(tx);
        if (typeof notifyTransaction === 'function') notifyTransaction(tx);
    }
    saveApp();
    renderBalance();
    adminRenderBalance();
    adminRenderHoldings();
    adminRenderTxTable();
    showToast('Transaction added');
}

function adminDeleteTx(i) {
    const t = TX_DATA[i];
    if (!t) return;
    TX_DATA.splice(i, 1);
    if (t.status === 'completed') reverseTxFunds(t);
    saveApp();
    renderBalance();
    adminRenderBalance();
    adminRenderHoldings();
    adminRenderTxTable();
    updateAdminPendingBar();
    showToast('Transaction deleted' + (t.status === 'completed' ? ' — funds reversed' : ''));
}

function adminRenderTxTable() {
    const body = $('adminTxBody');
    if (!body) return;
    body.innerHTML = TX_DATA.map((t, i) => {
        const T = ADMIN_TX_TYPES[t.type] || ADMIN_TX_TYPES.deposit;
        const S = ADMIN_TX_STATUS[t.status] || ADMIN_TX_STATUS.pending;
        const A = ADMIN_TX_ASSET_ICON[t.asset] || { icon: 'fa-solid fa-circle', cls: 'text-slate-400' };
        const sign = t.amount > 0 ? '+' : '-';
        const amtCls = t.amount > 0 ? 'text-emerald-300' : 'text-rose-300';
        const actions = t.status === 'pending'
            ? `<button onclick="adminApproveTx(${i})" class="px-2.5 py-1.5 rounded-lg text-xs text-emerald-300/80 hover:bg-emerald-500/10 hover:text-emerald-300 transition" title="Approve"><i class="fa-solid fa-check"></i></button>
               <button onclick="adminDeclineTx(${i})" class="px-2.5 py-1.5 rounded-lg text-xs text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-300 transition" title="Decline"><i class="fa-solid fa-xmark"></i></button>`
            : '';
        return `
            <tr class="hover:bg-white/[0.03] transition border-b border-white/5">
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-2">
                        <span class="w-7 h-7 rounded-lg ${T.cls} flex items-center justify-center"><i class="fa-solid ${T.icon} text-[10px]"></i></span>
                        <span class="text-slate-200 font-semibold">${T.label}</span>
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-300"><i class="${A.icon} ${A.cls} mr-1.5"></i>${esc(t.asset)}${t.to ? '<div class="text-[10px] text-slate-500 font-mono mt-0.5 max-w-[220px] truncate" title="' + esc(t.to) + '">' + esc(t.to) + '</div>' : ''}</td>
                <td class="px-4 py-3 text-right font-semibold fig ${amtCls}">${sign}$${fmt(Math.abs(t.amount))}</td>
                <td class="px-4 py-3 text-slate-400 hidden md:table-cell">${esc(t.date)} · ${esc(t.time)}</td>
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold ${S.cls} border rounded-md"><i class="fa-solid ${S.icon} text-[8px]"></i>${S.label}</span>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    ${actions}
                    <button onclick="adminDeleteTx(${i})" class="px-2.5 py-1.5 rounded-lg text-xs text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-300 transition"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    }).join('');
    const count = $('adminTxCount');
    if (count) count.textContent = TX_DATA.length + (TX_DATA.length === 1 ? ' entry' : ' entries');
}

/* ---------- KYC (managed user's record, synced through the admin API) ---------- */
const ADMIN_KYC_KEY = 'proderiv_kyc_v1';

function adminKycGet() {
    try { return JSON.parse(localStorage.getItem(ADMIN_KYC_KEY)) || {}; } catch { return {}; }
}

function adminSetKYC(level, done) {
    if (!getAdminMode()) { showToast('Open a user from the Users tab first'); return; }
    const s = adminKycGet();
    if (done) {
        for (let i = 1; i <= level; i++) s[i] = { done: true, ts: Date.now() };
    } else {
        for (let i = level; i <= 3; i++) delete s[i];
    }
    localStorage.setItem(ADMIN_KYC_KEY, JSON.stringify(s));
    adminRenderKYC();
    showToast('KYC Level ' + level + (done ? ' verified' : ' revoked'));
    fetch('/api/admin/users/' + getAdminMode() + '/kyc/' + level, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAdminToken() },
        body: JSON.stringify({ verified: done })
    }).catch(() => {});
}

function adminRenderKYC() {
    const s = adminKycGet();
    [1, 2, 3].forEach(l => {
        const badge = $('adminKycL' + l + 'Status');
        if (!badge) return;
        const done = !!(s[l] && s[l].done);
        badge.textContent = done ? 'Verified' : 'Not verified';
        badge.className = done
            ? 'px-2.5 py-1 text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-md'
            : 'px-2.5 py-1 text-[11px] font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-md';
    });
    [2, 3].forEach(l => {
        const el = $('adminKycL' + l + 'Doc');
        if (!el) return;
        const d = s[l];
        if (!d || !d.done) { el.innerHTML = ''; return; }
        const raw = d.docUrl || d.docData || '';
        /* Only allow server-signed URLs or image/PDF data URLs — never a
           javascript: or attribute-breakout payload. */
        const src = raw.indexOf('/api/uploads/') === 0 || raw.indexOf('data:image/') === 0 || raw.indexOf('data:application/pdf') === 0 ? raw : '';
        const thumb = src
            ? '<a href="' + esc(src) + '" target="_blank" rel="noopener" title="Open document"><img src="' + esc(src) + '" class="h-16 w-16 rounded-lg object-cover border border-white/10 hover:border-indigo-400 transition" /></a>'
            : '';
        el.innerHTML = '<div class="mt-3 rounded-xl bg-white/[0.03] border border-white/10 p-2.5">'
            + '<p class="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5"><i class="fa-solid fa-paperclip mr-1"></i>Document received</p>'
            + '<div class="flex items-center gap-3">' + thumb
            + '<div class="min-w-0">'
            + '<p class="text-xs text-slate-200 font-medium truncate">' + (l === 2 ? (d.docType ? esc(d.docType) : 'Government ID') : 'Proof of address') + '</p>'
            + '<p class="text-[10px] text-slate-500 truncate">' + (d.fileName ? esc(d.fileName) : '') + '</p>'
            + '</div></div></div>';
    });
}

/* ---------- Profile ---------- */
function adminRenderProfileForm() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('adFullName', profile.fullName);
    set('adUsername', profile.username);
    set('adEmail', profile.email);
    set('adPhone', profile.phone);
    set('adDob', profile.dob);
    set('adStreet', profile.street);
    set('adCity', profile.city);
    set('adState', profile.state);
    set('adPostal', profile.postal);
    set('adCountry', profile.country);
    set('adJoined', profile.joined);
    set('adAccountId', profile.accountId);
    set('adReferral', profile.referral);
}

function adminSaveProfile() {
    const read = id => (document.getElementById(id).value || '').trim();
    profile.fullName = read('adFullName');
    profile.username = read('adUsername');
    profile.email = read('adEmail');
    profile.phone = read('adPhone');
    profile.dob = read('adDob');
    profile.street = read('adStreet');
    profile.city = read('adCity');
    profile.state = read('adState');
    profile.postal = read('adPostal');
    profile.country = read('adCountry');
    profile.joined = read('adJoined');
    profile.accountId = read('adAccountId');
    profile.referral = read('adReferral');
    saveApp();
    adminRenderProfileForm();
    adminRenderAccountSummary();
    showToast('Profile saved — reflects on the user dashboard');
}

/* ---------- Referrals ---------- */
function adminSaveRefStats() {
    REF_STATS.pending = parseFloat($('adminRefPending').value) || 0;
    saveApp();
    adminRenderReferrals();
    showToast('Referral stats saved');
}

function adminRefAddOrSave() {
    const idx = parseInt($('adminRefEditIndex').value, 10);
    const row = {
        name: $('adminRefName').value.trim() || 'Unnamed',
        joined: $('adminRefJoined').value.trim() || '—',
        tier: $('adminRefTier').value,
        volume: parseFloat($('adminRefVolume').value) || 0,
        earned: parseFloat($('adminRefEarned').value) || 0,
        status: $('adminRefStatus').value
    };
    if (idx >= 0 && idx < REF_DATA.length) REF_DATA[idx] = row;
    else REF_DATA.push(row);
    saveApp();
    adminRefCancelEdit();
    adminRenderReferrals();
    showToast(idx >= 0 ? 'Referral updated' : 'Referral added');
}

function adminEditRef(i) {
    const r = REF_DATA[i];
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('adminRefName', r.name);
    set('adminRefJoined', r.joined);
    set('adminRefTier', r.tier);
    set('adminRefVolume', r.volume);
    set('adminRefEarned', r.earned);
    set('adminRefStatus', r.status);
    $('adminRefEditIndex').value = i;
    const btn = $('adminRefCancelBtn');
    if (btn) btn.classList.remove('hidden');
    $('adminview-referrals').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Editing ' + r.name + ' — save to apply');
}

function adminRefCancelEdit() {
    ['adminRefName', 'adminRefJoined', 'adminRefVolume', 'adminRefEarned'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    if ($('adminRefTier')) $('adminRefTier').value = 'Silver';
    if ($('adminRefStatus')) $('adminRefStatus').value = 'active';
    $('adminRefEditIndex').value = -1;
    const btn = $('adminRefCancelBtn');
    if (btn) btn.classList.add('hidden');
}

function adminDeleteRef(i) {
    REF_DATA.splice(i, 1);
    saveApp();
    adminRenderReferrals();
    showToast('Referred user removed');
}

function adminRenderReferrals() {
    const body = $('adminRefBody');
    if (!body) return;
    body.innerHTML = REF_DATA.map((r, i) => {
        const tierCls = r.tier === 'Platinum' ? 'text-indigo-300 bg-indigo-500/15 border-indigo-500/20'
            : r.tier === 'Gold' ? 'text-amber-300 bg-amber-500/15 border-amber-500/20'
            : 'text-slate-300 bg-white/5 border-white/10';
        const status = r.status === 'active'
            ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-md"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Active</span>'
            : '<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-md">Inactive</span>';
        return `
            <tr class="hover:bg-white/[0.03] transition border-b border-white/5">
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-2.5">
                        <span class="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-[10px] font-bold">${initials(r.name)}</span>
                        <span class="text-slate-200 font-semibold">${esc(r.name)}</span>
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-400 hidden md:table-cell">${r.joined}</td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 text-[10px] font-semibold border rounded-md ${tierCls}">${r.tier}</span></td>
                <td class="px-4 py-3 text-right text-white font-semibold fig">$${fmt(r.volume)}</td>
                <td class="px-4 py-3 text-right text-emerald-300 font-semibold fig">$${fmt(r.earned)}</td>
                <td class="px-4 py-3">${status}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button onclick="adminEditRef(${i})" class="px-2.5 py-1.5 rounded-lg text-xs text-indigo-300/80 hover:bg-indigo-500/10 hover:text-indigo-300 transition"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="adminDeleteRef(${i})" class="px-2.5 py-1.5 rounded-lg text-xs text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-300 transition"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    }).join('');
    const count = $('adminRefCount');
    if (count) count.textContent = REF_DATA.length + (REF_DATA.length === 1 ? ' member' : ' members');
    const pending = $('adminRefPending');
    if (pending) pending.value = REF_STATS.pending;
}

/* ---------- Boot ---------- */
if (isAdminLoggedIn()) {
    hideAdminLoginScreen();
    showAdminApp();
    adminShowView('users');
    adminLoadUsers();
} else {
    showAdminLoginScreen();
}
