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

// Regression test for a second real gap found alongside the one above:
// the old focus-visible rule only covered textarea/.btype/.toggle/.pdot/
// button, so a link, a plain text/date input, a <select>, or a
// keyboard-focusable tabindex="0" element (like .choice-card) got no
// visible focus ring at all when tabbed to - invisible to axe-core's
// static analysis for the same reason as the gate-escape bug.
test.describe('focus-visible coverage', () => {
  // Checks the outline is specifically var(--teal) (rgb(63, 111, 102)), not
  // just non-empty - a browser's own default focus ring is already visible
  // on some elements (plain <input>s in particular) regardless of this
  // app's CSS, so a bare non-zero-width check would pass even without the
  // new rule and prove nothing about it.
  //
  // Reaches the target by real Tab key presses, not locator.focus() - a
  // script-triggered focus() doesn't make Chromium match :focus-visible on
  // a non-form element (a div[tabindex], a link), only a genuine keyboard
  // focus does, so .focus() alone would never show this rule's effect on
  // those elements even when the CSS is correct.
  async function outlineColorViaKeyboard(page, selector, maxTabs = 60) {
    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab');
      const matched = await page.evaluate(
        (sel) => document.activeElement === document.querySelector(sel),
        selector
      );
      if (matched) return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).outlineColor, selector);
    }
    throw new Error(`Tabbed ${maxTabs} times without reaching ${selector}`);
  }
  const TEAL = 'rgb(63, 111, 102)';

  test('a keyboard-focusable tabindex="0" card gets the app\'s focus ring', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.click('#onboardingSkipBtn');
    expect(await outlineColorViaKeyboard(page, '.choice-card')).toBe(TEAL);
  });

  test('a plain text input gets the app\'s focus ring, not just the browser default', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.click('#onboardingSkipBtn');
    await page.click('[data-tab="log"]');
    expect(await outlineColorViaKeyboard(page, '#foodNameInput')).toBe(TEAL);
  });

  test('a legal-footer link gets a visible focus ring', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.click('#onboardingSkipBtn');
    expect(await outlineColorViaKeyboard(page, '.legal-footer a')).toBe(TEAL);
  });
});
