/* ==========================================================================
   Guru Dashboard — Workout Tracker Module
   Log workouts, track progression, body measurements
   ========================================================================== */

const EXERCISE_LIBRARY = [
    // Chest
    { name: 'Bench Press', muscle: 'Chest' },
    { name: 'Incline Bench Press', muscle: 'Chest' },
    { name: 'Decline Bench Press', muscle: 'Chest' },
    { name: 'Dumbbell Chest Press', muscle: 'Chest' },
    { name: 'Incline Dumbbell Press', muscle: 'Chest' },
    { name: 'Chest Fly', muscle: 'Chest' },
    { name: 'Cable Fly', muscle: 'Chest' },
    { name: 'Push-up', muscle: 'Chest' },
    // Back
    { name: 'Deadlift', muscle: 'Back' },
    { name: 'Barbell Row', muscle: 'Back' },
    { name: 'Dumbbell Row', muscle: 'Back', defaultUnilateral: true },
    { name: 'Lat Pulldown', muscle: 'Back' },
    { name: 'Pull-up', muscle: 'Back' },
    { name: 'Chin-up', muscle: 'Back' },
    { name: 'Seated Cable Row', muscle: 'Back' },
    { name: 'T-Bar Row', muscle: 'Back' },
    { name: 'Face Pull', muscle: 'Back' },
    // Shoulders
    { name: 'Overhead Press', muscle: 'Shoulders' },
    { name: 'Dumbbell Shoulder Press', muscle: 'Shoulders' },
    { name: 'Lateral Raise', muscle: 'Shoulders', defaultUnilateral: true },
    { name: 'Front Raise', muscle: 'Shoulders' },
    { name: 'Rear Delt Fly', muscle: 'Shoulders' },
    { name: 'Arnold Press', muscle: 'Shoulders' },
    // Biceps
    { name: 'Barbell Curl', muscle: 'Biceps' },
    { name: 'Dumbbell Curl', muscle: 'Biceps', defaultUnilateral: true },
    { name: 'Hammer Curl', muscle: 'Biceps', defaultUnilateral: true },
    { name: 'Preacher Curl', muscle: 'Biceps' },
    { name: 'Cable Curl', muscle: 'Biceps' },
    { name: 'Concentration Curl', muscle: 'Biceps', defaultUnilateral: true },
    // Triceps
    { name: 'Tricep Pushdown', muscle: 'Triceps' },
    { name: 'Tricep Dip', muscle: 'Triceps' },
    { name: 'Overhead Tricep Extension', muscle: 'Triceps' },
    { name: 'Skull Crusher', muscle: 'Triceps' },
    { name: 'Close-Grip Bench Press', muscle: 'Triceps' },
    // Legs
    { name: 'Back Squat', muscle: 'Legs' },
    { name: 'Front Squat', muscle: 'Legs' },
    { name: 'Leg Press', muscle: 'Legs' },
    { name: 'Leg Extension', muscle: 'Legs' },
    { name: 'Leg Curl', muscle: 'Legs' },
    { name: 'Romanian Deadlift', muscle: 'Legs' },
    { name: 'Bulgarian Split Squat', muscle: 'Legs', defaultUnilateral: true },
    { name: 'Lunge', muscle: 'Legs', defaultUnilateral: true },
    { name: 'Calf Raise', muscle: 'Legs' },
    { name: 'Hip Thrust', muscle: 'Legs' },
    // Glutes
    { name: 'Glute Bridge', muscle: 'Glutes' },
    { name: 'Cable Kickback', muscle: 'Glutes', defaultUnilateral: true },
    { name: 'Sumo Deadlift', muscle: 'Glutes' },
    // Core
    { name: 'Plank', muscle: 'Core' },
    { name: 'Hanging Leg Raise', muscle: 'Core' },
    { name: 'Cable Crunch', muscle: 'Core' },
    { name: 'Ab Wheel Rollout', muscle: 'Core' },
    { name: 'Russian Twist', muscle: 'Core' },
    // Cardio
    { name: 'Running', muscle: 'Cardio' },
    { name: 'Cycling', muscle: 'Cardio' },
    { name: 'Rowing Machine', muscle: 'Cardio' },
    { name: 'Jump Rope', muscle: 'Cardio' },
];

const kgToLb = (kg) => kg ? (kg * 2.20462).toFixed(1) : '0';
const lbToKg = (lb) => lb ? (lb / 2.20462).toFixed(1) : '0';
function wkFmtDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? m + 'm ' + (s > 0 ? s + 's' : '') : s + 's';
}

let wkAllWorkouts = [];
let wkAllMeasurements = [];
let wkAllBloodMarkers = [];
let wkAllSex = [];
let wkSexEditId = null;
let wkBloodRanges = {};
let wkForm = null;
let wkView = 'log';
const WK_DRAFT_KEY = 'guru-wk-draft';

const BLOOD_MARKER_DEFS = {
    free_test_ngdl:  { label: 'Free Testosterone',   unit: 'ng/dL',  defaultRange: [5, 21] },
    free_test_pct:   { label: 'Free Testosterone %',  unit: '%',      defaultRange: [1.5, 4.0] },
    total_test:      { label: 'Total Testosterone',   unit: 'ng/dL',  defaultRange: [264, 916] },
    shbg:            { label: 'SHBG',                 unit: 'nmol/L', defaultRange: [16, 55] },
    estradiol_ratio: { label: 'Estradiol Ratio',      unit: '',       defaultRange: [14, 50] },
    estradiol:       { label: 'Estradiol',            unit: 'pg/mL',  defaultRange: [7.6, 42.6] },
    prolactin:       { label: 'Prolactin',            unit: 'ng/mL',  defaultRange: [4, 15.2] },
    lh:              { label: 'LH',                   unit: 'mIU/mL', defaultRange: [1.7, 8.6] },
};

function switchWkView(view) {
    wkView = view;
    document.querySelectorAll('.wk-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.wk-panel').forEach(p => p.style.display = 'none');
    document.getElementById('wkPanel-' + view).style.display = '';
    if (view === 'history') renderWkHistory();
    if (view === 'progression') renderWkProgression();
    if (view === 'measurements') renderWkMeasurements();
    if (view === 'bloodwork') renderWkBloodwork();
    if (view === 'sex') renderWkSex();
}

async function loadWorkouts() {
    try {
        const [wkData, mData, bmData, sxData, settingsData] = await Promise.all([
            apiFetch('/api/workouts'),
            apiFetch('/api/measurements'),
            apiFetch('/api/blood-markers').catch(() => ({ markers: [] })),
            apiFetch('/api/sex').catch(() => ({ entries: [] })),
            apiFetch('/api/settings').catch(() => ({})),
        ]);
        wkAllWorkouts = wkData.workouts || [];
        wkAllMeasurements = mData.measurements || [];
        wkAllBloodMarkers = bmData.markers || [];
        wkAllSex = sxData.entries || [];
        wkBloodRanges = settingsData.bloodMarkerRanges || {};
        const stats = wkData.stats || {};

        document.getElementById('wkStatWeek').textContent = stats.thisWeek || 0;
        document.getElementById('wkStatMonth').textContent = stats.thisMonth || 0;
        document.getElementById('wkStatLast').textContent = stats.lastWorkout || '--';

        renderWkForm();
        renderWkHistory();
    } catch (e) {
        document.getElementById('wkPanel-history').innerHTML = '<div class="empty-state"><p>Failed to load workouts.</p></div>';
    }
}

// --- Exercise Library Dropdown ---
function buildExerciseSelect(selectedName) {
    const muscles = [...new Set(EXERCISE_LIBRARY.map(e => e.muscle))];
    let html = '<option value="">Select exercise...</option>';
    for (const m of muscles) {
        html += `<optgroup label="${m}">`;
        for (const ex of EXERCISE_LIBRARY.filter(e => e.muscle === m)) {
            const sel = ex.name === selectedName ? ' selected' : '';
            html += `<option value="${escapeHtml(ex.name)}"${sel}>${escapeHtml(ex.name)}</option>`;
        }
        html += '</optgroup>';
    }
    html += '<optgroup label="Custom"><option value="__custom__">Other (custom)...</option></optgroup>';
    return html;
}

// --- Draft persistence ---
function saveWkDraft() {
    if (!wkForm) return;
    try { localStorage.setItem(WK_DRAFT_KEY, JSON.stringify(wkForm)); } catch (e) { /* quota */ }
}

