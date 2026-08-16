/* ---------- Email system: branded HTML templates + SMTP delivery ---------- */
/* Built-in automation emails:
     welcome      → sent automatically when an account is created (sign-up)
     verify-code  → sent automatically on KYC Level 1 (email verification);
                    carries a fresh 6-digit code. Also available to the admin.
     kyc-verified → sent when a higher KYC level is approved
     custom       → admin-composed message
   Every email is recorded in the emails table (plain text + styled HTML).
   Without SMTP credentials the row is stored as "logged" and nothing is sent;
   once backend/email-config.js is filled in, the same email is delivered
   (status "sent"). Templates use {{name}} {{email}} {{accountId}} placeholders. */

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./email-config');

function emailConfigured() {
  /* All three must be present — an empty SMTP_PASS makes the transport fail
     auth on every send while still claiming the feature is configured. */
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass);
}

let _transport = null;
function transport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    });
  }
  return _transport;
}

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Replaces {{name}} / {{email}} / {{accountId}} style placeholders. */
function fill(str, data) {
  return String(str || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    (data && data[k] !== undefined && data[k] !== null ? data[k] : m));
}

function userData(user) {
  const p = (user && user.state && user.state.profile) || {};
  return {
    name: p.fullName || (user && user.name) || 'there',
    email: (user && user.email) || '',
    accountId: p.accountId || ''
  };
}

function genCode(len) {
  return crypto.randomInt(0, Math.pow(10, len)).toString().padStart(len, '0');
}

/* Brand logo, embedded as an inline attachment (Content-ID) so it renders in
   Gmail, Outlook and Apple Mail — the most reliable way to show an image in
   email. Falls back to the text-only header if favicon.png is missing. */
let LOGO_PATH = path.join(__dirname, '..', 'frontend', 'favicon.png');
let LOGO_CID = null;
let logoImg = '';
try { if (fs.existsSync(LOGO_PATH)) LOGO_CID = 'novablock-logo'; } catch {}
if (LOGO_CID) {
  logoImg = '<div style="margin:0 0 14px;">'
    + '<img src="cid:' + LOGO_CID + '" width="56" height="56" alt="NovaBlock.io" '
    + 'style="display:block;width:56px;height:56px;border:0;border-radius:14px;margin:0 auto;">'
    + '</div>';
}

/* ---------- Branded HTML shell (inline CSS + table layout = mail-client safe) ---------- */
/* HARD-CODED DARK, enforced at every layer so NO mail client can re-render it
   light:
     1. color-scheme "only dark" — the keyword "only" tells Gmail / Apple Mail /
        Outlook to NEVER convert this message to their light theme, even when the
        reader's system is in light mode. (Clients that ignore it simply fall
        back to our explicit colors below — still dark.)
     2. bgcolor attribute + inline background-color on every table and cell —
        Outlook desktop (Word engine) strips <style> and body CSS, but honors
        bgcolor attributes, so the whole canvas stays dark.
     3. A VML v:background paints the full window dark in Outlook desktop.
     4. A prefers-color-scheme light guard re-forces the dark background even in
        clients that read the OS theme.
     5. Gmail's [data-ogsc]/[data-ogsb] attributes keep Gmail (Android) from
        force-inverting an already-dark message. */
