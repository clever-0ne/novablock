/* ---------- Next.js config (Vercel) ---------- */
/* The site itself is the existing static frontend in public/ (plain HTML + JS),
   and every /api/* request is handed to the Express backend through
   pages/api/[...path].js. This file maps the old Express-served URLs onto that
   layout and re-applies the security headers Helmet used to set on pages. */

const path = require('path');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com",
  "script-src-attr 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,

  /* Pin the project root — a stray lockfile higher up the disk would otherwise
     be picked as the workspace root. */
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: { root: path.resolve(__dirname) },
  reactStrictMode: true,

  /* email.js embeds public/favicon.png in outgoing mail — make sure the
     serverless function bundle ships it. */
  outputFileTracingIncludes: {
    '/api/**': ['./public/favicon.png']
  },

  async rewrites() {
    return [
      { source: '/', destination: '/index.html' }
    ];
  },

  async redirects() {
    return [
      { source: '/admin', destination: '/admin.html', permanent: false }
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }
        ]
      }
    ];
  }
};
