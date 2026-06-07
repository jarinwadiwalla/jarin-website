// Jarin Guru — Service Worker
// Caches app shell; queues writes when offline and syncs on reconnect.

const CACHE = "guru-v1";
const APP_SHELL = ["/guru/", "/guru/index.html"];

// ── Install: cache app shell ──
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for shell ──
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // API calls: network-first, fall through on failure
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // App shell: cache-first
  if (e.request.mode === "navigate" || APP_SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        return cached || fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network with cache fallback
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── Background sync: flush write queue ──
self.addEventListener("sync", (e) => {
  if (e.tag === "guru-sync") {
    e.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  const db = await openIDB();
  const tx = db.transaction("writeQueue", "readwrite");
  const store = tx.objectStore("writeQueue");
  const items = await storeGetAll(store);

  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (res.ok) {
        const del = db.transaction("writeQueue", "readwrite");
        del.objectStore("writeQueue").delete(item.id);
        await txDone(del);
      }
    } catch {
      // leave in queue for next sync attempt
    }
  }
}

// ── IndexedDB helpers ──
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("guru-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("writeQueue")) {
        db.createObjectStore("writeQueue", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function storeGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
