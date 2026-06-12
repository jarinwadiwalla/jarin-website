/* ==========================================================================
   Guru Dashboard — Core Module
   State, navigation, toasts, modals, API helpers, markdown parser,
   bottom nav, swipe, offline, collapsible, pull-to-refresh, PWA
   ========================================================================== */

// ==================== STATE ====================
// eslint-disable-next-line prefer-const -- reassigned in guru-website.js (all files concatenated into guru-bundle.js)
let currentDraftId = null;
let pendingConfirmAction = null;
const PROD_ORIGIN = 'https://jarinwadiwalla.com';
const API_BASE = (location.hostname === 'localhost' || location.hostname === 'jarinwadiwalla.com' || location.hostname === 'www.jarinwadiwalla.com' || location.hostname.endsWith('.pages.dev')) ? '' : PROD_ORIGIN;

// ==================== TAB NAVIGATION ====================
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

const WEBSITE_SUBMODES = ['blog', 'poetry', 'about', 'newsletter', 'subscribers'];
let currentWebMode = 'blog';

// Lazy-load: track which tabs have fetched their data
const _tabDataLoaded = new Set(['dashboard']);
const TAB_LOADERS = {
    website:  () => { loadDrafts(); loadCampaigns(); loadSubscribers(); loadPoems(); loadAboutContent(); loadSettings(); loadEmailTemplates(); },
    goldlist: () => { loadGoldList(); },
    finances: () => { loadFinances(); },
    media:    () => { loadMedia(); },
    calendar: () => { loadCalendar(); loadCalCategories(); },
    habits:   () => { loadHabits(); },
    tools:    () => { loadAudioLibrary(); loadFiles(); },
    comments: () => { loadComments(); },
    workouts: () => { loadWorkouts(); },
    officework: () => { loadOfficeWork(); },
    intention: () => { loadIntention(); },
};

function switchTab(tabName) {
    // Redirect old tab names to Website sub-modes
    if (WEBSITE_SUBMODES.includes(tabName)) {
        switchTab('website');
        switchWebMode(tabName);
        return;
    }

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const navTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (navTab) navTab.classList.add('active');
    const section = document.getElementById(`section-${tabName}`);
    if (section) section.classList.add('active');

    // Lazy-load tab data on first visit
    if (!_tabDataLoaded.has(tabName) && TAB_LOADERS[tabName]) {
        _tabDataLoaded.add(tabName);
        TAB_LOADERS[tabName]();
    }
}

function switchWebMode(mode) {
    currentWebMode = mode;
    document.querySelectorAll('.web-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.web-mode-btn[data-mode="${mode}"]`).classList.add('active');
    document.querySelectorAll('.web-panel').forEach(p => p.style.display = 'none');
    document.getElementById('web-panel-' + mode).style.display = '';
}

// ==================== TOAST NOTIFICATIONS ====================
// v4.6.12: optional `action` arg lets a caller attach an inline undo/cancel
// button — e.g. timer-stop autonav showing "Stay here" so the user can abort
// the screen-flip. Shape: { label, onClick }. Backwards-compatible — existing
// 2-arg call sites are unaffected.
function showToast(message, type = 'info', action = null) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const hasAction = action && action.label && typeof action.onClick === 'function';
    if (hasAction) {
        // Wrap message in a span so the action button can sit beside it
        // without inheriting the toast's text styling.
        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;
        toast.appendChild(msgSpan);
        const btn = document.createElement('button');
        btn.textContent = action.label;
        btn.style.cssText = 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.4);color:inherit;padding:3px 10px;margin-left:12px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;';
        btn.onclick = (e) => {
            e.stopPropagation();
            try { action.onClick(); } catch (_) { /* swallow */ }
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
        };
        toast.appendChild(btn);
    } else {
        toast.textContent = message;
    }

    container.appendChild(toast);
    // Action toasts stay up longer so the user has time to read + click.
    const visibleMs = hasAction ? 5000 : 3500;
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, visibleMs);
}

