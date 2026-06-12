/* ==========================================================================
   Guru Dashboard — Calendar Module
   Monthly/weekly/day views, events CRUD, recurring events, reminders
   ========================================================================== */

// ==================== CALENDAR ====================
let calendarEvents = [];
let calCurrentView = 'week';
let calCurrentDate = new Date();
let calEditingId = null;
let calEditingOccurrenceDate = null;
let calHideOffHours = true;

const CAL_DEFAULTS = {
    work:     { label: 'Work',     color: '#3b82f6' },
    personal: { label: 'Personal', color: '#8b5cf6' },
    health:   { label: 'Health',   color: '#10b981' },
    social:   { label: 'Social',   color: '#f59e0b' },
    fitness:  { label: 'Fitness',  color: '#ef4444' },
    travel:   { label: 'Travel',   color: '#06b6d4' },
    other:    { label: 'Other',    color: '#6b7280' },
};
let CAL_CATEGORIES = { ...CAL_DEFAULTS };
let calHiddenCategories = new Set();

async function loadCalCategories() {
    try {
        const data = await apiFetch('/api/settings');
        if (data.calendarCategories) {
            for (const [key, val] of Object.entries(data.calendarCategories)) {
                if (CAL_CATEGORIES[key]) {
                    CAL_CATEGORIES[key] = { ...CAL_CATEGORIES[key], ...val };
                }
            }
        }
    } catch (e) {}
    renderCalLegend();
    rebuildCalCategoryDropdown();
}

async function saveCalCategories() {
    const custom = {};
    for (const [key, val] of Object.entries(CAL_CATEGORIES)) {
        const def = CAL_DEFAULTS[key];
        if (!def || val.label !== def.label || val.color !== def.color) {
            custom[key] = val;
        }
    }
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ calendarCategories: custom }),
        });
    } catch (e) {}
}

function rebuildCalCategoryDropdown() {
    const sel = document.getElementById('calEvtCategory');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = Object.entries(CAL_CATEGORIES).map(([k, v]) =>
        `<option value="${k}">${esc(v.label)}</option>`
    ).join('');
    sel.value = current || 'personal';
}

async function loadCalendar() {
    try {
        await loadCalCategories();
        const data = await apiFetch('/api/calendar');
        calendarEvents = data.events || [];
        renderCalReminders();
        renderCalLegend();
        renderCalendar();
        renderDashboardCalToday();
    } catch (e) {
        document.getElementById('cal-panel-month').innerHTML = '<div class="empty-state"><p>Failed to load calendar.</p></div>';
        renderDashboardCalToday();
    }
}

function renderCalLegend() {
    const el = document.getElementById('calLegend');
    el.innerHTML = Object.entries(CAL_CATEGORIES).map(([k, v]) => {
        const hidden = calHiddenCategories.has(k);
        return `<div class="cal-legend-item" style="cursor:pointer;${hidden ? 'opacity:0.35;text-decoration:line-through;' : ''}">` +
            `<div class="cal-legend-dot" style="background:${v.color};${hidden ? 'opacity:0.4;' : ''}" onclick="toggleCalCategory('${k}')" title="Click to show/hide"></div>` +
            `<span onclick="toggleCalCategory('${k}')" title="Click to show/hide">${esc(v.label)}</span>` +
            `<span onclick="event.stopPropagation();editCalCategory('${k}')" style="font-size:10px;color:var(--gray-400);margin-left:2px;cursor:pointer;" title="Edit">&#9998;</span>` +
        `</div>`;
    }).join('') +
    '<div class="cal-legend-item" style="cursor:pointer;color:var(--gray-400);font-size:11px;" onclick="resetCalCategories()" title="Reset to defaults">reset</div>';
}

function toggleCalCategory(key) {
    if (calHiddenCategories.has(key)) calHiddenCategories.delete(key);
    else calHiddenCategories.add(key);
    localStorage.setItem('cal-hidden', JSON.stringify([...calHiddenCategories]));
    renderCalLegend();
    renderCalendar();
}

// Restore hidden categories from localStorage
try {
    const saved = JSON.parse(localStorage.getItem('cal-hidden') || '[]');
    calHiddenCategories = new Set(saved);
} catch(e) {}

/* ── Reminders ── */
let calReminders = [];

// Reminders ≥3 weeks away are hidden by default — the strip would otherwise
// fill with months-out items the user can't act on. The "Show all" toggle
// next to "+ Add Reminder" surfaces them when the user wants to review or
// edit a distant reminder. State persists per-browser.
const CAL_REMINDER_VISIBLE_DAYS = 21;
let calRemindersShowAll = false;
try {
    calRemindersShowAll = localStorage.getItem('cal-reminders-show-all') === '1';
} catch (_) { /* localStorage blocked */ }

function loadCalReminders() {
    try {
        calReminders = JSON.parse(localStorage.getItem('cal-reminders') || '[]');
    } catch(e) { calReminders = []; }
    if (!calReminders.length) {
        // Seed with default reminder
        calReminders = [{
            id: 'apple-jwt-2026',
            title: 'Supabase Apple JWT renewal for OAuth',
            dueDate: '2026-09-24',
            notes: 'JWT is valid for 180 days'
        }];
        saveCalReminders();
    }
}

function saveCalReminders() {
    localStorage.setItem('cal-reminders', JSON.stringify(calReminders));
}

function toggleCalRemindersShowAll() {
    calRemindersShowAll = !calRemindersShowAll;
    try { localStorage.setItem('cal-reminders-show-all', calRemindersShowAll ? '1' : '0'); } catch (_) { /* */ }
    renderCalReminders();
}

