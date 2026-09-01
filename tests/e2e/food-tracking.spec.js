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
