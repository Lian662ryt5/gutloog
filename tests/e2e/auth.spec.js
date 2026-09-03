const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('authentication & first-run flow', () => {
  test('anonymous sign-in happens automatically on load', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    // ensureAuth() calls getSession/signInAnonymously via core.js on load;
    // once a session exists, getUser() (used throughout the app) should
    // resolve to the fake session's user id without any explicit login step.
    const userId = await page.evaluate(async () => {
      const { data: { user } } = await sb.auth.getUser();
      return user && user.id;
    });
    expect(userId).toBe('test-user');
  });

  test('a brand-new visitor with no session yet gets exactly one anonymous account, not one per loader', async ({ page }) => {
    // init() (main.js) fires loadEntries/loadRestrooms/loadProfileTier/
    // loadReminderSettings without awaiting each other, and each calls
    // ensureAuth() independently. Regression for a real race: on a
    // brand-new visitor (no session yet), all four would otherwise see
    // getSession() resolve empty before any signInAnonymously() call
    // finished, and each would sign in on its own - creating multiple
    // distinct anonymous accounts and splitting that first load's data
    // across them. ensureAuth() now memoizes the in-flight promise so
    // concurrent callers share one auth resolution.
    await mockSupabase(page);
    await page.addInitScript(() => { window.__startWithNoSession = true; });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.waitForFunction(() => window.__signInAnonymouslyCalls > 0);
    // Give any still-settling loaders a moment to finish so a second,
    // late signInAnonymously call (if the bug were present) has time to happen.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__signInAnonymouslyCalls)).toBe(1);
  });

  test('consent gate blocks the app until accepted, then hides', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await expect(page.locator('#consentGate')).not.toHaveClass(/hidden/);
    await expect(page.locator('#consentContinueBtn')).toBeDisabled();

    await page.check('#consentCheckbox');
    await expect(page.locator('#consentContinueBtn')).toBeEnabled();
    await page.click('#consentContinueBtn');
    await expect(page.locator('#consentGate')).toHaveClass(/hidden/);

    const consented = await page.evaluate(() => localStorage.getItem('gutlog_consent_v1'));
    expect(consented).toBe('true');
  });

  test('onboarding shows once for a first-time user, then never again', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');

    await expect(page.locator('#onboardingGate')).not.toHaveClass(/hidden/);
    await expect(page.locator('#onboardingTitle')).toHaveText('Welcome to Gut Log');

    // Step through all 5 slides (welcome + 4 feature slides).
    for (let i = 0; i < 4; i++) {
      await page.click('#onboardingNextBtn');
    }
    await expect(page.locator('#onboardingNextBtn')).toHaveText('Get started');
    await page.click('#onboardingNextBtn');
    await expect(page.locator('#onboardingGate')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => localStorage.getItem('gutlog_onboarded_v1'))).toBe('true');

    await page.reload();
    await expect(page.locator('#consentGate')).toHaveClass(/hidden/);
    await expect(page.locator('#onboardingGate')).toHaveClass(/hidden/);
  });

  test('a returning user who already consented sees onboarding if not yet completed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.setItem('gutlog_consent_v1', 'true'));
    await page.reload();

    await expect(page.locator('#consentGate')).toHaveClass(/hidden/);
    await expect(page.locator('#onboardingGate')).not.toHaveClass(/hidden/);
  });

  test('skip dismisses onboarding immediately and sets the flag', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await page.check('#consentCheckbox');
    await page.click('#consentContinueBtn');
    await page.click('#onboardingSkipBtn');
    await expect(page.locator('#onboardingGate')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => localStorage.getItem('gutlog_onboarded_v1'))).toBe('true');
  });
});