function loadWkDraft() {
    try {
        const raw = localStorage.getItem(WK_DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function clearWkDraft() {
    try { localStorage.removeItem(WK_DRAFT_KEY); } catch (e) { /* */ }
}

function resumeWkDraft() {
    const draft = loadWkDraft();
    if (!draft) return;
    wkForm = draft;
    showToast('Draft restored', 'success');
    renderWkForm();
    switchWkView('log');
}

// --- Start / Repeat ---
function startBlankWorkout() {
    wkForm = {
        id: null,
        date: new Date().toISOString().split('T')[0],
        notes: '',
        durationMinutes: 0,
        bodyweightKg: 0,
        exercises: [],
    };
    renderWkForm();
    switchWkView('log');
}

function repeatWorkout(id) {
    const source = wkAllWorkouts.find(w => w.id === id);
    if (!source) return;
    const exercises = (typeof source.exercises === 'string' ? JSON.parse(source.exercises) : source.exercises) || [];
    wkForm = {
        id: null,
        date: new Date().toISOString().split('T')[0],
        notes: '',
        durationMinutes: 0,
        bodyweightKg: source.bodyweightKg || 0,
        exercises: JSON.parse(JSON.stringify(exercises)),
    };
    showToast('Workout template loaded', 'success');
    renderWkForm();
    switchWkView('log');
}

function editWorkout(id) {
    const source = wkAllWorkouts.find(w => w.id === id);
    if (!source) return;
    const exercises = (typeof source.exercises === 'string' ? JSON.parse(source.exercises) : source.exercises) || [];
    wkForm = {
        id: source.id,
        date: source.date,
        notes: source.notes || '',
        durationMinutes: source.durationMinutes || 0,
        bodyweightKg: source.bodyweightKg || 0,
        exercises: JSON.parse(JSON.stringify(exercises)),
    };
    renderWkForm();
    switchWkView('log');
}

// --- Form Rendering ---
function renderWkForm() {
    const f = wkForm;
    if (!f) {
        const draft = loadWkDraft();
        document.getElementById('wkPanel-log').innerHTML = `<div style="text-align:center;padding:40px;">
            <p style="color:var(--gray-500);margin-bottom:16px;">Start a new workout</p>
            <button class="btn btn-primary" onclick="startBlankWorkout()">New Workout</button>
            ${draft ? `<button class="btn btn-secondary" style="margin-left:8px;" onclick="resumeWkDraft()">Resume Draft</button>` : ''}
        </div>`;
        return;
    }

    let html = '<div class="wk-form">';

    // Header
    html += '<div class="wk-form-header">';
    html += `<div class="form-row" style="gap:8px;margin-bottom:8px;">
        <div class="form-group" style="flex:1;"><label>Date</label><input type="date" id="wkDate" value="${f.date}" onchange="wkForm.date=this.value"></div>
        <div class="form-group" style="flex:1;"><label>Bodyweight</label><div style="display:flex;align-items:center;gap:6px;"><input type="number" id="wkBodyweight" value="${f.bodyweightKg || ''}" step="0.5" placeholder="kg" onchange="wkForm.bodyweightKg=parseFloat(this.value)||0" style="flex:1;"><span style="font-size:12px;color:var(--gray-400);min-width:50px;">${f.bodyweightKg ? kgToLb(f.bodyweightKg) + ' lb' : ''}</span></div></div>
        <div class="form-group" style="flex:1;"><label>Duration (min)</label><input type="number" id="wkDuration" value="${f.durationMinutes || ''}" placeholder="minutes" onchange="wkForm.durationMinutes=parseInt(this.value)||0"></div>
    </div>`;
    html += `<div class="form-group" style="margin-bottom:8px;"><label>Notes</label><input type="text" id="wkNotes" value="${escapeHtml(f.notes)}" placeholder="Optional workout notes" onchange="wkForm.notes=this.value"></div>`;
    html += '</div>';

    // Exercises
    html += '<div class="wk-exercises">';
    f.exercises.forEach((ex, ei) => {
        const libEntry = EXERCISE_LIBRARY.find(l => l.name === ex.name);
        const isCustom = ex.name && !libEntry;
        html += `<div class="wk-exercise-block">`;
        html += `<div class="wk-exercise-header">
            <span class="wk-exercise-num">${ei + 1}</span>
            <select onchange="wkSetExerciseName(${ei}, this.value)" style="flex:1;">${buildExerciseSelect(isCustom ? '__custom__' : ex.name)}</select>
            ${isCustom ? `<input type="text" value="${escapeHtml(ex.name)}" placeholder="Exercise name" onchange="wkForm.exercises[${ei}].name=this.value" style="flex:1;">` : ''}
            <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;"><input type="checkbox" ${ex.unilateral ? 'checked' : ''} onchange="wkForm.exercises[${ei}].unilateral=this.checked;renderWkForm()"> per arm/leg</label>
            <button class="btn btn-sm" style="background:#ef4444;color:#fff;border:none;" onclick="wkRemoveExercise(${ei})">&#10005;</button>
        </div>`;
        html += `<div style="padding:0 8px 4px;display:flex;gap:8px;align-items:center;">
            <input type="text" value="${escapeHtml(ex.notes || '')}" placeholder="Notes (e.g. back squat, superset)" onchange="wkForm.exercises[${ei}].notes=this.value" style="font-size:12px;padding:4px 8px;flex:1;border:1px solid var(--gray-200);border-radius:4px;">
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                <span style="font-size:11px;color:var(--gray-400);">&#9201;</span>
                <input type="number" value="${ex.durationSec || ''}" placeholder="sec" min="0" onchange="wkForm.exercises[${ei}].durationSec=parseInt(this.value)||0" style="width:60px;font-size:12px;padding:4px 6px;border:1px solid var(--gray-200);border-radius:4px;">
                <span style="font-size:11px;color:var(--gray-400);">${ex.durationSec ? wkFmtDuration(ex.durationSec) : 'time'}</span>
            </div>
        </div>`;

        // Quick-fill buttons
        html += `<div style="padding:4px 8px;display:flex;gap:4px;">
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;" onclick="wkQuickFill(${ei},'5x5')">5×5</button>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;" onclick="wkQuickFill(${ei},'3x10')">3×10</button>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;" onclick="wkQuickFill(${ei},'3x8')">3×8</button>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;" onclick="wkQuickFill(${ei},'pyramid')">Pyramid</button>
        </div>`;

        // Sets
        html += '<div class="wk-sets">';
        html += '<div class="wk-set-header"><span>#</span><span>Reps</span><span>Weight (kg)</span><span>lb</span><span></span></div>';
        (ex.sets || []).forEach((s, si) => {
            html += `<div class="wk-set-row">
                <span class="wk-set-num">${si + 1}</span>
                <input type="number" value="${s.reps || ''}" min="1" placeholder="reps" onchange="wkForm.exercises[${ei}].sets[${si}].reps=parseInt(this.value)||0">
                <input type="number" value="${s.weightKg || ''}" min="0" step="0.5" placeholder="kg" onchange="wkForm.exercises[${ei}].sets[${si}].weightKg=parseFloat(this.value)||0;wkUpdateLb(this)">
                <span class="wk-lb">${s.weightKg ? kgToLb(s.weightKg) : ''}</span>
                <button onclick="wkRemoveSet(${ei},${si})" style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;">&#10005;</button>
            </div>`;
        });
        html += '</div>';

        html += `<div style="padding:4px 8px;">
            <button class="btn btn-sm" style="font-size:11px;" onclick="wkAddSet(${ei})">+ Add Set</button>
        </div>`;
        html += '</div>';
    });
    html += '</div>';

    // Add exercise + save
    html += `<div style="margin-top:12px;">
        <button class="btn btn-secondary btn-sm" onclick="wkAddExercise()">+ Add Exercise</button>
    </div>`;

    html += `<div class="btn-group" style="margin-top:16px;flex-wrap:wrap;gap:8px;">
        <button class="btn btn-secondary" onclick="saveWkProgress()">Save Progress</button>
        <button class="btn btn-primary" onclick="saveWorkout()">Save &amp; Complete</button>
        <button class="btn btn-secondary" onclick="cancelWorkout()">Cancel</button>
    </div>`;

    html += '</div>';
    document.getElementById('wkPanel-log').innerHTML = html;
}

function wkSetExerciseName(ei, value) {
    if (value === '__custom__') {
        wkForm.exercises[ei].name = '';
    } else {
        wkForm.exercises[ei].name = value;
        const lib = EXERCISE_LIBRARY.find(e => e.name === value);
        if (lib && lib.defaultUnilateral) wkForm.exercises[ei].unilateral = true;
    }
    renderWkForm();
}

function wkAddExercise() {
    if (!wkForm) return;
    wkForm.exercises.push({ name: '', muscle: '', notes: '', unilateral: false, sets: [{ reps: 0, weightKg: 0 }] });
    renderWkForm();
}

function wkRemoveExercise(ei) {
    if (!wkForm) return;
    wkForm.exercises.splice(ei, 1);
    renderWkForm();
}

function wkAddSet(ei) {
    if (!wkForm) return;
    const sets = wkForm.exercises[ei].sets;
    const lastSet = sets[sets.length - 1];
    sets.push({ reps: lastSet?.reps || 0, weightKg: lastSet?.weightKg || 0 });
    renderWkForm();
}

function wkRemoveSet(ei, si) {
    if (!wkForm) return;
    wkForm.exercises[ei].sets.splice(si, 1);
    renderWkForm();
}

function wkQuickFill(ei, scheme) {
    if (!wkForm) return;
    const ex = wkForm.exercises[ei];
    const lastWeight = ex.sets[0]?.weightKg || 0;
    if (scheme === '5x5') ex.sets = Array.from({ length: 5 }, () => ({ reps: 5, weightKg: lastWeight }));
    else if (scheme === '3x10') ex.sets = Array.from({ length: 3 }, () => ({ reps: 10, weightKg: lastWeight }));
    else if (scheme === '3x8') ex.sets = Array.from({ length: 3 }, () => ({ reps: 8, weightKg: lastWeight }));
    else if (scheme === 'pyramid') ex.sets = [10, 8, 6, 4, 2].map(r => ({ reps: r, weightKg: lastWeight }));
    renderWkForm();
}

function wkUpdateLb(input) {
    const val = parseFloat(input.value) || 0;
    const lbSpan = input.parentElement.querySelector('.wk-lb');
    if (lbSpan) lbSpan.textContent = val ? kgToLb(val) : '';
}

function saveWkProgress() {
    if (!wkForm) return;
    saveWkDraft();
    showToast('Progress saved locally', 'success');
}

function cancelWorkout() {
    const hasDraft = !!loadWkDraft();
    if (!hasDraft) {
        wkForm = null;
        renderWkForm();
        return;
    }
    openModal('Cancel Workout', 'Discard your saved progress?', 'Discard', 'btn-danger', () => {
        clearWkDraft();
        wkForm = null;
        renderWkForm();
    });
}

async function saveWorkout() {
    if (!wkForm) return;
    if (!wkForm.exercises.length) { showToast('Add at least one exercise', 'error'); return; }

    try {
        await apiFetch('/api/workouts', {
            method: 'POST',
            body: JSON.stringify({
                id: wkForm.id,
                date: wkForm.date,
                name: '',
                type: 'custom',
                notes: wkForm.notes,
                durationMinutes: wkForm.durationMinutes,
                bodyweightKg: wkForm.bodyweightKg,
                exercises: wkForm.exercises,
                totalVolumeKg: 0,
            })
        });
        clearWkDraft();
        // Auto-save bodyweight as a measurement if provided
        if (wkForm.bodyweightKg > 0) {
            try {
                const existing = wkAllMeasurements.find(m => m.date === wkForm.date);
                const payload = existing
                    ? { ...existing, weightKg: wkForm.bodyweightKg }
                    : { date: wkForm.date, weightKg: wkForm.bodyweightKg, notes: 'From workout log' };
                await apiFetch('/api/measurements', { method: 'POST', body: JSON.stringify(payload) });
            } catch (_e) { /* non-critical */ }
        }
        showToast('Workout saved!', 'success');
        wkForm = null;
        await loadWorkouts();
        // Auto-complete Physical Training habit
        checkPhysicalTrainingHabit();
        switchWkView('history');
    } catch (e) { /* error shown by apiFetch */ }
}

function checkPhysicalTrainingHabit() {
    if (typeof habits === 'undefined' || !habits.length) return;
    const h = habits.find(h => {
        if (h.status !== 'active' || !h.name || isHabitDone(h)) return false;
        const n = h.name.toLowerCase();
        return n.includes('physical') && n.includes('training');
    });
    if (h) toggleHabit(h.id, false);
}

function deleteWorkout(id) {
    openModal('Delete Workout', 'Delete this workout? This cannot be undone.', 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/workouts', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Workout deleted', 'success');
            await loadWorkouts();
        } catch (e) {}
    });
}

