/* ==========================================================================
   Guru Dashboard — Office Work Module
   Deep-work / study time tracking with start/pause/stop timers per category.
   Stopping a timer logs a session and (optionally) auto-completes a habit.
   ========================================================================== */

let owCategories = [];
let owSessions = [];
let owTodayTotals = [];
let owWeekTotals = [];
let owMonthTotals = [];
let owKindFilter = 'all';
let owRange = 'week';
let owView = 'analytics';
let owSessionsRange = 30;
let owTimerInterval = null;

const OW_TIMER_KEY = 'guru-ow-active-timer';
const OW_DEFAULT_COLOR = '#3b82f6';

// ---- Active timer state (mirrored to localStorage so reloads preserve it) ----
//   { categoryId, runStartedAt (ISO when current run began), accumulatedSec, paused }
function owGetActive() {
    try {
        const raw = localStorage.getItem(OW_TIMER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
function owSetActive(state) {
    if (state) localStorage.setItem(OW_TIMER_KEY, JSON.stringify(state));
    else localStorage.removeItem(OW_TIMER_KEY);
}

function owElapsedSec(state) {
    if (!state) return 0;
    if (state.paused) return state.accumulatedSec || 0;
    const runMs = Date.now() - new Date(state.runStartedAt).getTime();
    return Math.max(0, (state.accumulatedSec || 0) + Math.floor(runMs / 1000));
}

function owFormatHMS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return [h, m, ss].map(n => String(n).padStart(2, '0')).join(':');
}

function owFormatMin(sec) {
    const m = Math.round((sec || 0) / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

// ==================== LOADING ====================
async function loadOfficeWork() {
    const localToday = new Date().toLocaleDateString('en-CA');
    let data;
    try {
        data = await apiFetch('/api/office-work?today=' + localToday);
    } catch (e) {
        const el = document.getElementById('owCategoryList');
        if (el) el.innerHTML = `<div class="empty-state"><p>Failed to load office work data.</p><p style="font-size:12px;color:#ef4444;">${esc(e.message || 'Unknown error')}</p><button class="btn btn-primary" style="margin-top:12px;" onclick="loadOfficeWork()">Try Again</button></div>`;
        return;
    }
    owCategories = data.categories || [];
    owSessions = data.sessions || [];
    owTodayTotals = data.todayTotals || [];
    owWeekTotals = data.weekTotals || [];
    owMonthTotals = data.monthTotals || [];

    // Seed defaults on first load (no categories yet)
    if (owCategories.length === 0) {
        await owSeedDefaults();
        try {
            data = await apiFetch('/api/office-work?today=' + localToday);
            owCategories = data.categories || [];
            owSessions = data.sessions || [];
            owTodayTotals = data.todayTotals || [];
            owWeekTotals = data.weekTotals || [];
            owMonthTotals = data.monthTotals || [];
        } catch { /* ignore */ }
    }

    owRender();
    owStartTimerLoopIfNeeded();
    if (typeof hdrTimerRefresh === 'function') hdrTimerRefresh();
}

async function owSeedDefaults() {
    // Resolve linked habits by best-effort name match against existing habits[]
    const findHabit = (matchers) => {
        const list = (typeof habits !== 'undefined' && Array.isArray(habits)) ? habits : [];
        const found = list.find(h => h.status === 'active' && h.name && matchers.some(m => h.name.toLowerCase().includes(m)));
        return found ? found.id : '';
    };
    const seeds = [
        { name: 'Add 10 words to the Goldlist', kind: 'study', color: '#f59e0b', linkedHabitId: findHabit(['goldlist', 'gold list', 'gold-list']) },
        { name: 'Read/Listen to Indonesian Material', kind: 'study', color: '#10b981', linkedHabitId: findHabit(['indonesian material', 'read/listen', 'indonesian']) },
        { name: 'Use Jadi', kind: 'work', color: '#3b82f6', linkedHabitId: findHabit(['jadi']) },
        { name: 'Content Creation', kind: 'work', color: '#8b5cf6', linkedHabitId: findHabit(['poem/blog', 'poem', 'blog post', 'write a post']) },
        { name: 'Bug Fixing', kind: 'work', color: '#ef4444', linkedHabitId: '' },
    ];
    for (let i = 0; i < seeds.length; i++) {
        try {
            await apiFetch('/api/office-work', {
                method: 'POST',
                body: JSON.stringify({ action: 'save-category', ...seeds[i], sortOrder: i }),
            });
        } catch { /* ignore individual seed failures */ }
    }
}

// ==================== RENDERING ====================
function owRender() {
    owRenderActiveBanner();
    owRenderCategoryList();
    owRenderSessionsList();
    owRenderAnalytics();
    if (typeof hdrTimerRefresh === 'function') hdrTimerRefresh();
}

function owSetView(view) {
    owView = view;
    document.querySelectorAll('.ow-view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.ow-view').forEach(el => {
        el.style.display = el.id === 'owView' + view.charAt(0).toUpperCase() + view.slice(1) ? '' : 'none';
    });
}

function owRenderActiveBanner() {
    const banner = document.getElementById('owActiveBanner');
    if (!banner) return;
    const state = owGetActive();
    if (!state) {
        banner.style.display = 'none';
        return;
    }
    const cat = owCategories.find(c => c.id === state.categoryId);
    if (!cat) {
        // Category was deleted — clear stale timer
        owSetActive(null);
        banner.style.display = 'none';
        return;
    }
    banner.style.display = '';
    banner.style.borderColor = cat.color || OW_DEFAULT_COLOR;
    document.getElementById('owActiveCatName').textContent = cat.name;
    document.getElementById('owActiveDisplay').textContent = owFormatHMS(owElapsedSec(state));
    const pauseBtn = document.getElementById('owPauseBtn');
    if (pauseBtn) pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';

    // v4.6.8: populate the "Tag to goal" dropdown so the user can attach
    // the active session to an Intention goal (optional). Only re-render
    // the options when intGoals is loaded; selection persists in state.goalId.
    const goalSel = document.getElementById('owActiveGoalInput');
    if (goalSel && typeof intGoals !== 'undefined') {
        const desired = state.goalId || '';
        // Avoid rebuilding the option list on every tick — only when option count drifts.
        if (goalSel.dataset.goalCount !== String(intGoals.length)) {
            goalSel.innerHTML = '<option value="">— None —</option>' + intGoals
                .filter(g => g.status !== 'dropped')
                .sort((a, b) => {
                    const order = { quarterly: 0, yearly: 1, weekly: 2, daily: 3 };
                    return (order[a.horizon] ?? 9) - (order[b.horizon] ?? 9);
                })
                .map(g => `<option value="${esc(g.id)}">${esc(owGoalOptionLabel(g))}</option>`)
                .join('');
            goalSel.dataset.goalCount = String(intGoals.length);
        }
        if (goalSel.value !== desired) goalSel.value = desired;
    }
}

// Goal-dropdown label: full horizon word (avoids the [W]=weekly vs working
// ambiguity reported in v4.6.8) + venture names so the user can tell which
// venture each goal belongs to.
function owGoalOptionLabel(g) {
    const horizonLabel = ({ daily: 'Daily', weekly: 'Weekly', quarterly: 'Quarterly', yearly: 'Yearly' })[g.horizon] || g.horizon;
    let venturePart = '';
    if (typeof intGoalVentureIds === 'function' && typeof intVentures !== 'undefined') {
        const ventures = intGoalVentureIds(g)
            .map(id => intVentures.find(v => v.id === id))
            .filter(Boolean);
        if (ventures.length) {
            venturePart = ' — ' + ventures.map(v => v.name).join(' / ');
        }
    }
    return `[${horizonLabel}] ${g.title}${venturePart}`;
}

// Update the active timer's goalId when the dropdown changes.
function owActiveGoalChange(goalId) {
    const state = owGetActive();
    if (!state) return;
    state.goalId = goalId || '';
    owSetActive(state);
}

function owRenderCategoryList() {
    const el = document.getElementById('owCategoryList');
    if (!el) return;
    // Sort by sortOrder so drag-to-reorder (v4.6.9) takes effect on next render.
    const filtered = owCategories
        .filter(c => owKindFilter === 'all' || c.kind === owKindFilter)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (!filtered.length) {
        el.innerHTML = '<div class="empty-state"><p>No categories yet.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="owOpenCategoryModal()">+ Add Category</button></div>';
        return;
    }
    const active = owGetActive();
    const todayMap = Object.fromEntries(owTodayTotals.map(t => [t.categoryId, t.total]));
    const weekMap = Object.fromEntries(owWeekTotals.map(t => [t.categoryId, t.total]));

    let html = '';
    for (const c of filtered) {
        const isActive = active && active.categoryId === c.id;
        const todaySec = todayMap[c.id] || 0;
        const weekSec = weekMap[c.id] || 0;
        const liveExtra = isActive ? owElapsedSec(active) : 0;
        const linkedHabit = c.linkedHabitId ? owFindHabitById(c.linkedHabitId) : null;
        const tag = c.kind === 'study'
            ? '<span style="font-size:10px;background:#10b98120;color:#10b981;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;">Study</span>'
            : '<span style="font-size:10px;background:#3b82f620;color:#3b82f6;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;">Work</span>';

        // Whole card is draggable so the user can grab anywhere with the cursor;
        // the ⋮⋮ handle on the left is the visible affordance. Click targets
        // (buttons, edit gear) remain interactive — dragstart doesn't fire on
        // form controls in any modern browser.
        html += `<div class="card ow-cat-card" draggable="true" data-cat-id="${esc(c.id)}" style="margin-bottom:10px;padding:14px 16px;border-left:4px solid ${c.color || OW_DEFAULT_COLOR};${isActive ? 'background:#f0f9ff;' : ''}cursor:default;">`;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">';
        html += `<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:180px;">`;
        html += `<span title="Drag to reorder" style="color:var(--gray-300);font-size:16px;cursor:grab;user-select:none;line-height:1;flex-shrink:0;">⋮⋮</span>`;
        html += '<div style="flex:1;min-width:0;">';
        // v4.6.9 follow-up: venture chips on category cards. Renders all linked
        // ventures (multi-venture-aware) so the user can see at a glance which
        // venture(s) this category's time rolls up to. Pulled from intVentures
        // which is loaded eagerly at init by guru-intention.js.
        const catVentures = owCategoryVentureIds(c)
            .map(id => (typeof intVentures !== 'undefined' && Array.isArray(intVentures))
                ? intVentures.find(v => v.id === id) : null)
            .filter(Boolean);
        const ventureChips = catVentures.length
            ? catVentures.map(vv => {
                const vColor = vv.color || '#3b82f6';
                return `<span style="background:${vColor}22;color:${vColor};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">${vv.icon ? esc(vv.icon) + ' ' : ''}${esc(vv.name)}</span>`;
            }).join(' ')
            : '';

        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;"><strong style="font-size:15px;">${esc(c.name)}</strong>${tag}${ventureChips}</div>`;
        html += `<div style="font-size:12px;color:var(--gray-500);">Today: <strong style="color:var(--gray-700);">${owFormatMin(todaySec + liveExtra)}</strong> &middot; Week: <strong style="color:var(--gray-700);">${owFormatMin(weekSec + liveExtra)}</strong>`;
        if (linkedHabit) html += ` &middot; <span style="color:var(--gray-400);">&rarr; ${esc(linkedHabit.name)}</span>`;
        html += '</div></div></div>';

        html += '<div style="display:flex;gap:6px;align-items:center;">';
        if (isActive) {
            html += `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;font-size:18px;font-weight:600;margin-right:6px;" data-ow-live="${c.id}">${owFormatHMS(owElapsedSec(active))}</span>`;
            html += `<button class="btn btn-secondary btn-sm" onclick="owPauseToggle()">${active.paused ? 'Resume' : 'Pause'}</button>`;
            html += '<button class="btn btn-sm" style="background:#ef4444;color:white;border-color:#ef4444;" onclick="owStopTimer()">Stop</button>';
        } else {
            const disabled = active ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : '';
            html += `<button class="btn btn-primary btn-sm" onclick="owStartTimer('${c.id}')" ${disabled}>&#9654; Start</button>`;
        }
        html += `<button class="btn btn-secondary btn-sm" onclick="owOpenCategoryModal('${c.id}')" title="Edit">&#9881;</button>`;
        html += '</div></div></div>';
    }
    el.innerHTML = html;
    owAttachCategoryDrag(el);
}

// Drag-to-reorder for Office Work category cards (v4.6.9). Same HTML5 DnD
// pattern used for goal cards in v4.6.7 — drop fires the existing
// `reorder` action on /api/office-work.
function owAttachCategoryDrag(root) {
    const cards = root.querySelectorAll('.ow-cat-card');
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.catId);
            card.style.opacity = '0.4';
        });
        card.addEventListener('dragend', () => {
            card.style.opacity = '';
            root.querySelectorAll('.ow-cat-card').forEach(c => {
                c.style.borderTopColor = ''; c.style.borderTopWidth = ''; c.style.borderTopStyle = '';
            });
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            root.querySelectorAll('.ow-cat-card').forEach(c => {
                c.style.borderTopColor = ''; c.style.borderTopWidth = ''; c.style.borderTopStyle = '';
            });
            card.style.borderTopColor = '#3b82f6';
            card.style.borderTopWidth = '3px';
            card.style.borderTopStyle = 'solid';
        });
        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            const targetId = card.dataset.catId;
            if (!draggedId || draggedId === targetId) return;
            await owReorderCategories(draggedId, targetId);
        });
    });
}

