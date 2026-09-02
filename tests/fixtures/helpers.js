const path = require('path');

const FAKE_SUPABASE_PATH = path.join(__dirname, 'fake-supabase.js');
const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const FAKE_JSPDF_PATH = path.join(__dirname, 'fake-jspdf.js');
const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';

const DEFAULT_TABLES = () => ({
  entries: [],
  restrooms: [],
  restroom_reports: [],
  reminder_settings: [],
  push_subscriptions: [],
  reminder_log: [],
  profiles: [],
  client_errors: [],
});

/**
 * Intercepts the real Supabase CDN script and replaces it with the fake
 * client (tests/fixtures/fake-supabase.js), seeded with the given tables.
 * Must be called before page.goto(). Tests the real, unmodified index.html -
 * no copying/editing files.
 */
async function mockSupabase(page, seedTables = {}) {
  await page.route(SUPABASE_CDN_URL, (route) =>
    route.fulfill({ path: FAKE_SUPABASE_PATH, contentType: 'application/javascript' })
  );
  const tables = { ...DEFAULT_TABLES(), ...seedTables };
  await page.addInitScript((t) => { window.__seedTables = t; }, tables);
}

/**
 * Accepts the legal consent gate and dismisses onboarding, if shown. Both
 * gates remember their state in localStorage, so on a page.reload() within
 * the same test neither reappears - skip the (now-hidden, unclickable)
 * consent checkbox in that case rather than hanging on it.
 */
async function passConsentAndOnboarding(page) {
  const consentVisible = await page.locator('#consentGate').isVisible().catch(() => false);
  if (consentVisible) {
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
  }
  const skipBtn = page.locator('#onboardingSkipBtn');
  await skipBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
  }
}

/**
 * Intercepts the real jsPDF CDN script (loaded lazily by js/report.js only
 * when a doctor report is actually generated) and replaces it with a
 * lightweight call-recording stand-in (tests/fixtures/fake-jspdf.js), same
 * pattern as mockSupabase. Call before the report-generation button is
 * clicked - no need to call it for tests that never touch that feature.
 */
async function mockJsPDF(page) {
  await page.route(JSPDF_CDN_URL, (route) =>
    route.fulfill({ path: FAKE_JSPDF_PATH, contentType: 'application/javascript' })
  );
}

function isoAt(daysAgo, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

module.exports = { mockSupabase, mockJsPDF, passConsentAndOnboarding, isoAt, SUPABASE_CDN_URL, JSPDF_CDN_URL, DEFAULT_TABLES };
