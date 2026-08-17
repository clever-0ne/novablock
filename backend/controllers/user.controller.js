/* ---------- User controller: state, KYC, transactions ---------- */
/* Every route derives the owner from the session token (req.userId), never from
   the request body/URL — so one account can never read or write another's data
   (no IDOR). State is a JSON blob owned by the app; it is sanitized on write. */

const db = require('../db');
const mail = require('../email');
const sec = require('../middleware/security');
const txService = require('../services/transaction.service');
const { signDocUrl } = require('../utils/docurl');
const { publicUser } = require('../utils/public');

async function me(req, res) {
  res.json({ user: publicUser(await db.getUser(req.userId)) });
}

async function getState(req, res) {
  res.json((await db.getUser(req.userId)).state);
}

async function putState(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid state payload' });
  await db.saveUserState(req.userId, sec.sanitizeStrings(body));
  res.json({ ok: true });
}

async function getKyc(req, res) {
  res.json((await db.getUser(req.userId)).kyc);
}

/* Set a KYC level's verified flag (the user self-verifies Level 1; levels 2/3
   come from uploaded documents). Verification sends the KYC-verified email. */
async function kycLevel(req, res) {
  const level = req.valid.level;
  const user = await db.getUser(req.userId);
  const kyc = { ...(user.kyc || {}) };
  if (req.valid.verified) {
    for (let i = 1; i <= level; i++) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  } else {
    for (let i = level; i <= 3; i++) delete kyc[i];
  }
  await db.saveUserKyc(req.userId, kyc);
  if (req.valid.verified) {
    if (level === 1) mail.verifyCode(user).catch(() => {});
    else mail.kycVerified(user, level).catch(() => {});
  }
  res.json({ ok: true, kyc });
}

/* Store an uploaded KYC document in Postgres (kyc_files bytea — survives
   redeploys) and mark the level verified. Registered BEFORE /kyc/:level so
   "upload" is never captured as a level value. */
async function kycUpload(req, res) {
  const { level, docType, fileName, fileSize, fileData } = req.valid;
  const mime = fileData.split(';')[0].replace('data:', '');
  const ext = mime === 'image/png' ? 'png'
    : mime === 'image/jpeg' ? 'jpg'
    : mime === 'application/pdf' ? 'pdf'
    : 'dat';
  const fname = 'kyc-L' + level + '-' + Date.now() + '.' + ext;
  await db.saveKycFile({ userId: req.userId, level, fname, mime, data: Buffer.from(fileData.split(',')[1] || '', 'base64') });

  const user = await db.getUser(req.userId);
  const kyc = { ...(user.kyc || {}) };
  kyc[level] = { done: true, ts: Date.now(), docType, fileName, fileSize, docUrl: signDocUrl(req.userId, fname) };
  for (let i = 1; i < level; i++) if (!(kyc[i] && kyc[i].done)) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  await db.saveUserKyc(req.userId, kyc);
  mail.kycVerified(user, level).catch(() => {});

  res.json({ ok: true, docUrl: kyc[level].docUrl, docType, fileName, fileSize });
}

/* Clear just this user's KYC records + uploaded files. */
async function deleteKyc(req, res) {
  await db.saveUserKyc(req.userId, {});
  await db.deleteKycFiles(req.userId);
  res.json({ ok: true });
}

/* Reset this user's data (identity preserved, balances/transactions cleared). */
async function resetUser(req, res) {
  const user = await db.getUser(req.userId);
  const fresh = db.seedState();
  fresh.profile = { ...fresh.profile, ...(user.state.profile || {}) };
  await db.saveUserState(req.userId, fresh);
  res.json({ ok: true });
}

/* Server-authoritative deposit/withdrawal request — the record is created in
   Postgres NOW (not on a debounced client push), so it cannot be dropped. */
async function submitTransaction(req, res) {
  res.json(await txService.addPendingTx(req.userId, req.valid));
}

module.exports = {
  me, getState, putState, getKyc, kycLevel, kycUpload, deleteKyc, resetUser, submitTransaction
};
