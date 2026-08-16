/* ---------- NovaBlock.io backend: Express + SQLite + file storage + email ---------- */
/* Run with: node server.js  →  http://localhost:3000
   User app at / , admin panel at /admin.
   The backend is the user database: every account owns its own state, and the
   admin panel manages them through the /api/admin/* endpoints.

   Security model (see backend/security.js for the building blocks):
     - Sessions are per-user random tokens in the `tokens` table, carried either
       in Authorization: Bearer or the HttpOnly "sb_session" cookie.
     - RBAC middleware (auth / userOnly / adminOnly) guards every route.
     - All payloads are zod-validated; passwords are bcrypt-hashed.
     - Auth endpoints are rate-limited; Helmet + CORS allowlist are applied.
     - Central error handler logs server-side but never leaks details. */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const db = require('./db');
const mail = require('./email');
const env = require('./env');
const sec = require('./security');

const { auth, userOnly, adminOnly, validate, schemas, safeEqual } = sec;
const { setSessionCookie, clearSessionCookie } = sec;
const { authLimiter, registerLimiter, adminLimiter, apiLimiter } = sec;

const app = express();
const PORT = env.port;
const FRONTEND = path.join(__dirname, '..', 'frontend');
const UPLOADS = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

/* Behind a reverse proxy (Nginx, Render, Fly.io)? Set TRUST_PROXY=1 so the
   rate limiters and req.ip see the real client IP. */
app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');

/* ---------- global hardening middleware ---------- */
app.use(sec.securityHeaders);     /* CSP, HSTS, X-Frame-Options, nosniff, … */
app.use(sec.corsOptions);         /* restricted to env.appOrigin */
app.use(cookieParser());          /* reads the HttpOnly session cookie */
app.use(express.json({ limit: '25mb' }));
app.use('/api', apiLimiter);      /* light global ceiling for all API calls */

/* ---------- auth helpers ---------- */
/* Returns the user id for a valid user token, else sends 401 and returns null. */
function requireUser(req, res) {
  const uid = db.tokenUserId(sec.bearer(req) || (req.cookies && req.cookies.sb_session) || '');
  if (uid === undefined || uid === null) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  return uid;
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, emailVerified: !!u.emailVerified, state: u.state, kyc: u.kyc };
}

/* ---------- signed KYC document links ---------- */
/* KYC docs live at /api/uploads/<uid>/<file>. They are NOT world-readable:
   each saved docUrl carries an HMAC signature only the owning account (and
   admin) ever sees, so no other user can fetch someone's ID photos by
   guessing a path. Links are valid for 30 days. */
function signDocUrl(uid, file) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const msg = uid + ':' + file + ':' + exp;
  const sig = crypto.createHmac('sha256', env.kycUrlSecret).update(msg).digest('base64url');
  return '/api/uploads/' + uid + '/' + encodeURIComponent(file) + '?exp=' + exp + '&sig=' + sig;
}

