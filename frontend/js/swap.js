/* ---------- Swap Crypto view ---------- */

const SWAP_ASSETS = {
    BTC:  { name: 'Bitcoin',  rate: 60274.00, icon: 'fa-brands fa-bitcoin',    cls: 'text-amber-500',   bal: 0 },
    ETH:  { name: 'Ethereum', rate: 1617.82,  icon: 'fa-brands fa-ethereum',   cls: 'text-indigo-400',  bal: 0 },
    USDT: { name: 'Tether',   rate: 1,        icon: 'fa-solid fa-dollar-sign', cls: 'text-emerald-400', bal: 0 },
    BNB:  { name: 'BNB',      rate: 552.21,   icon: 'fa-solid fa-coins',       cls: 'text-amber-400',   bal: 0 }
};

/* Flat network fee (in USD), deducted from the source coin before conversion. */
const SWAP_FEE_USD = 2.50;

/* Per-asset balances live in the shared store (HOLDINGS) — zeroed whenever a
   transaction is initiated. Sync SWAP_ASSETS to it before every render. */
function syncHoldings() {
    Object.keys(SWAP_ASSETS).forEach(k => {
        if (HOLDINGS[k] !== undefined) SWAP_ASSETS[k].bal = HOLDINGS[k];
    });
}

function saveHoldings() {
    Object.keys(SWAP_ASSETS).forEach(k => { if (HOLDINGS[k] !== undefined) HOLDINGS[k] = SWAP_ASSETS[k].bal; });
    saveApp();
}

let swapFrom = 'BTC', swapTo = 'ETH';

function fillSwapSelects() {
    const selFrom = $('swapFrom'), selTo = $('swapTo');
    if (!selFrom || !selTo) return;
    const opt = (key, disabled) => {
        const a = SWAP_ASSETS[key];
        return '<option value="' + key + '" class="bg-slate-900"' + (disabled ? ' disabled' : '') + '>' + a.name + ' (' + key + ')</option>';
    };
    selFrom.innerHTML = Object.keys(SWAP_ASSETS).map(k => opt(k, k === swapTo)).join('');
    selTo.innerHTML = Object.keys(SWAP_ASSETS).map(k => opt(k, k === swapFrom)).join('');
    selFrom.value = swapFrom;
    selTo.value = swapTo;
}

function swapFromChanged() { swapFrom = $('swapFrom').value; fillSwapSelects(); updateSwapEstimate(); }
function swapToChanged() { swapTo = $('swapTo').value; fillSwapSelects(); updateSwapEstimate(); }

function flipSwap() {
    const t = swapFrom; swapFrom = swapTo; swapTo = t;
    fillSwapSelects();
    updateSwapEstimate();
}

function resetSwap() {
    swapFrom = 'BTC'; swapTo = 'ETH';
    $('swapFromAmount').value = '';
    fillSwapSelects();
    updateSwapEstimate();
}

function updateSwapEstimate() {
    const amt = parseFloat($('swapFromAmount').value) || 0;
    const from = SWAP_ASSETS[swapFrom], to = SWAP_ASSETS[swapTo];
    const feeInFrom = SWAP_FEE_USD / from.rate;
    /* Amount is in USD (holdings are dollar-based). Received is in destination coins. */
    const received = amt > SWAP_FEE_USD ? (amt - SWAP_FEE_USD) / to.rate : 0;
    $('swapToAmount').value = received ? received.toFixed(6) : '';
    $('swapRate').textContent = '1 ' + swapFrom + ' = ' + (from.rate / to.rate).toFixed(4) + ' ' + swapTo;
    $('swapFromBal').textContent = '$' + fmt(from.bal);
    $('swapToBal').textContent = '$' + fmt(to.bal);
    const fee = $('swapFee');
    if (fee) fee.textContent = '$' + SWAP_FEE_USD.toFixed(2) + ' (' + feeInFrom.toFixed(6) + ' ' + swapFrom + ')';
}

function renderSwapBalances() {
    const ul = $('swapBalances');
    if (!ul) return;
    ul.innerHTML = Object.entries(SWAP_ASSETS).map(([k, a]) => `
        <li class="flex items-center gap-3 py-2.5">
            <span class="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><i class="${a.icon} ${a.cls}"></i></span>
            <span class="flex-1 text-sm text-slate-200 font-semibold truncate">${a.name}</span>
            <span class="text-sm font-semibold text-white fig">$${fmt(a.bal)}</span>
        </li>`).join('');
}