// ==================== MODAL ====================
function openModal(title, message, confirmText, confirmClass, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    const btn = document.getElementById('modalConfirmBtn');
    btn.textContent = confirmText;
    btn.className = `btn ${confirmClass}`;
    pendingConfirmAction = onConfirm;
    document.getElementById('confirmModal').classList.add('active');
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingConfirmAction = null;
}

function confirmAction() {
    if (pendingConfirmAction) {
        pendingConfirmAction();
    }
    closeModal();
}

// ==================== API HELPERS ====================
async function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    // Online-only endpoints — skip navigator.onLine check (unreliable on mobile browsers)
    if (isOnlineOnly(url)) {
        try {
            const fetchOpts = { ...options };
            if (!options.raw) {
                // Only set Content-Type for requests with a body (not GET/HEAD)
                if (method !== 'GET' && method !== 'HEAD') {
                    fetchOpts.headers = { 'Content-Type': 'application/json', ...options.headers };
                } else if (options.headers) {
                    fetchOpts.headers = { ...options.headers };
                }
            } else {
                delete fetchOpts.raw;
            }
            const res = await fetch(API_BASE + url, fetchOpts);
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                throw new Error('Expected JSON but got ' + (ct || 'unknown content-type') + (res.redirected ? ' (redirected)' : ''));
            }
            return await res.json();
        } catch (e) {
            showToast(`API Error: ${e.message}`, 'error');
            throw e;
        }
    }

    // Offline-first path
    if (!_db) await initOfflineDB();

    try {
        if (method === 'GET') {
            return await offlineFirstGet(url, options);
        } else {
            return await offlineFirstMutate(url, method, options);
        }
    } catch (e) {
        showToast(`API Error: ${e.message}`, 'error');
        throw e;
    }
}

function toggleSyncPopover(e) {
    e.stopPropagation();
    const pop = document.getElementById('syncPopover');
    const isActive = pop.classList.contains('active');
    pop.classList.toggle('active');
    if (!isActive) {
        getPendingCount().then(count => {
            const info = document.getElementById('syncPopoverInfo');
            const status = navigator.onLine ? 'Online' : 'Offline';
            info.textContent = `${status} · ${count} pending change${count !== 1 ? 's' : ''}`;
        });
    }
}
document.addEventListener('click', () => {
    const pop = document.getElementById('syncPopover');
    if (pop) pop.classList.remove('active');
});

