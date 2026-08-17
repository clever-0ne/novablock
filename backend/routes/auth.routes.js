/* ---------- Auth routes ---------- */

const express = require('express');
const { asyncHandler } = require('../utils/async');
const sec = require('../middleware/security');
const { validate, schemas } = require('../middleware/schemas');
const ctl = require('../controllers/auth.controller');

const router = express.Router();
const { authLimiter, registerLimiter, auth, userOnly } = sec;

router.post('/register', registerLimiter, validate(schemas.register), asyncHandler(ctl.register));
router.post('/login', authLimiter, validate(schemas.login), asyncHandler(ctl.login));
router.post('/forgot', authLimiter, validate(schemas.forgot), asyncHandler(ctl.forgot));
router.post('/reset', authLimiter, validate(schemas.reset), asyncHandler(ctl.reset));
router.post('/verify', authLimiter, auth, userOnly, validate(schemas.verify), asyncHandler(ctl.verify));
router.post('/resend-verification', authLimiter, auth, userOnly, asyncHandler(ctl.resendVerification));
router.post('/change-password', authLimiter, auth, userOnly, validate(schemas.changePassword), asyncHandler(ctl.changePassword));

module.exports = router;
