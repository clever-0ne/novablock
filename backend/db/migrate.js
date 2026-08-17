/* ---------- Schema bootstrap (idempotent) ---------- */
/* Runs at boot. CREATE TABLE IF NOT EXISTS means a fresh Neon/Supabase database
   self-provisions — no separate migration step. All migrations from the old
   SQLite file (verify/reset columns, expires_at, html_body, failure) are folded
   directly into the canonical table definitions. */

const { query } = require('./pool');

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id             BIGSERIAL PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      password       TEXT NOT NULL,
      name           TEXT NOT NULL DEFAULT '',
      phone          TEXT NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      state          JSONB NOT NULL DEFAULT '{}'::jsonb,
      kyc            JSONB NOT NULL DEFAULT '{}'::jsonb,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      verify_code    TEXT NOT NULL DEFAULT '',
      verify_expires TIMESTAMPTZ,
      reset_token    TEXT NOT NULL DEFAULT '',
      reset_expires  TIMESTAMPTZ,
      reset_attempts INTEGER NOT NULL DEFAULT 0
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tokens (
      token      TEXT PRIMARY KEY,
      user_id    BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS emails (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT,
      to_email   TEXT,
      template   TEXT,
      subject    TEXT,
      body       TEXT,
      html_body  TEXT,
      status     TEXT,
      failure    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  /* KYC documents moved off the ephemeral disk into bytea — they now survive
     redeploys and are served through the same HMAC-signed URLs. */
  await query(`
    CREATE TABLE IF NOT EXISTS kyc_files (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL,
      level      INTEGER,
      fname      TEXT NOT NULL,
      mime       TEXT NOT NULL DEFAULT '',
      data       BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_kyc_files_user ON kyc_files(user_id)`);
}

module.exports = { migrate };
