/* ==========================================================================
   Guru Dashboard — Intention Module
   Personal goal tracking: daily / weekly / quarterly / yearly, scoped by venture.
   API: /api/intention   (single endpoint, action-based POST — see functions/api/intention.js)
   Plan: docs/intention.md
   ========================================================================== */

// ──────────────── state ────────────────

let intVentures = [];
let intGoals = [];
let intRecentCheckins = [];     // last 90 days
let intTodayCheckinsByGoal = new Map();   // goalId → { c, v }
let intLinkedHabits = [];       // habits with goalId set (subset, payload-tight)
let intLinkedTodos = [];        // todos with goalId set (subset, payload-tight)
let intPeriods = { today: '', weekStart: '', quarterStart: '' };

// Active venture filter (persists per-browser). '' = all ventures.
let intActiveVentureId = (typeof localStorage !== 'undefined' && localStorage.getItem('int-active-venture')) || '';

// ──────────────── load ────────────────

// Mobile rail toggle — collapses the Ventures + Actions left rail on phones
// (default: collapsed). Desktop is unaffected; the button itself is hidden via
// a `display:none` CSS rule and only flipped on by the mobile media query.
function intInitRailState() {
    try {
        const saved = localStorage.getItem('int-rail-open');
        if (saved === '1') document.body.classList.add('int-rail-open');
        else document.body.classList.remove('int-rail-open');
    } catch (_) { /* localStorage blocked */ }
    intUpdateRailToggleLabel();
}

function intToggleRail() {
    const open = document.body.classList.toggle('int-rail-open');
    try { localStorage.setItem('int-rail-open', open ? '1' : '0'); } catch (_) { /* */ }
    intUpdateRailToggleLabel();
}

function intUpdateRailToggleLabel() {
    const btn = document.getElementById('intRailToggle');
    if (!btn) return;
    const open = document.body.classList.contains('int-rail-open');
    btn.innerHTML = open ? '✕ Hide filters' : '☰ Filters';
}

// Mobile FAB → open the goal modal pre-set to the current view's horizon.
// The user can still change horizon in the modal; this is just a sensible
// default that matches what they're looking at when they tap "+".
function intMobileQuickGoal() {
    const horizonByView = { horizons: 'daily', kanban: 'weekly', year: 'yearly' };
    const horizon = horizonByView[_intViewMode] || 'weekly';
    intOpenGoalModal(horizon);
}

async function loadIntention() {
    intInitRailState();
    try {
        const today = new Date().toISOString().slice(0, 10);
        // apiFetch returns the parsed JSON body for ONLINE_ONLY endpoints
        // (which /api/intention is). It throws on non-2xx, so we don't need
        // to inspect a Response object — the response is already the data.
        const data = await apiFetch(`/api/intention?today=${today}`);

        intVentures = data.ventures || [];
        intGoals = data.goals || [];
        intRecentCheckins = data.recentCheckins || [];
        intLinkedHabits = data.linkedHabits || [];
        intLinkedTodos = data.linkedTodos || [];
        intPeriods = data.periods || intPeriods;

        intTodayCheckinsByGoal = new Map();
        for (const row of (data.todayCheckins || [])) {
            intTodayCheckinsByGoal.set(row.goalId, { c: row.c, v: row.v });
        }

        // If the active venture no longer exists (deleted / archived to empty list),
        // fall back to "All".
        if (intActiveVentureId && !intVentures.some(v => v.id === intActiveVentureId)) {
            intActiveVentureId = '';
            try { localStorage.removeItem('int-active-venture'); } catch (_) { /* ignore */ }
        }

        renderIntention();
        renderDashVentureChips();
        // The dashboard widgets share this data; refresh them if present.
        if (typeof renderTodayGoalsWidget === 'function') renderTodayGoalsWidget();
        if (typeof renderDashThisWeek === 'function') renderDashThisWeek();
        // _todosCache may have arrived before intGoals/intVentures; re-render todos so the chips show.
        if (typeof renderTodoList === 'function' && Array.isArray(_todosCache) && _todosCache.length) renderTodoList(_todosCache);
    } catch (err) {
        console.debug('[intention] load failed', err);
        const list = document.getElementById('intQuarterList');
        if (list) list.innerHTML = '<div class="empty-state"><p>Could not load. Try refreshing.</p></div>';
    }
}

// ──────────────── helpers ────────────────

function intVentureById(id) {
    if (!id) return null;
    return intVentures.find(v => v.id === id) || null;
}

function intGoalsForActiveScope() {
    if (!intActiveVentureId) return intGoals;
    // Multi-venture-aware: a goal belongs to the active scope if its
    // ventureIds list contains the active venture (or via the singular
    // ventureId fallback for older rows pre-v4.6.7).
    return intGoals.filter(g => intGoalMatchesVenture(g, intActiveVentureId));
}

function intGoalsByHorizon(horizon) {
    return intGoalsForActiveScope().filter(g => g.horizon === horizon && g.status !== 'dropped' && !g.archived);
}

function intIsCheckedToday(goalId) {
    return intTodayCheckinsByGoal.has(goalId);
}

// Meta-streak: consecutive days (counting back from today) where at least one
// daily-horizon goal got a checkin. Walks the in-memory recentCheckins (90d).
// Today is allowed to be empty without breaking the streak (so opening before
// checking off shows the existing streak rather than zeroing it prematurely).
function intDailyMetaStreak() {
    const dailyGoalIds = new Set(intGoals.filter(g => g.horizon === 'daily').map(g => g.id));
    if (dailyGoalIds.size === 0) return 0;
    const datesWithDaily = new Set(
        intRecentCheckins
            .filter(c => dailyGoalIds.has(c.goalId))
            .map(c => c.date)
    );
    if (datesWithDaily.size === 0) return 0;

    const today = intPeriods.today || new Date().toISOString().slice(0, 10);
    let streak = 0;
    const cursor = new Date(today + 'T12:00:00');
    // If today is empty, allow it once (don't break) — same UX as habit streaks.
    const allowEmptyToday = !datesWithDaily.has(today);

    for (let i = 0; i < 365; i++) {
        const ds = cursor.toISOString().slice(0, 10);
        if (datesWithDaily.has(ds)) {
            streak += 1;
        } else if (i === 0 && allowEmptyToday) {
            // today's gap is forgiven once
        } else {
            break;
        }
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

function intEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ──────────────── render ────────────────

function renderIntention() {
    renderIntentionVentureRail();
    renderIntentionList('intQuarterList', 'quarterly');
    renderIntentionList('intWeekList', 'weekly');
    renderIntentionList('intTodayList', 'daily');

    // Apply current view mode — also handles display:flex/block toggling for the
    // three view containers and re-renders the active alternate view so a
    // venture-chip change is reflected immediately.
    intApplyViewMode();

    const lbl = document.getElementById('intActiveVentureLabel');
    if (lbl) {
        const v = intVentureById(intActiveVentureId);
        const streak = intDailyMetaStreak();
        const streakStr = streak > 0 ? ` · ${streak}-day streak 🔥` : '';
        lbl.textContent = (v ? `Scoped to: ${v.name}` : 'All ventures') + streakStr;
    }
}

function renderIntentionVentureRail() {
    const root = document.getElementById('intVentureList');
    if (!root) return;

    const items = [];
    items.push(`
        <div class="int-venture-row ${!intActiveVentureId ? 'active' : ''}"
             onclick="intSetActiveVenture('')"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;background:${!intActiveVentureId ? '#f0f9ff' : 'transparent'};">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--gray-300);"></span>
            <span style="flex:1;font-weight:${!intActiveVentureId ? '600' : '500'};">All</span>
        </div>`);

    const active = intVentures.filter(v => v.status === 'active');
    const paused = intVentures.filter(v => v.status === 'paused');
    const archived = intVentures.filter(v => v.status === 'archived');

    const renderRow = (v) => `
        <div class="int-venture-row ${intActiveVentureId === v.id ? 'active' : ''}"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;background:${intActiveVentureId === v.id ? '#f0f9ff' : 'transparent'};opacity:${v.status === 'archived' ? '0.5' : '1'};"
             onclick="intSetActiveVenture('${v.id}')">
            <span style="width:10px;height:10px;border-radius:50%;background:${intEscape(v.color || '#3b82f6')};"></span>
            <span style="flex:1;font-weight:${intActiveVentureId === v.id ? '600' : '500'};">${v.icon ? intEscape(v.icon) + ' ' : ''}${intEscape(v.name)}</span>
            <button onclick="event.stopPropagation();intOpenVentureModal('${v.id}')"
                    style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;padding:0 4px;">✎</button>
        </div>`;

    if (active.length) {
        items.push('<div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px 4px;">Active</div>');
        for (const v of active) items.push(renderRow(v));
    }
    if (paused.length) {
        items.push('<div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px 4px;">Paused</div>');
        for (const v of paused) items.push(renderRow(v));
    }
    if (archived.length) {
        items.push('<div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px 4px;">Archived</div>');
        for (const v of archived) items.push(renderRow(v));
    }

    if (active.length + paused.length + archived.length === 0) {
        items.push('<div class="empty-state" style="padding:8px;"><p style="font-size:13px;margin:0;color:var(--gray-400);">No ventures yet. Add one to scope goals to a project.</p></div>');
    }

    root.innerHTML = items.join('');
}

function renderIntentionList(containerId, horizon) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const goals = intGoalsByHorizon(horizon);

    if (goals.length === 0) {
        root.innerHTML = `<div class="empty-state"><p style="margin:0;color:var(--gray-400);">No ${horizon} goals yet.</p></div>`;
        return;
    }

    // Sort by current sortOrder so drag-reorder takes effect on subsequent renders.
    const sorted = [...goals].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    root.innerHTML = sorted.map(g => renderGoalCard(g)).join('');
    root.dataset.horizon = horizon;
    intAttachDragHandlers(root);
}

// Drag-to-reorder for the goal-card list. Native HTML5 DnD on each `.int-goal-card`
// element; the drop target is the .int-goal-card we're hovering over (insertion
// happens above it). On drop, sortOrder is recalculated as the new array index
// and POSTed via the existing `reorder-goals` action shipped in v4.6.0.
function intAttachDragHandlers(root) {
    const cards = root.querySelectorAll('.int-goal-card');
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.goalId);
            card.style.opacity = '0.4';
        });
        card.addEventListener('dragend', () => {
            card.style.opacity = '';
            // Clear any leftover indicator from siblings.
            root.querySelectorAll('.int-goal-card').forEach(c => { c.style.borderTopColor = ''; c.style.borderTopWidth = ''; c.style.borderTopStyle = ''; });
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Subtle blue indicator on the top edge of the hovered card.
            root.querySelectorAll('.int-goal-card').forEach(c => { c.style.borderTopColor = ''; c.style.borderTopWidth = ''; c.style.borderTopStyle = ''; });
            card.style.borderTopColor = '#3b82f6';
            card.style.borderTopWidth = '3px';
            card.style.borderTopStyle = 'solid';
        });
        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            const targetId = card.dataset.goalId;
            if (!draggedId || draggedId === targetId) return;
            await intReorderGoals(root.dataset.horizon, draggedId, targetId);
        });
    });
}

async function intReorderGoals(horizon, draggedId, targetId) {
    // Build the new order: take the currently-rendered list, move dragged
    // immediately before target, then renumber sortOrder 0..N.
    const visible = intGoalsByHorizon(horizon).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const draggedIdx = visible.findIndex(g => g.id === draggedId);
    const targetIdx = visible.findIndex(g => g.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;
    const [dragged] = visible.splice(draggedIdx, 1);
    // After removing, target's new index may have shifted by 1 if it was after dragged.
    const newTargetIdx = visible.findIndex(g => g.id === targetId);
    visible.splice(newTargetIdx, 0, dragged);
    const entries = visible.map((g, i) => ({ id: g.id, sortOrder: i }));

    // Optimistic: patch the in-memory intGoals so renderIntention shows the
    // new order immediately, then reconcile from the server.
    for (const e of entries) {
        const g = intGoals.find(x => x.id === e.id);
        if (g) g.sortOrder = e.sortOrder;
    }
    renderIntention();

    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reorder-goals', entries }),
        });
        await loadIntention();
    } catch (err) {
        showToast('Could not save reorder', 'error');
        await loadIntention();
    }
}

