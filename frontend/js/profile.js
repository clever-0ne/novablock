/* ---------- Profile data & view switching ---------- */
        /* NOTE: `profile` is provided by js/store.js (shared persisted data layer). */

        function initials(name) {
            return name.trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
        }

        function renderProfile() {
            const p = profile;
            $('profileName').textContent = p.fullName;
            $('profileUsername').textContent = '@' + p.username;
            $('profileAvatar').textContent = initials(p.fullName);
            $('pFullName').textContent = p.fullName;
            $('pUsername').textContent = '@' + p.username;
            $('pEmail').textContent = p.email;
            $('pPhone').textContent = p.phone;
            $('pDob').textContent = p.dob;
            $('pJoined').textContent = p.joined;
            $('pStreet').textContent = p.street;
            $('pCity').textContent = p.city;
            $('pState').textContent = p.state;
            $('pPostal').textContent = p.postal;
            $('pCountry').textContent = p.country;
            $('profileAccountId').textContent = p.accountId;
            $('profileReferral').textContent = p.referral;
            $('welcomeName').textContent = p.fullName.split(' ')[0];
            document.querySelectorAll('[data-avatar]').forEach(el => el.textContent = initials(p.fullName));
            document.querySelectorAll('[data-username]').forEach(el => el.textContent = p.fullName);
        }

        const NAV_ACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white font-medium border border-indigo-500/25 shadow-[0_8px_24px_-12px_rgba(99,102,241,0.5)]';
        const NAV_INACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-white/5 hover:text-slate-100 transition';

        const VIEWS = ['dashboard', 'profile', 'transactions', 'kyc', 'swap', 'trade', 'referrals', 'transfer'];
        const VIEW_CRUMB = { dashboard: 'Dashboard', profile: 'Profile', transactions: 'Transactions', kyc: 'Verification', swap: 'Swap Crypto', trade: 'Trade', referrals: 'Referrals', transfer: 'Transfer Funds' };
        const VIEW_TITLE = {
            dashboard: 'NovaBlock.io — Investment Platform',
            profile: 'Profile — NovaBlock.io',
            transactions: 'Transactions — NovaBlock.io',
            kyc: 'KYC Verification — NovaBlock.io',
            swap: 'Swap Crypto — NovaBlock.io',
            trade: 'Trade — NovaBlock.io',
            referrals: 'Referrals — NovaBlock.io',
            transfer: 'Transfer Funds — NovaBlock.io'
        };

        function showView(name) {
            VIEWS.forEach(v => {
                const el = $('view-' + v);
                if (el) el.classList.toggle('hidden', v !== name);
            });
            document.querySelectorAll('[data-nav]').forEach(a => {
                a.className = a.dataset.nav === name ? NAV_ACTIVE : NAV_INACTIVE;
            });
            $('crumb').textContent = VIEW_CRUMB[name] || 'Dashboard';
            document.title = VIEW_TITLE[name] || 'NovaBlock.io — Investment Platform';
            if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
            window.scrollTo({ top: 0 });
        }

        function openEditProfile() {
            ['fullName', 'username', 'email', 'phone', 'dob', 'street', 'city', 'state', 'postal', 'country']
                .forEach(i => { $('edit-' + i).value = profile[i]; });
            toggleModal('editProfileModal');
        }

        function saveProfile() {
            const read = id => document.getElementById('edit-' + id).value.trim();
            profile.fullName = read('fullName'); profile.username = read('username');
            profile.email = read('email'); profile.phone = read('phone'); profile.dob = read('dob');
            profile.street = read('street'); profile.city = read('city'); profile.state = read('state');
            profile.postal = read('postal'); profile.country = read('country');
            saveApp();
            renderProfile();
            toggleModal('editProfileModal');
            showToast('Profile updated successfully');
        }

        function showToast(msg) {
            const t = $('toast');
            $('toastText').textContent = msg;
            t.classList.remove('opacity-0', 'pointer-events-none');
            clearTimeout(showToast._t);
            showToast._t = setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none'), 2400);
        }
