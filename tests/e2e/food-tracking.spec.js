const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('food tracking', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="log"]');
  });

  test('manual food entry is logged and shown with a Food tag', async ({ page }) => {
    await page.fill('#foodNameInput', 'Spicy Curry');
    await page.click('#foodManualBtn');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Spicy Curry');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Food');
    // Input clears after a successful log.
    await expect(page.locator('#foodNameInput')).toHaveValue('');
  });

  test('an empty manual food name does not log anything', async ({ page }) => {
    await page.click('#foodManualBtn');
    await expect(page.locator('#logList .empty')).toBeVisible();
  });

  test('barcode scanning degrades gracefully when unsupported (no camera in CI)', async ({ page }) => {
    // Headless Chromium in CI has no BarcodeDetector-capable camera; the app
    // already handles this with an explanatory alert rather than crashing -
    // this confirms that path, not real barcode-scanning hardware behavior.
    let alertMessage = null;
    page.once('dialog', async (d) => { alertMessage = d.message(); await d.accept(); });
    await page.click('#scanBarcodeBtn');
    await page.waitForTimeout(300);
    expect(alertMessage).toBeTruthy();
  });

  test('an offline food save with a photo attached queues without a misleading upload-failure alert', async ({ page }) => {
    // Regression: saveFoodEntry() used to attempt the photo upload
    // unconditionally, so going offline with a photo attached triggered
    // both a "Could not upload your photo" alert (implying a real error)
    // and the "Saved offline" toast for the same save - contradictory
    // messaging for what is actually expected offline behavior. The photo
    // upload is now skipped up front while offline.
    const PNG_1PX = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    await page.setInputFiles('#foodPhotoInput', { name: 'meal.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(page.locator('#foodPhotoPreview')).toBeVisible();

    await page.context().setOffline(true);
    let alertFired = false;
    page.once('dialog', async (d) => { alertFired = true; await d.accept(); });
    await page.fill('#foodNameInput', 'Offline Snack');
    await page.click('#foodManualBtn');
    await expect(page.locator('.toast')).toHaveText('Saved offline. Will sync when connection is restored.');
    expect(alertFired).toBe(false);
    await expect(page.locator('#logList .log-entry').first()).toContainText('Offline Snack');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Pending sync');

    await page.context().setOffline(false);
  });

  test('food entries are excluded from the Bristol weekly stats (avg type / flagged)', async ({ page }) => {
    await page.fill('#foodNameInput', 'Toast');
    await page.click('#foodManualBtn');
    const stats = await page.locator('#statsStrip').innerText();
    // A food-only day should show 0 for the symptom-only "Flagged" stat and
    // '—' for avg type, since renderStats() now sources from
    // weeklyStoolEntries (stool-only), not the mixed-kind entries array.
    expect(stats).toContain('—');
  });
});
