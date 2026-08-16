/* ---------- SQLite persistence: users + tokens + emails (backend/data/app.db) ---------- */
/* One row per account. Each user owns a JSON state (balances, transactions,
   holdings, positions, notifications, referrals, depositAddresses) and a JSON
   KYC record. Tokens authenticate the user app and the admin panel. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const env = require('./env');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    name       TEXT DEFAULT '',
    phone      TEXT DEFAULT '',
    created_at TEXT,
    state      TEXT NOT NULL DEFAULT '{}',
    kyc        TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS emails (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    to_email   TEXT,
    template   TEXT,
    subject    TEXT,
    body       TEXT,
    status     TEXT,
    created_at TEXT
  );
`);

/* Migration: add the html_body column used by the styled email-log preview. */
try {
  const cols = db.prepare('PRAGMA table_info(emails)').all().map(c => c.name);
  if (!cols.includes('html_body')) db.exec('ALTER TABLE emails ADD COLUMN html_body TEXT');
} catch {}

/* Migration: token sessions expire (adds the expires_at column). */
try {
  const cols = db.prepare('PRAGMA table_info(tokens)').all().map(c => c.name);
  if (!cols.includes('expires_at')) db.exec('ALTER TABLE tokens ADD COLUMN expires_at TEXT');
} catch {}

/* Migration: sign-up email verification columns. Existing accounts are
   grandfathered as verified so current users keep working; new registrations
   start unverified until they confirm the emailed code. */
try {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const hadVerified = cols.includes('email_verified');
  if (!cols.includes('email_verified')) db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
  if (!cols.includes('verify_code')) db.exec("ALTER TABLE users ADD COLUMN verify_code TEXT DEFAULT ''");
  if (!cols.includes('verify_expires')) db.exec('ALTER TABLE users ADD COLUMN verify_expires TEXT');
  if (!hadVerified) db.prepare('UPDATE users SET email_verified = 1').run();
} catch {}

/* Migration: password-reset codes (single-use, short-lived, attempt-limited). */
try {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('reset_token')) db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT DEFAULT ''");
  if (!cols.includes('reset_expires')) db.exec('ALTER TABLE users ADD COLUMN reset_expires TEXT');
  if (!cols.includes('reset_attempts')) db.exec('ALTER TABLE users ADD COLUMN reset_attempts INTEGER DEFAULT 0');
} catch {}

/* Backfill: a confirmed sign-up email also completes KYC Level 1 ("email &
   phone"), so already-verified accounts show it as done without re-verifying. */
try {
  db.prepare('SELECT id, kyc FROM users WHERE email_verified = 1').all().forEach(r => {
    const k = safeParse(r.kyc);
    if (!(k[1] && k[1].done)) {
      k[1] = { ...(k[1] || {}), done: true, ts: Date.now() };
      db.prepare('UPDATE users SET kyc = ? WHERE id = ?').run(JSON.stringify(k), r.id);
    }
  });
} catch {}

/* ---------- password hashing (bcrypt) ---------- */
/* New accounts are hashed with bcrypt (cost = env.bcryptRounds, default 12).
   Accounts created before this change used scrypt ("salt:hash"); those hashes
   still verify, and the password is transparently re-hashed with bcrypt on the
   user's next successful login (see isLegacyHash). */
function hashPassword(password) {
  return bcrypt.hashSync(String(password), env.bcryptRounds);
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.startsWith('$2')) return bcrypt.compareSync(String(password), stored);
  /* Legacy scrypt hash (salt:hash). */
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  try {
    const check = crypto.scryptSync(String(password), salt, 64);
    const actual = Buffer.from(hash, 'hex');
    return check.length === actual.length && crypto.timingSafeEqual(check, actual);
  } catch { return false; }
}
function isLegacyHash(stored) {
  return !!stored && typeof stored === 'string' && !stored.startsWith('$2');
}
function setPassword(id, plain) {
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(plain), id);
}

/* ---------- seed state for a new user (mirrors the client seedApp) ---------- */
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

