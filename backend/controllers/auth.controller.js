/* ---------- Auth controller: register / verify / login / reset / logout ---------- */

const crypto = require('crypto');
const db = require('../db');
const mail = require('../email');
const sec = require('../middleware/security');
const { publicUser } = require('../utils/public');

const VERIFY_TTL_MS = 15 * 60 * 1000; /* email-verification codes: 15 minutes */
const RESET_TTL_MS = 15 * 60 * 1000;  /* password-reset codes: 15 minutes */

/* Generates a fresh 6-digit code, stores it on the user, and emails it. */
function issueVerifyCode(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.setVerifyCode(user.id, code, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
  mail.verifyCode(user, code).catch(() => {});
  return code;
}

async function register(req, res) {
  const { name, email, phone, password, refCode } = req.valid;
  if (await db.emailExists(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  /* Signed up through a referral link? Resolve the code to the referrer so their
     first approved deposit triggers the referrer's bonus. A bad code is ignored. */
  let referrerId = null;
  if (refCode) {
    const ref = await db.getUserByReferral(refCode);
    if (ref) referrerId = ref.id;
  }
  const user = await db.createUser({ email, password, name, phone, referrerId });
  if (referrerId) await db.recordReferral(referrerId, user);
  const token = await db.createToken(user.id);
  sec.setSessionCookie(res, token);
  /* New accounts are unverified: email a 6-digit code they must confirm before
     they can use the app. The welcome email goes out after verification. */
  issueVerifyCode(user);
  res.json({ token, user: publicUser(user) });
}

async function verify(req, res) {
  const user = await db.getUser(req.userId);
  if (user.emailVerified) return res.json({ ok: true, verified: true, user: publicUser(user) });
  const code = req.valid.code;
  if (!user.verifyCode) return res.status(400).json({ error: 'No verification code on file — request a new one' });
  if (!user.verifyExpires || new Date(user.verifyExpires).getTime() < Date.now()) {
    await db.setVerifyCode(user.id, '', '');
    return res.status(400).json({ error: 'Code expired — request a new one' });
  }
  if (user.verifyCode !== code) return res.status(400).json({ error: 'Incorrect code — check your email and try again' });
  await db.setEmailVerified(user.id, true);
  await db.setVerifyCode(user.id, '', '');
  /* Confirming the sign-up email also completes KYC Level 1 ("email & phone"). */
  try {
    const kyc = { ...(user.kyc || {}) };
    kyc[1] = { ...(kyc[1] || {}), done: true, ts: Date.now() };
    await db.saveUserKyc(user.id, kyc);
  } catch {}
  mail.welcome(user).catch(() => {});
  res.json({ ok: true, verified: true, user: publicUser(await db.getUser(user.id)) });
}

async function resendVerification(req, res) {
  const user = await db.getUser(req.userId);
  if (user.emailVerified) return res.json({ ok: true, already: true });
  issueVerifyCode(user);
  res.json({ ok: true });
}

async function login(req, res) {
  const { email, password } = req.valid;
  const user = await db.getUserByEmail(email);
  if (!user || !db.verifyPassword(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
  /* Seamless migration: accounts created before the bcrypt upgrade verify via
     the legacy scrypt hash, then are re-hashed with bcrypt here. */
  if (db.isLegacyHash(user.password)) {
    try { await db.setPassword(user.id, password); } catch {}
  }
  const token = await db.createToken(user.id);
  sec.setSessionCookie(res, token);
  res.json({ token, user: publicUser(user) });
}

/* Always answers 200 so we don't reveal whether an email is registered. */
async function forgot(req, res) {
  const user = await db.getUserByEmail(req.valid.email);
  if (user) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.setResetToken(user.id, code, new Date(Date.now() + RESET_TTL_MS).toISOString());
    mail.passwordReset(user, code).catch(() => {});
  }
  res.json({ ok: true });
}

/* Consume a reset code: set the new password, burn the code, kill all old
   sessions. A wrong code counts as one attempt against the 5-attempt budget. */
async function reset(req, res) {
  const { email, code, password } = req.valid;
  const user = await db.resetCodeUserByEmail(email, code);
  if (!user) {
    const u = await db.getUserByEmail(email);
    if (u && u.resetToken && u.resetExpires && new Date(u.resetExpires).getTime() > Date.now() && u.resetAttempts < 5) await db.bumpResetAttempts(u.id);
    return res.status(400).json({ error: 'Invalid or expired reset code — request a new one' });
  }
  await db.setPassword(user.id, password);
  await db.clearResetToken(user.id);
  await db.revokeAllUserTokens(user.id);
  sec.log('warn', 'password reset completed for user ' + user.id);
  const fresh = await db.createToken(user.id);
  sec.setSessionCookie(res, fresh);
  res.json({ ok: true, token: fresh });
}

/* Verifies the current password, revokes all other sessions, re-issues current. */
async function changePassword(req, res) {
  const user = await db.getUser(req.userId);
  const { current, next } = req.valid;
  if (!db.verifyPassword(current, user.password)) return res.status(400).json({ error: 'Current password is incorrect' });
  await db.setPassword(user.id, next);
  await db.revokeAllUserTokens(user.id);
  const token = await db.createToken(user.id);
  sec.setSessionCookie(res, token);
  res.json({ ok: true, token });
}

async function logout(req, res) {
  const c = req.cookies || {};
  await db.revokeToken(sec.bearer(req) || c.sb_session || c.sb_admin_session || '');
  sec.clearSessionCookie(res);
  res.json({ ok: true });
}

module.exports = { register, verify, resendVerification, login, forgot, reset, changePassword, logout };