function renderCalReminders() {
    const el = document.getElementById('calReminders');
    if (!el) return;
    if (!calReminders.length) { el.innerHTML = ''; return; }

    const today = new Date();
    today.setHours(0,0,0,0);

    const sorted = [...calReminders].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Compute diff once per reminder; partition into visible (overdue + within
    // 3 weeks) vs distant (≥21 days out). Distant reminders only render when
    // calRemindersShowAll is true.
    const annotated = sorted.map(r => {
        const due = new Date(r.dueDate + 'T00:00:00');
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        return { r, diff };
    });
    const distantCount = annotated.filter(x => x.diff > CAL_REMINDER_VISIBLE_DAYS).length;
    const shown = calRemindersShowAll
        ? annotated
        : annotated.filter(x => x.diff <= CAL_REMINDER_VISIBLE_DAYS);

    const cards = shown.map(({ r, diff }) => {
        const absDiff = Math.abs(diff);
        const fmt = absDiff <= 7 ? `${absDiff}d` : `${Math.round(absDiff / 7)}w`;
        let badgeClass, badgeText;
        if (diff < 0) {
            badgeClass = 'overdue';
            badgeText = `${fmt} overdue`;
        } else if (diff === 0) {
            badgeClass = 'overdue';
            badgeText = 'Today';
        } else if (diff <= 7) {
            badgeClass = 'urgent';
            badgeText = `${fmt} left`;
        } else if (diff <= 30) {
            badgeClass = 'soon';
            badgeText = `${fmt} left`;
        } else {
            badgeClass = 'ok';
            badgeText = `${fmt} left`;
        }

        return `<div class="cal-reminder-card">
            <span class="reminder-badge ${badgeClass}">${badgeText}</span>
            <div>
                <div class="reminder-title">${esc(r.title)}</div>
                <div class="reminder-date">${r.dueDate}${r.notes ? ' — ' + esc(r.notes) : ''}</div>
            </div>
            <div class="reminder-actions">
                <button onclick="editCalReminder('${r.id}')" title="Edit">&#9998;</button>
                <button onclick="deleteCalReminder('${r.id}')" title="Delete">&times;</button>
            </div>
        </div>`;
    }).join('');

    // Toggle card only renders when there are distant reminders to surface (or
    // currently surfaced, so the user can collapse them again).
    const toggleCard = (distantCount > 0)
        ? `<div class="cal-reminder-card" style="cursor:pointer;justify-content:center;border-style:dashed;color:var(--gray-500);font-weight:600;" onclick="toggleCalRemindersShowAll()" title="Reminders 3+ weeks away are hidden by default">
                ${calRemindersShowAll ? `↑ Hide distant (${distantCount})` : `↓ Show all (${distantCount} hidden)`}
            </div>`
        : '';

    const addCard = '<div class="cal-reminder-card" style="cursor:pointer;justify-content:center;border-style:dashed;color:var(--gray-400);" onclick="addCalReminder()">+ Add Reminder</div>';

    el.innerHTML = cards + toggleCard + addCard;
}

function addCalReminder() {
    const title = prompt('Reminder title:');
    if (!title) return;
    const dueDate = prompt('Due date (YYYY-MM-DD):');
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { showToast('Invalid date format.', 'error'); return; }
    const notes = prompt('Notes (optional):') || '';
    calReminders.push({ id: 'rem-' + Date.now(), title, dueDate, notes });
    saveCalReminders();
    renderCalReminders();
    showToast('Reminder added.', 'success');
}

function editCalReminder(id) {
    const r = calReminders.find(x => x.id === id);
    if (!r) return;
    const title = prompt('Reminder title:', r.title);
    if (!title) return;
    const dueDate = prompt('Due date (YYYY-MM-DD):', r.dueDate);
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { showToast('Invalid date format.', 'error'); return; }
    const notes = prompt('Notes (optional):', r.notes) || '';
    r.title = title;
    r.dueDate = dueDate;
    r.notes = notes;
    saveCalReminders();
    renderCalReminders();
    showToast('Reminder updated.', 'success');
}

function deleteCalReminder(id) {
    if (!confirm('Delete this reminder?')) return;
    calReminders = calReminders.filter(x => x.id !== id);
    saveCalReminders();
    renderCalReminders();
    showToast('Reminder deleted.', 'success');
}

loadCalReminders();

function editCalCategory(key) {
    const cat = CAL_CATEGORIES[key];
    if (!cat) return;
    const el = document.getElementById('calLegend');
    const items = el.querySelectorAll('.cal-legend-item');
    const keys = Object.keys(CAL_CATEGORIES);
    const idx = keys.indexOf(key);
    if (idx < 0 || !items[idx]) return;

    items[idx].outerHTML =
        `<div class="cal-legend-item" style="gap:6px;">` +
        `<input type="color" value="${cat.color}" id="calCatColor-${key}" style="width:24px;height:24px;border:none;padding:0;cursor:pointer;background:none;">` +
        `<input type="text" value="${esc(cat.label)}" id="calCatLabel-${key}" style="width:80px;padding:2px 6px;font-size:12px;border:1px solid var(--gray-300);border-radius:4px;">` +
        `<button class="btn btn-primary" style="padding:2px 8px;font-size:11px;" onclick="saveCalCategory('${key}')">Save</button>` +
        `<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="renderCalLegend()">Cancel</button>` +
        `</div>`;
}

async function saveCalCategory(key) {
    const label = document.getElementById('calCatLabel-' + key)?.value.trim();
    const color = document.getElementById('calCatColor-' + key)?.value;
    if (!label) { showToast('Label is required.', 'error'); return; }
    CAL_CATEGORIES[key] = { label, color };
    await saveCalCategories();
    renderCalLegend();
    rebuildCalCategoryDropdown();
    renderCalendar();
    showToast('Category updated.', 'success');
}

async function resetCalCategories() {
    CAL_CATEGORIES = {};
    for (const k of Object.keys(CAL_DEFAULTS)) {
        CAL_CATEGORIES[k] = { ...CAL_DEFAULTS[k] };
    }
    await saveCalCategories();
    renderCalLegend();
    rebuildCalCategoryDropdown();
    renderCalendar();
    showToast('Categories reset to defaults.', 'success');
}

function renderCalendar() {
    if (calCurrentView === 'month') renderCalMonth();
    else if (calCurrentView === 'week') renderCalWeek();
    else renderCalDay();
}

function switchCalView(mode) {
    calCurrentView = mode;
    document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.cal-view-btn[data-view="${mode}"]`).classList.add('active');
    document.querySelectorAll('.cal-panel').forEach(p => p.style.display = 'none');
    document.getElementById('cal-panel-' + mode).style.display = '';
    renderCalendar();
}

function calNav(dir) {
    if (calCurrentView === 'month') {
        calCurrentDate.setMonth(calCurrentDate.getMonth() + dir);
    } else if (calCurrentView === 'week') {
        calCurrentDate.setDate(calCurrentDate.getDate() + dir * 7);
    } else {
        calCurrentDate.setDate(calCurrentDate.getDate() + dir);
    }
    renderCalendar();
}

function calToday() {
    calCurrentDate = new Date();
    renderCalendar();
}

function toggleCalOffHours() {
    calHideOffHours = !calHideOffHours;
    const btn = document.getElementById('calOffHoursBtn');
    btn.textContent = calHideOffHours ? 'Hide Off-Hours' : 'Show Off-Hours';
    btn.classList.toggle('btn-primary', calHideOffHours);
    btn.classList.toggle('btn-secondary', !calHideOffHours);
    renderCalendar();
    renderDashboardCalToday();
}

function calIsOffHour(h) {
    return h >= 22 || h <= 4;
}

function calSelectDay(dateStr) {
    calCurrentDate = new Date(dateStr + 'T12:00:00');
    switchCalView('day');
}

function calFmtDate(d) {
    if (typeof d === 'string') return d;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function expandRecurringEvents(events, rangeStart, rangeEnd) {
    const expanded = [];
    const startStr = calFmtDate(rangeStart);
    const endStr = calFmtDate(rangeEnd);

    for (const evt of events) {
        const spanDays = calMultiDaySpan(evt);

        if (evt.recurrence === 'none') {
            // For multi-day events, include if any part of the span overlaps the
            // visible range — otherwise an event starting in March that spills
            // into April vanishes the moment you flip to April.
            const spanEndStr = (spanDays > 1 && evt.endDate) ? evt.endDate : evt.date;
            if (evt.date <= endStr && spanEndStr >= startStr) {
                expanded.push({ ...evt, _sourceId: evt.id, _occurrenceDate: evt.date });
            }
            continue;
        }

        const exceptions = evt.exceptions || {};
        const deleted = evt.deletedOccurrences || [];
        const evtEnd = evt.recurrenceEnd || endStr;
        const cur = new Date(evt.date + 'T12:00:00');

        // Parse custom-weekly days
        const isCustomWeekly = evt.recurrence.startsWith('custom-weekly:');
        const customDays = isCustomWeekly ? new Set(evt.recurrence.split(':')[1].split(',').map(Number)) : null;

        for (let safety = 0; safety < 1000; safety++) {
            const ds = calFmtDate(cur);
            if (ds > endStr || ds > evtEnd) break;
            const dayMatch = !isCustomWeekly || customDays.has(cur.getDay());
            // For multi-day recurring events, an occurrence starting before
            // startStr can still have segments inside the range.
            let occEndStr = ds;
            if (spanDays > 1) {
                const occEnd = new Date(cur);
                occEnd.setDate(occEnd.getDate() + spanDays - 1);
                occEndStr = calFmtDate(occEnd);
            }
            if (occEndStr >= startStr && !deleted.includes(ds) && dayMatch) {
                const override = exceptions[ds] || {};
                const displayDate = override.date || ds;
                let occEndDate = '';
                if (spanDays > 1) {
                    const ed = new Date(displayDate + 'T12:00:00');
                    ed.setDate(ed.getDate() + spanDays - 1);
                    occEndDate = calFmtDate(ed);
                }
                expanded.push({
                    ...evt,
                    ...override,
                    date: displayDate,
                    endDate: override.endDate !== undefined ? override.endDate : occEndDate,
                    _sourceId: evt.id,
                    _occurrenceDate: ds,
                    _isRecurring: true,
                });
            }
            if (evt.recurrence === 'daily' || isCustomWeekly) cur.setDate(cur.getDate() + 1);
            else if (evt.recurrence === 'weekly') cur.setDate(cur.getDate() + 7);
            else if (evt.recurrence === 'monthly') cur.setMonth(cur.getMonth() + 1);
            else if (evt.recurrence === 'yearly') cur.setFullYear(cur.getFullYear() + 1);
            else break;
        }
    }
    return expanded;
}

// Returns the number of days an event spans (>= 1). Multi-day requires
// allDay=true and a valid endDate strictly after date.
function calMultiDaySpan(evt) {
    if (!evt.allDay || !evt.endDate || evt.endDate <= evt.date) return 1;
    const start = new Date(evt.date + 'T12:00:00');
    const end = new Date(evt.endDate + 'T12:00:00');
    return Math.round((end - start) / 86400000) + 1;
}

// Expands a multi-day all-day event into one segment per visible day in the
// range. Single-day events pass through unchanged. Each segment carries
// metadata about its position in the span: `_spanDate` is the per-day date
// to render at, `_spanIndex` (0-based), `_spanTotal`, `_spanFirst`/`_spanLast`,
// and `_spanRowFirst` (true on Sunday or the first segment) for use by month
// view to draw the title once per week-row.
function expandMultiDaySegments(events, rangeStart, rangeEnd) {
    const startStr = calFmtDate(rangeStart);
    const endStr = calFmtDate(rangeEnd);
    const segments = [];
    for (const evt of events) {
        const total = calMultiDaySpan(evt);
        if (total === 1) {
            segments.push({ ...evt, _spanDate: evt.date, _spanIndex: 0, _spanTotal: 1, _spanFirst: true, _spanLast: true, _spanRowFirst: true });
            continue;
        }
        const start = new Date(evt.date + 'T12:00:00');
        for (let i = 0; i < total; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const ds = calFmtDate(d);
            if (ds < startStr || ds > endStr) continue;
            segments.push({
                ...evt,
                _spanDate: ds,
                _spanIndex: i,
                _spanTotal: total,
                _spanFirst: i === 0,
                _spanLast: i === total - 1,
                _spanRowFirst: i === 0 || d.getDay() === 0,
            });
        }
    }
    return segments;
}

function filterHiddenCategories(events) {
    if (calHiddenCategories.size === 0) return events;
    return events.filter(e => !calHiddenCategories.has(e.category || 'other'));
}

function calHourLabel(h) {
    if (h === 0) return '12 AM';
    if (h < 12) return h + ' AM';
    if (h === 12) return '12 PM';
    return (h - 12) + ' PM';
}

function renderCalMonth() {
    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    document.getElementById('calTitle').textContent = calCurrentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const lastDay = new Date(year, month + 1, 0);
    const endOffset = 6 - lastDay.getDay();
    const gridEnd = new Date(year, month + 1, endOffset);

    const baseEvents = filterHiddenCategories(expandRecurringEvents(calendarEvents, gridStart, gridEnd));
    const events = expandMultiDaySegments(baseEvents, gridStart, gridEnd);
    const eventsByDate = {};
    for (const e of events) {
        const key = e._spanDate || e.date;
        if (!eventsByDate[key]) eventsByDate[key] = [];
        eventsByDate[key].push(e);
    }

    const today = calFmtDate(new Date());
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = '<div class="cal-month-grid">';

    for (const d of days) {
        html += `<div class="cal-month-header">${d}</div>`;
    }

    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
        const ds = calFmtDate(cur);
        let cls = 'cal-day';
        if (ds === today) cls += ' today';
        if (cur.getMonth() !== month) cls += ' other-month';

        html += `<div class="${cls}" data-date="${ds}" onclick="openCalEventForm('${ds}')">`;
        html += `<div class="cal-day-num" onclick="event.stopPropagation();calSelectDay('${ds}')">${cur.getDate()}</div>`;

        const dayEvents = (eventsByDate[ds] || []).sort((a, b) => {
            // Multi-day spans render before single-day events for visual continuity
            if ((a._spanTotal || 1) > 1 && (b._spanTotal || 1) === 1) return -1;
            if ((b._spanTotal || 1) > 1 && (a._spanTotal || 1) === 1) return 1;
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            return (a.startTime || '').localeCompare(b.startTime || '');
        });
        const maxPills = 3;
        for (let i = 0; i < Math.min(dayEvents.length, maxPills); i++) {
            const e = dayEvents[i];
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const isMulti = (e._spanTotal || 1) > 1;
            let pillClass = 'cal-event-pill';
            let label = esc(e.title);
            if (isMulti) {
                pillClass += ' cal-pill-multi';
                if (e._spanFirst) pillClass += ' cal-pill-start';
                if (e._spanLast) pillClass += ' cal-pill-end';
                if (!e._spanFirst && !e._spanLast) pillClass += ' cal-pill-mid';
                // Show title only on the first segment overall and on the first day of each new week-row
                if (!e._spanRowFirst) label = '&nbsp;';
            }
            html += `<div class="${pillClass}" style="background:${cat.color};touch-action:none;" data-source-id="${e._sourceId}" data-occurrence-date="${e._occurrenceDate}" data-is-recurring="${!!e._isRecurring}" onclick="event.stopPropagation();editCalEvent('${e._sourceId}','${e._occurrenceDate}')" title="${esc(e.title)}">${label}</div>`;
        }
        if (dayEvents.length > maxPills) {
            html += `<div class="cal-more">+${dayEvents.length - maxPills} more</div>`;
        }
        html += '</div>';
        cur.setDate(cur.getDate() + 1);
    }

    html += '</div>';
    document.getElementById('cal-panel-month').innerHTML = html;
    setupMonthDrag();
}

function renderCalWeek() {
    const d = new Date(calCurrentDate);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('calTitle').textContent =
        `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} \u2013 ${monthNames[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;

    const baseEvents = filterHiddenCategories(expandRecurringEvents(calendarEvents, weekStart, weekEnd));
    const events = expandMultiDaySegments(baseEvents, weekStart, weekEnd);
    const today = calFmtDate(new Date());
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    let html = '<div class="cal-week-header"><div class="cal-week-header-cell"></div>';
    for (let i = 0; i < 7; i++) {
        const dd = new Date(weekStart);
        dd.setDate(weekStart.getDate() + i);
        const ds = calFmtDate(dd);
        const cls = ds === today ? 'cal-week-header-cell today' : 'cal-week-header-cell';
        html += `<div class="${cls}">${dayNames[i]}<br>${dd.getDate()}</div>`;
    }
    html += '</div>';

    // All-day row
    const allDaySegments = events.filter(e => e.allDay);
    html += '<div class="cal-week-allday"><div class="cal-week-allday-label">All day</div>';
    for (let i = 0; i < 7; i++) {
        const dd = new Date(weekStart);
        dd.setDate(weekStart.getDate() + i);
        const ds = calFmtDate(dd);
        const dayAllDay = allDaySegments.filter(e => (e._spanDate || e.date) === ds);
        html += '<div style="padding:2px;border:1px solid var(--gray-100);">';
        for (const e of dayAllDay) {
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const isMulti = (e._spanTotal || 1) > 1;
            let pillClass = 'cal-event-pill';
            let label = esc(e.title);
            if (isMulti) {
                pillClass += ' cal-pill-multi';
                if (e._spanFirst) pillClass += ' cal-pill-start';
                if (e._spanLast) pillClass += ' cal-pill-end';
                if (!e._spanFirst && !e._spanLast) pillClass += ' cal-pill-mid';
                if (!e._spanRowFirst) label = '&nbsp;';
            }
            html += `<div class="${pillClass}" style="background:${cat.color}" onclick="editCalEvent('${e._sourceId}','${e._occurrenceDate}')" title="${esc(e.title)}">${label}</div>`;
        }
        html += '</div>';
    }
    html += '</div>';

    // Time grid
    html += '<div class="cal-week-body">';
    const timedEvents = events.filter(e => !e.allDay && e.startTime);
    for (let h = 0; h <= 23; h++) {
        if (calHideOffHours && calIsOffHour(h)) continue;
        html += `<div class="cal-week-time">${calHourLabel(h)}</div>`;
        for (let i = 0; i < 7; i++) {
            const dd = new Date(weekStart);
            dd.setDate(weekStart.getDate() + i);
            const ds = calFmtDate(dd);
            html += `<div class="cal-week-cell" data-date="${ds}" data-hour="${h}" onclick="openCalEventFormAt('${ds}',${h})">`;

            const hourEvents = timedEvents.filter(e => {
                if (e.date !== ds) return false;
                return parseInt(e.startTime.split(':')[0]) === h;
            });

            const total = hourEvents.length;
            for (let idx = 0; idx < total; idx++) {
                const e = hourEvents[idx];
                const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
                const startMin = parseInt(e.startTime.split(':')[1]) || 0;
                let duration = 48;
                if (e.endTime) {
                    const sm = parseInt(e.startTime.split(':')[0]) * 60 + (parseInt(e.startTime.split(':')[1]) || 0);
                    const em = parseInt(e.endTime.split(':')[0]) * 60 + (parseInt(e.endTime.split(':')[1]) || 0);
                    duration = Math.max((em - sm) / 60 * 48, 20);
                }
                const top = (startMin / 60) * 48;
                const colStyle = total > 1 ? `left:${(idx / total) * 100}%;width:${100 / total}%;right:auto;` : '';
                html += `<div class="cal-week-event" style="background:${cat.color};top:${top}px;height:${duration}px;${colStyle}touch-action:none;" data-source-id="${e._sourceId}" data-occurrence-date="${e._occurrenceDate}" data-is-recurring="${!!e._isRecurring}" data-start-time="${e.startTime || ''}" data-end-time="${e.endTime || ''}" onclick="event.stopPropagation();editCalEvent('${e._sourceId}','${e._occurrenceDate}')" title="${esc(e.title)}">${esc(e.title)}</div>`;
            }
            html += '</div>';
        }
    }
    html += '</div>';
    document.getElementById('cal-panel-week').innerHTML = html;

    // Current time indicator
    const nowWeek = new Date();
    const nowWeekDay = calFmtDate(nowWeek);
    const weekStartStr = calFmtDate(weekStart);
    const weekEndStr = calFmtDate(weekEnd);
    if (nowWeekDay >= weekStartStr && nowWeekDay <= weekEndStr) {
        const h = nowWeek.getHours(), m = nowWeek.getMinutes();
        if (h >= 0 && h <= 23 && !(calHideOffHours && calIsOffHour(h))) {
            const visibleH = calHideOffHours ? h - [...Array(h).keys()].filter(x => calIsOffHour(x)).length : h;
            const top = visibleH * 48 + (m / 60) * 48;
            const body = document.querySelector('.cal-week-body');
            if (body) {
                const line = document.createElement('div');
                line.className = 'cal-now-line';
                line.style.top = top + 'px';
                body.appendChild(line);
                line.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
        }
    }

    setupWeekDrag();
}

function renderCalDay() {
    const ds = calFmtDate(calCurrentDate);
    document.getElementById('calTitle').textContent = calCurrentDate.toLocaleString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const baseEvents = filterHiddenCategories(expandRecurringEvents(calendarEvents, calCurrentDate, calCurrentDate));
    const events = expandMultiDaySegments(baseEvents, calCurrentDate, calCurrentDate);
    const allDay = events.filter(e => e.allDay);
    const timed = events.filter(e => !e.allDay).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    let html = '<div class="cal-day-detail">';

    if (allDay.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:12px;color:var(--gray-400);margin-bottom:4px;">All Day</div>';
        for (const e of allDay) {
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const spanLabel = (e._spanTotal || 1) > 1
                ? `<div style="font-size:10px;opacity:0.7;margin-top:2px;">Day ${(e._spanIndex || 0) + 1} of ${e._spanTotal}</div>`
                : '';
            html += `<div class="cal-day-event-card" style="background:${cat.color}" onclick="event.stopPropagation();editCalEvent('${e._sourceId}','${e._occurrenceDate}')">
                <div class="cal-evt-title">${esc(e.title)}</div>
                ${e.notes ? `<div class="cal-evt-notes">${esc(e.notes)}</div>` : ''}
                ${spanLabel}
                ${e._isRecurring ? '<div style="font-size:10px;opacity:0.7;margin-top:2px;">&#x1f501; Recurring</div>' : ''}
            </div>`;
        }
        html += '</div>';
    }

    for (let h = 0; h <= 23; h++) {
        if (calHideOffHours && calIsOffHour(h)) continue;
        const hourEvents = timed.filter(e => {
            const eHour = parseInt((e.startTime || '0').split(':')[0]);
            return eHour === h;
        });
        html += `<div class="cal-day-hour" onclick="openCalEventFormAt('${ds}',${h})">`;
        html += `<div class="cal-day-hour-label">${calHourLabel(h)}</div>`;
        html += '<div class="cal-day-hour-content">';
        for (const e of hourEvents) {
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const timeStr = e.startTime + (e.endTime ? ' \u2013 ' + e.endTime : '');
            html += `<div class="cal-day-event-card" style="background:${cat.color}" onclick="event.stopPropagation();editCalEvent('${e._sourceId}','${e._occurrenceDate}')">
                <div class="cal-evt-title">${esc(e.title)}</div>
                <div class="cal-evt-time">${timeStr}</div>
                ${e.notes ? `<div class="cal-evt-notes">${esc(e.notes)}</div>` : ''}
                ${e._isRecurring ? '<div style="font-size:10px;opacity:0.7;margin-top:2px;">&#x1f501; Recurring</div>' : ''}
            </div>`;
        }
        html += '</div></div>';
    }

    if (events.length === 0) {
        html += '<div class="empty-state" style="padding:40px 0;"><p>No events this day</p></div>';
    }

    html += '</div>';
    document.getElementById('cal-panel-day').innerHTML = html;

    // Current time indicator
    if (ds === calFmtDate(new Date())) {
        const nowDay = new Date();
        const h = nowDay.getHours(), m = nowDay.getMinutes();
        if (h >= 0 && h <= 23 && !(calHideOffHours && calIsOffHour(h))) {
            const hourRows = document.querySelectorAll('#cal-panel-day .cal-day-hour');
            const rowIdx = calHideOffHours ? h - [...Array(h).keys()].filter(x => calIsOffHour(x)).length : h;
            if (hourRows[rowIdx]) {
                hourRows[rowIdx].style.position = 'relative';
                const line = document.createElement('div');
                line.className = 'cal-now-line-day';
                line.style.top = ((m / 60) * 48) + 'px';
                hourRows[rowIdx].appendChild(line);
                hourRows[rowIdx].scrollIntoView({ block: 'center', behavior: 'instant' });
            }
        }
    }
}

function renderDashboardCalToday() {
    const container = document.getElementById('dashCalTodayContent');
    if (!container) return;

    const today = new Date();
    const ds = calFmtDate(today);

    const titleEl = document.getElementById('dashCalTodayTitle');
    if (titleEl) {
        titleEl.textContent = today.toLocaleString('default', { weekday: 'long', month: 'short', day: 'numeric' });
    }

    // Honor the dashboard venture filter (shared with Intention tab via intActiveVentureId).
    const activeVen = (typeof intActiveVentureId !== 'undefined') ? intActiveVentureId : '';
    const scopedSource = activeVen
        ? calendarEvents.filter(e => e.ventureId === activeVen)
        : calendarEvents;
    const baseEvents = filterHiddenCategories(expandRecurringEvents(scopedSource, today, today));
    const events = expandMultiDaySegments(baseEvents, today, today);
    const allDay = events.filter(e => e.allDay);
    const timed = events.filter(e => !e.allDay).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    let html = '<div class="cal-day-detail" style="max-width:none;">';

    if (allDay.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:12px;color:var(--gray-400);margin-bottom:4px;">All Day</div>';
        for (const e of allDay) {
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const spanLabel = (e._spanTotal || 1) > 1
                ? `<div style="font-size:10px;opacity:0.7;margin-top:2px;">Day ${(e._spanIndex || 0) + 1} of ${e._spanTotal}</div>`
                : '';
            html += `<div class="cal-day-event-card" style="background:${cat.color}" onclick="event.stopPropagation();switchTab('calendar');editCalEvent('${e._sourceId}','${e._occurrenceDate}')">
                <div class="cal-evt-title">${esc(e.title)}</div>
                ${e.notes ? `<div class="cal-evt-notes">${esc(e.notes)}</div>` : ''}
                ${spanLabel}
                ${e._isRecurring ? '<div style="font-size:10px;opacity:0.7;margin-top:2px;">&#x1f501; Recurring</div>' : ''}
            </div>`;
        }
        html += '</div>';
    }

    for (let h = 0; h <= 23; h++) {
        if (calHideOffHours && calIsOffHour(h)) continue;
        const hourEvents = timed.filter(e => {
            const eHour = parseInt((e.startTime || '0').split(':')[0]);
            return eHour === h;
        });
        html += `<div class="cal-day-hour" onclick="switchTab('calendar');openCalEventFormAt('${ds}',${h})">`;
        html += `<div class="cal-day-hour-label">${calHourLabel(h)}</div>`;
        html += '<div class="cal-day-hour-content">';
        for (const e of hourEvents) {
            const cat = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.other;
            const timeStr = e.startTime + (e.endTime ? ' – ' + e.endTime : '');
            html += `<div class="cal-day-event-card" style="background:${cat.color}" onclick="event.stopPropagation();switchTab('calendar');editCalEvent('${e._sourceId}','${e._occurrenceDate}')">
                <div class="cal-evt-title">${esc(e.title)}</div>
                <div class="cal-evt-time">${timeStr}</div>
                ${e.notes ? `<div class="cal-evt-notes">${esc(e.notes)}</div>` : ''}
                ${e._isRecurring ? '<div style="font-size:10px;opacity:0.7;margin-top:2px;">&#x1f501; Recurring</div>' : ''}
            </div>`;
        }
        html += '</div></div>';
    }

    if (events.length === 0) {
        html += '<div class="empty-state" style="padding:20px 0;"><p>No events today</p></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    const nowH = today.getHours();
    const nowM = today.getMinutes();
    if (nowH >= 0 && nowH <= 23 && !(calHideOffHours && calIsOffHour(nowH))) {
        const hourRows = container.querySelectorAll('.cal-day-hour');
        const rowIdx = calHideOffHours ? nowH - [...Array(nowH).keys()].filter(x => calIsOffHour(x)).length : nowH;
        if (hourRows[rowIdx]) {
            hourRows[rowIdx].style.position = 'relative';
            const line = document.createElement('div');
            line.className = 'cal-now-line-day';
            line.style.top = ((nowM / 60) * 48) + 'px';
            hourRows[rowIdx].appendChild(line);
        }
    }
}

function openCalEventFormAt(dateStr, hour) {
    openCalEventForm(dateStr);
    if (hour !== undefined && hour !== null) {
        const start = String(hour).padStart(2, '0') + ':00';
        const end = String(hour + 1).padStart(2, '0') + ':00';
        document.getElementById('calEvtStart').value = start;
        document.getElementById('calEvtEnd').value = end;
    }
}

function openCalEventForm(dateStr) {
    calEditingId = null;
    calEditingOccurrenceDate = null;
    document.getElementById('calFormTitle').textContent = 'New Event';
    document.getElementById('calEvtTitle').value = '';
    document.getElementById('calEvtCategory').value = 'personal';
    // Pre-select the currently-active venture (matches dashboard chip filter).
    const initialVenture = (typeof intActiveVentureId !== 'undefined') ? intActiveVentureId : '';
    document.getElementById('calEvtVenture').innerHTML =
        (typeof buildVentureOptions === 'function') ? buildVentureOptions(initialVenture) : '<option value="">— Personal —</option>';
    document.getElementById('calEvtDate').value = dateStr || calFmtDate(calCurrentDate);
    document.getElementById('calEvtAllDay').checked = false;
    document.getElementById('calEvtEndDate').value = '';
    document.getElementById('calEvtStart').value = '';
    document.getElementById('calEvtEnd').value = '';
    document.getElementById('calEvtRecurrence').value = 'none';
    document.getElementById('calEvtRecEnd').value = '';
    document.querySelectorAll('.cal-rec-day').forEach(cb => cb.checked = false);
    document.getElementById('calEvtNotes').value = '';
    document.getElementById('calDeleteBtn').style.display = 'none';
    document.getElementById('calEventForm').dataset.editMode = '';
    toggleCalTime();
    toggleCalRecEnd();
    document.getElementById('calEventForm').style.display = '';
    document.getElementById('calEvtTitle').focus();
}

function editCalEvent(sourceId, occurrenceDate) {
    const source = calendarEvents.find(e => e.id === sourceId);
    if (!source) return;

    let evt;
    if (source.recurrence !== 'none') {
        const exceptions = source.exceptions || {};
        const override = exceptions[occurrenceDate] || {};
        evt = { ...source, ...override, date: occurrenceDate, _sourceId: sourceId, _occurrenceDate: occurrenceDate, _isRecurring: true };
    } else {
        evt = { ...source, _sourceId: sourceId, _occurrenceDate: source.date };
    }

    if (evt._isRecurring) {
        openModal('Edit Recurring Event', 'What would you like to edit?', 'This Occurrence', 'btn-primary', () => {
            calEditingId = sourceId;
            calEditingOccurrenceDate = occurrenceDate;
            populateCalForm(evt, true);
        });
        const modal = document.getElementById('confirmModal');
        const btnGroup = modal.querySelector('.btn-group');
        const old = btnGroup.querySelector('.cal-extra-btn');
        if (old) old.remove();
        const futureBtn = document.createElement('button');
        futureBtn.className = 'btn btn-secondary cal-extra-btn';
        futureBtn.textContent = 'All Future';
        futureBtn.onclick = () => {
            closeModal();
            calEditingId = sourceId;
            calEditingOccurrenceDate = occurrenceDate;
            populateCalForm(evt, false);
            document.getElementById('calFormTitle').textContent = 'Edit All Future Events';
            document.getElementById('calEventForm').dataset.editMode = 'future';
        };
        btnGroup.insertBefore(futureBtn, btnGroup.lastElementChild);
    } else {
        calEditingId = evt.id;
        calEditingOccurrenceDate = null;
        populateCalForm(evt, false);
    }
}

function populateCalForm(evt, isOccurrence) {
    document.getElementById('calFormTitle').textContent = isOccurrence ? 'Edit Occurrence' : 'Edit Event';
    document.getElementById('calEvtTitle').value = evt.title || '';
    document.getElementById('calEvtCategory').value = evt.category || 'other';
    document.getElementById('calEvtVenture').innerHTML =
        (typeof buildVentureOptions === 'function') ? buildVentureOptions(evt.ventureId || '') : '<option value="">— Personal —</option>';
    document.getElementById('calEvtDate').value = evt.date || '';
    document.getElementById('calEvtAllDay').checked = !!evt.allDay;
    document.getElementById('calEvtEndDate').value = evt.endDate || '';
    document.getElementById('calEvtStart').value = evt.startTime || '';
    document.getElementById('calEvtEnd').value = evt.endTime || '';
    // Parse custom-weekly recurrence
    const recRaw = evt.recurrence || 'none';
    let recSelect = recRaw;
    document.querySelectorAll('.cal-rec-day').forEach(cb => cb.checked = false);
    if (recRaw.startsWith('custom-weekly:')) {
        recSelect = 'custom-weekly';
        const days = recRaw.split(':')[1].split(',');
        days.forEach(d => {
            const cb = document.querySelector(`.cal-rec-day[value="${d}"]`);
            if (cb) cb.checked = true;
        });
    }
    document.getElementById('calEvtRecurrence').value = recSelect;
    document.getElementById('calEvtRecEnd').value = evt.recurrenceEnd || '';
    document.getElementById('calEvtNotes').value = evt.notes || '';
    document.getElementById('calDeleteBtn').style.display = '';
    document.getElementById('calEventForm').dataset.editMode = isOccurrence ? 'occurrence' : 'single';
    toggleCalTime();
    toggleCalRecEnd();
    document.getElementById('calEventForm').style.display = '';
    document.getElementById('calEvtTitle').focus();
}

async function saveCalEvent() {
    const title = document.getElementById('calEvtTitle').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }

    let recurrence = document.getElementById('calEvtRecurrence').value;
    if (recurrence === 'custom-weekly') {
        const days = [...document.querySelectorAll('.cal-rec-day:checked')].map(cb => cb.value).join(',');
        if (!days) { showToast('Select at least one day', 'error'); return; }
        recurrence = 'custom-weekly:' + days;
    }

    const allDayChecked = document.getElementById('calEvtAllDay').checked;
    const startDate = document.getElementById('calEvtDate').value;
    const endDateInput = document.getElementById('calEvtEndDate').value;
    const endDate = (allDayChecked && endDateInput && endDateInput !== startDate) ? endDateInput : '';
    if (endDate && startDate && endDate < startDate) {
        showToast('End date must be on or after start date', 'error');
        return;
    }

    const formData = {
        title,
        date: startDate,
        endDate,
        startTime: document.getElementById('calEvtStart').value,
        endTime: document.getElementById('calEvtEnd').value,
        allDay: allDayChecked,
        category: document.getElementById('calEvtCategory').value,
        ventureId: document.getElementById('calEvtVenture').value || '',
        notes: document.getElementById('calEvtNotes').value.trim(),
        recurrence,
        recurrenceEnd: document.getElementById('calEvtRecEnd').value,
    };

    const editMode = document.getElementById('calEventForm').dataset.editMode;

    try {
        if (editMode === 'occurrence' && calEditingId && calEditingOccurrenceDate) {
            const occUpdates = {
                title: formData.title,
                startTime: formData.startTime,
                endTime: formData.endTime,
                allDay: formData.allDay,
                category: formData.category,
                notes: formData.notes,
            };
            // Include date if the user moved this occurrence to a different day
            if (formData.date !== calEditingOccurrenceDate) {
                occUpdates.date = formData.date;
            }
            await apiFetch('/api/calendar', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'edit-occurrence',
                    id: calEditingId,
                    occurrenceDate: calEditingOccurrenceDate,
                    updates: occUpdates,
                })
            });
        } else if (editMode === 'future' && calEditingId && calEditingOccurrenceDate) {
            await apiFetch('/api/calendar', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'edit-future',
                    id: calEditingId,
                    occurrenceDate: calEditingOccurrenceDate,
                    updates: formData
                })
            });
        } else {
            const payload = { ...formData, action: 'save' };
            if (calEditingId) {
                payload.id = calEditingId;
                // Preserve exceptions & deletedOccurrences so editing the series
                // doesn't wipe occurrence-level edits
                const existing = calendarEvents.find(e => e.id === calEditingId);
                if (existing) {
                    if (existing.exceptions) payload.exceptions = existing.exceptions;
                    if (existing.deletedOccurrences) payload.deletedOccurrences = existing.deletedOccurrences;
                }
            }
            await apiFetch('/api/calendar', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        showToast('Event saved', 'success');
        cancelCalEventForm();
        await loadCalendar();
    } catch (e) {
        // Error shown by apiFetch
    }
}

