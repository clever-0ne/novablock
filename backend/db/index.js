/* ---------- Postgres data-access service ---------- */
/* Async replacement for the old better-sqlite3 layer. Every function returns a
   Promise; JSONB columns come back already parsed, so the old safeParse dance
   is gone. tokenUserId keeps its three-state contract (number = user, null =
   admin, undefined = invalid/expired) so the auth middleware is unchanged. */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../env');
const { query } = require('./pool');
const { seedState, normalizeState, num } = require('../utils/state');

/* ---------- password hashing (bcrypt) ---------- */
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
async function setPassword(id, plain) {
  await query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(plain), id]);
}

/* ---------- rows → user ---------- */
function rowToUser(r) {
  return {
    id: Number(r.id),
    email: r.email,
    password: r.password,
    name: r.name || '',
    phone: r.phone || '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    emailVerified: !!r.email_verified,
    verifyCode: r.verify_code || '',
    verifyExpires: r.verify_expires ? new Date(r.verify_expires).toISOString() : '',
    resetToken: r.reset_token || '',
    resetExpires: r.reset_expires ? new Date(r.reset_expires).toISOString() : '',
    resetAttempts: r.reset_attempts || 0,
    state: normalizeState(r.state),
    kyc: r.kyc || {}
  };
}

function rand4() { return String(Math.floor(Math.random() * 9000) + 1000); }

/* ---------- users ---------- */
async function createUser({ email, password, name, phone }) {
  const state = seedState();
  const base = String(email).split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12) || String(email).split('@')[0];
  state.profile.fullName = name || '';
  state.profile.username = base;
  state.profile.email = email;
  state.profile.phone = phone || '';
  state.profile.joined = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  state.profile.accountId = 'PD-' + rand4() + '-' + rand4();
  state.profile.referral = (base + '-' + new Date().getFullYear()).toUpperCase();
  const r = await query(
    'INSERT INTO users (email, password, name, phone, state, kyc) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [String(email).toLowerCase().trim(), hashPassword(password), name || '', phone || '', JSON.stringify(normalizeState(state)), '{}']
  );
  return getUser(Number(r.rows[0].id));
}

async function getUser(id) {
  const r = await query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

async function getUserByEmail(email) {
  const r = await query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase().trim()]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

async function emailExists(email) {
  const r = await query('SELECT 1 FROM users WHERE email = $1', [String(email || '').toLowerCase().trim()]);
  return r.rows.length > 0;
}

async function saveUserState(id, state) {
  await query('UPDATE users SET state = $1 WHERE id = $2', [JSON.stringify(normalizeState(state || {})), id]);
}
async function saveUserKyc(id, kyc) {
  await query('UPDATE users SET kyc = $1 WHERE id = $2', [JSON.stringify(kyc || {}), id]);
}

/* ---------- email verification ---------- */
async function setEmailVerified(id, verified) {
  await query('UPDATE users SET email_verified = $1 WHERE id = $2', [!!verified, id]);
}
async function setVerifyCode(id, code, expiresIso) {
  await query('UPDATE users SET verify_code = $1, verify_expires = $2 WHERE id = $3',
    [code || '', expiresIso || null, id]);
}

/* ---------- password reset (6-digit code, single-use, attempt-limited) ---------- */
const MAX_RESET_ATTEMPTS = 5;
function hashResetCode(code) { return crypto.createHash('sha256').update(String(code || '')).digest('hex'); }
async function setResetToken(id, code, expiresIso) {
  await query('UPDATE users SET reset_token = $1, reset_expires = $2, reset_attempts = 0 WHERE id = $3',
    [code ? hashResetCode(code) : '', expiresIso || null, id]);
}
async function clearResetToken(id) { await setResetToken(id, '', ''); }
async function bumpResetAttempts(id) {
  await query('UPDATE users SET reset_attempts = COALESCE(reset_attempts, 0) + 1 WHERE id = $1', [id]);
}
async function resetCodeUserByEmail(email, code) {
  const r = await query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase().trim()]);
  const row = r.rows[0];
  if (!row || !code || !row.reset_token) return null;
  if (row.reset_token !== hashResetCode(code)) return null;
  if (!row.reset_expires || new Date(row.reset_expires).getTime() < Date.now()) return null;
  if ((row.reset_attempts || 0) >= MAX_RESET_ATTEMPTS) return null;
  return rowToUser(row);
}
async function revokeAllUserTokens(id) {
  await query('DELETE FROM tokens WHERE user_id = $1', [id]);
}

/* ---------- admin list (paginated + searchable) ---------- */
/* ESCAPE '\\' treats backslash literally, so a user's \ % _ characters cannot
   act as SQL wildcards. Page size is capped at 100. */
function escapeLike(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function pendingCountOf(state) {
  const s = normalizeState(state);
  return s.transactions.filter(t => t.status === 'pending' && (t.type === 'deposit' || t.type === 'withdrawal')).length;
}

async function listUsers({ page = 1, pageSize = 25, q = '' } = {}) {
  const per = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const search = String(q || '').trim();
  const pat = '%' + escapeLike(search) + '%';
  const whereSql = search
    ? "WHERE email ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\' OR phone ILIKE $1 ESCAPE '\\' OR state->'profile'->>'fullName' ILIKE $1 ESCAPE '\\'"
    : '';
  const params = search ? [pat] : [];

  const c = await query('SELECT COUNT(*)::int AS c FROM users ' + whereSql, params);
  const total = c.rows[0].c;

  const list = await query(
    'SELECT * FROM users ' + whereSql + ' ORDER BY id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
    [...params, per, (pg - 1) * per]
  );

  const users = list.rows.map(r => {
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
      kycDone: [1, 2, 3].filter(l => k[l] && k[l].done).length,
      pendingCount: pendingCountOf(u.state)
    };
  });

  return { users, total, page: pg, pageSize: per, totalPages: Math.max(1, Math.ceil(total / per)) };
}

