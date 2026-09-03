const { test, expect } = require('@playwright/test');
const { mockSupabase, mockJsPDF, passConsentAndOnboarding, isoAt } = require('../fixtures/helpers');

function buildSeed() {
  const entries = [];
  let id = 1;

  // 10 symptom entries, every 5th one flagged (urgent + pain 2).
  for (let i = 0; i < 10; i++) {
    const flagged = i % 5 === 0;
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(i, 9), kind: 'stool',
      type: 3 + (i % 3), tags: flagged ? ['urgent'] : [], pain: flagged ? 2 : 0,
      rest_id: null, rest_name: null, note: flagged ? 'Woke me up' : '',
    });
  }
  // Food logged the evening before each flare, so it should surface as a
  // correlation (needs count >= 2 to be included in the report).
  [1, 6].forEach((d) => {
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(d, 19), kind: 'food',
      food_name: 'Spicy Curry', food_brand: '', food_barcode: '1',
    });
  });
  // Medication log.
  for (let i = 0; i < 3; i++) {
    entries.push({
      id: id++, user_id: 'test-user', ts: isoAt(i, 8), kind: 'medication',
      note: 'Mesalazine 800mg',
    });
  }
  return entries;
}

test.describe('doctor report (PDF export)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { entries: buildSeed() });
    await mockJsPDF(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');
  });

  test('a quick date-range preset fills in both date fields and marks itself selected', async ({ page }) => {
    await page.click('#reportPresets [data-preset="30"]');
    await expect(page.locator('#reportPresets [data-preset="30"]')).toHaveAttribute('aria-pressed', 'true');
    const from = await page.locator('#reportFromInput').inputValue();
    const to = await page.locator('#reportToInput').inputValue();
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    expect(from < to).toBe(true);
  });

  test('generating without both dates set shows a validation error', async ({ page }) => {
    await page.fill('#reportFromInput', '');
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('Choose both a from and to date');
  });

  test('a "from" date after the "to" date is rejected', async ({ page }) => {
    await page.fill('#reportFromInput', '2026-06-01');
    await page.fill('#reportToInput', '2026-01-01');
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('must be before');
  });

  test('generates a PDF containing the summary, flare history, food correlation, and medication log', async ({ page }) => {
    await page.click('#reportPresets [data-preset="90"]');
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('Report downloaded.', { timeout: 5000 });

    const pdf = await page.evaluate(() => window.__lastPdf);
    expect(pdf.savedAs).toMatch(/^gut-log-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.pdf$/);

    const text = pdf.text.join('\n');
    expect(text).toContain('Gut Log — Symptom Report');
    expect(text).toContain('Total entries logged');
    expect(text).toContain('Flare history');
    expect(text).toContain('Woke me up');
    expect(text).toContain('Spicy Curry');
    expect(text).toContain('Mesalazine 800mg');
    expect(text).toContain('Bristol Stool Scale distribution');
    // The Bristol reference table describes every type by name.
    expect(text).toContain('Hard lumps');
    expect(text).toContain('Personal tracking only');
  });

  test('an empty date range still produces a report, with honest empty-state text', async ({ page }) => {
    await page.fill('#reportFromInput', '2019-01-01');
    await page.fill('#reportToInput', '2019-01-07');
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('Report downloaded.', { timeout: 5000 });

    const text = (await page.evaluate(() => window.__lastPdf.text)).join('\n');
    expect(text).toContain('No flagged entries');
    expect(text).toContain('No medication entries logged');
    expect(text).toContain('Not enough food and flare data');
  });

});

test.describe('doctor report - timezone-sensitive date defaults', () => {
  // Sydney is UTC+10 in June (non-DST). At local 01:00 on the 15th, UTC is
  // still 15:00 on the 14th - toISOString().slice(0,10) would report "today"
  // as the 14th, one day behind the user's actual local calendar date. Any
  // entry logged in that window (like "just now") would be silently
  // excluded from the report's default date range.
  test.use({ timezoneId: 'Australia/Sydney' });

  test('the "today" date used for report presets is the local calendar date, not UTC', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-14T15:00:00.000Z')); // local 2026-06-15T01:00:00+10:00
    await mockSupabase(page, { entries: [] });
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);

    const today = await page.evaluate(() => todayIsoDate());
    expect(today).toBe('2026-06-15');
  });

  test('an entry logged moments ago (local "today") is included in a report generated right after, even though UTC is still yesterday', async ({ page }) => {
    const nowIso = '2026-06-14T15:00:00.000Z'; // local 2026-06-15T01:00:00+10:00
    await page.clock.setFixedTime(new Date(nowIso));
    await mockSupabase(page, {
      entries: [{
        id: 1, user_id: 'test-user', ts: nowIso, kind: 'stool',
        type: 4, tags: ['urgent'], pain: 2, rest_id: null, rest_name: null, note: 'Logged right after midnight',
      }],
    });
    await mockJsPDF(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');

    // Default preset (90 days) auto-fills on load; generate immediately,
    // the same way a user would moments after logging.
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('Report downloaded.', { timeout: 5000 });

    const text = (await page.evaluate(() => window.__lastPdf.text)).join('\n');
    expect(text).toContain('Logged right after midnight');
    // June 15, 2026 is a local Monday in Sydney, so the weekly-trend table
    // should label this entry's week "Jun 15", not "Jun 14" (the previous
    // UTC calendar day the old toISOString()-based key would have produced).
    expect(text).toContain('Jun 15');
    expect(text).not.toContain('Jun 14');
  });
});

test.describe('doctor report - long medication log', () => {
  test('a long medication log spans multiple PDF pages', async ({ page }) => {
    const entries = buildSeed().concat(
      Array.from({ length: 40 }, (_, i) => ({
        id: 1000 + i, user_id: 'test-user', ts: isoAt(i % 89, 7), kind: 'medication', note: `Dose ${i}`,
      }))
    );
    await mockSupabase(page, { entries });
    await mockJsPDF(page);
    await page.goto('/index.html');
    await passConsentAndOnboarding(page);
    await page.click('[data-tab="trends"]');
    await page.click('#reportPresets [data-preset="90"]');
    await page.click('#generateReportBtn');
    await expect(page.locator('#reportStatus')).toContainText('Report downloaded.', { timeout: 5000 });

    const pageCount = await page.evaluate(() => window.__lastPdf.pageCount);
    expect(pageCount).toBeGreaterThan(1);
  });
});
