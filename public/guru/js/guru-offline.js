/**
 * Guru Dashboard — Offline-First IndexedDB Layer
 *
 * Intercepts all API calls via apiFetch() to provide:
 *   - Instant reads from IndexedDB (stale-then-revalidate)
 *   - Optimistic writes to IndexedDB + sync queue
 *   - Background sync when online
 *
 * No imports — exposes globals consumed by guru.html's <script>.
 */

// ==================== CONFIG ====================

const DB_NAME = 'guru-offline';
const DB_VERSION = 1;

const STORE_MAP = {
    '/api/todos':                { store: 'todos',       key: 'id',    responseKey: 'todos' },
    '/api/poetry':               { store: 'poems',       key: 'id',    responseKey: 'poems' },
    '/api/blog-drafts':          { store: 'blog_drafts', key: 'slug',  responseKey: 'drafts' },
    '/api/finances':             { store: 'finances',    key: 'id',    responseKey: 'entries' },
    '/api/media':                { store: 'media',       key: 'id',    responseKey: 'entries' },
    '/api/goldlist':             { store: 'goldlist',    key: 'id',    responseKey: 'entries', hasStats: true },
    '/api/calendar':             { store: 'calendar',    key: 'id',    responseKey: 'events' },
    '/api/about':                { store: 'about',       key: 'id',    singleton: true },
    '/api/settings':             { store: 'settings',    key: 'id',    singleton: true },
    '/api/subscribers':          { store: 'subscribers', key: 'email', responseKey: 'subscribers' },
    '/api/newsletter-campaigns': { store: 'campaigns',   key: 'id',    responseKey: 'campaigns' },
    '/api/subscriber-count':     { store: 'subscribers', key: 'email', computed: 'count' },
};

// Endpoints that must not be queued offline
const ONLINE_ONLY = [
    '/api/blog-publish',
    '/api/blog-posts',
    '/api/blog-images',
    '/api/audio',
    '/api/habits',
    '/api/intention',
    '/api/intention-digest',
    '/api/file-presign',
    '/api/file-list',
    '/api/file-delete',
    '/api/file-rename',
    '/api/newsletter-send',
    '/api/publish-scheduled',
    '/api/goldlist-email',
    '/api/workouts',
    '/api/measurements',
    '/api/blood-markers',
    '/api/sex',
    '/api/steps',
    '/api/steps-sync',
    '/api/meals',
    '/api/foods',
];

function getReviewIntervalMs(distillation) {
    const intervals = [14, 14, 21, 28, 42];
    const days = intervals[Math.min(distillation || 0, intervals.length - 1)];
    return days * 24 * 60 * 60 * 1000;
}

// ==================== IDB HELPERS ====================

let _db = null;
let _dbOpening = null;

function initOfflineDB() {
    if (_db) return Promise.resolve(_db);
    if (_dbOpening) return _dbOpening;
    _dbOpening = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Data stores
            if (!db.objectStoreNames.contains('todos'))       db.createObjectStore('todos',       { keyPath: 'id' });
            if (!db.objectStoreNames.contains('poems'))       db.createObjectStore('poems',       { keyPath: 'id' });
            if (!db.objectStoreNames.contains('blog_drafts')) db.createObjectStore('blog_drafts', { keyPath: 'slug' });
            if (!db.objectStoreNames.contains('finances'))    db.createObjectStore('finances',    { keyPath: 'id' });
            if (!db.objectStoreNames.contains('media'))       db.createObjectStore('media',       { keyPath: 'id' });
            if (!db.objectStoreNames.contains('goldlist'))    db.createObjectStore('goldlist',     { keyPath: 'id' });
            if (!db.objectStoreNames.contains('calendar'))    db.createObjectStore('calendar',     { keyPath: 'id' });
            if (!db.objectStoreNames.contains('about'))       db.createObjectStore('about',       { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings'))    db.createObjectStore('settings',     { keyPath: 'id' });
            if (!db.objectStoreNames.contains('subscribers')) db.createObjectStore('subscribers', { keyPath: 'email' });
            if (!db.objectStoreNames.contains('campaigns'))   db.createObjectStore('campaigns',   { keyPath: 'id' });
            // Internal stores
            if (!db.objectStoreNames.contains('sync_queue'))  db.createObjectStore('sync_queue',  { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('sync_meta'))   db.createObjectStore('sync_meta',   { keyPath: 'store' });
        };

        req.onsuccess = (e) => {
            const db = e.target.result;
            // The browser can close the connection (versionchange in another tab,
            // mobile resource pressure, storage eviction). Null _db on close so
            // the next call re-opens cleanly instead of hitting "connection is closing".
            db.onclose = () => { if (_db === db) _db = null; };
            db.onversionchange = () => {
                try { db.close(); } catch (_) { /* ignore */ }
                if (_db === db) _db = null;
            };
            _db = db;
            _dbOpening = null;
            resolve(db);
        };
        req.onerror = () => {
            _dbOpening = null;
            reject(req.error);
        };
    });
    return _dbOpening;
}

