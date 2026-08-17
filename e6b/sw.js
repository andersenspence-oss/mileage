// sw.js — cache everything on first visit so the app works with no signal.
// Bump CACHE when any file changes; old caches are deleted on activate.

const CACHE = 'e6b-v2';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/e6b.css',
  'js/app.js',
  'js/ui.js',
  'js/core/units.js',
  'js/core/atmosphere.js',
  'js/core/airspeed.js',
  'js/core/wind.js',
  'js/core/nav.js',
  'js/core/maneuver.js',
  'js/core/fuel.js',
  'js/core/wb.js',
  'js/core/holding.js',
  'js/core/metar.js',
  'js/core/sun.js',
  'js/core/flightplan.js',
  'js/calcs/flight.js',
  'js/calcs/planning.js',
  'js/calcs/atmos.js',
  'js/calcs/convert.js',
  'js/pages/navlog.js',
  'js/pages/wb.js',
  'js/pages/wx.js',
  'js/pages/sun.js',
  'js/pages/timer.js',
  'js/pages/reference.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Cache storage is shared across the whole github.io origin, so only
      // ever touch our own caches — the mileage app lives here too.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('e6b-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigations (so an update is picked up when online),
// cache-first for everything else (instant, and works offline).
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && new URL(request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })),
  );
});
