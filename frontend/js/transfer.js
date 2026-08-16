/* ---------- Transfer Funds view ---------- */
/* Balance comes from js/store.js via getBalance(). */

let transferType = 'internal';

function setTransferType(type) {
    transferType = type;
    ['internal', 'external'].forEach(t => {
        const el = $('transferType' + (t === 'internal' ? 'Internal' : 'External'));
        if (!el) return;
        const active = t === type;
        el.className = 'py-2.5 rounded-xl text-xs font-semibold border transition ' + (active
            ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
            : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200');
    });
    updateTransferFee();
}

function updateTransferFee() {
    const amt = parseFloat($('transferAmount').value) || 0;
    const fee = transferType === 'external' ? amt * 0.005 : 0;
    $('transferFee').textContent = '$' + fmt(fee);
    $('transferTotal').textContent = '$' + fmt(amt + fee);
    const note = $('transferKycNote');
    if (note) note.classList.toggle('hidden', transferType === 'internal' || kycDoneCount() === 3);
}

function renderTransferRecent() {
    const ul = $('transferRecent');
    if (!ul) return;
    const tx = TX_DATA.filter(t => t.type === 'transfer').slice(0, 3);
    ul.innerHTML = tx.length ? tx.map(t => `
        <li class="flex items-center gap-3 py-2.5 text-sm">
            <span class="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-300 flex items-center justify-center"><i class="fa-solid fa-paper-plane text-[10px]"></i></span>
            <span class="flex-1 text-slate-300">${t.asset}</span>
            <span class="text-rose-300 font-semibold fig">-$${fmt(Math.abs(t.amount))}</span>
        </li>`).join('') : '<li class="text-xs text-slate-500 py-2.5">No transfers yet.</li>';
}

function renderTransfer() {
    setTransferType(transferType);
    renderTransferRecent();
}

function doTransfer() {
    const to = $('transferTo').value.trim();
    const amt = parseFloat($('transferAmount').value);
    if (!to) { showToast('Enter a recipient username or wallet address'); return; }
    if (!amt || amt <= 0) { showToast('Enter an amount to transfer'); return; }
    if (amt > getBalance()) { showToast('Insufficient balance'); return; }
    if (transferType === 'external' && kycDoneCount() !== 3) { showToast('KYC verification is required for external transfers'); return; }
    const btn = $('transferBtn');
    btn.disabled = true; btn.textContent = 'Sending…'; btn.classList.add('opacity-60');
    const fee = transferType === 'external' ? amt * 0.005 : 0;
    const asset = $('transferAsset').value;
    setTimeout(() => {
        TX_DATA.unshift({ id: txId(), type: 'transfer', asset, amount: -(amt + fee), date: todayStr(), time: nowStr(), status: 'completed' });
        saveApp();
        renderTransactions();
        renderTransfer();
        $('transferTo').value = '';
        $('transferAmount').value = '';
        updateTransferFee();
        btn.disabled = false; btn.textContent = 'Send Transfer'; btn.classList.remove('opacity-60');
        showToast('Transfer sent to ' + to);
    }, 1100);
}
