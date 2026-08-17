/* ---------- Referrals view ---------- */
/* NOTE: `REF_DATA` / `REF_STATS` are provided by js/store.js (shared persisted data layer). */

const REF_TIERS = [
    { name: 'Silver',   rate: '1.0%',  from: 0,      to: 25000 },
    { name: 'Gold',     rate: '1.25%', from: 25000,  to: 100000 },
    { name: 'Platinum', rate: '1.5%',  from: 100000, to: Infinity }
];

function refStatusBadge(status) {
    return status === 'active'
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded-md"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Active</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-slate-600/30 text-slate-400 border border-white/5 rounded-md">Inactive</span>';
}

function tierBadge(tier) {
    const cls = tier === 'Platinum' ? 'text-indigo-300 bg-indigo-500/15 border-indigo-500/20'
        : tier === 'Gold' ? 'text-amber-300 bg-amber-500/15 border-amber-500/20'
        : 'text-slate-300 bg-white/5 border-white/10';
    return '<span class="px-2 py-0.5 text-[10px] font-semibold border rounded-md ' + cls + '">' + tier + '</span>';
}

function renderReferrals() {
    const link = $('refLink');
    /* Live referral link — built from the current origin so it works in prod
       (novablock.onrender.com) and in local dev without hardcoding a domain. */
    if (link) link.value = location.origin + '/signup.html?ref=' + encodeURIComponent(profile.referral);

    const active = REF_DATA.filter(r => r.status === 'active').length;
    const earned = REF_DATA.reduce((a, r) => a + r.earned, 0);
    const volume = REF_DATA.reduce((a, r) => a + r.volume, 0);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('refStatsTotal', REF_DATA.length);
    set('refStatsActive', active);
    set('refStatsEarned', '$' + fmt(earned));
    set('refStatsPending', '$' + fmt(REF_STATS.pending));
    set('refTableCount', REF_DATA.length + ' members');

    // tier progress
    const tier = REF_TIERS.filter(t => volume >= t.from && volume < t.to)[0] || REF_TIERS[2];
    const tierName = $('refTierName');
    if (tierName) {
        tierName.textContent = tier.name + ' (' + tier.rate + ')';
        const next = REF_TIERS[REF_TIERS.indexOf(tier) + 1];
        const nextEl = $('refTierNext');
        if (nextEl) nextEl.textContent = next
            ? 'Trade $' + fmt(next.from - volume) + ' more to reach ' + next.name
            : "You've reached the top tier — keep it up!";
        const bar = $('refTierBar');
        if (bar) {
            const pct = next ? Math.min(100, (volume - tier.from) / (next.from - tier.from) * 100) : 100;
            bar.style.width = pct + '%';
        }
    }

    const body = $('refBody');
    if (body) {
        body.innerHTML = REF_DATA.length
            ? REF_DATA.map(r => `
                <tr class="hover:bg-white/[0.03] transition">
                    <td class="px-5 py-4">
                        <span class="inline-flex items-center gap-2.5">
                            <span class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-[10px] font-bold">${initials(r.name)}</span>
                            <span class="text-slate-200 font-semibold">${r.name}</span>
                        </span>
                    </td>
                    <td class="px-5 py-4 text-slate-400 hidden md:table-cell">${r.joined}</td>
                    <td class="px-5 py-4">${tierBadge(r.tier)}</td>
                    <td class="px-5 py-4 text-right text-white font-semibold fig">$${fmt(r.volume)}</td>
                    <td class="px-5 py-4 text-right text-emerald-300 font-semibold fig">$${fmt(r.earned)}</td>
                    <td class="px-5 py-4 text-right">${refStatusBadge(r.status)}</td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-500 text-sm">No referred users yet — share your link to earn.</td></tr>';
    }
}

function copyRefLink() {
    copyText($('refLink').value);
    showToast('Referral link copied to clipboard');
}

function shareRef(platform) {
    copyText($('refLink').value);
    showToast('Link copied — paste it on ' + platform);
}