async function owReorderCategories(draggedId, targetId) {
    // Operate on the *visible* list so the user's drag intent in the current
    // kind filter (all/study/work) is preserved. Other categories keep their
    // existing sortOrder and interleave naturally on next render.
    const visible = owCategories
        .filter(c => owKindFilter === 'all' || c.kind === owKindFilter)
        .slice()
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const draggedIdx = visible.findIndex(c => c.id === draggedId);
    const targetIdx = visible.findIndex(c => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;
    const [dragged] = visible.splice(draggedIdx, 1);
    const newTargetIdx = visible.findIndex(c => c.id === targetId);
    visible.splice(newTargetIdx, 0, dragged);
    const entries = visible.map((c, i) => ({ id: c.id, sortOrder: i }));

    // Optimistic update so the re-render reflects the new order before the round-trip.
    for (const e of entries) {
        const c = owCategories.find(x => x.id === e.id);
        if (c) c.sortOrder = e.sortOrder;
    }
    owRender();

    try {
        await apiFetch('/api/office-work', {
            method: 'POST',
            body: JSON.stringify({ action: 'reorder', entries }),
        });
        await loadOfficeWork();
    } catch (err) {
        showToast('Could not save reorder', 'error');
        await loadOfficeWork();
    }
}

function owFindHabitById(id) {
    const list = (typeof habits !== 'undefined' && Array.isArray(habits)) ? habits : [];
    return list.find(h => h.id === id) || null;
}

// ==================== SESSIONS LIST ====================
function owSetSessionsRange(range) {
    owSessionsRange = parseInt(range) || 30;
    document.querySelectorAll('.ow-sessions-range-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.range === String(owSessionsRange));
    });
    owRenderSessionsList();
}

