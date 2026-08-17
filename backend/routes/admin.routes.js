/* ---------- Admin routes ---------- */
/* POST /login is public; everything below the router.use(auth, adminOnly)
   guard requires a valid admin token (user_id NULL). The auth middleware
   re-resolves the admin cookie on /api/admin paths (via req.originalUrl), so
   a browser holding both a user and an admin session works correctly. */

const express = require('express');
const { asyncHandler } = require('../utils/async');
const sec = require('../middleware/security');
const { validate, schemas } = require('../middleware/schemas');
const ctl = require('../controllers/admin.controller');

const router = express.Router();
const { adminLimiter, auth, adminOnly } = sec;

router.post('/login', adminLimiter, validate(schemas.adminLogin), asyncHandler(ctl.login));

router.use(auth, adminOnly);

router.get('/stats', asyncHandler(ctl.stats));
router.get('/users', validate(schemas.adminListUsers), asyncHandler(ctl.listUsers));
router.get('/users/:id', validate(schemas.id), asyncHandler(ctl.getUser));
router.put('/users/:id/state', validate(schemas.adminState), asyncHandler(ctl.putUserState));
router.post('/users', validate(schemas.adminCreateUser), asyncHandler(ctl.createUser));
router.delete('/users/:id', validate(schemas.id), asyncHandler(ctl.deleteUser));
router.post('/users/:id/kyc/:level', validate(schemas.adminKyc), asyncHandler(ctl.kycLevel));
router.post('/users/:id/email', validate(schemas.adminEmail), asyncHandler(ctl.sendEmail));
/* Server-authoritative approval queue actions. */
router.post('/users/:id/tx/:txId/approve', validate(schemas.adminTxAction), asyncHandler(ctl.approveTx));
router.post('/users/:id/tx/:txId/decline', validate(schemas.adminTxAction), asyncHandler(ctl.declineTx));
router.get('/pending', asyncHandler(ctl.pending));
router.get('/emails', asyncHandler(ctl.listEmails));
router.post('/emails/clear', asyncHandler(ctl.clearEmails));
router.post('/reset', asyncHandler(ctl.resetPlatform));

module.exports = router;