function rand4() { return String(Math.floor(Math.random() * 9000) + 1000); }

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

function rowToUser(r) {
  return {
    id: r.id,
    email: r.email,
    password: r.password,
    name: r.name,
    phone: r.phone,
    createdAt: r.created_at,
    emailVerified: !!r.email_verified,
    verifyCode: r.verify_code || '',
    verifyExpires: r.verify_expires || '',
    resetToken: r.reset_token || '',
    resetExpires: r.reset_expires || '',
    resetAttempts: r.reset_attempts || 0,
    state: safeParse(r.state),
    kyc: safeParse(r.kyc)
  };
}

/* ---------- users ---------- */
function createUser({ email, password, name, phone }) {
  const state = seedState();
  const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12) || email.split('@')[0];
  state.profile.fullName = name || '';
  state.profile.username = base;
  state.profile.email = email;
  state.profile.phone = phone || '';
  state.profile.joined = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  state.profile.accountId = 'PD-' + rand4() + '-' + rand4();
  state.profile.referral = (base + '-' + new Date().getFullYear()).toUpperCase();
  const id = db.prepare(
    'INSERT INTO users (email, password, name, phone, created_at, state, kyc) VALUES (?,?,?,?,?,?,?)'
  ).run(email, hashPassword(password), name || '', phone || '', new Date().toISOString(), JSON.stringify(state), '{}').lastInsertRowid;
  return getUser(id);
}

function getUser(id) {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return r ? rowToUser(r) : null;
}

function getUserByEmail(email) {
  const r = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  return r ? rowToUser(r) : null;
}

function emailExists(email) {
  return !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
}

function saveUserState(id, state) {
  db.prepare('UPDATE users SET state = ? WHERE id = ?').run(JSON.stringify(state || {}), id);
}
function saveUserKyc(id, kyc) {
  db.prepare('UPDATE users SET kyc = ? WHERE id = ?').run(JSON.stringify(kyc || {}), id);
}

/* ---------- email verification ---------- */
function setEmailVerified(id, verified) {
  db.prepare('UPDATE users SET email_verified = ? WHERE id = ?').run(verified ? 1 : 0, id);
}
function setVerifyCode(id, code, expiresIso) {
  db.prepare('UPDATE users SET verify_code = ?, verify_expires = ? WHERE id = ?').run(code || '', expiresIso || '', id);
}

/* ---------- password reset (6-digit code, single-use, attempt-limited) ---------- */
/* Issued by /api/auth/forgot and burned the moment /api/auth/reset succeeds.
   The emailed code is stored as a SHA-256 hash, so a DB leak never exposes a
   live code. Each code allows MAX_RESET_ATTEMPTS guesses before it is voided. */
const MAX_RESET_ATTEMPTS = 5;
function hashResetCode(code) { return crypto.createHash('sha256').update(String(code || '')).digest('hex'); }
function setResetToken(id, code, expiresIso) {
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ?, reset_attempts = 0 WHERE id = ?')
    .run(code ? hashResetCode(code) : '', expiresIso || '', id);
}
function clearResetToken(id) {
  setResetToken(id, '', '');
}
function bumpResetAttempts(id) {
  db.prepare('UPDATE users SET reset_attempts = COALESCE(reset_attempts, 0) + 1 WHERE id = ?').run(id);
}
/* Returns the user whose email matches AND whose code is correct, unexpired and
   not burnt out — otherwise null. Always take the hash branch (never store the
   plaintext code). */
function resetCodeUserByEmail(email, code) {
  const r = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!r || !code || !r.reset_token) return null;
  if (r.reset_token !== hashResetCode(code)) return null;
  if (!r.reset_expires || new Date(r.reset_expires).getTime() < Date.now()) return null;
  if ((r.reset_attempts || 0) >= MAX_RESET_ATTEMPTS) return null;
  return rowToUser(r);
}
/* Kills every open session for a user (used on password reset/change). */
function revokeAllUserTokens(id) {
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(id);
}

