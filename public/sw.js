// Legacy root-scope service worker from the old guru dashboard.
// The new dashboard registers /guru/sw.js (scoped to /guru/).
// This stub clears old caches and unregisters itself on next visit.
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
