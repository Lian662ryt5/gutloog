const { test, expect } = require('@playwright/test');
const { mockSupabase } = require('../fixtures/helpers');

// Regression test for a real gap: both full-screen gates (consent,
// onboarding) had no role="dialog"/aria-modal and no focus trap, so a
// keyboard user tabbing through could escape past the last button inside
// the gate into the app content still sitting (invisibly, behind a
// backdrop) in the DOM. axe-core's static analysis can't catch this on its
// own - it can't simulate a Tab key press - which is why the existing
// accessibility suite passed despite the gap.
test.describe('modal focus trap', () => {
  test('the consent gate has dialog semantics and traps Tab focus', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');

    await expect(page.locator('#consentGate')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#consentGate')).toHaveAttribute('aria-modal', 'true');

    // Starting focus should already be inside the gate (the checkbox).
    await expect(page.locator('#consentCheckbox')).toBeFocused();

    // Tab forward past the last element (Continue, disabled until checked -
    // so the last *focusable* one is the checkbox itself right now) wraps
    // back to the first, never reaching anything outside #consentGate.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const insideGate = await page.evaluate(() => !!document.activeElement.closest('#consentGate'));
      expect(insideGate).toBe(true);
    }
  });

  test('the onboarding gate has dialog semantics and traps Tab focus', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.locator('#onboardingGate').waitFor({ state: 'visible', timeout: 3000 });

    await expect(page.locator('#onboardingGate')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#onboardingGate')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#onboardingSkipBtn')).toBeFocused();

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const insideGate = await page.evaluate(() => !!document.activeElement.closest('#onboardingGate'));
      expect(insideGate).toBe(true);
    }

    // Shift+Tab from the first element should wrap to the last, not escape.
    await page.evaluate(() => document.getElementById('onboardingSkipBtn').focus());
    await page.keyboard.press('Shift+Tab');
    const insideGate = await page.evaluate(() => !!document.activeElement.closest('#onboardingGate'));
    expect(insideGate).toBe(true);
  });
});
