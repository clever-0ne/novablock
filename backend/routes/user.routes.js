/* ---------- User routes ---------- */

const express = require('express');
const { asyncHandler } = require('../utils/async');
const sec = require('../middleware/security');
const { validate, schemas } = require('../middleware/schemas');
const ctl = require('../controllers/user.controller');
const authCtl = require('../controllers/auth.controller');

const router = express.Router();
const { auth, userOnly } = sec;

router.get('/me', auth, userOnly, asyncHandler(ctl.me));
/* logout lives in the auth controller — pointing at user.controller (where it
   does not exist) crashed every logout, so the session was never revoked and
   reopening the site logged you straight back in. */
router.post('/logout', asyncHandler(authCtl.logout));
router.get('/state', auth, userOnly, asyncHandler(ctl.getState));
router.put('/state', auth, userOnly, asyncHandler(ctl.putState));
router.get('/kyc', auth, userOnly, asyncHandler(ctl.getKyc));
/* /kyc/upload MUST be registered before /kyc/:level — otherwise "upload" would
   be parsed as a level value. */
router.post('/kyc/upload', auth, userOnly, validate(schemas.kycUpload), asyncHandler(ctl.kycUpload));
router.post('/kyc/:level', auth, userOnly, validate(schemas.kycLevel), asyncHandler(ctl.kycLevel));
router.delete('/kyc', auth, userOnly, asyncHandler(ctl.deleteKyc));
router.post('/reset', auth, userOnly, asyncHandler(ctl.resetUser));
router.post('/transactions', auth, userOnly, validate(schemas.submitTx), asyncHandler(ctl.submitTransaction));

module.exports = router;
