/* ---------- Trade view ---------- */
/* Stocks + crypto bought/sold with the account balance (BALANCE). Positions are
   stored as share counts in the shared store (STOCK_POSITIONS) and persist. */

const TRADE_ASSETS = [
    { sym: 'AAPL', name: 'Apple',       price: 212.40,  change:  1.8, icon: 'fa-brands fa-apple',           cls: 'text-slate-200' },
    { sym: 'TSLA', name: 'Tesla',       price: 248.10,  change: -2.3, icon: 'fa-solid fa-car',             cls: 'text-rose-500' },
    { sym: 'GOOG', name: 'Alphabet',    price: 176.85,  change:  0.9, icon: 'fa-brands fa-google',         cls: 'text-indigo-300' },
    { sym: 'MSFT', name: 'Microsoft',   price: 428.60,  change:  1.2, icon: 'fa-brands fa-microsoft',      cls: 'text-blue-400' },
    { sym: 'AMZN', name: 'Amazon',      price: 183.90,  change:  0.4, icon: 'fa-brands fa-amazon',         cls: 'text-amber-300' },
    { sym: 'NVDA', name: 'Nvidia',      price: 1041.25, change:  3.6, icon: 'fa-solid fa-gamepad',         cls: 'text-emerald-400' },
    { sym: 'META', name: 'Meta',        price: 512.70,  change:  2.6, icon: 'fa-brands fa-infinity',       cls: 'text-sky-400' },
    { sym: 'NFLX', name: 'Netflix',     price: 634.15,  change: -1.1, icon: 'fa-solid fa-clapperboard',    cls: 'text-rose-400' },
    { sym: 'AMD',  name: 'AMD',         price: 158.92,  change:  0.7, icon: 'fa-solid fa-microchip',       cls: 'text-orange-400' },
    { sym: 'BTC',  name: 'Bitcoin',     price: 60274.00, change:  2.1, icon: 'fa-brands fa-bitcoin',       cls: 'text-amber-500' },
    { sym: 'ETH',  name: 'Ethereum',    price: 1617.82,  change: -0.8, icon: 'fa-brands fa-ethereum',      cls: 'text-indigo-400' },
    { sym: 'SOL',  name: 'Solana',      price: 144.28,  change:  3.2, icon: 'fa-solid fa-gem',             cls: 'text-violet-300' },
    { sym: 'ADA',  name: 'Cardano',     price: 0.4521,   change: -1.4, icon: 'fa-solid fa-layer-group',     cls: 'text-sky-300' },
    { sym: 'XRP',  name: 'XRP',         price: 0.5230,   change:  0.5, icon: 'fa-solid fa-wave-square',     cls: 'text-slate-300' },
    { sym: 'DOGE', name: 'Dogecoin',    price: 0.1523,   change:  4.1, icon: 'fa-solid fa-dog',            cls: 'text-amber-300' },
    { sym: 'LINK', name: 'Chainlink',   price: 14.62,    change: -0.3, icon: 'fa-solid fa-link',           cls: 'text-indigo-300' },
    { sym: 'BNB',  name: 'BNB',         price: 552.21,   change:  1.1, icon: 'fa-solid fa-coins',          cls: 'text-amber-400' }
];

let tradeSide = 'buy';
let tradeAssetSym = TRADE_ASSETS[0].sym;

const TRADE_BTN_ACTIVE = 'py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-accent';
const TRADE_BTN_INACTIVE = 'py-2.5 rounded-lg text-sm font-semibold bg-white/5 text-slate-400 hover:text-white';

function tradeAsset() { return TRADE_ASSETS.find(a => a.sym === tradeAssetSym) || TRADE_ASSETS[0]; }

function fillTradeSelect() {
    const sel = $('tradeAsset');
    if (!sel) return;
    sel.innerHTML = TRADE_ASSETS.map(a => '<option value="' + a.sym + '" class="bg-slate-900">' + a.name + ' (' + a.sym + ')</option>').join('');
    sel.value = tradeAssetSym;
}

function tradeAssetChanged() {
    tradeAssetSym = $('tradeAsset').value;
    updateTradeEstimate();
    startTradeLiveChart(tradeAssetSym);
}

function setTradeSide(side) {
    tradeSide = side;
    document.querySelectorAll('[data-trade-side]').forEach(b => {
        b.className = b.dataset.tradeSide === side ? TRADE_BTN_ACTIVE : TRADE_BTN_INACTIVE;
    });
    const btn = $('tradeBtn');
    if (btn) btn.textContent = side === 'buy' ? 'Buy Now' : 'Sell Now';
    updateTradeEstimate();
}