// --- History ---
function renderWkHistory() {
    const container = document.getElementById('wkPanel-history');
    if (!wkAllWorkouts.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127947;</div><p>No workouts logged yet. Start your first workout!</p></div>';
        return;
    }

    container.innerHTML = wkAllWorkouts.map((w, idx) => {
        const exercises = (typeof w.exercises === 'string' ? JSON.parse(w.exercises) : w.exercises) || [];
        const date = new Date(w.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        const detailHtml = exercises.map(e => {
            const setsStr = (e.sets || []).map(s => `${s.reps}${s.weightKg ? '×' + s.weightKg + 'kg' : ' reps'}`).join(', ');
            const durStr = e.durationSec ? ' <span style="font-size:11px;color:var(--primary);font-weight:600;">&#9201; ' + wkFmtDuration(e.durationSec) + '</span>' : '';
            return `<div style="margin-bottom:6px;"><strong>${escapeHtml(e.name)}</strong>${e.unilateral ? ' <span style="font-size:10px;color:var(--gray-400);">(per arm/leg)</span>' : ''}${e.notes ? ' <span style="font-size:11px;color:var(--gray-400);">' + escapeHtml(e.notes) + '</span>' : ''}${durStr}<br><span style="font-size:12px;color:var(--gray-500);">${setsStr}</span></div>`;
        }).join('');

        return `<div class="wk-history-card" id="wk-hist-${idx}">
            <div class="wk-history-header" onclick="document.getElementById('wk-hist-${idx}').classList.toggle('open')">
                <div>
                    <div style="font-weight:600;font-size:14px;">${date}</div>
                    <div style="font-size:12px;color:var(--gray-500);">${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}${w.durationMinutes ? ' &middot; ' + w.durationMinutes + ' min' : ''}</div>
                </div>
                <span style="font-size:12px;color:var(--gray-400);">&#9660;</span>
            </div>
            <div class="wk-history-body">
                ${detailHtml}
                ${w.notes ? `<div style="font-size:12px;color:var(--gray-500);margin-top:8px;">Notes: ${escapeHtml(w.notes)}</div>` : ''}
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();repeatWorkout('${w.id}')">Repeat</button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();editWorkout('${w.id}')">Edit</button>
                    <button class="btn btn-sm" style="background:#ef4444;color:#fff;border:none;" onclick="event.stopPropagation();deleteWorkout('${w.id}')">Delete</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// --- Progression (SVG Charts) ---
function renderWkProgression() {
    const container = document.getElementById('wkPanel-progression');

    // Collect all exercise data across workouts
    const exerciseHistory = {};
    for (const w of wkAllWorkouts) {
        const exercises = (typeof w.exercises === 'string' ? JSON.parse(w.exercises) : w.exercises) || [];
        for (const e of exercises) {
            if (!e.name || !e.sets || !e.sets.length) continue;
            if (!exerciseHistory[e.name]) exerciseHistory[e.name] = [];
            const bestWeight = Math.max(...e.sets.map(s => s.weightKg || 0));
            const bestReps = Math.max(...e.sets.map(s => s.reps || 0));
            exerciseHistory[e.name].push({ date: w.date, bestWeight, bestReps, durationSec: e.durationSec || 0 });
        }
    }

    const exerciseNames = Object.keys(exerciseHistory).sort();
    if (!exerciseNames.length) {
        container.innerHTML = '<div class="empty-state"><p>Log some workouts to see progression charts.</p></div>';
        return;
    }

    // Render a chart for each exercise
    let html = '';
    for (const name of exerciseNames) {
        const sessions = exerciseHistory[name].reverse(); // chronological
        if (sessions.length < 1) continue;

        // Determine if this is a timed exercise (has duration data)
        const isTimed = sessions.some(s => s.durationSec > 0);

        if (isTimed) {
            // For timed exercises, PR = fastest time (lower is better)
            let bestSoFar = Infinity;
            for (const s of sessions) {
                if (s.durationSec > 0 && s.durationSec < bestSoFar) { s.isPR = true; bestSoFar = s.durationSec; }
            }
        } else {
            // For weighted exercises, PR = heaviest weight
            let maxSoFar = 0;
            for (const s of sessions) {
                if (s.bestWeight > maxSoFar) { s.isPR = true; maxSoFar = s.bestWeight; }
            }
        }

        html += `<div class="wk-chart-block">
            <h3 style="font-size:14px;margin-bottom:4px;">${escapeHtml(name)}</h3>
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:8px;">${isTimed ? 'Time (lower is better)' : 'Best weight per session'}</div>
            ${isTimed ? wkBuildTimeChart(sessions) : wkBuildSvgChart(sessions)}
        </div>`;
    }

    container.innerHTML = html;
}

function wkBuildSvgChart(sessions) {
    const W = 500, H = 140, PAD_L = 10, PAD_R = 10, PAD_T = 20, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const weights = sessions.map(s => s.bestWeight);
    const maxW = Math.max(...weights, 1);
    const minW = Math.min(...weights);
    const range = maxW - minW || 1;

    const xStep = sessions.length > 1 ? plotW / (sessions.length - 1) : plotW / 2;

    // Build points
    const points = sessions.map((s, i) => {
        const x = PAD_L + (sessions.length > 1 ? i * xStep : plotW / 2);
        const y = PAD_T + plotH - ((s.bestWeight - minW) / range) * plotH;
        return { x, y, ...s };
    });

    // SVG line path
    const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

    // Area fill path
    const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${PAD_T + plotH} L${points[0].x.toFixed(1)},${PAD_T + plotH} Z`;

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:160px;" preserveAspectRatio="xMidYMid meet">`;

    // Grid lines
    for (let i = 0; i <= 3; i++) {
        const y = PAD_T + (plotH / 3) * i;
        const val = (maxW - (range / 3) * i).toFixed(0);
        svg += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
        svg += `<text x="${W - PAD_R + 2}" y="${y + 3}" font-size="9" fill="var(--gray-400)">${val}</text>`;
    }

    // Area + Line
    svg += `<path d="${areaPath}" fill="rgba(16,185,129,0.1)" stroke="none"/>`;
    svg += `<path d="${linePath}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Points + Labels
    for (const p of points) {
        const color = p.isPR ? '#f59e0b' : '#10b981';
        const r = p.isPR ? 5 : 3.5;
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
        if (p.isPR) {
            svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 8}" text-anchor="middle" font-size="9" font-weight="700" fill="#f59e0b">PR</text>`;
        }
        // Date label on x-axis
        const dateLabel = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        svg += `<text x="${p.x.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="var(--gray-400)">${dateLabel}</text>`;
        // Weight label
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - (p.isPR ? 18 : 8)}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--gray-600)">${p.bestWeight}</text>`;
    }

    svg += '</svg>';
    return svg;
}

