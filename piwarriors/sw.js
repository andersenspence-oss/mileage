// Network-first with a cache fallback, matching the other apps on this origin.
// The shell works offline; writing copy always needs the network.
const CACHE = "piwarriors-v2";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/app.css",
  "js/app.js", "js/api.js", "js/brand.js", "js/format.js",
  "js/generate.js", "js/limits.js", "js/store.js", "js/ui.js", "js/voice.js",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Only our own old caches: the mileage and e6b apps share this origin.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("piwarriors-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never touch API traffic; it must not be cached or replayed.
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
