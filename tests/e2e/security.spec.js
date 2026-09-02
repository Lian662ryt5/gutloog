const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding, isoAt } = require('../fixtures/helpers');

/* ---- Attribute-context XSS via unescaped image URLs ----
   food_image, restrooms.photo, and profiles.avatar_url are all rendered as
   <img src="${value}"> without escaping in several places. food_image in
   particular comes straight from a third-party API (OpenFoodFacts) that
   anyone can edit - a value containing a `"` breaks out of the src
   attribute and lets an attacker plant arbitrary attributes (or, with
   onerror=, arbitrary JS) that runs in the browser of any user who scans
   that barcode, views that restroom, or views their own profile. A value
   ending the attribute and adding a new one (data-xss="pwned") is a safe,
   deterministic way to prove escaping happened: unescaped HTML makes it a
   real second attribute; escaped HTML keeps it as inert text inside the
   single src value. */
const XSS_PAYLOAD = 'https://example.test/x.jpg" data-xss="pwned';

test.describe('attribute-context XSS via image URLs', () => {
  test('a malicious food_image (e.g. from a poisoned OpenFoodFacts entry) cannot inject attributes in the Log list', async ({ page }) => {
    const entries = [{
      id: 1, user_id: 'test-user', ts: isoAt(0, 9), kind: 'food',
      food_name: 'Poisoned Product', food_brand: '', food_barcode: '111', food_image: XSS_PAYLOAD,
    }];
    await mockSupabase(page, { entries });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="log"]');

    const img = page.locator('#logList .log-entry img').first();
    await expect(img).toBeVisible({ timeout: 5000 });
    expect(await img.getAttribute('data-xss')).toBeNull();
  });

  test('a malicious food_image cannot inject attributes in the Home dashboard recent activity card', async ({ page }) => {
    const entries = [{
      id: 1, user_id: 'test-user', ts: isoAt(0, 9), kind: 'food',
      food_name: 'Poisoned Product', food_brand: '', food_barcode: '111', food_image: XSS_PAYLOAD,
    }];
    await mockSupabase(page, { entries });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    const img = page.locator('#recentActivityList img').first();
    await expect(img).toBeVisible({ timeout: 5000 });
    expect(await img.getAttribute('data-xss')).toBeNull();
  });

  test('a malicious restroom photo URL cannot inject attributes (RLS only checks ownership, not the photo field\'s shape)', async ({ page }) => {
    const restrooms = [{
      id: 1, user_id: 'test-user', name: 'Test Spot', loc: '', lat: null, lng: null,
      photo: XSS_PAYLOAD, clean: 3, flags: [], note: '', report_count: 0, hidden: false,
    }];
    await mockSupabase(page, { restrooms });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    const img = page.locator('#restList .rphoto').first();
    await expect(img).toBeVisible({ timeout: 5000 });
    expect(await img.getAttribute('data-xss')).toBeNull();
  });

  test('a malicious profile avatar_url cannot inject attributes', async ({ page }) => {
    const profiles = [{ id: 'test-user', avatar_url: XSS_PAYLOAD }];
    await mockSupabase(page, { profiles });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');

    const img = page.locator('#profileAvatar img').first();
    await expect(img).toBeVisible({ timeout: 5000 });
    expect(await img.getAttribute('data-xss')).toBeNull();
  });
});