function _isClosingError(err) {
    if (!err) return false;
    if (err.name === 'InvalidStateError') return true;
    return /closing|closed/i.test(err.message || '');
}

// Run an IDB op, retrying once if the connection closed mid-flight.
async function _withRetry(op) {
    if (!_db) await initOfflineDB();
    try {
        return await op();
    } catch (e) {
        if (!_isClosingError(e)) throw e;
        _db = null;
        await initOfflineDB();
        return await op();
    }
}

function idbGetAll(storeName) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    }));
}

function idbGet(storeName, key) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function idbPut(storeName, record) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function idbDelete(storeName, key) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

function idbClear(storeName) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

function idbCount(storeName) {
    return _withRetry(() => new Promise((resolve, reject) => {
        const tx = _db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

// ==================== URL ROUTING ====================

function resolveRoute(url) {
    // Strip query string for matching
    const path = url.split('?')[0];
    return STORE_MAP[path] || null;
}

function isOnlineOnly(url) {
    const path = url.split('?')[0];
    return ONLINE_ONLY.some(p => path.startsWith(p));
}

// ==================== GOLDLIST HELPERS ====================

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function computeGoldListStats(entries, dayStartMs) {
    const now = Date.now();
    const byLanguage = {}, byCategory = {};
    let totalReviews = 0;
    for (const e of entries) {
        const lang = e.language || 'unknown';
        byLanguage[lang] = (byLanguage[lang] || 0) + 1;
        if (e.category) byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        totalReviews += e.reviewCount || 0;
    }
    let addedToday = 0;
    if (dayStartMs) {
        addedToday = entries.filter(e => new Date(e.createdAt).getTime() >= dayStartMs).length;
    }
    return {
        total: entries.length,
        learned: entries.filter(e => e.learned).length,
        active: entries.filter(e => !e.learned).length,
        reviewable: entries.filter(e => {
            if (e.learned) return false;
            const refDate = new Date(e.lastReviewedAt || e.createdAt).getTime();
            return (now - refDate) >= getReviewIntervalMs(e.distillation);
        }).length,
        addedToday,
        byLanguage, byCategory, totalReviews,
    };
}

function applyGoldListFilters(entries, url) {
    const params = new URL(url, 'https://x').searchParams;

    // Daily word
    if (params.get('daily') === 'true') {
        const candidates = entries.filter(e => e.word);
        if (candidates.length === 0) return { entry: null };
        const today = new Date().toISOString().slice(0, 10);
        const index = hashString(today) % candidates.length;
        return { entry: candidates[index] };
    }

    let filtered = entries;
    const lang = params.get('language');
    const learned = params.get('learned');
    const reviewable = params.get('reviewable') === 'true';

    if (lang) filtered = filtered.filter(e => e.language === lang);
    if (learned !== null && learned !== undefined && learned !== '') {
        const wantLearned = learned === 'true';
        filtered = filtered.filter(e => e.learned === wantLearned);
    }
    if (reviewable) {
        const now = Date.now();
        filtered = filtered.filter(e => {
            if (e.learned) return false;
            const refDate = new Date(e.lastReviewedAt || e.createdAt).getTime();
            return (now - refDate) >= getReviewIntervalMs(e.distillation);
        });
    }

    const dayStartParam = params.get('dayStart');
    const dayStartMs = dayStartParam ? parseInt(dayStartParam) : 0;
    return { entries: filtered, stats: computeGoldListStats(entries, dayStartMs) };
}

// ==================== OFFLINE-FIRST GET ====================

// Track which stores have been populated at least once
const _populatedStores = new Set();

// Refresh callbacks — set by guru.html after defining its load functions
const REFRESH_CALLBACKS = {};

function registerRefreshCallback(storeName, fn) {
    REFRESH_CALLBACKS[storeName] = fn;
}

// Track in-flight background fetches to prevent callback loops
const _inflight = new Set();

// Sorted JSON snapshot for change detection (order-independent comparison)
function _sortedSnapshot(records, keyField) {
    if (!records || records.length === 0) return '[]';
    const sorted = [...records].sort((a, b) => {
        const ak = String(a[keyField] || '');
        const bk = String(b[keyField] || '');
        return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
    return JSON.stringify(sorted);
}

async function offlineFirstGet(url, options) {
    const route = resolveRoute(url);

    // Unknown route — fall through to network
    if (!route) {
        const res = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        return await res.json();
    }

    // Computed endpoint (subscriber-count)
    if (route.computed === 'count') {
        const cached = await idbGetAll(route.store);
        const cachedCount = cached.filter(s => !s.unsubscribed).length;

        // Background refresh (skip if already in-flight)
        if (!_inflight.has(route.store)) {
            backgroundFetch(url, options, route);
        }

        if (cached.length > 0) {
            return { count: cachedCount };
        }

        try {
            return await networkGet(url, options, route);
        } catch (e) {
            return { count: 0 };
        }
    }

    // Read from IDB
    let cachedData;
    if (route.singleton) {
        const row = await idbGet(route.store, 'main');
        cachedData = row || null;
    } else {
        cachedData = await idbGetAll(route.store);
    }

    const hasCache = route.singleton ? !!cachedData : (cachedData && cachedData.length > 0);

    // Fire background network refresh (skip if already in-flight for this store)
    if (!hasCache) {
        // First load, no cache — wait for network
        try {
            return await networkGet(url, options, route);
        } catch (e) {
            return buildResponse(route, cachedData, url);
        }
    }

    // Background refresh — only if not already in-flight
    if (!_inflight.has(route.store)) {
        backgroundFetch(url, options, route);
    }

    return buildResponse(route, cachedData, url);
}

function backgroundFetch(url, options, route) {
    _inflight.add(route.store);
    networkGet(url, options, route)
        .catch(() => {})
        .finally(() => { _inflight.delete(route.store); });
}

function buildResponse(route, data, url) {
    if (route.singleton) {
        // About returns { content: "" }, settings returns { languages: {} }
        return data || (route.store === 'about' ? { content: '' } : { languages: { indonesian: false, persian: false } });
    }

    const entries = data || [];

    // Goldlist has special handling
    if (route.hasStats) {
        return applyGoldListFilters(entries, url);
    }

    const result = {};
    result[route.responseKey] = entries;
    return result;
}

async function networkGet(url, options, route) {
    const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
    const fetchOpts = { ...(options || {}) };
    if ((options || {}).headers) fetchOpts.headers = { ...options.headers };
    const res = await fetch(apiBase + url, fetchOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Non-JSON response');
    const json = await res.json();

    // Update IDB with fresh data — but preserve pending local changes
    try {
        if (route.computed === 'count') {
            return json;
        }

        // Snapshot current IDB state for change detection
        const beforeSnapshot = route.singleton
            ? JSON.stringify(await idbGet(route.store, 'main') || null)
            : _sortedSnapshot(await idbGetAll(route.store), route.key);

        // Check for pending sync queue items targeting this store
        const pendingItems = await getPendingItemsForStore(route.store);

        if (route.singleton) {
            // Only overwrite singleton if no pending mutations for it
            if (pendingItems.length === 0) {
                const record = { ...json, id: 'main' };
                await idbPut(route.store, record);
            }
        } else {
            const records = json[route.responseKey] || [];

            if (pendingItems.length === 0) {
                // No pending changes — safe to replace entirely
                await idbClear(route.store);
                for (const r of records) {
                    await idbPut(route.store, r);
                }
            } else {
                // Merge: start with server data, then re-apply pending local writes
                // so optimistic changes are preserved until synced
                const serverMap = new Map();
                const keyField = route.key;
                for (const r of records) {
                    serverMap.set(r[keyField], r);
                }

                // Collect IDs that pending DELETEs target
                const pendingDeletes = new Set();
                const pendingPostIds = new Set();
                for (const p of pendingItems) {
                    if (p.method === 'DELETE') {
                        const delKey = p.body[keyField] || p.body.id || p.body.slug || p.body.email;
                        if (delKey) pendingDeletes.add(delKey);
                    } else if (p.method === 'POST' && p.body) {
                        const postKey = p.body[keyField] || p.body.id;
                        if (postKey) pendingPostIds.add(postKey);
                    }
                }

                // Read current IDB to get the optimistic records
                const localRecords = await idbGetAll(route.store);
                const localMap = new Map();
                for (const r of localRecords) {
                    localMap.set(r[keyField], r);
                }

                // Merge: server records + local-only/pending-edit records, minus pending deletes
                await idbClear(route.store);

                // Write server records (unless pending delete or pending POST edit)
                for (const r of records) {
                    if (!pendingDeletes.has(r[keyField]) && !pendingPostIds.has(r[keyField])) {
                        await idbPut(route.store, r);
                    }
                }

                // Write local records that don't exist on server OR have a pending POST edit
                for (const [key, r] of localMap) {
                    if (!pendingDeletes.has(key) && (!serverMap.has(key) || pendingPostIds.has(key))) {
                        await idbPut(route.store, r);
                    }
                }
            }
        }

        // Only trigger re-render if data actually changed
        const afterSnapshot = route.singleton
            ? JSON.stringify(await idbGet(route.store, 'main') || null)
            : _sortedSnapshot(await idbGetAll(route.store), route.key);

        if (beforeSnapshot !== afterSnapshot) {
            const cb = REFRESH_CALLBACKS[route.store];
            if (cb) {
                setTimeout(() => cb(), 0);
            }
        }
    } catch (e) {
        console.warn('IDB update failed:', e);
    }

    return json;
}

async function getPendingItemsForStore(storeName) {
    try {
        const queue = await idbGetAll('sync_queue');
        return queue.filter(item => item.store === storeName);
    } catch (e) {
        return [];
    }
}

// ==================== OFFLINE-FIRST MUTATE ====================

async function offlineFirstMutate(url, method, options) {
    const route = resolveRoute(url);
    const body = options.body ? JSON.parse(options.body) : {};

    // Unknown route — fall through to network
    if (!route) {
        const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
        const res = await fetch(apiBase + url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        return await res.json();
    }

    const now = new Date().toISOString();

    // Apply mutation to IDB
    if (method === 'DELETE') {
        await applyDelete(route, body);
    } else {
        await applyPost(route, body, url, now);
    }

    // Enqueue for sync
    await enqueueSync(route.store, method, url, body);

    // Flush immediately so the server is updated before any subsequent GET
    // (prevents background fetch from overwriting IDB with stale server data)
    try { await flushSyncQueue(); } catch (e) { /* retry later */ }
    updateSyncUI();

    // Return synthetic success
    return { ok: true };
}

async function applyDelete(route, body) {
    if (route.store === 'blog_drafts') {
        if (body.slug) await idbDelete(route.store, body.slug);
    } else if (route.store === 'subscribers') {
        if (body.email) await idbDelete(route.store, body.email);
    } else {
        if (body.id) await idbDelete(route.store, body.id);
    }
}

async function applyPost(route, body, url, now) {
    // Blog drafts have a wrapper: { draft: { ... } }
    if (route.store === 'blog_drafts') {
        const draft = body.draft || body;
        if (draft.slug) {
            draft.updatedAt = now;
            await idbPut(route.store, draft);
        }
        return;
    }

    // About page: singleton
    if (route.store === 'about') {
        await idbPut(route.store, { id: 'main', content: body.content || '', updatedAt: now });
        return;
    }

    // Settings: merge
    if (route.store === 'settings') {
        const existing = await idbGet(route.store, 'main') || { id: 'main', languages: {}, calendarCategories: {} };
        const merged = {
            ...existing,
            ...body,
            id: 'main',
            languages: { ...(existing.languages || {}), ...(body.languages || {}) },
            calendarCategories: body.calendarCategories !== undefined
                ? body.calendarCategories
                : (existing.calendarCategories || {}),
            updatedAt: now,
        };
        await idbPut(route.store, merged);
        return;
    }

    // Goldlist special actions
    if (route.store === 'goldlist') {
        if (body.action === 'self-rate') {
            const entry = await idbGet('goldlist', body.id);
            if (entry) {
                entry.reviewCount = (entry.reviewCount || 0) + 1;
                const ratings = Array.isArray(entry.selfRatings) ? entry.selfRatings : [];
                ratings.push({ rating: body.rating, date: now, direction: body.direction || 'forward' });
                if (ratings.length > 20) ratings.splice(0, ratings.length - 20);
                entry.selfRatings = ratings;
                entry.updatedAt = now;
                await idbPut('goldlist', entry);
            }
            return;
        }
        if (body.action === 'review' && Array.isArray(body.entries)) {
            for (const item of body.entries) {
                const entry = await idbGet('goldlist', item.id);
                if (!entry) continue;
                // Append self-rating if provided
                if (item.rating) {
                    const ratings = Array.isArray(entry.selfRatings) ? entry.selfRatings : [];
                    ratings.push({ rating: item.rating, date: now, direction: item.direction || 'forward' });
                    if (ratings.length > 20) ratings.splice(0, ratings.length - 20);
                    entry.selfRatings = ratings;
                    entry.reviewCount = (entry.reviewCount || 0) + 1;
                }
                if (item.learned) {
                    entry.learned = true;
                    entry.learnedAt = now;
                } else {
                    entry.distillation = (entry.distillation || 0) + 1;
                    entry.lastReviewedAt = now;
                }
                entry.updatedAt = now;
                await idbPut('goldlist', entry);
            }
            return;
        }
        if (body.batch && Array.isArray(body.entries)) {
            const language = (body.language || '').trim().toLowerCase();
            const listId = body.listId || `${language}-${now.slice(0, 10)}`;
            for (const item of body.entries) {
                if (!item.word || !item.word.trim()) continue;
                const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
                const data = {
                    id, word: item.word.trim(),
                    translation: (item.translation || '').trim(),
                    notes: (item.notes || '').trim(),
                    language, listId,
                    distillation: 0, learned: false,
                    createdAt: now, lastReviewedAt: null, learnedAt: null, updatedAt: now,
                    romanization: (item.romanization || '').trim(),
                    category: (item.category || '').trim(),
                    tags: (item.tags || '').trim(),
                    usageNotes: (item.usageNotes || '').trim(),
                    culturalNotes: (item.culturalNotes || '').trim(),
                    formality: (item.formality || '').trim(),
                    difficulty: (item.difficulty || '').trim(),
                    partOfSpeech: (item.partOfSpeech || '').trim(),
                    audioUrl: (item.audioUrl || '').trim(),
                    type: (item.type || 'word').trim(),
                    examples: Array.isArray(item.examples) ? item.examples : [],
                    rootFamily: (item.rootFamily || '').trim(),
                    rootLanguage: (item.rootLanguage || '').trim(),
                    reviewCount: 0, selfRatings: [],
                };
                await idbPut('goldlist', data);
            }
            return;
        }
        // Single add/update — fall through to generic handler below
    }

    // Calendar special actions
    if (route.store === 'calendar') {
        const action = body.action || 'save';
        if (action === 'edit-occurrence') {
            const entry = await idbGet('calendar', body.id);
            if (entry) {
                const exceptions = entry.exceptions || {};
                exceptions[body.occurrenceDate] = body.updates;
                entry.exceptions = exceptions;
                entry.updatedAt = now;
                await idbPut('calendar', entry);
            }
            return;
        }
        if (action === 'delete-occurrence') {
            const entry = await idbGet('calendar', body.id);
            if (entry) {
                const deleted = entry.deletedOccurrences || [];
                if (!deleted.includes(body.occurrenceDate)) deleted.push(body.occurrenceDate);
                entry.deletedOccurrences = deleted;
                entry.updatedAt = now;
                await idbPut('calendar', entry);
            }
            return;
        }
        if (action === 'delete-this-and-future') {
            const entry = await idbGet('calendar', body.id);
            if (entry) {
                if (body.occurrenceDate <= entry.date) {
                    await idbDelete('calendar', body.id);
                } else {
                    const endDate = new Date(body.occurrenceDate + 'T12:00:00');
                    endDate.setDate(endDate.getDate() - 1);
                    const recEnd = endDate.toISOString().split('T')[0];
                    const exceptions = entry.exceptions || {};
                    const cleanedExceptions = {};
                    for (const [d, v] of Object.entries(exceptions)) {
                        if (d <= recEnd) cleanedExceptions[d] = v;
                    }
                    entry.recurrenceEnd = recEnd;
                    entry.exceptions = cleanedExceptions;
                    entry.deletedOccurrences = (entry.deletedOccurrences || []).filter(d => d <= recEnd);
                    entry.updatedAt = now;
                    await idbPut('calendar', entry);
                }
            }
            return;
        }
        if (action === 'edit-future') {
            // End original series
            const entry = await idbGet('calendar', body.id);
            if (entry) {
                const endDate = new Date(body.occurrenceDate + 'T12:00:00');
                endDate.setDate(endDate.getDate() - 1);
                entry.recurrenceEnd = endDate.toISOString().split('T')[0];
                entry.updatedAt = now;
                await idbPut('calendar', entry);
            }
            // Create new event
            const newId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
            const merged = {
                id: newId,
                title: (entry || {}).title || '',
                date: body.occurrenceDate,
                endDate: (entry || {}).endDate || '',
                startTime: (entry || {}).startTime || '',
                endTime: (entry || {}).endTime || '',
                allDay: (entry || {}).allDay || false,
                category: (entry || {}).category || 'other',
                notes: (entry || {}).notes || '',
                recurrence: (entry || {}).recurrence || 'none',
                recurrenceEnd: '',
                exceptions: {},
                deletedOccurrences: [],
                ...(body.updates || {}),
                createdAt: now,
                updatedAt: now,
            };
            await idbPut('calendar', merged);
            return;
        }
        // action === 'save' falls through to generic
    }

    // Generic upsert for standard stores
    const keyField = route.key;
    const id = body[keyField] || body.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);

    const existing = await idbGet(route.store, id).catch(() => null);
    const record = existing
        ? { ...existing, ...body, [keyField]: id, updatedAt: now }
        : { ...body, [keyField]: id, createdAt: now, updatedAt: now };

    await idbPut(route.store, record);
}

// ==================== SYNC QUEUE ====================

async function enqueueSync(store, method, url, body) {
    const record = {
        store,
        method,
        url,
        body,
        timestamp: Date.now(),
        retries: 0,
    };
    await idbPut('sync_queue', record);
}

let _flushing = false;

async function flushSyncQueue() {
    if (_flushing) return;
    _flushing = true;

    try {
        const queue = await idbGetAll('sync_queue');
        queue.sort((a, b) => a.timestamp - b.timestamp);

        for (const item of queue) {
            try {
                const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
                const fetchOpts = {
                    method: item.method,
                    headers: { 'Content-Type': 'application/json' },
                };
                if (item.method !== 'GET') {
                    fetchOpts.body = JSON.stringify(item.body);
                }

                const res = await fetch(apiBase + item.url, fetchOpts);

                if (res.ok) {
                    await idbDelete('sync_queue', item.id);
                } else if (res.status >= 400 && res.status < 500) {
                    // Client error — remove from queue (won't succeed on retry)
                    console.warn(`Sync item failed with ${res.status}, removing from queue:`, item.url);
                    await idbDelete('sync_queue', item.id);
                } else {
                    // Server error — retry later
                    item.retries = (item.retries || 0) + 1;
                    if (item.retries >= 5) {
                        console.warn('Sync item exceeded retries, removing:', item.url);
                        await idbDelete('sync_queue', item.id);
                    } else {
                        await idbPut('sync_queue', item);
                    }
                    break; // Stop processing on server errors
                }
            } catch (e) {
                // Network error — stop flushing, try later
                break;
            }
        }
    } finally {
        _flushing = false;
        updateSyncUI();
    }
}

async function fullSync() {
    updateSyncUI('syncing');

    // 1. Push local changes first
    await flushSyncQueue();

    // 2. Pull fresh data for all stores
    const routes = Object.entries(STORE_MAP).filter(([url, r]) => !r.computed);
    for (const [url, route] of routes) {
        try {
            await networkGet(url, {}, route);
        } catch (e) {
            // Individual store sync failure is non-fatal
        }
    }

    // Flush any items that may have been created during pull (unlikely but safe)
    await flushSyncQueue();

    updateSyncUI('synced');

    // Reset to normal after a moment
    setTimeout(() => updateSyncUI(), 3000);
}

// ==================== SYNC UI ====================

async function getPendingCount() {
    try {
        return await idbCount('sync_queue');
    } catch (e) {
        return 0;
    }
}

async function updateSyncUI(forceState) {
    const dot = document.getElementById('syncDot');
    const text = document.getElementById('syncText');
    if (!dot || !text) return;

    const pending = await getPendingCount();

    if (forceState === 'syncing') {
        dot.className = 'sync-dot sync-dot-syncing';
        text.textContent = 'Syncing...';
        return;
    }
    if (forceState === 'synced') {
        dot.className = 'sync-dot sync-dot-online';
        text.textContent = 'Synced';
        return;
    }

    // Use a real connectivity check instead of navigator.onLine (unreliable on mobile/Brave)
    let isOnline = navigator.onLine;
    if (!isOnline) {
        try {
            const res = await fetch(API_BASE + '/api/health', { method: 'HEAD', cache: 'no-store' });
            isOnline = res.ok;
        } catch (_e) { /* truly offline */ }
    }

    if (!isOnline) {
        dot.className = 'sync-dot sync-dot-offline';
        text.textContent = pending > 0 ? `Offline (${pending} pending)` : 'Offline';
    } else if (pending > 0) {
        dot.className = 'sync-dot sync-dot-pending';
        text.textContent = `${pending} pending`;
    } else {
        dot.className = 'sync-dot sync-dot-online';
        text.textContent = 'Online';
    }
}

// ==================== EVENT LISTENERS ====================

window.addEventListener('online', () => {
    updateSyncUI();
    fullSync().catch(() => {});
});

window.addEventListener('offline', () => {
    updateSyncUI();
});

// Background sync timer — every 60s
setInterval(() => {
    if (!_flushing) flushSyncQueue().catch(() => {});
}, 60000);
