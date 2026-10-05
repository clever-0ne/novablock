/* ---------- Fire-and-forget work that must still finish ---------- */
/* Emails are sent after the response so sign-up / login stay fast. On Vercel
   the function is frozen as soon as the response is sent, which silently
   killed every un-awaited email (no "sent", no "failed" — nothing). waitUntil
   keeps the function alive until the promise settles. Off Vercel (local dev)
   it is a no-op and the promise simply runs on. Errors are swallowed here —
   sendEmail already records failures in the admin email log. */

const { waitUntil } = require('@vercel/functions');

function background(promise) {
  const p = Promise.resolve(promise).catch(err => {
    console.error('[background] ' + ((err && err.message) || err));
  });
  try { waitUntil(p); } catch {}
  return p;
}

module.exports = { background };
