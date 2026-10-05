/* ---------- Swap Crypto view ---------- */
/* Asset universe derives from MARKET_ASSETS (js/market-data.js, loaded before
   this file) — BTC / ETH / USDT / BNB — plus a USD cash leg. Coin holdings live
   in the shared store (HOLDINGS) as dollar values; the USD leg is the unified
   cash balance (BALANCE.amount). Swap only ever moves these around — nothing
   is created or destroyed except the flat network fee, which debits cash. */

const SWAP_ASSETS = (() => {
    const out = {};
    ['BTC', 'ETH', 'USDT', 'BNB'].forEach(k => {
        const a = MARKET_ASSETS[k];
        out[k] = { name: a.name, rate: a.price, icon: a.icon, cls: a.cls, bal: 0 };
    });
    out.USD = { name: 'US Dollar', rate: 1, icon: 'fa-solid fa-dollar-sign', cls: 'text-emerald-400', bal: 0 };
    return out;
})();

/* Flat network fee (in USD) charged on coin→coin swaps. It debits the cash
   balance (USD leg), not the source coin. USD⇄coin swaps are fee-free — they
   just move cash to/from holdings. */
const SWAP_FEE_USD = 2.50;

/* Sync SWAP_ASSETS to the store before every render/check: coins from HOLDINGS,
   USD from the unified cash balance. */
function syncHoldings() {
    Object.keys(SWAP_ASSETS).forEach(k => {
        if (k === 'USD') SWAP_ASSETS.USD.bal = getBalance();
        else if (HOLDINGS[k] !== undefined) SWAP_ASSETS[k].bal = HOLDINGS[k];
    });
}

/* Commit the SWAP_ASSETS ledger back to the store (coins → HOLDINGS, USD → cash)
   in one persist + re-render. */
function commitSwapBalances() {
    Object.keys(SWAP_ASSETS).forEach(k => {
        if (k !== 'USD' && HOLDINGS[k] !== undefined) HOLDINGS[k] = SWAP_ASSETS[k].bal;
    });
    setBalances({ amount: SWAP_ASSETS.USD.bal });
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
    const fee = (swapFrom !== 'USD' && swapTo !== 'USD') ? SWAP_FEE_USD : 0;
    const feeInFrom = fee / from.rate;
    /* Amount is in USD (holdings are dollar-based). Received is in destination coins. */
    const received = amt > fee ? (amt - fee) / to.rate : 0;
    $('swapToAmount').value = received ? received.toFixed(6) : '';
    $('swapRate').textContent = '1 ' + swapFrom + ' = ' + (from.rate / to.rate).toFixed(4) + ' ' + swapTo;
    $('swapFromBal').textContent = '$' + fmt(from.bal);
    $('swapToBal').textContent = '$' + fmt(to.bal);
    const feeEl = $('swapFee');
    if (feeEl) feeEl.textContent = fee ? '$' + fee.toFixed(2) + ' (' + feeInFrom.toFixed(6) + ' ' + swapFrom + ')' : 'Free';
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

/* Asset Allocation card on the dashboard — driven by the same holdings.
   Cash (USD) is excluded: the allocation is about the coin wallet. */
function renderAllocation() {
    const list = $('allocationList');
    if (!list) return;
    const coins = Object.keys(SWAP_ASSETS).filter(k => k !== 'USD');
    const total = coins.reduce((a, k) => a + SWAP_ASSETS[k].bal, 0);
    const pct = k => total > 0 ? Math.round(SWAP_ASSETS[k].bal / total * 100) : 0;
    coins.forEach(k => {
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
        const n = coins.filter(k => SWAP_ASSETS[k].bal > 0).length;
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
    /* Coin→coin swaps pay the network fee from cash; USD legs are fee-free. */
    const fee = (swapFrom !== 'USD' && swapTo !== 'USD') ? SWAP_FEE_USD : 0;
    if (fee && getBalance() < fee) {
        showToast('Insufficient cash to cover the $' + SWAP_FEE_USD.toFixed(2) + ' network fee');
        return;
    }
    const btn = $('swapBtn');
    btn.disabled = true; btn.textContent = 'Processing…'; btn.classList.add('opacity-60');
    setTimeout(() => {
        if (swapFrom === 'USD') {
            /* USD → coin: cash leaves, coin enters at par (no fee). */
            SWAP_ASSETS.USD.bal -= amt;
            to.bal += amt;
        } else if (swapTo === 'USD') {
            /* coin → USD: coin leaves, cash enters (no fee). */
            from.bal -= amt;
            SWAP_ASSETS.USD.bal += amt;
        } else {
            /* coin → coin: source coin leaves, destination enters net of the
               cash fee — the fee is neither created nor destroyed. */
            from.bal -= amt;
            SWAP_ASSETS.USD.bal -= fee;
            to.bal += amt - fee;
        }
        const received = (amt - fee) / to.rate;   /* destination coin quantity */
        const tx = { id: txId(), type: 'swap', asset: from.name, to: to.name, amount: -amt, fee, date: todayStr(), time: nowStr(), status: 'completed' };
        TX_DATA.unshift(tx);
        commitSwapBalances();
        if (typeof notifyTransaction === 'function') notifyTransaction(tx);
        renderSwap();
        renderTransactions();
        renderDashboardRecent();
        $('swapFromAmount').value = '';
        updateSwapEstimate();
        btn.disabled = false; btn.textContent = 'Swap Now'; btn.classList.remove('opacity-60');
        showToast('Swapped $' + fmt(amt) + ' of ' + from.name + ' → ' + received.toFixed(6) + ' ' + to.name + (fee ? ' · fee $' + fee.toFixed(2) : ''));
    }, 1100);
}

function openSwapWith(sym) {
    if (SWAP_ASSETS[sym]) {
        if (sym === swapTo) flipSwap();
        else { swapFrom = sym; fillSwapSelects(); }
        updateSwapEstimate();
        showView('swap');
    } else if (typeof openTrade === 'function') {
        openTrade(sym);
    }
}