/* One row per account with the summary fields the admin Users table shows. */
function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id DESC').all().map(r => {
    const u = rowToUser(r);
    const b = u.state.balances || {};
    const k = u.kyc || {};
    return {
      id: u.id,
      name: (u.state.profile && u.state.profile.fullName) || u.name,
      email: u.email,
      phone: (u.state.profile && u.state.profile.phone) || u.phone,
      createdAt: u.createdAt,
      balance: b.amount || 0,
      deposit: b.deposit || 0,
      withdrawal: b.withdrawal || 0,
      bonus: b.bonus || 0,
      kycDone: [1, 2, 3].filter(l => k[l] && k[l].done).length
    };
  });
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(id);
}

function countUsers() { return db.prepare('SELECT COUNT(*) AS c FROM users').get().c; }

function totalBalance() {
  let s = 0;
  db.prepare('SELECT state FROM users').all().forEach(r => {
    const b = safeParse(r.state).balances;
    if (b && b.amount) s += b.amount;
  });
  return s;
}

function pendingApprovals() {
  let n = 0;
  db.prepare('SELECT state FROM users').all().forEach(r => {
    safeParse(r.state).transactions && safeParse(r.state).transactions.forEach(t => {
      if (t.status === 'pending' && (t.type === 'deposit' || t.type === 'withdrawal')) n++;
    });
  });
  return n;
}

/* ---------- tokens (user + admin) ---------- */
/* Every login/register issues its own random session token bound to that one
   user — tokens are never shared. Sessions expire after env.sessionTtlMs (7
   days by default) and stale tokens are swept out, so one account's session
   can never be used as another's. */
const TOKEN_TTL_MS = env.sessionTtlMs;

function sweepExpiredTokens() {
  try { db.prepare('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at <> ? AND expires_at < ?').run('', new Date().toISOString()); } catch {}
}

function createToken(userId) {
  try { sweepExpiredTokens(); } catch {}
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO tokens (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId === undefined ? null : userId, new Date().toISOString(), expires);
  return token;
}
/* Returns: number = user id, null = admin token, undefined = invalid/expired. */
function tokenUserId(token) {
  const r = db.prepare('SELECT user_id, expires_at FROM tokens WHERE token = ?').get(token || '');
  if (!r) return undefined;
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM tokens WHERE token = ?').run(token || '');
    return undefined;
  }
  return r.user_id;
}
function revokeToken(token) {
  db.prepare('DELETE FROM tokens WHERE token = ?').run(token || '');
}

/* ---------- emails ---------- */
function logEmail({ userId, toEmail, template, subject, text, html, status }) {
  db.prepare('INSERT INTO emails (user_id, to_email, template, subject, body, html_body, status, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(userId || null, toEmail || '', template || '', subject || '', text || '', html || '', status || 'logged', new Date().toISOString());
}
function allEmails() {
  return db.prepare('SELECT * FROM emails ORDER BY id DESC').all().map(e => ({
    id: e.id,
    userId: e.user_id,
    toEmail: e.to_email,
    template: e.template,
    subject: e.subject,
    body: e.body,
    html: e.html_body,
    status: e.status,
    createdAt: e.created_at
  }));
}
function clearEmails() {
  db.prepare('DELETE FROM emails').run();
}

/* ---------- admin ---------- */
/* Admin secret comes from env (backend/.env) — no hardcoded fallback. */
function adminPassword() { return env.adminPass; }

/* ---------- reset ---------- */
function resetAll() {
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM tokens').run();
  db.prepare('DELETE FROM emails').run();
}

module.exports = {
  hashPassword, verifyPassword, isLegacyHash, setPassword, seedState,
  createUser, getUser, getUserByEmail, emailExists,
  saveUserState, saveUserKyc, listUsers, deleteUser,
  setEmailVerified, setVerifyCode,
  setResetToken, clearResetToken, resetCodeUserByEmail, bumpResetAttempts, revokeAllUserTokens,
  countUsers, totalBalance, pendingApprovals,
  createToken, tokenUserId, revokeToken,
  logEmail, allEmails, clearEmails, adminPassword, resetAll
};