function renderSwapRecent() {
    const ul = $('swapRecent');
    if (!ul) return;
    const swaps = TX_DATA.filter(t => t.type === 'swap').slice(0, 3);
    ul.innerHTML = swaps.length ? swaps.map(t => `
        <li class="flex items-center gap-3 py-2.5 text-sm">
            <span class="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0"><i class="fa-solid fa-rotate text-[10px]"></i></span>
            <span class="flex-1 text-slate-200 font-semibold truncate">${t.asset}${t.to ? ' → ' + t.to : ''}</span>
            <span class="text-rose-300 font-semibold fig">-$${fmt(Math.abs(t.amount))}</span>
        </li>`).join('') : '<li class="text-xs text-slate-500 py-2.5">No swaps yet.</li>';
}

function renderSwap() {
    syncHoldings();
    fillSwapSelects();
    updateSwapEstimate();
    renderSwapBalances();
    renderSwapRecent();
    renderAllocation();
}

/* Asset Allocation card on the dashboard — driven by the same holdings. */
function renderAllocation() {
    const list = $('allocationList');
    if (!list) return;
    const total = Object.values(SWAP_ASSETS).reduce((a, x) => a + x.bal, 0);
    const pct = k => total > 0 ? Math.round(SWAP_ASSETS[k].bal / total * 100) : 0;
    Object.keys(SWAP_ASSETS).forEach(k => {
        const p = pct(k);
        const bar = $('allocBar' + k);
        if (bar) bar.style.width = (p ? p : 0) + '%';
        const amt = $('allocAmt' + k);
        if (amt) amt.textContent = '$' + fmt(SWAP_ASSETS[k].bal);
        const pctEl = $('allocPct' + k);
        if (pctEl) pctEl.textContent = (p ? p : 0) + '%';
        const row = $('allocRow' + k);
        if (row) row.classList.toggle('hidden', SWAP_ASSETS[k].bal === 0);
    });
    const count = $('allocCount');
    if (count) {
        const n = Object.keys(SWAP_ASSETS).filter(k => SWAP_ASSETS[k].bal > 0).length;
        count.textContent = n === 1 ? '1 Asset' : n + (n === 0 ? ' Assets' : ' Assets');
    }
}

function doSwap() {
    syncHoldings();   /* always use the freshest store holdings for the check */
    const from = SWAP_ASSETS[swapFrom], to = SWAP_ASSETS[swapTo];
    const amt = parseFloat($('swapFromAmount').value);
    if (!amt || amt <= 0) { showToast('Enter an amount to swap'); return; }
    if (amt > from.bal) {
        showToast(from.bal > 0
            ? 'Insufficient ' + from.name + ' balance — you have $' + fmt(from.bal)
            : 'No ' + from.name + ' holdings yet — deposit ' + from.name + ' and get it approved before swapping');
        return;
    }
    if (amt <= SWAP_FEE_USD) { showToast('Amount too small — must cover the $' + SWAP_FEE_USD.toFixed(2) + ' network fee'); return; }
    const btn = $('swapBtn');
    btn.disabled = true; btn.textContent = 'Processing…'; btn.classList.add('opacity-60');
    setTimeout(() => {
        from.bal -= amt;                 /* $ value leaves the source coin */
        to.bal += amt - SWAP_FEE_USD;    /* $ value enters the destination coin, net of fee */
        const received = (amt - SWAP_FEE_USD) / to.rate;   /* destination coin quantity */
        const tx = { type: 'swap', asset: from.name, to: to.name, amount: -amt, date: todayStr(), time: nowStr(), status: 'completed' };
        TX_DATA.unshift(tx);
        saveHoldings();
        if (typeof notifyTransaction === 'function') notifyTransaction(tx);
        renderSwap();
        renderTransactions();
        renderDashboardRecent();
        $('swapFromAmount').value = '';
        updateSwapEstimate();
        btn.disabled = false; btn.textContent = 'Swap Now'; btn.classList.remove('opacity-60');
        showToast('Swapped $' + fmt(amt) + ' of ' + from.name + ' → ' + received.toFixed(6) + ' ' + to.name + ' · fee $' + SWAP_FEE_USD.toFixed(2));
    }, 1100);
}

function openSwapWith(sym) {
    if (SWAP_ASSETS[sym]) {
        if (sym === swapTo) flipSwap();
        else { swapFrom = sym; fillSwapSelects(); }
        updateSwapEstimate();
    }
    showView('swap');
}
