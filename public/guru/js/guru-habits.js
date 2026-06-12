/* ==========================================================================
   Guru Dashboard — Habits Module
   Habit tracking, stacks, heatmap, stats
   ========================================================================== */

// ==================== HABITS ====================
let habits = [];
let habitLogs = [];
let todayLogsData = [];
let weekLogsData = [];
let monthLogsData = [];
const customStackGroups = new Set();
let habitView = 'today';
let stepsData = [];
let stepGoal = 8000;
let habitStatsSort = 'name';

function switchHabitView(mode) {
    habitView = mode;
    document.querySelectorAll('.habit-view-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.habit-view-btn[data-mode="${mode}"]`)?.classList.add('active');
    document.querySelectorAll('.habit-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('habit-panel-' + mode);
    if (panel) panel.style.display = '';
    renderHabits();
}

function isHabitDone(h) {
    // When scheduleDays is set, completion is always per-day regardless of frequency
    if (h.scheduleDays) return todayLogsData.some(l => l.habitId === h.id);
    const freq = h.frequency || 'daily';
    if (freq === 'weekly') return weekLogsData.some(l => l.habitId === h.id);
    if (freq === 'monthly') return monthLogsData.some(l => l.habitId === h.id);
    return todayLogsData.some(l => l.habitId === h.id);
}

async function loadHabits() {
    let data;
    try {
        const localToday = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
        const [habitsRes, stepsRes, settingsRes] = await Promise.all([
            apiFetch('/api/habits?today=' + localToday),
            apiFetch('/api/steps').catch(() => ({ steps: [] })),
            apiFetch('/api/settings').catch(() => ({})),
        ]);
        data = habitsRes;
        stepsData = stepsRes.steps || [];
        stepGoal = parseInt(settingsRes.stepGoal) || 8000;
    } catch (e) {
        const el = document.getElementById('habitTodayList');
        if (!el) return;
        // Diagnostic: raw fetch to see what the server actually returns
        let diag = '';
        try {
            const raw = await fetch('/api/habits?today=' + new Date().toLocaleDateString('en-CA'));
            const ct = raw.headers.get('content-type') || 'no content-type';
            const snippet = await raw.text();
            diag = 'Status: ' + raw.status + ' | Type: ' + ct + ' | Redirected: ' + raw.redirected + ' | Body: ' + snippet.slice(0, 120);
        } catch (de) { diag = 'Fetch failed: ' + (de.message || de); }
        const safe = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        el.innerHTML = '<div class="empty-state">'
            + '<p>Failed to load habits. <span style="font-size:11px;color:var(--gray-400);">(v4.3.9)</span></p>'
            + '<p style="font-size:13px;color:#ef4444;margin-top:8px;font-weight:600;">Error: ' + safe(e.message || 'Unknown') + '</p>'
            + '<p style="font-size:11px;color:var(--gray-500);margin-top:8px;word-break:break-all;text-align:left;background:var(--gray-100);padding:8px;border-radius:4px;">' + safe(diag) + '</p>'
            + '<button class="btn btn-primary" style="margin-top:12px;" onclick="loadHabits()">Try Again</button>'
            + '</div>';
        return;
    }
    habits = data.habits || [];
    todayLogsData = data.todayLogs || [];
    habitLogs = data.recentLogs || [];
    weekLogsData = data.weekLogs || [];
    monthLogsData = data.monthLogs || [];
    try { renderHabits(); } catch (e) { console.error('renderHabits error:', e); }
    // Show seed prompt if no habits
    const seedEl = document.getElementById('habitSeedPrompt');
    if (seedEl) seedEl.style.display = habits.length === 0 ? '' : 'none';
    // Check gold list habit auto-complete (goldlist may have loaded before habits)
    checkGoldListHabitAutoComplete();
    // Check steps habit auto-complete (today's steps >= goal)
    checkStepsHabitAutoComplete();
}

function renderHabits() {
    renderHabitStatBar();
    if (habitView === 'today') renderHabitsToday();
    else renderHabitsStatsView();
}

function checkStepsHabitAutoComplete() {
    if (!habits.length || !stepsData.length) return;
    const today = new Date().toLocaleDateString('en-CA');
    const todayEntry = stepsData.find(s => s.date === today);
    const todaySteps = todayEntry ? todayEntry.steps : 0;
    if (todaySteps < stepGoal) return;
    const stepsHabit = habits.find(h =>
        h.status === 'active' && h.name && h.name.toLowerCase().includes('step') && !isHabitDone(h)
    );
    if (stepsHabit) {
        toggleHabit(stepsHabit.id, false);
    }
}

function renderHabitStatBar() {
    const active = habits.filter(h => h.status === 'active');
    const doneCount = active.filter(h => isHabitDone(h)).length;
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    el('habitStatToday', doneCount + '/' + active.length);

    // Yesterday's habit count
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');
    const yesterdayCount = habitLogs.filter(l => l.date === yesterdayStr).length;
    el('habitStatYesterday', yesterdayCount);

    // Yesterday's steps
    const yesterdayStepEntry = stepsData.find(s => s.date === yesterdayStr);
    const yesterdaySteps = yesterdayStepEntry ? yesterdayStepEntry.steps : 0;
    el('habitStatYesterdaySteps', yesterdaySteps.toLocaleString());

    // Today's steps
    const today = new Date().toLocaleDateString('en-CA');
    const todayStepEntry = stepsData.find(s => s.date === today);
    const todaySteps = todayStepEntry ? todayStepEntry.steps : 0;
    el('habitStatSteps', todaySteps.toLocaleString());
}

function toggleStepCounterCard() {
    const el = document.getElementById('habitStepCounterCard');
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function toggleHabitHistoryCard() {
    const el = document.getElementById('habitHistoryCard');
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

const DAY_ABBRS = ['sun','mon','tue','wed','thu','fri','sat'];

function buildDayPicker(idSuffix, selectedDays) {
    const days = selectedDays ? selectedDays.split(',').map(s => s.trim()) : [];
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const vals = ['mon','tue','wed','thu','fri','sat','sun'];
    return vals.map((v, i) =>
        `<label style="font-size:11px;display:flex;align-items:center;gap:2px;cursor:pointer;">` +
        `<input type="checkbox" class="hf-day-${idSuffix}" value="${v}" ${days.includes(v) ? 'checked' : ''}> ${labels[i]}</label>`
    ).join('');
}

function isHabitScheduledToday(h) {
    if (!h.scheduleDays) return true;
    const days = h.scheduleDays.split(',').map(s => s.trim());
    return days.includes(DAY_ABBRS[new Date().getDay()]);
}

function renderHabitsToday() {
    const container = document.getElementById('habitTodayList');
    const active = habits.filter(h => h.status === 'active' && isHabitScheduledToday(h));
    if (active.length === 0) {
        const totalActive = habits.filter(h => h.status === 'active').length;
        container.innerHTML = totalActive > 0
            ? '<div class="empty-state"><p>No habits scheduled for today.</p></div>'
            : '<div class="empty-state"><p>No habits yet. Add your first habit or seed starter habits below!</p></div>';
        return;
    }

    // Group by stackGroup
    const groups = {};
    const ungrouped = [];
    for (const h of active) {
        if (h.stackGroup) {
            if (!groups[h.stackGroup]) groups[h.stackGroup] = [];
            groups[h.stackGroup].push(h);
        } else {
            ungrouped.push(h);
        }
    }
    for (const g of Object.values(groups)) g.sort((a, b) => (a.stackOrder || 0) - (b.stackOrder || 0));

    let html = `<div id="habitStepCounterCard" style="display:none;">${renderStepCounter()}</div>`;
    html += `<div id="habitHistoryCard" style="display:none;">${renderHabitHistory()}</div>`;
    // Sort groups by minimum stackOrder of their habits
    const sortedGroupNames = Object.keys(groups).sort((a, b) => {
        const aMin = Math.min(...groups[a].map(h => h.stackOrder || 0));
        const bMin = Math.min(...groups[b].map(h => h.stackOrder || 0));
        return aMin - bMin;
    });

    // Collect ALL stack group names (active + archived + custom) for the <select> dropdown
    const allGroupNames = new Set(sortedGroupNames);
    for (const h of habits) {
        if (h.stackGroup) allGroupNames.add(h.stackGroup);
    }
    for (const cg of customStackGroups) {
        allGroupNames.add(cg);
    }
    for (let gi = 0; gi < sortedGroupNames.length; gi++) {
        const gn = sortedGroupNames[gi];
        html += '<div class="habit-stack-group">';
        html += `<div class="stack-header">`;
        html += `<span class="stack-header-label" onclick="renameStackGroup('${esc(gn)}')" title="Click to rename">${esc(gn)}</span>`;
        html += `<div class="stack-header-actions">`;
        if (gi > 0) html += `<button onclick="moveStackGroup('${esc(gn)}',-1)" title="Move up">&uarr;</button>`;
        if (gi < sortedGroupNames.length - 1) html += `<button onclick="moveStackGroup('${esc(gn)}',1)" title="Move down">&darr;</button>`;
        html += `<button onclick="removeStackGroup('${esc(gn)}')" title="Ungroup habits">&times;</button>`;
        html += `</div></div>`;
        const grpHabits = groups[gn];
        for (let hi = 0; hi < grpHabits.length; hi++) {
            html += buildHabitItem(grpHabits[hi], isHabitDone(grpHabits[hi]), hi, grpHabits.length, allGroupNames);
        }
        html += '</div>';
    }
    if (ungrouped.length > 0) {
        if (sortedGroupNames.length > 0) html += '<div class="habit-stack-group"><div class="stack-header"><span>Other</span></div>';
        for (let hi = 0; hi < ungrouped.length; hi++) {
            html += buildHabitItem(ungrouped[hi], isHabitDone(ungrouped[hi]), hi, ungrouped.length, allGroupNames);
        }
        if (sortedGroupNames.length > 0) html += '</div>';
    }
    container.innerHTML = html;
}

function getAllStackGroupNames() {
    const names = new Set();
    for (const h of habits) {
        if (h.stackGroup) names.add(h.stackGroup);
    }
    for (const cg of customStackGroups) names.add(cg);
    return names;
}

function buildStackGroupOptions(allGroupNames, selected) {
    let opts = `<option value=""${!selected ? ' selected' : ''}>None</option>`;
    for (const g of [...allGroupNames].sort((a, b) => a.localeCompare(b))) {
        opts += `<option value="${esc(g)}"${g === selected ? ' selected' : ''}>${esc(g)}</option>`;
    }
    opts += '<option value="__new__">+ New group...</option>';
    return opts;
}

// Intention linkage — venture + goal selectors shared across the inline habit forms.
// Reads from intVentures / intGoals (loaded eagerly by guru-intention.js at init time).
function buildVentureOptions(selectedVentureId) {
    const all = (typeof intVentures !== 'undefined' && intVentures) ? intVentures : [];
    // Active first, paused, archived; archived shown but de-emphasized via label suffix.
    const order = { active: 0, paused: 1, archived: 2 };
    const sorted = [...all].sort((a, b) => (order[a.status] || 3) - (order[b.status] || 3));
    let opts = `<option value=""${!selectedVentureId ? ' selected' : ''}>— Personal —</option>`;
    for (const v of sorted) {
        const lbl = (v.icon ? v.icon + ' ' : '') + v.name + (v.status !== 'active' ? ' (' + v.status + ')' : '');
        opts += `<option value="${esc(v.id)}"${v.id === selectedVentureId ? ' selected' : ''}>${esc(lbl)}</option>`;
    }
    return opts;
}

function buildGoalOptions(ventureIdFilter, selectedGoalId) {
    const all = (typeof intGoals !== 'undefined' && intGoals) ? intGoals : [];
    // Show goals scoped to the picked venture; "Personal" venture shows venture-less goals.
    // Always show goals matching the selected goalId so a habit linked to a different
    // venture's goal doesn't silently lose its link when the venture filter narrows.
    const candidates = all.filter(g =>
        g.status !== 'dropped' && (
            g.ventureId === (ventureIdFilter || '') ||
            g.id === selectedGoalId
        )
    );
    // Group by horizon for readability: quarterly first (strategic), then weekly, then daily.
    const horizonOrder = { quarterly: 0, yearly: 1, weekly: 2, daily: 3 };
    const sorted = candidates.sort((a, b) =>
        ((horizonOrder[a.horizon] ?? 9) - (horizonOrder[b.horizon] ?? 9)) ||
        (a.sortOrder || 0) - (b.sortOrder || 0)
    );
    let opts = `<option value=""${!selectedGoalId ? ' selected' : ''}>— None —</option>`;
    for (const g of sorted) {
        const lbl = `[${g.horizon}] ${g.title}`;
        opts += `<option value="${esc(g.id)}"${g.id === selectedGoalId ? ' selected' : ''}>${esc(lbl)}</option>`;
    }
    return opts;
}

// Re-populate the goal dropdown when the venture selector changes.
function hfRebuildGoalOptions(id) {
    const venEl = document.getElementById('hf-venture-' + id);
    const goalEl = document.getElementById('hf-goal-' + id);
    if (!venEl || !goalEl) return;
    // Preserve the current selection if the goal still belongs to the new venture; otherwise clear.
    const all = (typeof intGoals !== 'undefined' && intGoals) ? intGoals : [];
    const current = goalEl.value;
    const stillValid = all.some(g => g.id === current && g.ventureId === venEl.value);
    goalEl.innerHTML = buildGoalOptions(venEl.value, stillValid ? current : '');
}

function onStackGroupChange(selectEl) {
    if (selectEl.value === '__new__') {
        const name = prompt('New stack group name:');
        if (name && name.trim()) {
            const trimmed = name.trim();
            customStackGroups.add(trimmed);
            // Add the new option before the "+ New group..." option
            const newOpt = document.createElement('option');
            newOpt.value = trimmed;
            newOpt.textContent = trimmed;
            const newGroupOpt = selectEl.querySelector('option[value="__new__"]');
            selectEl.insertBefore(newOpt, newGroupOpt);
            selectEl.value = trimmed;
        } else {
            // User cancelled — revert to previous value
            selectEl.value = selectEl.dataset.prev || '';
        }
    }
    selectEl.dataset.prev = selectEl.value;
}

function buildHabitItem(h, done, idx, total, allGroupNames) {
    const freq = h.frequency || 'daily';
    const streakUnit = freq === 'weekly' ? 'week' : freq === 'monthly' ? 'month' : 'day';
    const streak = h.currentStreak > 0
        ? `<span class="habit-streak">&#128293; ${h.currentStreak} ${streakUnit}${h.currentStreak !== 1 ? 's' : ''}</span>` : '';
    // When scheduleDays is set, the day badge replaces the W/M frequency badge (which would be misleading)
    let freqBadge = '';
    if (h.scheduleDays) {
        const dayLabels = h.scheduleDays.split(',').map(d => d.trim().charAt(0).toUpperCase() + d.trim().slice(1)).join('/');
        freqBadge = `<span class="habit-freq-badge" style="background:var(--gray-100);color:var(--gray-500);">${dayLabels}</span>`;
    } else if (freq !== 'daily') {
        freqBadge = `<span class="habit-freq-badge">${freq === 'weekly' ? 'W' : 'M'}</span>`;
    }
    const totalStr = `<span class="habit-total">${h.totalCompletions || 0} total</span>`;
    let arrows = '<div class="habit-move-btns">';
    if (idx > 0) arrows += `<button onclick="moveHabitInStack('${h.id}',-1)" title="Move up">&uarr;</button>`;
    if (idx < total - 1) arrows += `<button onclick="moveHabitInStack('${h.id}',1)" title="Move down">&darr;</button>`;
    arrows += '</div>';
    const catOpts = ['health','learning','wellness','social','general'].map(c =>
        `<option value="${c}" ${(h.category||'general')===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('');
    const freqOpts = ['daily','weekly','monthly'].map(f =>
        `<option value="${f}" ${freq===f?'selected':''}>${f.charAt(0).toUpperCase()+f.slice(1)}</option>`).join('');
    const log = getHabitLog(h.id);
    const noteText = log ? (log.notes || '') : '';
    const noteIcon = done
        ? `<button class="habit-note-toggle ${noteText ? 'has-note' : ''}" onclick="toggleHabitNote('${h.id}')" title="${noteText ? 'Edit note' : 'Add note'}">&#9998;</button>`
        : '';
    const noteRow = done
        ? `<div class="habit-note-row" id="habit-note-${h.id}" style="display:none;"></div>`
        : '';
    // Value input for habits that track a value
    let valueInput = '';
    if (h.valueType && !done) {
        const label = h.valueLabel || (h.valueType === 'duration' ? 'min' : '#');
        valueInput = `<input type="number" id="hv-${h.id}" step="0.1" min="0" placeholder="${esc(label)}" style="width:60px;padding:3px 6px;font-size:12px;border:1px solid var(--gray-300);border-radius:4px;">`;
    }
    let valueDisplay = '';
    if (h.valueType && done) {
        const logVal = log ? log.value : 0;
        if (logVal > 0) {
            const label = h.valueLabel || (h.valueType === 'duration' ? 'min' : '');
            valueDisplay = `<span style="font-size:12px;color:var(--primary);font-weight:600;margin-left:4px;">${logVal} ${esc(label)}</span>`;
        }
    }
    return `<div class="habit-row" id="habit-row-${h.id}">
        <div class="habit-item ${done ? 'completed' : ''}">
            <input type="checkbox" ${done ? 'checked' : ''} onchange="toggleHabit('${h.id}',${done})">
            <span class="habit-name">${esc(h.name)}</span>${freqBadge}${valueDisplay}
            ${valueInput}
            ${streak}${totalStr}
            ${noteIcon}
            ${arrows}
            <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="toggleInlineEdit('${h.id}')">Edit</button>
        </div>
        ${noteText ? `<div class="habit-note-row" id="habit-note-${h.id}"><div class="habit-note-display" onclick="toggleHabitNote('${h.id}')">${esc(noteText)}</div></div>` : `<div class="habit-note-row" id="habit-note-${h.id}" style="display:none;"></div>`}
        <div class="habit-inline-form" id="habit-edit-${h.id}" style="display:none;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Name</label>
                    <input type="text" id="hf-name-${h.id}" value="${esc(h.name)}" style="font-size:13px;padding:6px 8px;"></div>
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Category</label>
                    <select id="hf-cat-${h.id}" style="font-size:13px;padding:6px 8px;">${catOpts}</select></div>
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Frequency</label>
                    <select id="hf-freq-${h.id}" style="font-size:13px;padding:6px 8px;">${freqOpts}</select></div>
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Stack Group</label>
                    <select id="hf-stack-${h.id}" onchange="onStackGroupChange(this)" data-prev="${esc(h.stackGroup||'')}" style="font-size:13px;padding:6px 8px;">${buildStackGroupOptions(allGroupNames || new Set(), h.stackGroup||'')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Track Value</label>
                    <select id="hf-vtype-${h.id}" style="font-size:13px;padding:6px 8px;"><option value="">None</option><option value="duration" ${(h.valueType||'')==='duration'?'selected':''}>Duration</option><option value="count" ${(h.valueType||'')==='count'?'selected':''}>Count</option></select></div>
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Value Label</label>
                    <input type="text" id="hf-vlabel-${h.id}" value="${esc(h.valueLabel||'')}" placeholder="e.g. minutes, words, people" style="font-size:13px;padding:6px 8px;"></div>
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Schedule Days <span style="font-weight:400;">(empty = every day)</span></label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">${buildDayPicker(h.id, h.scheduleDays || '')}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Venture</label>
                    <select id="hf-venture-${h.id}" onchange="hfRebuildGoalOptions('${h.id}')" style="font-size:13px;padding:6px 8px;">${buildVentureOptions(h.ventureId || '')}</select></div>
                <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Goal (rolls up into)</label>
                    <select id="hf-goal-${h.id}" style="font-size:13px;padding:6px 8px;">${buildGoalOptions(h.ventureId || '', h.goalId || '')}</select></div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-primary" style="padding:4px 14px;font-size:12px;" onclick="saveInlineEdit('${h.id}')">Save</button>
                <button class="btn btn-secondary" style="padding:4px 14px;font-size:12px;" onclick="toggleInlineEdit('${h.id}')">Cancel</button>
                <button class="btn btn-secondary" style="margin-left:auto;padding:4px 14px;font-size:12px;" onclick="archiveHabitById('${h.id}')" title="Hide from list, keep stats">Archive</button>
                <button class="btn" style="padding:4px 14px;font-size:12px;background:#ef4444;color:white;border-color:#ef4444;" onclick="deleteHabitById('${h.id}')">Delete</button>
            </div>
        </div>
    </div>`;
}

function getHabitLog(habitId) {
    const h = habits.find(x => x.id === habitId);
    const freq = h ? (h.frequency || 'daily') : 'daily';
    if (freq === 'weekly') return weekLogsData.find(l => l.habitId === habitId) || null;
    if (freq === 'monthly') return monthLogsData.find(l => l.habitId === habitId) || null;
    return todayLogsData.find(l => l.habitId === habitId) || null;
}

async function toggleHabit(id, currentlyDone, explicitValue) {
    const action = currentlyDone ? 'uncomplete' : 'complete';
    const localToday = new Date().toLocaleDateString('en-CA');
    const payload = { action, id, today: localToday };

    // If completing a habit that tracks a value, prompt for it
    if (!currentlyDone) {
        if (explicitValue !== undefined) {
            payload.value = explicitValue;
        } else {
            const h = habits.find(x => x.id === id);
            if (h && h.valueType) {
                const valInput = document.getElementById('hv-' + id);
                if (valInput && valInput.value) {
                    payload.value = parseFloat(valInput.value) || 0;
                }
            }
        }
    }

    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify(payload) });
        showToast(action === 'complete' ? 'Habit completed!' : 'Unchecked.', 'success');
        await loadHabits();
    } catch (e) { showToast('Failed to update habit.', 'error'); }
}

async function togglePastHabit(id, date, currentlyDone) {
    const action = currentlyDone ? 'uncomplete' : 'complete';
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action, id, today: date }) });
        await loadHabits();
    } catch (e) { showToast('Failed to update habit.', 'error'); }
}

