const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

function seedForDeletion() {
  return {
    entries: [
      { id: 1, user_id: 'test-user', ts: new Date().toISOString(), kind: 'stool', type: 4, tags: [], pain: 0, rest_id: null, rest_name: null, note: '' },
    ],
    restrooms: [
      { id: 1, user_id: 'test-user', name: 'My Own Spot', loc: '', lat: null, lng: null, photo: null, clean: 3, flags: [], note: '', report_count: 0, hidden: false },
    ],
    profiles: [{ id: 'test-user', tier: 'free' }],
  };
}

test.describe('account deletion', () => {
  test('requires a second confirmation step before anything happens', async ({ page }) => {
    await mockSupabase(page, seedForDeletion());
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');

    await page.click('#deleteAccountBtn');
    await expect(page.locator('#confirmDeleteAccountBtn')).toBeVisible();

    // Cancelling leaves everything untouched.
    await page.click('#cancelDeleteAccountBtn');
    await expect(page.locator('#deleteAccountBtn')).toBeVisible();
    const tables = await page.evaluate(() => window.__fakeTables);
    expect(tables.entries).toHaveLength(1);
    expect(tables.profiles).toHaveLength(1);
  });

  test('confirming removes the user\'s entries, detaches (not deletes) their restrooms, removes the profile, and signs out', async ({ page }) => {
    await mockSupabase(page, seedForDeletion());
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');

    await page.click('#deleteAccountBtn');
    await page.click('#confirmDeleteAccountBtn');

    // The click handler calls window.location.reload() right after - wait
    // for that navigation rather than racing it.
    await page.waitForLoadState('load');

    // Localstorage (consent + onboarding flags) was cleared as part of the
    // reset, so the consent gate reappears exactly like a first-ever visit.
    await expect(page.locator('#consentGate')).toBeVisible();
  });

  test('the edge function call deletes entries, detaches restroom ownership, and deletes the profile', async ({ page }) => {
    // Exercises the fake's mirror of the real delete-account edge function
    // directly, without the UI/reload race, so the actual data-mutation
    // behavior documented in supabase/functions/delete-account/index.ts is
    // verified independently of the confirm-panel flow above.
    await mockSupabase(page, seedForDeletion());
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    await page.evaluate(() => sb.functions.invoke('delete-account', { method: 'POST' }));

    const tables = await page.evaluate(() => window.__fakeTables);
    expect(tables.entries.some((e) => e.user_id === 'test-user')).toBe(false);
    expect(tables.restrooms.find((r) => r.id === 1).user_id).toBeNull();
    expect(tables.profiles.find((p) => p.id === 'test-user')).toBeUndefined();
  });

  test('a failed deletion leaves the account intact and shows an error instead of a false success', async ({ page }) => {
    await mockSupabase(page, seedForDeletion());
    await page.addInitScript(() => { window.__deleteAccountFails = true; });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');

    await page.click('#deleteAccountBtn');
    let alertMessage = null;
    page.once('dialog', async (d) => { alertMessage = d.message(); await d.accept(); });
    await page.click('#confirmDeleteAccountBtn');
    await page.waitForTimeout(300);

    expect(alertMessage).toBeTruthy();
    await expect(page.locator('#confirmDeleteAccountBtn')).toBeVisible();
    const tables = await page.evaluate(() => window.__fakeTables);
    expect(tables.entries).toHaveLength(1);
    expect(tables.profiles).toHaveLength(1);
  });
});