function shell(inner) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="only dark">',
    '<meta name="supported-color-schemes" content="only dark">',
    '<title>NovaBlock.io</title>',
    '<style>',
    ':root{color-scheme:only dark;}',
    'html,body{background-color:#060913 !important;}',
    '@media (prefers-color-scheme: light){html,body{background-color:#060913 !important;}}',
    '[data-ogsc] html,[data-ogsc] body{background-color:#060913 !important;}',
    '[data-ogsb] html,[data-ogsb] body{background-color:#060913 !important;}',
    '@media only screen and (max-width:620px){.wrap{width:100% !important}.card{padding:24px 20px !important}}',
    '</style>',
    '</head>',
    '<body bgcolor="#060913" style="margin:0;padding:0;background-color:#060913;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<!--[if gte mso 9]><v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t"><v:fill type="solid" color="#060913"/></v:background><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#060913" style="background-color:#060913;">',
    '<tr><td align="center" bgcolor="#060913" style="padding:36px 14px 24px;background-color:#060913;">',
    '<table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" bgcolor="#060913" style="max-width:600px;width:100%;background-color:#060913;">',

    /* header */
    '<tr><td align="center" bgcolor="#060913" style="padding:0 0 22px;background-color:#060913;">',
    logoImg,
    '<div style="font-size:23px;font-weight:800;letter-spacing:.5px;color:#ffffff;">Nova<span style="color:#8b5cf6;">Block</span><span style="color:#22d3ee;">.io</span></div>',
    '<div style="margin-top:5px;font-size:10px;letter-spacing:.28em;color:#475569;text-transform:uppercase;">Trade stocks &amp; crypto</div>',
    '</td></tr>',

    /* body card */
    '<tr><td class="card" bgcolor="#0e1526" style="background-color:#0e1526;border:1px solid #1e293b;border-radius:18px;padding:30px 32px;">',
    inner,
    '</td></tr>',

    /* footer */
    '<tr><td align="center" bgcolor="#060913" style="padding:20px 12px 4px;background-color:#060913;">',
    '<p style="margin:0 0 8px;font-size:12px;color:#64748b;">This is an automated message from NovaBlock.io — please do not reply.</p>',
    '<p style="margin:0;font-size:11px;color:#475569;line-height:1.6;">Trading stocks and cryptocurrencies involves substantial risk of loss.<br>&copy; ' + new Date().getFullYear() + ' NovaBlock.io Markets Ltd. All rights reserved.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body></html>'
  ].join('\n');
}

/* Small building blocks (all inline styles). */
const h1 = t => '<h1 style="margin:0 0 10px;font-size:21px;font-weight:700;color:#ffffff;">' + t + '</h1>';
const p = (t, extra) => '<p style="margin:0 0 18px;font-size:14px;color:#94a3b8;line-height:1.75;' + (extra || '') + '">' + t + '</p>';
function infoCard(label, value, accent) {
  return '<div style="background:#0a101f;border:1px solid #1e293b;border-radius:12px;padding:14px 18px;margin:0 0 20px;">'
    + '<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px;">' + label + '</div>'
    + '<div style="font-size:20px;font-weight:800;font-family:\'Courier New\',monospace;letter-spacing:1px;color:' + (accent || '#a78bfa') + ';">' + value + '</div>'
    + '</div>';
}
function ctaButton(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="border-radius:10px;background:#6366f1;border-bottom:3px solid #4f46e5;">'
    + '<a href="' + esc(href) + '" style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">' + label + '</a>'
    + '</td></tr></table>';
}

/* ---------- Template content builders ---------- */
function welcomeInner(u) {
  const d = userData(u);
  return h1('Welcome to NovaBlock.io')
    + p('Hi ' + esc(d.name) + ', your account has been created successfully. Here is your account reference — keep it safe.')
    + infoCard('Account ID', esc(d.accountId))
    + p('<strong style="color:#e2e8f0;">Getting started:</strong>')
    + '<ol style="margin:0 0 22px;padding-left:20px;font-size:14px;color:#94a3b8;line-height:2;">'
    + '<li>Sign in with the email and password you used to register.</li>'
    + '<li>Complete <strong style="color:#e2e8f0;">KYC verification</strong> to unlock deposits and withdrawals.</li>'
    + '<li>Make a deposit and start trading stocks and crypto.</li>'
    + '</ol>'
    + ctaButton(config.siteUrl, 'Go to your dashboard')
    + p('<span style="font-size:12px;color:#475569;">Need help? Reply to this email and our team will assist you.</span>', 'margin-bottom:0;');
}