function toggleHabitNote(habitId) {
    const row = document.getElementById('habit-note-' + habitId);
    if (!row) return;
    const isVisible = row.style.display !== 'none';
    if (isVisible && row.querySelector('.habit-note-input')) {
        // Save and close
        const input = row.querySelector('.habit-note-input');
        saveHabitNote(habitId, input.value);
        return;
    }
    const log = getHabitLog(habitId);
    const noteText = log ? (log.notes || '') : '';
    row.style.display = '';
    row.innerHTML = `<textarea class="habit-note-input" rows="2" placeholder="Add a note (e.g. 20 min, leg day...)"
        onblur="saveHabitNote('${habitId}', this.value)"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}">${esc(noteText)}</textarea>`;
    row.querySelector('.habit-note-input').focus();
}

async function saveHabitNote(habitId, text) {
    const trimmed = (text || '').trim();
    const log = getHabitLog(habitId);
    const oldNote = log ? (log.notes || '') : '';
    if (trimmed === oldNote) {
        // No change — just update display
        const row = document.getElementById('habit-note-' + habitId);
        if (row) {
            if (trimmed) {
                row.innerHTML = `<div class="habit-note-display" onclick="toggleHabitNote('${habitId}')">${esc(trimmed)}</div>`;
            } else {
                row.style.display = 'none';
                row.innerHTML = '';
            }
        }
        return;
    }
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'update-note', id: habitId, notes: trimmed }) });
        // Update local log data
        if (log) log.notes = trimmed;
        const row = document.getElementById('habit-note-' + habitId);
        if (row) {
            if (trimmed) {
                row.innerHTML = `<div class="habit-note-display" onclick="toggleHabitNote('${habitId}')">${esc(trimmed)}</div>`;
            } else {
                row.style.display = 'none';
                row.innerHTML = '';
            }
        }
        // Update note toggle icon
        const toggle = document.querySelector(`#habit-row-${habitId} .habit-note-toggle`);
        if (toggle) toggle.classList.toggle('has-note', !!trimmed);
    } catch (e) { showToast('Failed to save note.', 'error'); }
}

