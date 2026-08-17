/* ---------- Uploads routes (signed KYC document links) ---------- */

const express = require('express');
const { asyncHandler } = require('../utils/async');
const ctl = require('../controllers/uploads.controller');

const router = express.Router();

router.get('/:uid/:file', asyncHandler(ctl.serveKycDoc));

module.exports = router;