function deleteCalEvent() {
    const evt = calendarEvents.find(e => e.id === calEditingId);
    if (!evt) return;

    if (evt.recurrence !== 'none' && calEditingOccurrenceDate) {
        openModal('Delete Recurring Event', 'Delete just this occurrence, this and all future occurrences, or the entire series?', 'This Occurrence', 'btn-danger', async () => {
            try {
                await apiFetch('/api/calendar', {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'delete-occurrence',
                        id: calEditingId,
                        occurrenceDate: calEditingOccurrenceDate,
                    })
                });
                showToast('Occurrence deleted', 'success');
                cancelCalEventForm();
                await loadCalendar();
            } catch (e) {}
        });
        const modal = document.getElementById('confirmModal');
        const btnGroup = modal.querySelector('.btn-group');
        btnGroup.querySelectorAll('.cal-extra-btn').forEach(b => b.remove());

        const occDate = calEditingOccurrenceDate;
        const editingId = calEditingId;

        const futureBtn = document.createElement('button');
        futureBtn.className = 'btn btn-danger cal-extra-btn';
        futureBtn.textContent = 'This & Future';
        futureBtn.onclick = async () => {
            closeModal();
            try {
                await apiFetch('/api/calendar', {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'delete-this-and-future',
                        id: editingId,
                        occurrenceDate: occDate,
                    })
                });
                showToast('This and future occurrences deleted', 'success');
                cancelCalEventForm();
                await loadCalendar();
            } catch (e) {}
        };

        const allBtn = document.createElement('button');
        allBtn.className = 'btn btn-danger cal-extra-btn';
        allBtn.textContent = 'All Events';
        allBtn.onclick = async () => {
            closeModal();
            try {
                await apiFetch('/api/calendar', {
                    method: 'DELETE',
                    body: JSON.stringify({ id: editingId })
                });
                showToast('Event series deleted', 'success');
                cancelCalEventForm();
                await loadCalendar();
            } catch (e) {}
        };

        btnGroup.insertBefore(futureBtn, btnGroup.lastElementChild);
        btnGroup.insertBefore(allBtn, btnGroup.lastElementChild);
    } else {
        openModal('Delete Event', 'Are you sure you want to delete this event?', 'Delete', 'btn-danger', async () => {
            try {
                await apiFetch('/api/calendar', {
                    method: 'DELETE',
                    body: JSON.stringify({ id: calEditingId })
                });
                showToast('Event deleted', 'success');
                cancelCalEventForm();
                await loadCalendar();
            } catch (e) {}
        });
    }
}

