/* ---------- Shared persisted data layer ---------- */
/* Single source of truth for user data. Loaded by BOTH dashboard.html and admin.html.
   dashboard.html's feature files read the live globals below (profile / TX_DATA / REF_DATA);
   admin.html edits the same objects. Everything persists under APP_KEY in localStorage. */

const APP_KEY = 'proderiv_app_v2';

/* ---------- Session (HttpOnly cookie only) ---------- */
/* The real session secret lives in the HttpOnly `sb_session` cookie and is never
   readable by JS. getToken/setToken/clearToken are kept as no-ops so every
   existing call site keeps working — but nothing is stored and the server falls
   back to the cookie whenever the (now empty) Bearer header is sent.
   `hasSession()` reads a non-HttpOnly companion flag the server sets alongside
   the real cookie; it carries no secret. */
function getToken() { return ''; }
function setToken(t) { /* no-op — session is the HttpOnly cookie */ }
function clearToken() { /* no-op — session is the HttpOnly cookie */ }

function hasSession() {
    try { return document.cookie.split('; ').some(c => c.indexOf('sb_session_present=1') === 0); } catch { return false; }
}
function clearSessionFlag() {
    try { document.cookie = 'sb_session_present=; Max-Age=0; path=/; SameSite=Strict'; } catch {}
}

/* Admin sessions use their OWN cookie pair (sb_admin_session/sb_admin_present),
   so logging into the admin panel never clobbers a user's session in the same
   browser. These helpers read/write the admin flag. */
function hasAdminSession() {
    try { return document.cookie.split('; ').some(c => c.indexOf('sb_admin_present=1') === 0); } catch { return false; }
}
function clearAdminSessionFlag() {
    try { document.cookie = 'sb_admin_present=; Max-Age=0; path=/; SameSite=Strict'; } catch {}
}

/* Admin panel: while editing a specific user, state pushes route to that
   user's server record instead of the logged-in user's own state. */
let adminModeUser = null;
function setAdminMode(id) { adminModeUser = id || null; }
function getAdminMode() { return adminModeUser; }

const DEFAULT_PROFILE = {
    fullName: '', username: '', email: '',
    phone: '', dob: '',
    street: '', city: '', state: '',
    postal: '', country: '', joined: '',
    accountId: '', referral: ''
};

const DEFAULT_TRANSACTIONS = [];

const DEFAULT_REFERRALS = [];

const DEFAULT_BALANCES = { amount: 0, bonus: 0, deposit: 0, withdrawal: 0 };
const DEFAULT_REF_STATS = { pending: 0 };
const DEFAULT_NOTIFICATIONS = [];

/* Per-asset holdings (swap + allocation). Start empty — everything rests at zero
   until a transaction is initiated, which wipes the account and holdings again. */
const DEFAULT_HOLDINGS = { BTC: 0, ETH: 0, USDT: 0, BNB: 0 };

/* Maps a transaction asset name to its holding key (used to credit/deduct coin
   holdings when deposits/withdrawals are approved and to validate swaps). */
const ASSET_TO_KEY = { Bitcoin: 'BTC', Ethereum: 'ETH', USDT: 'USDT', BNB: 'BNB' };
function assetToKey(asset) { return ASSET_TO_KEY[asset] || null; }

const DEFAULT_DEPOSIT_ADDRESSES = {
    Bitcoin: 'bc1q8yf8pr858e843rw22wtwlew5ytkxpure4fy32l',
    USDT: '0x17852B779a4b36a9F3e42373B1F573f4d1959c65',
    Ethereum: '0x17852B779a4b36a9F3e42373B1F573f4d1959c65'
};

function seedApp() {
    return {
        balances: { ...DEFAULT_BALANCES },
        profile: { ...DEFAULT_PROFILE },
        transactions: DEFAULT_TRANSACTIONS.map(t => ({ ...t })),
        referrals: DEFAULT_REFERRALS.map(r => ({ ...r })),
        refStats: { ...DEFAULT_REF_STATS },
        notifications: DEFAULT_NOTIFICATIONS.map(n => ({ ...n })),
        depositAddresses: { ...DEFAULT_DEPOSIT_ADDRESSES },
        holdings: { ...DEFAULT_HOLDINGS },
        positions: {}
    };
}

/* Client-side deep merge (mirrors backend/utils/state.js) — used when applying
   a server state so keys the server normalizes away never come back undefined. */