function wkBuildTimeChart(sessions) {
    const timedSessions = sessions.filter(s => s.durationSec > 0);
    if (!timedSessions.length) return '<div style="font-size:12px;color:var(--gray-400);">No time data yet.</div>';

    const W = 500, H = 140, PAD_L = 10, PAD_R = 10, PAD_T = 20, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const times = timedSessions.map(s => s.durationSec);
    const maxT = Math.max(...times);
    const minT = Math.min(...times);
    const range = maxT - minT || 1;

    const xStep = timedSessions.length > 1 ? plotW / (timedSessions.length - 1) : plotW / 2;

    // Y axis inverted: lower time = higher on chart (better)
    const points = timedSessions.map((s, i) => {
        const x = PAD_L + (timedSessions.length > 1 ? i * xStep : plotW / 2);
        const y = PAD_T + ((s.durationSec - minT) / range) * plotH;
        return { x, y, ...s };
    });

    const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${PAD_T + plotH} L${points[0].x.toFixed(1)},${PAD_T + plotH} Z`;

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:160px;" preserveAspectRatio="xMidYMid meet">`;

    // Grid lines
    for (let i = 0; i <= 3; i++) {
        const y = PAD_T + (plotH / 3) * i;
        const val = minT + (range / 3) * i;
        svg += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
        svg += `<text x="${W - PAD_R + 2}" y="${y + 3}" font-size="9" fill="var(--gray-400)">${wkFmtDuration(Math.round(val))}</text>`;
    }

    // Area + Line (blue theme for time)
    svg += `<path d="${areaPath}" fill="rgba(59,130,246,0.1)" stroke="none"/>`;
    svg += `<path d="${linePath}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Points + Labels
    for (const p of points) {
        const color = p.isPR ? '#f59e0b' : '#3b82f6';
        const r = p.isPR ? 5 : 3.5;
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
        if (p.isPR) {
            svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 8}" text-anchor="middle" font-size="9" font-weight="700" fill="#f59e0b">PR</text>`;
        }
        const dateLabel = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        svg += `<text x="${p.x.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="var(--gray-400)">${dateLabel}</text>`;
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - (p.isPR ? 18 : 8)}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--gray-600)">${wkFmtDuration(p.durationSec)}</text>`;
    }

    svg += '</svg>';
    return svg;
}

// --- Measurements ---
function renderWkMeasurements() {
    const container = document.getElementById('wkPanel-measurements');

    let html = '<h3 style="margin-bottom:12px;">Log Measurement</h3>';
    html += '<div class="wk-meas-form">';
    html += `<div class="form-row" style="gap:8px;">
        <div class="form-group" style="flex:1;"><label>Date</label><input type="date" id="measDate" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group" style="flex:1;"><label>Weight</label>
            <div style="display:flex;gap:4px;align-items:center;">
                <input type="number" id="measWeightKg" step="0.1" placeholder="kg" style="flex:1;" oninput="document.getElementById('measWeightLb').value=this.value?(this.value*2.20462).toFixed(1):''">
                <span style="font-size:12px;color:var(--gray-400);">kg</span>
                <input type="number" id="measWeightLb" step="0.1" placeholder="lb" style="flex:1;" oninput="document.getElementById('measWeightKg').value=this.value?(this.value/2.20462).toFixed(1):''">
                <span style="font-size:12px;color:var(--gray-400);">lb</span>
            </div>
        </div>
        <div class="form-group" style="flex:1;"><label>Body Fat %</label><input type="number" id="measBF" step="0.1" placeholder="%"></div>
        <div class="form-group" style="flex:1;"><label>Muscle Mass (kg)</label><input type="number" id="measMuscle" step="0.1" placeholder="kg"></div>
    </div>`;
    html += `<div class="form-group"><label>Notes</label><input type="text" id="measNotes" placeholder="Optional notes"></div>`;
    html += '<button class="btn btn-primary btn-sm" id="measSaveBtn" data-edit-id="" onclick="saveMeasurement()" style="margin-top:8px;">Save Measurement</button>';
    html += '</div>';

    // History
    if (wkAllMeasurements.length) {
        html += '<h3 style="margin-top:24px;margin-bottom:12px;">History</h3>';
        html += '<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">';
        html += '<thead><tr style="border-bottom:2px solid var(--gray-200);text-align:left;"><th style="padding:6px;">Date</th><th>Weight (kg)</th><th>Weight (lb)</th><th>BF%</th><th>Muscle (kg)</th><th>Notes</th><th></th></tr></thead><tbody>';
        for (let i = 0; i < wkAllMeasurements.length; i++) {
            const m = wkAllMeasurements[i];
            const prev = wkAllMeasurements[i + 1];
            const mkDelta = (field, goodDir) => {
                if (!prev || !m[field] || !prev[field]) return '';
                const d = m[field] - prev[field];
                if (Math.abs(d) < 0.05) return '';
                const good = goodDir === 'up' ? d > 0 : d < 0;
                return ` <span style="font-size:10px;color:${good ? '#10b981' : '#ef4444'};">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
            };
            const date = new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            html += `<tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:6px;">${date}</td>
                <td>${m.weightKg || '--'}${mkDelta('weightKg', 'down')}</td>
                <td>${m.weightKg ? kgToLb(m.weightKg) : '--'}</td>
                <td>${m.bodyFatPct || '--'}%${mkDelta('bodyFatPct', 'down')}</td>
                <td>${m.chest || '--'}${mkDelta('chest', 'up')}</td>
                <td style="color:var(--gray-500);">${escapeHtml(m.notes || '')}</td>
                <td style="white-space:nowrap;">
                    <button style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:12px;" onclick="editMeasurement('${m.id}')" title="Edit">&#9998;</button>
                    <button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;" onclick="deleteMeasurement('${m.id}')" title="Delete">&#10005;</button>
                </td>
            </tr>`;
        }
        html += '</tbody></table></div>';
    }

    // Measurement charts — merge workout bodyweights into weight trend
    const chartData = wkAllMeasurements.slice().reverse(); // chronological
    const measDates = new Set(chartData.map(m => m.date));
    const wkWeightPoints = wkAllWorkouts
        .filter(w => w.bodyweightKg > 0 && !measDates.has(w.date))
        .map(w => ({ date: w.date, weightKg: w.bodyweightKg }));
    const allWeightData = [...chartData.filter(m => m.weightKg > 0), ...wkWeightPoints]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(m => ({ date: m.date, value: m.weightKg }));

    const hasCharts = chartData.length >= 2 || allWeightData.length >= 2;
    if (hasCharts) {
        html += '<h3 style="margin-top:24px;margin-bottom:12px;">Trends</h3>';

        // Weight chart uses merged data (measurements + workout bodyweights)
        if (allWeightData.length >= 2) {
            html += `<div class="wk-chart-block">
                <h3 style="font-size:14px;margin-bottom:8px;">Weight (kg)</h3>
                ${wkBuildMeasChart(allWeightData, '#3b82f6', true)}
            </div>`;
        }

        const otherCharts = [
            { label: 'Body Fat %', field: 'bodyFatPct', color: '#ef4444', lowerBetter: true },
            { label: 'Muscle Mass (kg)', field: 'chest', color: '#10b981', lowerBetter: false },
        ];
        for (const chart of otherCharts) {
            const points = chartData.filter(m => m[chart.field] > 0).map(m => ({ date: m.date, value: m[chart.field] }));
            if (points.length < 2) continue;
            html += `<div class="wk-chart-block">
                <h3 style="font-size:14px;margin-bottom:8px;">${chart.label}</h3>
                ${wkBuildMeasChart(points, chart.color, chart.lowerBetter)}
            </div>`;
        }
    }

    container.innerHTML = html;
}

function wkBuildMeasChart(points, color, lowerBetter) {
    const W = 500, H = 130, PAD_L = 10, PAD_R = 10, PAD_T = 20, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const vals = points.map(p => p.value);
    const maxV = Math.max(...vals);
    const minV = Math.min(...vals);
    const range = maxV - minV || 1;
    const xStep = points.length > 1 ? plotW / (points.length - 1) : plotW / 2;

    const svgPoints = points.map((p, i) => {
        const x = PAD_L + (points.length > 1 ? i * xStep : plotW / 2);
        const y = PAD_T + plotH - ((p.value - minV) / range) * plotH;
        return { x, y, ...p };
    });

    const linePath = svgPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const areaPath = linePath + ` L${svgPoints[svgPoints.length - 1].x.toFixed(1)},${PAD_T + plotH} L${svgPoints[0].x.toFixed(1)},${PAD_T + plotH} Z`;

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:150px;" preserveAspectRatio="xMidYMid meet">`;

    // Grid
    for (let i = 0; i <= 3; i++) {
        const y = PAD_T + (plotH / 3) * i;
        const val = (maxV - (range / 3) * i).toFixed(1);
        svg += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
        svg += `<text x="${W - PAD_R + 2}" y="${y + 3}" font-size="9" fill="var(--gray-400)">${val}</text>`;
    }

    svg += `<path d="${areaPath}" fill="${color}15" stroke="none"/>`;
    svg += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    for (const p of svgPoints) {
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
        const dateLabel = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        svg += `<text x="${p.x.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="var(--gray-400)">${dateLabel}</text>`;
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 8}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--gray-600)">${p.value}</text>`;
    }

    svg += '</svg>';
    return svg;
}

async function saveMeasurement() {
    const editId = document.getElementById('measSaveBtn').dataset.editId;
    const data = {
        date: document.getElementById('measDate').value,
        weightKg: parseFloat(document.getElementById('measWeightKg').value) || 0,
        bodyFatPct: parseFloat(document.getElementById('measBF').value) || 0,
        chest: parseFloat(document.getElementById('measMuscle').value) || 0,
        notes: document.getElementById('measNotes').value.trim(),
    };
    if (editId) data.id = editId;
    try {
        await apiFetch('/api/measurements', { method: 'POST', body: JSON.stringify(data) });
        showToast(editId ? 'Measurement updated!' : 'Measurement saved!', 'success');
        const mData = await apiFetch('/api/measurements');
        wkAllMeasurements = mData.measurements || [];
        renderWkMeasurements();
    } catch (e) {}
}

function editMeasurement(id) {
    const m = wkAllMeasurements.find(x => x.id === id);
    if (!m) return;
    // Scroll to form and pre-fill
    document.getElementById('measDate').value = m.date || '';
    document.getElementById('measWeightKg').value = m.weightKg || '';
    document.getElementById('measWeightLb').value = m.weightKg ? kgToLb(m.weightKg) : '';
    document.getElementById('measBF').value = m.bodyFatPct || '';
    document.getElementById('measMuscle').value = m.chest || '';
    document.getElementById('measNotes').value = m.notes || '';
    // Store editing ID on the save button
    document.getElementById('measSaveBtn').dataset.editId = id;
    document.getElementById('measSaveBtn').textContent = 'Update Measurement';
    document.getElementById('measDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteMeasurement(id) {
    openModal('Delete Measurement', 'Delete this measurement?', 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/measurements', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Deleted', 'success');
            const mData = await apiFetch('/api/measurements');
            wkAllMeasurements = mData.measurements || [];
            renderWkMeasurements();
        } catch (e) {}
    });
}

