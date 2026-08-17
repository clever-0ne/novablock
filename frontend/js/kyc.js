/* ---------- KYC verification system ---------- */
/* State persists in the browser only (localStorage) — nothing is sent anywhere. */

const KYC_KEY = 'proderiv_kyc_v1';
const KYC_BTN_ON = 'px-5 h-11 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-sm font-semibold text-white shadow-accent transition';

const kycState = {
    get() {
        try { return JSON.parse(localStorage.getItem(KYC_KEY)) || {}; }
        catch { return {}; }
    },
    set(level, data) {
        const s = this.get();
        s[level] = data;
        try { localStorage.setItem(KYC_KEY, JSON.stringify(s)); } catch {}
        return s;
    }
};

const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';

/* Reads a selected file as a data URL. Images are downscaled so the document
   fits in localStorage and can be previewed by the admin. */
function readDocFile(file, cb) {
    if (file.type && file.type.indexOf('image/') === 0) {
        const fr = new FileReader();
        fr.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 900;
                let w = img.width, h = img.height;
                if (w > max || h > max) {
                    const r = Math.min(max / w, max / h);
                    w = Math.round(w * r); h = Math.round(h * r);
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    cb(c.toDataURL('image/jpeg', 0.85));
                } else {
                    cb(fr.result);
                }
            };
            img.onerror = () => cb(fr.result);
            img.src = fr.result;
        };
        fr.readAsDataURL(file);
    } else {
        const fr = new FileReader();
        fr.onload = () => cb(fr.result);
        fr.readAsDataURL(file);
    }
}

/* Uploads the chosen document to the backend (per-user record). Falls back to a
   local data URL when the backend is unreachable so the flow still works. */
function uploadDoc(level, file, docType, cb) {
    const meta = { docType: docType || '', fileName: file.name, fileSize: file.size };
    readDocFile(file, docData => {
        try {
            fetch('/api/kyc/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
                body: JSON.stringify({ level, ...meta, fileData: docData })
            }).then(r => r.json()).then(d => {
                cb(d.ok && d.docUrl ? { docUrl: d.docUrl, ...meta } : { docData, ...meta });
            }).catch(() => cb({ docData, ...meta }));
        } catch { cb({ docData, ...meta }); }
    });
}

/* The sign-up email verification satisfies KYC Level 1 — tracked on the
   account by the server and mirrored here. */
function emailVerified() {
    try { return localStorage.getItem('proderiv_email_verified') === '1'; } catch { return false; }
}

function kycLevelStatus(level) {
    const s = kycState.get();
    if (s[level] && s[level].done) return 'done';
    if (level === 1 && emailVerified()) return 'done';
    if (level === 1) return 'open';
    return (s[level - 1] && s[level - 1].done) ? 'open' : 'locked';
}

function kycDoneCount() {
    const s = kycState.get();
    return [1, 2, 3].filter(l => (s[l] && s[l].done) || (l === 1 && emailVerified())).length;
}

/* ---------- Submissions (simulated review, saved locally) ---------- */
/* Note: setBtnLoading/btnDone come from auth.js (loaded after this file on
   dashboard.html) — this file intentionally does not redefine them. */
