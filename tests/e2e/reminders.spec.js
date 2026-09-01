const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

test.describe('reminders', () => {
  test('toggling a reminder type expands its settings, and saving persists them', async ({ page }) => {
    await mockSupabase(page);
    await page.context().grantPermissions(['notifications']);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');

    await expect(page.locator('[data-remdetail="toilet"]')).toBeHidden();
    await page.click('[data-remtoggle="toilet"]');
    await expect(page.locator('[data-remdetail="toilet"]')).toBeVisible();

    await page.click('[data-remaddtime="toilet"]');
    await expect(page.locator('[data-remtime="toilet"]')).toHaveCount(2);

    await page.fill('[data-remmessage="toilet"]', 'Custom reminder text');
    await page.click('#saveRemindersBtn');
    await expect(page.locator('body')).toContainText('Reminders saved.', { timeout: 3000 });

    const saved = await page.evaluate(() => window.__fakeTables.reminder_settings[0]);
    expect(saved.toilet_enabled).toBe(true);
    expect(saved.toilet_times).toHaveLength(2);
    expect(saved.toilet_message).toBe('Custom reminder text');
  });

  test('water intake uses an interval + active-hours model, not fixed times', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');
    await page.click('[data-remtoggle="water"]');
    await expect(page.locator('#waterIntervalSelect')).toBeVisible();
    await expect(page.locator('#waterStartInput')).toBeVisible();
    await expect(page.locator('#waterEndInput')).toBeVisible();
  });

  test('a "Log now" deep link for medication inserts an entry with no extra input needed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html?quicklog=medication');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#logList .log-entry').first()).toContainText('Medication', { timeout: 3000 });
    // The URL param is cleaned up after being handled.
    expect(new URL(page.url()).search).toBe('');
  });

  test('a "Log now" deep link for toilet/symptoms/meals opens the Log tab instead of a blind insert', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html?quicklog=toilet');
    await passConsentAndOnboarding(page);
    await expect(page.locator('.tabbtn.active')).toHaveText('Log', { timeout: 3000 });
    await expect(page.locator('#logList .log-entry')).toHaveCount(0);
  });

  test('a snooze action writes the correct reminder_log row', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html?remaction=snooze&type=toilet');
    await passConsentAndOnboarding(page);
    await page.waitForTimeout(500);
    const row = await page.evaluate(() => window.__fakeTables.reminder_log.find((r) => r.reminder_type === 'toilet'));
    expect(row).toBeTruthy();
    expect(row.snoozed_until).toBeTruthy();
    expect(new Date(row.snoozed_until).getTime()).toBeGreaterThan(Date.now());
  });

  test('a dismiss action writes dismissed:true for today', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html?remaction=dismiss&type=water');
    await passConsentAndOnboarding(page);
    await page.waitForTimeout(500);
    const row = await page.evaluate(() => window.__fakeTables.reminder_log.find((r) => r.reminder_type === 'water'));
    expect(row).toBeTruthy();
    expect(row.dismissed).toBe(true);
  });

  test('the home dashboard reminders snapshot reflects enabled types', async ({ page }) => {
    await mockSupabase(page, {
      reminder_settings: [{ user_id: 'test-user', timezone: 'UTC', medication_enabled: true, medication_times: ['09:00'] }],
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#remindersSnapshot')).toContainText('Medication', { timeout: 5000 });
  });
});