// ==================== BLOODWORK ====================

function getBloodRange(marker) {
    const custom = wkBloodRanges[marker];
    const def = BLOOD_MARKER_DEFS[marker];
    if (custom && custom.length === 2) return custom;
    return def ? def.defaultRange : [0, 100];
}

function renderWkBloodwork() {
    const container = document.getElementById('wkPanel-bloodwork');

    let html = '<h3 style="margin-bottom:12px;">Log Blood Panel</h3>';
    html += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:16px;margin-bottom:20px;">';
    html += '<div class="form-row" style="gap:8px;margin-bottom:8px;"><div class="form-group" style="flex:1;max-width:180px;"><label>Date</label><input type="date" id="bmDate" value="' + new Date().toISOString().split('T')[0] + '"></div></div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">';
    for (const [key, def] of Object.entries(BLOOD_MARKER_DEFS)) {
        html += `<div class="form-group" style="margin:0;"><label style="font-size:11px;">${escapeHtml(def.label)} <span style="color:var(--gray-400);">(${escapeHtml(def.unit)})</span></label><input type="number" step="0.01" id="bm-${key}" placeholder="${def.defaultRange[0]}–${def.defaultRange[1]}" style="padding:6px 8px;font-size:13px;"></div>`;
    }
    html += '</div>';
    html += '<div class="form-group" style="margin-top:8px;"><label style="font-size:11px;">Notes</label><input type="text" id="bmNotes" placeholder="Lab name, fasting, etc." style="padding:6px 8px;font-size:13px;"></div>';
    html += '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveBloodPanel()">Save Panel</button><button class="btn btn-secondary btn-sm" onclick="clearBloodForm()">Clear</button></div>';
    html += '</div>';

    // Trend charts
    const markerKeys = Object.keys(BLOOD_MARKER_DEFS);
    const byMarker = {};
    for (const row of wkAllBloodMarkers) {
        if (!byMarker[row.marker]) byMarker[row.marker] = [];
        byMarker[row.marker].push(row);
    }

    const hasAnyData = markerKeys.some(k => byMarker[k] && byMarker[k].length > 0);
    if (hasAnyData) {
        html += '<h3 style="margin-bottom:4px;">Trends</h3>';
        html += '<p style="font-size:12px;color:var(--gray-400);margin-bottom:12px;">Green band = healthy range. Click range values to edit.</p>';

        for (const key of markerKeys) {
            const readings = byMarker[key];
            if (!readings || readings.length === 0) continue;
            const def = BLOOD_MARKER_DEFS[key];
            const range = getBloodRange(key);
            const points = readings.slice().reverse().map(r => ({ date: r.date, value: r.value }));

            html += '<div class="wk-chart-block">';
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
            html += `<h3 style="font-size:14px;margin:0;">${escapeHtml(def.label)} <span style="font-weight:400;color:var(--gray-400);font-size:12px;">${escapeHtml(def.unit)}</span></h3>`;
            html += `<span style="font-size:11px;color:var(--gray-400);cursor:pointer;" onclick="editBloodRange('${key}')" title="Click to edit range">Range: <span style="color:#10b981;font-weight:600;" id="bmRange-${key}">${range[0]}–${range[1]}</span></span>`;
            html += '</div>';
            html += wkBuildBloodChart(points, '#3b82f6', range);
            html += '</div>';
        }
    }

    // History by date
    const dates = [...new Set(wkAllBloodMarkers.map(r => r.date))].sort().reverse();
    if (dates.length > 0) {
        html += '<h3 style="margin-top:24px;margin-bottom:12px;">Panel History</h3>';
        for (const date of dates) {
            const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const rows = wkAllBloodMarkers.filter(r => r.date === date);
            const notes = rows[0]?.notes || '';
            html += `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:8px;">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">`;
            html += `<strong style="font-size:14px;">${dateLabel}</strong>`;
            html += `<div style="display:flex;gap:4px;"><button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="editBloodPanel('${date}')">Edit</button><button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteBloodPanel('${date}')">Delete</button></div>`;
            html += '</div>';
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px;font-size:13px;">';
            for (const r of rows) {
                const def = BLOOD_MARKER_DEFS[r.marker];
                if (!def) continue;
                const range = getBloodRange(r.marker);
                const inRange = r.value >= range[0] && r.value <= range[1];
                const color = inRange ? '#10b981' : '#ef4444';
                html += `<div><span style="color:var(--gray-500);">${escapeHtml(def.label)}:</span> <span style="font-weight:600;color:${color};">${r.value}</span> <span style="font-size:11px;color:var(--gray-400);">${escapeHtml(def.unit)}</span></div>`;
            }
            html += '</div>';
            if (notes) html += `<div style="font-size:12px;color:var(--gray-400);margin-top:4px;">${escapeHtml(notes)}</div>`;
            html += '</div>';
        }
    }

    container.innerHTML = html;
}