// ==================== MARKDOWN PARSER ====================
// Wraps `![alt](url)\n*caption*` blocks into <figure>+<figcaption>. Mirror
// of applyImageCaptions in functions/lib/markdown.js — keep them in sync.
// Browser bundle can't import the ESM lib, so the source is duplicated here.
const _figImgRe = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const _figCapRe = /^[*_](.+?)[*_]\s*$/;
function applyImageCaptions(md) {
    if (!md) return md;
    const lines = md.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const next = lines[i + 1] || '';
        const before = i > 0 ? lines[i - 1] : '';
        const after = lines[i + 2] || '';
        const imgMatch = line.match(_figImgRe);
        const capMatch = next.match(_figCapRe);
        const standaloneBefore = i === 0 || before.trim() === '';
        const standaloneAfter = (i + 2) >= lines.length || after.trim() === '';
        if (imgMatch && capMatch && standaloneBefore && standaloneAfter) {
            const alt = imgMatch[1].replace(/"/g, '&quot;');
            const url = imgMatch[2].replace(/"/g, '&quot;');
            const caption = capMatch[1];
            out.push('<figure>');
            out.push(`<img src="${url}" alt="${alt}">`);
            out.push(`<figcaption>${caption}</figcaption>`);
            out.push('</figure>');
            i++;
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}

// Inline-width markdown extension: `![alt|600](url)` → <img alt="alt" width="600">.
// Mirror in scripts/build-blog.js — keep in sync.
const _imgWidthRe = /<img\b([^>]*?)\salt=(["'])([^"']*?)\|(\d+)\2([^>]*)>/gi;
function applyImageWidths(html) {
    if (!html) return html;
    return html.replace(_imgWidthRe,
        (m, pre, q, alt, width, post) => `<img${pre} alt=${q}${alt}${q} width="${width}"${post}>`);
}

function markdownToHtml(md) {
    if (!md) return '';
    let html = applyImageCaptions(md);

    // Code blocks (fenced)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Headings
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs: wrap remaining lines not already in block elements
    const lines = html.split('\n');
    const result = [];
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (!inBlock) result.push('');
            continue;
        }
        if (line.match(/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|img|br|center|div|section|article|figure|figcaption|table|thead|tbody|tr|td|th|iframe|video|audio|source|picture)\b/i)) {
            result.push(line);
            inBlock = false;
        } else if (line.match(/^<\/(ul|ol|pre|blockquote|center|div|section|article|figure|table|thead|tbody)/i)) {
            result.push(line);
            inBlock = false;
        } else {
            result.push(`<p>${line}</p>`);
        }
    }

    // Clean up empty paragraphs and merge consecutive blockquotes
    html = result.join('\n')
        .replace(/<p><\/p>/g, '')
        .replace(/<\/blockquote>\n<blockquote>/g, '<br>');

    return applyImageWidths(html);
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ==================== PWA ====================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/guru/sw.js').catch(() => {});
}

// ==================== REFRESH CALLBACKS ====================
// Register refresh callbacks so background network fetches can trigger re-renders
registerRefreshCallback('todos', () => loadTodos());
registerRefreshCallback('poems', () => { loadPoems(); loadDashboardStats(); });
registerRefreshCallback('blog_drafts', () => { loadDrafts(); loadDashboardStats(); });
registerRefreshCallback('finances', () => loadFinances());
registerRefreshCallback('media', () => loadMedia());
registerRefreshCallback('habits', () => loadHabits());
registerRefreshCallback('goldlist', () => loadGoldList());
registerRefreshCallback('calendar', () => loadCalendar());
registerRefreshCallback('about', () => loadAboutContent());
registerRefreshCallback('settings', () => { loadDashboardSettings(); loadSettings(); loadCalCategories(); });
registerRefreshCallback('subscribers', () => { loadSubscribers(); loadDashboardStats(); });
registerRefreshCallback('campaigns', () => loadCampaigns());

// ==================== INIT ====================
async function init() {
    await initOfflineDB();
    updateSyncUI();

    // Dashboard-critical loads only — other tabs lazy-load on first visit
    loadDashboardStats();
    loadTodos();
    loadDashboardSettings(); // single call for focus banner + reading goal
    loadCalendar();          // populates today's calendar widget above to-do list
    _tabDataLoaded.add('calendar');

    // Office Work loads eagerly so the global header timer (always visible)
    // has categories + today totals on every tab, not just after first visit.
    loadOfficeWork();
    _tabDataLoaded.add('officework');

    // Intention loads eagerly so the dashboard "Today's Goals" widget renders
    // on first paint instead of waiting for the Intention tab's first visit.
    loadIntention();
    _tabDataLoaded.add('intention');
}

// init() is called from guru.html after all module scripts are loaded

// ==================== NAV GROUPS ====================
// Single source of truth for the rail grouping. Drives the ⌘K palette.
// The desktop rail markup mirrors this but omits Habits / Health
// (reachable via the dashboard jump-to row); the mobile strip lists all tabs.
const NAV_GROUPS = {
    today: { label: 'Today', tabs: [
        { id: 'dashboard',  label: 'Dashboard' },
        { id: 'intention',  label: 'Intention' },
        { id: 'officework', label: 'Office Work' },
        { id: 'calendar',   label: 'Calendar' },
        { id: 'habits',     label: 'Habits' },
        { id: 'workouts',   label: 'Health' },
    ] },
    craft: { label: 'Craft', tabs: [
        { id: 'website',  label: 'Website' },
        { id: 'media',    label: 'Media' },
        { id: 'comments', label: 'Comments' },
    ] },
    learn: { label: 'Learn', tabs: [
        { id: 'goldlist', label: 'Gold List' },
    ] },
    operate: { label: 'Operate', tabs: [
        { id: 'finances', label: 'Finances' },
        { id: 'tools',    label: 'Tools' },
    ] },
};

// ==================== MOBILE TAB STRIP ====================
function updateMobileTabs() {
    const active = document.querySelector('.nav-tab.active')?.dataset.tab;
    document.querySelectorAll('.top-tab-item').forEach(item => {
        const isActive = item.dataset.tab === active;
        item.classList.toggle('active', isActive);
        if (isActive) item.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
}

// Sync the strip with tab switches
const origSwitchTab = switchTab;
switchTab = function(tabName) {
    origSwitchTab(tabName);
    updateMobileTabs();
};
updateMobileTabs(); // initial highlight (dashboard) before any tab switch

// ==================== COMMAND PALETTE (⌘K) ====================
let _cmdkSel = 0;

function _cmdkItems() {
    const q = (document.getElementById('cmdkInput')?.value || '').trim().toLowerCase();
    const out = [];
    for (const group of Object.values(NAV_GROUPS)) {
        for (const t of group.tabs) {
            if (!q || t.label.toLowerCase().includes(q) || t.id.includes(q)) {
                out.push({ ...t, group: group.label });
            }
        }
    }
    return out;
}

function renderCmdk() {
    const items = _cmdkItems();
    if (_cmdkSel >= items.length) _cmdkSel = Math.max(0, items.length - 1);
    const list = document.getElementById('cmdkList');
    if (!items.length) {
        list.innerHTML = '<div class="cmdk-empty">No matching section</div>';
        return;
    }
    let html = '';
    let lastGroup = '';
    items.forEach((it, i) => {
        if (it.group !== lastGroup) {
            html += `<div class="cmdk-group">${it.group}</div>`;
            lastGroup = it.group;
        }
        html += `<div class="cmdk-item${i === _cmdkSel ? ' sel' : ''}" onclick="cmdkGo(${i})" onmousemove="cmdkHover(${i})">${it.label}</div>`;
    });
    list.innerHTML = html;
}

function cmdkHover(i) {
    if (_cmdkSel !== i) { _cmdkSel = i; renderCmdk(); }
}

function cmdkGo(i) {
    const it = _cmdkItems()[i];
    if (it) { switchTab(it.id); closeCmdk(); }
}

function openCmdk() {
    _cmdkSel = 0;
    const inp = document.getElementById('cmdkInput');
    inp.value = '';
    document.getElementById('cmdkOverlay').classList.add('open');
    renderCmdk();
    inp.focus();
}

function closeCmdk() {
    document.getElementById('cmdkOverlay').classList.remove('open');
}

document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (document.getElementById('cmdkOverlay').classList.contains('open')) closeCmdk();
        else openCmdk();
        return;
    }
    if (!document.getElementById('cmdkOverlay').classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _cmdkSel++; renderCmdk(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdkSel = Math.max(0, _cmdkSel - 1); renderCmdk(); }
    else if (e.key === 'Enter') { e.preventDefault(); cmdkGo(_cmdkSel); }
});

document.getElementById('cmdkInput').addEventListener('input', () => { _cmdkSel = 0; renderCmdk(); });
document.getElementById('cmdkOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCmdk();
});

// ==================== SWIPE BETWEEN TABS ====================
// Mirrors the rail order (top to bottom): TODAY → CRAFT → LEARN → OPERATE.
const TAB_ORDER = ['dashboard', 'intention', 'officework', 'calendar', 'website', 'media', 'comments', 'goldlist', 'translation', 'finances', 'tools'];
let _swipeStartX = 0;
let _swipeStartY = 0;

document.addEventListener('touchstart', function(e) {
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', function(e) {
    if (_swipeStartX === 0) return;
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    _swipeStartX = 0;

    // Only trigger on horizontal swipe (dx > 80px, more horizontal than vertical)
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.7) return;

    // Don't swipe if user is interacting with an input/textarea/scrollable
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    const idx = TAB_ORDER.indexOf(activeTab);
    if (idx < 0) return;

    if (dx < 0 && idx < TAB_ORDER.length - 1) {
        switchTab(TAB_ORDER[idx + 1]);
    } else if (dx > 0 && idx > 0) {
        switchTab(TAB_ORDER[idx - 1]);
    }
}, { passive: true });

