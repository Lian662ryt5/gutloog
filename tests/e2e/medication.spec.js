const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('medication logging', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="log"]');
  });

  test('logging medication with a note records a Medication entry and clears the input', async ({ page }) => {
    await page.fill('#medicationNoteInput', 'Mesalazine 800mg');
    await page.click('#medicationLogBtn');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Medication');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Mesalazine 800mg');
    await expect(page.locator('#medicationNoteInput')).toHaveValue('');
  });

  test('logging medication with no note still records a bare timestamped entry', async ({ page }) => {
    await page.click('#medicationLogBtn');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Medication');
  });

  test('an offline medication log queues instead of being lost', async ({ page }) => {
    await page.context().setOffline(true);
    await page.fill('#medicationNoteInput', 'Offline dose');
    await page.click('#medicationLogBtn');
    await expect(page.locator('#logList .log-entry').first()).toContainText('Pending sync');
    await expect(page.locator('body')).toContainText('Saved offline', { timeout: 3000 });
    await page.context().setOffline(false);
  });
});
