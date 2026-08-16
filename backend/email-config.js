/* ---------- Email delivery configuration ---------- */
/* All values come from backend/.env (see .env.example) — the SMTP password is
   NOT hardcoded here anymore. Fill in real credentials there to start sending
   live email:
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
   Until credentials are set, the platform stores every message in the admin
   "Email log" (status: Logged) instead of delivering it — nothing breaks.

   Common providers:
     Gmail            → smtp.gmail.com:465 (enable 2FA, use an App Password)
     Brevo (free)     → smtp-relay.brevo.com:587
     SendGrid         → smtp.sendgrid.net:587
     Mailgun          → smtp.mailgun.org:465  */

const env = require('./env');

module.exports = {
  /* Sender address — MUST be a domain you verified on your SMTP provider. */
  from: env.mailFrom,
  siteUrl: env.siteUrl,                 /* used for CTA links inside emails */
  smtp: {
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    user: env.smtp.user,
    pass: env.smtp.pass
  }
};