function renderGoalCard(g) {
    // v4.6.7: goals can span multiple ventures via ventureIds (CSV). The
    // left-edge dot uses the first venture's color as the dominant accent;
    // the chip row below shows every venture this goal belongs to.
    const ventures = intGoalVentureIds(g).map(id => intVentureById(id)).filter(Boolean);
    const dotColor = ventures[0] ? (ventures[0].color || '#3b82f6') : '#cbd5e1';
    const checkedToday = intIsCheckedToday(g.id);
    const isDone = g.status === 'done';

    // For daily-horizon goals, show a tap-to-checkin pill.
    const todayPill = g.horizon === 'daily'
        ? `<button onclick="intToggleCheckin('${g.id}')"
                style="background:${checkedToday ? '#22c55e' : 'white'};color:${checkedToday ? 'white' : 'var(--gray-700)'};border:1px solid ${checkedToday ? '#22c55e' : 'var(--gray-200)'};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;">
                ${checkedToday ? '✓ Today' : 'Mark today'}
            </button>`
        : '';

    // For non-daily, show a "+ checkin" button that records progress today against the parent goal.
    const checkinBtn = g.horizon !== 'daily'
        ? `<button onclick="intToggleCheckin('${g.id}')"
                style="background:${checkedToday ? '#f0f9ff' : 'white'};border:1px solid ${checkedToday ? '#3b82f6' : 'var(--gray-200)'};color:${checkedToday ? '#3b82f6' : 'var(--gray-600)'};border-radius:999px;padding:4px 10px;font-size:11px;font-weight:500;cursor:pointer;">
                ${checkedToday ? '✓ Progress today' : '+ Progress'}
            </button>`
        : '';

    const totalCheckins = intRecentCheckins.filter(c => c.goalId === g.id).length;
    const target = g.targetDate ? `<span style="color:var(--gray-400);font-size:12px;">due ${intEscape(g.targetDate)}</span>` : '';

    // Parent → child rollup: only meaningful on the strategic horizons.
    // Shows % of linked child goals (parentGoalId === this goal) that are done.
    const childPct = (g.horizon === 'quarterly' || g.horizon === 'yearly')
        ? intChildProgressPct(g.id)
        : null;
    const childBar = (childPct !== null)
        ? `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;background:${childPct >= 75 ? '#22c55e' : childPct >= 25 ? '#3b82f6' : '#cbd5e1'};width:${childPct}%;"></div>
                </div>
                <span style="font-size:11px;color:var(--gray-500);font-weight:600;font-variant-numeric:tabular-nums;">${childPct}%</span>
            </div>`
        : '';

    const ventureChips = ventures.length
        ? ventures.map(vv => `<span style="background:${intEscape(vv.color || '#3b82f6')}22;color:${intEscape(vv.color || '#3b82f6')};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">${vv.icon ? intEscape(vv.icon) + ' ' : ''}${intEscape(vv.name)}</span>`).join('')
        : '<span style="color:var(--gray-400);font-size:11px;">Personal</span>';

    // Priority chip — always clickable, cycles through none → P1 → P2 → P3 → none.
    // None state renders as a faint dashed pill saying "+P" so it's discoverable
    // without taking up visual weight on unprioritized goals.
    const prio = g.priority || 0;
    const prioCfg = prio === 1 ? { bg: '#fee2e2', fg: '#b91c1c', label: 'P1' }
                  : prio === 2 ? { bg: '#fef3c7', fg: '#92400e', label: 'P2' }
                  : prio === 3 ? { bg: '#dbeafe', fg: '#1e40af', label: 'P3' }
                  : null;
    const prioChip = prioCfg
        ? `<button onclick="event.stopPropagation();intCyclePriority('${g.id}')"
                   title="Click to cycle priority"
                   style="background:${prioCfg.bg};color:${prioCfg.fg};border:none;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700;letter-spacing:0.02em;cursor:pointer;">
                ${prioCfg.label}
            </button>`
        : `<button onclick="event.stopPropagation();intCyclePriority('${g.id}')"
                   title="Click to add priority"
                   style="background:transparent;color:var(--gray-400);border:1px dashed var(--gray-300);border-radius:4px;padding:0 6px;font-size:10px;font-weight:600;letter-spacing:0.02em;cursor:pointer;line-height:14px;">
                +P
            </button>`;

    // Size chip — T-shirt sizing; rendered only when set so it doesn't crowd
    // unsized goals. Neutral gray styling so it doesn't compete with priority.
    const sizeChip = (g.size && ['S', 'M', 'L', 'XL'].includes(g.size))
        ? `<span title="Size: ${g.size}" style="background:#f3f4f6;color:#475569;border:1px solid #e5e7eb;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;letter-spacing:0.02em;">${intEscape(g.size)}</span>`
        : '';

    // Lane chip — renders status as a small badge unless it's the default 'todo'
    // (avoids visual noise on the normal case). Distinct color per lane.
    const lane = intGoalLane(g);
    const laneCfg = lane === 'backlog' ? { bg: '#f3f4f6', fg: '#64748b', label: 'Backlog' }
                  : lane === 'working' ? { bg: '#e0f2fe', fg: '#0369a1', label: 'Working' }
                  : lane === 'waiting' ? { bg: '#fef3c7', fg: '#92400e', label: 'Waiting' }
                  : lane === 'done'    ? { bg: '#dcfce7', fg: '#15803d', label: 'Done' }
                  : null;
    const laneChip = laneCfg
        ? `<span style="background:${laneCfg.bg};color:${laneCfg.fg};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;">${laneCfg.label}</span>`
        : '';

    // Blocking relationships — surface both directions on the card.
    // "Blocked by N" — amber while any blocker is still open, green once all clear.
    const blockerIds = intGoalBlockedByIds(g);
    const blockers = blockerIds.map(id => intGoals.find(x => x.id === id)).filter(Boolean);
    const openBlockers = blockers.filter(b => b.status !== 'done' && b.status !== 'dropped');
    const blockedByChip = blockers.length
        ? `<button onclick="event.stopPropagation();intOpenGoalModal('${g.horizon}','${blockers[0].id}')"
                   title="${openBlockers.length} of ${blockers.length} blockers still open${blockers.length ? '. Click to open the first: ' + intEscape(blockers[0].title) : ''}"
                   style="background:${openBlockers.length ? '#fef3c7' : '#dcfce7'};color:${openBlockers.length ? '#92400e' : '#15803d'};border:none;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;cursor:pointer;">
                ${openBlockers.length ? '⛓' : '✓'} Blocked by ${blockers.length}${openBlockers.length ? ` (${openBlockers.length} open)` : ''}
            </button>`
        : '';
    // "Blocks N" — the reverse: how many other goals are waiting on this one.
    const blocksOthers = intGoalsBlockedByThis(g.id);
    const blocksChip = blocksOthers.length
        ? `<span title="Blocking ${blocksOthers.length} goal${blocksOthers.length === 1 ? '' : 's'}: ${blocksOthers.slice(0, 3).map(x => x.title).join(', ')}${blocksOthers.length > 3 ? '…' : ''}"
                 style="background:#ede9fe;color:#6d28d9;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;">
                → Blocks ${blocksOthers.length}
            </span>`
        : '';

    // Office-work minutes tracked to this goal.
    const owMin = intMinutesTrackedForGoal(g.id);
    const owChip = owMin > 0
        ? (() => {
            const h = Math.floor(owMin / 60), m = owMin % 60;
            const label = h > 0 ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
            return `<span title="Time tracked via Office Work" style="background:#ecfeff;color:#0e7490;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">⏱ ${label}</span>`;
        })()
        : '';

    // Linked habits & todos — surface the rollup so a quarterly goal shows the daily
    // habits feeding it, plus any one-shot todos pointing at it.
    const linkedHabits = intLinkedHabits.filter(h => h.goalId === g.id);
    const linkedTodos = intLinkedTodos.filter(t => t.goalId === g.id);
    const today = intPeriods.today || new Date().toISOString().slice(0, 10);
    const openTodos = linkedTodos.filter(t => !t.completed);

    const habitChips = linkedHabits.slice(0, 8).map(h => {
        const doneToday = h.lastCompletedDate === today;
        return `<span title="${intEscape(h.name)} — current streak ${h.currentStreak || 0}"
                       style="display:inline-flex;align-items:center;gap:4px;background:${doneToday ? '#dcfce7' : '#f3f4f6'};color:${doneToday ? '#15803d' : 'var(--gray-600)'};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:500;">
                    ${doneToday ? '✓' : '○'} ${intEscape(h.name)}${h.currentStreak ? ` · ${h.currentStreak}🔥` : ''}
                </span>`;
    }).join(' ');

    const linkedFooter = (linkedHabits.length || linkedTodos.length)
        ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--gray-200);display:flex;flex-direction:column;gap:6px;">
            ${linkedHabits.length ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Habits feeding this</span>
                ${habitChips}
                ${linkedHabits.length > 8 ? `<span style="color:var(--gray-400);font-size:11px;">+${linkedHabits.length - 8} more</span>` : ''}
            </div>` : ''}
            ${linkedTodos.length ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Todos</span>
                <span style="background:${openTodos.length ? '#fef3c7' : '#dcfce7'};color:${openTodos.length ? '#92400e' : '#15803d'};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;">
                    ${openTodos.length} open · ${linkedTodos.length - openTodos.length} done
                </span>
            </div>` : ''}
          </div>`
        : '';

    // Quarterly + yearly: progress notes. Daily tap-checkin already lives in todayPill.
    // For weekly, notes are usually captured in the Weekly Review modal — skip the inline editor.
    const supportsNotes = (g.horizon === 'quarterly' || g.horizon === 'yearly');
    const notedCheckins = supportsNotes
        ? intRecentCheckins.filter(c => c.goalId === g.id && c.progressNote && c.progressNote.trim()).slice(0, 3)
        : [];
    const notesSection = supportsNotes
        ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--gray-200);">
            ${notedCheckins.length
                ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
                    ${notedCheckins.map(c => `
                        <div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.4;">
                            <span style="color:var(--gray-400);flex-shrink:0;font-variant-numeric:tabular-nums;">${intEscape(c.date)}</span>
                            <span style="color:var(--gray-700);">${intEscape(c.progressNote)}</span>
                        </div>
                    `).join('')}
                </div>`
                : ''
            }
            <div style="display:flex;gap:6px;align-items:flex-start;">
                <textarea id="int-note-${g.id}"
                          placeholder="Add a progress note for today…"
                          rows="1"
                          style="flex:1;font-size:12px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;resize:vertical;min-height:30px;"></textarea>
                <button onclick="intSaveGoalNote('${g.id}')"
                        style="background:white;border:1px solid var(--gray-200);color:var(--gray-700);border-radius:6px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;align-self:stretch;">
                    Save
                </button>
            </div>
          </div>`
        : '';

    return `
        <div class="int-goal-card" draggable="true" data-goal-id="${intEscape(g.id)}"
             style="border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:flex-start;gap:10px;cursor:default;${isDone ? 'opacity:0.6;' : ''}">
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;align-self:stretch;">
                <span title="Drag to reorder" style="color:var(--gray-300);font-size:14px;cursor:grab;user-select:none;line-height:1;">⋮⋮</span>
                <div style="width:6px;flex:1;background:${intEscape(dotColor)};border-radius:3px;"></div>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="font-weight:600;color:var(--gray-800);${isDone ? 'text-decoration:line-through;' : ''}">${intEscape(g.title)}</div>
                    <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                        ${todayPill}
                        ${checkinBtn}
                        <button onclick="intOpenGoalModal('${g.horizon}','${g.id}')"
                                style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;padding:0 2px;">✎</button>
                    </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                    ${prioChip}
                    ${sizeChip}
                    ${laneChip}
                    ${ventureChips}
                    ${blockedByChip}
                    ${blocksChip}
                    ${owChip}
                    ${target}
                    ${totalCheckins ? `<span style="color:var(--gray-400);font-size:12px;">${totalCheckins} checkin${totalCheckins === 1 ? '' : 's'}</span>` : ''}
                </div>
                ${childBar}
                ${g.why ? `<details class="int-goal-why" style="margin-top:8px;">
                    <summary style="cursor:pointer;font-size:11px;color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;list-style:none;display:inline-flex;align-items:center;gap:4px;">
                        <span class="int-goal-why-caret" style="display:inline-block;transition:transform 0.15s;">▸</span> Why this matters
                    </summary>
                    <div style="margin-top:6px;font-size:13px;color:var(--gray-600);font-style:italic;">${intEscape(g.why)}</div>
                </details>` : ''}
                ${linkedFooter}
                ${notesSection}
            </div>
        </div>`;
}

// ──────────────── venture interactions ────────────────

function intSetActiveVenture(id) {
    intActiveVentureId = id;
    try {
        if (id) localStorage.setItem('int-active-venture', id);
        else localStorage.removeItem('int-active-venture');
    } catch (_) { /* ignore */ }
    renderIntention();
    // Broadcast: This Week + Today's Goals + To-Do + Today's Calendar share this filter and re-render in lockstep.
    renderDashVentureChips();
    if (typeof renderTodayGoalsWidget === 'function') renderTodayGoalsWidget();
    if (typeof renderDashThisWeek === 'function') renderDashThisWeek();
    if (typeof renderTodoList === 'function' && Array.isArray(_todosCache)) renderTodoList(_todosCache);
    if (typeof renderDashboardCalToday === 'function') renderDashboardCalToday();
}

// Compact dashboard chip row — single source of truth for the active venture filter.
function renderDashVentureChips() {
    const root = document.getElementById('dashVentureChips');
    if (!root) return;
    const active = (intVentures || []).filter(v => v.status === 'active');

    if (active.length === 0) {
        // No ventures yet — hide the row entirely rather than show a lone "All" chip.
        root.innerHTML = '';
        return;
    }

    const chip = (id, label, color, isActive) => `
        <button onclick="intSetActiveVenture('${id}')"
                style="background:${isActive ? (color || 'var(--primary)') : 'white'};color:${isActive ? 'white' : 'var(--gray-700)'};border:1px solid ${isActive ? (color || 'var(--primary)') : 'var(--gray-200)'};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:${isActive ? '600' : '500'};cursor:pointer;">
            ${label}
        </button>`;

    const items = [
        `<span style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.05em;margin-right:4px;">Venture</span>`,
        chip('', 'All', '', !intActiveVentureId),
    ];
    for (const v of active) {
        const lbl = (v.icon ? v.icon + ' ' : '') + intEscape(v.name);
        items.push(chip(v.id, lbl, v.color, intActiveVentureId === v.id));
    }
    root.innerHTML = items.join('');
}

function intOpenVentureModal(id) {
    const v = id ? intVentureById(id) : null;
    document.getElementById('intVentureModalTitle').textContent = v ? 'Edit Venture' : 'Add Venture';
    document.getElementById('intVentureIdInput').value = v ? v.id : '';
    document.getElementById('intVentureNameInput').value = v ? v.name : '';
    document.getElementById('intVentureColorInput').value = v ? (v.color || '#3b82f6') : '#3b82f6';
    document.getElementById('intVentureIconInput').value = v ? (v.icon || '') : '';
    document.getElementById('intVentureTaglineInput').value = v ? (v.tagline || '') : '';
    document.getElementById('intVentureStatusInput').value = v ? (v.status || 'active') : 'active';
    // Show the Archive + Delete-permanently button group only when editing an existing venture.
    const danger = document.getElementById('intVentureDangerGroup');
    if (danger) danger.style.display = v ? 'flex' : 'none';
    document.getElementById('intVentureModal').style.display = 'flex';
}

function intCloseVentureModal() {
    document.getElementById('intVentureModal').style.display = 'none';
}

async function intSaveVenture() {
    const id = document.getElementById('intVentureIdInput').value;
    const name = document.getElementById('intVentureNameInput').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    const body = {
        action: 'save-venture',
        id: id || undefined,
        name,
        color: document.getElementById('intVentureColorInput').value,
        icon: document.getElementById('intVentureIconInput').value.trim(),
        tagline: document.getElementById('intVentureTaglineInput').value.trim(),
        status: document.getElementById('intVentureStatusInput').value,
    };

    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        // apiFetch throws on non-2xx; reaching here means the save succeeded.
        intCloseVentureModal();
        showToast(id ? 'Venture updated' : 'Venture added', 'success');
        await loadIntention();
    } catch (err) {
        showToast('Could not save venture', 'error');
    }
}

