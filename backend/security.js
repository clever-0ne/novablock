/* ---------- Security layer: middleware, validation, rate limiting ---------- */
/* One home for the cross-cutting production safeguards:
     - auth / userOnly / adminOnly   RBAC middleware (Bearer header or HttpOnly cookie)
     - validate(schema)              zod schema validation for every API payload
     - sanitizeText / escapeHtml     input cleaning + output escaping
     - rate limiters                 brute-force protection on auth endpoints
     - securityHeaders, corsOptions  Helmet + CORS allowlist
     - log / errorHandler            central logging + safe error responses
   Sessions: a token row in the DB is the source of truth. It travels either in
   the Authorization: Bearer header (the app's existing flow) or in the
   HttpOnly "sb_session" cookie. Both point at the same token, so the two
   channels can't disagree. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const db = require('./db');
const env = require('./env');

/* ---------- logging ---------- */
/* Writes a timestamped line to backend/logs/app.log and the console. Sensitive
   values (tokens, hashes, passwords) are never logged — only what the caller
   passes in, which the routes already keep to ids/statuses/errors. */
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
function log(level, msg) {
  const line = '[' + new Date().toISOString() + '] [' + level.toUpperCase() + '] ' + msg;
  try { fs.appendFileSync(path.join(LOG_DIR, 'app.log'), line + '\n'); } catch {}
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}

/* ---------- RBAC middleware ---------- */
/* Reads the session token from the Bearer header first, then the HttpOnly
   cookie. Decides:
     req.userId  = number (a normal user) | null (an admin token) — undefined means bad token
     req.isAdmin = true only for admin tokens (user_id IS NULL)
   Invalid/expired tokens get a 401 with no detail (no user enumeration). */
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function auth(req, res, next) {
  const c = req.cookies || {};
  const token = bearer(req) || c[USER_SESSION_COOKIE] || c[ADMIN_SESSION_COOKIE] || '';
  const uid = db.tokenUserId(token);
  if (uid === undefined) {
    log('warn', 'unauthorized access attempt -> ' + req.method + ' ' + req.path + ' from ' + req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.token = token;
  req.userId = uid;               /* number | null(admin) */
  req.isAdmin = uid === null;
  next();
}

/* User-scoped routes: the caller must be a real account, never an admin token. */
function userOnly(req, res, next) {
  if (req.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* Admin-scoped routes: the caller must hold an admin token (user_id IS NULL). */
function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ---------- session cookie (HttpOnly / Secure / SameSite=Strict) ---------- */
/* The real session secret travels ONLY in the HttpOnly cookie, so no JS ever
   sees it (no sessionStorage/Bearer on the client). A companion non-HttpOnly
   flag cookie tells the frontend "a session exists" so it can show the right
   screen synchronously — it carries no secret, only a 1.

   User and admin sessions use SEPARATE cookies. Admin uses sb_admin_session so
   logging into the admin panel in the same browser never clobbers the user's
   sb_session — both sessions can live side by side (e.g. testing the user app
   and the panel in one browser). */
const USER_SESSION_COOKIE = 'sb_session';
const USER_FLAG_COOKIE = 'sb_session_present';
const ADMIN_SESSION_COOKIE = 'sb_admin_session';
const ADMIN_FLAG_COOKIE = 'sb_admin_present';

function setSessionCookie(res, token, admin = false) {
  const session = admin ? ADMIN_SESSION_COOKIE : USER_SESSION_COOKIE;
  const flag = admin ? ADMIN_FLAG_COOKIE : USER_FLAG_COOKIE;
  res.cookie(session, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: env.sessionTtlMs
  });
  res.cookie(flag, '1', {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: env.sessionTtlMs
  });
}
function clearSessionCookie(res) {
  [USER_SESSION_COOKIE, ADMIN_SESSION_COOKIE].forEach(name => {
    res.clearCookie(name, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: '/'
    });
  });
  [USER_FLAG_COOKIE, ADMIN_FLAG_COOKIE].forEach(name => {
    res.clearCookie(name, {
      httpOnly: false,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: '/'
    });
  });
}

/* ---------- input cleaning + output escaping ---------- */
/* Removes control characters / null bytes from any string that arrives in an
   API payload. HTML metacharacters are left alone (they get escaped at render
   time, not mangled in stored data). */
function sanitizeText(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLen || 10000);
}
/* Escapes a string for safe insertion into HTML (text nodes AND attributes).
   The same helper is mirrored client-side as `esc()` in the admin panel. */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Sanitizes every string field of a validated object (walk one level deep —
   enough for our flat API payloads). */
function sanitizeStrings(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = typeof v === 'string' ? sanitizeText(v) : (v && typeof v === 'object') ? sanitizeStrings(v) : v;
  }
  return out;
}

/* ---------- schema validation (zod) ---------- */
/* Runs the schema against body + params + query, then strips control chars
   from every string in the result. Returns 400 with a human message on
   mismatch — never leaks internal detail. */
function validate(schema) {
  return (req, res, next) => {
    const r = schema.safeParse({ ...(req.body || {}), ...req.params, ...req.query });
    if (!r.success) {
      const issue = r.error.issues[0];
      const msg = issue && issue.message ? issue.message : 'Invalid request';
      return res.status(400).json({ error: msg });
    }
    req.valid = sanitizeStrings(r.data);
    next();
  };
}

