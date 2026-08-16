/* ---------- Password reset (reset.html) ---------- */
/* Collects the 6-digit code emailed by /api/auth/forgot plus the new password,
   and posts {email, code, password} to /api/auth/reset. The server burns the
   code and revokes every old session on success. */

(function () {
  'use strict';

  document.getElementById('resetForm').classList.remove('hidden');

  window.resetSubmit = function (e) {
    e.preventDefault();
    var email = document.getElementById('rsEmail').value.trim();
    var code = document.getElementById('rsCode').value.trim();
    var pass = document.getElementById('rsPass').value;
    var pass2 = document.getElementById('rsPass2').value;
    var err = document.getElementById('rsError');
    var btn = document.getElementById('rsSubmit');

    if (!email || email.indexOf('@') === -1) { err.textContent = 'Enter your account email'; err.classList.remove('hidden'); return; }
    if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code from your email'; err.classList.remove('hidden'); return; }
    if (pass.length < 6) { err.textContent = 'Password must be 6+ characters'; err.classList.remove('hidden'); return; }
    if (pass !== pass2) { err.textContent = 'Passwords do not match'; err.classList.remove('hidden'); return; }

    btn.disabled = true;
    btn.textContent = 'Resetting…';
    err.classList.add('hidden');

    fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: code, password: pass })
    }).then(r => r.json()).then(d => {
      if (!d.ok) {
        btn.disabled = false;
        btn.textContent = 'Reset password';
        err.textContent = d.error || 'Could not reset your password — try again.';
        err.classList.remove('hidden');
        return;
      }
      document.getElementById('resetForm').classList.add('hidden');
      document.getElementById('rsDone').classList.remove('hidden');
    }).catch(() => {
      btn.disabled = false;
      btn.textContent = 'Reset password';
      err.textContent = 'Could not reach the server — try again.';
      err.classList.remove('hidden');
    });
  };
})();