function cancelCalEventForm() {
    document.getElementById('calEventForm').style.display = 'none';
    calEditingId = null;
    calEditingOccurrenceDate = null;
    document.getElementById('calEventForm').dataset.editMode = '';
}

function toggleCalTime() {
    const allDay = document.getElementById('calEvtAllDay').checked;
    document.querySelectorAll('.cal-time-group').forEach(g => g.style.display = allDay ? 'none' : '');
    document.querySelectorAll('.cal-end-date-group').forEach(g => g.style.display = allDay ? '' : 'none');
}

function toggleCalRecEnd() {
    const rec = document.getElementById('calEvtRecurrence').value;
    document.querySelector('.cal-rec-end-group').style.display = rec !== 'none' ? '' : 'none';
    document.getElementById('calRecDaysRow').style.display = rec === 'custom-weekly' ? '' : 'none';
}

// ==================== MONTH VIEW DRAG & DROP ====================

let _calMonthDrag = null;

function setupMonthDrag() {
    const pills = document.querySelectorAll('.cal-event-pill[data-source-id]');
    for (const el of pills) {
        el.addEventListener('pointerdown', calMonthDragStart);
    }
}

function calMonthDragStart(e) {
    if (e.button && e.button !== 0) return;

    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;

        if (!_calMonthDrag && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
            const ghost = document.createElement('div');
            ghost.className = 'cal-drag-ghost';
            ghost.style.background = el.style.background;
            ghost.style.width = el.offsetWidth + 'px';
            ghost.textContent = el.textContent;
            document.body.appendChild(ghost);

            el.style.opacity = '0.3';

            _calMonthDrag = {
                el,
                ghost,
                sourceId: el.dataset.sourceId,
                occurrenceDate: el.dataset.occurrenceDate,
                isRecurring: el.dataset.isRecurring === 'true',
            };
        }

        if (_calMonthDrag) {
            me.preventDefault();
            _calMonthDrag.ghost.style.left = (me.clientX - 20) + 'px';
            _calMonthDrag.ghost.style.top = (me.clientY - 10) + 'px';

            _calMonthDrag.ghost.style.display = 'none';
            const hit = document.elementFromPoint(me.clientX, me.clientY);
            _calMonthDrag.ghost.style.display = '';

            document.querySelectorAll('.cal-day.drag-over').forEach(c => c.classList.remove('drag-over'));
            const day = hit?.closest('.cal-day[data-date]');
            if (day) day.classList.add('drag-over');
        }
    };

    const onUp = async (ue) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);

        if (!_calMonthDrag) return;

        _calMonthDrag.ghost.style.display = 'none';
        const hit = document.elementFromPoint(ue.clientX, ue.clientY);
        _calMonthDrag.ghost.style.display = '';

        document.querySelectorAll('.cal-day.drag-over').forEach(c => c.classList.remove('drag-over'));

        const drag = _calMonthDrag;
        drag.ghost.remove();
        drag.el.style.opacity = '';
        _calMonthDrag = null;

        window.addEventListener('click', (ce) => { ce.stopPropagation(); ce.preventDefault(); }, { capture: true, once: true });

        const day = hit?.closest('.cal-day[data-date]');
        if (!day) return;

        const newDate = day.dataset.date;
        if (newDate === drag.occurrenceDate) return;

        try {
            if (drag.isRecurring) {
                const source = calendarEvents.find(ev => ev.id === drag.sourceId);
                if (source) {
                    const override = (source.exceptions || {})[drag.occurrenceDate] || {};
                    await apiFetch('/api/calendar', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'delete-occurrence', id: drag.sourceId, occurrenceDate: drag.occurrenceDate })
                    });
                    await apiFetch('/api/calendar', {
                        method: 'POST',
                        body: JSON.stringify({
                            action: 'save',
                            title: override.title || source.title,
                            date: newDate,
                            startTime: override.startTime || source.startTime || '',
                            endTime: override.endTime || source.endTime || '',
                            allDay: override.allDay !== undefined ? override.allDay : (source.allDay || false),
                            category: override.category || source.category,
                            notes: override.notes !== undefined ? override.notes : (source.notes || ''),
                            recurrence: 'none',
                        })
                    });
                }
            } else {
                const source = calendarEvents.find(ev => ev.id === drag.sourceId);
                if (source) {
                    await apiFetch('/api/calendar', {
                        method: 'POST',
                        body: JSON.stringify({
                            ...source,
                            action: 'save',
                            id: drag.sourceId,
                            date: newDate,
                        })
                    });
                }
            }
            showToast('Event moved', 'success');
            await loadCalendar();
        } catch (e) {}
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