/* Shared validation schemas. */
const EMAIL = z.string().trim().toLowerCase()
  .min(3).max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email');
const PASSWORD = z.string().min(6, 'Password must be 6+ characters').max(128, 'Password is too long');

const schemas = {
  register: z.object({
    name: z.string().trim().max(100, 'Name is too long').optional().default(''),
    email: EMAIL,
    phone: z.string().trim().max(30, 'Phone is too long').optional().default(''),
    password: PASSWORD
  }),
  login: z.object({
    email: EMAIL,
    password: z.string().min(1, 'Enter your password').max(128)
  }),
  verify: z.object({
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email')
  }),
  forgot: z.object({ email: EMAIL }),
  reset: z.object({
    email: EMAIL,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
    password: PASSWORD
  }),
  changePassword: z.object({
    current: z.string().min(1, 'Enter your current password').max(128),
    next: PASSWORD
  }),
  id: z.object({
    id: z.coerce.number().int().positive()
  }),
  kycLevel: z.object({
    level: z.coerce.number().int().min(1).max(3),
    verified: z.boolean().optional().default(false)
  }),
  kycUpload: z.object({
    level: z.coerce.number().int().refine(l => l === 2 || l === 3, 'Bad level'),
    docType: z.string().trim().max(60).optional().default(''),
    fileName: z.string().trim().max(200).optional().default(''),
    fileSize: z.coerce.number().int().min(0).max(100 * 1024 * 1024).optional().default(0),
    fileData: z.string().startsWith('data:', 'Missing file data').max(30 * 1024 * 1024)
  }),
  adminLogin: z.object({
    password: z.string().min(1).max(200)
  }),
  adminCreateUser: z.object({
    name: z.string().trim().max(100).optional().default(''),
    email: EMAIL,
    phone: z.string().trim().max(30).optional().default(''),
    password: PASSWORD
  }),
  adminKyc: z.object({
    id: z.coerce.number().int().positive(),
    level: z.coerce.number().int().min(1).max(3),
    verified: z.boolean().optional().default(false)
  }),
  adminEmail: z.object({
    id: z.coerce.number().int().positive(),
    template: z.enum(['welcome', 'verify-code', 'kyc-verified', 'custom']).default('custom'),
    subject: z.string().trim().max(200).optional().default(''),
    message: z.string().trim().max(20000).optional().default('')
  }),
  adminDeleteUser: z.object({
    id: z.coerce.number().int().positive()
  })
};

/* ---------- rate limiting ---------- */
/* express-rate-limit (memory store — fine for a single instance). The IP is
   the key; set TRUST_PROXY=1 behind a reverse proxy so the real client IP is
   used. */
function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    handler: (req, res) => res.status(429).json({ error: message })
  });
}

const authLimiter = limiter(15 * 60 * 1000, 20, 'Too many attempts — please wait a few minutes and try again.');
const registerLimiter = limiter(60 * 60 * 1000, 5, 'Too many accounts created from this address — try again later.');
const adminLimiter = limiter(15 * 60 * 1000, 10, 'Too many admin login attempts — please wait and try again.');
const apiLimiter = limiter(10 * 60 * 1000, 1000, 'Rate limit exceeded — slow down.');

/* ---------- HTTP security headers + CORS ---------- */
/* Helmet defaults give us HSTS, X-Frame-Options (SAMEORIGIN), nosniff, and the
   rest. CSP is tuned for the app's real needs: Tailwind Play CDN + FontAwesome
   + Google Fonts, plus inline styles and inline event handlers. The
   'unsafe-inline' in script-src is a pragmatic trade-off to keep the existing
   inline onsubmit=/onclick= handlers working; removing those handlers lets us
   drop it (see walkthrough notes). */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      /* script-src-attr must allow inline handlers — the app (and the admin
         panel's generated buttons) rely on onsubmit=/onclick= attributes.
         Removing those handlers is the follow-up that lets us drop both
         'unsafe-inline' entries. */
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      /* FontAwesome webfonts are served from cdnjs. */
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
});

const corsOptions = cors({
  origin(origin, cb) {
    /* Same-origin requests (the normal case: no Origin header) always pass. */
    if (!origin || env.appOrigin.includes(origin)) return cb(null, true);
    log('warn', 'blocked CORS origin: ' + origin);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

/* ---------- central error handling ---------- */
function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}
/* Logs the full server-side error, but only ever returns a generic message to
   the client — no stack traces, no query strings, no secrets. */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  log('error', (err && err.stack) ? err.stack : String(err));
  res.status(err && err.status && err.status < 500 ? err.status : 500)
    .json({ error: err && err.status && err.status < 500 ? err.message : 'Internal server error' });
}

/* Constant-time comparison for secrets (admin password). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  auth, userOnly, adminOnly,
  bearer, setSessionCookie, clearSessionCookie,
  sanitizeText, sanitizeStrings, escapeHtml, validate, schemas,
  authLimiter, registerLimiter, adminLimiter, apiLimiter,
  securityHeaders, corsOptions,
  notFound, errorHandler, safeEqual, log
};
