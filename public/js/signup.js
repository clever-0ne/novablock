/* ---------- Signup page (signup.html) ---------- */
/* Creates a real account on the backend (welcome email is sent/logged),
   stores the session token, then redirects into the app. */

function signupSubmit(e) {
    e.preventDefault();
    const name = $('suName').value.trim();
    const email = $('suEmail').value.trim();
    const phone = $('suPhone').value.trim();
    const pass = $('suPass').value;
    /* Referral capture: signup.html?ref=CODE — stored server-side so the
       referrer gets their bonus when this user's first deposit is approved. */
    const refCode = new URLSearchParams(location.search).get('ref') || '';

    const err = $('suError');
    const showErr = msg => {
        if (err) { err.textContent = msg; err.classList.remove('hidden'); }
    };

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone || pass.length < 6) {
        showErr('Please fill all fields — password must be 6+ characters.');
        return;
    }
    if (err) err.classList.add('hidden');

    const btn = $('suSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }

    fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password: pass, refCode })
    }).then(r => r.json()).then(d => {
        if (!d.token) { showErr(d.error || 'Could not create account — try again.'); if (btn) { btn.disabled = false; btn.textContent = 'Create account'; } return; }
        /* New accounts must confirm the emailed code before entering the app. */
        if (d.user && d.user.emailVerified === false) {
            pendingVerifyToken = d.token;
            setAccount({ name, email, phone });
            if (btn) btn.classList.add('hidden');
            showVerifyEmail(document.querySelector('#main .glass'), email, () => { window.location.href = 'dashboard.html'; });
            return;
        }
        setToken(d.token);
        setAccount({ name, email, phone });
        if (btn) btn.textContent = 'Account created ✓';
        showToast('Welcome, ' + name.split(' ')[0] + '! Redirecting…');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 900);
    }).catch(() => {
        showErr('Could not create account — check the server is running.');
        if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
    });
}