function deepMerge(base, override) {
    const out = { ...base };
    if (!override || typeof override !== 'object') return out;
    for (const k of Object.keys(override)) {
        const v = override[k];
        if (v === undefined || v === null) continue;
        if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
            && v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = deepMerge(out[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

/* Shared by profile.js and admin.js — both pages (and signup.html) load this
   file first, so these are the single definitions. */
const NAV_ACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white font-medium border border-indigo-500/25 shadow-[0_8px_24px_-12px_rgba(99,102,241,0.5)]';
const NAV_INACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-white/5 hover:text-slate-100 transition';

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

function loadApp() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(APP_KEY)); } catch {}
    if (!saved) {
        const d = seedApp();
        try { localStorage.setItem(APP_KEY, JSON.stringify(d)); } catch {}
        return d;
    }
    const d = seedApp();
    return {
        balances: { ...d.balances, ...(saved.balances || {}) },
        profile: { ...d.profile, ...(saved.profile || {}) },
        transactions: Array.isArray(saved.transactions) ? saved.transactions : d.transactions,
        referrals: Array.isArray(saved.referrals) ? saved.referrals : d.referrals,
        refStats: { ...d.refStats, ...(saved.refStats || {}) },
        notifications: Array.isArray(saved.notifications) ? saved.notifications : d.notifications,
        depositAddresses: { ...d.depositAddresses, ...(saved.depositAddresses || {}) },
        holdings: { ...d.holdings, ...(saved.holdings || {}) },
        positions: { ...(saved.positions || {}) }
    };
}

const appData = loadApp();

/* Live globals — the rest of the app already references these names. */
let profile = appData.profile;
let TX_DATA = appData.transactions;
let REF_DATA = appData.referrals;
let REF_STATS = appData.refStats;
let BALANCE = appData.balances;
let DEPOSIT_ADDRESSES = appData.depositAddresses;
let HOLDINGS = appData.holdings;
let STOCK_POSITIONS = appData.positions;
let NOTIFICATIONS = appData.notifications;

function saveApp() {
    try { localStorage.setItem(APP_KEY, JSON.stringify(appData)); } catch {}
    pushToServer();
}

function getBalance() { return BALANCE.amount; }

/* The headline figure: cash + coin wallet + open trade positions (marked to
   market). Positions use MARKET_ASSETS prices when loaded (dashboard). */
function totalEquity() {
    let t = BALANCE.amount;
    Object.keys(HOLDINGS).forEach(k => { t += (HOLDINGS[k] || 0); });
    if (typeof MARKET_ASSETS !== 'undefined') {
        Object.keys(STOCK_POSITIONS).forEach(sym => {
            const a = MARKET_ASSETS[sym];
            if (a) t += a.price * (STOCK_POSITIONS[sym] || 0);
        });
    }
    return t;
}

function setBalances({ amount, bonus, deposit, withdrawal }) {
    if (amount !== undefined) BALANCE.amount = amount;
    if (bonus !== undefined) BALANCE.bonus = bonus;
    if (deposit !== undefined) BALANCE.deposit = deposit;
    if (withdrawal !== undefined) BALANCE.withdrawal = withdrawal;
    saveApp();
    renderBalance();
    if (typeof resyncChartSeries === 'function') resyncChartSeries();
}

function resetAppData() {
    const ident = { ...profile };
    localStorage.removeItem(APP_KEY);
    Object.assign(appData, seedApp());
    // Keep the account identity so the user stays logged in.
    ['fullName', 'username', 'email', 'phone', 'dob', 'street', 'city', 'state', 'postal', 'country', 'joined', 'accountId', 'referral'].forEach(k => {
        if (ident[k]) appData.profile[k] = ident[k];
    });
    profile = appData.profile;
    TX_DATA = appData.transactions;
    REF_DATA = appData.referrals;
    REF_STATS = appData.refStats;
    BALANCE = appData.balances;
    DEPOSIT_ADDRESSES = appData.depositAddresses;
    HOLDINGS = appData.holdings;
    STOCK_POSITIONS = appData.positions;
    NOTIFICATIONS = appData.notifications;
    saveApp();
    renderBalance();
    if (typeof resyncChartSeries === 'function') resyncChartSeries();
    try { fetch('/api/reset', { method: 'POST' }).catch(() => {}); } catch {}
}

/* Re-reads localStorage and re-points every live global at the fresh data.
   Used by the cross-tab `storage` event so the other page sees changes live. */
function reloadApp() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(APP_KEY)); } catch {}
    if (!saved) return;
    const d = seedApp();
    const fresh = {
        balances: { ...d.balances, ...(saved.balances || {}) },
        profile: { ...d.profile, ...(saved.profile || {}) },
        transactions: Array.isArray(saved.transactions) ? saved.transactions : d.transactions,
        referrals: Array.isArray(saved.referrals) ? saved.referrals : d.referrals,
        refStats: { ...d.refStats, ...(saved.refStats || {}) },
        notifications: Array.isArray(saved.notifications) ? saved.notifications : d.notifications,
        depositAddresses: { ...d.depositAddresses, ...(saved.depositAddresses || {}) },
        holdings: { ...d.holdings, ...(saved.holdings || {}) },
        positions: { ...(saved.positions || {}) }
    };
    Object.assign(appData, fresh);
    profile = appData.profile;
    TX_DATA = appData.transactions;
    REF_DATA = appData.referrals;
    REF_STATS = appData.refStats;
    BALANCE = appData.balances;
    DEPOSIT_ADDRESSES = appData.depositAddresses;
    HOLDINGS = appData.holdings;
    STOCK_POSITIONS = appData.positions;
    NOTIFICATIONS = appData.notifications;
}

