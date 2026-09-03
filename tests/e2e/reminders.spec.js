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

  test('an overnight water reminder window (end before start) is rejected, not silently saved', async ({ page }) => {
    // The scheduler only fires water reminders while start <= now <= end on
    // the same calendar day, so an end time before the start time would
    // never match on either day - a silent, permanent no-op that "Reminders
    // saved" would otherwise imply had worked.
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="profile"]');
    await page.click('[data-remtoggle="water"]');
    await page.fill('#waterStartInput', '22:00');
    await page.fill('#waterEndInput', '02:00');

    let alertMessage = null;
    page.once('dialog', async (d) => { alertMessage = d.message(); await d.accept(); });
    await page.click('#saveRemindersBtn');
    await page.waitForTimeout(300);

    expect(alertMessage).toContain('end time must be after the start time');
    const saved = await page.evaluate(() => window.__fakeTables.reminder_settings.length);
    expect(saved).toBe(0);
  });

  test('a "Log now" deep link for medication inserts an entry with no extra input needed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html?quicklog=medication');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#logList .log-entry').first()).toContainText('Medication', { timeout: 3000 });
    // The URL param is cleaned up after being handled.
    expect(new URL(page.url()).search).toBe('');
  });

  test('a "Log now" deep link while offline queues the entry instead of silently dropping it', async ({ page }) => {
    // Previously this path had no error handling at all: a failed insert
    // (including the always-fails-while-offline case) just did nothing -
    // no toast, no alert, no offline queue - so a notification tap made
    // without a connection lost the log entirely with zero user feedback.
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    // Navigating while offline would fail before the app ever loads, so go
    // offline only after the page is up, then invoke the same handler a
    // real quicklog URL would trigger at load.
    await page.context().setOffline(true);
    await page.evaluate(() => {
      window.history.pushState({}, '', '?quicklog=medication');
      return handleReminderUrlParams();
    });

    await expect(page.locator('#logList .log-entry').first()).toContainText('Medication', { timeout: 3000 });
    await expect(page.locator('#logList .log-entry').first()).toContainText('Pending sync');
    await expect(page.locator('body')).toContainText('Saved offline', { timeout: 3000 });

    await page.context().setOffline(false);
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