// ==================== OFFLINE TOAST ====================
window.addEventListener('offline', function() {
    const toast = document.getElementById('offlineToast');
    toast.textContent = "You're offline — changes saved locally";
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 4000);
});

window.addEventListener('online', function() {
    const toast = document.getElementById('offlineToast');
    toast.textContent = "Back online — syncing...";
    toast.style.background = 'var(--green)';
    toast.classList.add('visible');
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.style.background = '';
    }, 3000);
});

// ==================== COLLAPSIBLE SECTIONS ====================
function makeCollapsible(headingEl, contentEl) {
    const arrow = document.createElement('span');
    arrow.className = 'collapse-arrow';
    arrow.textContent = '▼';
    headingEl.classList.add('collapsible-header');
    headingEl.prepend(arrow);

    const storeKey = 'collapse-' + (headingEl.textContent || '').trim().replace(/[^a-zA-Z]/g, '').slice(0, 20);
    const saved = localStorage.getItem(storeKey);
    if (saved === 'collapsed') {
        contentEl.style.display = 'none';
        headingEl.classList.add('collapsed');
    }

    headingEl.addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        const isCollapsed = contentEl.style.display === 'none';
        contentEl.style.display = isCollapsed ? '' : 'none';
        headingEl.classList.toggle('collapsed', !isCollapsed);
        localStorage.setItem(storeKey, isCollapsed ? 'expanded' : 'collapsed');
    });
}

