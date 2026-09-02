const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { mockSupabase, passConsentAndOnboarding } = require('../fixtures/helpers');

const ROOT = path.join(__dirname, '..', '..');

test.describe('PWA installability', () => {
  test('the manifest declares everything required for an install prompt', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toMatch(/^#/);
    expect(manifest.theme_color).toMatch(/^#/);
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    manifest.icons.forEach((icon) => {
      expect(fs.existsSync(path.join(ROOT, icon.src))).toBe(true);
    });
  });

  test('index.html links the manifest and registers the service worker', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/index.html');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.json');
    await passConsentAndOnboarding(page);
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    expect(registered).toBe(true);
  });

  // Regression test for a real gap this repo shipped with: sw.js's
  // SHELL_FILES precache list drifted out of sync with the actual <script>
  // tags in index.html (two files added in later PRs were never added to
  // the precache list), so a fresh install wouldn't reliably cache the
  // full app shell for offline use until each file happened to be fetched
  // online at least once.
  test("the service worker's precache list matches every same-origin script/stylesheet index.html actually loads", () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

    const scriptSrcs = [...indexHtml.matchAll(/<script src="(js\/[a-z-]+\.js)">/g)].map((m) => m[1]);
    expect(scriptSrcs.length).toBeGreaterThan(5); // sanity check the regex actually matched something

    const shellFilesMatch = swJs.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
    expect(shellFilesMatch).toBeTruthy();
    const precached = [...shellFilesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const missingFromPrecache = scriptSrcs.filter((s) => !precached.includes(s));
    expect(missingFromPrecache).toEqual([]);
  });
});
