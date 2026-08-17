/* ---------- Security layer: RBAC, cookies, rate limiting, headers ---------- */
/* Cross-cutting production safeguards, independent of validation:
     - auth / userOnly / adminOnly   RBAC middleware (Bearer header or HttpOnly cookie)
     - setSessionCookie / clearSessionCookie   dual user/admin cookies
     - sanitizeText / sanitizeStrings          input cleaning
     - rate limiters                  brute-force protection on auth endpoints
     - securityHeaders, corsOptions   Helmet + CORS allowlist
     - log / errorHandler             central logging + safe error responses
   Sessions: a token row in Postgres is the source of truth. It travels either
   in the Authorization: Bearer header (the app's existing flow) or in the
   HttpOnly "sb_session" cookie. Both point at the same token. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const env = require('../env');
const { asyncHandler } = require('../utils/async');

/* ---------- logging ---------- */
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
function log(level, msg) {
  const line = '[' + new Date().toISOString() + '] [' + level.toUpperCase() + '] ' + msg;
  try { fs.appendFileSync(path.join(LOG_DIR, 'app.log'), line + '\n'); } catch {}
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}

/* ---------- RBAC middleware ---------- */
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/* Async (DB lookup). Uses req.originalUrl so the /api/admin cookie re-resolve
   survives sub-router mounting (req.path is stripped to the router's scope). */
const auth = asyncHandler(async function auth(req, res, next) {
  const c = req.cookies || {};
  let token = bearer(req) || c[USER_SESSION_COOKIE] || c[ADMIN_SESSION_COOKIE] || '';
  let uid = await db.tokenUserId(token);
  /* Admin routes must be able to use the ADMIN cookie even when the same
     browser also holds a user session — the user cookie shadows the admin
     cookie in the fallback chain above, so every /api/admin call would 401
     (`adminOnly`) and the panel would bounce straight back to its login
     screen right after signing in. Re-resolve with the admin cookie when the
     route is admin and the first resolution isn't already an admin token. */
  if (req.originalUrl.startsWith('/api/admin') && uid !== null) {
    const adminToken = c[ADMIN_SESSION_COOKIE] || '';
    const adminUid = adminToken ? await db.tokenUserId(adminToken) : undefined;
    if (adminUid === null) { token = adminToken; uid = adminUid; }
  }
  if (uid === undefined) {
    log('warn', 'unauthorized access attempt -> ' + req.method + ' ' + req.originalUrl + ' from ' + req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.token = token;
  req.userId = uid;               /* number | null(admin) */
  req.isAdmin = uid === null;
  next();
});

function userOnly(req, res, next) {
  if (req.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ---------- session cookies (HttpOnly / Secure / SameSite=Strict) ---------- */
/* User and admin sessions use SEPARATE cookies, so logging into the admin panel
   in the same browser never clobbers the user's sb_session. */
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
    res.clearCookie(name, { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/' });
  });
  [USER_FLAG_COOKIE, ADMIN_FLAG_COOKIE].forEach(name => {
    res.clearCookie(name, { httpOnly: false, secure: env.cookieSecure, sameSite: 'strict', path: '/' });
  });
}

/* ---------- input cleaning ---------- */
function sanitizeText(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLen || 10000);
}
/* Sanitizes every string field of a validated object (walk one level deep). */
function sanitizeStrings(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = typeof v === 'string' ? sanitizeText(v) : (v && typeof v === 'object') ? sanitizeStrings(v) : v;
  }
  return out;
}

/* ---------- rate limiting ---------- */
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
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
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
  sanitizeText, sanitizeStrings,
  authLimiter, registerLimiter, adminLimiter, apiLimiter,
  securityHeaders, corsOptions,
  notFound, errorHandler, safeEqual, log
};
