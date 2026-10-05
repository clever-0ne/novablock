/* ---------- Central configuration (backend/.env) ---------- */
/* Every secret and environment value is read here at boot and referenced from
   the rest of the app — nothing is hardcoded in route or DB code anymore.

   Production (NODE_ENV=production) refuses to start if a required secret is
   missing. Development falls back to safe defaults so local work keeps running;
   set the real values in backend/.env (see .env.example). */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/* Next.js bundles this file, so __dirname may not be backend/ — also look it up
   from the project root. On Vercel the values come from the project's
   Environment Variables instead (no .env file is deployed). */
const envFile = [path.join(__dirname, '.env'), path.join(process.cwd(), 'backend', '.env')].find(f => fs.existsSync(f));
if (envFile) dotenv.config({ path: envFile });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function required(name, devDefault) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  /* A provided fallback applies in every environment — only SECRETS (which are
     passed without a default) hard-fail in production. */
  if (devDefault !== undefined) {
    console.warn('[env] WARNING: ' + name + ' is not set — using the fallback. Put a real value in backend/.env or your host before going live.');
    return devDefault;
  }
  if (isProd) {
    throw new Error('Missing required environment variable: ' + name + ' (set it in backend/.env or your host)');
  }
  return '';
}

const env = {
  NODE_ENV,
  isProd,

  port: parseInt(process.env.PORT || '3000', 10),

  /* Allowed origins for browser cross-origin requests (comma-separated). The
     app is same-origin (Express serves the static frontend), so this allowlist
     only matters if an API client calls from elsewhere. */
  appOrigin: (process.env.APP_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean),

  /* Set TRUST_PROXY=1 when running behind a reverse proxy (Nginx, Caddy,
     Render, Fly.io) so rate-limiters and req.ip see the real client IP. */
  trustProxy: process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : (process.env.VERCEL ? 1 : false),

  /* HttpOnly session cookie: Secure is forced on in production (HTTPS only),
     and can be enabled manually in dev with COOKIE_SECURE=1. */
  cookieSecure: process.env.COOKIE_SECURE === '1' || isProd,

  sessionTtlMs: parseInt(process.env.SESSION_TTL_DAYS || '7', 10) * 24 * 60 * 60 * 1000,

  /* Password hashing cost — bcrypt rounds. 12 is the OWASP floor for 2026. */
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  /* Persistent storage — Postgres via Neon/Supabase free tier. Required in
     EVERY environment (including dev): the old SQLite file lived on Render's
     ephemeral disk and was wiped on every restart, which is what made users,
     sessions and deposits "disappear". No DB URL → the app refuses to boot. */
  databaseUrl: required('DATABASE_URL'),
  /* SSL is on for hosted providers and when the connection string asks for it.
     Set PGSSL=1 to force it locally against a TLS-terminating tunnel. */
  pgSsl: process.env.PGSSL === '1'
    || /(sslmode=(require|verify-ca|verify-full)|ssl=true|neon\.tech|supabase\.co)/i.test(process.env.DATABASE_URL || ''),


  /* Secrets — no dev fallbacks. A missing value refuses to boot (an empty or
     hardcoded default password would let anyone into the admin panel). */
  adminPass: required('ADMIN_PASS'),
  kycUrlSecret: required('KYC_URL_SECRET'),

  /* SMTP delivery (also used by backend/email-config.js). */
  smtp: {
    host: required('SMTP_HOST', 'smtp.resend.com'),
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_PORT || '587') === '465',
    user: required('SMTP_USER', 'resend'),
    pass: required('SMTP_PASS', '')
  },
  mailFrom: process.env.MAIL_FROM || 'NovaBlock.io <no-reply@podz.buzz>',
  siteUrl: process.env.SITE_URL || 'http://localhost:3000/'
};

/* Never boot with a blank/fallback secret — an empty ADMIN_PASS would make the
   admin login pass for an empty password. */
if (!env.adminPass) throw new Error('Missing ADMIN_PASS — set it in backend/.env (try `node -e "require(\'crypto\').randomBytes(24).toString(\'base64url\')"` to generate one)');
if (!env.kycUrlSecret) throw new Error('Missing KYC_URL_SECRET — set it in backend/.env');
if (!env.databaseUrl) throw new Error('Missing DATABASE_URL — set your Postgres connection string in backend/.env (Neon/Supabase free tier) and in the Vercel project environment variables');

module.exports = env;