// ==================== WEEK VIEW DRAG & DROP ====================

let _calDrag = null;

function setupWeekDrag() {
    const events = document.querySelectorAll('.cal-week-event');
    for (const el of events) {
        el.addEventListener('pointerdown', calDragPointerDown);
    }
}

function calDragPointerDown(e) {
    if (e.button && e.button !== 0) return;

    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;

        // Wait for threshold before starting drag
        if (!_calDrag && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
            const ghost = document.createElement('div');
            ghost.className = 'cal-drag-ghost';
            ghost.style.background = el.style.background;
            ghost.style.width = el.offsetWidth + 'px';
            ghost.textContent = el.textContent;
            document.body.appendChild(ghost);

            el.classList.add('dragging');

            _calDrag = {
                el,
                ghost,
                sourceId: el.dataset.sourceId,
                occurrenceDate: el.dataset.occurrenceDate,
                isRecurring: el.dataset.isRecurring === 'true',
                startTime: el.dataset.startTime,
                endTime: el.dataset.endTime,
            };
        }

        if (_calDrag) {
            me.preventDefault();
            _calDrag.ghost.style.left = (me.clientX - 20) + 'px';
            _calDrag.ghost.style.top = (me.clientY - 10) + 'px';

            // Highlight target cell
            _calDrag.ghost.style.display = 'none';
            const hit = document.elementFromPoint(me.clientX, me.clientY);
            _calDrag.ghost.style.display = '';

            document.querySelectorAll('.cal-week-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
            const cell = hit?.closest('.cal-week-cell');
            if (cell) cell.classList.add('drag-over');
        }
    };

    const onUp = async (ue) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);

        if (!_calDrag) return;

        // Find drop target
        _calDrag.ghost.style.display = 'none';
        const hit = document.elementFromPoint(ue.clientX, ue.clientY);
        _calDrag.ghost.style.display = '';

        document.querySelectorAll('.cal-week-cell.drag-over').forEach(c => c.classList.remove('drag-over'));

        const drag = _calDrag;
        drag.ghost.remove();
        drag.el.classList.remove('dragging');
        _calDrag = null;

        // Prevent the click that follows pointerup after a drag
        window.addEventListener('click', (ce) => { ce.stopPropagation(); ce.preventDefault(); }, { capture: true, once: true });

        const cell = hit?.closest('.cal-week-cell');
        if (!cell) return;

        const newDate = cell.dataset.date;
        const newHour = parseInt(cell.dataset.hour);

        // Preserve minutes offset and duration from original event
        const oldStartMin = drag.startTime ? parseInt(drag.startTime.split(':')[1] || 0) : 0;
        const newStart = String(newHour).padStart(2, '0') + ':' + String(oldStartMin).padStart(2, '0');

        let newEnd = '';
        if (drag.startTime && drag.endTime) {
            const sm = parseInt(drag.startTime.split(':')[0]) * 60 + parseInt(drag.startTime.split(':')[1] || 0);
            const em = parseInt(drag.endTime.split(':')[0]) * 60 + parseInt(drag.endTime.split(':')[1] || 0);
            const duration = em - sm;
            const newEndTotal = newHour * 60 + oldStartMin + duration;
            newEnd = String(Math.floor(newEndTotal / 60)).padStart(2, '0') + ':' + String(newEndTotal % 60).padStart(2, '0');
        }

        // No change — skip
        if (newDate === drag.occurrenceDate && newStart === drag.startTime) return;

        try {
            if (drag.isRecurring) {
                if (newDate !== drag.occurrenceDate) {
                    // Cross-day move: delete this occurrence, create standalone event
                    const source = calendarEvents.find(ev => ev.id === drag.sourceId);
                    if (source) {
                        const override = (source.exceptions || {})[drag.occurrenceDate] || {};
                        await apiFetch('/api/calendar', {
                            method: 'POST',
                            body: JSON.stringify({ action: 'delete-occurrence', id: drag.sourceId, occurrenceDate: drag.occurrenceDate })
                        });
                        await apiFetch('/api/calendar', {
                            method: 'POST',
                            body: JSON.stringify({
                                action: 'save',
                                title: override.title || source.title,
                                date: newDate, startTime: newStart, endTime: newEnd,
                                allDay: false,
                                category: override.category || source.category,
                                notes: override.notes !== undefined ? override.notes : (source.notes || ''),
                                recurrence: 'none',
                            })
                        });
                    }
                } else {
                    // Same-day: update time via occurrence exception
                    await apiFetch('/api/calendar', {
                        method: 'POST',
                        body: JSON.stringify({
                            action: 'edit-occurrence',
                            id: drag.sourceId,
                            occurrenceDate: drag.occurrenceDate,
                            updates: { startTime: newStart, endTime: newEnd },
                        })
                    });
                }
            } else {
                const source = calendarEvents.find(ev => ev.id === drag.sourceId);
                if (source) {
                    await apiFetch('/api/calendar', {
                        method: 'POST',
                        body: JSON.stringify({
                            ...source,
                            action: 'save',
                            id: drag.sourceId,
                            date: newDate,
                            startTime: newStart,
                            endTime: newEnd,
                        })
                    });
                }
            }
            showToast('Event moved', 'success');
            await loadCalendar();
        } catch (e) {
            // Error shown by apiFetch
        }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}
