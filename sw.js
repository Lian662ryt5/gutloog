/* ---- Gut Log service worker: app-shell caching only ----
   Caches the static shell (HTML/CSS/JS/icons/manifest) so the app opens
   instantly and works offline. Never touches Supabase or Open Food Facts
   API requests - those always go straight to the network so the app never
   shows stale health data as if it were live. Data written while offline
   is handled separately by the IndexedDB queue in js/offline-queue.js.

   Bump CACHE_VERSION whenever the shell file list below changes, so
   returning visitors pick up the new files instead of a stale cache. */
const CACHE_VERSION = 'v5';
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
  'js/error-tracking.js',
  'js/offline-queue.js',
  'js/pricing.js',
  'js/themes.js',
  'js/achievements.js',
  'js/profile.js',
  'js/entries.js',
  'js/food.js',
  'js/tabs.js',
  'js/restrooms.js',
  'js/admin.js',
  'js/trends.js',
  'js/report.js',
  'js/reminders.js',
  'js/dashboard.js',
  'js/onboarding.js',
  'js/main.js'
];

// The Supabase SDK is loaded eagerly on every page load (index.html's own
// <script> tag, not lazy like jsPDF) and the app can't do anything without
// it - so it's effectively part of the shell too, even though it's
// cross-origin and isShellRequest() below intentionally never intercepts
// it (Supabase's own API calls must always go to the network live). Without
// this, a genuinely offline launch depended entirely on the browser's own
// opportunistic HTTP cache for this script, which isn't guaranteed to
// survive cache eviction - a real gap in the "offline-first" promise.
// jsPDF is deliberately NOT included here: it's lazy-loaded only when a
// report is generated specifically so most visitors never pay for it,
// and precaching it here would silently undo that.
const CDN_SHELL_FILES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES).then(() =>
        // Best-effort: a CDN hiccup or CORS surprise here must never fail
        // the whole install (that would break the app shell too), so each
        // one is caught independently rather than passed to Promise.all.
        Promise.all(CDN_SHELL_FILES.map(url =>
          cache.add(url).catch(err => console.error('SW: could not precache', url, err))
        ))
      ))
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
  // Same-origin GET requests, plus the one pinned CDN shell file above -
  // everything else cross-origin (Supabase REST/Auth/Storage, Open Food
  // Facts) is left alone and goes straight to network. caches.match() below
  // matches by URL regardless of request mode, so this still serves the
  // <script> tag's own (no-cors) request from the cors-mode copy cache.add()
  // stored at install time - the runtime re-fetch that revalidates it in the
  // background is itself no-cors/opaque and so can't refresh that cached
  // copy further, but a possibly-slightly-stale cached SDK beats an app
  // that can't boot at all when genuinely offline.
  return url.origin === self.location.origin || CDN_SHELL_FILES.includes(url.href);
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

/* ---- Reminder push notifications ----
   The actual send is done server-side (a Supabase Edge Function on a cron
   schedule, using the VAPID private key). This just displays whatever it
   sent us and routes the notification's action buttons back into the app -
   writing to Supabase from here would mean duplicating the page's auth/
   session-refresh logic, so actions instead open/focus the app with a URL
   param that the already-authenticated page handles (see
   handleReminderUrlParams in js/reminders.js). */
self.addEventListener('push', event => {
  let payload = {};
  try{ payload = event.data ? event.data.json() : {}; }catch(e){ payload = {}; }
  const title = payload.title || 'Gut Log';
  const body = payload.body || '';
  const type = payload.type || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: type || 'gutlog-reminder',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { type },
      actions: [
        { action:'log', title:'Log now' },
        { action:'snooze', title:'Snooze 30m' },
        { action:'dismiss', title:'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  const type = (event.notification.data && event.notification.data.type) || '';
  event.notification.close();

  let url = './';
  if(event.action === 'log') url = `./?quicklog=${encodeURIComponent(type)}`;
  else if(event.action === 'snooze') url = `./?remaction=snooze&type=${encodeURIComponent(type)}`;
  else if(event.action === 'dismiss') url = `./?remaction=dismiss&type=${encodeURIComponent(type)}`;

  event.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(windowClients => {
      for(const client of windowClients){
        if('focus' in client){
          if('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
