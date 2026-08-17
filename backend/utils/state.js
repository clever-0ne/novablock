/* ---------- Canonical user-state helpers ---------- */
/* Every user owns one `state` JSONB blob. The single source of truth for money
   is `state.balances.amount` (the unified cash balance) — deposits, swap fees,
   withdrawals and transfers all book against it. HOLDINGS (coin wallet) and
   POSITIONS (trade shares) are assets, not money. Every server write path runs
   normalizeState() so a NaN/partial/hardcoded blob can never reach Postgres. */

const DEFAULT_DEPOSIT_ADDRESSES = {
  Bitcoin: 'bc1q8yf8pr858e843rw22wtwlew5ytkxpure4fy32l',
  USDT: '0x17852B779a4b36a9F3e42373B1F573f4d1959c65',
  Ethereum: '0x17852B779a4b36a9F3e42373B1F573f4d1959c65'
};

function seedState() {
  return {
    balances: { amount: 0, bonus: 0, deposit: 0, withdrawal: 0 },
    profile: { fullName: '', username: '', email: '', phone: '', dob: '', street: '', city: '', state: '', postal: '', country: '', joined: '', accountId: '', referral: '' },
    transactions: [],
    referrals: [],
    refStats: { pending: 0 },
    notifications: [],
    depositAddresses: { ...DEFAULT_DEPOSIT_ADDRESSES },
    holdings: { BTC: 0, ETH: 0, USDT: 0, BNB: 0 },
    positions: {}
  };
}

/* Finite, non-negative number — anything else becomes 0. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Recursively merges `override` onto a copy of `base` (arrays replace). */
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

/* Coerces any state blob into the canonical shape. Never throws. */
function normalizeState(s) {
  const base = seedState();
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const out = deepMerge(base, src);

  /* Money fields are non-negative numbers, never NaN/strings/negative. */
  const b = out.balances || {};
  out.balances = {
    amount: num(b.amount),
    bonus: num(b.bonus),
    deposit: num(b.deposit),
    withdrawal: num(b.withdrawal)
  };

  /* Coin wallet is always BTC/ETH/USDT/BNB numeric. */
  const h = out.holdings || {};
  out.holdings = {
    BTC: num(h.BTC),
    ETH: num(h.ETH),
    USDT: num(h.USDT),
    BNB: num(h.BNB)
  };

  /* Profile fields are strings. */
  const p = out.profile || {};
  const profile = {};
  for (const k of Object.keys(base.profile)) {
    profile[k] = p[k] === undefined || p[k] === null ? (base.profile[k] || '') : String(p[k]).slice(0, 200);
  }
  out.profile = profile;

  /* Collections are arrays of objects / plain objects. */
  out.transactions = Array.isArray(out.transactions)
    ? out.transactions.filter(t => t && typeof t === 'object').map(t => ({ ...t }))
    : [];
  out.referrals = Array.isArray(out.referrals) ? out.referrals : [];
  out.notifications = Array.isArray(out.notifications) ? out.notifications : [];

  out.refStats = {
    ...(base.refStats || {}),
    ...(out.refStats && typeof out.refStats === 'object' ? out.refStats : {})
  };
  out.refStats.pending = num(out.refStats.pending);

  out.depositAddresses = {
    ...base.depositAddresses,
    ...(out.depositAddresses && typeof out.depositAddresses === 'object' ? out.depositAddresses : {})
  };

  out.positions = out.positions && typeof out.positions === 'object' && !Array.isArray(out.positions) ? out.positions : {};

  return out;
}

module.exports = { seedState, normalizeState, num, deepMerge, DEFAULT_DEPOSIT_ADDRESSES };