function wkBuildBloodChart(points, color, range) {
    const W = 500, H = 150, PAD_L = 10, PAD_R = 40, PAD_T = 20, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const vals = points.map(p => p.value);
    // Include range in min/max so the band is always visible
    const allVals = [...vals, range[0], range[1]];
    const maxV = Math.max(...allVals);
    const minV = Math.min(...allVals);
    const dataRange = maxV - minV || 1;
    // Add 10% padding
    const padded = dataRange * 0.1;
    const chartMin = minV - padded;
    const chartMax = maxV + padded;
    const chartRange = chartMax - chartMin;

    const xStep = points.length > 1 ? plotW / (points.length - 1) : plotW / 2;

    const toY = (v) => PAD_T + plotH - ((v - chartMin) / chartRange) * plotH;

    const svgPoints = points.map((p, i) => {
        const x = PAD_L + (points.length > 1 ? i * xStep : plotW / 2);
        return { x, y: toY(p.value), ...p };
    });

    const linePath = svgPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:170px;" preserveAspectRatio="xMidYMid meet">`;

    // Healthy range band
    const bandTop = toY(range[1]);
    const bandBottom = toY(range[0]);
    svg += `<rect x="${PAD_L}" y="${bandTop.toFixed(1)}" width="${plotW}" height="${(bandBottom - bandTop).toFixed(1)}" fill="#10b981" opacity="0.1" rx="2"/>`;
    // Range boundary lines
    svg += `<line x1="${PAD_L}" y1="${bandTop.toFixed(1)}" x2="${PAD_L + plotW}" y2="${bandTop.toFixed(1)}" stroke="#10b981" stroke-width="0.5" stroke-dasharray="4,3"/>`;
    svg += `<line x1="${PAD_L}" y1="${bandBottom.toFixed(1)}" x2="${PAD_L + plotW}" y2="${bandBottom.toFixed(1)}" stroke="#10b981" stroke-width="0.5" stroke-dasharray="4,3"/>`;
    // Range labels
    svg += `<text x="${PAD_L + plotW + 3}" y="${bandTop.toFixed(1) + 3}" font-size="8" fill="#10b981">${range[1]}</text>`;
    svg += `<text x="${PAD_L + plotW + 3}" y="${bandBottom.toFixed(1) + 3}" font-size="8" fill="#10b981">${range[0]}</text>`;

    // Grid lines
    for (let i = 0; i <= 3; i++) {
        const y = PAD_T + (plotH / 3) * i;
        const val = (chartMax - (chartRange / 3) * i).toFixed(1);
        svg += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
        svg += `<text x="${PAD_L + plotW + 3}" y="${y + 3}" font-size="9" fill="var(--gray-400)">${val}</text>`;
    }

    // Line
    svg += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Points
    for (const p of svgPoints) {
        const inRange = p.value >= range[0] && p.value <= range[1];
        const ptColor = inRange ? color : '#ef4444';
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${ptColor}" stroke="#fff" stroke-width="1.5"/>`;
        const dateLabel = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        svg += `<text x="${p.x.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="var(--gray-400)">${dateLabel}</text>`;
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 8}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--gray-600)">${p.value}</text>`;
    }

    svg += '</svg>';
    return svg;
}

async function saveBloodPanel() {
    const date = document.getElementById('bmDate').value;
    if (!date) { showToast('Date is required', 'error'); return; }

    const entries = [];
    for (const key of Object.keys(BLOOD_MARKER_DEFS)) {
        const el = document.getElementById('bm-' + key);
        if (el && el.value) entries.push({ marker: key, value: parseFloat(el.value) });
    }

    if (entries.length === 0) { showToast('Enter at least one marker', 'error'); return; }

    const notes = document.getElementById('bmNotes').value.trim();

    try {
        await apiFetch('/api/blood-markers', {
            method: 'POST',
            body: JSON.stringify({ date, entries, notes }),
        });
        showToast('Blood panel saved!', 'success');
        // Clear form
        for (const key of Object.keys(BLOOD_MARKER_DEFS)) {
            const el = document.getElementById('bm-' + key);
            if (el) el.value = '';
        }
        document.getElementById('bmNotes').value = '';
        // Reload
        const bmData = await apiFetch('/api/blood-markers');
        wkAllBloodMarkers = bmData.markers || [];
        renderWkBloodwork();
    } catch (e) {}
}

function deleteBloodPanel(date) {
    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    openModal('Delete Blood Panel', `Delete all markers for ${dateLabel}?`, 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/blood-markers', { method: 'DELETE', body: JSON.stringify({ date }) });
            showToast('Panel deleted', 'success');
            const bmData = await apiFetch('/api/blood-markers');
            wkAllBloodMarkers = bmData.markers || [];
            renderWkBloodwork();
        } catch (e) {}
    });
}

function editBloodPanel(date) {
    const rows = wkAllBloodMarkers.filter(r => r.date === date);
    if (!rows.length) return;
    // Clear form first
    for (const key of Object.keys(BLOOD_MARKER_DEFS)) {
        const el = document.getElementById('bm-' + key);
        if (el) el.value = '';
    }
    // Fill in values from the panel
    document.getElementById('bmDate').value = date;
    for (const r of rows) {
        const el = document.getElementById('bm-' + r.marker);
        if (el) el.value = r.value;
    }
    document.getElementById('bmNotes').value = rows[0]?.notes || '';
    document.getElementById('bmDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearBloodForm() {
    document.getElementById('bmDate').value = new Date().toISOString().split('T')[0];
    for (const key of Object.keys(BLOOD_MARKER_DEFS)) {
        const el = document.getElementById('bm-' + key);
        if (el) el.value = '';
    }
    document.getElementById('bmNotes').value = '';
}

// ==================== SEX LOG ====================

// Local-date midnight for "YYYY-MM-DD" — avoids the UTC drift that bites if
// you new Date(dateStr) directly near midnight in a non-UTC zone.
function wkSexParseDate(s) { return new Date(s + 'T00:00:00'); }

// Frequency stats over the trailing window. Used by the chart header above
// the History list — answers "how often, lately?" at a glance.
function wkSexComputeStats(weeks) {
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    const windowStart = new Date(todayMid); windowStart.setDate(windowStart.getDate() - weeks * 7 + 1);
    const dayMs = 86400000;

    // wkAllSex is server-sorted desc; we want all entries in-window for the
    // chart and ALL entries for the "longest gap" / "days since last" stats
    // (gaps before the window are still informative).
    const inWindow = wkAllSex.filter(e => wkSexParseDate(e.date) >= windowStart);
    const avgPerWeek = inWindow.length / weeks;

    // Sort all entries ascending by date for streak + gap calc.
    const sortedAsc = [...wkAllSex].sort((a, b) => a.date.localeCompare(b.date));

    let longestGapDays = 0;
    for (let i = 1; i < sortedAsc.length; i++) {
        const prev = wkSexParseDate(sortedAsc[i - 1].date);
        const curr = wkSexParseDate(sortedAsc[i].date);
        const d = Math.round((curr - prev) / dayMs);
        if (d > longestGapDays) longestGapDays = d;
    }

    let daysSinceLast = null;
    if (sortedAsc.length) {
        const last = wkSexParseDate(sortedAsc[sortedAsc.length - 1].date);
        daysSinceLast = Math.round((todayMid - last) / dayMs);
    }

    // Streak of consecutive weeks (ending this week) that had ≥1 entry.
    // Week buckets are Sunday-anchored to match the existing This-Week tile.
    const weekStartOf = (d) => {
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        x.setDate(x.getDate() - x.getDay());
        return x;
    };
    const byWeek = new Map();
    for (const e of wkAllSex) {
        const ws = weekStartOf(wkSexParseDate(e.date)).getTime();
        byWeek.set(ws, (byWeek.get(ws) || 0) + 1);
    }
    let streakWeeks = 0;
    let cursor = weekStartOf(todayMid).getTime();
    while (byWeek.has(cursor)) {
        streakWeeks++;
        const prev = new Date(cursor); prev.setDate(prev.getDate() - 7);
        cursor = prev.getTime();
    }

    return { avgPerWeek, longestGapDays, daysSinceLast, streakWeeks, inWindowCount: inWindow.length };
}

// 12-week weekly-count bar chart. Bars are rose-pink; rest of the chart uses
// the neutral palette already on the page. SVG so it scales width-wise.
function wkSexBuildFreqChart(weeks) {
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    const weekStartOf = (d) => {
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        x.setDate(x.getDate() - x.getDay());
        return x;
    };
    const thisWeekStart = weekStartOf(todayMid);

    // Build N week buckets ending with the current week, oldest → newest.
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const ws = new Date(thisWeekStart); ws.setDate(ws.getDate() - i * 7);
        buckets.push({ start: ws, count: 0 });
    }
    const bucketIndex = new Map(buckets.map((b, i) => [b.start.getTime(), i]));
    for (const e of wkAllSex) {
        const ws = weekStartOf(wkSexParseDate(e.date)).getTime();
        const idx = bucketIndex.get(ws);
        if (idx !== undefined) buckets[idx].count++;
    }

    const W = 600, H = 120, PAD_L = 28, PAD_R = 8, PAD_T = 12, PAD_B = 22;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const maxCount = Math.max(1, ...buckets.map(b => b.count));
    const barGap = 4;
    const barW = (plotW - barGap * (buckets.length - 1)) / buckets.length;
    const fmtTip = (b) => `Wk of ${b.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${b.count}`;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;max-height:160px;display:block;">`;

    // Y gridlines (at 0, mid, max).
    for (const tick of [0, Math.ceil(maxCount / 2), maxCount]) {
        const y = PAD_T + plotH - (tick / maxCount) * plotH;
        svg += `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
        svg += `<text x="${PAD_L - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="var(--gray-400)">${tick}</text>`;
    }

    // Bars + month labels on bucket boundaries (when the week's start crosses
    // into a new month, drop a label).
    let lastLabelMonth = -1;
    buckets.forEach((b, i) => {
        const x = PAD_L + i * (barW + barGap);
        const h = (b.count / maxCount) * plotH;
        const y = PAD_T + plotH - h;
        const isCurrent = i === buckets.length - 1;
        const fill = b.count === 0 ? '#f1f5f9' : (isCurrent ? '#db2777' : '#f472b6');
        svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${fill}" rx="2"><title>${fmtTip(b)}</title></rect>`;
        // Count label on top of bars with non-zero count.
        if (b.count > 0) {
            svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="var(--gray-600)" font-weight="600">${b.count}</text>`;
        }
        // Month label when the bucket starts a new month, or first bucket.
        const m = b.start.getMonth();
        if (m !== lastLabelMonth) {
            const label = b.start.toLocaleDateString('en-US', { month: 'short' });
            svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="var(--gray-400)">${label}</text>`;
            lastLabelMonth = m;
        }
    });

    svg += '</svg>';
    return svg;
}



