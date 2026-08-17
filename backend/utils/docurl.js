/* ---------- Signed KYC document links ---------- */
/* KYC docs live at /api/uploads/<uid>/<file>. They are NOT world-readable:
   each saved docUrl carries an HMAC signature only the owning account (and
   admin) ever sees, so no other user can fetch someone's ID photos by guessing
   a path. Links are valid for 30 days. */

const crypto = require('crypto');
const env = require('../env');

const DOC_URL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signDocUrl(uid, file) {
  const exp = Date.now() + DOC_URL_TTL_MS;
  const msg = uid + ':' + file + ':' + exp;
  const sig = crypto.createHmac('sha256', env.kycUrlSecret).update(msg).digest('base64url');
  return '/api/uploads/' + uid + '/' + encodeURIComponent(file) + '?exp=' + exp + '&sig=' + sig;
}

function verifyDocSig(uid, file, exp, sig) {
  if (!uid || !file || !exp || !sig) return false;
  const msg = uid + ':' + file + ':' + exp;
  const ok = crypto.createHmac('sha256', env.kycUrlSecret).update(msg).digest('base64url') === sig;
  return ok && Date.now() <= Number(exp);
}

module.exports = { signDocUrl, verifyDocSig };
