const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { mockSupabase, passConsentAndOnboarding, isoAt } = require('../fixtures/helpers');

// Populated seed data so each tab renders its real content (cards, lists,
// charts, badges) rather than empty states - an empty page trivially has
// fewer nodes for axe to check, which would understate real-world issues.
function seedTables() {
  const entries = [];
  let id = 1;
  for (let i = 0; i < 10; i++) {
    const flagged = i % 3 === 0;
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(i, 9), kind: 'stool',
      type: 3 + (i % 3), tags: flagged ? ['urgent', 'blood'] : [], pain: flagged ? 2 : 0,
      rest_id: null, rest_name: null, note: 'after coffee',
    });
  }
  entries.push({
    id: id++, user_id: 'test-user', ts: isoAt(1, 19), kind: 'food',
    food_name: 'Spicy Curry', food_brand: 'Homemade', food_barcode: '1',
  });
  const restrooms = [
    { id: 1, user_id: 'test-user', name: 'Downtown Coffee Shop', loc: 'Main Street', lat: null, lng: null, photo: null, clean: 4, flags: ['private', 'accessible'], note: 'Code needed: 1234', report_count: 0, hidden: false },
    { id: 2, user_id: 'other-user', name: 'Station Cafe', loc: 'High Street', lat: null, lng: null, photo: null, clean: 3, flags: [], note: '', report_count: 0, hidden: false },
  ];
  const reminder_settings = [{
    user_id: 'test-user', timezone: 'UTC',
    toilet_enabled: true, toilet_times: ['09:00'], toilet_message: '',
    medication_enabled: true, medication_times: ['08:00', '20:00'], medication_message: '',
  }];
  return { entries, restrooms, reminder_settings };
}

// Same rule set most real-world compliance work targets: WCAG 2.0/2.1 A+AA.
// best-practice is left out deliberately - those are axe's opinionated
// extras, not compliance requirements, and would make this suite flag
// stylistic preferences as failures.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function runAxe(page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

function formatViolations(results) {
  return results.violations.map((v) =>
    `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`
  ).join('\n\n');
}

test.describe('accessibility audit (axe-core, WCAG 2.1 A/AA) - main tabs', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, seedTables());
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
  });

  const tabs = ['home', 'log', 'restrooms', 'trends', 'themes', 'achievements', 'profile'];

  for (const tab of tabs) {
    test(`the ${tab} tab has no WCAG 2.1 A/AA violations`, async ({ page }) => {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(300); // let async tab-specific renders (trends chart, admin queue, etc.) settle
      const results = await runAxe(page);
      expect(results.violations, formatViolations(results)).toEqual([]);
    });
  }
});

test.describe('accessibility audit (axe-core, WCAG 2.1 A/AA) - admin queue', () => {
  test('the admin review queue has no WCAG 2.1 A/AA violations', async ({ page }) => {
    const seeded = seedTables();
    seeded.profiles = [{ id: 'test-user', is_admin: true }];
    seeded.restrooms.push({
      id: 3, user_id: 'other-user', name: 'Flagged Spot', loc: 'Somewhere', lat: null, lng: null, photo: null,
      clean: 2, flags: [], note: '', report_count: 3, hidden: true,
    });
    seeded.restroom_reports = [
      { id: 1, restroom_id: 3, user_id: 'reporter-a', reason: 'spam', created_at: new Date().toISOString() },
      { id: 2, restroom_id: 3, user_id: 'reporter-b', reason: 'closed', created_at: new Date().toISOString() },
      { id: 3, restroom_id: 3, user_id: 'reporter-c', reason: 'inappropriate', created_at: new Date().toISOString() },
    ];
    await mockSupabase(page, seeded);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.locator('#tab-admin').waitFor({ state: 'visible', timeout: 5000 });
    await page.click('[data-tab="admin"]');
    await page.waitForTimeout(300);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});

test.describe('accessibility audit (axe-core, WCAG 2.1 A/AA) - pre-consent flows', () => {
  test('the consent gate has no WCAG 2.1 A/AA violations', async ({ page }) => {
    // Fresh page, consent not yet accepted, so the gate is still showing.
    await mockSupabase(page, seedTables());
    await page.goto('/index.html');
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  test('the onboarding flow has no WCAG 2.1 A/AA violations', async ({ page }) => {
    await mockSupabase(page, seedTables());
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.locator('#onboardingSkipBtn').waitFor({ state: 'visible', timeout: 3000 });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});
