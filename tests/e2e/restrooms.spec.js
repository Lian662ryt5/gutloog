const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

function buildSeedRestrooms(count) {
  const restrooms = [];
  const cleanVals = [5, 4, 3, 2, 1];
  for (let i = 0; i < count; i++) {
    restrooms.push({
      id: i + 1, user_id: i < 2 ? 'test-user' : 'other-user',
      name: i === 0 ? 'Downtown Coffee Shop' : `Spot ${i}`,
      loc: `Area ${i % 3}`, lat: null, lng: null, photo: null,
      clean: cleanVals[i % cleanVals.length], flags: [], note: '', report_count: 0,
    });
  }
  return restrooms;
}

test.describe('restroom saving', () => {
  test('saving a spot requires a name', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    let alertMessage = null;
    page.once('dialog', async (d) => { alertMessage = d.message(); await d.accept(); });
    await page.click('#saveRestBtn');
    await page.waitForTimeout(200);
    expect(alertMessage).toContain('name');
  });

  test('saving a spot with a cleanliness rating adds it to the list', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await page.fill('#restName', 'Test Cafe');
    await page.fill('#restLoc', 'Main Street');
    await page.locator('.cdot[data-v="4"]').click();
    await page.click('#saveRestBtn');

    await expect(page.locator('#restList .rest-card').first()).toContainText('Test Cafe');
    await expect(page.locator('#restList .rest-card').first()).toContainText('★★★★☆');
  });

  test('deleting a spot requires confirmation naming that it affects everyone', async ({ page }) => {
    await mockSupabase(page, { restrooms: buildSeedRestrooms(1) });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');
    await expect(page.locator('#restList .rest-card')).toHaveCount(1);

    let dialogMessage = null;
    page.once('dialog', async (d) => { dialogMessage = d.message(); await d.dismiss(); });
    await page.click('.del-btn');
    await page.waitForTimeout(200);
    expect(dialogMessage).toContain('everyone');
    await expect(page.locator('#restList .rest-card')).toHaveCount(1); // dismissed, so still there
  });

  test('the list paginates: first page is capped, Load more fetches the rest', async ({ page }) => {
    await mockSupabase(page, { restrooms: buildSeedRestrooms(25) });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await expect(page.locator('#restList .rest-card')).toHaveCount(20);
    await expect(page.locator('#loadMoreRestroomsBtn')).toBeVisible();
    await page.click('#loadMoreRestroomsBtn');
    await expect(page.locator('#restList .rest-card')).toHaveCount(25);
    await expect(page.locator('#loadMoreRestroomsBtn')).toHaveCount(0);
  });

  test('area filter narrows results server-side (debounced)', async ({ page }) => {
    await mockSupabase(page, { restrooms: buildSeedRestrooms(10) });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');
    await expect(page.locator('#restList .rest-card')).toHaveCount(10);

    await page.fill('#filterArea', 'Coffee');
    await page.waitForTimeout(700); // debounce
    await expect(page.locator('#restList .rest-card')).toHaveCount(1);
    await expect(page.locator('#restList .rest-card')).toContainText('Downtown Coffee Shop');
  });

  test('star rating filter narrows to matching or higher ratings', async ({ page }) => {
    await mockSupabase(page, { restrooms: buildSeedRestrooms(10) });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await page.selectOption('#filterStars', '5');
    await page.waitForTimeout(300);
    const count = await page.locator('#restList .rest-card').count();
    expect(count).toBeGreaterThan(0);
    const stars = await page.locator('#restList .rstars').allInnerTexts();
    stars.forEach((s) => expect(s).toBe('★★★★★'));
  });
});