async function intDeleteVenture() {
    const id = document.getElementById('intVentureIdInput').value;
    if (!id) return;
    openModal(
        'Archive venture?',
        'Goals stay intact; the venture is hidden from filters. You can reactivate from Archived.',
        'Archive', 'btn-primary',
        async () => {
            try {
                await apiFetch('/api/intention', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete-venture', id }),
                });
                intCloseVentureModal();
                showToast('Venture archived', 'success');
                await loadIntention();
            } catch (err) {
                showToast('Could not archive venture', 'error');
            }
        }
    );
}

async function intDeleteVentureHard() {
    const id = document.getElementById('intVentureIdInput').value;
    if (!id) return;
    const v = intVentureById(id);
    const name = v ? v.name : 'this venture';
    // Count what's still pointed at this venture so the confirmation is informative.
    const linkedGoals = intGoals.filter(g => g.ventureId === id).length;
    const linkedHabits = intLinkedHabits.filter(h => h.ventureId === id).length;
    const linkedTodos = intLinkedTodos.filter(t => t.ventureId === id).length;
    const tally = [];
    if (linkedGoals) tally.push(`${linkedGoals} goal${linkedGoals === 1 ? '' : 's'}`);
    if (linkedHabits) tally.push(`${linkedHabits} linked habit${linkedHabits === 1 ? '' : 's'}`);
    if (linkedTodos) tally.push(`${linkedTodos} linked todo${linkedTodos === 1 ? '' : 's'}`);
    const tallyStr = tally.length
        ? ` ${tally.join(', ')} will lose their venture tag but stay intact.`
        : '';

    openModal(
        'Delete venture permanently?',
        `Removes "${name}" from the database. This is not reversible.${tallyStr}`,
        'Delete permanently', 'btn-danger',
        async () => {
            try {
                await apiFetch('/api/intention', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete-venture-hard', id }),
                });
                intCloseVentureModal();
                showToast(`Deleted "${name}"`, 'success');
                await loadIntention();
            } catch (err) {
                showToast('Could not delete venture', 'error');
            }
        }
    );
}

// ──────────────── goal interactions ────────────────

// Parse a goal's stored ventures. Falls back to the singular ventureId when
// ventureIds (v4.6.7+) is empty so older rows still render correctly.
function intGoalVentureIds(g) {
    if (!g) return [];
    if (g.ventureIds && String(g.ventureIds).trim()) {
        return String(g.ventureIds).split(',').map(s => s.trim()).filter(Boolean);
    }
    return g.ventureId ? [g.ventureId] : [];
}

// True when a goal belongs to (or is unscoped from) the given venture filter.
// Empty filter ('') = all goals. Otherwise: the goal must include filterId in
// its ventureIds list, or fall back to the legacy singular ventureId match.
function intGoalMatchesVenture(g, filterId) {
    if (!filterId) return true;
    const ids = intGoalVentureIds(g);
    return ids.includes(filterId);
}

// 2-letter horizon abbreviation — used wherever a tag/initial needs to be
// shown next to a goal title. Picked specifically so none collide with the
// status lane names (Backlog/To-do/Working/Waiting/Done) — v4.6.9 dropped
// the single-letter form because [W] read ambiguously as Working vs Weekly.
function intHorizonShort(horizon) {
    return ({ daily: 'Dy', weekly: 'Wk', quarterly: 'Qt', yearly: 'Yr' })[horizon] || (horizon || '').slice(0, 2);
}

// v4.6.8 helpers ────────────────────────────────────────────────────────

// Parse blockedBy CSV → array of goal ids.
function intGoalBlockedByIds(g) {
    if (!g || !g.blockedBy) return [];
    return String(g.blockedBy).split(',').map(s => s.trim()).filter(Boolean);
}

// Reverse direction: goals that this one *blocks* (others where blockedBy
// contains my id).
function intGoalsBlockedByThis(goalId) {
    return intGoals.filter(x =>
        x.status !== 'dropped' &&
        intGoalBlockedByIds(x).includes(goalId)
    );
}

// Lane resolution: 'open' is legacy for 'todo'.
function intGoalLane(g) {
    if (!g) return 'todo';
    const s = g.status || 'todo';
    return s === 'open' ? 'todo' : s;
}

// Office-work minutes tracked against a goal (across the loaded window).
// Reads owSessions (populated by guru-office-work.js's loadOfficeWork()).
function intMinutesTrackedForGoal(goalId) {
    if (!goalId || typeof owSessions === 'undefined' || !Array.isArray(owSessions)) return 0;
    let sec = 0;
    for (const s of owSessions) {
        if (s.goalId === goalId) sec += (s.durationSec || 0);
    }
    return Math.round(sec / 60);
}

function intOpenGoalModal(horizon, id, presetStatus) {
    const g = id ? intGoals.find(x => x.id === id) : null;
    document.getElementById('intGoalModalTitle').textContent = g ? 'Edit Goal' : 'Add Goal';
    document.getElementById('intGoalIdInput').value = g ? g.id : '';
    document.getElementById('intGoalTitleInput').value = g ? g.title : '';
    document.getElementById('intGoalHorizonInput').value = g ? g.horizon : (horizon || 'daily');
    document.getElementById('intGoalWhyInput').value = g ? (g.why || '') : '';
    document.getElementById('intGoalTargetDateInput').value = g ? (g.targetDate || '') : '';
    // v4.6.8: status was open/done/dropped; expanded to swim-lane values.
    // Map legacy 'open' to 'todo' on display so the dropdown selects correctly.
    // v4.6.14: third arg `presetStatus` lets the Kanban view open the modal with
    // the lane pre-selected (e.g. tapping "+" on the Working lane → status:'working').
    document.getElementById('intGoalStatusInput').value = g
        ? (g.status === 'open' ? 'todo' : (g.status || 'todo'))
        : (presetStatus || 'todo');
    document.getElementById('intGoalPriorityInput').value = g ? String(g.priority || 0) : '0';
    document.getElementById('intGoalSizeInput').value = g ? (g.size || '') : '';

    // Multi-venture checkbox group — populated from current ventures (active first).
    // Pre-checks whatever ventureIds the goal already has (falling back to the
    // singular ventureId for older rows), or the currently active venture chip
    // when creating a brand-new goal.
    const checkedSet = new Set(g
        ? intGoalVentureIds(g)
        : (intActiveVentureId ? [intActiveVentureId] : [])
    );
    const list = document.getElementById('intGoalVentureList');
    const activeFirst = [...intVentures].sort((a, b) => {
        const order = { active: 0, paused: 1, archived: 2 };
        return (order[a.status] || 3) - (order[b.status] || 3);
    });
    if (activeFirst.length === 0) {
        list.innerHTML = '<span style="color:var(--gray-400);font-size:12px;padding:4px;">No ventures yet — this goal will be personal.</span>';
    } else {
        list.innerHTML = activeFirst.map(v => {
            const color = v.color || '#3b82f6';
            const isChecked = checkedSet.has(v.id);
            return `<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid ${isChecked ? color : 'var(--gray-200)'};border-radius:999px;background:${isChecked ? color + '15' : 'white'};cursor:pointer;font-size:12px;">
                <input type="checkbox" class="int-goal-venture-cb" value="${intEscape(v.id)}" ${isChecked ? 'checked' : ''} onchange="intGoalVentureCbChange(this, '${intEscape(color)}')" style="width:14px;height:14px;cursor:pointer;">
                <span style="color:${isChecked ? color : 'var(--gray-700)'};font-weight:${isChecked ? '600' : '500'};">${v.icon ? intEscape(v.icon) + ' ' : ''}${intEscape(v.name)}${v.status !== 'active' ? ` <span style="opacity:0.6;">(${intEscape(v.status)})</span>` : ''}</span>
            </label>`;
        }).join('');
    }

    // Blocked-by multi-select — only *active* goals are candidates (done,
    // dropped, and archived cards can't meaningfully block anything new).
    // Goals already linked as blockers stay visible regardless of state so
    // the user can uncheck them — hiding them would silently drop the link
    // on the next save, since blockedBy is rebuilt from checked boxes.
    const blockerList = document.getElementById('intGoalBlockedByList');
    const currentBlockers = new Set(
        g && g.blockedBy
            ? String(g.blockedBy).split(',').map(s => s.trim()).filter(Boolean)
            : []
    );
    const candidates = intGoals
        .filter(x => (!g || x.id !== g.id) &&
            (currentBlockers.has(x.id) ||
             (x.status !== 'dropped' && x.status !== 'done' && !x.archived)))
        // Sort: blockers already checked first, then by horizon strategic-first, then title.
        .sort((a, b) => {
            const sa = currentBlockers.has(a.id) ? 0 : 1;
            const sb = currentBlockers.has(b.id) ? 0 : 1;
            if (sa !== sb) return sa - sb;
            const order = { quarterly: 0, yearly: 1, weekly: 2, daily: 3 };
            const ho = (order[a.horizon] ?? 9) - (order[b.horizon] ?? 9);
            if (ho !== 0) return ho;
            return (a.title || '').localeCompare(b.title || '');
        });
    if (candidates.length === 0) {
        blockerList.innerHTML = '<span style="color:var(--gray-400);font-size:12px;padding:4px;">No other goals yet.</span>';
    } else {
        blockerList.innerHTML = candidates.map(x => {
            const isChecked = currentBlockers.has(x.id);
            // Use 2-letter abbreviations so the [W] doesn't read as "Working".
            // Dy/Wk/Qt/Yr aren't ambiguous with any lane name.
            const tag = `[${intHorizonShort(x.horizon)}]`;
            return `<label style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid ${isChecked ? '#3b82f6' : 'var(--gray-200)'};border-radius:999px;background:${isChecked ? '#dbeafe' : 'white'};cursor:pointer;font-size:11px;">
                <input type="checkbox" class="int-goal-blocker-cb" value="${intEscape(x.id)}" ${isChecked ? 'checked' : ''} onchange="intGoalBlockerCbChange(this)" style="width:13px;height:13px;cursor:pointer;">
                <span style="color:${isChecked ? '#1e40af' : 'var(--gray-700)'};font-weight:${isChecked ? '600' : '500'};">
                    <span style="color:var(--gray-400);font-weight:600;">${tag}</span> ${intEscape(x.title)}
                </span>
            </label>`;
        }).join('');
    }

    // Sessions logged against this goal via Office Work. Only meaningful for
    // existing goals — a brand-new card has no id for sessions to point at.
    const sessSection = document.getElementById('intGoalSessionsSection');
    if (sessSection) {
        sessSection.style.display = g ? '' : 'none';
        if (g) intRenderGoalSessions(g.id);
    }

    document.getElementById('intGoalDeleteBtn').style.display = g ? '' : 'none';
    document.getElementById('intGoalModal').style.display = 'flex';
}

// ──────────────── goal ↔ office-work sessions ────────────────