/* Replaces the local store with a specific user's data from the server.
   Used on login/register and when the admin opens a user to manage. */
function applyServerUser(u) {
    if (!u) return;
    try { localStorage.setItem('proderiv_email_verified', u.emailVerified ? '1' : '0'); } catch {}
    try {
        const state = u.state || {};
        /* Deep-merge onto the canonical seed so a server blob that normalizes
           away a key (e.g. balances.bonus) can never leave it undefined. */
        localStorage.setItem(APP_KEY, JSON.stringify(deepMerge(seedApp(), state)));
    } catch {}
    try { localStorage.setItem('proderiv_kyc_v1', JSON.stringify(u.kyc || {})); } catch {}
    reloadApp();
}

/* ---------- Server sync (persists data to the backend) ---------- */
/* localStorage stays the instant cache + cross-tab sync bus; the backend is the
   durable source of truth. Every call is try/caught so the app keeps working
   even if the backend is unreachable (localStorage fallback). */

let _serverTimer = null;

/* A unique id for every transaction, so local-vs-server state can be merged: a
   pending deposit's debounced push can be cut short by a refresh, and the id is
   what lets syncFromServer recover it instead of the server overwriting it. */
function txId() { return Date.now() + Math.floor(Math.random() * 1000); }

/* The routing target is snapshotted when a push is SCHEDULED, not when it
   fires — so an admin editing user 5 who then clicks "Back to users" can
   never have the debounced write land on the wrong record. */
let _pushTarget = null;

function pushNow() {
    const url = _pushTarget || (adminModeUser ? ('/api/admin/users/' + adminModeUser + '/state') : '/api/state');
    _pushTarget = null;
    if (!url) return;
    try {
        /* Both user and admin edits ride the HttpOnly session cookie — no
           Authorization header or stored token is needed. keepalive lets the
           request finish even while the page is unloading. */
        fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData),
            keepalive: true
        }).catch(() => {});
    } catch {}
}

function pushToServer() {
    clearTimeout(_serverTimer);
    _pushTarget = adminModeUser ? ('/api/admin/users/' + adminModeUser + '/state') : '/api/state';
    _serverTimer = setTimeout(pushNow, 400);
}

/* Flush any pending push the instant the page unloads (refresh/close/nav), so a
   deposit or edit made moments before a refresh isn't lost to the 400ms debounce. */
window.addEventListener('pagehide', () => { clearTimeout(_serverTimer); pushNow(); });

/* Re-renders every part of the UI that reads the store. Safe on both pages —
   each call is guarded, so missing feature scripts (admin.html) are no-ops. */
function refreshApp() {
    if (typeof renderBalance === 'function') renderBalance();
    if (typeof renderTicker === 'function') renderTicker();
    if (typeof renderProfile === 'function') renderProfile();
    if (typeof renderTransactions === 'function') renderTransactions();
    if (typeof renderDashboardRecent === 'function') renderDashboardRecent();
    if (typeof renderReferrals === 'function') renderReferrals();
    if (typeof initKYC === 'function') initKYC();
    if (typeof renderSwap === 'function') renderSwap();
    if (typeof renderTrade === 'function') renderTrade();
    if (typeof renderNotifications === 'function') renderNotifications();
    if (typeof renderTransfer === 'function') renderTransfer();
    if (typeof resyncChartSeries === 'function') { resyncChartSeries(); if (typeof renderChart === 'function') renderChart('1D'); }
    if (typeof adminRenderAll === 'function') adminRenderAll();
}

