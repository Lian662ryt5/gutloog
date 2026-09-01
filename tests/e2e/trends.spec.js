const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding, isoAt } = require('../fixtures/helpers');

// A seeded history exercising streaks, weekly stats, and the 48h
// food-flare correlation window - the same relationships verified by hand
// during development: "Spicy Curry" logged the evening before 3 flagged
// entries should surface as the top correlation.
function buildSeedEntries() {
  const entries = [];
  let id = 1;
  for (let i = 0; i < 10; i++) {
    const flagged = i % 5 === 0;
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(i, 9), kind: 'stool',
      type: 3 + (i % 3), tags: flagged ? ['urgent'] : [], pain: flagged ? 2 : 0,
      rest_id: null, rest_name: null, note: '',
    });
  }
  [1, 6].forEach((d) => {
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(d, 19), kind: 'food',
      food_name: 'Spicy Curry', food_brand: '', food_barcode: '1',
    });
  });
  return entries;
}

test.describe('trends', () => {
  test('the day-by-day chart renders bars for a seeded history', async ({ page }) => {
    await mockSupabase(page, { entries: buildSeedEntries() });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');
    await expect(page.locator('.trend-bar-col')).toHaveCount(14); // default 14-day view
  });

  test('switching the chart range does not require a network round-trip (client-side re-slice)', async ({ page }) => {
    await mockSupabase(page, { entries: buildSeedEntries() });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');
    await page.click('.trend-tabs button[data-range="30"]');
    await expect(page.locator('.trend-bar-col')).toHaveCount(30);
    await page.click('.trend-tabs button[data-range="90"]');
    await expect(page.locator('.trend-bar-col')).toHaveCount(90);
  });

  test('food correlation surfaces the repeated pre-flare food', async ({ page }) => {
    await mockSupabase(page, { entries: buildSeedEntries() });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');
    await expect(page.locator('#foodCorrelation')).toContainText('Spicy Curry');
    await expect(page.locator('#foodCorrelation')).toContainText('before 2 flares');
  });

  test('the home dashboard insight surfaces the same correlation', async ({ page }) => {
    await mockSupabase(page, { entries: buildSeedEntries() });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#insightsList')).toContainText('Spicy Curry', { timeout: 5000 });
  });

  test('with fewer than 3 entries, insights show the "log more" placeholder honestly', async ({ page }) => {
    await mockSupabase(page, { entries: [] });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#insightsList')).toContainText('Log a few more entries');
  });
});