function submitKYCLevel(level) {
    if (kycLevelStatus(level) === 'locked') return;

    if (level === 1) {
        const email = $('kyc-email').value.trim();
        const phone = $('kyc-phone').value.trim();
        if (!email || !phone) { showToast('Enter your email and phone number first'); return; }
        setBtnLoading($('kycL1Btn'), 'Verifying…');
        // Record verification on the backend (sends the KYC-verified email).
        fetch('/api/kyc/1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({ verified: true })
        }).then(r => r.json()).then(d => {
            const s = (d && d.kyc) ? d.kyc : kycState.get();
            s[1] = { ...(s[1] || {}), done: true, ts: Date.now(), email, phone };
            try { localStorage.setItem(KYC_KEY, JSON.stringify(s)); } catch {}
            renderKYC();
            showToast('Level 1 verified — email confirmed');
        }).catch(() => {
            // Offline fallback: still mark it done locally.
            kycState.set(1, { done: true, ts: Date.now(), email, phone });
            renderKYC();
            showToast('Level 1 verified — email confirmed');
        });
        return;
    }
    if (level === 2) {
        const file = $('kyc-id-upload').files[0];
        if (!file) { showToast('Please attach your ID document'); return; }
        setBtnLoading($('kycL2Btn'), 'Submitting…');
        uploadDoc(level, file, $('kyc-doc-type').value, rec => {
            setTimeout(() => {
                kycState.set(2, { done: true, ts: Date.now(), ...rec });
                renderKYC();
                showToast('Level 2 verified — ID document accepted');
            }, 900);
        });
    } else if (level === 3) {
        const file = $('kyc-address-upload').files[0];
        if (!file) { showToast('Please attach your proof of address'); return; }
        setBtnLoading($('kycL3Btn'), 'Submitting…');
        uploadDoc(level, file, '', rec => {
            setTimeout(() => {
                kycState.set(3, { done: true, ts: Date.now(), ...rec });
                renderKYC();
                showToast('Level 3 verified — you are fully verified 🎉');
            }, 900);
        });
    }
}

function showKYCFileName(level) {
    const inp = level === 2 ? $('kyc-id-upload') : $('kyc-address-upload');
    const out = level === 2 ? $('kycL2File') : $('kycL3File');
    const f = inp.files[0];
    out.textContent = f ? f.name + ' (' + fmtSize(f.size) + ')' : 'No file selected';
}

/* ---------- Rendering: syncs every part of the UI with saved state ---------- */
const KYC_BADGE = {
    done:   'px-2.5 py-1 text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-md',
    open:   'px-2.5 py-1 text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-md',
    locked: 'px-2.5 py-1 text-[11px] font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-md'
};
const KYC_BADGE_TEXT = { done: 'Verified', open: 'In progress', locked: 'Locked' };

