const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

// US DST "spring forward": clocks jump from 2am to 3am on 2026-03-08, so
// that local calendar day is only 23 hours long. Two genuinely-consecutive
// local midnights either side of it differ by 82800000ms, not the fixed
// 86400000ms both currentStreak() (js/profile.js) and longestStreak()
// (js/achievements.js) used to assume - breaking the streak count exactly
// at the transition. Three consecutive daily entries spanning it should
// still read as a 3-day streak.
const DST_ENTRIES = [
  { id: 1, user_id: 'test-user', ts: '2026-03-07T14:00:00.000Z', kind: 'stool', type: 4, tags: [], pain: 0, rest_id: null, rest_name: null, note: '' },
  { id: 2, user_id: 'test-user', ts: '2026-03-08T13:00:00.000Z', kind: 'stool', type: 4, tags: [], pain: 0, rest_id: null, rest_name: null, note: '' },
  { id: 3, user_id: 'test-user', ts: '2026-03-09T13:00:00.000Z', kind: 'stool', type: 4, tags: [], pain: 0, rest_id: null, rest_name: null, note: '' },
];
const NOW_MARCH_9_9AM_ET = '2026-03-09T13:00:00.000Z';

test.describe('streak calculation across a DST transition', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('the dashboard hero streak badge counts a streak spanning "spring forward" correctly', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW_MARCH_9_9AM_ET));
    await mockSupabase(page, { entries: DST_ENTRIES });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    await expect(page.locator('#heroStreak')).toHaveClass(/lit/, { timeout: 5000 });
    await expect(page.locator('#heroStreakN')).toHaveText('3');
  });

  test('the 7-day streak achievement badge progress counts a streak spanning "spring forward" correctly', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW_MARCH_9_9AM_ET));
    await mockSupabase(page, { entries: DST_ENTRIES });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="achievements"]');

    const badge = page.locator('.badge-card', { hasText: '7-Day Streak' });
    await expect(badge.locator('.badge-progress')).toHaveText('3/7 days', { timeout: 5000 });
  });
});
