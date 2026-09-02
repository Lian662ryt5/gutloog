const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding, isoAt } = require('../fixtures/helpers');

test.describe('home dashboard', () => {
  test('recent activity shows the latest entries and "View all" opens the Log tab', async ({ page }) => {
    const entries = [
      { id: 1, user_id: 'test-user', ts: isoAt(0, 9), kind: 'stool', type: 4, tags: ['urgent'], pain: 2, rest_id: null, rest_name: null, note: '' },
      { id: 2, user_id: 'test-user', ts: isoAt(1, 13), kind: 'food', food_name: 'Grilled chicken salad', food_brand: '', food_barcode: '' },
    ];
    await mockSupabase(page, { entries });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    const rows = page.locator('#recentActivityList .recent-activity-row');
    await expect(rows).toHaveCount(2, { timeout: 5000 });
    await expect(rows.first()).toContainText('Type 4');
    await expect(rows.first()).toContainText('⚠️');
    await expect(rows.nth(1)).toContainText('Grilled chicken salad');

    await page.click('#viewAllActivityBtn');
    await expect(page.locator('.tabbtn.active')).toHaveText('Log');
  });

  test('recent activity shows an honest empty state for a brand-new user', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#recentActivityList')).toContainText('Nothing logged yet', { timeout: 5000 });
  });

  test('the hero streak badge lights up only once there is an active streak', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#heroStreak')).not.toHaveClass(/lit/, { timeout: 5000 });
    await expect(page.locator('#heroStreakN')).toHaveText('0');
  });

  test('the hero streak badge reflects an active streak and the greeting shows the date', async ({ page }) => {
    const entries = [0, 1, 2].map((d, i) => ({
      id: i + 1, user_id: 'test-user', ts: isoAt(d, 9), kind: 'stool',
      type: 4, tags: [], pain: 0, rest_id: null, rest_name: null, note: '',
    }));
    await mockSupabase(page, { entries });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#heroStreak')).toHaveClass(/lit/, { timeout: 5000 });
    await expect(page.locator('#heroStreakN')).toHaveText('3');
    await expect(page.locator('#dashDateline')).not.toHaveText('');
  });

  test('Home is the tab shown on load, not a logging screen', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#tab-home')).toHaveClass(/active/);
    await expect(page.locator('#page-home')).toHaveClass(/active/);
  });
});