let _openEditId = null;

function toggleInlineEdit(id) {
    // Close any other open edit
    if (_openEditId && _openEditId !== id) {
        const prev = document.getElementById('habit-edit-' + _openEditId);
        if (prev) prev.style.display = 'none';
    }
    const el = document.getElementById('habit-edit-' + id);
    if (!el) return;
    const showing = el.style.display !== 'none';
    el.style.display = showing ? 'none' : '';
    _openEditId = showing ? null : id;
    if (!showing) {
        const nameInput = document.getElementById('hf-name-' + id);
        if (nameInput) nameInput.focus();
    }
}

function openHabitForm() {
    // "Add Habit" — show a new-habit inline form at the bottom of the list
    const container = document.getElementById('habitTodayList');
    const addForm = document.getElementById('habit-add-form');
    if (addForm) { addForm.style.display = ''; document.getElementById('hf-name-new').focus(); return; }
    const catOpts = ['health','learning','wellness','social','general'].map(c =>
        `<option value="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('');
    const freqOpts = ['daily','weekly','monthly'].map(f =>
        `<option value="${f}">${f.charAt(0).toUpperCase()+f.slice(1)}</option>`).join('');
    const html = `<div class="habit-inline-form" id="habit-add-form" style="margin-top:12px;">
        <div style="font-size:14px;font-weight:600;margin-bottom:10px;">New Habit</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Name</label>
                <input type="text" id="hf-name-new" placeholder="e.g. Meditation" style="font-size:13px;padding:6px 8px;"></div>
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Category</label>
                <select id="hf-cat-new" style="font-size:13px;padding:6px 8px;">${catOpts}</select></div>
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Frequency</label>
                <select id="hf-freq-new" style="font-size:13px;padding:6px 8px;">${freqOpts}</select></div>
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Stack Group</label>
                <select id="hf-stack-new" onchange="onStackGroupChange(this)" data-prev="" style="font-size:13px;padding:6px 8px;">${buildStackGroupOptions(getAllStackGroupNames(), '')}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Track Value</label>
                <select id="hf-vtype-new" style="font-size:13px;padding:6px 8px;"><option value="">None</option><option value="duration">Duration</option><option value="count">Count</option></select></div>
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Value Label</label>
                <input type="text" id="hf-vlabel-new" placeholder="e.g. minutes, words, people" style="font-size:13px;padding:6px 8px;"></div>
        </div>
        <div style="margin-bottom:10px;">
            <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Schedule Days <span style="font-weight:400;">(empty = every day)</span></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${buildDayPicker('new', '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Venture</label>
                <select id="hf-venture-new" onchange="hfRebuildGoalOptions('new')" style="font-size:13px;padding:6px 8px;">${buildVentureOptions('')}</select></div>
            <div><label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">Goal (rolls up into)</label>
                <select id="hf-goal-new" style="font-size:13px;padding:6px 8px;">${buildGoalOptions('', '')}</select></div>
        </div>
        <div style="display:flex;gap:8px;">
            <button class="btn btn-primary" style="padding:4px 14px;font-size:12px;" onclick="saveInlineEdit('new')">Add</button>
            <button class="btn btn-secondary" style="padding:4px 14px;font-size:12px;" onclick="document.getElementById('habit-add-form').style.display='none'">Cancel</button>
        </div>
    </div>`;
    container.insertAdjacentHTML('afterend', html);
    document.getElementById('hf-name-new').focus();
}

async function saveInlineEdit(id) {
    const name = document.getElementById('hf-name-' + id).value.trim();
    if (!name) { showToast('Habit name is required.', 'error'); return; }
    const freqEl = document.getElementById('hf-freq-' + id);
    const vtypeEl = document.getElementById('hf-vtype-' + id);
    const vlabelEl = document.getElementById('hf-vlabel-' + id);
    const venEl = document.getElementById('hf-venture-' + id);
    const goalEl = document.getElementById('hf-goal-' + id);
    const checkedDays = [...document.querySelectorAll('.hf-day-' + id + ':checked')].map(c => c.value).join(',');
    const payload = {
        action: 'save', name,
        category: document.getElementById('hf-cat-' + id).value,
        frequency: freqEl ? freqEl.value : 'daily',
        stackGroup: document.getElementById('hf-stack-' + id).value,
        valueType: vtypeEl ? vtypeEl.value : '',
        valueLabel: vlabelEl ? vlabelEl.value.trim() : '',
        scheduleDays: checkedDays,
        ventureId: venEl ? venEl.value : '',
        goalId: goalEl ? goalEl.value : '',
    };
    if (id !== 'new') payload.id = id;
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify(payload) });
        showToast(id !== 'new' ? 'Habit updated.' : 'Habit added!', 'success');
        _openEditId = null;
        const addForm = document.getElementById('habit-add-form');
        if (addForm) addForm.remove();
        await loadHabits();
    } catch (e) { showToast('Failed to save habit.', 'error'); }
}

function deleteHabitById(id) {
    const habit = habits.find(h => h.id === id);
    pendingConfirmAction = async () => {
        try {
            await apiFetch('/api/habits', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Deleted "' + (habit ? habit.name : '') + '".', 'success');
            _openEditId = null;
            await loadHabits();
        } catch (e) {}
    };
    document.getElementById('modalTitle').textContent = 'Delete Habit';
    document.getElementById('modalMessage').textContent = 'Delete "' + (habit ? habit.name : '') + '"? This removes all history and cannot be undone.';
    document.getElementById('confirmModal').classList.add('active');
}

async function archiveHabitById(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    try {
        await apiFetch('/api/habits', {
            method: 'POST',
            body: JSON.stringify({ action: 'save', id, name: habit.name, status: 'archived' }),
        });
        showToast('Archived "' + habit.name + '". View in stats.', 'success');
        _openEditId = null;
        await loadHabits();
    } catch (e) { showToast('Failed to archive habit.', 'error'); }
}

async function unarchiveHabitById(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    try {
        await apiFetch('/api/habits', {
            method: 'POST',
            body: JSON.stringify({ action: 'save', id, name: habit.name, status: 'active' }),
        });
        showToast('Unarchived "' + habit.name + '".', 'success');
        await loadHabits();
    } catch (e) { showToast('Failed to unarchive habit.', 'error'); }
}

function addNewStackGroup() {
    const name = prompt('New stack group name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    // Check if group already exists
    const existing = habits.some(h => h.stackGroup === trimmed);
    if (existing) { showToast('Stack group "' + trimmed + '" already exists.', 'error'); return; }
    customStackGroups.add(trimmed);
    // If an inline edit is open, add the new option and select it; otherwise open a new habit form
    if (_openEditId) {
        const sel = document.getElementById('hf-stack-' + _openEditId);
        if (sel) {
            const newOpt = document.createElement('option');
            newOpt.value = trimmed;
            newOpt.textContent = trimmed;
            sel.insertBefore(newOpt, sel.querySelector('option[value="__new__"]'));
            sel.value = trimmed;
            sel.dataset.prev = trimmed;
        }
        showToast('Stack group "' + trimmed + '" ready — save the habit to apply.', 'success');
    } else {
        openHabitForm();
        setTimeout(() => {
            const sel = document.getElementById('hf-stack-new');
            if (sel) {
                const newOpt = document.createElement('option');
                newOpt.value = trimmed;
                newOpt.textContent = trimmed;
                sel.insertBefore(newOpt, sel.querySelector('option[value="__new__"]'));
                sel.value = trimmed;
                sel.dataset.prev = trimmed;
            }
        }, 50);
        showToast('Adding habit to new "' + trimmed + '" group. Fill in the habit name and save.', 'success');
    }
}

async function renameStackGroup(oldName) {
    const newName = prompt('Rename stack group:', oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    const affected = habits.filter(h => h.stackGroup === oldName);
    const entries = affected.map(h => ({ id: h.id, stackGroup: newName.trim(), stackOrder: h.stackOrder || 0 }));
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'reorder', entries }) });
        showToast(`Renamed "${oldName}" to "${newName.trim()}".`, 'success');
        await loadHabits();
    } catch (e) { showToast('Failed to rename group.', 'error'); }
}

async function removeStackGroup(groupName) {
    const affected = habits.filter(h => h.stackGroup === groupName);
    const entries = affected.map(h => ({ id: h.id, stackGroup: '', stackOrder: 0 }));
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'reorder', entries }) });
        showToast(`Ungrouped habits from "${groupName}".`, 'success');
        await loadHabits();
    } catch (e) { showToast('Failed to ungroup.', 'error'); }
}

async function moveStackGroup(groupName, dir) {
    const active = habits.filter(h => h.status === 'active');
    const groups = {};
    for (const h of active) {
        if (h.stackGroup) {
            if (!groups[h.stackGroup]) groups[h.stackGroup] = [];
            groups[h.stackGroup].push(h);
        }
    }
    // Sort by minimum stackOrder in each group
    const names = Object.keys(groups).sort((a, b) => {
        const aMin = Math.min(...groups[a].map(h => h.stackOrder || 0));
        const bMin = Math.min(...groups[b].map(h => h.stackOrder || 0));
        return aMin - bMin;
    });
    const idx = names.indexOf(groupName);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= names.length) return;
    [names[idx], names[swapIdx]] = [names[swapIdx], names[idx]];
    // Reassign all habits with new group ordering via stackOrder
    const entries = [];
    for (let gi = 0; gi < names.length; gi++) {
        const grp = groups[names[gi]] || [];
        grp.sort((a, b) => (a.stackOrder || 0) - (b.stackOrder || 0));
        for (let hi = 0; hi < grp.length; hi++) {
            entries.push({ id: grp[hi].id, stackGroup: names[gi], stackOrder: gi * 100 + hi });
        }
    }
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'reorder', entries }) });
        await loadHabits();
    } catch (e) { showToast('Failed to reorder groups.', 'error'); }
}

async function moveHabitInStack(habitId, dir) {
    const h = habits.find(x => x.id === habitId);
    if (!h) return;
    const group = h.stackGroup || '';
    const siblings = habits.filter(x => (x.stackGroup || '') === group && x.status === 'active')
        .sort((a, b) => (a.stackOrder || 0) - (b.stackOrder || 0));
    const idx = siblings.findIndex(x => x.id === habitId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    [siblings[idx], siblings[swapIdx]] = [siblings[swapIdx], siblings[idx]];
    const entries = siblings.map((s, i) => ({ id: s.id, stackGroup: group, stackOrder: i }));
    try {
        await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'reorder', entries }) });
        await loadHabits();
    } catch (e) { showToast('Failed to reorder.', 'error'); }
}

async function seedHabits() {
    const seeds = [
        { name: 'Meditation', category: 'wellness', stackGroup: 'Morning', stackOrder: 1 },
        { name: 'Gratitude List', category: 'wellness', stackGroup: 'Morning', stackOrder: 2 },
        { name: 'Journaling', category: 'wellness', stackGroup: 'Morning', stackOrder: 3 },
        { name: 'Study Indonesian', category: 'learning', stackGroup: 'Learning', stackOrder: 1 },
        { name: 'Gold List Review', category: 'learning', stackGroup: 'Learning', stackOrder: 2 },
        { name: 'Reading', category: 'learning', stackGroup: 'Learning', stackOrder: 3 },
        { name: 'Call 3 People', category: 'social', stackGroup: 'Evening', stackOrder: 1 },
        { name: 'Brush Teeth', category: 'health', stackGroup: 'Evening', stackOrder: 2 },
        { name: 'Weekly Review', category: 'wellness', frequency: 'weekly', stackGroup: 'Reviews', stackOrder: 1 },
        { name: 'Monthly Budget Check', category: 'general', frequency: 'monthly', stackGroup: 'Reviews', stackOrder: 2 },
    ];
    try {
        for (const s of seeds) {
            await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify({ action: 'save', ...s }) });
        }
        showToast('Seeded 10 starter habits!', 'success');
        await loadHabits();
    } catch (e) { showToast('Failed to seed habits.', 'error'); }
}

function renderHabitsStatsView() {
    const container = document.getElementById('habitStatsContent');
    const active = habits.filter(h => h.status === 'active');
    const archived = habits.filter(h => h.status === 'archived');
    if (active.length === 0 && archived.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No habits yet.</p></div>';
        return;
    }

    let html = '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">90-Day Completion Heatmap</h3>';
    html += renderHeatmap(habitLogs);

    // Pre-compute rate for sorting
    const habitData = active.map(h => {
        const freq = h.frequency || 'daily';
        const days = Math.max(1, Math.ceil((Date.now() - new Date(h.createdAt).getTime()) / 86400000));
        let periods = days;
        if (freq === 'weekly') periods = Math.max(1, Math.ceil(days / 7));
        else if (freq === 'monthly') periods = Math.max(1, Math.ceil(days / 30));
        const rate = h.totalCompletions > 0 ? Math.min(100, ((h.totalCompletions / periods) * 100)) : 0;
        return { h, freq, rate };
    });

    // Sort
    const sortOpts = [
        { key: 'name', label: 'Name' },
        { key: 'streak', label: 'Streak' },
        { key: 'best', label: 'Best' },
        { key: 'total', label: 'Total' },
        { key: 'rate', label: 'Rate' },
    ];
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin:24px 0 12px;">';
    html += '<h3 style="font-size:15px;color:var(--gray-700);margin:0;">Per-Habit Breakdown</h3>';
    html += '<div style="display:flex;gap:4px;">';
    for (const o of sortOpts) {
        const isActive = habitStatsSort === o.key;
        html += `<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="sortHabitStats('${o.key}')" style="padding:3px 10px;font-size:11px;">${o.label}</button>`;
    }
    html += '</div></div>';

    if (habitStatsSort === 'streak') habitData.sort((a, b) => (b.h.currentStreak || 0) - (a.h.currentStreak || 0));
    else if (habitStatsSort === 'best') habitData.sort((a, b) => (b.h.longestStreak || 0) - (a.h.longestStreak || 0));
    else if (habitStatsSort === 'total') habitData.sort((a, b) => (b.h.totalCompletions || 0) - (a.h.totalCompletions || 0));
    else if (habitStatsSort === 'rate') habitData.sort((a, b) => b.rate - a.rate);
    else habitData.sort((a, b) => a.h.name.localeCompare(b.h.name));

    for (const { h, freq, rate } of habitData) {
        const streakUnit = freq === 'weekly' ? 'wk' : freq === 'monthly' ? 'mo' : 'd';
        const freqLabel = freq !== 'daily' ? ` <span style="font-size:10px;background:var(--gray-200);border-radius:3px;padding:1px 4px;vertical-align:middle;">${freq === 'weekly' ? 'W' : 'M'}</span>` : '';

        // Value stats for habits that track values
        let valueStats = '';
        let valueChart = '';
        if (h.valueType) {
            const hLogs = habitLogs.filter(l => l.habitId === h.id && l.value > 0);
            if (hLogs.length > 0) {
                const totalVal = hLogs.reduce((s, l) => s + l.value, 0);
                const avgVal = totalVal / hLogs.length;
                const label = h.valueLabel || (h.valueType === 'duration' ? 'min' : '');
                valueStats = `<span style="color:var(--primary);font-weight:600;">${totalVal % 1 === 0 ? totalVal : totalVal.toFixed(1)} ${esc(label)} total</span>
                    <span>avg ${avgVal.toFixed(1)} ${esc(label)}</span>`;

                // Mini trend chart
                const points = hLogs.slice().sort((a, b) => a.date.localeCompare(b.date)).map(l => ({ date: l.date, value: l.value }));
                if (points.length >= 2) {
                    valueChart = buildHabitValueChart(points, '#3b82f6', h.valueLabel || '');
                }
            }
        }

        // Build 30-day toggle strip
        const hLogDates = new Set(habitLogs.filter(l => l.habitId === h.id).map(l => l.date));
        let stripHtml = '<div style="display:flex;gap:2px;margin-top:10px;align-items:end;">';
        for (let i = 29; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const ds = d.toLocaleDateString('en-CA');
            const done = hLogDates.has(ds);
            const dayLabel = d.toLocaleDateString('en-US', { weekday: 'narrow' });
            const dateLabel = d.getDate();
            const isSun = d.getDay() === 0;
            stripHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;" onclick="togglePastHabit('${h.id}','${ds}',${done})" title="${ds}">`;
            stripHtml += `<div style="width:100%;height:20px;border-radius:3px;background:${done ? '#10b981' : 'var(--gray-200)'};transition:background 0.2s;"></div>`;
            stripHtml += `<div style="font-size:8px;color:${isSun ? 'var(--red)' : 'var(--gray-400)'};">${dateLabel}</div>`;
            stripHtml += '</div>';
        }
        stripHtml += '</div>';

        html += `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:14px 18px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div><strong style="font-size:14px;">${esc(h.name)}</strong>${freqLabel}
                    <span style="font-size:11px;color:var(--gray-400);margin-left:8px;">${esc(h.category || '')}</span></div>
                <div style="display:flex;gap:16px;font-size:13px;color:var(--gray-600);">
                    <span>&#128293; ${h.currentStreak || 0}${streakUnit} current</span>
                    <span>&#127942; ${h.longestStreak || 0}${streakUnit} best</span>
                    <span>${h.totalCompletions || 0} total</span>
                    <span>${rate.toFixed(0)}% rate</span>
                    ${valueStats}
                </div>
            </div>
            ${valueChart}
            ${stripHtml}
        </div>`;
    }

    // Archived habits section
    if (archived.length > 0) {
        html += '<h3 style="font-size:15px;margin:24px 0 12px;color:var(--gray-700);">Archived Habits <span style="font-size:11px;color:var(--gray-400);font-weight:400;">(' + archived.length + ')</span></h3>';
        archived.sort((a, b) => a.name.localeCompare(b.name));
        for (const h of archived) {
            const freq = h.frequency || 'daily';
            const streakUnit = freq === 'weekly' ? 'wk' : freq === 'monthly' ? 'mo' : 'd';
            html += `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px 16px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div>
                    <strong style="font-size:14px;color:var(--gray-600);">${esc(h.name)}</strong>
                    <span style="font-size:11px;color:var(--gray-400);margin-left:8px;">${esc(h.category || '')}</span>
                </div>
                <div style="display:flex;gap:14px;align-items:center;font-size:12px;color:var(--gray-500);">
                    <span>&#127942; ${h.longestStreak || 0}${streakUnit} best</span>
                    <span>${h.totalCompletions || 0} total</span>
                    <button class="btn btn-secondary btn-sm" style="padding:3px 10px;font-size:11px;" onclick="unarchiveHabitById('${h.id}')">Unarchive</button>
                    <button class="btn btn-sm" style="padding:3px 10px;font-size:11px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;" onclick="deleteHabitById('${h.id}')">Delete</button>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;
}

function sortHabitStats(key) {
    habitStatsSort = key;
    renderHabitsStatsView();
}

function renderHeatmap(logs) {
    const countMap = {};
    for (const l of logs) countMap[l.date] = (countMap[l.date] || 0) + 1;

    const today = new Date();
    const days = [];
    for (let i = 90; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }

    const firstDay = new Date(days[0] + 'T12:00:00');
    const dow = firstDay.getDay();
    const padded = [];
    for (let i = 0; i < dow; i++) padded.push(null);
    padded.push(...days);

    const weeks = Math.ceil(padded.length / 7);
    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    let html = '<div style="overflow-x:auto;margin-bottom:16px;">';
    // Month labels
    html += '<div style="display:grid;grid-template-columns:30px repeat(' + weeks + ', 16px);gap:2px;margin-bottom:2px;">';
    html += '<div></div>';
    let lastMonth = '';
    for (let w = 0; w < weeks; w++) {
        const dateStr = padded[w * 7];
        if (dateStr) {
            const m = new Date(dateStr + 'T12:00:00').toLocaleString('en', { month: 'short' });
            if (m !== lastMonth) { html += `<div style="font-size:10px;color:var(--gray-400);">${m}</div>`; lastMonth = m; }
            else html += '<div></div>';
        } else html += '<div></div>';
    }
    html += '</div>';

    // Day rows
    for (let row = 0; row < 7; row++) {
        html += '<div style="display:grid;grid-template-columns:30px repeat(' + weeks + ', 16px);gap:2px;">';
        html += `<div class="heatmap-label">${dayLabels[row]}</div>`;
        for (let w = 0; w < weeks; w++) {
            const idx = w * 7 + row;
            const dateStr = padded[idx];
            if (!dateStr) { html += '<div></div>'; continue; }
            const count = countMap[dateStr] || 0;
            let level = 0;
            if (count >= 5) level = 4;
            else if (count >= 3) level = 3;
            else if (count >= 1) level = 2;
            html += `<div class="heatmap-cell level-${level}" title="${dateStr}: ${count}"></div>`;
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function buildHabitValueChart(points, color, label) {
    const W = 500, H = 100, PAD_L = 10, PAD_R = 10, PAD_T = 15, PAD_B = 25;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const vals = points.map(p => p.value);
    const maxV = Math.max(...vals);
    const minV = Math.min(...vals);
    const range = maxV - minV || 1;
    const xStep = points.length > 1 ? plotW / (points.length - 1) : plotW / 2;

    const svgPts = points.map((p, i) => {
        const x = PAD_L + (points.length > 1 ? i * xStep : plotW / 2);
        const y = PAD_T + plotH - ((p.value - minV) / range) * plotH;
        return { x, y, ...p };
    });

    const linePath = svgPts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const areaPath = linePath + ` L${svgPts[svgPts.length - 1].x.toFixed(1)},${PAD_T + plotH} L${svgPts[0].x.toFixed(1)},${PAD_T + plotH} Z`;

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:110px;margin-top:8px;" preserveAspectRatio="xMidYMid meet">`;
    svg += `<path d="${areaPath}" fill="${color}15" stroke="none"/>`;
    svg += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

    for (const p of svgPts) {
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`;
        const dateLabel = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        svg += `<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="7" fill="var(--gray-400)">${dateLabel}</text>`;
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 6}" text-anchor="middle" font-size="8" font-weight="600" fill="var(--gray-600)">${p.value}</text>`;
    }

    svg += '</svg>';
    return svg;
}

// ==================== HABIT HISTORY ====================

function renderHabitHistory() {
    if (!habitLogs.length) return '';
    const today = new Date().toLocaleDateString('en-CA');
    const goal = 10;

    // Count completions per day from recentLogs (last 90 days)
    const countMap = {};
    for (const l of habitLogs) countMap[l.date] = (countMap[l.date] || 0) + 1;
    const days = Object.keys(countMap).sort();
    if (days.length < 2) return '';

    const data = days.map(d => ({ date: d, count: countMap[d] }));
    const allMax = Math.max(...data.map(d => d.count), goal);
    const histGoalPct = (goal / allMax) * 100;

    // Last 7 days avg
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toLocaleDateString('en-CA');
        last7.push(countMap[ds] || 0);
    }
    const weekAvg = (last7.reduce((s, v) => s + v, 0) / 7).toFixed(1);

    // Today's count
    const todayCount = countMap[today] || 0;
    const pct = Math.min((todayCount / goal) * 100, 100);

    let html = '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:10px;padding:14px 18px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<strong style="font-size:15px;">Habits</strong>';
    html += `<div style="font-size:12px;color:var(--gray-400);">7-day avg: <strong style="color:var(--gray-600);">${weekAvg}</strong></div>`;
    html += '</div>';

    // Today's count + progress bar
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">';
    html += `<div style="font-size:28px;font-weight:700;color:${pct >= 100 ? '#10b981' : 'var(--gray-700)'};">${todayCount}</div>`;
    html += '<div style="flex:1;">';
    html += `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400);margin-bottom:2px;"><span>Today</span><span>${goal} goal</span></div>`;
    html += `<div style="height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct >= 100 ? '#10b981' : '#3b82f6'};border-radius:4px;transition:width 0.3s;"></div></div>`;
    html += '</div></div>';

    // Bar chart (expandable)
    const isExpanded = data.length > 7;
    const wrapTag = isExpanded ? 'details' : 'div';
    html += `<${wrapTag} style="margin-top:8px;">`;
    if (isExpanded) html += `<summary style="font-size:11px;color:var(--gray-400);cursor:pointer;">Habit history (${data.length} days)</summary>`;
    html += `<div style="position:relative;height:80px;margin-top:${isExpanded ? '8' : '0'}px;">`;
    html += `<div style="position:absolute;left:0;right:0;bottom:${histGoalPct}%;border-top:1.5px dashed #10b981;z-index:1;"></div>`;
    html += `<div style="position:absolute;left:-2px;bottom:${histGoalPct}%;transform:translateY(50%);font-size:8px;color:#10b981;font-weight:600;">${goal}</div>`;
    html += '<div style="display:flex;align-items:end;gap:1px;height:100%;padding-left:18px;">';
    for (const d of data) {
        const h = Math.max((d.count / allMax) * 100, 1);
        const isToday = d.date === today;
        const color = d.count >= goal ? '#10b981' : isToday ? '#3b82f6' : '#93c5fd';
        const dateLabel = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:1px;min-width:3px;height:100%;" title="${dateLabel}: ${d.count} habits">`;
        html += `<div style="font-size:8px;font-weight:600;color:var(--gray-500);white-space:nowrap;">${d.count}</div>`;
        html += `<div style="width:100%;height:${h}%;background:${color};border-radius:1px 1px 0 0;min-height:2px;flex-shrink:0;"></div>`;
        html += '</div>';
    }
    html += '</div></div>';
    // Month labels
    html += '<div style="display:flex;gap:1px;margin-top:2px;padding-left:18px;">';
    let lastMo = '';
    for (const d of data) {
        const mo = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
        if (mo !== lastMo) { html += `<div style="flex:1;font-size:8px;color:var(--gray-400);">${mo}</div>`; lastMo = mo; }
        else html += '<div style="flex:1;"></div>';
    }
    html += '</div>';
    // Stats
    const totalCount = data.reduce((s, d) => s + d.count, 0);
    const avgAll = (totalCount / data.length).toFixed(1);
    const bestDay = data.reduce((best, d) => d.count > best.count ? d : best, data[0]);
    const bestLabel = new Date(bestDay.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    html += '<div style="display:flex;gap:16px;font-size:11px;color:var(--gray-500);margin-top:6px;">';
    html += `<span>Avg: <strong>${avgAll}</strong>/day</span>`;
    html += `<span>Best: <strong>${bestDay.count}</strong> (${bestLabel})</span>`;
    html += `<span>Days at goal: <strong>${data.filter(d => d.count >= goal).length}</strong></span>`;
    html += `</div></${wrapTag}>`;
    html += '</div>';
    return html;
}

// ==================== STEP COUNTER ====================

function renderStepCounter() {
    const today = new Date().toLocaleDateString('en-CA');
    const todayEntry = stepsData.find(s => s.date === today);
    const todaySteps = todayEntry ? todayEntry.steps : 0;
    const goal = stepGoal;
    const pct = Math.min((todaySteps / goal) * 100, 100);
    const isGarmin = todayEntry && todayEntry.source === 'garmin';

    // Last 7 days for mini chart
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toLocaleDateString('en-CA');
        const entry = stepsData.find(s => s.date === ds);
        last7.push({ date: ds, steps: entry ? entry.steps : 0, day: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2) });
    }
    const weekAvg = last7.length > 0 ? Math.round(last7.reduce((s, d) => s + d.steps, 0) / last7.length) : 0;
    const chartCeil = Math.round(goal * 1.5);
    const maxSteps = Math.max(...last7.map(d => d.steps), chartCeil);

    let html = '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:10px;padding:14px 18px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:15px;">Steps</strong>';
    if (isGarmin) html += '<span style="font-size:10px;background:#06b6d4;color:#fff;padding:1px 6px;border-radius:3px;">Garmin</span>';
    html += '</div>';
    html += `<div style="font-size:12px;color:var(--gray-400);">7-day avg: <strong style="color:var(--gray-600);">${weekAvg.toLocaleString()}</strong></div>`;
    html += '</div>';

    // Today's steps + progress bar
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">';
    html += `<div style="font-size:28px;font-weight:700;color:${pct >= 100 ? '#10b981' : 'var(--gray-700)'};">${todaySteps.toLocaleString()}</div>`;
    html += `<div style="flex:1;">`;
    html += `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400);margin-bottom:2px;"><span>Today</span><span>${goal.toLocaleString()} goal</span></div>`;
    html += `<div style="height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct >= 100 ? '#10b981' : '#3b82f6'};border-radius:4px;transition:width 0.3s;"></div></div>`;
    html += '</div>';
    html += `<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap;" onclick="syncGarminSteps(1)" id="stepSyncBtn" title="Re-sync today's steps from Garmin">Sync</button>`;
    html += `<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap;" onclick="syncGarminSteps(2)" id="stepSyncBtnYesterday" title="Re-sync yesterday's steps from Garmin (also re-syncs today)">Yesterday</button>`;
    html += `<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap;" onclick="manualStepEntry()">Edit</button>`;
    html += '</div>';

    // Step history with goal line
    if (stepsData.length > 0) {
        const allSorted = stepsData.slice().sort((a, b) => a.date.localeCompare(b.date));
        const allMax = Math.max(...allSorted.map(s => s.steps), chartCeil);
        const histGoalPct = (goal / allMax) * 100;
        const goalLabel = goal >= 1000 ? (goal / 1000) + 'k' : goal;
        const isExpanded = stepsData.length > 7;
        const wrapTag = isExpanded ? 'details' : 'div';
        html += `<${wrapTag} style="margin-top:8px;">`;
        if (isExpanded) html += `<summary style="font-size:11px;color:var(--gray-400);cursor:pointer;">Step history (${allSorted.length} days)</summary>`;
        html += `<div style="position:relative;height:80px;margin-top:${isExpanded ? '8' : '0'}px;">`;
        html += `<div style="position:absolute;left:0;right:0;bottom:${histGoalPct}%;border-top:1.5px dashed #10b981;z-index:1;"></div>`;
        html += `<div style="position:absolute;left:-2px;bottom:${histGoalPct}%;transform:translateY(50%);font-size:8px;color:#10b981;font-weight:600;">${goalLabel}</div>`;
        html += '<div style="display:flex;align-items:end;gap:1px;height:100%;padding-left:18px;">';
        for (const s of allSorted) {
            const h = Math.max((s.steps / allMax) * 100, 1);
            const isToday = s.date === today;
            const color = s.steps >= goal ? '#10b981' : isToday ? '#3b82f6' : '#93c5fd';
            const dateLabel = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const stepLabel = s.steps > 0 ? (s.steps >= 1000 ? (s.steps / 1000).toFixed(1) + 'k' : s.steps) : '';
            html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:1px;min-width:3px;height:100%;" title="${dateLabel}: ${s.steps.toLocaleString()} steps">`;
            html += `<div style="font-size:8px;font-weight:600;color:var(--gray-500);white-space:nowrap;">${stepLabel}</div>`;
            html += `<div style="width:100%;height:${h}%;background:${color};border-radius:1px 1px 0 0;min-height:2px;flex-shrink:0;"></div>`;
            html += '</div>';
        }
        html += '</div></div>';
        // Month labels
        html += '<div style="display:flex;gap:1px;margin-top:2px;padding-left:18px;">';
        let lastMo = '';
        for (const s of allSorted) {
            const mo = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
            if (mo !== lastMo) { html += `<div style="flex:1;font-size:8px;color:var(--gray-400);">${mo}</div>`; lastMo = mo; }
            else html += '<div style="flex:1;"></div>';
        }
        html += '</div>';
        // Stats
        const totalSteps = allSorted.reduce((s, d) => s + d.steps, 0);
        const avgAll = Math.round(totalSteps / allSorted.length);
        const bestDay = allSorted.reduce((best, d) => d.steps > best.steps ? d : best, allSorted[0]);
        const bestLabel = new Date(bestDay.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div style="display:flex;gap:16px;font-size:11px;color:var(--gray-500);margin-top:6px;">`;
        html += `<span>Avg: <strong>${avgAll.toLocaleString()}</strong>/day</span>`;
        html += `<span>Best: <strong>${bestDay.steps.toLocaleString()}</strong> (${bestLabel})</span>`;
        html += `<span>Total: <strong>${totalSteps.toLocaleString()}</strong></span>`;
        html += `</div></${wrapTag}>`;
    }

    html += `<div style="display:flex;justify-content:space-between;margin-top:4px;"><a href="javascript:void(0)" onclick="setStepGoal()" style="font-size:10px;color:var(--gray-400);text-decoration:none;">Step goal: ${goal.toLocaleString()}</a><a href="javascript:void(0)" onclick="configGarminPat()" style="font-size:10px;color:var(--gray-400);text-decoration:none;">Configure Garmin sync</a></div>`;
    html += '</div>';
    return html;
}

function setStepGoal() {
    const input = prompt('Daily step goal:', stepGoal);
    if (input === null) return;
    const val = parseInt(input);
    if (isNaN(val) || val < 1) { showToast('Invalid goal', 'error'); return; }
    stepGoal = val;
    apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ stepGoal: val }),
    }).then(() => {
        showToast('Step goal updated to ' + val.toLocaleString(), 'success');
        renderHabits();
    }).catch(() => showToast('Failed to save goal', 'error'));
}

function configGarminPat() {
    const pat = prompt('GitHub PAT (repo scope) for Garmin sync.\nThis is stored in your site settings and used to trigger the sync workflow.\n\nPaste token (or leave empty to skip):');
    if (pat === null) return;
    if (!pat.trim()) { showToast('No changes made.', 'info'); return; }
    apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ githubPat: pat.trim() }),
    }).then(() => showToast('GitHub PAT saved.', 'success'))
      .catch(() => showToast('Failed to save PAT.', 'error'));
}

async function syncGarminSteps(days = 1) {
    const btnToday = document.getElementById('stepSyncBtn');
    const btnYesterday = document.getElementById('stepSyncBtnYesterday');
    const clicked = days === 2 ? btnYesterday : btnToday;
    const originalLabel = clicked ? clicked.textContent : '';
    if (btnToday) btnToday.disabled = true;
    if (btnYesterday) btnYesterday.disabled = true;
    if (clicked) clicked.textContent = 'Syncing...';
    try {
        const res = await apiFetch('/api/steps-sync', { method: 'POST', body: JSON.stringify({ days }) });
        showToast(res.message || 'Sync triggered!', 'success');
        // Wait for the workflow to run and data to arrive
        setTimeout(() => loadHabits(), 30000);
        setTimeout(() => {
            if (btnToday) btnToday.disabled = false;
            if (btnYesterday) btnYesterday.disabled = false;
            if (clicked) clicked.textContent = originalLabel;
        }, 5000);
    } catch (e) {
        showToast('Sync failed. Check GitHub PAT in settings.', 'error');
        if (btnToday) btnToday.disabled = false;
        if (btnYesterday) btnYesterday.disabled = false;
        if (clicked) clicked.textContent = originalLabel;
    }
}

function manualStepEntry() {
    const today = new Date().toLocaleDateString('en-CA');
    const todayEntry = stepsData.find(s => s.date === today);
    const current = todayEntry ? todayEntry.steps : '';
    const input = prompt('Steps for today:', current);
    if (input === null) return;
    const steps = parseInt(input);
    if (isNaN(steps) || steps < 0) { showToast('Invalid step count', 'error'); return; }
    apiFetch('/api/steps', {
        method: 'POST',
        body: JSON.stringify({ date: today, steps, source: 'manual' }),
    }).then(() => {
        showToast('Steps updated', 'success');
        loadHabits();
    }).catch(() => {});
}
