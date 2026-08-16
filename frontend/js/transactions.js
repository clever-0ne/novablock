/* ---------- Transactions view ---------- */
/* NOTE: `TX_DATA` is provided by js/store.js (shared persisted data layer). */

const TX_TYPES = {
    deposit:    { label: 'Deposit',        icon: 'fa-arrow-down-long', cls: 'bg-emerald-500/15 text-emerald-300' },
    withdrawal: { label: 'Withdrawal',     icon: 'fa-arrow-up-long',   cls: 'bg-rose-500/15 text-rose-300' },
    swap:       { label: 'Swap',           icon: 'fa-rotate',          cls: 'bg-indigo-500/15 text-indigo-300' },
    bonus:      { label: 'Referral Bonus', icon: 'fa-users',           cls: 'bg-amber-500/15 text-amber-300' },
    transfer:   { label: 'Transfer',       icon: 'fa-paper-plane',     cls: 'bg-sky-500/15 text-sky-300' },
    trade:      { label: 'Trade',          icon: 'fa-chart-line',      cls: 'bg-sky-500/15 text-sky-300' }
};

const TX_STATUS = {
    completed: { label: 'Completed', icon: 'fa-check', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' },
    pending:   { label: 'Pending',   icon: 'fa-clock', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/20' },
    failed:    { label: 'Failed',    icon: 'fa-xmark', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/20' }
};

const TX_ASSET_ICON = {
    'Bitcoin':  { icon: 'fa-brands fa-bitcoin',    cls: 'text-amber-500' },
    'Ethereum': { icon: 'fa-brands fa-ethereum',   cls: 'text-indigo-400' },
    'USDT':     { icon: 'fa-solid fa-dollar-sign', cls: 'text-emerald-400' },
    'BNB':      { icon: 'fa-solid fa-coins',       cls: 'text-amber-400' },
    'Reward':   { icon: 'fa-solid fa-gift',        cls: 'text-amber-400' }
};

let txFilter = 'all';

function setTxFilter(filter, btn) {
    txFilter = filter;
    document.querySelectorAll('[data-tx-filter]').forEach(b => {
        const active = b.dataset.txFilter === filter;
        b.className = 'px-3 py-1.5 rounded-lg transition text-xs font-medium ' + (active
            ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-accent'
            : 'text-slate-400 hover:text-white');
    });
    renderTransactions();
}

function txRow(t) {
    const T = TX_TYPES[t.type], S = TX_STATUS[t.status];
    const A = TX_ASSET_ICON[t.asset] || { icon: 'fa-solid fa-circle', cls: 'text-slate-400' };
    const sign = t.amount > 0 ? '+' : '-';
    const amtCls = t.amount > 0 ? 'text-emerald-300' : 'text-rose-300';
    return `
        <tr class="hover:bg-white/[0.03] transition">
            <td class="px-5 py-4">
                <span class="inline-flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg ${T.cls} flex items-center justify-center"><i class="fa-solid ${T.icon} text-[10px]"></i></span>
                    <span class="text-slate-200 font-semibold">${T.label}</span>
                </span>
            </td>
            <td class="px-5 py-4"><span class="inline-flex items-center gap-2 text-slate-300"><i class="${A.icon} ${A.cls}"></i> ${t.asset}</span></td>
            <td class="px-5 py-4 text-right font-semibold fig ${amtCls}">${sign}$${fmt(Math.abs(t.amount))}</td>
            <td class="px-5 py-4 text-slate-400 hidden md:table-cell">${t.date} · ${t.time}</td>
            <td class="px-5 py-4 text-right">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold ${S.cls} border rounded-md"><i class="fa-solid ${S.icon} text-[9px]"></i>${S.label}</span>
            </td>
        </tr>`;
}

function renderTransactions() {
    const q = ($('txSearch') ? $('txSearch').value : '').trim().toLowerCase();
    const rows = TX_DATA.filter(t => {
        if (txFilter !== 'all' && t.type !== txFilter) return false;
        if (!q) return true;
        const hay = (t.asset + ' ' + TX_TYPES[t.type].label + ' ' + TX_STATUS[t.status].label).toLowerCase();
        return hay.includes(q);
    });

    const body = $('txBody');
    if (body) {
        body.innerHTML = rows.length
            ? rows.map(txRow).join('')
            : '<tr><td colspan="5" class="px-5 py-14 text-center text-slate-500 text-sm">No transactions match your filters.</td></tr>';
    }

    // summary chips
    const totalIn = rows.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0);
    const totalOut = rows.filter(r => r.amount < 0).reduce((a, r) => a + r.amount, 0);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('txSumIn', '$' + fmt(totalIn));
    set('txSumOut', '$' + fmt(Math.abs(totalOut)));
    set('txSumCount', rows.length + (rows.length === 1 ? ' transaction' : ' transactions'));
    set('txSumLast', rows.length ? rows[0].date + ' · ' + rows[0].time : '—');
}

/* ---------- Deposit / Withdraw submission (pending → admin approval) ---------- */

/* Dashboard "Recent transactions" table — same rows as the Transactions view. */
function renderDashboardRecent() {
    const body = $('dashRecentBody');
    if (!body) return;
    body.innerHTML = TX_DATA.length
        ? TX_DATA.slice(0, 4).map(txRow).join('')
        : '<tr><td colspan="5" class="px-5 py-10 text-center text-slate-500 text-sm">No transactions yet — make a deposit to get started.</td></tr>';
}

/* Shows the coin's deposit wallet (from the shared store — admin-editable). */
function renderDepositWallet() {
    const box = $('depositWalletBox');
    if (!box) return;
    const method = $('depositMethod') ? $('depositMethod').value : '';
    const addr = (DEPOSIT_ADDRESSES || {})[method];
    if (!addr) { box.classList.add('hidden'); box.classList.remove('block'); return; }
    const label = $('depositWalletLabel'), input = $('depositWalletAddress');
    if (label) label.textContent = 'Send ' + method + ' to this address (copy it)';
    if (input) input.value = addr;
    box.classList.remove('hidden');
    box.classList.add('block');
}

function copyDepositWallet() {
    const input = $('depositWalletAddress');
    if (!input || !input.value) return;
    copyText(input.value);
    showToast('Deposit address copied');
}

function handleDeposit(e) {
    e.preventDefault();
    const amt = parseFloat($('depositAmount').value);
    if (!amt || amt <= 0) { showToast('Enter a valid deposit amount'); return; }
    const method = $('depositMethod') ? $('depositMethod').value : 'Bitcoin';
    const asset = method === 'Bitcoin' ? 'Bitcoin' : method === 'Ethereum' ? 'Ethereum' : 'USDT';
    const to = (DEPOSIT_ADDRESSES || {})[method] || '';

    // Pending until admin approves — approval credits the coin's holding.
    TX_DATA.unshift({ type: 'deposit', asset, amount: amt, date: todayStr(), time: nowStr(), status: 'pending', to });
    saveApp();
    renderTransactions();
    renderDashboardRecent();
    toggleModal('depositModal');
    showToast('Deposit request submitted — send to the wallet shown and await admin approval');
}

/* Shows the selected coin's available holding in the withdraw modal. */
function renderWithdrawCoin() {
    const coin = $('withdrawCoin') ? $('withdrawCoin').value : 'Bitcoin';
    const key = assetToKey(coin);
    const av = key ? (HOLDINGS[key] || 0) : 0;
    const el = $('withdrawAvailable');
    if (el) el.textContent = 'Available: $' + fmt(av);
}

function handleWithdraw(e) {
    e.preventDefault();
    const amt = parseFloat($('withdrawAmount').value);
    if (!amt || amt <= 0) { showToast('Enter a valid withdrawal amount'); return; }
    const coin = $('withdrawCoin') ? $('withdrawCoin').value : 'Bitcoin';
    const key = assetToKey(coin);
    const held = key ? (HOLDINGS[key] || 0) : 0;
    if (amt > held) { showToast('Insufficient ' + coin + ' balance'); return; }
    const dest = $('withdrawDestination').value.trim();
    if (!dest) { showToast('Enter a wallet destination'); return; }
    // Pending until admin approves — approval deducts the coin's holding.
    TX_DATA.unshift({ type: 'withdrawal', asset: coin, amount: -amt, date: todayStr(), time: nowStr(), status: 'pending' });
    saveApp();
    renderTransactions();
    renderDashboardRecent();
    toggleModal('withdrawModal');
    showToast('Withdrawal request submitted — pending admin approval');
}
