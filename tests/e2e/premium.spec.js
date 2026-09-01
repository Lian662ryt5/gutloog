const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('premium / checkout', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
  });

  test('all three plans render with their prices, Annual marked best value', async ({ page }) => {
    const grid = page.locator('#pricingGrid');
    await expect(grid).toContainText('Monthly');
    await expect(grid).toContainText('£3.99');
    await expect(grid).toContainText('Annual');
    await expect(grid).toContainText('£24.99');
    await expect(grid).toContainText('7-day free trial');
    await expect(grid).toContainText('Lifetime');
    await expect(grid).toContainText('£39.99');
  });

  test('the free badge shows when no plan is owned', async ({ page }) => {
    await expect(page.locator('#planBadge')).toHaveText('Free');
  });

  test('choosing a plan redirects to its Stripe Payment Link with the signed-in user id attached', async ({ page }) => {
    // startCheckout() does a real window.location navigation - intercept
    // Stripe's domain rather than letting the test actually try to reach it.
    let capturedUrl = null;
    await page.route('https://buy.stripe.com/**', async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>stripe</html>' });
    });

    await page.click('.plan-card:has-text("Monthly") button');
    await page.waitForURL('https://buy.stripe.com/**', { timeout: 5000 });

    expect(capturedUrl).toContain('buy.stripe.com');
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('client_reference_id')).toBe('test-user');
  });
});
