/* ---- App init (runs once everything above is defined) ---- */
function init(){
  renderCheckoutReturnBanner();
  renderPricing();
  renderThemes();
  renderAchievements();
  renderProfile();
  bindProfileEvents();
  renderTrends();
  renderDashboard();  // initial paint; re-rendered once entries/reminders actually load
  loadEntries();      // also triggers renderTrends()/renderHomeStats() again once data arrives
  loadRestrooms();
  loadProfileTier();
  loadReminderSettings();
  handleReminderUrlParams();
  showOnboardingIfNeeded(); // no-op if consent isn't accepted yet, or already onboarded
}
init();
