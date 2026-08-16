// initial render, then count-up the hero figure
initAuth();
resyncChartSeries();
renderChart('1D');
animateValue($('chartValue'), getBalance(), 1100);
renderProfile();
renderTransactions();
renderDashboardRecent();
initKYC();
renderReferrals();
renderSwap();
renderTrade();
renderTransfer();
renderBalance();
if (typeof renderNotifications === 'function') renderNotifications();
const initialView = location.hash.replace('#', '');
if (isLoggedIn()) showView(['dashboard', 'profile', 'transactions', 'kyc', 'swap', 'trade', 'referrals', 'transfer'].includes(initialView) ? initialView : 'dashboard');

// Live two-tab sync: admin approvals/declines on admin.html land here instantly.
window.addEventListener('storage', e => {
    if (e.key !== 'proderiv_app_v2' && e.key !== 'proderiv_kyc_v1') return;
    if (typeof refreshApp === 'function') refreshApp();
});

// Pull durable state from the backend into localStorage on boot.
if (typeof syncFromServer === 'function') syncFromServer();

// When the tab regains focus (e.g. after approving on the admin panel),
// re-pull the latest server state so changes show up live.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && typeof syncFromServer === 'function') syncFromServer();
});