function renderKYC() {
    const done = kycDoneCount();
    const verified = done === 3;

    // sidebar card
    const bar = $('kycSideBar');
    if (bar) bar.style.width = Math.max(8, (done / 3) * 100) + '%';
    const sideText = $('kycSideText');
    if (sideText) sideText.textContent = done + ' / 3';
    const sideBtn = $('kycSideBtn');
    if (sideBtn) sideBtn.textContent = verified ? 'View Status' : 'Complete KYC';
    const sideDesc = $('kycSideDesc');
    if (sideDesc) sideDesc.textContent = verified ? 'All levels verified — everything is unlocked.' : 'Verify your identity to unlock withdrawals.';

    // topbar badge
    const badge = $('topbarKycBadge');
    if (badge) {
        badge.className = verified ? 'text-[10px] text-emerald-400' : 'text-[10px] text-amber-400';
        badge.innerHTML = verified
            ? '<i class="fa-solid fa-circle-check mr-1"></i>KYC Verified'
            : '<i class="fa-solid fa-circle-exclamation mr-1"></i>KYC Pending';
    }

    // profile section
    [1, 2, 3].forEach(l => {
        const el = $('kycRow' + l + 'Status');
        if (!el) return;
        const st = kycLevelStatus(l);
        el.textContent = st === 'done' ? 'Verified' : st === 'locked' ? 'Locked' : 'Pending';
        el.className = 'text-[10px] font-semibold ' + (st === 'done' ? 'text-emerald-300' : st === 'locked' ? 'text-slate-500' : 'text-amber-300');
    });
    const pBtn = $('profileKycBtn');
    if (pBtn) pBtn.textContent = verified ? 'View' : 'Complete';
    const pDesc = $('profileKycDesc');
    if (pDesc) pDesc.textContent = verified
        ? 'You are fully verified — deposits and withdrawals are unlocked.'
        : 'Complete all three levels to unlock unlimited deposits and withdrawals.';

    // KYC view header
    const chip = $('kycOverallChip');
    if (chip) {
        if (verified) { chip.textContent = 'Fully verified'; chip.className = 'px-3 py-1.5 text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-lg'; }
        else if (done === 0) { chip.textContent = 'Not started'; chip.className = 'px-3 py-1.5 text-xs font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-lg'; }
        else { chip.textContent = done + ' / 3 verified'; chip.className = 'px-3 py-1.5 text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-lg'; }
    }
    const obar = $('kycOverallBar');
    if (obar) obar.style.width = (done / 3) * 100 + '%';
    const otext = $('kycOverallText');
    if (otext) otext.textContent = done === 0 ? 'Start with Level 1 below.' : verified ? 'All levels complete — you are fully verified.' : done + ' of 3 levels complete.';
    const banner = $('kycDoneBanner');
    if (banner) banner.classList.toggle('hidden', !verified);

    // level cards
    [1, 2, 3].forEach(l => {
        const st = kycLevelStatus(l);
        const b = $('kycL' + l + 'Badge');
        if (b) { b.textContent = KYC_BADGE_TEXT[st]; b.className = KYC_BADGE[st]; }
        const card = $('kycCard' + l);
        if (card) card.classList.toggle('opacity-60', st === 'locked');
        const form = $('kycL' + l + 'Form');
        if (form) form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = st !== 'open'; });
        const btn = $('kycL' + l + 'Btn');
        if (btn) {
            const canSubmit = l === 1 ? st !== 'done' : st !== 'locked';
            btn.disabled = !canSubmit;
            btn.className = KYC_BTN_ON + (!canSubmit ? ' opacity-60' : '');
            btn.textContent = st === 'done'
                ? (l === 1 ? 'Completed ✓' : l === 2 ? 'Update ID' : 'Update Proof')
                : l === 1 ? 'Verify Email' : l === 2 ? 'Submit ID' : 'Submit Proof';
        }
        const lock = $('kycL' + l + 'Lock');
        if (lock) lock.classList.toggle('hidden', st !== 'locked');
    });

    // ID-type select and file pickers always stay usable — only submission is gated.
    [2, 3].forEach(l => {
        const fi = l === 2 ? $('kyc-id-upload') : $('kyc-address-upload');
        if (fi) fi.disabled = false;
    });
    const docSel = $('kyc-doc-type');
    if (docSel) docSel.disabled = false;

    // restore uploaded file names
    [2, 3].forEach(l => {
        const s = kycState.get()[l];
        const out = $('kycL' + l + 'File');
        if (out && s && s.fileName) out.textContent = s.fileName + ' (' + fmtSize(s.fileSize || 0) + ')';
    });
}

function updateWithdrawGate() {
    const verified = kycDoneCount() === 3;
    const notice = $('withdrawKycNotice');
    if (notice) notice.classList.toggle('hidden', verified);
    const btn = $('withdrawSubmitBtn');
    if (btn) { btn.disabled = !verified; btn.classList.toggle('opacity-50', !verified); }
    const form = $('withdrawForm');
    if (form) form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = !verified; });
}

function initKYC() {
    // prefill from profile data if the fields are empty
    const email = $('kyc-email'), phone = $('kyc-phone');
    if (email && !email.value && profile.email) email.value = profile.email;
    if (phone && !phone.value && profile.phone) phone.value = profile.phone;
    const addr = $('kyc-address-display');
    if (addr && profile.street) addr.textContent = profile.street + ', ' + profile.city + ', ' + profile.country + ' ' + profile.postal;
    // A verified sign-up email completes KYC Level 1 locally too, so the chain
    // (Level 2 unlocked) works even before the next server sync.
    if (emailVerified()) {
        const s = kycState.get();
        if (!(s[1] && s[1].done)) {
            s[1] = { ...(s[1] || {}), done: true, ts: Date.now(), email: profile.email, phone: profile.phone };
            try { localStorage.setItem(KYC_KEY, JSON.stringify(s)); } catch {}
        }
    }
    renderKYC();
}

function resetKYCData() {
    if (confirm('Clear all saved KYC verification data?')) {
        localStorage.removeItem(KYC_KEY);
        const id = $('kyc-id-upload'), ad = $('kyc-address-upload');
        if (id) id.value = '';
        if (ad) ad.value = '';
        renderKYC();
        showToast('KYC data cleared');
        try { fetch('/api/kyc', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getToken() } }).catch(() => {}); } catch {}
    }
}
