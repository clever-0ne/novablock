/* ---------- Topbar live search ---------- */
/* Searches coins, transactions and pages; keyboard + click navigation. */

const SEARCH_PAGES = [
    { key: 'dashboard',    label: 'Dashboard',            sub: 'Overview & portfolio',   icon: 'fa-chart-line' },
    { key: 'profile',      label: 'Profile',              sub: 'Personal information',   icon: 'fa-user' },
    { key: 'transactions', label: 'Transactions',         sub: 'Account activity',       icon: 'fa-list-check' },
    { key: 'swap',         label: 'Swap Crypto',          sub: 'Convert assets',         icon: 'fa-rotate' },
    { key: 'transfer',     label: 'Transfer Funds',       sub: 'Send money',             icon: 'fa-paper-plane' },
    { key: 'referrals',    label: 'Referrals',            sub: 'Earn commissions',       icon: 'fa-users' },
    { key: 'kyc',          label: 'Verification Center',  sub: 'KYC status',             icon: 'fa-shield-halved' }
];

const SEARCH_CHANGE = { BTC: '+2.99%', ETH: '+3.26%', USDT: '+0.03%', BNB: '+1.12%' };

let searchIndex = -1;

function searchCoins(q) {
    return Object.entries(SWAP_ASSETS).filter(([sym, a]) =>
        !q || a.name.toLowerCase().includes(q) || sym.toLowerCase().includes(q)
    ).map(([sym, a]) => ({ sym, name: a.name, price: a.rate, icon: a.icon, cls: a.cls }));
}

function searchTx(q) {
    if (!q) return [];
    return TX_DATA.filter(t =>
        (t.asset + ' ' + TX_TYPES[t.type].label + ' ' + TX_STATUS[t.status].label).toLowerCase().includes(q)
    ).slice(0, 5);
}

function searchPages(q) {
    return SEARCH_PAGES.filter(p => !q || p.label.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q));
}

function onSearchInput() {
    const panel = $('searchResults');
    if (!panel) return;
    const q = $('topSearch').value.trim().toLowerCase();
    searchIndex = -1;
    if (!q) { panel.classList.add('hidden'); return; }

    const coins = searchCoins(q);
    const txs = searchTx(q);
    const pages = searchPages(q);

    if (!coins.length && !txs.length && !pages.length) {
        panel.innerHTML = '<p class="px-3 py-4 text-center text-xs text-slate-500">No results for "' + $('topSearch').value + '"</p>';
    } else {
        let h = '';
        if (coins.length) h += '<p class="px-3 pt-2.5 pb-1 text-[10px] text-slate-500 uppercase tracking-widest">Coins</p>' + coins.map(coinRow).join('');
        if (txs.length) h += '<p class="px-3 pt-2.5 pb-1 text-[10px] text-slate-500 uppercase tracking-widest">Transactions</p>' + txs.map(searchTxRow).join('');
        if (pages.length) h += '<p class="px-3 pt-2.5 pb-1 text-[10px] text-slate-500 uppercase tracking-widest">Pages</p>' + pages.map(pageRow).join('');
        panel.innerHTML = h;
    }
    panel.classList.remove('hidden');
}

function coinRow(c) {
    return `
        <button onclick="searchGo('coin','${c.sym}')" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition text-left">
            <span class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center"><i class="${c.icon} ${c.cls}"></i></span>
            <span class="flex-1 min-w-0">
                <span class="block text-xs font-semibold text-white">${c.name} <span class="text-slate-500 font-normal">${c.sym}</span></span>
                <span class="block text-[10px] text-slate-500">$${fmt(c.price)}</span>
            </span>
            <span class="text-[10px] font-semibold ${SEARCH_CHANGE[c.sym] && SEARCH_CHANGE[c.sym].startsWith('+') ? 'text-emerald-300' : 'text-rose-300'}">${SEARCH_CHANGE[c.sym] || ''}</span>
        </button>`;
}

function searchTxRow(t) {
    const T = TX_TYPES[t.type];
    const A = TX_ASSET_ICON[t.asset] || { icon: 'fa-solid fa-circle', cls: 'text-slate-400' };
    return `
        <button onclick="searchGo('tx','${t.asset}')" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition text-left">
            <span class="w-8 h-8 rounded-lg ${T.cls} flex items-center justify-center"><i class="fa-solid ${T.icon} text-[10px]"></i></span>
            <span class="flex-1 min-w-0">
                <span class="block text-xs font-semibold text-white">${T.label} · ${t.asset}</span>
                <span class="block text-[10px] text-slate-500">${t.date} · ${t.time}</span>
            </span>
            <span class="text-[10px] font-semibold ${t.amount > 0 ? 'text-emerald-300' : 'text-rose-300'} fig">${t.amount > 0 ? '+' : '-'}$${fmt(Math.abs(t.amount))}</span>
        </button>`;
}

function pageRow(p) {
    return `
        <button onclick="searchGo('page','${p.key}')" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition text-left">
            <span class="w-8 h-8 rounded-lg bg-white/5 text-slate-300 flex items-center justify-center"><i class="fa-solid ${p.icon} text-xs"></i></span>
            <span class="flex-1 min-w-0">
                <span class="block text-xs font-semibold text-white">${p.label}</span>
                <span class="block text-[10px] text-slate-500">${p.sub}</span>
            </span>
            <i class="fa-solid fa-arrow-right text-[10px] text-slate-600"></i>
        </button>`;
}

function closeSearch() {
    $('topSearch').value = '';
    $('searchResults').classList.add('hidden');
    searchIndex = -1;
}

function searchGo(action, value) {
    closeSearch();
    if (action === 'coin') { openSwapWith(value); }
    else if (action === 'page') { showView(value); }
    else if (action === 'tx') {
        showView('transactions');
        const s = $('txSearch');
        if (s) s.value = value;
        setTxFilter('all', null);
        showToast('Showing ' + value + ' transactions');
    }
}

function onSearchKeydown(e) {
    const panel = $('searchResults');
    if (!panel || panel.classList.contains('hidden')) return true;
    const items = panel.querySelectorAll('button');
    if (e.key === 'Escape') { closeSearch(); return false; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        searchIndex = e.key === 'ArrowDown' ? Math.min(searchIndex + 1, items.length - 1) : Math.max(searchIndex - 1, 0);
        const el = items[searchIndex];
        if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
        return false;
    }
    if (e.key === 'Enter' && searchIndex >= 0 && items[searchIndex]) {
        items[searchIndex].click();
        return false;
    }
    return true;
}

document.addEventListener('click', e => {
    const wrap = $('topSearchWrap');
    if (wrap && !wrap.contains(e.target)) closeSearch();
});