function intFmtMin(sec) {
    const m = Math.round((sec || 0) / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

// All office-work sessions tagged to a goal, newest first. owSessions is
// loaded eagerly at init by guru-office-work.js; guard anyway.
function intSessionsForGoal(goalId) {
    if (!goalId || typeof owSessions === 'undefined' || !Array.isArray(owSessions)) return [];
    return owSessions
        .filter(s => s.goalId === goalId)
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

// Renders the "Sessions" list inside the goal modal: date · category ·
// duration · notes per row, total in the header, rows clickable to edit.
function intRenderGoalSessions(goalId) {
    const list = document.getElementById('intGoalSessionsList');
    if (!list) return;
    const sessions = intSessionsForGoal(goalId);
    const totalEl = document.getElementById('intGoalSessionsTotal');
    if (totalEl) {
        const totalSec = sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0);
        totalEl.textContent = sessions.length
            ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${intFmtMin(totalSec)}`
            : '';
    }
    if (!sessions.length) {
        list.innerHTML = '<span style="color:var(--gray-400);font-size:12px;padding:4px;">No sessions logged yet.</span>';
        return;
    }
    const cats = (typeof owCategories !== 'undefined' && Array.isArray(owCategories)) ? owCategories : [];
    const shown = sessions.slice(0, 10);
    list.innerHTML = shown.map(s => {
        const cat = cats.find(c => c.id === s.categoryId);
        const catColor = cat ? (cat.color || '#3b82f6') : 'var(--gray-300)';
        const dateLabel = s.date
            ? new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
        return `<div onclick="intEditSessionFromGoal('${intEscape(s.id)}')"
                     title="Click to edit this session"
                     style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer;background:white;border:1px solid var(--gray-100);">
                <span style="width:3px;height:18px;background:${intEscape(catColor)};border-radius:2px;flex-shrink:0;"></span>
                <span style="font-size:11px;color:var(--gray-500);font-variant-numeric:tabular-nums;flex-shrink:0;min-width:44px;">${intEscape(dateLabel)}</span>
                <span style="flex:1;min-width:0;font-size:12px;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cat ? intEscape(cat.name) : '(deleted category)'}${s.notes ? ` · <span style="color:var(--gray-500);">${intEscape(s.notes)}</span>` : ''}</span>
                <span style="font-size:12px;font-weight:600;color:var(--gray-700);font-variant-numeric:tabular-nums;flex-shrink:0;">${intFmtMin(s.durationSec || 0)}</span>
            </div>`;
    }).join('') + (sessions.length > shown.length
        ? `<span style="color:var(--gray-400);font-size:11px;padding:2px 4px;">+${sessions.length - shown.length} more in Office Work → Sessions</span>`
        : '');
}

// "+ Add session" from the goal modal or a Kanban card — opens the Office
// Work session modal with this goal preselected. Closes the goal modal first
// so the two overlays don't stack.
function intLogSessionForGoal(goalId) {
    if (typeof owOpenSessionModal !== 'function') { showToast('Office Work module not loaded', 'error'); return; }
    intCloseGoalModal();
    owOpenSessionModal(null, goalId);
}

function intAddSessionToGoal() {
    const id = document.getElementById('intGoalIdInput').value;
    if (!id) return;
    intLogSessionForGoal(id);
}

function intEditSessionFromGoal(sessionId) {
    if (typeof owOpenSessionModal !== 'function') return;
    intCloseGoalModal();
    owOpenSessionModal(sessionId);
}

// Visual feedback on the blocker chip wrapper when toggled.
function intGoalBlockerCbChange(cb) {
    const label = cb.closest('label');
    if (!label) return;
    if (cb.checked) {
        label.style.borderColor = '#3b82f6';
        label.style.background = '#dbeafe';
        const span = label.querySelector('span');
        if (span) { span.style.color = '#1e40af'; span.style.fontWeight = '600'; }
    } else {
        label.style.borderColor = 'var(--gray-200)';
        label.style.background = 'white';
        const span = label.querySelector('span');
        if (span) { span.style.color = 'var(--gray-700)'; span.style.fontWeight = '500'; }
    }
}

// Visual feedback on the chip wrapper when a venture checkbox toggles.
function intGoalVentureCbChange(cb, color) {
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

function intCloseGoalModal() {
    document.getElementById('intGoalModal').style.display = 'none';
}

async function intSaveGoal() {
    const id = document.getElementById('intGoalIdInput').value;
    const title = document.getElementById('intGoalTitleInput').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }

    const ventureIds = [...document.querySelectorAll('.int-goal-venture-cb:checked')].map(cb => cb.value);
    const blockedBy = [...document.querySelectorAll('.int-goal-blocker-cb:checked')].map(cb => cb.value);
    const body = {
        action: 'save-goal',
        id: id || undefined,
        ventureIds,
        blockedBy,
        horizon: document.getElementById('intGoalHorizonInput').value,
        title,
        why: document.getElementById('intGoalWhyInput').value.trim(),
        targetDate: document.getElementById('intGoalTargetDateInput').value,
        status: document.getElementById('intGoalStatusInput').value,
        priority: parseInt(document.getElementById('intGoalPriorityInput').value, 10) || 0,
        size: document.getElementById('intGoalSizeInput').value,
    };

    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        // apiFetch throws on non-2xx; reaching here means the save succeeded.
        intCloseGoalModal();
        showToast(id ? 'Goal updated' : 'Goal added', 'success');
        await loadIntention();
    } catch (err) {
        showToast('Could not save goal', 'error');
    }
}

async function intDeleteGoal() {
    const id = document.getElementById('intGoalIdInput').value;
    if (!id) return;
    openModal(
        'Delete goal?',
        'This permanently removes the goal and all its checkins.',
        'Delete', 'btn-danger',
        async () => {
            try {
                await apiFetch('/api/intention', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete-goal', id }),
                });
                // apiFetch throws on non-2xx; reaching here means the delete succeeded.
                intCloseGoalModal();
                showToast('Goal deleted', 'success');
                await loadIntention();
            } catch (err) {
                showToast('Could not delete goal', 'error');
            }
        }
    );
}

// ──────────────── dashboard "Today's Goals" widget ────────────────

// Dashboard "This Week" card — the 3-priority steering list. Reads the same
// weekly-horizon goals as Intention's weekly view, but hard-capped at 3 so
// the surface stays a priority list rather than a backlog.
function renderDashThisWeek() {
    const root = document.getElementById('dashThisWeekContent');
    if (!root) return;

    const weekly = intGoalsForActiveScope()
        .filter(g => g.horizon === 'weekly' && g.status !== 'done' && g.status !== 'dropped')
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const top = weekly.slice(0, 3);

    const rows = top.map((g, i) => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:7px 2px;">
            <span style="font-size:13px;font-weight:600;color:var(--gray-400);font-variant-numeric:tabular-nums;flex-shrink:0;">${i + 1}.</span>
            <span style="flex:1;font-size:15px;font-weight:500;color:var(--gray-900);">${intEscape(g.title)}</span>
        </div>`);

    // Empty slots read as a soft nudge to plan the week, not an error state.
    for (let i = top.length; i < 3; i++) {
        rows.push(`
        <div style="display:flex;align-items:baseline;gap:12px;padding:7px 2px;">
            <span style="font-size:13px;font-weight:600;color:var(--gray-300);font-variant-numeric:tabular-nums;flex-shrink:0;">${i + 1}.</span>
            <span style="flex:1;font-size:14px;color:var(--gray-400);cursor:pointer;" onclick="switchTab('intention'); intOpenGoalModal('weekly');">Add a weekly priority &rarr;</span>
        </div>`);
    }

    const overflow = weekly.length > 3
        ? `<div style="margin-top:8px;font-size:12px;color:var(--gray-500);cursor:pointer;" onclick="switchTab('intention')">+${weekly.length - 3} more in Intention &rarr;</div>`
        : '';

    root.innerHTML = rows.join('') + overflow;
}

function renderTodayGoalsWidget() {
    const root = document.getElementById('dashTodayGoalsContent');
    if (!root) return;

    // When a venture chip is active, scope to that venture (multi-venture aware).
    // Otherwise show everything, ventureless-last so things-tied-to-a-project surface first.
    const daily = intGoals
        .filter(g => g.horizon === 'daily' && g.status !== 'dropped')
        .filter(g => intGoalMatchesVenture(g, intActiveVentureId))
        .sort((a, b) => {
            const va = intGoalVentureIds(a).length ? 0 : 1;
            const vb = intGoalVentureIds(b).length ? 0 : 1;
            if (va !== vb) return va - vb;
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });

    if (daily.length === 0) {
        root.innerHTML = `
            <div class="empty-state" style="padding:16px 0;">
                <p style="margin:0 0 8px;color:var(--gray-400);">No daily goals yet.</p>
                <button class="btn btn-secondary btn-sm" onclick="switchTab('intention'); intOpenGoalModal('daily');">+ Add one</button>
            </div>`;
        return;
    }

    const doneCount = daily.filter(g => intIsCheckedToday(g.id)).length;
    const total = daily.length;

    const rows = daily.map(g => {
        // Multi-venture-aware: dominant color is the first linked venture.
        const ventures = intGoalVentureIds(g).map(id => intVentureById(id)).filter(Boolean);
        const v = ventures[0] || null;
        const checked = intIsCheckedToday(g.id);
        const dotColor = v ? (v.color || '#3b82f6') : '#cbd5e1';
        return `
            <div onclick="intToggleCheckin('${g.id}')"
                 style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;border:1px solid ${checked ? '#bbf7d0' : 'var(--gray-200)'};background:${checked ? '#f0fdf4' : 'white'};margin-bottom:6px;">
                <span style="width:18px;height:18px;border-radius:4px;border:2px solid ${checked ? '#22c55e' : 'var(--gray-300)'};background:${checked ? '#22c55e' : 'white'};display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700;flex-shrink:0;">${checked ? '✓' : ''}</span>
                <span style="flex:1;font-size:14px;color:var(--gray-800);${checked ? 'text-decoration:line-through;color:var(--gray-500);' : ''}">${intEscape(g.title)}</span>
                <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(dotColor)};" title="${v ? intEscape(v.name) : 'Personal'}"></span>
            </div>`;
    }).join('');

    const streak = intDailyMetaStreak();
    root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:var(--gray-500);">
            <span>${doneCount} of ${total} done today</span>
            ${streak > 0 ? `<span style="font-weight:600;color:var(--gray-700);">${streak}-day streak 🔥</span>` : ''}
        </div>
        ${rows}`;
}

// Cycle the goal's priority: none → P1 → P2 → P3 → none. Inline editor on
// each goal card so the user can re-rank quickly without opening the modal.
async function intCyclePriority(goalId) {
    const g = intGoals.find(x => x.id === goalId);
    if (!g) return;
    const current = g.priority || 0;
    const next = (current + 1) % 4;

    // Optimistic UI — flip locally, then sync.
    g.priority = next;
    renderIntention();

    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save-goal',
                id: goalId,
                horizon: g.horizon,
                title: g.title,
                priority: next,
            }),
        });
        // Reload to pull the canonical server state (covers any other concurrent edits).
        await loadIntention();
    } catch (err) {
        showToast('Could not update priority', 'error');
        g.priority = current;
        renderIntention();
    }
}

// ──────────────── checkin (tap-to-mark) ────────────────

async function intSaveGoalNote(goalId) {
    const ta = document.getElementById('int-note-' + goalId);
    if (!ta) return;
    const note = (ta.value || '').trim();
    if (!note) { showToast('Note is empty', 'error'); return; }
    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'checkin', goalId, progressNote: note }),
        });
        // apiFetch throws on non-2xx; reaching here means the save succeeded.
        ta.value = '';
        showToast('Progress note saved', 'success');
        await loadIntention();
    } catch (err) {
        showToast('Could not save note', 'error');
    }
}

// ──────────────── email digest settings modal ────────────────

async function intOpenDigestModal() {
    try {
        const settings = await apiFetch('/api/settings');
        const cfg = (settings && settings.intentionDigest) || {};
        document.getElementById('intDigestEnabled').checked = !!cfg.enabled;
        document.getElementById('intDigestEmail').value = cfg.email || 'jarin.wadiwalla@gmail.com';
        document.getElementById('intDigestHour').value = Number.isInteger(cfg.hour) ? cfg.hour : 13;
        const lbl = document.getElementById('intDigestLastSent');
        if (cfg.lastSentAt) {
            const when = new Date(cfg.lastSentAt);
            lbl.textContent = `Last sent: ${when.toLocaleString()}`;
        } else {
            lbl.textContent = 'Last sent: never';
        }
        document.getElementById('intDigestModal').style.display = 'flex';
    } catch (e) {
        showToast('Failed to load digest settings', 'error');
    }
}

function intCloseDigestModal() {
    document.getElementById('intDigestModal').style.display = 'none';
}

async function intDigestSave() {
    const enabled = document.getElementById('intDigestEnabled').checked;
    const email = document.getElementById('intDigestEmail').value.trim();
    const hourRaw = parseInt(document.getElementById('intDigestHour').value, 10);
    const hour = (Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23) ? hourRaw : 13;
    if (enabled && !email) { showToast('Recipient email is required when enabled', 'error'); return; }
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ intentionDigest: { enabled, email, hour } }),
        });
        showToast('Digest settings saved', 'success');
        intCloseDigestModal();
    } catch (e) {
        showToast('Failed to save', 'error');
    }
}

async function intDigestPreview() {
    // Opens the rendered HTML in a new tab via the GET shortcut — cleaner than
    // dumping it into a div, since email HTML uses absolute styling and a
    // standalone preview matches what Resend will actually deliver.
    window.open('/api/intention-digest', '_blank', 'noopener');
}

async function intDigestSendNow() {
    const email = document.getElementById('intDigestEmail').value.trim();
    if (!email) { showToast('Set a recipient email first', 'error'); return; }
    try {
        // apiFetch returns the parsed JSON body for ONLINE_ONLY endpoints
        // (intention-digest is one) and throws on non-2xx.
        const body = await apiFetch('/api/intention-digest', {
            method: 'POST',
            body: JSON.stringify({ action: 'send', email }),
        }) || {};
        if (body.ok) {
            showToast(`Digest sent to ${body.to}`, 'success');
            // Refresh lastSentAt label
            const lbl = document.getElementById('intDigestLastSent');
            if (lbl) lbl.textContent = `Last sent: ${new Date().toLocaleString()}`;
        } else {
            showToast(body.error || 'Send failed', 'error');
        }
    } catch (e) {
        showToast('Send failed: ' + (e.message || 'unknown'), 'error');
    }
}

// ──────────────── weekly review modal ────────────────
// Three-step flow:
//   1. Outcome per last week's weekly goal (hit / partial / miss)
//   2. Set up to 3 weekly goals for the coming week
//   3. Optional progress note per active quarterly goal
//
// State persists in module-level vars only — modal is short-lived; save happens
// per-step as the user clicks Next. "Save & Close" persists whatever is filled
// in the current step then closes.

let _reviewStep = 1;
let _reviewOutcomes = {};       // goalId → 'hit' | 'partial' | 'miss'
let _reviewNextWeek = [          // pre-seeded; user can fill or leave blank
    { title: '', ventureId: '' },
    { title: '', ventureId: '' },
    { title: '', ventureId: '' },
];
let _reviewQuarterlyNotes = {};  // goalId → text

function _reviewLastWeekRange() {
    const thisWeekStart = intPeriods.weekStart || (() => {
        const d = new Date();
        const day = d.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        d.setUTCDate(d.getUTCDate() - diff);
        return d.toISOString().slice(0, 10);
    })();
    const lastEnd = new Date(thisWeekStart + 'T12:00:00Z');
    lastEnd.setUTCDate(lastEnd.getUTCDate() - 1);
    const lastStart = new Date(lastEnd);
    lastStart.setUTCDate(lastStart.getUTCDate() - 6);
    return {
        thisWeekStart,
        lastStart: lastStart.toISOString().slice(0, 10),
        lastEnd: lastEnd.toISOString().slice(0, 10),
    };
}

function intOpenReviewModal() {
    // Last week's weekly goals — anything with horizon=weekly that was created
    // before this week started. We don't filter on a week field because weekly
    // goals don't carry one; lifetime is "open until reviewed".
    const range = _reviewLastWeekRange();
    const lastWeekGoals = intGoals.filter(g =>
        g.horizon === 'weekly' &&
        g.createdAt && g.createdAt.slice(0, 10) < range.thisWeekStart &&
        g.status !== 'dropped'
    );

    _reviewStep = 1;
    _reviewOutcomes = {};
    for (const g of lastWeekGoals) {
        // Pre-seed: goals already marked done count as hit
        _reviewOutcomes[g.id] = g.status === 'done' ? 'hit' : null;
    }
    _reviewNextWeek = [
        { title: '', ventureId: intActiveVentureId || '' },
        { title: '', ventureId: intActiveVentureId || '' },
        { title: '', ventureId: intActiveVentureId || '' },
    ];
    _reviewQuarterlyNotes = {};

    document.getElementById('intReviewWeekLabel').textContent =
        `· ${range.lastStart} → ${range.lastEnd}`;

    intRenderReviewStep();
    document.getElementById('intReviewModal').style.display = 'flex';
}

function intCloseReviewModal() {
    document.getElementById('intReviewModal').style.display = 'none';
}

function intRenderReviewStep() {
    document.getElementById('intReviewStepLabel').textContent = `Step ${_reviewStep} of 3`;
    for (let i = 1; i <= 3; i++) {
        document.getElementById('intReviewStep' + i).style.display = (i === _reviewStep) ? '' : 'none';
    }
    document.getElementById('intReviewBackBtn').style.display = (_reviewStep > 1) ? '' : 'none';
    document.getElementById('intReviewNextBtn').textContent = (_reviewStep < 3) ? 'Next →' : 'Finish';

    if (_reviewStep === 1) intRenderReviewStep1();
    else if (_reviewStep === 2) intRenderReviewStep2();
    else intRenderReviewStep3();
}

function intRenderReviewStep1() {
    const range = _reviewLastWeekRange();
    const lastWeekGoals = intGoals.filter(g =>
        g.horizon === 'weekly' &&
        g.createdAt && g.createdAt.slice(0, 10) < range.thisWeekStart &&
        g.status !== 'dropped'
    );
    const root = document.getElementById('intReviewLastWeekList');

    if (lastWeekGoals.length === 0) {
        root.innerHTML = '<div class="empty-state" style="padding:20px 0;"><p style="color:var(--gray-400);">No weekly goals from last week. Skip to step 2 to set this week\'s.</p></div>';
        return;
    }

    root.innerHTML = lastWeekGoals.map(g => {
        const v = intVentureById(g.ventureId);
        const dotColor = v ? (v.color || '#3b82f6') : '#cbd5e1';
        const outcome = _reviewOutcomes[g.id];
        const btn = (key, label, color) => `
            <button onclick="intReviewMarkOutcome('${g.id}','${key}')"
                    style="background:${outcome === key ? color : 'white'};color:${outcome === key ? 'white' : 'var(--gray-700)'};border:1px solid ${outcome === key ? color : 'var(--gray-200)'};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;">
                ${label}
            </button>`;
        return `
            <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(dotColor)};flex-shrink:0;"></span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:var(--gray-800);">${intEscape(g.title)}</div>
                    <div style="font-size:11px;color:var(--gray-400);">${v ? intEscape(v.name) : 'Personal'}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    ${btn('hit', '✓ Hit', '#22c55e')}
                    ${btn('partial', '~ Partial', '#f59e0b')}
                    ${btn('miss', '✗ Miss', '#ef4444')}
                </div>
            </div>`;
    }).join('');
}

function intReviewMarkOutcome(goalId, outcome) {
    _reviewOutcomes[goalId] = outcome;
    intRenderReviewStep1();
}

function intRenderReviewStep2() {
    const root = document.getElementById('intReviewNextWeekList');

    // Pre-seed unfilled slots with last week's "partial" goals as suggestions.
    const partialIds = Object.keys(_reviewOutcomes).filter(id => _reviewOutcomes[id] === 'partial');
    const partialGoals = partialIds.map(id => intGoals.find(g => g.id === id)).filter(Boolean);
    let suggestIdx = 0;
    for (let i = 0; i < _reviewNextWeek.length; i++) {
        if (!_reviewNextWeek[i].title && suggestIdx < partialGoals.length) {
            const sg = partialGoals[suggestIdx++];
            _reviewNextWeek[i] = { title: sg.title, ventureId: sg.ventureId || '' };
        }
    }

    root.innerHTML = _reviewNextWeek.map((row, i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <span style="width:18px;color:var(--gray-400);font-size:13px;font-weight:600;">${i + 1}.</span>
            <input type="text"
                   id="rev-nw-title-${i}"
                   value="${intEscape(row.title)}"
                   placeholder="Weekly goal #${i + 1} (leave blank to skip)"
                   style="flex:1;font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;"
                   oninput="intReviewSetNextWeekTitle(${i}, this.value)">
            <select id="rev-nw-venture-${i}"
                    style="font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;min-width:140px;"
                    onchange="intReviewSetNextWeekVenture(${i}, this.value)">
                ${buildVentureOptions(row.ventureId || '')}
            </select>
        </div>
    `).join('');
}

