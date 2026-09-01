const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('symptom logging', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="log"]');
  });

  test('save button stays disabled until a Bristol type is selected', async ({ page }) => {
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await page.click('.btype[data-n="4"]');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(page.locator('#saveBtn')).toHaveText('Log Type 4 entry');
  });

  test('logging an entry inserts it and shows it in the History list', async ({ page }) => {
    await page.click('.btype[data-n="4"]');
    await page.click('[data-tag="blood"]');
    await page.fill('#noteInput', 'test note');
    await page.click('#saveBtn');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Type 4');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Blood');
    await expect(page.locator('#logList .log-entry').first()).toContainText('test note');

    // Selections reset after a successful save.
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('.btype.selected')).toHaveCount(0);
  });

  test('deleting an entry requires confirmation, and cancelling keeps it', async ({ page }) => {
    await page.click('.btype[data-n="3"]');
    await page.click('#saveBtn');
    await expect(page.locator('#logList .log-entry')).toHaveCount(1);

    page.once('dialog', (d) => d.dismiss());
    await page.click('.del-btn');
    await page.waitForTimeout(200);
    await expect(page.locator('#logList .log-entry')).toHaveCount(1);
  });

  test('confirming delete removes the entry', async ({ page }) => {
    await page.click('.btype[data-n="3"]');
    await page.click('#saveBtn');
    await expect(page.locator('#logList .log-entry')).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    await page.click('.del-btn');
    await expect(page.locator('#logList .empty')).toBeVisible();
  });

  test('the weekly stats strip reflects saved entries', async ({ page }) => {
    await page.click('.btype[data-n="5"]');
    await page.click('#saveBtn');
    await expect(page.locator('#statsStrip')).toContainText('1');
    await expect(page.locator('#statsStrip')).toContainText('Past 7 days');
  });
});
