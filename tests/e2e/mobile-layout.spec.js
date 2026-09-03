const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

// A narrow, small-Android-class viewport (the default Playwright chromium
// project runs desktop-sized unless overridden per-test) - this is where a
// flex row without a shrink safety net actually shows horizontal overflow,
// not on a desktop-width run of the same suite.
const NARROW_VIEWPORT = { width: 360, height: 740 };

async function horizontalOverflowPx(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe('mobile layout', () => {
  test('the bottom tab bar does not overflow the viewport on a common small-Android width', async ({ page }) => {
    // Regression: .tabbtn was flex:1 with no min-width override, so a flex
    // item's default min-width:auto (its label's own min-content width)
    // refused to shrink below "Restrooms"/"Achievements"-length labels -
    // with 7 visible tabs on a 360px-wide device, that pushed the whole
    // tab bar (and the page) wider than the viewport on every load,
    // independent of anything the user typed.
    await page.setViewportSize(NARROW_VIEWPORT);
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1); // 1px tolerance for subpixel rounding
  });

  test('a long, unbroken username does not cause horizontal page overflow', async ({ page }) => {
    // profiles.username is capped at 40 chars server-side (DB check
    // constraint) and client-side (maxlength=40), but nothing stops a
    // single unbroken run of characters up to that length - and
    // .profile-username was a flex item with no min-width/overflow-wrap
    // override, so its own min-content width (the whole 40-char run,
    // unbreakable by default) pushed the row - and the page - wider than
    // the viewport instead of wrapping.
    await page.setViewportSize(NARROW_VIEWPORT);
    await mockSupabase(page, {
      profiles: [{ id: 'test-user', username: 'a'.repeat(40), tier: 'free', theme: 'default', is_admin: false }],
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');
    await expect(page.locator('#profileUsernameDisplay')).toHaveText('a'.repeat(40));
    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1);
  });
});
