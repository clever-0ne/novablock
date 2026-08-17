/* ---------- Market data (single source of truth) ---------- */
/* Every price/change/icon for the whole app comes from MARKET_ASSETS — the
   dashboard ticker, the Trade view's markets table, the Swap asset selector
   and the topbar search all read from here. Swap/trade rates are never
   duplicated anywhere else. Loaded after store.js on dashboard.html; nothing
   here touches the DOM until renderTicker() is called. */

const MARKET_ASSETS = {
    AAPL: { sym: 'AAPL', name: 'Apple',        price: 212.40,  change:  1.8, icon: 'fa-brands fa-apple',        cls: 'text-slate-200' },
    TSLA: { sym: 'TSLA', name: 'Tesla',        price: 248.10,  change: -2.3, icon: 'fa-solid fa-car',           cls: 'text-rose-500' },
    GOOG: { sym: 'GOOG', name: 'Alphabet',     price: 176.85,  change:  0.9, icon: 'fa-brands fa-google',       cls: 'text-indigo-300' },
    MSFT: { sym: 'MSFT', name: 'Microsoft',    price: 428.60,  change:  1.2, icon: 'fa-brands fa-microsoft',    cls: 'text-blue-400' },
    AMZN: { sym: 'AMZN', name: 'Amazon',       price: 183.90,  change:  0.4, icon: 'fa-brands fa-amazon',       cls: 'text-amber-300' },
    NVDA: { sym: 'NVDA', name: 'Nvidia',       price: 1041.25, change:  3.6, icon: 'fa-solid fa-gamepad',       cls: 'text-emerald-400' },
    META: { sym: 'META', name: 'Meta',         price: 512.70,  change:  2.6, icon: 'fa-brands fa-infinity',     cls: 'text-sky-400' },
    NFLX: { sym: 'NFLX', name: 'Netflix',      price: 634.15,  change: -1.1, icon: 'fa-solid fa-clapperboard',  cls: 'text-rose-400' },
    AMD:  { sym: 'AMD',  name: 'AMD',          price: 158.92,  change:  0.7, icon: 'fa-solid fa-microchip',     cls: 'text-orange-400' },
    BTC:  { sym: 'BTC',  name: 'Bitcoin',      price: 60274.00, change:  2.1, icon: 'fa-brands fa-bitcoin',     cls: 'text-amber-500' },
    ETH:  { sym: 'ETH',  name: 'Ethereum',     price: 1617.82,  change: -0.8, icon: 'fa-brands fa-ethereum',    cls: 'text-indigo-400' },
    USDT: { sym: 'USDT', name: 'Tether',       price: 1,        change:  0.03, icon: 'fa-solid fa-dollar-sign',  cls: 'text-emerald-400' },
    SOL:  { sym: 'SOL',  name: 'Solana',       price: 144.28,   change:  3.2, icon: 'fa-solid fa-gem',          cls: 'text-violet-300' },
    ADA:  { sym: 'ADA',  name: 'Cardano',      price: 0.4521,   change: -1.4, icon: 'fa-solid fa-layer-group',  cls: 'text-sky-300' },
    XRP:  { sym: 'XRP',  name: 'XRP',          price: 0.5230,   change:  0.5, icon: 'fa-solid fa-wave-square',  cls: 'text-slate-300' },
    DOGE: { sym: 'DOGE', name: 'Dogecoin',     price: 0.1523,   change:  4.1, icon: 'fa-solid fa-dog',          cls: 'text-amber-300' },
    LINK: { sym: 'LINK', name: 'Chainlink',    price: 14.62,    change: -0.3, icon: 'fa-solid fa-link',         cls: 'text-indigo-300' },
    BNB:  { sym: 'BNB',  name: 'BNB',          price: 552.21,   change:  1.1, icon: 'fa-solid fa-coins',        cls: 'text-amber-400' }
};

/* The tradeable universe in display order. */
function marketList() {
    return Object.values(MARKET_ASSETS);
}

/* Formatted 24h change used by the ticker + search. */
function marketChange(sym) {
    const a = MARKET_ASSETS[sym];
    if (!a) return '';
    return (a.change >= 0 ? '+' : '') + a.change.toFixed(2) + '%';
}

/* Dashboard "Market Overview" ticker — fills #tickerGrid. Cryptos open the
   swap view, everything else opens the Trade view. */
function renderTicker() {
    const grid = $('tickerGrid');
    if (!grid) return;
    grid.innerHTML = marketList().map(a => {
        const open = (typeof SWAP_ASSETS !== 'undefined' && SWAP_ASSETS[a.sym])
            ? "openSwapWith('" + a.sym + "')"
            : "openTrade('" + a.sym + "')";
        const up = a.change >= 0;
        return `
        <button onclick="${open}" class="glass glass-hover rounded-2xl p-3 md:p-4 text-left transition" title="Trade ${a.sym}">
            <div class="flex items-center justify-between mb-3">
                <span class="inline-flex items-center gap-2.5">
                    <span class="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><i class="${a.icon} ${a.cls} text-lg"></i></span>
                    <span class="text-left min-w-0">
                        <span class="block text-sm font-semibold text-white truncate">${a.name}</span>
                        <span class="block text-[10px] text-slate-500">${a.sym} / USD</span>
                    </span>
                </span>
                <span class="px-2 py-0.5 text-[10px] font-bold ${up ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'} rounded-md">${marketChange(a.sym)}</span>
            </div>
            <div class="flex items-end justify-between">
                <span class="text-base md:text-lg font-bold text-white fig">$${fmt(a.price)}</span>
                <i class="fa-solid fa-arrow-right text-[10px] text-slate-600"></i>
            </div>
        </button>`;
    }).join('');
}
