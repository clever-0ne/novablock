/* ---------- NovaBlock.io backend: Express + Postgres + email ---------- */
/* Run with: node server.js  →  http://localhost:3000
   User app at / , admin panel at /admin.
   The backend is the user database: every account owns its own state (one
   canonical unified balance), and the admin panel manages them through the
   /api/admin/* endpoints.

   Boot order: run schema migrations against Postgres → verify connectivity
   (SELECT 1) → listen. Any failure exits non-zero with a clear message, so the
   app can never silently run against a wiped or unreachable store again.

   Security model (see backend/middleware/* for the building blocks):
     - Sessions are per-user random tokens in the `tokens` table, carried either
       in Authorization: Bearer or the HttpOnly "sb_session" cookie.
     - RBAC middleware (auth / userOnly / adminOnly) guards every route.
     - All payloads are zod-validated; passwords are bcrypt-hashed.
     - Auth endpoints are rate-limited; Helmet + CORS allowlist are applied.
     - Central error handler logs server-side but never leaks details. */

const env = require('./env');
const { migrate } = require('./db/migrate');
const { health } = require('./db/pool');
const { createApp } = require('./app');

async function boot() {
  await migrate();   /* idempotent schema bootstrap */
  await health();    /* SELECT 1 — fail fast if Postgres is unreachable */
  const app = createApp();
  app.listen(env.port, () => {
    console.log('NovaBlock.io backend running →  http://localhost:' + env.port);
    console.log('  User app : http://localhost:' + env.port + '/');
    console.log('  Admin    : http://localhost:' + env.port + '/admin');
    if (!env.isProd) console.log('  [env] development mode — set NODE_ENV=production before going live.');
  });
}

boot().catch(err => {
  console.error('NovaBlock.io failed to boot:', (err && err.message) || err);
  process.exit(1);
});