async function deleteUser(id) {
  await query('DELETE FROM users WHERE id = $1', [id]);
  await query('DELETE FROM tokens WHERE user_id = $1', [id]);
  await query('DELETE FROM kyc_files WHERE user_id = $1', [id]);
}

async function countUsers() {
  const r = await query('SELECT COUNT(*)::int AS c FROM users');
  return r.rows[0].c;
}

/* Single SQL SUM instead of an O(n) JS scan. */
async function totalBalance() {
  const r = await query("SELECT COALESCE(SUM(COALESCE(NULLIF(state->'balances'->>'amount','')::numeric,0)),0)::float8 AS total FROM users");
  return r.rows[0].total || 0;
}

/* Pending deposit/withdrawal count across ALL users (JSONB arrays flattened in
   SQL — no loading whole states into JS). */
async function pendingApprovals() {
  const r = await query(`
    SELECT COUNT(*)::int AS c
    FROM users, jsonb_array_elements(COALESCE(state->'transactions','[]'::jsonb)) t
    WHERE t->>'status' = 'pending' AND t->>'type' IN ('deposit','withdrawal')
  `);
  return r.rows[0].c;
}

/* The admin approval queue: every user's pending deposit/withdrawal with the
   owning account — server-authoritative, not tied to the currently-open user. */
async function pendingQueue() {
  const r = await query(`
    SELECT id, email, name, state->'profile'->>'fullName' AS full_name, t AS tx
    FROM users, jsonb_array_elements(COALESCE(state->'transactions','[]'::jsonb)) t
    WHERE t->>'status' = 'pending' AND t->>'type' IN ('deposit','withdrawal')
    ORDER BY id DESC
  `);
  return r.rows.map(row => ({
    userId: Number(row.id),
    email: row.email,
    name: row.full_name || row.name || '',
    tx: row.tx
  }));
}

/* ---------- tokens (user + admin) ---------- */
const TOKEN_TTL_MS = env.sessionTtlMs;

async function sweepExpiredTokens() {
  try { await query('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < now()'); } catch {}
}

async function createToken(userId) {
  try { await sweepExpiredTokens(); } catch {}
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await query('INSERT INTO tokens (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)',
    [token, userId === undefined || userId === null ? null : userId, new Date().toISOString(), expires]);
  return token;
}
/* Returns: number = user id, null = admin token, undefined = invalid/expired. */
async function tokenUserId(token) {
  const r = await query('SELECT user_id, expires_at FROM tokens WHERE token = $1', [token || '']);
  if (!r.rows.length) return undefined;
  const row = r.rows[0];
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM tokens WHERE token = $1', [token || '']);
    return undefined;
  }
  return row.user_id === null ? null : Number(row.user_id);
}
async function revokeToken(token) {
  await query('DELETE FROM tokens WHERE token = $1', [token || '']);
}

/* ---------- emails ---------- */
async function logEmail({ userId, toEmail, template, subject, text, html, status, failure }) {
  await query(
    'INSERT INTO emails (user_id, to_email, template, subject, body, html_body, status, failure, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [userId || null, toEmail || '', template || '', subject || '', text || '', html || '', status || 'logged', failure || '', new Date().toISOString()]
  );
}
async function allEmails() {
  const r = await query('SELECT * FROM emails ORDER BY id DESC');
  return r.rows.map(e => ({
    id: Number(e.id),
    userId: e.user_id === null ? null : Number(e.user_id),
    toEmail: e.to_email || '',
    template: e.template || '',
    subject: e.subject || '',
    body: e.body || '',
    html: e.html_body || '',
    status: e.status || '',
    failure: e.failure || '',
    createdAt: e.created_at ? new Date(e.created_at).toISOString() : ''
  }));
}
async function clearEmails() {
  await query('DELETE FROM emails');
}

/* ---------- KYC document files (bytea, survives redeploys) ---------- */
async function saveKycFile({ userId, level, fname, mime, data }) {
  await query('INSERT INTO kyc_files (user_id, level, fname, mime, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, level, fname, mime, data, new Date().toISOString()]);
}
async function getKycFile(userId, fname) {
  const r = await query('SELECT * FROM kyc_files WHERE user_id = $1 AND fname = $2 ORDER BY id DESC LIMIT 1', [userId, fname]);
  if (!r.rows.length) return null;
  const f = r.rows[0];
  return { id: Number(f.id), userId: Number(f.user_id), level: f.level, fname: f.fname, mime: f.mime, data: f.data };
}
async function deleteKycFiles(userId) {
  await query('DELETE FROM kyc_files WHERE user_id = $1', [userId]);
}

/* ---------- admin ---------- */
function adminPassword() { return env.adminPass; }

/* ---------- reset ---------- */
async function resetAll() {
  await query('DELETE FROM users');
  await query('DELETE FROM tokens');
  await query('DELETE FROM emails');
  await query('DELETE FROM kyc_files');
}

module.exports = {
  hashPassword, verifyPassword, isLegacyHash, setPassword,
  seedState, normalizeState, num,
  createUser, getUser, getUserByEmail, emailExists,
  saveUserState, saveUserKyc, listUsers, deleteUser,
  setEmailVerified, setVerifyCode,
  setResetToken, clearResetToken, resetCodeUserByEmail, bumpResetAttempts, revokeAllUserTokens,
  countUsers, totalBalance, pendingApprovals, pendingQueue,
  createToken, tokenUserId, revokeToken,
  logEmail, allEmails, clearEmails,
  saveKycFile, getKycFile, deleteKycFiles,
  adminPassword, resetAll
};
