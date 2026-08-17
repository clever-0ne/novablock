/* ---------- Express app factory ---------- */
/* Middleware chain + router mounts. No listen() here — server.js boots the app
   after migrations/health pass, so the process fails fast on a bad database
   instead of serving 500s against a wiped/empty store. */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const env = require('./env');
const sec = require('./middleware/security');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const uploadsRoutes = require('./routes/uploads.routes');

const FRONTEND = path.join(__dirname, '..', 'frontend');

function createApp() {
  const app = express();

  /* Behind a reverse proxy (Nginx, Render, Fly.io)? Set TRUST_PROXY=1 so the
     rate limiters and req.ip see the real client IP. */
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  /* ---------- global hardening middleware ---------- */
  app.use(sec.securityHeaders);     /* CSP, HSTS, X-Frame-Options, nosniff, … */
  app.use(sec.corsOptions);         /* restricted to env.appOrigin */
  app.use(cookieParser());          /* reads the HttpOnly session cookie */
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', sec.apiLimiter);  /* light global ceiling for all API calls */

  /* ---------- route mounts ---------- */
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', userRoutes);
  app.use('/api', uploadsRoutes);

  /* Convenience: /admin redirects to the admin page (served from frontend/). */
  app.get('/admin', (req, res) => res.redirect('/admin.html'));

  /* Frontend only — served statically from frontend/. The backend code, data,
     uploads and .env are no longer reachable over HTTP. */
  app.use(express.static(FRONTEND));

  /* ---------- 404 + central error handling ---------- */
  app.use('/api', sec.notFound);
  app.use(sec.errorHandler);

  return app;
}

module.exports = { createApp };