function owRenderSessionsList() {
    const el = document.getElementById('owSessionsList');
    if (!el) return;
    if (!owCategories.length) {
        el.innerHTML = '<div class="empty-state"><p>Add a category first.</p></div>';
        return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - owSessionsRange);
    const cutoffStr = cutoff.toLocaleDateString('en-CA');
    const list = owSessions.filter(s => s.date >= cutoffStr).slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

    if (!list.length) {
        el.innerHTML = '<div class="empty-state"><p>No sessions in the last ' + owSessionsRange + ' days.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="owOpenSessionModal()">+ Add Session</button></div>';
        return;
    }

    const catMap = Object.fromEntries(owCategories.map(c => [c.id, c]));
    const groups = {};
    for (const s of list) {
        groups[s.date] = groups[s.date] || [];
        groups[s.date].push(s);
    }
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    let html = '';
    for (const date of dates) {
        const dayList = groups[date];
        const dayTotal = dayList.reduce((sum, s) => sum + (s.durationSec || 0), 0);
        const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        html += '<div style="margin-bottom:14px;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 4px;border-bottom:1px solid var(--gray-200);margin-bottom:6px;"><strong style="font-size:13px;color:var(--gray-700);">${dateLabel}</strong><span style="font-size:12px;color:var(--gray-500);">${owFormatMin(dayTotal)}</span></div>`;
        for (const s of dayList) {
            const cat = catMap[s.categoryId];
            const catName = cat ? cat.name : '(deleted category)';
            const catColor = cat ? (cat.color || OW_DEFAULT_COLOR) : 'var(--gray-300)';
            const start = new Date(s.startedAt);
            const end = new Date(s.endedAt);
            const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--gray-100);">';
            html += `<div style="width:4px;height:32px;background:${catColor};border-radius:2px;flex-shrink:0;"></div>`;
            html += '<div style="flex:1;min-width:0;">';
            html += `<div style="font-size:13px;font-weight:600;">${esc(catName)}</div>`;
            html += `<div style="font-size:11px;color:var(--gray-500);">${fmtTime(start)} – ${fmtTime(end)}`;
            if (s.notes) html += ` &middot; ${esc(s.notes)}`;
            html += '</div></div>';
            html += `<div style="font-size:13px;font-variant-numeric:tabular-nums;color:var(--gray-700);font-weight:600;min-width:50px;text-align:right;">${owFormatMin(s.durationSec || 0)}</div>`;
            html += `<button class="btn btn-secondary btn-sm" onclick="owOpenSessionModal('${s.id}')" title="Edit">&#9881;</button>`;
            html += '</div>';
        }
        html += '</div>';
    }

    el.innerHTML = html;
}