// Inline-handler shims — classic-script inline `on*` handlers can't see
// top-level `let` bindings, so they call these named functions instead.
function intReviewSetNextWeekTitle(i, val) { _reviewNextWeek[i].title = val; }
function intReviewSetNextWeekVenture(i, val) { _reviewNextWeek[i].ventureId = val; }
function intReviewSetQuarterlyNote(goalId, val) { _reviewQuarterlyNotes[goalId] = val; }

function intRenderReviewStep3() {
    const root = document.getElementById('intReviewQuarterlyList');
    // Active = anything in todo/working/waiting/backlog (treats legacy 'open' as todo).
    const quarterlyGoals = intGoals.filter(g => g.horizon === 'quarterly' && g.status !== 'done' && g.status !== 'dropped');

    if (quarterlyGoals.length === 0) {
        root.innerHTML = '<div class="empty-state" style="padding:20px 0;"><p style="color:var(--gray-400);">No active quarterly goals. You\'re done — click Finish.</p></div>';
        return;
    }

    root.innerHTML = quarterlyGoals.map(g => {
        const v = intVentureById(g.ventureId);
        const dotColor = v ? (v.color || '#3b82f6') : '#cbd5e1';
        const cached = _reviewQuarterlyNotes[g.id] || '';
        return `
            <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(dotColor)};flex-shrink:0;"></span>
                    <div style="font-weight:600;color:var(--gray-800);">${intEscape(g.title)}</div>
                </div>
                <textarea id="rev-qn-${g.id}"
                          placeholder="What moved this week? (leave blank to skip)"
                          rows="2"
                          style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;resize:vertical;"
                          oninput="intReviewSetQuarterlyNote('${g.id}', this.value)">${intEscape(cached)}</textarea>
            </div>`;
    }).join('');
}

async function intReviewStep(direction) {
    // Persist the just-completed step before moving on.
    if (direction === 1) {
        if (_reviewStep === 1) {
            await _reviewPersistStep1();
        } else if (_reviewStep === 2) {
            await _reviewPersistStep2();
        } else if (_reviewStep === 3) {
            await _reviewPersistStep3();
            // After step 3 finishes, refresh data and close.
            await loadIntention();
            intCloseReviewModal();
            showToast('Weekly review saved 🎉', 'success');
            return;
        }
    }
    _reviewStep = Math.max(1, Math.min(3, _reviewStep + direction));
    intRenderReviewStep();
}

async function _reviewPersistStep1() {
    // Hit → set status='done'. Miss → set status='dropped'. Partial / null → leave open.
    const stmts = [];
    for (const [goalId, outcome] of Object.entries(_reviewOutcomes)) {
        if (outcome === 'hit') {
            stmts.push({ action: 'save-goal', id: goalId, status: 'done', horizon: 'weekly',
                title: intGoals.find(g => g.id === goalId)?.title || '' });
        } else if (outcome === 'miss') {
            stmts.push({ action: 'save-goal', id: goalId, status: 'dropped', horizon: 'weekly',
                title: intGoals.find(g => g.id === goalId)?.title || '' });
        }
    }
    for (const body of stmts) {
        try {
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (_) { /* swallow per-row; toast at end */ }
    }
}

async function _reviewPersistStep2() {
    // Create new weekly goals for any non-empty rows.
    const toCreate = _reviewNextWeek.filter(r => (r.title || '').trim());
    for (const row of toCreate) {
        try {
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save-goal',
                    horizon: 'weekly',
                    title: row.title.trim(),
                    ventureId: row.ventureId || '',
                    status: 'todo',
                }),
            });
        } catch (_) { /* swallow per-row */ }
    }
}

async function _reviewPersistStep3() {
    // Each non-empty note becomes a checkin on its goal for today.
    for (const [goalId, note] of Object.entries(_reviewQuarterlyNotes)) {
        const trimmed = (note || '').trim();
        if (!trimmed) continue;
        try {
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'checkin', goalId, progressNote: trimmed }),
            });
        } catch (_) { /* swallow per-row */ }
    }
}

// ──────────────── quarterly review modal ────────────────
// Sibling to the Weekly Review: same 3-step shape, but operates on the *current*
// quarter's quarterly goals (rather than last week's weekly goals) and pre-seeds
// partials forward into the *next* quarter.

let _qReviewStep = 1;
let _qReviewOutcomes = {};        // goalId → 'hit' | 'partial' | 'miss'
let _qReviewNextQuarter = [        // 5 slots — quarterly goals are heavier than weekly
    { title: '', ventureId: '', why: '' },
    { title: '', ventureId: '', why: '' },
    { title: '', ventureId: '', why: '' },
    { title: '', ventureId: '', why: '' },
    { title: '', ventureId: '', why: '' },
];
let _qReviewReflections = {};     // goalId → text

function _qReviewQuarterLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${q} ${d.getUTCFullYear()}`;
}

function _qReviewNextQuarterStart(currentQuarterStart) {
    const d = new Date(currentQuarterStart + 'T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + 3);
    return d.toISOString().slice(0, 10);
}

function intOpenQReviewModal() {
    const qStart = intPeriods.quarterStart || currentQuarterStartLocal();
    const quarterly = intGoals.filter(g =>
        g.horizon === 'quarterly' &&
        g.createdAt && g.createdAt.slice(0, 10) >= qStart &&
        g.status !== 'done' && g.status !== 'dropped'
    );

    _qReviewStep = 1;
    _qReviewOutcomes = {};
    for (const g of quarterly) {
        _qReviewOutcomes[g.id] = null;
    }
    _qReviewNextQuarter = [0, 1, 2, 3, 4].map(() => ({
        title: '', ventureId: intActiveVentureId || '', why: '',
    }));
    _qReviewReflections = {};

    document.getElementById('intQReviewLabel').textContent =
        `· closing ${_qReviewQuarterLabel(qStart)}`;

    intRenderQReviewStep();
    document.getElementById('intQReviewModal').style.display = 'flex';
}

function intCloseQReviewModal() {
    document.getElementById('intQReviewModal').style.display = 'none';
}

// Fallback for when intPeriods hasn't loaded yet (rare — modal needs goals data).
function currentQuarterStartLocal() {
    const d = new Date();
    const m = d.getUTCMonth();
    return new Date(Date.UTC(d.getUTCFullYear(), m - (m % 3), 1)).toISOString().slice(0, 10);
}

function intRenderQReviewStep() {
    document.getElementById('intQReviewStepLabel').textContent = `Step ${_qReviewStep} of 3`;
    for (let i = 1; i <= 3; i++) {
        document.getElementById('intQReviewStep' + i).style.display = (i === _qReviewStep) ? '' : 'none';
    }
    document.getElementById('intQReviewBackBtn').style.display = (_qReviewStep > 1) ? '' : 'none';
    document.getElementById('intQReviewNextBtn').textContent = (_qReviewStep < 3) ? 'Next →' : 'Finish';

    if (_qReviewStep === 1) intRenderQReviewStep1();
    else if (_qReviewStep === 2) intRenderQReviewStep2();
    else intRenderQReviewStep3();
}

function intRenderQReviewStep1() {
    const qStart = intPeriods.quarterStart || currentQuarterStartLocal();
    const quarterly = intGoals.filter(g =>
        g.horizon === 'quarterly' &&
        g.createdAt && g.createdAt.slice(0, 10) >= qStart &&
        g.status !== 'done' && g.status !== 'dropped'
    );
    const root = document.getElementById('intQReviewCurrentList');

    if (quarterly.length === 0) {
        root.innerHTML = '<div class="empty-state" style="padding:20px 0;"><p style="color:var(--gray-400);">No quarterly goals to close out. Skip to step 2 to set next quarter\'s.</p></div>';
        return;
    }

    root.innerHTML = quarterly.map(g => {
        const v = intVentureById(g.ventureId);
        const dotColor = v ? (v.color || '#3b82f6') : '#cbd5e1';
        const outcome = _qReviewOutcomes[g.id];
        const childPct = intChildProgressPct(g.id);
        const btn = (key, label, color) => `
            <button onclick="intQReviewMarkOutcome('${g.id}','${key}')"
                    style="background:${outcome === key ? color : 'white'};color:${outcome === key ? 'white' : 'var(--gray-700)'};border:1px solid ${outcome === key ? color : 'var(--gray-200)'};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;">
                ${label}
            </button>`;
        const childInfo = (childPct !== null)
            ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px;">${childPct}% of linked weekly goals done</div>`
            : '';
        return `
            <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(dotColor)};flex-shrink:0;"></span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:var(--gray-800);">${intEscape(g.title)}</div>
                    <div style="font-size:11px;color:var(--gray-400);">${v ? intEscape(v.name) : 'Personal'}</div>
                    ${childInfo}
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    ${btn('hit', '✓ Hit', '#22c55e')}
                    ${btn('partial', '~ Partial', '#f59e0b')}
                    ${btn('miss', '✗ Miss', '#ef4444')}
                </div>
            </div>`;
    }).join('');
}

function intQReviewMarkOutcome(goalId, outcome) {
    _qReviewOutcomes[goalId] = outcome;
    intRenderQReviewStep1();
}

function intRenderQReviewStep2() {
    const root = document.getElementById('intQReviewNextList');
    // Pre-seed unfilled slots with partial goals from step 1.
    const partialIds = Object.keys(_qReviewOutcomes).filter(id => _qReviewOutcomes[id] === 'partial');
    const partialGoals = partialIds.map(id => intGoals.find(g => g.id === id)).filter(Boolean);
    let suggestIdx = 0;
    for (let i = 0; i < _qReviewNextQuarter.length; i++) {
        if (!_qReviewNextQuarter[i].title && suggestIdx < partialGoals.length) {
            const sg = partialGoals[suggestIdx++];
            _qReviewNextQuarter[i] = {
                title: sg.title,
                ventureId: sg.ventureId || '',
                why: sg.why || '',
            };
        }
    }

    root.innerHTML = _qReviewNextQuarter.map((row, i) => `
        <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;gap:8px;align-items:center;">
                <span style="width:18px;color:var(--gray-400);font-size:13px;font-weight:600;">${i + 1}.</span>
                <input type="text"
                       id="qrev-nq-title-${i}"
                       value="${intEscape(row.title)}"
                       placeholder="Quarterly goal #${i + 1} (leave blank to skip)"
                       style="flex:1;font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;"
                       oninput="intQReviewSetNextTitle(${i}, this.value)">
                <select id="qrev-nq-venture-${i}"
                        style="font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;min-width:140px;"
                        onchange="intQReviewSetNextVenture(${i}, this.value)">
                    ${buildVentureOptions(row.ventureId || '')}
                </select>
            </div>
            <textarea id="qrev-nq-why-${i}"
                      placeholder="Why this matters (optional)"
                      rows="1"
                      style="width:100%;margin-top:6px;font-size:12px;padding:6px 10px;border:1px solid var(--gray-200);border-radius:6px;resize:vertical;"
                      oninput="intQReviewSetNextWhy(${i}, this.value)">${intEscape(row.why)}</textarea>
        </div>
    `).join('');
}

// Inline-handler shims for the same reason as the Weekly Review.
function intQReviewSetNextTitle(i, val) { _qReviewNextQuarter[i].title = val; }
function intQReviewSetNextVenture(i, val) { _qReviewNextQuarter[i].ventureId = val; }
function intQReviewSetNextWhy(i, val) { _qReviewNextQuarter[i].why = val; }
function intQReviewSetReflection(goalId, val) { _qReviewReflections[goalId] = val; }

