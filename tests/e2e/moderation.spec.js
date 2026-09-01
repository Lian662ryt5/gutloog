const { test, expect } = require('@playwright/test');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

function seedRestroom(overrides = {}) {
  return {
    id: 1, user_id: 'other-user', name: 'Station Cafe', loc: 'High Street',
    lat: null, lng: null, photo: null, clean: 4, flags: [], note: '',
    report_count: 0, hidden: false, ...overrides,
  };
}

test.describe('restroom moderation', () => {
  test('reporting a spot walks through a reason picker and confirms', async ({ page }) => {
    await mockSupabase(page, { restrooms: [seedRestroom()] });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await page.click('[data-report="1"]');
    await expect(page.locator('#reportPanel-1 select')).toBeVisible();
    await page.selectOption('#reportReason-1', 'incorrect_info');
    await page.click('#reportSubmit-1');

    await expect(page.locator('#reportPanel-1')).toContainText('Reported — thanks');
    await expect(page.locator('[data-report="1"]')).toBeDisabled();
    await expect(page.locator('[data-report="1"]')).toHaveText('Reported');

    const reports = await page.evaluate(() => window.__fakeTables.restroom_reports);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ restroom_id: 1, user_id: 'test-user', reason: 'incorrect_info' });
  });

  test('reporting the same spot twice is rejected as a duplicate', async ({ page }) => {
    await mockSupabase(page, {
      restrooms: [seedRestroom()],
      restroom_reports: [{ id: 900, restroom_id: 1, user_id: 'test-user', reason: 'spam' }],
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await page.click('[data-report="1"]');
    await page.click('#reportSubmit-1');
    await expect(page.locator('#reportPanel-1')).toContainText("already reported");
  });

  test('a spot has no report button on the saver\'s own listing', async ({ page }) => {
    await mockSupabase(page, { restrooms: [seedRestroom({ id: 2, user_id: 'test-user', name: 'My Own Spot' })] });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    await expect(page.locator('.rest-card')).toContainText('My Own Spot');
    await expect(page.locator('[data-report="2"]')).toHaveCount(0);
  });

  test('a third distinct report crosses the threshold and hides the spot pending review', async ({ page }) => {
    await mockSupabase(page, {
      restrooms: [seedRestroom({ id: 3, user_id: 'test-user', name: 'Almost Flagged' })],
      restroom_reports: [
        { id: 901, restroom_id: 3, user_id: 'reporter-a', reason: 'closed' },
        { id: 902, restroom_id: 3, user_id: 'reporter-b', reason: 'closed' },
      ],
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="restrooms"]');

    // Own spot - no report button in this UI - so the 3rd report (from a
    // different reporter) is inserted directly against the fixture, same
    // as the real trigger would apply it, then the list is re-fetched
    // (not a full page.reload(), which would re-seed from the original
    // snapshot and lose this mutation) to see the resulting state.
    await page.evaluate(() => sb.from('restroom_reports').insert({ restroom_id: 3, user_id: 'reporter-c', reason: 'closed' }));
    await page.evaluate(() => loadRestrooms());

    const restroom = await page.evaluate(() => window.__fakeTables.restrooms.find((r) => r.id === 3));
    expect(restroom.report_count).toBe(3);
    expect(restroom.hidden).toBe(true);
    await expect(page.locator('.rest-card')).toContainText('Pending review — only you can see this');
  });
});

test.describe('admin review queue', () => {
  function seedHidden(id, name, reports) {
    return {
      restroom: { id, user_id: 'other-user', name, loc: 'Somewhere', lat: null, lng: null, photo: null, clean: 2, flags: [], note: '', report_count: reports.length, hidden: true },
      reports: reports.map((reason, i) => ({ id: id * 100 + i, restroom_id: id, user_id: `reporter-${i}`, reason, created_at: new Date().toISOString() })),
    };
  }

  test('the Admin tab is hidden for a non-admin user', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await expect(page.locator('#tab-admin')).toBeHidden();
  });

  test('an admin sees the queue with report reasons and can approve a spot', async ({ page }) => {
    const seeded = seedHidden(10, 'Flagged Spot', ['spam', 'inappropriate', 'closed']);
    await mockSupabase(page, {
      profiles: [{ id: 'test-user', is_admin: true }],
      restrooms: [seeded.restroom],
      restroom_reports: seeded.reports,
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    await expect(page.locator('#tab-admin')).toBeVisible({ timeout: 5000 });
    await page.click('[data-tab="admin"]');

    await expect(page.locator('.admin-card')).toContainText('Flagged Spot');
    await expect(page.locator('.admin-card')).toContainText('3 reports');
    await expect(page.locator('.admin-card')).toContainText('Spam');

    await page.click('[data-approve="10"]');
    await expect(page.locator('#adminQueueList')).toContainText('Nothing pending review', { timeout: 5000 });

    const restroom = await page.evaluate(() => window.__fakeTables.restrooms.find((r) => r.id === 10));
    expect(restroom.hidden).toBe(false);
    expect(restroom.reviewed_by).toBe('test-user');
  });

  test('an admin can remove a flagged spot permanently after confirming', async ({ page }) => {
    const seeded = seedHidden(11, 'Bad Spot', ['spam', 'spam', 'spam']);
    await mockSupabase(page, {
      profiles: [{ id: 'test-user', is_admin: true }],
      restrooms: [seeded.restroom],
      restroom_reports: seeded.reports,
    });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="admin"]');
    await expect(page.locator('.admin-card')).toContainText('Bad Spot');

    page.once('dialog', (d) => d.accept());
    await page.click('[data-remove="11"]');
    await expect(page.locator('#adminQueueList')).toContainText('Nothing pending review', { timeout: 5000 });

    const restrooms = await page.evaluate(() => window.__fakeTables.restrooms);
    expect(restrooms.find((r) => r.id === 11)).toBeUndefined();
  });
});