// ==================== SESSION MODAL ====================
// presetGoalId (optional, new sessions only): pre-selects the goal dropdown —
// used by the Intention Kanban "⏱+" / goal-modal "+ Add session" shortcuts.
function owOpenSessionModal(sessionId, presetGoalId) {
    const modal = document.getElementById('owSessionModal');
    if (!modal) return;

    // Populate category dropdown
    const catSelect = document.getElementById('owSessionCatInput');
    catSelect.innerHTML = owCategories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    // v4.6.8: populate the optional goal dropdown from intGoals (loaded eagerly).
    const goalSelect = document.getElementById('owSessionGoalInput');
    if (goalSelect && typeof intGoals !== 'undefined') {
        goalSelect.innerHTML = '<option value="">— None —</option>' + intGoals
            .filter(g => g.status !== 'dropped')
            .sort((a, b) => {
                const order = { quarterly: 0, yearly: 1, weekly: 2, daily: 3 };
                return (order[a.horizon] ?? 9) - (order[b.horizon] ?? 9);
            })
            .map(g => `<option value="${esc(g.id)}">${esc(owGoalOptionLabel(g))}</option>`)
            .join('');
    }

    const titleEl = document.getElementById('owSessionModalTitle');
    const deleteBtn = document.getElementById('owDeleteSessionBtn');
    const idInput = document.getElementById('owSessionIdInput');
    const dateInput = document.getElementById('owSessionDateInput');
    const startInput = document.getElementById('owSessionStartInput');
    const durInput = document.getElementById('owSessionDurationInput');
    const notesInput = document.getElementById('owSessionNotesInput');

    if (sessionId) {
        const s = owSessions.find(x => x.id === sessionId);
        if (!s) return;
        titleEl.textContent = 'Edit Session';
        idInput.value = s.id;
        catSelect.value = s.categoryId;
        if (goalSelect) goalSelect.value = s.goalId || '';
        const start = new Date(s.startedAt);
        dateInput.value = s.date;
        startInput.value = String(start.getHours()).padStart(2, '0') + ':' + String(start.getMinutes()).padStart(2, '0');
        durInput.value = Math.round((s.durationSec || 0) / 60);
        notesInput.value = s.notes || '';
        deleteBtn.style.display = '';
    } else {
        titleEl.textContent = 'Add Session';
        idInput.value = '';
        if (goalSelect) goalSelect.value = presetGoalId || '';
        // Default: today, an hour ago, 30min, no notes
        const now = new Date();
        const startGuess = new Date(now.getTime() - 30 * 60000);
        dateInput.value = now.toLocaleDateString('en-CA');
        startInput.value = String(startGuess.getHours()).padStart(2, '0') + ':' + String(startGuess.getMinutes()).padStart(2, '0');
        durInput.value = 30;
        notesInput.value = '';
        deleteBtn.style.display = 'none';
    }
    modal.style.display = 'flex';
}

function owCloseSessionModal() {
    const modal = document.getElementById('owSessionModal');
    if (modal) modal.style.display = 'none';
}

async function owSaveSession() {
    const id = document.getElementById('owSessionIdInput').value || null;
    const categoryId = document.getElementById('owSessionCatInput').value;
    const date = document.getElementById('owSessionDateInput').value;
    const startTime = document.getElementById('owSessionStartInput').value;
    const durationMin = parseInt(document.getElementById('owSessionDurationInput').value) || 0;
    const notes = (document.getElementById('owSessionNotesInput').value || '').trim();

    if (!categoryId) { showToast('Pick a category.', 'error'); return; }
    if (!date || !startTime) { showToast('Date and start time are required.', 'error'); return; }
    if (durationMin <= 0) { showToast('Duration must be at least 1 minute.', 'error'); return; }

    // Build local-time ISO timestamps
    const [hh, mm] = startTime.split(':').map(n => parseInt(n) || 0);
    const startDate = new Date(date + 'T00:00:00');
    startDate.setHours(hh, mm, 0, 0);
    const durationSec = durationMin * 60;
    const endDate = new Date(startDate.getTime() + durationSec * 1000);

    const goalEl = document.getElementById('owSessionGoalInput');
    const goalId = goalEl ? (goalEl.value || '') : '';
    const payload = {
        action: id ? 'update-session' : 'log-session',
        id,
        categoryId,
        goalId,
        date,
        startedAt: startDate.toISOString(),
        endedAt: endDate.toISOString(),
        durationSec,
        notes,
    };

    try {
        await apiFetch('/api/office-work', { method: 'POST', body: JSON.stringify(payload) });
        showToast(id ? 'Session updated.' : 'Session added.', 'success');
        owCloseSessionModal();
        await loadOfficeWork();
        // Goal-tagged minutes surface on Intention cards (Kanban ⏱ chips) —
        // re-render so a session added from there shows up immediately.
        if (typeof renderIntention === 'function') renderIntention();
    } catch (e) {
        showToast('Failed to save: ' + (e.message || 'unknown'), 'error');
    }
}