/* ---------- Topbar notification bell (dashboard.html) ---------- */
function renderNotifications() {
    const badge = $('notifBadge');
    if (badge) {
        const unread = NOTIFICATIONS.filter(n => !n.read).length;
        badge.classList.toggle('hidden', unread === 0);
        badge.textContent = unread;
    }
    const list = $('notifList');
    if (list) {
        list.innerHTML = NOTIFICATIONS.length ? NOTIFICATIONS.map(n => `
            <div class="px-4 py-3 border-b border-white/5 ${n.read ? '' : 'bg-indigo-500/[0.06]'}">
                <p class="text-xs font-semibold ${n.read ? 'text-slate-300' : 'text-white'}">${n.title}</p>
                ${n.body ? '<p class="text-xs text-slate-400 mt-0.5">' + n.body + '</p>' : ''}
                <p class="text-[10px] text-slate-600 mt-1">${n.time || ''}</p>
            </div>`).join('')
            : '<p class="px-4 py-8 text-center text-xs text-slate-500">No notifications yet.</p>';
    }
}

function toggleNotifications() {
    const p = $('notifPanel');
    if (!p) return;
    p.classList.toggle('hidden');
    renderNotifications();
}

function markAllNotificationsRead() {
    NOTIFICATIONS.forEach(n => { n.read = true; });
    saveApp();
    renderNotifications();
}

/* Auto-notifications from completed transactions only (deposit / withdrawal /
   trade / swap) — never sent manually. */
function notifyTransaction(t) {
    if (!t || t.status !== 'completed') return;
    const labels = { deposit: 'Deposit completed', withdrawal: 'Withdrawal completed', trade: 'Trade completed', swap: 'Swap completed' };
    const lbl = labels[t.type];
    if (!lbl) return;
    NOTIFICATIONS.unshift({
        id: Date.now(),
        title: lbl,
        body: (t.to ? t.asset + ' → ' + t.to : t.asset) + ' · $' + (typeof fmt === 'function' ? fmt(Math.abs(t.amount || 0)) : Math.abs(t.amount || 0)),
        time: (typeof nowStr === 'function' ? nowStr() : '') + ' · ' + (typeof todayStr === 'function' ? todayStr() : ''),
        read: false
    });
    while (NOTIFICATIONS.length > 20) NOTIFICATIONS.pop();
    saveApp();
    if (typeof renderNotifications === 'function') renderNotifications();
}

/* Pulls the logged-in user's durable state back from the backend into
   localStorage (the sync bus), then re-renders this tab. Runs on boot and on
   tab focus, so admin approvals land on the user dashboard live. */
async function syncFromServer() {
    try {
        /* No auth header — the HttpOnly cookie authenticates this request. */
        const res = await fetch('/api/me');
        if (res.status === 401) {
            /* The backend no longer recognizes this session — normal on Render's
               free tier, whose ephemeral DB is wiped on every restart/redeploy
               (tokens and user state disappear). If we were logged in (flag
               cookie present) keep the local dashboard and data instead of
               silently logging out. Only a real logout (flag already cleared)
               shows the login screen. */
            if (!hasSession() && typeof showLoginScreen === 'function') showLoginScreen();
            return;
        }
        if (!res.ok) return;
        const d = await res.json();
        /* Trust the server: a valid answer means we're logged in even if the
           local flag cookie was missing or stale. */
        if (typeof hideLoginScreen === 'function') hideLoginScreen();

        const srv = d.user || {};
        const srvState = srv.state || {};
        /* Merge instead of overwrite: keep any local transaction the server
           hasn't seen yet — e.g. a deposit whose debounced push was cut short
           by a refresh. Server wins on id conflicts (admin approvals); local
           rows that never landed survive. */
        const srvTx = Array.isArray(srvState.transactions) ? srvState.transactions : [];
        const srvIds = new Set(srvTx.map(t => t && t.id));
        const missing = (appData.transactions || []).filter(t => t && t.id && !srvIds.has(t.id));
        if (missing.length) srvState.transactions = srvTx.concat(missing);

        applyServerUser({ ...srv, state: srvState });
        /* Re-push so the server catches up with any recovered local rows. */
        if (missing.length) pushNow();
    } catch {}
    refreshApp();
}

/* Writes every balance figure in the DOM from the store.
   Safe on BOTH pages — every lookup is guarded, so on admin.html it's a no-op. */
function renderBalance() {
    const b = BALANCE.amount;
    document.querySelectorAll('.balance-figure').forEach(el => {
        el.dataset.amount = '$' + fmt(b);
        el.textContent = balanceVisible ? '$' + fmt(b) : '••••••••••';
    });
    const set = (id, v) => { const el = $(id); if (el) el.textContent = '$' + fmt(v); };
    set('chartValue', b);
    set('kpiBonus', BALANCE.bonus);
    set('kpiDeposit', BALANCE.deposit);
    set('kpiWithdrawal', BALANCE.withdrawal);
    set('transferAvailable', b);
}
