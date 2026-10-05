/* ---------- Password reset request (forgot.html) ---------- */
/* Sends the account email to /api/auth/forgot. The server always answers 200
   (whether or not the email exists) so we don't leak which addresses are
   registered — the page always shows the same "check your inbox" message. */

(function () {
  'use strict';

  window.forgotSubmit = function (e) {
    e.preventDefault();
    var email = document.getElementById('fgEmail').value.trim();
    var err = document.getElementById('fgError');
    var btn = document.getElementById('fgSubmit');

    if (!email || email.indexOf('@') === -1) {
      err.textContent = 'Enter a valid email address';
      err.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    err.classList.add('hidden');

    fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(r => r.json()).then(d => {
      /* Success is shown regardless of d.ok — same message either way. */
      document.getElementById('forgotForm').classList.add('hidden');
      document.getElementById('forgotDone').classList.remove('hidden');
    }).catch(() => {
      btn.disabled = false;
      btn.textContent = 'Send reset code';
      err.textContent = 'Could not reach the server — try again.';
      err.classList.remove('hidden');
    });
  };
})();
