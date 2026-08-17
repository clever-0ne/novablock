/* ---------- Server-authoritative transactions ---------- */
/* The only way deposits/withdrawals enter a user's ledger. The client's old
   flow kept pending txs in localStorage and pushed the whole state on a
   debounce — so requests vanished when the push raced a restart, and approval
   was a client-side mutation. Now every request is an atomic Postgres write
   keyed to the session user, and admin approval books the single unified
   balance inside one DB transaction (BEGIN … FOR UPDATE … COMMIT). */

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { normalizeState } = require('../utils/state');

/* Referrer payout: 10% of the referred user's first approved deposit. */
const REFERRAL_BONUS_RATE = 0.10;

function todayStr() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function nowStr() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* Inserts a pending deposit/withdrawal record into the user's state, idempotent
   on the client-supplied id (a safe retry returns the existing record). */
async function addPendingTx(userId, { type, asset, amount, to, clientId }) {
  const id = clientId || 'srv-' + crypto.randomUUID();
  const signed = type === 'deposit' ? Math.abs(amount) : -Math.abs(amount);
  const tx = { id, type, asset, amount: signed, date: todayStr(), time: nowStr(), status: 'pending', to: to || '' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT state FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!r.rows.length) throw err(404, 'User not found');
    const state = normalizeState(r.rows[0].state);
    /* ids arrive from the client as numbers (txId()) or from URLs as strings —
       compare stringified so a retry always matches its earlier record. */
    const existing = state.transactions.find(t => String(t.id) === String(id));
    if (existing) {
      await client.query('COMMIT');
      return { ok: true, tx: existing, already: true };
    }
    state.transactions.unshift(tx);
    await client.query('UPDATE users SET state = $1 WHERE id = $2', [JSON.stringify(state), userId]);
    await client.query('COMMIT');
    return { ok: true, tx };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* Approve (books the unified balance) or decline (marks failed) a pending tx.
   Runs in one DB transaction so no client race can corrupt the ledger. */
async function setTxStatus(userId, txId, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT state FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!r.rows.length) throw err(404, 'User not found');
    const state = normalizeState(r.rows[0].state);
    const tx = state.transactions.find(t => String(t.id) === String(txId));
    if (!tx) throw err(404, 'Transaction not found');
    if (tx.status !== 'pending') throw err(409, 'Transaction already processed');

    if (action === 'approve') {
      const amt = Math.abs(tx.amount);
      if (tx.type === 'deposit') {
        state.balances.amount += amt;       /* cash only — no holdings double-credit */
        state.balances.deposit += amt;

        /* First approved deposit pays the referrer a bonus, all inside this
           same DB transaction (referrer row locked with FOR UPDATE, so no
           double-payout even with concurrent approvals). */
        if (state.referrer) {
          const rr = await client.query('SELECT state FROM users WHERE id = $1 FOR UPDATE', [state.referrer]);
          if (rr.rows.length) {
            const refState = normalizeState(rr.rows[0].state);
            const entry = (refState.referrals || []).find(x => String(x.id) === String(userId));
            if (entry && entry.status !== 'active') {
              const bonus = Math.round(amt * REFERRAL_BONUS_RATE * 100) / 100;
              refState.balances.amount += bonus;
              refState.balances.bonus += bonus;
              entry.status = 'active';
              entry.earned = bonus;
              refState.transactions.unshift({
                id: 'srv-' + crypto.randomUUID(), type: 'bonus', asset: 'Referral',
                amount: bonus, date: todayStr(), time: nowStr(), status: 'completed'
              });
              refState.notifications.unshift({
                id: Date.now(), title: 'Referral bonus earned',
                body: 'You earned $' + bonus.toFixed(2) + ' from ' + (state.profile.fullName || 'a referred user') + "'s first deposit",
                time: nowStr() + ' · ' + todayStr(), read: false
              });
              await client.query('UPDATE users SET state = $1 WHERE id = $2', [JSON.stringify(refState), state.referrer]);
            }
          }
        }
      } else if (tx.type === 'withdrawal') {
        state.balances.amount = Math.max(0, state.balances.amount - amt);
        state.balances.withdrawal += amt;
      }
      tx.status = 'completed';
    } else {
      tx.status = 'failed';
    }

    await client.query('UPDATE users SET state = $1 WHERE id = $2', [JSON.stringify(state), userId]);
    await client.query('COMMIT');
    return { ok: true, tx, balances: state.balances };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { addPendingTx, setTxStatus };