function intRenderQReviewStep3() {
    const root = document.getElementById('intQReviewReflectList');
    const closing = Object.entries(_qReviewOutcomes)
        .filter(([, outcome]) => outcome === 'hit' || outcome === 'miss')
        .map(([id]) => intGoals.find(g => g.id === id))
        .filter(Boolean);

    if (closing.length === 0) {
        root.innerHTML = '<div class="empty-state" style="padding:20px 0;"><p style="color:var(--gray-400);">Nothing being closed out — click Finish to save next quarter\'s goals.</p></div>';
        return;
    }

    root.innerHTML = closing.map(g => {
        const v = intVentureById(g.ventureId);
        const dotColor = v ? (v.color || '#3b82f6') : '#cbd5e1';
        const outcome = _qReviewOutcomes[g.id];
        const cached = _qReviewReflections[g.id] || '';
        return `
            <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(dotColor)};flex-shrink:0;"></span>
                    <div style="font-weight:600;color:var(--gray-800);">${intEscape(g.title)}</div>
                    <span style="margin-left:auto;font-size:11px;font-weight:600;color:${outcome === 'hit' ? '#22c55e' : '#ef4444'};">${outcome === 'hit' ? '✓ Hit' : '✗ Miss'}</span>
                </div>
                <textarea id="qrev-ref-${g.id}"
                          placeholder="${outcome === 'hit' ? 'What worked?' : 'What got in the way?'}"
                          rows="2"
                          style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;resize:vertical;"
                          oninput="intQReviewSetReflection('${g.id}', this.value)">${intEscape(cached)}</textarea>
            </div>`;
    }).join('');
}

async function intQReviewStep(direction) {
    if (direction === 1) {
        if (_qReviewStep === 1) {
            await _qReviewPersistStep1();
        } else if (_qReviewStep === 2) {
            await _qReviewPersistStep2();
        } else if (_qReviewStep === 3) {
            await _qReviewPersistStep3();
            await loadIntention();
            intCloseQReviewModal();
            showToast('Quarter closed out 🎯', 'success');
            return;
        }
    }
    _qReviewStep = Math.max(1, Math.min(3, _qReviewStep + direction));
    intRenderQReviewStep();
}

async function _qReviewPersistStep1() {
    // Hit → status='done'. Miss → status='dropped'. Partial / null → leave open
    // so it can be re-added in step 2 (carry forward).
    for (const [goalId, outcome] of Object.entries(_qReviewOutcomes)) {
        if (outcome !== 'hit' && outcome !== 'miss') continue;
        try {
            const g = intGoals.find(x => x.id === goalId);
            if (!g) continue;
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save-goal',
                    id: goalId,
                    horizon: 'quarterly',
                    title: g.title,
                    status: outcome === 'hit' ? 'done' : 'dropped',
                }),
            });
        } catch (_) { /* swallow per-row */ }
    }
}

async function _qReviewPersistStep2() {
    // Create new quarterly goals for any non-empty rows. The next quarter starts
    // on a fixed date; goals get a targetDate = next quarter end so the carrying
    // forward shows up correctly in calendar/horizon views.
    const qStart = intPeriods.quarterStart || currentQuarterStartLocal();
    const nextStart = _qReviewNextQuarterStart(qStart);
    const nextEndDate = new Date(nextStart + 'T12:00:00Z');
    nextEndDate.setUTCMonth(nextEndDate.getUTCMonth() + 3);
    nextEndDate.setUTCDate(nextEndDate.getUTCDate() - 1);
    const nextEnd = nextEndDate.toISOString().slice(0, 10);

    const toCreate = _qReviewNextQuarter.filter(r => (r.title || '').trim());
    for (const row of toCreate) {
        try {
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save-goal',
                    horizon: 'quarterly',
                    title: row.title.trim(),
                    ventureId: row.ventureId || '',
                    why: row.why || '',
                    targetDate: nextEnd,
                    status: 'todo',
                }),
            });
        } catch (_) { /* swallow per-row */ }
    }
}

async function _qReviewPersistStep3() {
    // Each non-empty reflection is a goal_checkin on the closed goal for today.
    for (const [goalId, note] of Object.entries(_qReviewReflections)) {
        const trimmed = (note || '').trim();
        if (!trimmed) continue;
        try {
            await apiFetch('/api/intention', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'checkin', goalId, progressNote: trimmed }),
            });
        } catch (_) { /* swallow per-row */ }
    }
}

// ──────────────── parent → child progress rollup ────────────────

// Returns null when the goal has no children, otherwise an integer percentage
// (0-100) of children whose status is 'done'.
function intChildProgressPct(parentGoalId) {
    if (!parentGoalId) return null;
    const children = intGoals.filter(g => g.parentGoalId === parentGoalId);
    if (children.length === 0) return null;
    const done = children.filter(g => g.status === 'done').length;
    return Math.round((done / children.length) * 100);
}

// ──────────────── view modes (horizons / year / kanban) ────────────────
// The Intention tab has three mutually-exclusive view modes that swap the
// *inner content* of the main column. The left rail (Actions + Ventures)
// stays visible in every mode — refactored in v4.6.10 so the venture chip
// filter is always one click away.
//
//   'horizons' — Quarter / Week / Today stack
//   'kanban'   — 5 swim lanes (default since v4.6.10)
//   'year'     — 4-quarter grid for the current year
//
// View choice persists per-browser in localStorage 'int-view-mode'. On first
// load with no saved preference, defaults to 'kanban'.

const INT_VIEW_MODES = ['horizons', 'kanban', 'year', 'archive'];
const INT_VIEW_DEFAULT = 'kanban';
let _intViewMode = (() => {
    try {
        const saved = localStorage.getItem('int-view-mode');
        if (saved && INT_VIEW_MODES.includes(saved)) return saved;
    } catch { /* ignore */ }
    return INT_VIEW_DEFAULT;
})();

function intSetViewMode(mode) {
    if (!INT_VIEW_MODES.includes(mode)) mode = INT_VIEW_DEFAULT;
    _intViewMode = mode;
    try { localStorage.setItem('int-view-mode', mode); } catch { /* ignore */ }
    intApplyViewMode();
}

function intApplyViewMode() {
    const hv = document.getElementById('intHorizonView');
    const kv = document.getElementById('intKanbanView');
    const yv = document.getElementById('intYearView');
    const av = document.getElementById('intArchiveView');
    const yearBtn = document.getElementById('intYearViewToggle');
    const kanbanBtn = document.getElementById('intKanbanViewToggle');

    if (hv) hv.style.display = _intViewMode === 'horizons' ? 'flex' : 'none';
    if (kv) kv.style.display = _intViewMode === 'kanban'   ? 'block' : 'none';
    if (yv) yv.style.display = _intViewMode === 'year'     ? 'block' : 'none';
    if (av) av.style.display = _intViewMode === 'archive'  ? 'block' : 'none';

    // Toggle button labels — pressed-state button shows "↩ Quarter" so it's
    // clear how to get back to the default horizon stack from year/kanban.
    if (kanbanBtn) kanbanBtn.textContent = _intViewMode === 'kanban' ? '↩ Quarter' : '🗂 Kanban';
    if (yearBtn)   yearBtn.textContent   = _intViewMode === 'year'   ? '↩ Quarter' : '🗓 Year View';

    if (_intViewMode === 'kanban')  renderIntentionKanbanView();
    if (_intViewMode === 'year')    renderIntentionYearView();
    if (_intViewMode === 'archive') renderIntentionArchiveView();
}

// Backwards-compat shims for the existing toggle button onclick handlers.
// Clicking the active view's button drops back to the horizon stack.
function intToggleKanbanView() {
    intSetViewMode(_intViewMode === 'kanban' ? 'horizons' : 'kanban');
}
function intToggleYearView() {
    intSetViewMode(_intViewMode === 'year' ? 'horizons' : 'year');
}
function intToggleArchiveView() {
    intSetViewMode(_intViewMode === 'archive' ? 'horizons' : 'archive');
}

// ==================== ARCHIVE ====================
// Archived cards keep status='done' (progress rollups still count them) but
// disappear from the Kanban board and horizon lists. They live in the Archive
// view — searchable, horizon-filterable, unarchivable.
let _intArchiveQuery = '';
let _intArchiveHorizon = '';

function intArchiveDoneLane() {
    const ids = intGoals
        .filter(g => !g.archived && g.status !== 'dropped' &&
                     intGoalMatchesVenture(g, intActiveVentureId) &&
                     intGoalLane(g) === 'done')
        .map(g => g.id);
    if (!ids.length) { showToast('No done cards to archive', 'info'); return; }
    openModal(
        'Archive done cards',
        `Archive ${ids.length} card${ids.length === 1 ? '' : 's'} from the Done lane? They stay searchable in the Archive view and can be unarchived any time.`,
        'Archive', 'btn-primary',
        () => intSetGoalsArchived(ids, 1, `Archived ${ids.length} card${ids.length === 1 ? '' : 's'}`)
    );
}

async function intSetGoalsArchived(ids, flag, successMsg) {
    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'archive-goals', ids, archived: flag }),
        });
        showToast(successMsg, 'success');
        await loadIntention();
    } catch {
        showToast('Could not update archive state', 'error');
    }
}

function intUnarchiveGoal(id) {
    intSetGoalsArchived([id], 0, 'Card restored to the Done lane');
}

function intSetArchiveQuery(val) {
    _intArchiveQuery = val;
    renderIntentionArchiveList();
}

function intSetArchiveHorizon(h) {
    _intArchiveHorizon = h;
    renderIntentionArchiveView();
}

