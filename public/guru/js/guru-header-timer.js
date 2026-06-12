/* ==========================================================================
   Guru Dashboard — Header Timer
   Always-visible timer next to "Jarin Admin". Three switchable variants:
     pill  — minimal: dot + name + HH:MM:SS, idle shows Start dropdown
     guilt — pill + "untracked Xh Ym" counter that climbs while no timer runs
     ring  — small SVG progress ring of today's logged minutes vs a daily goal
   Style + ring goal persist in localStorage; switcher popover lets the user
   trial each variant without picking one up front. Reads/writes the same
   timer state as the Office Work tab (owGetActive / owStartTimer / etc.).
   ========================================================================== */

const HDR_STYLE_KEY = 'guru-hdr-timer-style';
const HDR_GOAL_KEY = 'guru-hdr-timer-goal-min';
const HDR_LAST_STOP_KEY = 'guru-hdr-last-stop';
const HDR_DEFAULT_STYLE = 'pill';
const HDR_DEFAULT_GOAL_MIN = 240; // 4h
const HDR_STYLES = ['pill', 'guilt', 'ring'];

let hdrTickInterval = null;
let hdrPopoverOpen = null; // 'dropdown' | 'switcher' | null

function hdrStyle() {
    const v = localStorage.getItem(HDR_STYLE_KEY);
    return HDR_STYLES.includes(v) ? v : HDR_DEFAULT_STYLE;
}
function hdrSetStyle(s) {
    if (!HDR_STYLES.includes(s)) return;
    localStorage.setItem(HDR_STYLE_KEY, s);
    hdrTimerRender();
}
function hdrGoalMin() {
    const v = parseInt(localStorage.getItem(HDR_GOAL_KEY), 10);
    return v > 0 ? v : HDR_DEFAULT_GOAL_MIN;
}
function hdrSetGoalMin(m) {
    const n = Math.max(15, Math.min(1440, parseInt(m, 10) || HDR_DEFAULT_GOAL_MIN));
    localStorage.setItem(HDR_GOAL_KEY, String(n));
    hdrTimerRender();
}

function hdrTodayTotalSec() {
    if (typeof owTodayTotals === 'undefined' || !Array.isArray(owTodayTotals)) return 0;
    return owTodayTotals.reduce((s, t) => s + (t.total || 0), 0);
}

function hdrLastStopMs() {
    // Prefer the explicit localStorage marker (updated on stop), fall back to
    // most-recent session.endedAt, then to page-load time.
    const stored = localStorage.getItem(HDR_LAST_STOP_KEY);
    if (stored) {
        const t = Date.parse(stored);
        if (!Number.isNaN(t)) return t;
    }
    if (typeof owSessions !== 'undefined' && Array.isArray(owSessions) && owSessions.length) {
        let max = 0;
        for (const s of owSessions) {
            const t = Date.parse(s.endedAt || s.startedAt || 0);
            if (t > max) max = t;
        }
        if (max) return max;
    }
    return Date.now(); // first load with no history — start from now
}

function hdrUntrackedSec() {
    return Math.max(0, Math.floor((Date.now() - hdrLastStopMs()) / 1000));
}

function hdrFormatHM(sec) {
    const m = Math.round((sec || 0) / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}
function hdrFormatHMS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return [h, m, ss].map(n => String(n).padStart(2, '0')).join(':');
}

function hdrActiveCategory(state) {
    if (!state || typeof owCategories === 'undefined') return null;
    return owCategories.find(c => c.id === state.categoryId) || null;
}