async function owDeleteSession() {
    const id = document.getElementById('owSessionIdInput').value;
    if (!id) return;
    if (!confirm('Delete this session?')) return;
    try {
        await apiFetch('/api/office-work', {
            method: 'POST',
            body: JSON.stringify({ action: 'delete-session', id }),
        });
        showToast('Session deleted.', 'success');
        owCloseSessionModal();
        await loadOfficeWork();
        if (typeof renderIntention === 'function') renderIntention();
    } catch (e) {
        showToast('Failed to delete: ' + (e.message || 'unknown'), 'error');
    }
}

// ==================== ANALYTICS ====================
function owSetRange(range) {
    owRange = range;
    document.querySelectorAll('.ow-range-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.range === range);
    });
    owRenderAnalytics();
}

function owSetFilter(kind) {
    owKindFilter = kind;
    document.querySelectorAll('.ow-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.kind === kind);
    });
    owRenderCategoryList();
}

function owRenderAnalytics() {
    const el = document.getElementById('owAnalytics');
    if (!el) return;
    if (!owCategories.length) {
        el.innerHTML = '<div class="empty-state"><p>Add a category and start tracking to see analytics.</p></div>';
        return;
    }

    const days = owRange === 'month' ? 30 : 7;
    const today = new Date();
    const dateList = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateList.push(d.toLocaleDateString('en-CA'));
    }

    // sessions in window, grouped by date+categoryId
    const startDate = dateList[0];
    const inWindow = owSessions.filter(s => s.date >= startDate);
    const byDateCat = {};
    for (const s of inWindow) {
        byDateCat[s.date] = byDateCat[s.date] || {};
        byDateCat[s.date][s.categoryId] = (byDateCat[s.date][s.categoryId] || 0) + (s.durationSec || 0);
    }

    // Per-category totals over window
    const catTotals = {};
    for (const s of inWindow) {
        catTotals[s.categoryId] = (catTotals[s.categoryId] || 0) + (s.durationSec || 0);
    }
    const totalSec = Object.values(catTotals).reduce((a, b) => a + b, 0);
    const studySec = owCategories.filter(c => c.kind === 'study').reduce((a, c) => a + (catTotals[c.id] || 0), 0);
    const workSec = owCategories.filter(c => c.kind === 'work').reduce((a, c) => a + (catTotals[c.id] || 0), 0);

    let html = '';

    // Top stats
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px;">';
    html += `<div class="stat-card"><div class="stat-label">Total ${owRange === 'month' ? '(30d)' : '(7d)'}</div><div class="stat-value">${owFormatMin(totalSec)}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Study</div><div class="stat-value" style="color:#10b981;">${owFormatMin(studySec)}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Work</div><div class="stat-value" style="color:#3b82f6;">${owFormatMin(workSec)}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Daily avg</div><div class="stat-value">${owFormatMin(totalSec / days)}</div></div>`;
    html += '</div>';

    // Per-category bar chart (totals over window)
    html += '<div style="margin-bottom:20px;">';
    html += '<h3 style="font-size:14px;margin-bottom:10px;color:var(--gray-600);">By Category</h3>';
    const catList = owCategories
        .map(c => ({ ...c, total: catTotals[c.id] || 0 }))
        .sort((a, b) => b.total - a.total);
    const maxCat = Math.max(1, ...catList.map(c => c.total));
    if (catList.every(c => c.total === 0)) {
        html += '<p style="font-size:13px;color:var(--gray-400);">No sessions yet in this range.</p>';
    } else {
        for (const c of catList) {
            const pct = (c.total / maxCat) * 100;
            html += '<div style="margin-bottom:8px;">';
            html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">';
            html += `<span>${esc(c.name)}</span><span style="color:var(--gray-500);">${owFormatMin(c.total)}</span>`;
            html += '</div>';
            html += `<div style="height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden;"><div style="height:100%;background:${c.color || OW_DEFAULT_COLOR};width:${pct.toFixed(1)}%;"></div></div>`;
            html += '</div>';
        }
    }
    html += '</div>';

    // By Venture — aggregates each category's totals by its assigned ventures.
    // v4.6.9 follow-up: multi-venture-aware. A category tagged to JADI + IT
    // counts its time toward *each* venture (not split, not first-only) — the
    // semantic is "time spent on work that served this venture", not "time
    // allocated exclusively to this venture", since the same hour can serve
    // both. Categories with no venture contribute to the "— Personal —" bucket.
    // Only renders if at least one category has a venture assigned (avoids a
    // useless "— Personal —" single-bar chart while every category is unassigned).
    const anyVenture = owCategories.some(c => owCategoryVentureIds(c).length > 0);
    if (anyVenture && typeof intVentures !== 'undefined') {
        const venTotals = {};
        for (const c of owCategories) {
            const ids = owCategoryVentureIds(c);
            const catTotal = catTotals[c.id] || 0;
            if (ids.length === 0) {
                venTotals[''] = (venTotals[''] || 0) + catTotal;
            } else {
                for (const vid of ids) {
                    venTotals[vid] = (venTotals[vid] || 0) + catTotal;
                }
            }
        }
        const venRows = Object.entries(venTotals)
            .filter(([, total]) => total > 0)
            .map(([vid, total]) => {
                const v = intVentures.find(x => x.id === vid);
                return {
                    id: vid,
                    name: v ? ((v.icon ? v.icon + ' ' : '') + v.name) : '— Personal —',
                    color: v ? (v.color || OW_DEFAULT_COLOR) : '#9ca3af',
                    total,
                };
            })
            .sort((a, b) => b.total - a.total);
        const maxVen = Math.max(1, ...venRows.map(v => v.total));

        html += '<div style="margin-bottom:20px;">';
        html += '<h3 style="font-size:14px;margin-bottom:10px;color:var(--gray-600);">By Venture</h3>';
        if (venRows.length === 0) {
            html += '<p style="font-size:13px;color:var(--gray-400);">No sessions yet in this range.</p>';
        } else {
            for (const r of venRows) {
                const pct = (r.total / maxVen) * 100;
                html += '<div style="margin-bottom:8px;">';
                html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">';
                html += `<span>${esc(r.name)}</span><span style="color:var(--gray-500);">${owFormatMin(r.total)}</span>`;
                html += '</div>';
                html += `<div style="height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden;"><div style="height:100%;background:${r.color};width:${pct.toFixed(1)}%;"></div></div>`;
                html += '</div>';
            }
        }
        html += '</div>';
    }

    // Daily stacked bars
    html += '<div>';
    html += `<h3 style="font-size:14px;margin-bottom:10px;color:var(--gray-600);">Daily (last ${days} days)</h3>`;
    html += owBuildDailyStackedSVG(dateList, byDateCat);
    html += '</div>';

    el.innerHTML = html;
}

