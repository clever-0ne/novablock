/* ---------- Postgres connection pool ---------- */
/* Single pool for the whole backend. SSL is on for hosted providers (Neon,
   Supabase) and when the connection string asks for it — Render's free
   Postgres is excluded on purpose because it is deleted after 30 days; the app
   runs on Neon/Supabase free instead. */

const { Pool } = require('pg');
const env = require('../env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/* An idle client error must not crash the process — log and move on (the pool
   replaces the connection on the next checkout). */
pool.on('error', err => {
  console.error('[pg] idle client error:', (err && err.message) || err);
});

function query(text, params) {
  return pool.query(text, params);
}

async function health() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, health };
