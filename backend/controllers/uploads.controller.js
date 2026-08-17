/* ---------- Uploads controller: served KYC documents ---------- */
/* Documents come from the kyc_files bytea table, not disk — they survive
   redeploys. Access is only through the HMAC-signed links issued to the owning
   user. No signature → no document. */

const path = require('path');
const db = require('../db');
const { verifyDocSig } = require('../utils/docurl');

async function serveKycDoc(req, res) {
  const uid = parseInt(req.params.uid, 10);
  const file = path.basename(req.params.file);
  const { exp, sig } = req.query || {};
  if (!verifyDocSig(uid, file, exp, sig)) return res.status(403).json({ error: 'Forbidden' });
  const doc = await db.getKycFile(uid, file);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="' + file + '"');
  res.send(doc.data);
}

module.exports = { serveKycDoc };
