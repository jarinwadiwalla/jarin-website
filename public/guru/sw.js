const CACHE_NAME = 'guru-vjarin-1.0.0';
const AUDIO_CACHE = 'guru-audio-v1';
const SHELL_URLS = ['/guru/', '/guru/js/guru-offline.js', '/guru/js/guru-core.js', '/guru/js/guru-dashboard.js', '/guru/js/guru-calendar.js', '/guru/js/guru-finances.js', '/guru/js/guru-goldlist.js', '/guru/js/guru-habits.js', '/guru/js/guru-workouts.js', '/guru/js/guru-media.js', '/guru/js/guru-office-work.js', '/guru/js/guru-header-timer.js', '/guru/js/guru-intention.js', '/guru/js/guru-tools.js', '/guru/js/guru-translation.js', '/guru/js/guru-website.js', '/guru/js/guru-comments.js'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(c => c.addAll(SHELL_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME && k !== AUDIO_CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Audio stream: cache-first (only serve full requests from cache, not range)
    if (url.pathname.startsWith('/api/audio-stream/')) {
        e.respondWith(
            caches.open(AUDIO_CACHE).then(cache =>
                cache.match(url.pathname).then(cached => {
                    if (cached) return cached;
                    return fetch(e.request);
                })
            ).catch(() => fetch(e.request))
        );
        return;
    }

    // Network-only for other API calls (offline handling is at the app layer via IndexedDB)
    if (url.pathname.startsWith('/api/')) return;

    // Stale-while-revalidate for everything else
    e.respondWith(
        caches.open(CACHE_NAME).then(cache =>
            cache.match(e.request).then(cached => {
                const fetched = fetch(e.request).then(response => {
                    if (response.ok) cache.put(e.request, response.clone());
                    return response;
                }).catch(() => cached);
                return cached || fetched;
            })
        )
    );
});
