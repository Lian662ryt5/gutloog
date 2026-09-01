/* ---- Gut Log service worker: app-shell caching only ----
   Caches the static shell (HTML/CSS/JS/icons/manifest) so the app opens
   instantly and works offline. Never touches Supabase or Open Food Facts
   requests - those always go straight to the network so the app never
   shows stale health data as if it were live. Data written while offline
   is handled separately by the IndexedDB queue in js/offline-queue.js.

   Bump CACHE_VERSION whenever the shell file list below changes, so
   returning visitors pick up the new files instead of a stale cache. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `gutlog-shell-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'privacy.html',
  'terms.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'css/styles.css',
  'js/core.js',
  'js/offline-queue.js',
  'js/pricing.js',
  'js/themes.js',
  'js/achievements.js',
  'js/profile.js',
  'js/entries.js',
  'js/food.js',
  'js/tabs.js',
  'js/restrooms.js',
  'js/trends.js',
  'js/main.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name.startsWith('gutlog-shell-') && name !== CACHE_NAME)
             .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url){
  // Same-origin GET requests only - anything cross-origin (Supabase REST/
  // Auth/Storage, Open Food Facts) is left alone and goes straight to network.
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(!isShellRequest(url)) return;

  // Stale-while-revalidate: serve the cached shell instantly, then refresh
  // the cache in the background so the next visit picks up any update.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => null);

      if(cached) return cached;

      // Nothing cached yet (e.g. first load of a new file): wait on the
      // network, and if that also fails while offline, fall back to the
      // cached app shell so navigating within the app still works.
      return network.then(res => res || caches.match('index.html'));
    })
  );
});
