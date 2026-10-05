/* ---------- /api/* → Express backend ---------- */
/* Next.js (Vercel serverless) entry for the whole API. The existing Express app
   in backend/ handles the request unchanged — req/res here are plain Node
   objects, which Express accepts directly.

   Boot order per cold start: run schema migrations → verify connectivity
   (SELECT 1) → build the app. A failure returns 503 and is retried on the next
   request instead of serving 500s against an unreachable database. The backend
   is required lazily so `next build` never needs the runtime secrets. */

let ready = null;

function boot() {
  if (!ready) {
    ready = (async () => {
      const { migrate } = require('../../backend/db/migrate');
      const { health } = require('../../backend/db/pool');
      const { createApp } = require('../../backend/app');
      await migrate();   /* idempotent schema bootstrap */
      await health();    /* SELECT 1 — fail fast if Postgres is unreachable */
      return createApp();
    })().catch(err => {
      ready = null;      /* allow the next request to retry */
      throw err;
    });
  }
  return ready;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await boot();
  } catch (err) {
    console.error('NovaBlock.io failed to boot:', (err && err.message) || err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Service unavailable' }));
  }
  return new Promise(resolve => {
    res.on('finish', resolve);
    res.on('close', resolve);
    app(req, res);
  });
}

export const config = {
  api: {
    bodyParser: false,        /* Express parses the body itself (express.json) */
    externalResolver: true,   /* Express sends the response, not Next */
    responseLimit: false      /* KYC documents can be larger than 4MB */
  }
};