function owBuildDailyStackedSVG(dateList, byDateCat) {
    const W = 600;
    const H = 160;
    const PAD_L = 36, PAD_R = 8, PAD_T = 8, PAD_B = 28;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const n = dateList.length;
    const barW = (plotW / n) * 0.7;
    const gap = (plotW / n) * 0.3;

    // Daily totals
    const dayTotals = dateList.map(d => {
        const map = byDateCat[d] || {};
        return Object.values(map).reduce((a, b) => a + b, 0);
    });
    const maxDay = Math.max(1, ...dayTotals);
    // Round up to nearest hour for nicer y-axis
    const maxHours = Math.max(1, Math.ceil(maxDay / 3600));
    const yMaxSec = maxHours * 3600;

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:200px;" preserveAspectRatio="xMidYMid meet">`;

    // y-axis grid lines (every hour up to maxHours, capped at 4 lines)
    const stepHours = maxHours <= 4 ? 1 : Math.ceil(maxHours / 4);
    for (let h = 0; h <= maxHours; h += stepHours) {
        const y = PAD_T + plotH - (h / maxHours) * plotH;
        svg += `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="var(--gray-200)" stroke-width="1"/>`;
        svg += `<text x="${PAD_L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--gray-400)">${h}h</text>`;
    }

    // Bars (stacked by category)
    for (let i = 0; i < dateList.length; i++) {
        const x = PAD_L + i * (barW + gap) + gap / 2;
        const map = byDateCat[dateList[i]] || {};
        let yCursor = PAD_T + plotH;
        for (const c of owCategories) {
            const sec = map[c.id] || 0;
            if (sec <= 0) continue;
            const segH = (sec / yMaxSec) * plotH;
            yCursor -= segH;
            svg += `<rect x="${x.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${c.color || OW_DEFAULT_COLOR}"><title>${esc(c.name)}: ${owFormatMin(sec)} on ${dateList[i]}</title></rect>`;
        }
        // Date label (every other day if range >7)
        if (n <= 7 || i % Math.ceil(n / 7) === 0) {
            const d = new Date(dateList[i] + 'T00:00:00');
            const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="var(--gray-500)">${label}</text>`;
        }
    }

    svg += '</svg>';
    return svg;
}

// ==================== TIMER CONTROL ====================
function owStartTimer(categoryId, goalId) {
    if (owGetActive()) {
        showToast('Stop the current timer first.', 'error');
        return;
    }
    const now = new Date().toISOString();
    // goalId is optional — the active timer banner exposes a dropdown to set
    // or change it mid-session via owActiveGoalChange().
    owSetActive({ categoryId, goalId: goalId || '', runStartedAt: now, accumulatedSec: 0, paused: false, beganAt: now });
    owRender();
    owStartTimerLoopIfNeeded();
}

function owPauseToggle() {
    const state = owGetActive();
    if (!state) return;
    if (state.paused) {
        // Resume
        state.paused = false;
        state.runStartedAt = new Date().toISOString();
        owSetActive(state);
        owStartTimerLoopIfNeeded();
    } else {
        // Pause — bank elapsed time
        const elapsed = owElapsedSec(state);
        state.accumulatedSec = elapsed;
        state.paused = true;
        owSetActive(state);
    }
    owRender();
}

async function owStopTimer() {
    const state = owGetActive();
    if (!state) return;
    const totalSec = owElapsedSec(state);
    const cat = owCategories.find(c => c.id === state.categoryId);
    const goalId = state.goalId || '';
    const endedAt = new Date().toISOString();
    const startedAt = state.beganAt || state.runStartedAt;
    const date = new Date(endedAt).toLocaleDateString('en-CA');

    owSetActive(null);
    owStopTimerLoop();
    try { localStorage.setItem('guru-hdr-last-stop', endedAt); } catch { /* ignore */ }

    if (totalSec < 5) {
        // Discard trivial sessions
        showToast('Timer stopped (under 5s — not logged).', 'info');
        owRender();
        return;
    }

    let logged = false;
    const willAutonav = !!goalId;
    try {
        await apiFetch('/api/office-work', {
            method: 'POST',
            body: JSON.stringify({
                action: 'log-session',
                categoryId: state.categoryId,
                goalId,
                startedAt,
                endedAt,
                durationSec: totalSec,
                date,
            }),
        });
        // The success toast is shown later for goal-tagged sessions so it can
        // include the "Stay here" undo. Plain sessions get the existing toast
        // immediately.
        if (!willAutonav) {
            showToast(`Logged ${owFormatMin(totalSec)} for ${cat ? cat.name : 'session'}.`, 'success');
        }
        logged = true;
    } catch (e) {
        showToast('Failed to save session: ' + (e.message || 'unknown'), 'error');
    }

    // Auto-complete linked habit on stop (only if not already done today)
    if (cat && cat.linkedHabitId && typeof habits !== 'undefined') {
        const h = habits.find(x => x.id === cat.linkedHabitId);
        if (h && h.status === 'active' && !isHabitDone(h)) {
            try { await toggleHabit(cat.linkedHabitId, false); } catch { /* ignore */ }
        }
    }

    await loadOfficeWork();

    // If the session was tagged to a goal, fly the user to Intention's Kanban
    // view so they see the goal the minutes just landed on. We delay the
    // actual nav by 2.5s and show an inline "Stay here" undo on the success
    // toast — gives the user a brief window to abort if they want to stay on
    // Office Work (e.g. chained back-to-back timers on the same category).
    if (logged && willAutonav && typeof switchTab === 'function' && typeof intSetViewMode === 'function') {
        let cancelled = false;
        showToast(
            `Logged ${owFormatMin(totalSec)} → Intention Kanban…`,
            'success',
            { label: 'Stay here', onClick: () => { cancelled = true; } }
        );
        setTimeout(() => {
            if (cancelled) return;
            intSetViewMode('kanban');
            switchTab('intention');
        }, 2500);
    }
}

function owStartTimerLoopIfNeeded() {
    const state = owGetActive();
    if (!state || state.paused) {
        owStopTimerLoop();
        return;
    }
    if (owTimerInterval) return;
    owTimerInterval = setInterval(() => {
        const s = owGetActive();
        if (!s || s.paused) { owStopTimerLoop(); return; }
        const elapsed = owElapsedSec(s);
        const display = owFormatHMS(elapsed);
        const main = document.getElementById('owActiveDisplay');
        if (main) main.textContent = display;
        document.querySelectorAll(`[data-ow-live="${s.categoryId}"]`).forEach(n => { n.textContent = display; });
    }, 1000);
}

function owStopTimerLoop() {
    if (owTimerInterval) {
        clearInterval(owTimerInterval);
        owTimerInterval = null;
    }
}

// ==================== CATEGORY MODAL ====================
let owEditingCatId = null;
let owSelectedColor = OW_DEFAULT_COLOR;

async function owOpenCategoryModal(catId) {
    const modal = document.getElementById('owCategoryModal');
    if (!modal) return;
    owEditingCatId = catId || null;

    // Populate habit dropdown from currently loaded habits.
    // habits[] is populated by loadHabits() which only runs on first Habits-tab
    // visit. If the user opens this modal without ever visiting Habits, the
    // array is empty and the dropdown shows zero options — lazy-load so the
    // first open always has habits available.
    const habitSelect = document.getElementById('owCatHabitInput');
    if (habitSelect) {
        const needsLoad = typeof habits === 'undefined' || !Array.isArray(habits) || habits.length === 0;
        if (needsLoad && typeof loadHabits === 'function') {
            try { await loadHabits(); } catch { /* fall through to empty list */ }
        }
        const list = (typeof habits !== 'undefined' && Array.isArray(habits)) ? habits.filter(h => h.status === 'active') : [];
        habitSelect.innerHTML = '<option value="">— None —</option>' + list.map(h => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('');
    }

    const titleEl = document.getElementById('owCategoryModalTitle');
    const deleteBtn = document.getElementById('owDeleteCatBtn');

    let prefilledVentures;     // Set<string> — ids to check on initial render
    if (catId) {
        const c = owCategories.find(x => x.id === catId);
        if (!c) return;
        if (titleEl) titleEl.textContent = 'Edit Category';
        document.getElementById('owCatIdInput').value = c.id;
        document.getElementById('owCatNameInput').value = c.name;
        document.getElementById('owCatKindInput').value = c.kind || 'work';
        if (habitSelect) habitSelect.value = c.linkedHabitId || '';
        prefilledVentures = new Set(owCategoryVentureIds(c));
        owSelectedColor = c.color || OW_DEFAULT_COLOR;
        if (deleteBtn) deleteBtn.style.display = '';
    } else {
        if (titleEl) titleEl.textContent = 'Add Category';
        document.getElementById('owCatIdInput').value = '';
        document.getElementById('owCatNameInput').value = '';
        document.getElementById('owCatKindInput').value = 'work';
        if (habitSelect) habitSelect.value = '';
        // Pre-check the active venture so adding a category while filtered to a venture tags it.
        const initialVenture = (typeof intActiveVentureId !== 'undefined') ? intActiveVentureId : '';
        prefilledVentures = new Set(initialVenture ? [initialVenture] : []);
        owSelectedColor = OW_DEFAULT_COLOR;
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    owRenderCategoryVentureChips(prefilledVentures);
    owSelectColor(owSelectedColor);
    modal.style.display = 'flex';
}

// v4.6.9 follow-up: render the multi-venture chip group inside the category
// modal. Same UX as the goal modal's venture picker — pill labels that light
// up in the venture's color when checked. Empty list = "personal" category.
function owRenderCategoryVentureChips(checkedIds) {
    const list = document.getElementById('owCatVentureList');
    if (!list) return;
    const ventures = (typeof intVentures !== 'undefined' && Array.isArray(intVentures)) ? intVentures : [];
    if (ventures.length === 0) {
        list.innerHTML = '<span style="color:var(--gray-400);font-size:12px;padding:4px;">No ventures yet — this category will be personal.</span>';
        return;
    }
    const order = { active: 0, paused: 1, archived: 2 };
    const sorted = [...ventures].sort((a, b) => (order[a.status] || 3) - (order[b.status] || 3));
    list.innerHTML = sorted.map(v => {
        const color = v.color || '#3b82f6';
        const isChecked = checkedIds.has(v.id);
        return `<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid ${isChecked ? color : 'var(--gray-200)'};border-radius:999px;background:${isChecked ? color + '15' : 'white'};cursor:pointer;font-size:12px;">
            <input type="checkbox" class="ow-cat-venture-cb" value="${esc(v.id)}" ${isChecked ? 'checked' : ''} onchange="owCatVentureCbChange(this, '${esc(color)}')" style="width:14px;height:14px;cursor:pointer;">
            <span style="color:${isChecked ? color : 'var(--gray-700)'};font-weight:${isChecked ? '600' : '500'};">${v.icon ? esc(v.icon) + ' ' : ''}${esc(v.name)}${v.status !== 'active' ? ` <span style="opacity:0.6;">(${esc(v.status)})</span>` : ''}</span>
        </label>`;
    }).join('');
}

// Visual flip on the chip wrapper when a venture checkbox toggles.
// Same shape as intGoalVentureCbChange in guru-intention.js.
function owCatVentureCbChange(cb, color) {
    const label = cb.closest('label');
    if (!label) return;
    if (cb.checked) {
        label.style.borderColor = color;
        label.style.background = color + '15';
        const span = label.querySelector('span');
        if (span) { span.style.color = color; span.style.fontWeight = '600'; }
    } else {
        label.style.borderColor = 'var(--gray-200)';
        label.style.background = 'white';
        const span = label.querySelector('span');
        if (span) { span.style.color = 'var(--gray-700)'; span.style.fontWeight = '500'; }
    }
}

// Parse a category's stored ventures. Falls back to the singular ventureId
// when ventureIds is empty for older rows pre-v4.6.9-followup.
function owCategoryVentureIds(c) {
    if (!c) return [];
    if (c.ventureIds && String(c.ventureIds).trim()) {
        return String(c.ventureIds).split(',').map(s => s.trim()).filter(Boolean);
    }
    return c.ventureId ? [c.ventureId] : [];
}

function owCloseCategoryModal() {
    const modal = document.getElementById('owCategoryModal');
    if (modal) modal.style.display = 'none';
    owEditingCatId = null;
}

function owSelectColor(color) {
    owSelectedColor = color;
    document.querySelectorAll('#owColorPicker .ms-color-btn').forEach(b => {
        b.style.outline = b.dataset.color === color ? '2px solid var(--gray-700)' : 'none';
        b.style.outlineOffset = '2px';
    });
}

async function owSaveCategory() {
    const id = document.getElementById('owCatIdInput').value || null;
    const name = (document.getElementById('owCatNameInput').value || '').trim();
    const kind = document.getElementById('owCatKindInput').value;
    const linkedHabitId = document.getElementById('owCatHabitInput').value || '';
    // v4.6.9 follow-up: ventureIds replaces the single ventureId. API keeps
    // ventureId in sync with the first item for back-compat.
    const ventureIds = [...document.querySelectorAll('.ow-cat-venture-cb:checked')].map(cb => cb.value);
    if (!name) { showToast('Name is required.', 'error'); return; }

    const sortOrder = id
        ? (owCategories.find(c => c.id === id)?.sortOrder || 0)
        : owCategories.length;

    try {
        await apiFetch('/api/office-work', {
            method: 'POST',
            body: JSON.stringify({
                action: 'save-category',
                id,
                name,
                kind,
                color: owSelectedColor,
                linkedHabitId,
                ventureIds,
                sortOrder,
            }),
        });
        showToast(id ? 'Category updated.' : 'Category added.', 'success');
        owCloseCategoryModal();
        await loadOfficeWork();
    } catch (e) {
        showToast('Failed to save: ' + (e.message || 'unknown'), 'error');
    }
}

async function owDeleteCategory() {
    const id = document.getElementById('owCatIdInput').value;
    if (!id) return;
    if (!confirm('Archive this category? Past sessions are kept for analytics.')) return;
    // If active timer is on this category, stop it (without logging — user is deleting)
    const state = owGetActive();
    if (state && state.categoryId === id) {
        owSetActive(null);
        owStopTimerLoop();
    }
    try {
        await apiFetch('/api/office-work', {
            method: 'POST',
            body: JSON.stringify({ action: 'delete-category', id }),
        });
        showToast('Category archived.', 'success');
        owCloseCategoryModal();
        await loadOfficeWork();
    } catch (e) {
        showToast('Failed to archive: ' + (e.message || 'unknown'), 'error');
    }
}

// Resume timer loop on page load if there's an active timer
window.addEventListener('load', () => {
    if (owGetActive()) owStartTimerLoopIfNeeded();
});