function intArchivedGoalsFiltered() {
    const q = _intArchiveQuery.trim().toLowerCase();
    return intGoals
        .filter(g => g.archived && intGoalMatchesVenture(g, intActiveVentureId))
        .filter(g => !_intArchiveHorizon || g.horizon === _intArchiveHorizon)
        .filter(g => !q || (g.title || '').toLowerCase().includes(q) || (g.why || '').toLowerCase().includes(q))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function renderIntentionArchiveView() {
    const root = document.getElementById('intArchiveView');
    if (!root) return;

    const horizons = [['', 'All'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
    const chips = horizons.map(([val, label]) => {
        const active = _intArchiveHorizon === val;
        return `<button onclick="intSetArchiveHorizon('${val}')"
                        style="background:${active ? 'var(--primary)' : 'white'};color:${active ? 'white' : 'var(--gray-700)'};border:1px solid ${active ? 'var(--primary)' : 'var(--gray-200)'};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:${active ? '600' : '500'};cursor:pointer;">${label}</button>`;
    }).join('');

    root.innerHTML = `
        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <h2 style="margin-bottom:0;">Archive</h2>
                <span id="intArchiveCount" style="font-size:12px;color:var(--gray-400);font-variant-numeric:tabular-nums;"></span>
            </div>
            <input type="text" id="intArchiveSearch" placeholder="Search archived cards..."
                   oninput="intSetArchiveQuery(this.value)"
                   style="width:100%;padding:8px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;margin-bottom:10px;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${chips}</div>
            <div id="intArchiveList"></div>
        </div>`;

    // Set via property (not attribute) so quotes in the query can't break markup.
    const search = document.getElementById('intArchiveSearch');
    if (search) search.value = _intArchiveQuery;

    renderIntentionArchiveList();
}

// List-only re-render so typing in the search box doesn't lose focus.
function renderIntentionArchiveList() {
    const list = document.getElementById('intArchiveList');
    if (!list) return;
    const goals = intArchivedGoalsFiltered();

    const count = document.getElementById('intArchiveCount');
    if (count) count.textContent = `${goals.length} card${goals.length === 1 ? '' : 's'}`;

    if (!goals.length) {
        list.innerHTML = `<div class="empty-state" style="padding:24px 0;"><p>${
            _intArchiveQuery || _intArchiveHorizon
                ? 'Nothing matches this filter.'
                : 'Nothing archived yet. Use the Archive button on the Done lane.'
        }</p></div>`;
        return;
    }

    list.innerHTML = goals.map(g => {
        const ventures = intGoalVentureIds(g).map(id => intVentureById(id)).filter(Boolean);
        const v = ventures[0] || null;
        const archivedDate = (g.updatedAt || '').slice(0, 10);
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:6px;background:white;">
                <span style="width:8px;height:8px;border-radius:50%;background:${intEscape(v ? (v.color || '#3b82f6') : '#cbd5e1')};flex-shrink:0;" title="${v ? intEscape(v.name) : 'Personal'}"></span>
                <span style="flex:1;min-width:0;">
                    <span style="font-size:14px;color:var(--gray-800);">${intEscape(g.title)}</span>
                    <span style="display:block;font-size:11px;color:var(--gray-400);">${intEscape(g.horizon)}${archivedDate ? ' · archived ' + archivedDate : ''}</span>
                </span>
                <button class="btn btn-secondary btn-sm" onclick="intUnarchiveGoal('${g.id}')">Unarchive</button>
            </div>`;
    }).join('');
}

function renderIntentionYearView() {
    const root = document.getElementById('intYearView');
    if (!root) return;
    const year = new Date().getUTCFullYear();
    const quarters = [0, 1, 2, 3].map(i => {
        const startMonth = i * 3;
        const start = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
        const endDate = new Date(Date.UTC(year, startMonth + 3, 0));
        const end = endDate.toISOString().slice(0, 10);
        return { i, label: `Q${i + 1} ${year}`, start, end };
    });

    const activeFilter = intActiveVentureId;
    const inYear = intGoals.filter(g =>
        g.horizon === 'quarterly' &&
        g.createdAt && g.createdAt.slice(0, 10) >= quarters[0].start &&
        g.createdAt.slice(0, 10) <= quarters[3].end &&
        intGoalMatchesVenture(g, activeFilter)
    );

    const cols = quarters.map(q => {
        const inQ = inYear.filter(g =>
            g.createdAt.slice(0, 10) >= q.start && g.createdAt.slice(0, 10) <= q.end
        );
        const totals = {
            done: inQ.filter(g => g.status === 'done').length,
            // "open" here = anything still active (backlog/todo/working/waiting/legacy open)
            open: inQ.filter(g => g.status !== 'done' && g.status !== 'dropped').length,
            dropped: inQ.filter(g => g.status === 'dropped').length,
        };
        const rows = inQ.length
            ? inQ.map(g => {
                const firstV = intGoalVentureIds(g).map(id => intVentureById(id)).find(Boolean);
                const color = firstV ? (firstV.color || '#3b82f6') : '#cbd5e1';
                const symbol = g.status === 'done' ? '✓' : g.status === 'dropped' ? '✗' : '○';
                const symbolColor = g.status === 'done' ? '#22c55e' : g.status === 'dropped' ? '#ef4444' : '#9ca3af';
                return `<div style="display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
                    <span style="color:${symbolColor};font-weight:700;flex-shrink:0;">${symbol}</span>
                    <span style="width:6px;height:6px;border-radius:50%;background:${color};margin-top:6px;flex-shrink:0;"></span>
                    <span style="flex:1;font-size:13px;color:${g.status === 'done' ? '#6b7280' : '#111827'};${g.status === 'done' ? 'text-decoration:line-through;' : ''}">${intEscape(g.title)}</span>
                </div>`;
            }).join('')
            : '<p style="font-size:12px;color:var(--gray-400);margin:8px 0 0;">No quarterly goals.</p>';
        return `
            <div class="card" style="margin-bottom:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h3 style="margin:0;font-size:14px;">${q.label}</h3>
                    <span style="font-size:11px;color:var(--gray-500);">${totals.done}✓ ${totals.open}○ ${totals.dropped}✗</span>
                </div>
                ${rows}
            </div>`;
    }).join('');

    root.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
            ${cols}
        </div>`;
}

// ──────────────── kanban view (swim lanes) ────────────────
// Five-column kanban: backlog / todo / working / waiting / done.
// `dropped` goals are hidden (they're the abandon state).
// Cards are draggable between lanes — drop fires save-goal {status: newLane}.
// Venture filter applies, just like the horizon view.

const KANBAN_LANES = [
    { id: 'backlog', label: 'Backlog', hint: 'Ideas / someday', color: '#94a3b8' },
    { id: 'todo',    label: 'To-do',   hint: 'Committed',      color: '#3b82f6' },
    { id: 'working', label: 'Working', hint: 'In progress',    color: '#0ea5e9' },
    { id: 'waiting', label: 'Waiting', hint: 'Blocked / external', color: '#f59e0b' },
    { id: 'done',    label: 'Done',    hint: 'Completed',      color: '#22c55e' },
];

// WIP-limited lanes — exceeding the configured count tints the column red.
// Limits are user-configurable per lane (click the WIP badge in the column
// header to edit). Persisted in localStorage; 0 / blank means no limit.
const KANBAN_WIP_LANES = ['todo', 'working'];
const KANBAN_WIP_DEFAULT = 3;

// Last-active mobile Kanban lane — preserved across re-renders so moving a
// card or saving an edit doesn't bounce the user back to the first lane.
let _intKanbanActiveLane = null;

// v4.6.20: the Backlog lane defaults to collapsed (it's the someday/ideas
// pile, not working state). Session-only — survives re-renders but resets to
// collapsed on the next page load.
let _intBacklogExpanded = false;

function intToggleBacklogCollapse() {
    _intBacklogExpanded = !_intBacklogExpanded;
    renderIntentionKanbanView();
}

function intGetKanbanLimits() {
    try {
        const raw = localStorage.getItem('int-kanban-limits');
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                todo:    Number.isFinite(parsed.todo)    ? parsed.todo    : KANBAN_WIP_DEFAULT,
                working: Number.isFinite(parsed.working) ? parsed.working : KANBAN_WIP_DEFAULT,
            };
        }
    } catch { /* corrupt — fall through to defaults */ }
    return { todo: KANBAN_WIP_DEFAULT, working: KANBAN_WIP_DEFAULT };
}

function intSetKanbanLimit(laneId, val) {
    const n = parseInt(val, 10);
    const safe = Number.isFinite(n) && n >= 0 ? n : KANBAN_WIP_DEFAULT;
    const limits = intGetKanbanLimits();
    limits[laneId] = safe;
    try { localStorage.setItem('int-kanban-limits', JSON.stringify(limits)); } catch { /* ignore */ }
    renderIntentionKanbanView();
}

// Called by the inline-edit field's keydown/blur. Prompt is intentionally
// crude — small surface area, no modal needed.
function intPromptKanbanLimit(laneId) {
    const limits = intGetKanbanLimits();
    const current = limits[laneId];
    const ans = prompt(`Max cards for "${laneId}" lane (0 = no limit):`, String(current));
    if (ans == null) return;
    intSetKanbanLimit(laneId, ans);
}

function renderIntentionKanbanView() {
    const root = document.getElementById('intKanbanView');
    if (!root) return;

    // Active scope (multi-venture-aware) — same filter as the horizon view.
    // Archived cards live in the Archive view, not on the board.
    const scoped = intGoals.filter(g =>
        g.status !== 'dropped' &&
        !g.archived &&
        intGoalMatchesVenture(g, intActiveVentureId)
    );

    // Group by lane.
    const byLane = new Map(KANBAN_LANES.map(l => [l.id, []]));
    for (const g of scoped) {
        const lane = intGoalLane(g);
        if (!byLane.has(lane)) continue;
        byLane.get(lane).push(g);
    }
    // Sort each lane by sortOrder.
    for (const [, list] of byLane) list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const limits = intGetKanbanLimits();

    // Mobile tab strip — one chip per lane with count. Visible only on phones
    // via the .int-kanban-tabs CSS class. Tapping a chip scrolls the grid to
    // that lane; the active chip is highlighted by intUpdateKanbanActiveTab()
    // as the user swipes between lanes. Rendered before the grid so it sticks
    // to the top of the viewport while the user scrolls the lane content.
    const tabs = KANBAN_LANES.map(lane => {
        const goals = byLane.get(lane.id);
        const wipLimited = KANBAN_WIP_LANES.includes(lane.id);
        const limit = wipLimited ? limits[lane.id] : 0;
        const over = wipLimited && limit > 0 && goals.length > limit;
        const countColor = over ? '#b91c1c' : 'var(--gray-500)';
        return `<button class="int-kanban-tab" data-lane="${lane.id}"
                       onclick="intScrollKanbanToLane('${lane.id}')"
                       style="--lane-color:${lane.color};border:none;background:transparent;padding:8px 10px 6px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;border-bottom:3px solid transparent;flex:1;min-width:0;">
                    <span style="font-size:11px;font-weight:700;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.03em;white-space:nowrap;">${lane.label}</span>
                    <span style="font-size:10px;color:${countColor};font-variant-numeric:tabular-nums;font-weight:600;">${goals.length}${over && limit ? `/${limit}` : ''}</span>
                </button>`;
    }).join('');

    const cols = KANBAN_LANES.map(lane => {
        const goals = byLane.get(lane.id);
        const wipLimited = KANBAN_WIP_LANES.includes(lane.id);
        const limit = wipLimited ? limits[lane.id] : 0;
        const over = wipLimited && limit > 0 && goals.length > limit;

        // Over-WIP: pink background + red border + red count.
        const colBg = over ? '#fef2f2' : '#f8fafc';
        const colBorder = over ? '#fca5a5' : 'var(--gray-200)';
        const countColor = over ? '#b91c1c' : 'var(--gray-400)';
        const countWeight = over ? '700' : '500';

        // WIP badge — clickable to edit the limit. Hidden on non-WIP-limited lanes.
        const wipBadge = wipLimited
            ? `<button onclick="event.stopPropagation();intPromptKanbanLimit('${lane.id}')"
                       title="Click to set the WIP limit for this lane (0 = no limit)"
                       style="background:${over ? '#fee2e2' : '#f1f5f9'};color:${over ? '#b91c1c' : 'var(--gray-500)'};border:1px solid ${over ? '#fca5a5' : 'var(--gray-200)'};border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;letter-spacing:0.03em;cursor:pointer;text-transform:uppercase;">
                    ${limit > 0 ? `WIP ${limit}` : 'WIP ∞'}
                </button>`
            : '';

        // Per-lane "+" — opens the goal modal with this lane pre-set as the
        // status. Default horizon is weekly (matches the existing mobile FAB
        // default for the kanban view). v4.6.14 — addresses "can't create a
        // card from the Kanban view".
        const addBtn = `<button onclick="event.stopPropagation();intAddGoalToLane('${lane.id}')"
                                title="Add a card to ${lane.label}"
                                style="background:${lane.color};color:white;border:none;border-radius:999px;width:24px;height:24px;font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">+</button>`;

        // Done lane only: archive the whole stack. Archived cards leave the
        // board but stay searchable in the Archive view (Actions rail).
        const archiveBtn = lane.id === 'done' && goals.length
            ? `<button onclick="event.stopPropagation();intArchiveDoneLane()"
                       title="Archive all ${goals.length} done card${goals.length === 1 ? '' : 's'} — they stay searchable in the Archive view"
                       style="background:#f1f5f9;color:var(--gray-500);border:1px solid var(--gray-200);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;letter-spacing:0.03em;cursor:pointer;text-transform:uppercase;">
                    Archive
                </button>`
            : '';

        // Over-limit banner sits below the lane hint, before the cards.
        const warning = over
            ? `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;">
                    🚨 Over WIP: ${goals.length} / ${limit}. Move ${goals.length - limit} card${goals.length - limit === 1 ? '' : 's'} before pulling more.
                </div>`
            : '';

        // Empty-state CTA on mobile gets a tappable "+ Add" link so users on a
        // phone don't have to find the small per-lane "+" in the header. On
        // desktop it falls back to the more subtle "Drop here" hint.
        const empty = `<button onclick="intAddGoalToLane('${lane.id}')"
                               class="int-kanban-empty"
                               style="background:transparent;border:1px dashed var(--gray-300);border-radius:6px;color:var(--gray-400);font-size:12px;padding:14px 4px;font-style:italic;cursor:pointer;text-align:center;">+ Add a card</button>`;
        const cards = goals.length
            ? goals.map(g => intRenderKanbanCard(g, lane.id)).join('')
            : empty;

        // Backlog defaults to collapsed: header stays (count, +, chevron) but
        // the card stack is swapped for a "Show N cards" expander. The column
        // itself keeps its drop handlers, so dragging a card onto a collapsed
        // Backlog still files it there.
        const isBacklog = lane.id === 'backlog';
        const collapsed = isBacklog && !_intBacklogExpanded && goals.length > 0;
        const collapseBtn = isBacklog && goals.length
            ? `<button onclick="event.stopPropagation();intToggleBacklogCollapse()"
                       title="${collapsed ? 'Expand' : 'Collapse'} the Backlog lane"
                       aria-label="${collapsed ? 'Expand' : 'Collapse'} the Backlog lane"
                       style="background:transparent;border:none;color:${lane.color};cursor:pointer;font-size:12px;line-height:1;padding:2px 4px;">${collapsed ? '▸' : '▾'}</button>`
            : '';
        const body = collapsed
            ? `<button onclick="intToggleBacklogCollapse()"
                       style="background:transparent;border:1px dashed var(--gray-300);border-radius:6px;color:var(--gray-500);font-size:12px;padding:10px 4px;cursor:pointer;text-align:center;font-weight:600;">▸ Show ${goals.length} card${goals.length === 1 ? '' : 's'}</button>`
            : `<div style="font-size:11px;color:var(--gray-400);padding:0 4px 6px;">${lane.hint}</div>
                    ${warning}
                    <div class="int-kanban-drop" style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:60px;">
                        ${cards}
                    </div>`;
        return `<div class="int-kanban-col" data-lane="${lane.id}"
                     style="background:${colBg};border:1px solid ${colBorder};border-radius:8px;padding:10px;min-width:240px;display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 6px;border-bottom:2px solid ${lane.color}40;gap:8px;">
                        <span style="font-size:13px;font-weight:700;color:${lane.color};text-transform:uppercase;letter-spacing:0.03em;display:inline-flex;align-items:center;gap:2px;">${collapseBtn}${lane.label}</span>
                        <span style="display:flex;align-items:center;gap:6px;">
                            ${wipBadge}
                            ${archiveBtn}
                            <span style="font-size:11px;color:${countColor};font-variant-numeric:tabular-nums;font-weight:${countWeight};">${goals.length}${over && limit ? `/${limit}` : ''}</span>
                            ${addBtn}
                        </span>
                    </div>
                    ${body}
                </div>`;
    }).join('');

    // Sticky top:48px sits just below the section's sticky `.int-top-header`
    // (Back / Filters / Kanban / Year-View). Both panes stay onscreen while
    // the user scrolls a long lane.
    root.innerHTML = `
        <div class="int-kanban-tabs" role="tablist" aria-label="Kanban lanes"
             style="display:none;position:sticky;top:48px;z-index:50;background:white;border-bottom:1px solid var(--gray-200);margin:0 -16px 8px;padding:0 4px;gap:0;">
            ${tabs}
        </div>
        <div class="int-kanban-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:start;">
            ${cols}
        </div>`;

    intAttachKanbanDrag(root);
    intAttachKanbanScrollSpy(root);
}

// Mobile: open the goal modal pre-set to a specific lane. The default horizon
// is weekly — matches the FAB default for kanban view. Most cards on the board
// are weekly; if it's a quarterly/daily goal the user can swap horizon in the
// modal before saving. Also makes the target lane active so when the modal
// saves and re-renders, the user lands on the lane their new card landed in.
function intAddGoalToLane(laneId) {
    _intKanbanActiveLane = laneId;
    // Adding to a collapsed Backlog expands it so the new card is visible on save.
    if (laneId === 'backlog') _intBacklogExpanded = true;
    intOpenGoalModal('weekly', null, laneId);
}

// Make the target lane the visible "tab page" on mobile. Called by the tab
// strip chips and by the swipe-gesture handler. On desktop the column-active
// CSS rule is gated behind the mobile media query so all lanes stay visible
// regardless of which one carries the class.
function intScrollKanbanToLane(laneId) {
    intUpdateKanbanActiveTab(laneId);
}

// Highlight the tab matching the active lane and toggle which column is
// shown on mobile. Pure DOM work; the caller decides which lane wins.
function intUpdateKanbanActiveTab(laneId) {
    const root = document.getElementById('intKanbanView');
    if (!root) return;
    _intKanbanActiveLane = laneId;
    root.querySelectorAll('.int-kanban-tab').forEach(t => {
        const isActive = t.dataset.lane === laneId;
        t.style.borderBottomColor = isActive ? 'var(--lane-color)' : 'transparent';
        const labelSpan = t.querySelector('span');
        if (labelSpan) {
            labelSpan.style.color = isActive ? 'var(--lane-color)' : 'var(--gray-600)';
        }
    });
    root.querySelectorAll('.int-kanban-col').forEach(c => {
        c.classList.toggle('int-col-active', c.dataset.lane === laneId);
    });
}

// Initialize the active lane on first render and wire up the swipe gesture
// for prev/next lane navigation. v4.6.15 — the IntersectionObserver-based
// scroll spy is gone with the horizontal scroll carousel it watched; the
// active lane is now driven directly by the tab strip and the swipe handler.
function intAttachKanbanScrollSpy(root) {
    const cols = Array.from(root.querySelectorAll('.int-kanban-col'));
    if (!cols.length) return;
    // Restore the previously-active lane across re-renders; fall back to the
    // first lane on initial mount or if the saved lane no longer exists.
    const preserved = _intKanbanActiveLane && cols.find(c => c.dataset.lane === _intKanbanActiveLane);
    intUpdateKanbanActiveTab((preserved || cols[0]).dataset.lane);

    // Swipe left/right on the lane content steps to the prev/next lane.
    // Threshold + horizontal-dominance check avoids triggering on vertical
    // scrolls and small accidental movements (e.g. while tapping a card).
    const grid = root.querySelector('.int-kanban-grid');
    if (!grid) return;
    let startX = 0, startY = 0, tracking = false;
    grid.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
    }, { passive: true });
    grid.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const active = root.querySelector('.int-kanban-col.int-col-active') || cols[0];
        const idx = cols.indexOf(active);
        const nextIdx = dx < 0 ? Math.min(idx + 1, cols.length - 1) : Math.max(idx - 1, 0);
        if (nextIdx !== idx) intUpdateKanbanActiveTab(cols[nextIdx].dataset.lane);
    }, { passive: true });
}