function updateTradeEstimate() {
    const a = tradeAsset();
    const amt = parseFloat($('tradeAmount').value) || 0;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('tradeAvail', '$' + fmt(getBalance()));
    set('tradePos', (STOCK_POSITIONS[tradeAssetSym] || 0).toFixed(4) + ' shares');
    set('tradeSideLabel', tradeSide === 'buy' ? 'Buying' : 'Selling');
    set('tradeEstimate', amt > 0
        ? tradeSide === 'buy'
            ? '≈ ' + (amt / a.price).toFixed(4) + ' shares'
            : '≈ $' + fmt(amt) + ' payout for ' + (amt / a.price).toFixed(4) + ' shares'
        : '—');
}

function doTrade() {
    const a = tradeAsset();
    const amt = parseFloat($('tradeAmount').value);
    if (!amt || amt <= 0) { showToast('Enter an amount to trade'); return; }
    if (tradeSide === 'buy') {
        if (amt > getBalance()) { showToast('Insufficient balance — you have $' + fmt(getBalance())); return; }
        const qty = amt / a.price;
        STOCK_POSITIONS[a.sym] = (STOCK_POSITIONS[a.sym] || 0) + qty;
        setBalances({ amount: getBalance() - amt });
        const tx = { id: txId(), type: 'trade', asset: a.name, amount: -amt, date: todayStr(), time: nowStr(), status: 'completed' };
        TX_DATA.unshift(tx);
        saveApp();
        if (typeof notifyTransaction === 'function') notifyTransaction(tx);
        showToast('Bought ' + qty.toFixed(4) + ' ' + a.sym + ' for $' + fmt(amt));
    } else {
        const qty = amt / a.price;
        const held = STOCK_POSITIONS[a.sym] || 0;
        if (qty > held) { showToast('You only hold ' + held.toFixed(4) + ' shares of ' + a.sym); return; }
        STOCK_POSITIONS[a.sym] = held - qty;
        if (STOCK_POSITIONS[a.sym] <= 0.000001) delete STOCK_POSITIONS[a.sym];
        setBalances({ amount: getBalance() + amt });
        const tx = { id: txId(), type: 'trade', asset: a.name, amount: amt, date: todayStr(), time: nowStr(), status: 'completed' };
        TX_DATA.unshift(tx);
        saveApp();
        if (typeof notifyTransaction === 'function') notifyTransaction(tx);
        showToast('Sold ' + qty.toFixed(4) + ' ' + a.sym + ' for $' + fmt(amt));
    }
    renderTrade();
    renderTransactions();
    renderDashboardRecent();
    const amount = $('tradeAmount');
    if (amount) amount.value = '';
    updateTradeEstimate();
}

function renderTrade() {
    fillTradeSelect();
    updateTradeEstimate();
    renderTradeMarket();
    renderTradePortfolio();
    startTradeLiveChart(tradeAssetSym);
}

/* ---------- Live-flow chart (Trade view) ---------- */
/* Self-contained mini chart using its own ids (tl*) so it never clashes with
   the dashboard chart (linePath/areaPath). A random walk around the selected
   asset's price, redrawn on an interval. */
const TL_W = 720, TL_PL = 46, TL_PR = 10, TL_PT = 14, TL_PB = 22;
let tlH = 220, tlSeries = [], tlTimer = null, tlBase = 100;

/* Matches the SVG viewBox ratio to the card's rendered size so the chart always
   spans the FULL card width/height (re-measured each tick — safe while the Trade
   view is hidden, it corrects itself once visible). */
function tlSize() {
    const wrap = $('tlWrap');
    const svg = $('tlLine') ? $('tlLine').closest('svg') : null;
    if (!wrap || !svg) return;
    const Wc = wrap.clientWidth || 720;
    const Hc = wrap.clientHeight || 220;
    const h = 720 * (Hc / Wc);
    if (Math.abs(h - tlH) > 0.5) {
        tlH = Math.max(80, h);
        svg.setAttribute('viewBox', '0 0 720 ' + tlH.toFixed(1));
    }
}

function tlPath(pts) {
    if (pts.length < 2) return '';
    let d = 'M ' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) {
        d += ' L ' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    }
    return d;
}

function startTradeLiveChart(sym) {
    const line = $('tlLine');
    if (!line) return;                       /* element only exists in the Trade view */
    const a = TRADE_ASSETS.find(x => x.sym === sym) || TRADE_ASSETS[0];
    tlBase = a.price;
    const n = 40;
    tlSeries = [];
    let p = tlBase * 0.985;
    for (let i = 0; i < n; i++) {
        tlSeries.push(p);
        p += p * (Math.random() - 0.5) * 0.012;
    }
    tlSeries.push(tlBase);
    const asset = $('tradeLiveAsset');
    if (asset) asset.textContent = a.name + ' (' + a.sym + ')';
    const sub = $('tradeLiveSub');
    if (sub) sub.textContent = a.sym + ' / USD · live';
    drawTradeChart();
    clearInterval(tlTimer);
    tlTimer = setInterval(() => {
        if (!$('tlLine')) { clearInterval(tlTimer); tlTimer = null; return; }
        const last = tlSeries[tlSeries.length - 1];
        tlSeries.push(last + last * (Math.random() - 0.5) * 0.012);
        if (tlSeries.length > 60) tlSeries.shift();
        drawTradeChart();
    }, 1500);
}