/* ---------- sign-up email verification ---------- */
const VERIFY_TTL_MS = 15 * 60 * 1000; /* codes expire after 15 minutes */
/* Generates a fresh 6-digit code, stores it on the user, and emails it. */
function issueVerifyCode(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.setVerifyCode(user.id, code, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
  mail.verifyCode(user, code).catch(() => {});
  return code;
}

/* ---------- auth ---------- */
app.post('/api/auth/register', registerLimiter, validate(schemas.register), (req, res) => {
  const { name, email, phone, password } = req.valid;
  if (db.emailExists(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.createUser({ email, password, name, phone });
  const token = db.createToken(user.id);
  setSessionCookie(res, token);
  /* New accounts are unverified: email a 6-digit code they must confirm before
     they can use the app. The welcome email goes out after verification. */
  issueVerifyCode(user);
  res.json({ token, user: publicUser(user) });
});

/* Confirm the sign-up email verification code. */
app.post('/api/auth/verify', authLimiter, auth, userOnly, validate(schemas.verify), (req, res) => {
  const user = db.getUser(req.userId);
  if (user.emailVerified) return res.json({ ok: true, verified: true, user: publicUser(user) });
  const code = req.valid.code;
  if (!user.verifyCode) return res.status(400).json({ error: 'No verification code on file — request a new one' });
  if (!user.verifyExpires || new Date(user.verifyExpires).getTime() < Date.now()) {
    db.setVerifyCode(user.id, '', '');
    return res.status(400).json({ error: 'Code expired — request a new one' });
  }
  if (user.verifyCode !== code) return res.status(400).json({ error: 'Incorrect code — check your email and try again' });
  db.setEmailVerified(user.id, true);
  db.setVerifyCode(user.id, '', '');
  /* Confirming the sign-up email also completes KYC Level 1 ("email & phone"). */
  try {
    const kyc = { ...(user.kyc || {}) };
    kyc[1] = { ...(kyc[1] || {}), done: true, ts: Date.now() };
    db.saveUserKyc(user.id, kyc);
  } catch {}
  mail.welcome(user).catch(() => {});
  res.json({ ok: true, verified: true, user: publicUser(db.getUser(user.id)) });
});

/* Resend the sign-up verification code to the registered email. */
app.post('/api/auth/resend-verification', authLimiter, auth, userOnly, (req, res) => {
  const user = db.getUser(req.userId);
  if (user.emailVerified) return res.json({ ok: true, already: true });
  issueVerifyCode(user);
  res.json({ ok: true });
});

app.post('/api/auth/login', authLimiter, validate(schemas.login), (req, res) => {
  const { email, password } = req.valid;
  const user = db.getUserByEmail(email);
  if (!user || !db.verifyPassword(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
  /* Seamless migration: accounts created before bcrypt upgrade verify via the
     legacy scrypt hash, then are re-hashed with bcrypt here. */
  if (db.isLegacyHash(user.password)) {
    try { db.setPassword(user.id, password); } catch {}
  }
  const token = db.createToken(user.id);
  setSessionCookie(res, token);
  res.json({ token, user: publicUser(user) });
});

/* Request a password reset. Always answers 200 so we don't reveal whether an
   email is registered (no user enumeration). Sends a 6-digit code (15 minutes,
   single-use, max 5 attempts) like email verification — no link to intercept. */
const RESET_TTL_MS = 15 * 60 * 1000;
app.post('/api/auth/forgot', authLimiter, validate(schemas.forgot), (req, res) => {
  const user = db.getUserByEmail(req.valid.email);
  if (user) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.setResetToken(user.id, code, new Date(Date.now() + RESET_TTL_MS).toISOString());
    mail.passwordReset(user, code).catch(() => {});
  }
  res.json({ ok: true });
});

/* Consume a reset code: set the new password, burn the code, kill all old
   sessions. Old devices are logged out — the safe default for a compromised
   account. A wrong code counts as one attempt against the 5-attempt budget. */
app.post('/api/auth/reset', authLimiter, validate(schemas.reset), (req, res) => {
  const { email, code, password } = req.valid;
  const user = db.resetCodeUserByEmail(email, code);
  if (!user) {
    /* If this email has a live code, a wrong guess burns one attempt. */
    const u = db.getUserByEmail(email);
    if (u && u.resetToken && u.resetExpires && new Date(u.resetExpires).getTime() > Date.now() && u.resetAttempts < 5) db.bumpResetAttempts(u.id);
    return res.status(400).json({ error: 'Invalid or expired reset code — request a new one' });
  }
  db.setPassword(user.id, password);
  db.clearResetToken(user.id);
  db.revokeAllUserTokens(user.id);
  sec.log('warn', 'password reset completed for user ' + user.id);
  const fresh = db.createToken(user.id);
  setSessionCookie(res, fresh);
  res.json({ ok: true, token: fresh });
});

/* Signed-in password change: verifies the current password, revokes all other
   sessions, and re-issues the current one. */
app.post('/api/auth/change-password', authLimiter, auth, userOnly, validate(schemas.changePassword), (req, res) => {
  const user = db.getUser(req.userId);
  const { current, next } = req.valid;
  if (!db.verifyPassword(current, user.password)) return res.status(400).json({ error: 'Current password is incorrect' });
  db.setPassword(user.id, next);
  db.revokeAllUserTokens(user.id);
  const token = db.createToken(user.id);
  setSessionCookie(res, token);
  res.json({ ok: true, token });
});

app.get('/api/me', auth, userOnly, (req, res) => {
  res.json({ user: publicUser(db.getUser(req.userId)) });
});

app.post('/api/logout', (req, res) => {
  const c = req.cookies || {};
  db.revokeToken(sec.bearer(req) || c.sb_session || c.sb_admin_session || '');
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---------- user-scoped state ---------- */
/* Every user-scoped route derives the owner from the session token (req.userId),
   never from the request body/URL — so one account can never read or write
   another's data (no IDOR). State is a JSON blob owned by the app; it is
   control-char-stripped on write and HTML-escaped at render time. */
app.get('/api/state', auth, userOnly, (req, res) => {
  res.json(db.getUser(req.userId).state);
});

app.put('/api/state', auth, userOnly, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid state payload' });
  db.saveUserState(req.userId, sec.sanitizeStrings(body));
  res.json({ ok: true });
});

app.get('/api/kyc', auth, userOnly, (req, res) => {
  res.json(db.getUser(req.userId).kyc);
});

/* Set a KYC level's verified flag (the user self-verifies Level 1; levels 2/3
   come from uploaded documents). Verification sends the KYC-verified email. */
app.post('/api/kyc/:level', auth, userOnly, validate(schemas.kycLevel), (req, res) => {
  const level = req.valid.level;
  const user = db.getUser(req.userId);
  const kyc = { ...(user.kyc || {}) };
  if (req.valid.verified) {
    for (let i = 1; i <= level; i++) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  } else {
    for (let i = level; i <= 3; i++) delete kyc[i];
  }
  db.saveUserKyc(req.userId, kyc);
  if (req.valid.verified) {
    /* Level 1 = email & phone verification → emails the 6-digit verification code;
       levels 2/3 → the KYC-approved email. */
    if (level === 1) mail.verifyCode(user).catch(() => {});
    else mail.kycVerified(user, level).catch(() => {});
  }
  res.json({ ok: true, kyc });
});

/* Store an uploaded KYC document on disk (uploads/<userId>/) and mark verified. */
app.post('/api/kyc/upload', auth, userOnly, validate(schemas.kycUpload), (req, res) => {
  const { level, docType, fileName, fileSize, fileData } = req.valid;
  const mime = fileData.split(';')[0].replace('data:', '');
  const ext = mime === 'image/png' ? 'png'
    : mime === 'image/jpeg' ? 'jpg'
    : mime === 'application/pdf' ? 'pdf'
    : 'dat';
  const fname = 'kyc-L' + level + '-' + Date.now() + '.' + ext;
  const dir = path.join(UPLOADS, String(req.userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fname), Buffer.from(fileData.split(',')[1], 'base64'));

  const user = db.getUser(req.userId);
  const kyc = { ...(user.kyc || {}) };
  kyc[level] = { done: true, ts: Date.now(), docType, fileName, fileSize, docUrl: signDocUrl(req.userId, fname) };
  for (let i = 1; i < level; i++) if (!(kyc[i] && kyc[i].done)) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  db.saveUserKyc(req.userId, kyc);
  mail.kycVerified(user, level).catch(() => {});

  res.json({ ok: true, docUrl: kyc[level].docUrl, docType, fileName, fileSize });
});

/* Clear just this user's KYC records + uploaded files. */
app.delete('/api/kyc', auth, userOnly, (req, res) => {
  db.saveUserKyc(req.userId, {});
  const dir = path.join(UPLOADS, String(req.userId));
  if (fs.existsSync(dir)) { fs.readdirSync(dir).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch {} }); fs.rmdirSync(dir); }
  res.json({ ok: true });
});

/* Reset this user's data (identity preserved, balances/transactions cleared). */
app.post('/api/reset', auth, userOnly, (req, res) => {
  const user = db.getUser(req.userId);
  const fresh = db.seedState();
  fresh.profile = { ...fresh.profile, ...(user.state.profile || {}) };
  db.saveUserState(req.userId, fresh);
  res.json({ ok: true });
});

/* ---------- admin ---------- */
/* Admin tokens are created with user_id NULL; every /api/admin route is gated
   by adminOnly (auth first, then the admin check). */
app.post('/api/admin/login', adminLimiter, validate(schemas.adminLogin), (req, res) => {
  if (!safeEqual(req.valid.password, db.adminPassword())) {
    sec.log('warn', 'failed admin login from ' + req.ip);
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const token = db.createToken(null);
  setSessionCookie(res, token, true); /* admin cookie — separate from user sessions */
  res.json({ token });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  res.json({
    totalUsers: db.countUsers(),
    totalBalance: db.totalBalance(),
    pendingApprovals: db.pendingApprovals(),
    emailsSent: db.allEmails().length,
    emailConfigured: mail.emailConfigured()
  });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json({ users: db.listUsers() });
});

app.get('/api/admin/users/:id', auth, adminOnly, validate(schemas.id), (req, res) => {
  const user = db.getUser(req.valid.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

app.put('/api/admin/users/:id/state', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  if (!db.getUser(id)) return res.status(404).json({ error: 'User not found' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid state payload' });
  db.saveUserState(id, sec.sanitizeStrings(body));
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/kyc/:level', auth, adminOnly, validate(schemas.adminKyc), (req, res) => {
  const { id, level } = req.valid;
  const user = db.getUser(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const kyc = { ...(user.kyc || {}) };
  if (req.valid.verified) {
    for (let i = 1; i <= level; i++) kyc[i] = { ...(kyc[i] || {}), done: true, ts: Date.now() };
  } else {
    for (let i = level; i <= 3; i++) delete kyc[i];
  }
  db.saveUserKyc(id, kyc);
  if (req.valid.verified) {
    if (level === 1) mail.verifyCode(user).catch(() => {});
    else mail.kycVerified(user, level).catch(() => {});
  }
  res.json({ ok: true, kyc });
});

/* Admin creates an account directly (sends the welcome email). */
app.post('/api/admin/users', auth, adminOnly, validate(schemas.adminCreateUser), (req, res) => {
  const { name, email, phone, password } = req.valid;
  if (db.emailExists(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.createUser({ email, password, name, phone });
  /* Admin-created accounts are treated as vetted — no verification gate. */
  db.setEmailVerified(user.id, true);
  mail.welcome(user).catch(() => {});
  res.json({ ok: true, user: publicUser(user) });
});

app.delete('/api/admin/users/:id', auth, adminOnly, validate(schemas.id), (req, res) => {
  const id = req.valid.id;
  if (!db.getUser(id)) return res.status(404).json({ error: 'User not found' });
  db.deleteUser(id);
  const dir = path.join(UPLOADS, String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

/* Admin email composer → sends to a specific user. */
app.post('/api/admin/users/:id/email', auth, adminOnly, validate(schemas.adminEmail), async (req, res) => {
  const { id, template, subject, message } = req.valid;
  const user = db.getUser(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const rendered = mail.render(template, user, { subject, message });
  const result = await mail.sendEmail({ userId: user.id, to: user.email, template: rendered.template, subject: rendered.subject, text: rendered.text, html: rendered.html });
  res.json(result);
});

app.get('/api/admin/emails', auth, adminOnly, (req, res) => {
  res.json({ emails: db.allEmails() });
});

/* Clear the email log (deletes every row from the emails table). */
app.post('/api/admin/emails/clear', auth, adminOnly, (req, res) => {
  db.clearEmails();
  sec.log('warn', 'admin cleared the email log');
  res.json({ ok: true });
});

/* Wipe all users, tokens and emails + uploaded files. */
app.post('/api/admin/reset', auth, adminOnly, (req, res) => {
  db.resetAll();
  if (fs.existsSync(UPLOADS)) {
    fs.readdirSync(UPLOADS).forEach(f => { try { fs.rmSync(path.join(UPLOADS, f), { recursive: true, force: true }); } catch {} });
  }
  res.json({ ok: true });
});

/* Served KYC documents — only through the signed links issued to the owning
   user. No signature → no document. */
app.get('/api/uploads/:uid/:file', (req, res) => {
  const uid = parseInt(req.params.uid, 10);
  const file = path.basename(req.params.file);
  const { exp, sig } = req.query || {};
  if (!uid || !file || !exp || !sig) return res.status(403).json({ error: 'Forbidden' });
  const msg = uid + ':' + file + ':' + exp;
  const ok = crypto.createHmac('sha256', env.kycUrlSecret).update(msg).digest('base64url') === sig;
  if (!ok || Date.now() > Number(exp)) return res.status(403).json({ error: 'Forbidden' });
  const p = path.join(UPLOADS, String(uid), file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(p);
});

/* Convenience: /admin redirects to the admin page (served from frontend/). */
app.get('/admin', (req, res) => res.redirect('/admin.html'));

/* Frontend only — served statically from frontend/. The backend code, data,
   uploads and .env are no longer reachable over HTTP. */
app.use(express.static(FRONTEND));

/* ---------- 404 + central error handling ---------- */
app.use('/api', sec.notFound);
app.use(sec.errorHandler);

app.listen(PORT, () => {
  console.log('NovaBlock.io backend running →  http://localhost:' + PORT);
  console.log('  User app : http://localhost:' + PORT + '/');
  console.log('  Admin    : http://localhost:' + PORT + '/admin');
  if (!env.isProd) console.log('  [env] development mode — set NODE_ENV=production before going live.');
});
