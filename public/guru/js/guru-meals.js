/* ==========================================================================
   Guru Dashboard — Meals Module
   Track daily meals + macros, manage a food library, view trends
   ========================================================================== */

let mealEntries = [];
let foodLibrary = [];
let mealView = 'today'; // 'today' | 'library' | 'trends'
let mealDateFilter = new Date().toLocaleDateString('en-CA');
let editingMealId = null;
let editingFoodId = null;

function switchMealView(mode) {
    mealView = mode;
    document.querySelectorAll('.meal-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('.meal-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('meal-panel-' + mode);
    if (panel) panel.style.display = '';
    renderMeals();
}

async function loadMeals() {
    try {
        const [entriesRes, foodsRes] = await Promise.all([
            apiFetch('/api/meals'),
            apiFetch('/api/foods'),
        ]);
        mealEntries = entriesRes.entries || [];
        foodLibrary = foodsRes.foods || [];
        renderMeals();
    } catch (e) {
        const el = document.getElementById('mealTodayList');
        if (el) el.innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

function renderMeals() {
    populateFoodSelect();
    populateFoodDatalist();
    if (mealView === 'today')   renderMealsToday();
    if (mealView === 'library') renderFoodLibrary();
    if (mealView === 'trends')  renderMealTrends();
}

function populateFoodSelect() {
    const sel = document.getElementById('mealFood');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— select food —</option>'
        + foodLibrary.map(f => `<option value="${esc(f.id)}">${esc(f.name)} (${(parseFloat(f.calories)||0).toFixed(0)} kcal/100g)</option>`).join('');
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateFoodDatalist() {
    const dl = document.getElementById('mealFoodList');
    if (!dl) return;
    dl.innerHTML = foodLibrary.map(f => `<option value="${esc(f.name)}"></option>`).join('');
}

function setMealDate(date) {
    mealDateFilter = date || new Date().toLocaleDateString('en-CA');
    const inp = document.getElementById('mealDateFilter');
    if (inp) inp.value = mealDateFilter;
    renderMeals();
}

function setMealDateOffset(days) {
    const d = new Date(mealDateFilter + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setMealDate(d.toLocaleDateString('en-CA'));
}

// ==================== TODAY VIEW ====================

const MEAL_TYPES = ['breakfast','lunch','dinner','snack'];

function renderMealsToday() {
    const date = mealDateFilter;
    const inp = document.getElementById('mealDateFilter');
    if (inp && inp.value !== date) inp.value = date;

    const entries = mealEntries.filter(e => e.date === date);

    // Totals
    const totals = entries.reduce((acc, e) => ({
        calories: acc.calories + (parseFloat(e.calories)||0),
        sugar:    acc.sugar    + (parseFloat(e.sugar)||0),
        carbs:    acc.carbs    + (parseFloat(e.carbs)||0),
        protein:  acc.protein  + (parseFloat(e.protein)||0),
    }), { calories: 0, sugar: 0, carbs: 0, protein: 0 });

    document.getElementById('mealTotCalories').textContent = totals.calories.toFixed(0);
    document.getElementById('mealTotSugar').textContent    = totals.sugar.toFixed(1) + 'g';
    document.getElementById('mealTotCarbs').textContent    = totals.carbs.toFixed(1) + 'g';
    document.getElementById('mealTotProtein').textContent  = totals.protein.toFixed(1) + 'g';

    // Grouped by meal-type, then sorted by time within
    const list = document.getElementById('mealTodayList');
    if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No entries yet for this day. Add one above.</p></div>';
        return;
    }

    let html = '';
    for (const mt of [...MEAL_TYPES, '']) {
        const group = entries.filter(e => (e.mealType || '') === mt);
        if (group.length === 0) continue;
        group.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const label = mt ? mt[0].toUpperCase() + mt.slice(1) : 'Other';
        const groupCal = group.reduce((s, e) => s + (parseFloat(e.calories)||0), 0);
        html += `<div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
                <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:var(--gray-600);margin:0;">${esc(label)}</h3>
                <span style="font-size:12px;color:var(--gray-500);">${groupCal.toFixed(0)} kcal</span>
            </div>
            <table><thead><tr>
                <th style="width:60px;">Time</th><th>Food</th><th style="width:60px;">Grams</th>
                <th style="width:60px;">Cal</th><th style="width:50px;">Sugar</th><th style="width:50px;">Carbs</th><th style="width:60px;">Protein</th>
                <th>Mood / Notes</th><th></th>
            </tr></thead><tbody>`;
        for (const e of group) {
            const moodNote = [e.mood, e.notes].filter(Boolean).join(' · ');
            html += `<tr id="meal-row-${esc(e.id)}">
                <td style="font-size:12px;color:var(--gray-500);">${esc(e.time || '—')}</td>
                <td>${esc(e.foodName)}</td>
                <td style="font-size:12px;">${(parseFloat(e.grams)||0).toFixed(0)}g</td>
                <td style="font-weight:600;">${(parseFloat(e.calories)||0).toFixed(0)}</td>
                <td style="font-size:12px;color:var(--gray-500);">${(parseFloat(e.sugar)||0).toFixed(1)}g</td>
                <td style="font-size:12px;color:var(--gray-500);">${(parseFloat(e.carbs)||0).toFixed(1)}g</td>
                <td style="font-size:12px;color:var(--gray-500);">${(parseFloat(e.protein)||0).toFixed(1)}g</td>
                <td style="font-size:12px;color:var(--gray-600);">${esc(moodNote || '—')}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="editMealEntry('${esc(e.id)}')">Edit</button>
                    <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteMealEntry('${esc(e.id)}')">Del</button>
                </td>
            </tr>`;
        }
        html += '</tbody></table></div>';
    }
    list.innerHTML = html;
}

function onMealFoodChange() {
    const sel = document.getElementById('mealFood');
    const food = foodLibrary.find(f => f.id === sel.value);
    if (!food) return;
    // Pre-fill grams to 100 if blank
    const gramsEl = document.getElementById('mealGrams');
    if (!gramsEl.value) gramsEl.value = '100';
}

function getPer100(food) {
    return {
        calories: parseFloat(food?.calories) || 0,
        sugar:    parseFloat(food?.sugar)    || 0,
        carbs:    parseFloat(food?.carbs)    || 0,
        protein:  parseFloat(food?.protein)  || 0,
    };
}

async function saveMealEntry() {
    const foodId = document.getElementById('mealFood').value;
    const food = foodLibrary.find(f => f.id === foodId);
    if (!food) { showToast('Pick a food first.', 'error'); return; }

    const grams = parseFloat(document.getElementById('mealGrams').value) || 0;
    if (grams <= 0) { showToast('Enter grams.', 'error'); return; }

    const per100 = getPer100(food);
    const factor = grams / 100;
    const payload = {
        id: editingMealId || undefined,
        date: document.getElementById('mealDate').value || mealDateFilter,
        time: document.getElementById('mealTime').value,
        mealType: document.getElementById('mealType').value,
        foodId: food.id,
        foodName: food.name,
        grams,
        calories: per100.calories * factor,
        sugar:    per100.sugar    * factor,
        carbs:    per100.carbs    * factor,
        protein:  per100.protein  * factor,
        mood:  document.getElementById('mealMood').value,
        notes: document.getElementById('mealNotes').value,
    };

    try {
        await apiFetch('/api/meals', { method: 'POST', body: JSON.stringify(payload) });
        showToast(editingMealId ? 'Updated.' : 'Logged.', 'success');
        clearMealForm();
        await loadMeals();
    } catch (e) {
        showToast('Save failed.', 'error');
    }
}

function clearMealForm() {
    editingMealId = null;
    document.getElementById('mealSaveBtn').textContent = 'Log Entry';
    document.getElementById('mealFood').value = '';
    document.getElementById('mealGrams').value = '';
    document.getElementById('mealTime').value = '';
    document.getElementById('mealMood').value = '';
    document.getElementById('mealNotes').value = '';
    document.getElementById('mealDate').value = mealDateFilter;
}

function editMealEntry(id) {
    const e = mealEntries.find(x => x.id === id);
    if (!e) return;
    editingMealId = id;
    document.getElementById('mealDate').value     = e.date || '';
    document.getElementById('mealTime').value     = e.time || '';
    document.getElementById('mealType').value     = e.mealType || '';
    document.getElementById('mealFood').value     = e.foodId || '';
    document.getElementById('mealGrams').value    = e.grams || '';
    document.getElementById('mealMood').value     = e.mood || '';
    document.getElementById('mealNotes').value    = e.notes || '';
    document.getElementById('mealSaveBtn').textContent = 'Save Changes';
    document.getElementById('mealEntryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteMealEntry(id) {
    const e = mealEntries.find(x => x.id === id);
    if (!e) return;
    if (!confirm(`Delete ${e.foodName}?`)) return;
    try {
        await apiFetch('/api/meals', { method: 'DELETE', body: JSON.stringify({ id }) });
        showToast('Deleted.', 'success');
        await loadMeals();
    } catch (err) {
        showToast('Delete failed.', 'error');
    }
}

// ==================== LIBRARY VIEW ====================

function renderFoodLibrary() {
    const list = document.getElementById('foodLibraryList');
    if (!list) return;
    if (foodLibrary.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No foods yet — add one below.</p></div>';
        return;
    }
    let html = '<table><thead><tr><th>Food</th><th style="width:80px;">Calories</th><th style="width:60px;">Sugar</th><th style="width:60px;">Carbs</th><th style="width:70px;">Protein</th><th></th></tr></thead><tbody>';
    for (const f of foodLibrary) {
        html += `<tr id="food-row-${esc(f.id)}">
            <td>${esc(f.name)}</td>
            <td>${(parseFloat(f.calories)||0).toFixed(0)}</td>
            <td>${(parseFloat(f.sugar)||0).toFixed(1)}g</td>
            <td>${(parseFloat(f.carbs)||0).toFixed(1)}g</td>
            <td>${(parseFloat(f.protein)||0).toFixed(1)}g</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="editFood('${esc(f.id)}')">Edit</button>
                <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteFood('${esc(f.id)}')">Del</button>
            </td>
        </tr>`;
    }
    html += '</tbody></table><div style="font-size:11px;color:var(--gray-500);margin-top:6px;">All values per 100g.</div>';
    list.innerHTML = html;
}

async function saveFood() {
    const name = document.getElementById('foodName').value.trim();
    if (!name) { showToast('Food name required.', 'error'); return; }
    const payload = {
        id: editingFoodId || undefined,
        name,
        calories: document.getElementById('foodCalories').value,
        sugar:    document.getElementById('foodSugar').value,
        carbs:    document.getElementById('foodCarbs').value,
        protein:  document.getElementById('foodProtein').value,
    };
    try {
        await apiFetch('/api/foods', { method: 'POST', body: JSON.stringify(payload) });
        showToast(editingFoodId ? 'Updated.' : 'Added.', 'success');
        clearFoodForm();
        await loadMeals();
    } catch (e) {
        showToast('Save failed.', 'error');
    }
}

function clearFoodForm() {
    editingFoodId = null;
    document.getElementById('foodSaveBtn').textContent = 'Add Food';
    document.getElementById('foodName').value     = '';
    document.getElementById('foodCalories').value = '';
    document.getElementById('foodSugar').value    = '';
    document.getElementById('foodCarbs').value    = '';
    document.getElementById('foodProtein').value  = '';
}

function editFood(id) {
    const f = foodLibrary.find(x => x.id === id);
    if (!f) return;
    editingFoodId = id;
    document.getElementById('foodName').value     = f.name || '';
    document.getElementById('foodCalories').value = f.calories || '';
    document.getElementById('foodSugar').value    = f.sugar || '';
    document.getElementById('foodCarbs').value    = f.carbs || '';
    document.getElementById('foodProtein').value  = f.protein || '';
    document.getElementById('foodSaveBtn').textContent = 'Save Changes';
    document.getElementById('foodForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteFood(id) {
    const f = foodLibrary.find(x => x.id === id);
    if (!f) return;
    if (!confirm(`Delete ${f.name} from the library? Existing meal entries that used it will keep their snapshot.`)) return;
    try {
        await apiFetch('/api/foods', { method: 'DELETE', body: JSON.stringify({ id }) });
        showToast('Deleted.', 'success');
        await loadMeals();
    } catch (e) {
        showToast('Delete failed.', 'error');
    }
}

// ==================== TRENDS VIEW ====================

function renderMealTrends() {
    const el = document.getElementById('mealTrendsContent');
    if (!el) return;

    // Group entries by date → totals
    const byDate = {};
    for (const e of mealEntries) {
        const d = e.date;
        if (!d) continue;
        if (!byDate[d]) byDate[d] = { calories: 0, sugar: 0, carbs: 0, protein: 0 };
        byDate[d].calories += parseFloat(e.calories) || 0;
        byDate[d].sugar    += parseFloat(e.sugar)    || 0;
        byDate[d].carbs    += parseFloat(e.carbs)    || 0;
        byDate[d].protein  += parseFloat(e.protein)  || 0;
    }
    const dates = Object.keys(byDate).sort();

    if (dates.length < 2) {
        el.innerHTML = '<div class="empty-state"><p>Need at least 2 days of entries to show trends.</p></div>';
        return;
    }

    // Show last 30 days max
    const recent = dates.slice(-30);
    const avgCal = recent.reduce((s, d) => s + byDate[d].calories, 0) / recent.length;
    const avgPro = recent.reduce((s, d) => s + byDate[d].protein,  0) / recent.length;
    const avgCarb= recent.reduce((s, d) => s + byDate[d].carbs,    0) / recent.length;
    const avgSug = recent.reduce((s, d) => s + byDate[d].sugar,    0) / recent.length;

    let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
        <div class="stat-card"><div class="label">Avg Calories</div><div class="value">${avgCal.toFixed(0)}</div></div>
        <div class="stat-card"><div class="label">Avg Protein</div><div class="value">${avgPro.toFixed(0)}g</div></div>
        <div class="stat-card"><div class="label">Avg Carbs</div><div class="value">${avgCarb.toFixed(0)}g</div></div>
        <div class="stat-card"><div class="label">Avg Sugar</div><div class="value">${avgSug.toFixed(0)}g</div></div>
    </div>`;
    html += `<div style="font-size:11px;color:var(--gray-500);margin-bottom:8px;">Average over last ${recent.length} day(s) with entries.</div>`;

    // Daily calorie bar chart
    const maxCal = Math.max(...recent.map(d => byDate[d].calories), 1);
    html += '<h3 style="font-size:14px;margin-bottom:10px;color:var(--gray-700);">Daily Calories</h3>';
    html += '<div style="display:flex;align-items:end;gap:2px;height:140px;margin-bottom:4px;padding:0 4px;">';
    for (const d of recent) {
        const v = byDate[d].calories;
        const h = Math.max((v / maxCal) * 100, 2);
        html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;" title="${d}: ${v.toFixed(0)} kcal">
            <div style="width:100%;max-width:24px;height:${h}%;background:#10b981;border-radius:3px 3px 0 0;opacity:0.85;"></div>
        </div>`;
    }
    html += '</div><div style="display:flex;gap:2px;padding:0 4px;margin-bottom:24px;">';
    for (const d of recent) html += `<div style="flex:1;text-align:center;font-size:9px;color:var(--gray-400);">${d.slice(8)}</div>`;
    html += '</div>';

    // Macro breakdown over the same window
    const totCarb = recent.reduce((s, d) => s + byDate[d].carbs, 0);
    const totPro  = recent.reduce((s, d) => s + byDate[d].protein, 0);
    const totSug  = recent.reduce((s, d) => s + byDate[d].sugar, 0);
    const macroTotal = totCarb + totPro + totSug || 1;
    html += '<h3 style="font-size:14px;margin-bottom:10px;color:var(--gray-700);">Macro Mix (grams)</h3>';
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;">';
    const macros = [
        ['Carbs',   totCarb, '#f59e0b'],
        ['Protein', totPro,  '#3b82f6'],
        ['Sugar',   totSug,  '#ef4444'],
    ];
    for (const [name, amt, color] of macros) {
        const pct = (amt / macroTotal * 100);
        html += `<div style="flex:1;min-width:160px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;">
                <span>${name}</span><span style="color:var(--gray-500);">${amt.toFixed(0)}g (${pct.toFixed(0)}%)</span>
            </div>
            <div style="height:18px;background:var(--gray-100);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${color};"></div>
            </div>
        </div>`;
    }
    html += '</div>';

    el.innerHTML = html;
}
