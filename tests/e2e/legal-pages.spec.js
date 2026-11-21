const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('legal pages follow the app theme', () => {
  test('privacy.html picks up a cached theme before paint, with no app session needed', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('gutlog_theme_cache', 'midnight'); });
    await page.goto('/privacy.html');
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(15, 20, 32)'); // #0F1420 - theme-midnight's --paper
  });

  test('terms.html picks up a cached theme the same way', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('gutlog_theme_cache', 'forest'); });
    await page.goto('/terms.html');
    await expect(page.locator('html')).toHaveClass(/theme-forest/);
  });

  test('a cache of "default" (or none) leaves the page in its plain light look', async ({ page }) => {
    await page.goto('/privacy.html');
    await expect(page.locator('html')).not.toHaveClass(/theme-/);
  });

  test('choosing a theme in the app caches it, so the privacy policy opened right after matches', async ({ page }) => {
    await mockSupabase(page, {
      profiles: [{ id: 'test-user', username: null, tier: 'lifetime', theme: 'default', is_admin: false }],
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="themes"]');
    await page.click('.theme-card[data-theme="ocean"]');
    await expect(page.locator('html')).toHaveClass(/theme-ocean/);

    // Same browser context, so localStorage carries over to this navigation -
    // exactly how a real "View privacy policy" tap from within the app works.
    await page.goto('/privacy.html');
    await expect(page.locator('html')).toHaveClass(/theme-ocean/);
  });
});
