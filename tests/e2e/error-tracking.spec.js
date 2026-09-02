const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('client-side error tracking', () => {
  test('an uncaught error is logged to client_errors', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    // Playwright's own pageerror listener would otherwise fail the test
    // run on an uncaught exception - swallow this specific expected one.
    page.on('pageerror', () => {});
    await page.evaluate(() => {
      setTimeout(() => { throw new Error('synthetic test error'); }, 0);
    });
    await page.waitForTimeout(300);

    const errors = await page.evaluate(() => window.__fakeTables.client_errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('synthetic test error');
    expect(errors[0].user_id).toBe('test-user');
  });

  test('an unhandled promise rejection is logged to client_errors', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    await page.evaluate(() => {
      Promise.reject(new Error('synthetic rejection'));
    });
    await page.waitForTimeout(300);

    const errors = await page.evaluate(() => window.__fakeTables.client_errors);
    expect(errors.some((e) => e.message.includes('synthetic rejection'))).toBe(true);
  });

  test('logging stops after the per-page cap so a runaway loop cannot spam the table', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) logClientError(`error ${i}`, null);
    });
    await page.waitForTimeout(300);

    const errors = await page.evaluate(() => window.__fakeTables.client_errors);
    expect(errors.length).toBe(5);
  });
});
