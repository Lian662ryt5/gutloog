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
  loadEntries();      // also loads account stats + trends data, re-rendering everything once each arrives
  loadRestrooms();
  loadProfileTier();
  loadReminderSettings();
  handleReminderUrlParams();
  showOnboardingIfNeeded(); // no-op if consent isn't accepted yet, or already onboarded
}
init();