function wkSexFmtCount(n) {
    if (!n) return '—';
    return String(n) + (n >= 2 ? '+ ' : ' ') + (n === 1 ? '🌟' : '🌟'.repeat(Math.min(n, 4)));
}

function wkSexCountChips(field, value) {
    // Quick chip selectors 0 / 1 / 2 / 3 / 4+. Click sets the hidden number input.
    let html = '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
    for (const v of [0, 1, 2, 3, 4]) {
        const active = value === v;
        const label = v === 4 ? '4+' : String(v);
        html += `<button type="button" class="btn ${active ? 'btn-primary' : 'btn-secondary'} btn-sm wk-sex-chip" data-field="${field}" data-value="${v}" onclick="wkSexSetCount('${field}', ${v})" style="padding:6px 14px;min-width:42px;font-weight:600;">${label}</button>`;
    }
    html += '</div>';
    return html;
}

function wkSexSetCount(field, value) {
    const input = document.getElementById('sxInput-' + field);
    if (input) input.value = String(value);
    // Repaint chip row
    document.querySelectorAll(`.wk-sex-chip[data-field="${field}"]`).forEach(btn => {
        const isActive = parseInt(btn.dataset.value, 10) === value;
        btn.classList.toggle('btn-primary', isActive);
        btn.classList.toggle('btn-secondary', !isActive);
    });
}

function renderWkSex() {
    const container = document.getElementById('wkPanel-sex');
    const editing = wkSexEditId ? wkAllSex.find(e => e.id === wkSexEditId) : null;
    const today = new Date().toISOString().split('T')[0];
    const date = editing?.date || today;
    const selfV = editing ? Math.min(editing.selfOrgasms || 0, 4) : 0;
    const partnerV = editing ? Math.min(editing.partnerOrgasms || 0, 4) : 0;
    const notes = editing?.notes || '';

    // Stats
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStr = monthStart.toISOString().split('T')[0];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStr = weekStart.toISOString().split('T')[0];
    const thisWeek = wkAllSex.filter(e => e.date >= weekStr).length;
    const thisMonth = wkAllSex.filter(e => e.date >= monthStr).length;
    const myMonth = wkAllSex.filter(e => e.date >= monthStr).reduce((s, e) => s + (e.selfOrgasms || 0), 0);
    const partnerMonth = wkAllSex.filter(e => e.date >= monthStr).reduce((s, e) => s + (e.partnerOrgasms || 0), 0);

    let html = '';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">';
    html += `<div class="stat-card"><div class="label">This Week</div><div class="value">${thisWeek}</div></div>`;
    html += `<div class="stat-card"><div class="label">This Month</div><div class="value">${thisMonth}</div></div>`;
    html += `<div class="stat-card"><div class="label">My Os (mo)</div><div class="value">${myMonth}</div></div>`;
    html += `<div class="stat-card"><div class="label">Partner Os (mo)</div><div class="value">${partnerMonth}</div></div>`;
    html += '</div>';

    html += `<h3 style="margin-bottom:12px;">${editing ? 'Edit Entry' : 'Log Encounter'}</h3>`;
    html += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:16px;margin-bottom:20px;">';
    html += '<div class="form-row" style="gap:8px;margin-bottom:12px;">';
    html += `<div class="form-group" style="flex:1;max-width:200px;margin:0;"><label>Date</label><input type="date" id="sxDate" value="${date}"></div>`;
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;">';
    html += '<div>';
    html += '<label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:6px;font-weight:600;">My orgasms</label>';
    html += wkSexCountChips('self', selfV);
    html += `<input type="hidden" id="sxInput-self" value="${selfV}">`;
    html += '</div>';
    html += '<div>';
    html += '<label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:6px;font-weight:600;">Partner orgasms</label>';
    html += wkSexCountChips('partner', partnerV);
    html += `<input type="hidden" id="sxInput-partner" value="${partnerV}">`;
    html += '</div>';
    html += '</div>';

    html += `<div class="form-group" style="margin:0 0 12px;"><label style="font-size:11px;">Notes (optional)</label><textarea id="sxNotes" placeholder="Mood, context, anything worth remembering..." style="width:100%;min-height:60px;padding:8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;font-family:inherit;resize:vertical;">${escapeHtml(notes)}</textarea></div>`;

    html += '<div style="display:flex;gap:8px;">';
    html += `<button class="btn btn-primary btn-sm" onclick="saveSexEntry()">${editing ? 'Update Entry' : 'Save Entry'}</button>`;
    if (editing) {
        html += `<button class="btn btn-secondary btn-sm" onclick="cancelSexEdit()">Cancel</button>`;
    } else {
        html += `<button class="btn btn-secondary btn-sm" onclick="clearSexForm()">Clear</button>`;
    }
    html += '</div>';
    html += '</div>';

    // Frequency panel — sits between the log form and the history list to
    // surface "how often, lately?" without the user having to scroll the log.
    if (wkAllSex.length > 0) {
        const FREQ_WEEKS = 12;
        const s = wkSexComputeStats(FREQ_WEEKS);
        const avgFmt = s.avgPerWeek >= 1 ? s.avgPerWeek.toFixed(1) : s.avgPerWeek.toFixed(2);
        const sinceLabel = s.daysSinceLast === null ? '—'
                         : s.daysSinceLast === 0 ? 'today'
                         : s.daysSinceLast === 1 ? '1 day ago'
                         : `${s.daysSinceLast} days ago`;
        const streakLabel = s.streakWeeks > 0 ? `${s.streakWeeks}w streak 🔥` : 'No streak';
        const gapLabel = s.longestGapDays > 0 ? `${s.longestGapDays}d longest gap` : '—';

        html += '<div style="background:#fff7fb;border:1px solid #fbcfe8;border-radius:8px;padding:14px 16px;margin-bottom:16px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;flex-wrap:wrap;gap:6px;">';
        html += `<h3 style="margin:0;font-size:14px;color:#9d174d;">Frequency · last ${FREQ_WEEKS} weeks</h3>`;
        html += `<span style="font-size:11px;color:var(--gray-500);">${s.inWindowCount} entries in window</span>`;
        html += '</div>';
        html += '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--gray-700);margin-bottom:10px;">';
        html += `<div><span style="color:var(--gray-500);">Avg/wk:</span> <strong>${avgFmt}</strong></div>`;
        html += `<div><span style="color:var(--gray-500);">Last:</span> <strong>${sinceLabel}</strong></div>`;
        html += `<div><strong>${streakLabel}</strong></div>`;
        html += `<div><span style="color:var(--gray-500);">${gapLabel}</span></div>`;
        html += '</div>';
        html += wkSexBuildFreqChart(FREQ_WEEKS);
        html += '</div>';
    }

    // History
    if (wkAllSex.length === 0) {
        html += '<div class="empty-state" style="text-align:center;padding:32px;color:var(--gray-400);"><p>No entries yet.</p></div>';
    } else {
        html += '<h3 style="margin-bottom:12px;">History</h3>';
        for (const e of wkAllSex) {
            const dateLabel = new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            html += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:8px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
            html += `<strong style="font-size:14px;">${dateLabel}</strong>`;
            html += `<div style="display:flex;gap:4px;"><button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="editSexEntry('${e.id}')">Edit</button><button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteSexEntry('${e.id}')">Delete</button></div>`;
            html += '</div>';
            html += '<div style="display:flex;gap:24px;font-size:13px;flex-wrap:wrap;">';
            html += `<div><span style="color:var(--gray-500);">Me:</span> <strong>${e.selfOrgasms || 0}</strong></div>`;
            html += `<div><span style="color:var(--gray-500);">Partner:</span> <strong>${e.partnerOrgasms || 0}</strong></div>`;
            html += '</div>';
            if (e.notes) html += `<div style="font-size:12px;color:var(--gray-500);margin-top:6px;white-space:pre-wrap;">${escapeHtml(e.notes)}</div>`;
            html += '</div>';
        }
    }

    container.innerHTML = html;
}