// Apply collapsible to dashboard cards that have expandable content
document.querySelectorAll('#section-dashboard > .card > h2').forEach(h2 => {
    const card = h2.parentElement;
    const content = card.querySelector('h2 ~ *');
    if (content && card.children.length > 2) {
        // Wrap all content after h2
        const wrapper = document.createElement('div');
        while (h2.nextSibling) wrapper.appendChild(h2.nextSibling);
        card.appendChild(wrapper);
        makeCollapsible(h2, wrapper);
    }
});

// ==================== PULL TO REFRESH ====================
let _ptrStartY = 0;
let _ptrTriggered = false;

document.addEventListener('touchstart', function(e) {
    if (window.scrollY === 0) {
        _ptrStartY = e.touches[0].clientY;
        _ptrTriggered = false;
    }
}, { passive: true });

document.addEventListener('touchmove', function(e) {
    if (_ptrStartY === 0 || _ptrTriggered) return;
    const diff = e.touches[0].clientY - _ptrStartY;
    if (diff > 80 && window.scrollY === 0) {
        _ptrTriggered = true;
        const indicator = document.getElementById('ptrIndicator');
        indicator.classList.add('visible');
        indicator.textContent = 'Syncing...';
        fullSync().then(() => {
            indicator.textContent = 'Synced!';
            setTimeout(() => indicator.classList.remove('visible'), 1500);
        }).catch(() => {
            indicator.textContent = 'Sync failed';
            setTimeout(() => indicator.classList.remove('visible'), 2000);
        });
    }
}, { passive: true });

document.addEventListener('touchend', function() {
    _ptrStartY = 0;
}, { passive: true });
