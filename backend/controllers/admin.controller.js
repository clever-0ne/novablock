/* ---------- Admin controller ---------- */
/* Every route here is gated by adminOnly (see routes/admin.routes.js). Admin
   tokens are created with user_id NULL. */

const db = require('../db');
const mail = require('../email');
const { background } = require('../utils/background');
const sec = require('../middleware/security');
const txService = require('../services/transaction.service');
const { publicUser } = require('../utils/public');

async function login(req, res) {
  if (!sec.safeEqual(req.valid.password, db.adminPassword())) {
    sec.log('warn', 'failed admin login from ' + req.ip);
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const token = await db.createToken(null);
  sec.setSessionCookie(res, token, true); /* admin cookie — separate from user sessions */
  res.json({ token });
}

async function stats(req, res) {
  const [totalUsers, totalBalance, pendingApprovals, emails] = await Promise.all([
    db.countUsers(), db.totalBalance(), db.pendingApprovals(), db.allEmails()
  ]);
  res.json({
    totalUsers,
    totalBalance,
    pendingApprovals,
    emailsSent: emails.length,
    emailConfigured: mail.emailConfigured()
  });
}

async function listUsers(req, res) {
  res.json(await db.listUsers(req.valid));
}

async function getUser(req, res) {
  const user = await db.getUser(req.valid.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
}

async function putUserState(req, res) {
  const id = req.valid.id;
  const body = req.body;
  if (!(await db.getUser(id))) return res.status(404).json({ error: 'User not found' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid state payload' });
  await db.saveUserState(id, sec.sanitizeStrings(body));
  res.json({ ok: true });
}

async function createUser(req, res) {
  const { name, email, phone, password } = req.valid;
  if (await db.emailExists(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = await db.createUser({ email, password, name, phone });
  /* Admin-created accounts are treated as vetted — no verification gate. */
  await db.setEmailVerified(user.id, true);
  background(mail.welcome(user));
  res.json({ ok: true, user: publicUser(user) });
}

async function deleteUser(req, res) {
  const id = req.valid.id;
  if (!(await db.getUser(id))) return res.status(404).json({ error: 'User not found' });
  await db.deleteUser(id); /* also removes their tokens + kyc files */
  res.json({ ok: true });
}

async function kycLevel(req, res) {
  const { id, level } = req.valid;
  const user = await db.getUser(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const kyc = { ...(user.kyc || {}) };
  if (req.valid.verified) {
    for (let i = 1; i <= level; i++) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  } else {
    for (let i = level; i <= 3; i++) delete kyc[i];
  }
  await db.saveUserKyc(id, kyc);
  if (req.valid.verified) {
    if (level === 1) background(mail.verifyCode(user));
    else background(mail.kycVerified(user, level));
  }
  res.json({ ok: true, kyc });
}

async function sendEmail(req, res) {
  const { id, template, subject, message } = req.valid;
  const user = await db.getUser(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const rendered = mail.render(template, user, { subject, message });
  const result = await mail.sendEmail({ userId: user.id, to: user.email, template: rendered.template, subject: rendered.subject, text: rendered.text, html: rendered.html });
  res.json(result);
}

async function listEmails(req, res) {
  res.json({ emails: await db.allEmails() });
}

async function clearEmails(req, res) {
  await db.clearEmails();
  sec.log('warn', 'admin cleared the email log');
  res.json({ ok: true });
}

/* The server-authoritative approval queue — every user's pending request. */
async function pending(req, res) {
  res.json({ pending: await db.pendingQueue() });
}

async function approveTx(req, res) {
  res.json(await txService.setTxStatus(req.valid.id, req.valid.txId, 'approve'));
}

async function declineTx(req, res) {
  res.json(await txService.setTxStatus(req.valid.id, req.valid.txId, 'decline'));
}

async function resetPlatform(req, res) {
  await db.resetAll(); /* users, tokens, emails, kyc files */
  res.json({ ok: true });
}

module.exports = {
  login, stats, listUsers, getUser, putUserState, createUser, deleteUser, kycLevel,
  sendEmail, listEmails, clearEmails, pending, approveTx, declineTx, resetPlatform
};