function drawTradeChart() {
    if (!tlSeries.length) return;
    tlSize();
    const min = Math.min(...tlSeries), max = Math.max(...tlSeries);
    const span = (max - min) || 1;
    const IW = TL_W - TL_PL - TL_PR, IH = tlH - TL_PT - TL_PB;
    const x = i => TL_PL + (IW * i) / (tlSeries.length - 1);
    const y = v => TL_PT + IH - (IH * (v - min)) / span;
    const pts = tlSeries.map((v, i) => [x(i), y(v)]);

    const grid = $('tlGrid');
    if (grid) {
        const rows = [];
        for (let g = 0; g <= 3; g++) {
            const gy = TL_PT + (IH * g) / 3;
            const val = max - (span * g) / 3;
            rows.push('<line x1="' + TL_PL + '" y1="' + gy.toFixed(1) + '" x2="' + (TL_W - TL_PR) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>');
            rows.push('<text x="' + (TL_PL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="fill-slate-500" font-size="10">' + fmtCompact(val) + '</text>');
        }
        grid.innerHTML = rows.join('');
    }
    const area = $('tlArea');
    if (area) area.setAttribute('d', tlPath(pts) + ' L ' + pts[pts.length - 1][0].toFixed(1) + ' ' + (tlH - TL_PB) + ' L ' + pts[0][0].toFixed(1) + ' ' + (tlH - TL_PB) + ' Z');
    const line = $('tlLine');
    if (line) line.setAttribute('d', tlPath(pts));

    const cur = tlSeries[tlSeries.length - 1];
    const chg = ((cur - tlBase) / tlBase) * 100;
    const price = $('tradeLivePrice');
    if (price) {
        price.textContent = '$' + fmt(cur);
        price.className = chg >= 0 ? 'text-sm font-semibold fig text-emerald-300' : 'text-sm font-semibold fig text-rose-300';
    }
    const change = $('tradeLiveChange');
    if (change) {
        change.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
        change.className = chg >= 0 ? 'text-xs font-semibold text-emerald-300' : 'text-xs font-semibold text-rose-300';
    }
}

function renderTradeMarket() {
    const tbody = $('tradeMarketBody');
    if (!tbody) return;
    tbody.innerHTML = TRADE_ASSETS.map(a => `
        <tr class="hover:bg-white/[0.03] transition border-b border-white/5">
            <td class="px-2 py-3.5">
                <span class="inline-flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center"><i class="${a.icon} ${a.cls}"></i></span>
                    <span>
                        <span class="block text-sm font-semibold text-white">${a.name}</span>
                        <span class="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider">${a.sym}</span>
                    </span>
                </span>
            </td>
            <td class="px-2 py-3.5 text-right text-white font-semibold fig">$${fmt(a.price)}</td>
            <td class="px-2 py-3.5 text-right ${a.change >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold fig">${a.change >= 0 ? '+' : ''}${a.change}%</td>
            <td class="px-2 py-3.5 text-right">
                <button onclick="openTrade('${a.sym}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/25 transition">Trade</button>
            </td>
        </tr>`).join('');
}

function openTrade(sym) {
    tradeAssetSym = sym;
    fillTradeSelect();
    setTradeSide('buy');
    startTradeLiveChart(sym);
}

function renderTradePortfolio() {
    const list = $('tradePortfolio');
    if (!list) return;
    const rows = Object.entries(STOCK_POSITIONS).map(([sym, qty]) => {
        const a = TRADE_ASSETS.find(x => x.sym === sym);
        return a && qty > 0 ? { a, qty, value: qty * a.price } : null;
    }).filter(Boolean);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const totalEl = $('tradePortfolioTotal');
    if (totalEl) totalEl.textContent = '$' + fmt(total);
    list.innerHTML = rows.length ? rows.map(r => `
        <li class="flex items-center gap-3 py-2.5">
            <span class="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><i class="${r.a.icon} ${r.a.cls}"></i></span>
            <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold text-white truncate">${r.a.name} <span class="text-slate-500 font-semibold">${r.a.sym}</span></span>
                <span class="block text-[11px] text-slate-500">${r.qty.toFixed(4)} shares · $${fmt(r.a.price)}</span>
            </span>
            <span class="text-sm font-semibold text-white fig">$${fmt(r.value)}</span>
        </li>`).join('')
        : '<li class="py-6 text-center text-slate-500 text-xs">No open positions yet — buy your first asset.</li>';
}