// ==================== RENDER ====================
function hdrTimerRender() {
    const el = document.getElementById('hdrTimer');
    if (!el) return;

    // Hide until Office Work data has loaded at least once — otherwise the
    // dropdown is empty and "untracked" is meaningless.
    if (typeof owCategories === 'undefined' || !Array.isArray(owCategories) || owCategories.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = '';

    const state = typeof owGetActive === 'function' ? owGetActive() : null;
    const cat = hdrActiveCategory(state);
    const style = hdrStyle();
    const running = !!state;

    let html = '';
    if (style === 'ring') {
        html += hdrRenderRing(state, cat);
    } else {
        if (style === 'guilt' && !running) {
            const u = hdrUntrackedSec();
            const cls = u > 7200 ? 'alarm' : (u > 3600 ? 'warn' : '');
            html += `<span class="hdr-timer-untracked ${cls}" data-hdr-untracked>&#9201; untracked ${esc(hdrFormatHM(u))}</span>`;
        }
        html += hdrRenderPillBody(state, cat);
    }

    html += `<button class="hdr-timer-more" title="Timer options" onclick="hdrTogglePopover(event,'switcher')">&#8943;</button>`;

    if (hdrPopoverOpen === 'dropdown') html += hdrRenderDropdown();
    if (hdrPopoverOpen === 'switcher') html += hdrRenderSwitcher();

    el.innerHTML = html;
    el.style.setProperty('--hdr-cat-color', cat ? (cat.color || '#93c5fd') : 'rgba(255,255,255,0.55)');

    hdrEnsureTick();
}

function hdrRenderPillBody(state, cat) {
    if (state && cat) {
        const elapsed = owElapsedSec(state);
        const pauseLabel = state.paused ? '&#9654;' : '&#10074;&#10074;'; // play / pause-bars
        return `
            <div class="hdr-timer-shell running">
              <span class="hdr-timer-dot"></span>
              <span class="hdr-timer-time" data-hdr-elapsed>${hdrFormatHMS(elapsed)}</span>
              <span class="hdr-timer-name">${esc(cat.name)}</span>
              <button class="hdr-timer-btn" title="${state.paused ? 'Resume' : 'Pause'}" onclick="owPauseToggle()">${pauseLabel}</button>
              <button class="hdr-timer-btn stop" title="Stop" onclick="hdrStopTimer()">&#9632;</button>
            </div>
        `;
    }
    return `
        <button class="hdr-timer-start" onclick="hdrTogglePopover(event,'dropdown')">
          &#9654; Start <span class="caret">&#9662;</span>
        </button>
    `;
}

function hdrRenderRing(state, cat) {
    const goalSec = hdrGoalMin() * 60;
    const liveExtra = state && !state.paused ? owElapsedSec(state) : (state ? state.accumulatedSec || 0 : 0);
    const totalSec = hdrTodayTotalSec() + (state ? liveExtra : 0);
    const pct = Math.min(1, totalSec / goalSec);
    const C = 2 * Math.PI * 16; // r=16 in viewBox 36x36
    const offset = C * (1 - pct);
    const goalMet = totalSec >= goalSec;

    const ring = `
        <div class="hdr-ring-wrap" title="${hdrFormatHM(totalSec)} of ${hdrFormatHM(goalSec)} goal">
          <svg class="hdr-ring" viewBox="0 0 36 36">
            <circle class="hdr-ring-track" cx="18" cy="18" r="16"></circle>
            <circle class="hdr-ring-fill" cx="18" cy="18" r="16"
                    stroke-dasharray="${C.toFixed(2)}"
                    stroke-dashoffset="${offset.toFixed(2)}"
                    data-hdr-ring></circle>
          </svg>
          <div class="hdr-ring-center ${goalMet ? 'hdr-ring-goal-met' : ''}" data-hdr-ring-center>
            ${goalMet ? '&#10003;' : ''}
          </div>
        </div>
    `;

    if (state && cat) {
        const pauseLabel = state.paused ? '&#9654;' : '&#10074;&#10074;';
        return ring + `
            <div class="hdr-timer-shell running">
              <span class="hdr-timer-time" data-hdr-elapsed>${hdrFormatHMS(owElapsedSec(state))}</span>
              <span class="hdr-timer-name">${esc(cat.name)}</span>
              <button class="hdr-timer-btn" title="${state.paused ? 'Resume' : 'Pause'}" onclick="owPauseToggle()">${pauseLabel}</button>
              <button class="hdr-timer-btn stop" title="Stop" onclick="hdrStopTimer()">&#9632;</button>
            </div>
        `;
    }
    return ring + `
        <button class="hdr-timer-start" onclick="hdrTogglePopover(event,'dropdown')">
          &#9654; Start <span class="caret">&#9662;</span>
        </button>
    `;
}

function hdrRenderDropdown() {
    const list = (owCategories || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const todayMap = Object.fromEntries((owTodayTotals || []).map(t => [t.categoryId, t.total]));
    let body = '<h4>Pick a task</h4>';
    if (!list.length) {
        body += '<div style="color:var(--gray-500);font-size:12px;">No categories yet. Open Office Work to add one.</div>';
    } else {
        for (const c of list) {
            const today = todayMap[c.id] || 0;
            body += `
                <div class="cat-row" onclick="hdrPickCategory('${esc(c.id)}')">
                  <span class="cat-dot" style="background:${esc(c.color || '#3b82f6')}"></span>
                  <span class="cat-name">${esc(c.name)}</span>
                  <span class="cat-today">${today ? hdrFormatHM(today) : '0m'}</span>
                </div>
            `;
        }
    }
    return `<div class="hdr-popover dropdown" onclick="event.stopPropagation()">${body}</div>`;
}

function hdrRenderSwitcher() {
    const cur = hdrStyle();
    const goal = hdrGoalMin();
    const opt = (id, label, hint) => `
        <label class="hdr-style-row">
          <input type="radio" name="hdrStyle" value="${id}" ${cur === id ? 'checked' : ''} onchange="hdrSetStyle('${id}')">
          <span class="label">${label}</span>
          <span class="hint">${hint}</span>
        </label>
    `;
    return `
        <div class="hdr-popover switcher" onclick="event.stopPropagation()">
          <h4>Timer style</h4>
          ${opt('pill',  'Pill',  'minimal')}
          ${opt('guilt', 'Guilt', 'idle counter')}
          ${opt('ring',  'Ring',  'daily goal')}
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-200);display:flex;align-items:center;gap:8px;">
            <span style="flex:1;font-size:12px;color:var(--gray-500);">Daily goal (ring)</span>
            <input class="hdr-goal-input" type="number" min="15" max="1440" step="15"
                   value="${goal}" onchange="hdrSetGoalMin(this.value)">
            <span style="font-size:12px;color:var(--gray-500);">min</span>
          </div>
          <div style="margin-top:8px;font-size:11px;color:var(--gray-400);">Try each for a few days, then settle on one.</div>
        </div>
    `;
}

// ==================== POPOVER ====================
function hdrTogglePopover(e, which) {
    if (e) e.stopPropagation();
    hdrPopoverOpen = hdrPopoverOpen === which ? null : which;
    hdrTimerRender();
}
function hdrClosePopover() {
    if (hdrPopoverOpen) {
        hdrPopoverOpen = null;
        hdrTimerRender();
    }
}
document.addEventListener('click', (e) => {
    if (!hdrPopoverOpen) return;
    const el = document.getElementById('hdrTimer');
    if (el && !el.contains(e.target)) hdrClosePopover();
});

// ==================== ACTIONS ====================
function hdrPickCategory(catId) {
    hdrPopoverOpen = null;
    if (typeof owStartTimer === 'function') owStartTimer(catId);
    hdrTimerRender();
}

// Wrap stop so we can stamp the last-stop time (used by guilt mode after reload)
async function hdrStopTimer() {
    if (typeof owStopTimer !== 'function') return;
    await owStopTimer();
    localStorage.setItem(HDR_LAST_STOP_KEY, new Date().toISOString());
    hdrTimerRender();
}

// ==================== TICK ====================
function hdrEnsureTick() {
    if (hdrTickInterval) return;
    hdrTickInterval = setInterval(hdrTick, 1000);
}
function hdrTick() {
    const el = document.getElementById('hdrTimer');
    if (!el || el.style.display === 'none') return;

    const state = typeof owGetActive === 'function' ? owGetActive() : null;

    // Running timer — update elapsed text + ring fill in place (no innerHTML churn).
    if (state) {
        const elapsedSec = owElapsedSec(state);
        const elapsedTxt = hdrFormatHMS(elapsedSec);
        el.querySelectorAll('[data-hdr-elapsed]').forEach(n => { n.textContent = elapsedTxt; });

        if (hdrStyle() === 'ring') {
            const goalSec = hdrGoalMin() * 60;
            const totalSec = hdrTodayTotalSec() + (state.paused ? 0 : elapsedSec);
            const pct = Math.min(1, totalSec / goalSec);
            const C = 2 * Math.PI * 16;
            const ring = el.querySelector('[data-hdr-ring]');
            if (ring) ring.setAttribute('stroke-dashoffset', (C * (1 - pct)).toFixed(2));
        }
        return;
    }

    // Idle — guilt mode wants the untracked counter to climb every second.
    if (hdrStyle() === 'guilt') {
        const u = hdrUntrackedSec();
        const node = el.querySelector('[data-hdr-untracked]');
        if (node) {
            node.innerHTML = `&#9201; untracked ${esc(hdrFormatHM(u))}`;
            node.classList.toggle('warn', u > 3600 && u <= 7200);
            node.classList.toggle('alarm', u > 7200);
        } else {
            hdrTimerRender(); // shell missing — re-render once to add it
        }
    }
}

// Public hook — Office Work calls this after each data load so the header
// picks up fresh category names, today totals, and active-timer state.
function hdrTimerRefresh() {
    hdrTimerRender();
}