function verifyCodeInner(u, code) {
  const d = userData(u);
  return h1('Verify your email')
    + p('Hi ' + esc(d.name) + ', use the verification code below to confirm your email address and activate your account.')
    + infoCard('Verification code', esc(code), '#22d3ee')
    + p('This code expires in <strong style="color:#e2e8f0;">15 minutes</strong>. If you didn\'t request this, you can safely ignore this email — no action is needed.')
    + '<div style="background:#0a101f;border:1px dashed #334155;border-radius:12px;padding:14px 18px;margin:0;">'
    + '<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px;">Why am I getting this?</div>'
    + '<p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.7;">We send this code whenever someone requests email verification for a NovaBlock.io account.</p>'
    + '</div>';
}

function kycInner(u, level) {
  const d = userData(u);
  const names = { 1: 'Email & phone', 2: 'Government ID', 3: 'Proof of address' };
  const lbl = names[level] || ('Level ' + level);
  const all = level >= 3;
  return h1(all ? 'You’re fully verified' : 'Verification approved')
    + p('Hi ' + esc(d.name) + ', good news — your <strong style="color:#e2e8f0;">' + lbl + '</strong> verification has been approved.')
    + infoCard('Verification status', 'Level ' + level + ' — Verified', '#34d399')
    + p(all
        ? 'You are now fully verified. Deposits, withdrawals and external transfers are unlocked.'
        : 'Continue with the remaining levels to unlock withdrawals and higher limits.')
    + ctaButton(config.siteUrl, 'View your account');
}

function customInner(subject, message, u) {
  const d = userData(u);
  return h1(esc(subject || 'Message from NovaBlock.io'))
    + p(esc(fill(message || '', d)).replace(/\n/g, '<br>'), 'margin-bottom:0;');
}

function resetInner(u, code) {
  const d = userData(u);
  return h1('Reset your password')
    + p('Hi ' + esc(d.name) + ', a password reset was requested for <strong style="color:#e2e8f0;">' + esc(d.email) + '</strong>. Use the code below to choose a new password.')
    + infoCard('Password reset code', esc(code), '#22d3ee')
    + p('Enter this code on the <strong style="color:#e2e8f0;">reset password</strong> page along with your new password. It expires in <strong style="color:#e2e8f0;">15 minutes</strong> and can only be used once.')
    + '<div style="background:#0a101f;border:1px dashed #334155;border-radius:12px;padding:14px 18px;margin:0;">'
    + '<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px;">Important</div>'
    + '<p style="margin:0;font-size:12px;color:#64748b;line-height:1.7;">If you didn\'t request this, ignore this email — your password will not change.</p>'
    + '</div>';
}

const LEVEL_NAMES = { 1: 'Email & phone verification', 2: 'Government ID verification', 3: 'Proof of address verification' };