function intRenderKanbanCard(g, currentLaneId) {
    const ventures = intGoalVentureIds(g).map(id => intVentureById(id)).filter(Boolean);
    const dotColor = ventures[0] ? (ventures[0].color || '#3b82f6') : '#cbd5e1';
    const prio = g.priority || 0;
    const prioCfg = prio === 1 ? { bg: '#fee2e2', fg: '#b91c1c', label: 'P1' }
                  : prio === 2 ? { bg: '#fef3c7', fg: '#92400e', label: 'P2' }
                  : prio === 3 ? { bg: '#dbeafe', fg: '#1e40af', label: 'P3' }
                  : null;
    // 2-letter so it doesn't collide with the Working lane label.
    const horizonTag = g.horizon ? intHorizonShort(g.horizon) : '';
    const blockerIds = intGoalBlockedByIds(g);
    const openBlockers = blockerIds.map(id => intGoals.find(x => x.id === id)).filter(b => b && b.status !== 'done' && b.status !== 'dropped').length;

    // Time tracked via Office Work timers tagged to this goal. The horizon-view
    // card has shown this since v4.6.8; the Kanban card mirrors it now so a user
    // who lands on Kanban (e.g. via timer-stop autonav) sees the just-logged
    // minutes on the right card without having to swap views.
    // v4.6.20: also shows the session count — click the card to see each
    // session listed in the details modal.
    const goalSessions = intSessionsForGoal(g.id);
    const owMin = intMinutesTrackedForGoal(g.id);
    const owChip = owMin > 0
        ? (() => {
            const h = Math.floor(owMin / 60), m = owMin % 60;
            const label = h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
            const n = goalSessions.length;
            return `<span title="${n} session${n === 1 ? '' : 's'} tracked via Office Work — click the card to see them" style="background:#ecfeff;color:#0e7490;border-radius:3px;padding:0 5px;font-size:10px;font-weight:600;">⏱ ${label}${n > 1 ? ` · ${n}` : ''}</span>`;
        })()
        : '';

    // Due date — amber once overdue (unless the card is already done).
    const dueChip = (() => {
        if (!g.targetDate) return '';
        const today = intPeriods.today || new Date().toISOString().slice(0, 10);
        const overdue = g.targetDate < today && intGoalLane(g) !== 'done';
        const label = new Date(g.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<span title="Due ${intEscape(g.targetDate)}${overdue ? ' — overdue' : ''}"
                      style="background:${overdue ? '#fee2e2' : '#f3f4f6'};color:${overdue ? '#b91c1c' : '#475569'};border-radius:3px;padding:0 5px;font-size:10px;font-weight:600;">📅 ${label}</span>`;
    })();

    // Quick "log a session" affordance — opens the Office Work session modal
    // with this goal preselected, no trip through the details modal needed.
    const addSessBtn = `<button onclick="event.stopPropagation();intLogSessionForGoal('${intEscape(g.id)}')"
                                title="Log a session against this card"
                                aria-label="Log a session against this card"
                                style="background:transparent;border:none;color:var(--gray-400);cursor:pointer;font-size:12px;line-height:1;padding:2px 4px;border-radius:3px;flex-shrink:0;">⏱+</button>`;

    // v4.6.14 — "Move to…" kebab. Drag-and-drop is unusable on touch; this
    // gives a tap-only path to relocate a card. event.stopPropagation prevents
    // the card's own onclick (which opens the edit modal) from firing.
    const moveBtn = `<button onclick="event.stopPropagation();intOpenKanbanMoveMenu(event,'${intEscape(g.id)}','${currentLaneId || ''}')"
                             title="Move to another lane"
                             aria-label="Move card to another lane"
                             style="background:transparent;border:none;color:var(--gray-400);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:3px;flex-shrink:0;">⋯</button>`;

    return `<div class="int-kanban-card" draggable="true" data-goal-id="${intEscape(g.id)}"
                 onclick="intOpenGoalModal('${g.horizon}','${g.id}')"
                 style="background:white;border:1px solid var(--gray-200);border-left:4px solid ${intEscape(dotColor)};border-radius:6px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:4px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
                    <span style="font-weight:600;color:var(--gray-800);line-height:1.3;flex:1;">${intEscape(g.title)}</span>
                    <span style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                        <span style="font-size:10px;color:var(--gray-400);font-weight:600;">${horizonTag}</span>
                        ${addSessBtn}
                        ${moveBtn}
                    </span>
                </div>
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                    ${prioCfg ? `<span style="background:${prioCfg.bg};color:${prioCfg.fg};border-radius:3px;padding:0 5px;font-size:10px;font-weight:700;">${prioCfg.label}</span>` : ''}
                    ${g.size ? `<span style="background:#f3f4f6;color:#475569;border:1px solid #e5e7eb;border-radius:3px;padding:0 5px;font-size:10px;font-weight:600;">${intEscape(g.size)}</span>` : ''}
                    ${openBlockers ? `<span title="${openBlockers} open blocker${openBlockers === 1 ? '' : 's'}" style="background:#fef3c7;color:#92400e;border-radius:3px;padding:0 5px;font-size:10px;font-weight:600;">⛓ ${openBlockers}</span>` : ''}
                    ${dueChip}
                    ${owChip}
                    ${ventures.length ? ventures.slice(0, 2).map(vv => `<span style="background:${intEscape(vv.color || '#3b82f6')}22;color:${intEscape(vv.color || '#3b82f6')};border-radius:3px;padding:0 5px;font-size:10px;font-weight:500;">${vv.icon ? intEscape(vv.icon) + ' ' : ''}${intEscape(vv.name)}</span>`).join('') : ''}
                    ${ventures.length > 2 ? `<span style="color:var(--gray-400);font-size:10px;">+${ventures.length - 2}</span>` : ''}
                </div>
            </div>`;
}

// "Move to…" popover — anchored to the kebab, lists all lanes except the
// card's current one. Tapping a lane moves the card via the same
// intMoveGoalToLane() path that drag-and-drop uses, so the existing optimistic
// update + WIP-limit handling apply unchanged.
function intOpenKanbanMoveMenu(event, goalId, currentLaneId) {
    intCloseKanbanMoveMenu();
    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'intKanbanMoveMenu';
    // Position fixed so the popover floats above any scroll container; the
    // menu reads near the kebab and is dismissed by the next outside-click.
    const top = rect.bottom + 4;
    const right = Math.max(8, window.innerWidth - rect.right);
    menu.style.cssText = `position:fixed;top:${top}px;right:${right}px;background:white;border:1px solid var(--gray-200);border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,0.16);padding:6px;z-index:200;display:flex;flex-direction:column;gap:2px;min-width:160px;`;
    const items = KANBAN_LANES
        .filter(l => l.id !== currentLaneId)
        .map(l => `<button onclick="intKanbanMoveCard('${intEscape(goalId)}','${l.id}')"
                          style="background:transparent;border:none;text-align:left;padding:8px 10px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gray-800);">
                    <span style="width:10px;height:10px;border-radius:50%;background:${l.color};flex-shrink:0;"></span>
                    Move to ${l.label}
                </button>`).join('');
    menu.innerHTML = items;
    document.body.appendChild(menu);
    // Defer the outside-click handler one tick so the triggering tap doesn't
    // immediately close the menu it just opened.
    setTimeout(() => {
        document.addEventListener('click', intCloseKanbanMoveMenuOnOutside, { capture: true });
    }, 0);
}

function intCloseKanbanMoveMenu() {
    const existing = document.getElementById('intKanbanMoveMenu');
    if (existing) existing.remove();
    document.removeEventListener('click', intCloseKanbanMoveMenuOnOutside, { capture: true });
}

function intCloseKanbanMoveMenuOnOutside(e) {
    const menu = document.getElementById('intKanbanMoveMenu');
    if (menu && !menu.contains(e.target)) intCloseKanbanMoveMenu();
}

async function intKanbanMoveCard(goalId, newLane) {
    intCloseKanbanMoveMenu();
    await intMoveGoalToLane(goalId, newLane);
}

function intAttachKanbanDrag(root) {
    let draggedId = null;
    root.querySelectorAll('.int-kanban-card').forEach(card => {
        card.addEventListener('dragstart', (e) => {
            draggedId = card.dataset.goalId;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedId);
            card.style.opacity = '0.4';
        });
        card.addEventListener('dragend', () => {
            card.style.opacity = '';
            root.querySelectorAll('.int-kanban-col').forEach(c => { c.style.outline = ''; c.style.outlineOffset = ''; });
        });
    });
    root.querySelectorAll('.int-kanban-col').forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            root.querySelectorAll('.int-kanban-col').forEach(c => { c.style.outline = ''; c.style.outlineOffset = ''; });
            col.style.outline = '2px dashed #3b82f6';
            col.style.outlineOffset = '-2px';
        });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain') || draggedId;
            const newLane = col.dataset.lane;
            if (!id || !newLane) return;
            await intMoveGoalToLane(id, newLane);
        });
    });
}

async function intMoveGoalToLane(goalId, newLane) {
    const g = intGoals.find(x => x.id === goalId);
    if (!g) return;
    const currentLane = intGoalLane(g);
    if (currentLane === newLane) return;

    // Optimistic update.
    const previousStatus = g.status;
    g.status = newLane;
    renderIntention();

    try {
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save-goal',
                id: goalId,
                horizon: g.horizon,
                title: g.title,
                status: newLane,
            }),
        });
        await loadIntention();
    } catch (err) {
        showToast('Could not move goal', 'error');
        g.status = previousStatus;
        renderIntention();
    }
}

// ──────────────── export goal history ────────────────

function intExportGoals() {
    // Build a flat CSV of ventures, goals, and checkins so the file is portable
    // (one row per record kind). JSON is offered alongside as a sibling download.
    const rowsV = intVentures.map(v => ({
        kind: 'venture', id: v.id, name: v.name, status: v.status,
        color: v.color, icon: v.icon || '', tagline: v.tagline || '',
        createdAt: v.createdAt, updatedAt: v.updatedAt,
    }));
    const rowsG = intGoals.map(g => ({
        kind: 'goal', id: g.id, ventureId: g.ventureId || '',
        horizon: g.horizon, title: g.title, why: g.why || '',
        targetValue: g.targetValue || '', targetDate: g.targetDate || '',
        status: g.status, parentGoalId: g.parentGoalId || '',
        createdAt: g.createdAt, updatedAt: g.updatedAt,
    }));
    const rowsC = intRecentCheckins.map(c => ({
        kind: 'checkin', id: c.id, goalId: c.goalId, date: c.date,
        value: c.value || '', progressNote: c.progressNote || '',
        createdAt: c.createdAt,
    }));

    const allRows = [...rowsV, ...rowsG, ...rowsC];
    const allKeys = Array.from(allRows.reduce((set, r) => {
        for (const k of Object.keys(r)) set.add(k);
        return set;
    }, new Set()));
    const esc = s => {
        const str = String(s == null ? '' : s);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [
        allKeys.join(','),
        ...allRows.map(r => allKeys.map(k => esc(r[k])).join(',')),
    ].join('\n');

    const json = JSON.stringify({
        exportedAt: new Date().toISOString(),
        ventures: intVentures,
        goals: intGoals,
        checkins: intRecentCheckins,
    }, null, 2);

    const today = new Date().toISOString().slice(0, 10);
    _intDownloadFile(`intention-${today}.csv`, csv, 'text/csv');
    _intDownloadFile(`intention-${today}.json`, json, 'application/json');
    showToast('Exported CSV + JSON', 'success');
}

function _intDownloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function intToggleCheckin(goalId) {
    const isChecked = intIsCheckedToday(goalId);
    // Optimistic UI — flip locally, then sync.
    if (isChecked) intTodayCheckinsByGoal.delete(goalId);
    else intTodayCheckinsByGoal.set(goalId, { c: 1, v: 0 });
    renderIntention();
    if (typeof renderTodayGoalsWidget === 'function') renderTodayGoalsWidget();

    try {
        const body = isChecked
            ? { action: 'uncheckin', goalId }
            : { action: 'checkin', goalId };
        await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        // apiFetch throws on non-2xx; reaching here means the checkin landed.
        // Reload so rollups (total checkins per goal) stay accurate.
        await loadIntention();
    } catch (err) {
        showToast('Could not save checkin', 'error');
        // Revert the optimistic flip on failure.
        if (isChecked) intTodayCheckinsByGoal.set(goalId, { c: 1, v: 0 });
        else intTodayCheckinsByGoal.delete(goalId);
        renderIntention();
        if (typeof renderTodayGoalsWidget === 'function') renderTodayGoalsWidget();
    }
}
