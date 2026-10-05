/* ---------- Express app factory ---------- */
/* Middleware chain + router mounts. No listen() here — pages/api/[...path].js
   hands every /api/* request from Next.js (Vercel) to this app after
   migrations/health have passed once per cold start. */

const express = require('express');
const cookieParser = require('cookie-parser');

const env = require('./env');
const sec = require('./middleware/security');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const uploadsRoutes = require('./routes/uploads.routes');

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
  app.use('/api/uploads', uploadsRoutes);  /* signed links are /api/uploads/<uid>/<file> */

  /* The static frontend (public/) and the /admin redirect are served by
     Next.js — see next.config.js. This app only handles /api/*. */

  /* ---------- 404 + central error handling ---------- */
  app.use('/api', sec.notFound);
  app.use(sec.errorHandler);

  return app;
}

module.exports = { createApp };