/* ---------- Template registry ---------- */
const TEMPLATES = {
  welcome: {
    subject: () => 'Welcome to NovaBlock.io — your account is ready',
    build: u => ({
      text: 'Hi {{name}},\n\nWelcome to NovaBlock.io — your account has been created successfully.\n\nAccount ID: {{accountId}}\n\nNext steps:\n1. Complete your email & phone verification in the KYC section\n2. Make a deposit to fund your account\n3. Start trading stocks and crypto\n\nIf you have any questions, just reply to this email.\n\n— The NovaBlock.io Team',
      html: welcomeInner(u)
    })
  },
  'verify-code': {
    subject: () => 'Your NovaBlock.io verification code',
    build: (u, code) => ({
      text: 'Hi {{name}},\n\nYour NovaBlock.io verification code is: ' + code + '\n\nThis code expires in 15 minutes.\n\nIf you did not request this, you can ignore this email.\n\n— The NovaBlock.io Team',
      html: verifyCodeInner(u, code)
    })
  },
  'kyc-verified': {
    subject: () => 'Your identity has been verified',
    build: (u, level) => ({
      text: 'Hi {{name}},\n\nGood news — your ' + (LEVEL_NAMES[level] || 'verification') + ' has been approved.\n\nVerification status: Level ' + level + ' — Verified ✓' + (level >= 3 ? '\n\nYou are now fully verified — deposits, withdrawals and external transfers are unlocked.' : '') + '\n\n— The NovaBlock.io Team',
      html: kycInner(u, level)
    })
  },
  'password-reset': {
    subject: () => 'Your NovaBlock.io password reset code',
    build: (u, code) => {
      const d = userData(u);
      return {
        text: 'Hi ' + d.name + ',\n\nWe received a request to reset your NovaBlock.io password.\n\nYour password reset code is: ' + code + '\n\nEnter it on the reset password page (reset.html) along with your new password. It expires in 15 minutes and can only be used once.\n\nIf you did not request this, you can safely ignore this email — your password will not change.\n\n— The NovaBlock.io Team',
        html: resetInner(u, code)
      };
    }
  },
  custom: {
    subject: o => o.subject || 'Message from NovaBlock.io',
    build: (u, code, o) => ({
      text: fill(o.message || '', userData(u)),
      html: customInner(o.subject, o.message, u)
    })
  }
};

/* Returns a rendered template { template, subject, text, html } with placeholders
   filled against the user. A verification code is auto-generated unless provided. */
function render(templateName, user, opts) {
  opts = opts || {};
  const name = TEMPLATES[templateName] ? templateName : 'custom';
  const t = TEMPLATES[name];
  let code;
  if (name === 'verify-code' || name === 'password-reset') code = opts.code || genCode(6);
  const built = t.build(user, code, opts);
  return {
    template: name,
    subject: fill(t.subject(opts), userData(user)),
    text: built.text,
    html: shell(built.html)
  };
}

/* Sends (or logs) an email. Always records a row in the emails table, keeping
   both the plain-text body (log preview) and the styled HTML (log preview popup). */
async function sendEmail({ userId, to, template, subject, text, html }) {
  try {
    if (!emailConfigured()) {
      db.logEmail({ userId, toEmail: to, template, subject, text, html, status: 'logged' });
      return { ok: true, status: 'logged' };
    }
    const info = await transport().sendMail({
      from: config.from,
      to,
      subject: subject || '',
      text: text || '',
      html: html || '',
      attachments: LOGO_CID ? [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }] : undefined
    });
    db.logEmail({ userId, toEmail: to, template, subject, text, html, status: 'sent' });
    return { ok: true, status: 'sent', id: info.messageId };
  } catch (err) {
    /* Record the transport's error message so the admin log can show exactly
       why delivery failed (bad SMTP_PASS, unverified from-domain, recipient
       rejection, etc.) instead of a bare "failed". */
    const failure = String((err && err.message) || err);
    db.logEmail({ userId, toEmail: to, template, subject, text, html, status: 'failed', failure });
    return { ok: false, status: 'failed', error: failure };
  }
}

/* Convenience helpers used by the server trigger points. */
async function welcome(user) {
  const r = render('welcome', user);
  return sendEmail({ userId: user.id, to: user.email, template: r.template, subject: r.subject, text: r.text, html: r.html });
}
async function verifyCode(user, code) {
  const r = render('verify-code', user, code ? { code } : {});
  return sendEmail({ userId: user.id, to: user.email, template: r.template, subject: r.subject, text: r.text, html: r.html });
}
async function kycVerified(user, level) {
  const r = render('kyc-verified', user, { level });
  return sendEmail({ userId: user.id, to: user.email, template: r.template, subject: r.subject, text: r.text, html: r.html });
}
async function passwordReset(user, code) {
  const r = render('password-reset', user, { code });
  return sendEmail({ userId: user.id, to: user.email, template: r.template, subject: r.subject, text: r.text, html: r.html });
}

module.exports = { emailConfigured, render, sendEmail, welcome, verifyCode, kycVerified, passwordReset };
