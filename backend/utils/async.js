/* ---------- Async route wrapper ---------- */
/* Express 4 does not catch promise rejections from async handlers — an unhandled
   rejection crashes (or silently hangs) the request. asyncHandler forwards the
   rejection to the central error handler instead. Wrap every DB-touching route. */

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
