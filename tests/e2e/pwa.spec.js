const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { mockSupabase, passConsentAndOnboarding, SUPABASE_CDN_URL } = require('../fixtures/helpers');

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

  // Regression test for a real gap: the Supabase SDK is loaded eagerly on
  // every page load (index.html's own <script> tag) and the app can't do
  // anything without it, but it's cross-origin so isShellRequest() never
  // matched it and it was never precached - a genuinely offline launch of
  // the installed PWA depended entirely on the browser's own opportunistic
  // HTTP cache for that script, which isn't guaranteed to survive eviction.
  //
  // This only checks that sw.js declares and wires up the exact CDN URL
  // index.html actually loads (same static-analysis approach as the
  // precache-list test above) - it does NOT exercise the live cross-origin
  // fetch. That fetch could not be verified end-to-end from this sandbox:
  // it succeeds from the page context but fails with a raw network error
  // specifically inside the service worker's own execution context here,
  // which matches this environment's known outbound restriction on direct
  // jsdelivr access (see fake-jspdf.js's history) rather than a flaw in the
  // approach - real browsers routinely precache cross-origin CDN resources
  // this way (it's how libraries like Workbox behave by default). Verify
  // the actual runtime behavior on a real device: install the PWA, go
  // fully offline, force-quit and relaunch it, and confirm it still boots.
  test("sw.js declares the exact Supabase SDK URL index.html loads as a precached, fetch-served shell file", () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

    const scriptTagMatch = indexHtml.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+)"><\/script>/);
    expect(scriptTagMatch).toBeTruthy();
    const cdnUrl = scriptTagMatch[1];
    expect(cdnUrl).toBe(SUPABASE_CDN_URL);

    const cdnShellMatch = swJs.match(/const CDN_SHELL_FILES = \[([\s\S]*?)\];/);
    expect(cdnShellMatch).toBeTruthy();
    expect(cdnShellMatch[1]).toContain(cdnUrl);

    // isShellRequest() must actually consult CDN_SHELL_FILES, or declaring
    // it above is a no-op (precaching alone doesn't make the fetch handler
    // serve it offline) - this was the exact mistake caught while building
    // this fix, so it's worth locking in as its own assertion.
    const isShellRequestMatch = swJs.match(/function isShellRequest\(url\)\{([\s\S]*?)\n\}/);
    expect(isShellRequestMatch).toBeTruthy();
    expect(isShellRequestMatch[1]).toContain('CDN_SHELL_FILES');
  });
});
