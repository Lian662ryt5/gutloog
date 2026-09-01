/* ---- App init (runs once everything above is defined) ---- */
function init(){
  renderCheckoutReturnBanner();
  renderPricing();
  renderThemes();
  renderAchievements();
  renderProfile();
  bindProfileEvents();
  renderTrends();
  loadEntries();      // also triggers renderTrends()/renderHomeStats() again once data arrives
  loadRestrooms();
  loadProfileTier();
}
init();