async function saveSexEntry() {
    const date = document.getElementById('sxDate').value;
    if (!date) { showToast('Date is required', 'error'); return; }
    const selfOrgasms = parseInt(document.getElementById('sxInput-self').value, 10) || 0;
    const partnerOrgasms = parseInt(document.getElementById('sxInput-partner').value, 10) || 0;
    const notes = document.getElementById('sxNotes').value.trim();

    const payload = { date, selfOrgasms, partnerOrgasms, notes };
    if (wkSexEditId) payload.id = wkSexEditId;

    try {
        await apiFetch('/api/sex', { method: 'POST', body: JSON.stringify(payload) });
        showToast(wkSexEditId ? 'Entry updated' : 'Entry saved', 'success');
        wkSexEditId = null;
        const sxData = await apiFetch('/api/sex');
        wkAllSex = sxData.entries || [];
        renderWkSex();
    } catch (e) {}
}

function clearSexForm() {
    wkSexEditId = null;
    renderWkSex();
}

function cancelSexEdit() {
    wkSexEditId = null;
    renderWkSex();
}

function editSexEntry(id) {
    wkSexEditId = id;
    renderWkSex();
    document.getElementById('sxDate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteSexEntry(id) {
    const entry = wkAllSex.find(e => e.id === id);
    if (!entry) return;
    const dateLabel = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    openModal('Delete Entry', `Delete sex log entry for ${dateLabel}?`, 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/sex', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Entry deleted', 'success');
            const sxData = await apiFetch('/api/sex');
            wkAllSex = sxData.entries || [];
            if (wkSexEditId === id) wkSexEditId = null;
            renderWkSex();
        } catch (e) {}
    });
}

function editBloodRange(marker) {
    const def = BLOOD_MARKER_DEFS[marker];
    const current = getBloodRange(marker);
    const input = prompt(`${def.label} healthy range (low–high):`, `${current[0]}–${current[1]}`);
    if (!input) return;
    const parts = input.split(/[–\-,\s]+/).map(Number).filter(n => !isNaN(n));
    if (parts.length !== 2 || parts[0] >= parts[1]) { showToast('Enter two numbers: low–high', 'error'); return; }
    wkBloodRanges[marker] = parts;
    // Save to settings
    apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ bloodMarkerRanges: wkBloodRanges }),
    }).catch(() => {});
    renderWkBloodwork();
}

// ==================== RECOVERY NOTES ====================

let recoveryTabs = [];
let recoveryActiveTab = null;

async function loadRecoveryNotes() {
    try {
        const data = await apiFetch('/api/settings');
        recoveryTabs = data.recoveryTabs || [];
        // Migrate old single-note format
        if (!recoveryTabs.length && data.recoveryNotes) {
            recoveryTabs = [{ id: 'rec-1', title: 'General', notes: data.recoveryNotes }];
        }
        if (!recoveryTabs.length) {
            recoveryTabs = [{ id: 'rec-' + Date.now(), title: 'General', notes: '' }];
        }
        recoveryActiveTab = recoveryTabs[0].id;
        const savedAt = data.recoveryNotesSavedAt || '';
        if (savedAt) {
            document.getElementById('recoverySavedAt').textContent = 'Last saved: ' + new Date(savedAt).toLocaleString();
        }
        renderRecoveryTabs();
    } catch (e) {}
}

function renderRecoveryTabs() {
    const bar = document.getElementById('recoveryTabBar');
    const content = document.getElementById('recoveryContent');
    const tab = recoveryTabs.find(t => t.id === recoveryActiveTab) || recoveryTabs[0];
    if (!tab) return;

    bar.innerHTML = recoveryTabs.map(t => {
        const active = t.id === tab.id;
        return `<div style="display:flex;align-items:center;gap:2px;">` +
            `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="switchRecoveryTab('${t.id}')" style="padding:4px 12px;font-size:12px;">${escapeHtml(t.title)}</button>` +
            (active ? `<button class="btn btn-secondary btn-sm" onclick="renameRecoveryTab('${t.id}')" style="padding:4px 6px;font-size:10px;" title="Rename">&#9998;</button>` : '') +
            (active && recoveryTabs.length > 1 ? `<button class="btn btn-sm" onclick="deleteRecoveryTab('${t.id}')" style="padding:4px 6px;font-size:10px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Delete">&times;</button>` : '') +
            `</div>`;
    }).join('');

    content.innerHTML = `<textarea id="recoveryNotes" placeholder="Recovery protocols, stretching routines, injury notes, rehab exercises, sleep strategies..." style="width:100%;min-height:400px;padding:14px;font-size:14px;line-height:1.7;border:1px solid var(--gray-200);border-radius:8px;resize:vertical;font-family:inherit;">${escapeHtml(tab.notes || '')}</textarea>`;
}

function switchRecoveryTab(id) {
    // Save current tab's notes before switching
    const textarea = document.getElementById('recoveryNotes');
    if (textarea) {
        const current = recoveryTabs.find(t => t.id === recoveryActiveTab);
        if (current) current.notes = textarea.value;
    }
    recoveryActiveTab = id;
    renderRecoveryTabs();
}

function addRecoveryTab() {
    // Save current tab's notes first
    const textarea = document.getElementById('recoveryNotes');
    if (textarea) {
        const current = recoveryTabs.find(t => t.id === recoveryActiveTab);
        if (current) current.notes = textarea.value;
    }
    const title = prompt('Tab name:');
    if (!title || !title.trim()) return;
    const newTab = { id: 'rec-' + Date.now(), title: title.trim(), notes: '' };
    recoveryTabs.push(newTab);
    recoveryActiveTab = newTab.id;
    renderRecoveryTabs();
}

function renameRecoveryTab(id) {
    const tab = recoveryTabs.find(t => t.id === id);
    if (!tab) return;
    const title = prompt('Rename tab:', tab.title);
    if (!title || !title.trim()) return;
    tab.title = title.trim();
    renderRecoveryTabs();
}

function deleteRecoveryTab(id) {
    if (recoveryTabs.length <= 1) return;
    if (!confirm('Delete this tab and its notes?')) return;
    recoveryTabs = recoveryTabs.filter(t => t.id !== id);
    recoveryActiveTab = recoveryTabs[0].id;
    renderRecoveryTabs();
}

async function saveRecoveryNotes() {
    const btn = document.getElementById('recoverySaveBtn');
    // Capture current textarea into active tab
    const textarea = document.getElementById('recoveryNotes');
    if (textarea) {
        const current = recoveryTabs.find(t => t.id === recoveryActiveTab);
        if (current) current.notes = textarea.value;
    }
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ recoveryTabs, recoveryNotesSavedAt: new Date().toISOString() }),
        });
        document.getElementById('recoverySavedAt').textContent = 'Last saved: ' + new Date().toLocaleString();
        showToast('Recovery notes saved.', 'success');
    } catch (e) {
        showToast('Failed to save notes.', 'error');
    }
    btn.textContent = 'Save';
    btn.disabled = false;
}
