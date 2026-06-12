/* ==========================================================================
   Guru Dashboard — Finances Module
   Expense/income/business tracking, analysis charts, currency conversion
   ========================================================================== */

// ==================== FINANCES ====================
let financeEntries = [];
let editingFinanceId = null;
let currentFinMode = 'analysis';
let finExpMonthFilter = new Date().toISOString().slice(0, 7);
let finIncMonthFilter = new Date().toISOString().slice(0, 7);
let finBizMonthFilter = '';
let finExpGroupFilter = '';
const expSelectedIds = new Set();

function switchFinMode(mode) {
    currentFinMode = mode;
    document.querySelectorAll('.fin-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.fin-mode-btn[data-mode="${mode}"]`).classList.add('active');
    document.querySelectorAll('.fin-panel').forEach(p => p.style.display = 'none');
    document.getElementById('fin-panel-' + mode).style.display = '';
    if (mode === 'analysis') {
        if (!document.getElementById('finAnalysisMonth').value) {
            document.getElementById('finAnalysisMonth').value = new Date().toISOString().slice(0, 7);
        }
        renderAnalysis();
    } else {
        clearFinanceForm(mode);
    }
}

// Keyboard helpers: Enter on empty date/datetime -> fill now; Enter on select -> open picker
document.addEventListener('keydown', function(e) {
    const el = e.target;
    if (e.key === 'Enter' && el.type === 'date' && !el.value) {
        e.preventDefault();
        el.value = new Date().toISOString().slice(0, 10);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (e.key === 'Enter' && el.type === 'datetime-local' && !el.value) {
        e.preventDefault();
        const now = new Date();
        const local = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        el.value = local;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (e.key === 'Enter' && el.tagName === 'SELECT') {
        e.preventDefault();
        if (el.showPicker) el.showPicker();
    }
});

async function loadFinances() {
    applyCurrencyUI();
    refreshExchangeRate();
    try {
        const data = await apiFetch('/api/finances');
        financeEntries = data.entries || [];
        loadIncomeGoal();
        loadExpenseGoal();
        renderFinances();
    } catch (e) {
        document.getElementById('finBizTableMonthly').innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

function renderFinances() {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Business expenses
    const biz = financeEntries.filter(e => (e.kind || 'business') === 'business');
    const bizMonthly = biz.filter(e => e.frequency !== 'yearly');
    const bizYearly = biz.filter(e => e.frequency === 'yearly');
    const bizMoTotal = bizMonthly.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const bizYrTotal = bizYearly.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    document.getElementById('finBizMonthly').textContent = '$' + bizMoTotal.toFixed(2);
    document.getElementById('finBizYearly').textContent = '$' + bizYrTotal.toFixed(2);
    document.getElementById('finBizAnnualized').textContent = '$' + ((bizMoTotal * 12) + bizYrTotal).toFixed(2);
    document.getElementById('finBizTableMonthly').innerHTML = buildBizTable(bizMonthly, 'monthly');
    document.getElementById('finBizTableYearly').innerHTML = buildBizTable(bizYearly, 'yearly');

    // One-time business expenses (from expense tracking with category=business)
    const bizOneTime = financeEntries.filter(e => e.kind === 'expense' && e.category === 'business');

    // Build month buttons from one-time business expense data
    const bizMonths = [...new Set(bizOneTime.map(e => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    if (!finBizMonthFilter && bizMonths.length) finBizMonthFilter = bizMonths[0];
    const bizBtnContainer = document.getElementById('finBizMonthBtns');
    if (bizBtnContainer) {
        let bizBtnHtml = `<button class="btn btn-sm ${!finBizMonthFilter ? 'btn-primary' : 'btn-secondary'}" onclick="setBizMonth('')" style="padding:4px 12px;font-size:12px;">All</button>`;
        for (const m of bizMonths) {
            const [y, mo] = m.split('-');
            const label = monthNames[parseInt(mo) - 1] + ' ' + y;
            const active = finBizMonthFilter === m;
            bizBtnHtml += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="setBizMonth('${m}')" style="padding:4px 12px;font-size:12px;">${label}</button>`;
        }
        bizBtnContainer.innerHTML = bizBtnHtml;
    }

    let filteredBizOneTime = bizOneTime;
    if (finBizMonthFilter) filteredBizOneTime = filteredBizOneTime.filter(e => (e.date || '').startsWith(finBizMonthFilter));
    const bizOneTimeTotal = filteredBizOneTime.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const bizOTLabel = document.getElementById('finBizOneTimeTotal');
    if (bizOTLabel) bizOTLabel.textContent = bizOneTimeTotal > 0 ? '$' + bizOneTimeTotal.toFixed(2) : '';
    document.getElementById('finBizTableOneTime').innerHTML = buildOneTimeBizTable(filteredBizOneTime);

    // Expenses — separate recurring from one-time
    const exp = financeEntries.filter(e => e.kind === 'expense');
    const expRecurring = exp.filter(e => e.frequency === 'monthly' || e.frequency === 'weekly' || e.frequency === 'yearly');
    const expOneTime = exp.filter(e => !e.frequency || e.frequency === 'one-time' || e.frequency === '');
    // Weekly → monthly multiplier: 52 weeks / 12 months ≈ 4.3333
    const WEEKS_PER_MONTH = 52 / 12;
    const recMonthlyUSD = expRecurring.filter(e => e.frequency === 'monthly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const recWeeklyUSD = expRecurring.filter(e => e.frequency === 'weekly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const recYearlyUSD = expRecurring.filter(e => e.frequency === 'yearly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const recurringMonthlyUSD = recMonthlyUSD + recWeeklyUSD * WEEKS_PER_MONTH + recYearlyUSD / 12;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const expDisplayMonth = finExpMonthFilter || '';
    const expForTotals = expDisplayMonth ? expOneTime.filter(e => (e.date || '').startsWith(expDisplayMonth)) : expOneTime;
    const expMonthUSD = expForTotals.reduce((s, e) => s + (parseFloat(e.price) || 0), 0) + recurringMonthlyUSD;
    // Entries can be in different local currencies; convert USD totals via the current rate of the active currency.
    const currentRate = parseFloat(document.getElementById('finExpRate')?.value) || CURRENCIES[activeCurrency].defaultRate;
    const expMonthLocal = expMonthUSD * currentRate;

    // Render recurring expenses section
    const recSection = document.getElementById('finExpRecurringSection');
    if (recSection) {
        if (expRecurring.length > 0) {
            let recHtml = '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px;">';
            recHtml += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><h3 style="font-size:14px;color:var(--gray-700);margin:0;">Recurring Expenses</h3><span style="font-weight:600;color:var(--red);">-$${recurringMonthlyUSD.toFixed(2)}/mo</span></div>`;
            recHtml += '<table><thead><tr><th>USD</th><th>Local</th><th>Description</th><th>Category</th><th>Freq</th><th>Date</th><th></th></tr></thead><tbody>';
            for (const e of expRecurring) {
                const usd = parseFloat(e.price) || 0;
                const localAmt = parseFloat(e.localAmount) || 0;
                const localCcy = e.localCurrency || 'IDR';
                recHtml += `<tr id="fin-row-${e.id}"><td style="font-weight:600;color:var(--red);">-$${usd.toFixed(2)}</td><td style="font-size:12px;color:var(--gray-500);">${localAmt ? fmtLocal(localAmt, localCcy) : '\u2014'}</td><td>${esc(e.product)}</td><td><span style="padding:2px 8px;border-radius:4px;font-size:11px;background:var(--gray-100);color:var(--gray-600);">${esc(e.category||'\u2014')}</span></td><td style="font-size:12px;text-transform:capitalize;">${esc(e.frequency)}</td><td style="font-size:12px;color:var(--gray-500);">${esc(e.recurringDate||'\u2014')}</td><td style="white-space:nowrap;"><button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineEditExp('${e.id}')">Edit</button><button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteFinance('${e.id}','${esc(e.product)}')">Del</button></td></tr>`;
            }
            recHtml += '</tbody></table></div>';
            recSection.innerHTML = recHtml;
        } else {
            recSection.innerHTML = '';
        }
    }
    const expMonthLabel = finExpMonthFilter ? monthNames[parseInt(expDisplayMonth.slice(5)) - 1] + ' ' + expDisplayMonth.slice(0, 4) : 'All Months';
    document.getElementById('finExpMonth').textContent = '$' + expMonthUSD.toFixed(2);
    document.getElementById('finExpLocalSub').textContent = fmtLocal(expMonthLocal, activeCurrency);
    document.getElementById('finExpMonth').closest('.stat-card').querySelector('.label').textContent = expMonthLabel + ' (USD)';
    updateExpenseGoalProgress(expMonthUSD);

    // Build month buttons from one-time expense data
    const expMonths = [...new Set(expOneTime.map(e => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const btnContainer = document.getElementById('finExpMonthBtns');
    if (btnContainer) {
        let btnHtml = `<button class="btn btn-sm ${!finExpMonthFilter ? 'btn-primary' : 'btn-secondary'}" onclick="setExpMonth('')" style="padding:4px 12px;font-size:12px;">All</button>`;
        for (const m of expMonths) {
            const [y, mo] = m.split('-');
            const label = monthNames[parseInt(mo) - 1] + ' ' + y;
            const active = finExpMonthFilter === m;
            btnHtml += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="setExpMonth('${m}')" style="padding:4px 12px;font-size:12px;">${label}</button>`;
        }
        btnContainer.innerHTML = btnHtml;
    }

    // Build group filter buttons from all expenses (one-time + recurring)
    const allGroups = [...new Set(exp.map(e => (e.groupTag || '').trim()).filter(Boolean))].sort();
    const groupBtnContainer = document.getElementById('finExpGroupBtns');
    if (groupBtnContainer) {
        if (allGroups.length === 0) {
            groupBtnContainer.innerHTML = '';
        } else {
            // Compute totals per group (one-time + recurring monthly-equivalent if you want — keep it simple: sum raw USD price of expense entries tagged with this group)
            const groupTotals = {};
            for (const e of exp) {
                const g = (e.groupTag || '').trim();
                if (g) groupTotals[g] = (groupTotals[g] || 0) + (parseFloat(e.price) || 0);
            }
            let gHtml = '<span style="font-size:12px;color:var(--gray-500);margin-right:4px;">Groups:</span>';
            gHtml += `<button class="btn btn-sm ${!finExpGroupFilter ? 'btn-primary' : 'btn-secondary'}" onclick="setExpGroup('')" style="padding:4px 12px;font-size:12px;">All</button>`;
            for (const g of allGroups) {
                const active = finExpGroupFilter === g;
                const tot = groupTotals[g] || 0;
                gHtml += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="setExpGroup('${esc(g)}')" style="padding:4px 12px;font-size:12px;" title="$${tot.toFixed(2)} total">${esc(g)} <span style="opacity:0.7;font-weight:400;">· $${tot.toFixed(2)}</span></button>`;
            }
            groupBtnContainer.innerHTML = gHtml;
        }
    }

    // Populate datalist for group autocomplete (Add form + bulk-tag bar)
    const dl = document.getElementById('finExpGroupsList');
    if (dl) dl.innerHTML = allGroups.map(g => `<option value="${esc(g)}"></option>`).join('');

    // Render the bulk-tag bar
    renderExpBulkBar();

    // Apply expense filters (one-time only; recurring shown separately above)
    const expSearch = (document.getElementById('finExpSearch')?.value || '').toLowerCase();
    const expCatFilter = document.getElementById('finExpFilterCat')?.value || '';
    const expSort = document.getElementById('finExpSort')?.value || 'date-desc';
    let filteredExp = expOneTime;
    if (finExpMonthFilter) filteredExp = filteredExp.filter(e => (e.date || '').startsWith(finExpMonthFilter));
    if (finExpGroupFilter) filteredExp = filteredExp.filter(e => (e.groupTag || '').trim() === finExpGroupFilter);
    if (expSearch) filteredExp = filteredExp.filter(e => ((e.product||'')+(e.company||'')+(e.category||'')+(e.groupTag||'')).toLowerCase().includes(expSearch));
    if (expCatFilter) filteredExp = filteredExp.filter(e => e.category === expCatFilter);
    filteredExp = sortFinEntries(filteredExp, expSort);
    document.getElementById('finExpTable').innerHTML = buildExpenseTable(filteredExp);

    // Income
    const inc = financeEntries.filter(e => e.kind === 'income');
    const incTotal = inc.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const incDisplayMonth = finIncMonthFilter || thisMonth;
    const incForMonth = inc.filter(e => (e.date || '').startsWith(incDisplayMonth));
    const incMonthTotal = incForMonth.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const incMonthLabel = finIncMonthFilter ? monthNames[parseInt(incDisplayMonth.slice(5)) - 1] + ' ' + incDisplayMonth.slice(0, 4) : 'This Month';
    document.getElementById('finIncMonth').textContent = '$' + incMonthTotal.toFixed(2);
    document.getElementById('finIncMonthLabel').textContent = incMonthLabel;
    document.getElementById('finIncTotalSub').textContent = 'Total: $' + incTotal.toFixed(2);
    updateIncomeGoalProgress(incMonthTotal);

    // Build month buttons from income data
    const incMonths = [...new Set(inc.map(e => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const incBtnContainer = document.getElementById('finIncMonthBtns');
    if (incBtnContainer) {
        let incBtnHtml = `<button class="btn btn-sm ${!finIncMonthFilter ? 'btn-primary' : 'btn-secondary'}" onclick="setIncMonth('')" style="padding:4px 12px;font-size:12px;">All</button>`;
        for (const m of incMonths) {
            const [y, mo] = m.split('-');
            const label = monthNames[parseInt(mo) - 1] + ' ' + y;
            const active = finIncMonthFilter === m;
            incBtnHtml += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="setIncMonth('${m}')" style="padding:4px 12px;font-size:12px;">${label}</button>`;
        }
        incBtnContainer.innerHTML = incBtnHtml;
    }

    // Apply income filters
    const incSearch = (document.getElementById('finIncSearch')?.value || '').toLowerCase();
    const incCatFilter = document.getElementById('finIncFilterCat')?.value || '';
    const incSort = document.getElementById('finIncSort')?.value || 'date-desc';
    let filteredInc = inc;
    if (finIncMonthFilter) filteredInc = filteredInc.filter(e => (e.date || '').startsWith(finIncMonthFilter));
    if (incSearch) filteredInc = filteredInc.filter(e => ((e.product||'')+(e.company||'')+(e.category||'')).toLowerCase().includes(incSearch));
    if (incCatFilter) filteredInc = filteredInc.filter(e => e.category === incCatFilter);
    filteredInc = sortFinEntries(filteredInc, incSort);
    document.getElementById('finIncTable').innerHTML = buildIncomeTable(filteredInc);

    // Analysis
    if (currentFinMode === 'analysis') {
        if (!document.getElementById('finAnalysisMonth').value) {
            document.getElementById('finAnalysisMonth').value = new Date().toISOString().slice(0, 7);
        }
        renderAnalysis();
    }
}

function sortFinEntries(entries, sortKey) {
    const sorted = [...entries];
    switch (sortKey) {
        case 'date-desc': return sorted.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        case 'date-asc': return sorted.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        case 'price-desc': return sorted.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
        case 'price-asc': return sorted.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0));
        case 'product-asc': return sorted.sort((a, b) => (a.product || '').localeCompare(b.product || ''));
        case 'place-asc': return sorted.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
        default: return sorted;
    }
}

function setExpMonth(month) {
    finExpMonthFilter = month;
    renderFinances();
}

function setExpGroup(group) {
    finExpGroupFilter = group || '';
    renderFinances();
}

function toggleExpSelect(id, checked) {
    if (checked) expSelectedIds.add(id);
    else expSelectedIds.delete(id);
    renderExpBulkBar();
}

function toggleExpSelectAll(checked) {
    // Apply to currently rendered rows (the filtered set the user sees)
    document.querySelectorAll('#finExpTable tbody tr').forEach(row => {
        const id = row.id.replace('fin-row-', '');
        if (checked) expSelectedIds.add(id);
        else expSelectedIds.delete(id);
        const cb = row.querySelector('td input[type="checkbox"]');
        if (cb) cb.checked = checked;
    });
    renderExpBulkBar();
}

function clearExpSelection() {
    expSelectedIds.clear();
    renderFinances();
}

function renderExpBulkBar() {
    const bar = document.getElementById('finExpBulkBar');
    if (!bar) return;
    const n = expSelectedIds.size;
    if (n === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    document.getElementById('finExpBulkCount').textContent = `${n} selected`;
}

async function applyExpBulkTag() {
    const tag = (document.getElementById('finExpBulkGroup')?.value || '').trim();
    if (!tag) { showToast('Type a group name first.', 'error'); return; }
    await bulkUpdateGroupTag(tag);
}

async function clearExpBulkTag() {
    await bulkUpdateGroupTag('');
}

async function bulkUpdateGroupTag(tag) {
    if (expSelectedIds.size === 0) return;
    const ids = [...expSelectedIds];
    const targets = ids.map(id => financeEntries.find(e => e.id === id)).filter(Boolean);
    if (targets.length === 0) return;
    try {
        for (const e of targets) {
            const payload = {
                id: e.id, kind: e.kind || 'expense',
                price: e.price, product: e.product || '',
                company: e.company || '', category: e.category || '',
                date: e.date || '', frequency: e.frequency || '',
                recurringDate: e.recurringDate || '',
                localAmount: e.localAmount || '', localCurrency: e.localCurrency || '',
                businessUseCase: e.businessUseCase || '',
                groupTag: tag,
            };
            await apiFetch('/api/finances', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(tag ? `Tagged ${targets.length} as "${tag}".` : `Untagged ${targets.length}.`, 'success');
        expSelectedIds.clear();
        const bulkInput = document.getElementById('finExpBulkGroup'); if (bulkInput) bulkInput.value = '';
        await loadFinances();
    } catch (e) {
        showToast('Bulk tag failed.', 'error');
    }
}

function setIncMonth(month) {
    finIncMonthFilter = month;
    renderFinances();
}

function saveIncomeGoal() {
    const val = parseFloat(document.getElementById('finIncGoal').value) || 0;
    localStorage.setItem('income-goal', val);
    renderFinances();
}

function loadIncomeGoal() {
    const saved = localStorage.getItem('income-goal');
    if (saved) document.getElementById('finIncGoal').value = parseFloat(saved) || 0;
}

function updateIncomeGoalProgress(monthTotal) {
    const goal = parseFloat(document.getElementById('finIncGoal').value) || 0;
    const el = document.getElementById('finIncGoalProgress');
    if (!goal) { el.textContent = ''; return; }
    const pct = Math.min((monthTotal / goal) * 100, 100);
    const remaining = goal - monthTotal;
    if (remaining <= 0) {
        el.innerHTML = `<span style="color:var(--green);">Goal reached! +$${Math.abs(remaining).toFixed(2)}</span>`;
    } else {
        el.innerHTML = `<span style="color:var(--gray-500);">${pct.toFixed(0)}% — $${remaining.toFixed(2)} to go</span>`;
    }
}

function saveExpenseGoal() {
    const val = parseFloat(document.getElementById('finExpGoal').value) || 0;
    localStorage.setItem('expense-goal', val);
    renderFinances();
}

function loadExpenseGoal() {
    const saved = localStorage.getItem('expense-goal');
    if (saved) document.getElementById('finExpGoal').value = parseFloat(saved) || 0;
}

function updateExpenseGoalProgress(monthTotal) {
    const goal = parseFloat(document.getElementById('finExpGoal').value) || 0;
    const el = document.getElementById('finExpGoalProgress');
    if (!goal) { el.textContent = ''; return; }
    const pct = Math.min((monthTotal / goal) * 100, 100);
    const remaining = goal - monthTotal;
    if (remaining <= 0) {
        el.innerHTML = `<span style="color:var(--red);">Over budget by $${Math.abs(remaining).toFixed(2)}</span>`;
    } else {
        el.innerHTML = `<span style="color:var(--green);">${pct.toFixed(0)}% used — $${remaining.toFixed(2)} remaining</span>`;
    }
}

function setBizMonth(month) {
    finBizMonthFilter = month;
    renderFinances();
}

function toggleBizFrequency() {
    const freq = document.getElementById('finBizFrequency').value;
    document.querySelector('.finBizRecurringGroup').style.display = freq === 'one-time' ? 'none' : '';
    document.querySelector('.finBizDateGroup').style.display = freq === 'one-time' ? '' : 'none';
}

function toggleExpRecurring() {
    const isRecurring = document.getElementById('finExpRecurring')?.checked;
    document.getElementById('finExpFrequency').style.display = isRecurring ? '' : 'none';
    document.getElementById('finExpRecurringDate').style.display = isRecurring ? '' : 'none';
    const dateGroup = document.getElementById('finExpDate')?.closest('.form-group');
    if (dateGroup) dateGroup.style.display = isRecurring ? 'none' : '';
}

function buildBizTable(entries, label) {
    if (entries.length === 0) return `<div class="empty-state"><p>No ${label} expenses yet.</p></div>`;
    let html = '<table><thead><tr><th>Price</th><th>Product</th><th>Company</th><th>Business Use Case</th><th>Recurring Date</th><th></th></tr></thead><tbody>';
    for (const e of entries) {
        html += `<tr id="fin-row-${e.id}">
            <td style="font-weight:600;">$${(parseFloat(e.price)||0).toFixed(2)}</td>
            <td>${esc(e.product)}</td><td>${esc(e.company||'—')}</td>
            <td>${esc(e.businessUseCase||'—')}</td><td>${esc(e.recurringDate||'—')}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineEditBiz('${e.id}')">Edit</button>
                <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteFinance('${e.id}','${esc(e.product)}')">Del</button>
            </td></tr>`;
    }
    return html + '</tbody></table>';
}

function buildOneTimeBizTable(entries) {
    if (entries.length === 0) return '<div class="empty-state"><p>No one-time business expenses.</p></div>';
    entries = [...entries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const total = entries.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    let html = '<table><thead><tr><th>USD</th><th>Description</th><th>Place</th><th>Date</th></tr></thead><tbody>';
    for (const e of entries) {
        html += `<tr><td style="font-weight:600;">$${(parseFloat(e.price)||0).toFixed(2)}</td>
            <td>${esc(e.product)}</td><td>${esc(e.company||'—')}</td><td>${esc(e.date||'—')}</td></tr>`;
    }
    html += `</tbody><tfoot><tr><td style="font-weight:700;">$${total.toFixed(2)}</td><td colspan="3" style="font-size:12px;color:var(--gray-500);">Total</td></tr></tfoot></table>`;
    return html;
}

function inlineEditBiz(id) {
    const entry = financeEntries.find(e => e.id === id);
    if (!entry) return;
    const is = 'style="padding:4px 6px;font-size:12px;width:100%;border:1px solid var(--gray-300);border-radius:4px;"';
    const row = document.getElementById('fin-row-' + id);
    if (!row) return;
    row.innerHTML = `
        <td><input type="number" step="0.01" value="${parseFloat(entry.price)||''}" id="ie-price-${id}" ${is}></td>
        <td><input type="text" value="${esc(entry.product)}" id="ie-product-${id}" ${is}></td>
        <td><input type="text" value="${esc(entry.company||'')}" id="ie-company-${id}" ${is}></td>
        <td><input type="text" value="${esc(entry.businessUseCase||'')}" id="ie-use-${id}" ${is}></td>
        <td><input type="text" value="${esc(entry.recurringDate||'')}" id="ie-recdate-${id}" ${is}></td>
        <td style="white-space:nowrap;">
            <button class="btn btn-primary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineSaveBiz('${id}')">Save</button>
            <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="renderFinances()">Cancel</button>
        </td>`;
}

async function inlineSaveBiz(id) {
    const payload = {
        id, kind: 'business',
        price: document.getElementById('ie-price-' + id).value,
        product: document.getElementById('ie-product-' + id).value.trim(),
        company: document.getElementById('ie-company-' + id).value.trim(),
        businessUseCase: document.getElementById('ie-use-' + id).value.trim(),
        recurringDate: document.getElementById('ie-recdate-' + id).value.trim(),
    };
    if (!payload.product) { showToast('Product is required.', 'error'); return; }
    try {
        await apiFetch('/api/finances', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Updated.', 'success');
        await loadFinances();
    } catch (e) {}
}

const CURRENCIES = {
    IDR: { code: 'IDR', symbol: 'Rp', locale: 'id-ID', defaultRate: 15800, step: '1',    placeholder: '395,000', decimals: 0 },
    MYR: { code: 'MYR', symbol: 'RM', locale: 'ms-MY', defaultRate: 4.7,   step: '0.01', placeholder: '25.00',   decimals: 2 },
};
let activeCurrency = localStorage.getItem('fin_active_currency') || 'IDR';
if (!CURRENCIES[activeCurrency]) activeCurrency = 'IDR';

function fmtLocal(amount, code) {
    const ccy = CURRENCIES[code] || CURRENCIES.IDR;
    const n = parseFloat(amount) || 0;
    const num = ccy.decimals === 0
        ? Math.round(n).toLocaleString(ccy.locale)
        : n.toLocaleString(ccy.locale, { minimumFractionDigits: ccy.decimals, maximumFractionDigits: ccy.decimals });
    return ccy.symbol + ' ' + num;
}

const FX_CACHE_KEY = (code) => `fin_usd_rate_${code}`;
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function applyExchangeRate(rate, source) {
    const input = document.getElementById('finExpRate');
    const status = document.getElementById('finExpRateStatus');
    const ccy = CURRENCIES[activeCurrency];
    if (input) input.value = ccy.decimals === 0 ? Math.round(rate) : parseFloat(rate).toFixed(4);
    if (status) {
        status.textContent = source === 'live' ? '(live)' : source === 'cache' ? '(cached)' : '';
        status.style.color = source === 'live' ? '#2a8c4a' : 'var(--gray-400)';
    }
}

async function refreshExchangeRate() {
    const code = activeCurrency;
    try {
        const raw = localStorage.getItem(FX_CACHE_KEY(code));
        if (raw) {
            const { rate, ts } = JSON.parse(raw);
            if (rate && Date.now() - ts < FX_CACHE_TTL_MS) {
                applyExchangeRate(rate, 'cache');
            }
        }
    } catch (e) {}
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) throw new Error('rate fetch failed: ' + res.status);
        const data = await res.json();
        const live = data && data.rates && data.rates[code];
        if (live) {
            applyExchangeRate(live, 'live');
            localStorage.setItem(FX_CACHE_KEY(code), JSON.stringify({ rate: live, ts: Date.now() }));
        }
    } catch (e) {}
}

function applyCurrencyUI() {
    const ccy = CURRENCIES[activeCurrency];
    const sel = document.getElementById('finExpCurrency');
    if (sel && sel.value !== activeCurrency) sel.value = activeCurrency;
    const input = document.getElementById('finExpLocal');
    if (input) { input.step = ccy.step; input.placeholder = ccy.placeholder; }
    const label = document.getElementById('finExpLocalLabel');
    if (label) label.textContent = `${ccy.code} (${ccy.symbol})`;
    const rateLabel = document.getElementById('finExpRateLabel');
    if (rateLabel) rateLabel.textContent = ccy.code;
}

function switchCurrency(code) {
    if (!CURRENCIES[code]) return;
    activeCurrency = code;
    localStorage.setItem('fin_active_currency', code);
    const input = document.getElementById('finExpLocal');
    if (input) input.value = '';
    applyCurrencyUI();
    refreshExchangeRate();
    renderFinances();
}

function finConvertUsdToLocal() {
    const usd = parseFloat(document.getElementById('finExpAmount').value);
    const rate = parseFloat(document.getElementById('finExpRate').value) || CURRENCIES[activeCurrency].defaultRate;
    if (isNaN(usd)) return;
    const ccy = CURRENCIES[activeCurrency];
    document.getElementById('finExpLocal').value = ccy.decimals === 0 ? Math.round(usd * rate) : (usd * rate).toFixed(ccy.decimals);
}

function finConvertLocalToUsd() {
    const local = parseFloat(document.getElementById('finExpLocal').value);
    const rate = parseFloat(document.getElementById('finExpRate').value) || CURRENCIES[activeCurrency].defaultRate;
    if (!isNaN(local)) document.getElementById('finExpAmount').value = (local / rate).toFixed(2);
}

const EXP_CATS = ['groceries','restaurant','rent','business','health','luxury','travel','education','transport','utilities','entertainment','shopping','other'];

function buildExpenseTable(entries) {
    if (entries.length === 0) return '<div class="empty-state"><p>No expenses match your filters.</p></div>';
    const allSelected = entries.length > 0 && entries.every(e => expSelectedIds.has(e.id));
    let html = `<table><thead><tr>
        <th style="width:24px;padding-right:0;"><input type="checkbox" id="finExpSelectAll" ${allSelected ? 'checked' : ''} onchange="toggleExpSelectAll(this.checked)" title="Select all (filtered)"></th>
        <th>USD</th><th>Local</th><th>Description</th><th>Category</th><th>Place</th><th>Date</th><th>Group</th><th></th>
    </tr></thead><tbody>`;
    let totalUSD = 0;
    const totalsByCcy = {};
    for (const e of entries) {
        const usd = parseFloat(e.price) || 0;
        const localAmt = parseFloat(e.localAmount) || 0;
        const localCcy = e.localCurrency || 'IDR';
        const group = (e.groupTag || '').trim();
        const checked = expSelectedIds.has(e.id) ? 'checked' : '';
        totalUSD += usd;
        if (localAmt) totalsByCcy[localCcy] = (totalsByCcy[localCcy] || 0) + localAmt;
        html += `<tr id="fin-row-${e.id}">
            <td style="padding-right:0;"><input type="checkbox" ${checked} onchange="toggleExpSelect('${e.id}', this.checked)"></td>
            <td style="font-weight:600;color:var(--red);">-$${usd.toFixed(2)}</td>
            <td style="font-size:12px;color:var(--gray-500);">${localAmt ? fmtLocal(localAmt, localCcy) : '—'}</td>
            <td>${esc(e.product)}</td>
            <td><span style="padding:2px 8px;border-radius:4px;font-size:11px;background:var(--gray-100);color:var(--gray-600);">${esc(e.category||'—')}</span></td>
            <td>${esc(e.company||'—')}</td><td>${esc(e.date||'—')}</td>
            <td>${group ? `<span style="padding:2px 8px;border-radius:10px;font-size:11px;background:#eef2ff;color:#4338ca;cursor:pointer;" onclick="setExpGroup('${esc(group)}')" title="Filter to this group">${esc(group)}</span>` : '<span style="color:var(--gray-300);font-size:11px;">—</span>'}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineEditExp('${e.id}')">Edit</button>
                <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteFinance('${e.id}','${esc(e.product)}')">Del</button>
            </td></tr>`;
    }
    const localTotalText = Object.entries(totalsByCcy).map(([c, n]) => fmtLocal(n, c)).join(' · ') || '—';
    html += `</tbody><tfoot><tr style="background:var(--gray-50);font-weight:700;">
        <td></td>
        <td style="color:var(--red);">-$${totalUSD.toFixed(2)}</td>
        <td style="font-size:12px;color:var(--gray-500);font-weight:600;">${localTotalText}</td>
        <td colspan="6" style="font-size:12px;color:var(--gray-500);font-weight:600;">Total · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</td>
    </tr></tfoot></table>`;
    return html;
}

function inlineEditExp(id) {
    const entry = financeEntries.find(e => e.id === id);
    if (!entry) return;
    const is = 'style="padding:4px 6px;font-size:12px;width:100%;border:1px solid var(--gray-300);border-radius:4px;"';
    const row = document.getElementById('fin-row-' + id);
    if (!row) return;
    const catOpts = EXP_CATS.map(c => `<option value="${c}" ${c === (entry.category||'other') ? 'selected' : ''}>${c}</option>`).join('');
    const isRecurring = !!entry.frequency;
    const freqOpts = ['monthly','weekly','yearly'].map(f => `<option value="${f}" ${f === entry.frequency ? 'selected' : ''}>${f}</option>`).join('');
    row.innerHTML = `
        <td><input type="number" step="0.01" value="${parseFloat(entry.price)||''}" id="ie-price-${id}" ${is}></td>
        <td><input type="number" step="${(CURRENCIES[entry.localCurrency || 'IDR'] || CURRENCIES.IDR).step}" value="${parseFloat(entry.localAmount)||''}" id="ie-local-${id}" ${is} title="${esc(entry.localCurrency || 'IDR')}"></td>
        <td><input type="text" value="${esc(entry.product)}" id="ie-product-${id}" ${is}></td>
        <td><select id="ie-cat-${id}" ${is}>${catOpts}</select></td>
        ${isRecurring
            ? `<td><select id="ie-freq-${id}" ${is}>${freqOpts}</select></td>
               <td><input type="text" value="${esc(entry.recurringDate||'')}" placeholder="e.g. 2nd" id="ie-recdate-${id}" ${is}></td>`
            : `<td><input type="text" value="${esc(entry.company||'')}" id="ie-company-${id}" ${is}></td>
               <td><input type="date" value="${entry.date||''}" id="ie-date-${id}" ${is}></td>`}
        <td style="white-space:nowrap;">
            <button class="btn btn-primary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineSaveExp('${id}')">Save</button>
            <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="renderFinances()">Cancel</button>
        </td>`;
}

async function inlineSaveExp(id) {
    const entry = financeEntries.find(e => e.id === id);
    const isRecurring = entry && !!entry.frequency;
    const payload = {
        id, kind: 'expense',
        price: document.getElementById('ie-price-' + id).value,
        product: document.getElementById('ie-product-' + id).value.trim(),
        category: document.getElementById('ie-cat-' + id).value,
        localAmount: document.getElementById('ie-local-' + id).value,
        localCurrency: entry?.localCurrency || 'IDR',
        groupTag: entry?.groupTag || '',
    };
    if (isRecurring) {
        payload.frequency = document.getElementById('ie-freq-' + id).value;
        payload.recurringDate = document.getElementById('ie-recdate-' + id).value.trim();
        payload.company = entry.company || '';
        payload.date = '';
    } else {
        payload.company = document.getElementById('ie-company-' + id).value.trim();
        payload.date = document.getElementById('ie-date-' + id).value;
        payload.frequency = '';
        payload.recurringDate = '';
    }
    if (!payload.product) { showToast('Description is required.', 'error'); return; }
    try {
        await apiFetch('/api/finances', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Updated.', 'success');
        await loadFinances();
    } catch (e) {}
}

const INC_CATS = ['salary','freelance','consulting','royalties','investments','other'];

function buildIncomeTable(entries) {
    if (entries.length === 0) return '<div class="empty-state"><p>No income matches your filters.</p></div>';
    let html = '<table><thead><tr><th>Amount</th><th>Source</th><th>Category</th><th>Company</th><th>Date</th><th></th></tr></thead><tbody>';
    for (const e of entries) {
        html += `<tr id="fin-row-${e.id}">
            <td style="font-weight:600;color:var(--green);">+$${(parseFloat(e.price)||0).toFixed(2)}</td>
            <td>${esc(e.product)}</td>
            <td><span style="padding:2px 8px;border-radius:4px;font-size:11px;background:var(--gray-100);color:var(--gray-600);">${esc(e.category||'—')}</span></td>
            <td>${esc(e.company||'—')}</td><td>${esc(e.date||'—')}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineEditInc('${e.id}')">Edit</button>
                <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteFinance('${e.id}','${esc(e.product)}')">Del</button>
            </td></tr>`;
    }
    return html + '</tbody></table>';
}

function inlineEditInc(id) {
    const entry = financeEntries.find(e => e.id === id);
    if (!entry) return;
    const is = 'style="padding:4px 6px;font-size:12px;width:100%;border:1px solid var(--gray-300);border-radius:4px;"';
    const row = document.getElementById('fin-row-' + id);
    if (!row) return;
    const catOpts = INC_CATS.map(c => `<option value="${c}" ${c === (entry.category||'other') ? 'selected' : ''}>${c}</option>`).join('');
    row.innerHTML = `
        <td><input type="number" step="0.01" value="${parseFloat(entry.price)||''}" id="ie-price-${id}" ${is}></td>
        <td><input type="text" value="${esc(entry.product)}" id="ie-product-${id}" ${is}></td>
        <td><select id="ie-cat-${id}" ${is}>${catOpts}</select></td>
        <td><input type="text" value="${esc(entry.company||'')}" id="ie-company-${id}" ${is}></td>
        <td><input type="date" value="${entry.date||''}" id="ie-date-${id}" ${is}></td>
        <td style="white-space:nowrap;">
            <button class="btn btn-primary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineSaveInc('${id}')">Save</button>
            <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="renderFinances()">Cancel</button>
        </td>`;
}

async function inlineSaveInc(id) {
    const payload = {
        id, kind: 'income',
        price: document.getElementById('ie-price-' + id).value,
        product: document.getElementById('ie-product-' + id).value.trim(),
        category: document.getElementById('ie-cat-' + id).value,
        company: document.getElementById('ie-company-' + id).value.trim(),
        date: document.getElementById('ie-date-' + id).value,
    };
    if (!payload.product) { showToast('Source is required.', 'error'); return; }
    try {
        await apiFetch('/api/finances', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Updated.', 'success');
        await loadFinances();
    } catch (e) {}
}

// Note: esc() is defined in guru-core.js and available globally

// ---- Analysis ----
const CHART_COLORS = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#06b6d4','#e11d48'];

function renderAnalysis() {
    const container = document.getElementById('finAnalysisContent');
    const monthFilter = document.getElementById('finAnalysisMonth')?.value || '';
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const exp = financeEntries.filter(e => e.kind === 'expense' && (!monthFilter || (e.date || '').startsWith(monthFilter)));
    const inc = financeEntries.filter(e => e.kind === 'income' && (!monthFilter || (e.date || '').startsWith(monthFilter)));
    const biz = financeEntries.filter(e => (e.kind || 'business') === 'business');

    const expTotal = exp.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const incTotal = inc.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const bizAnnual = biz.filter(e => e.frequency !== 'yearly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0) * 12
                    + biz.filter(e => e.frequency === 'yearly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);

    if (exp.length === 0 && inc.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No data for the selected period.</p></div>';
        return;
    }

    // Category breakdown for expenses
    const expByCat = {};
    for (const e of exp) {
        const cat = e.category || 'other';
        expByCat[cat] = (expByCat[cat] || 0) + (parseFloat(e.price) || 0);
    }
    const expCatEntries = Object.entries(expByCat).sort((a, b) => b[1] - a[1]);

    // Category breakdown for income
    const incByCat = {};
    for (const e of inc) {
        const cat = e.category || 'other';
        incByCat[cat] = (incByCat[cat] || 0) + (parseFloat(e.price) || 0);
    }
    const incCatEntries = Object.entries(incByCat).sort((a, b) => b[1] - a[1]);

    // Top vendors
    const expByVendor = {};
    for (const e of exp) {
        const v = (e.company || 'Unknown').toLowerCase();
        expByVendor[v] = (expByVendor[v] || 0) + (parseFloat(e.price) || 0);
    }
    const topVendors = Object.entries(expByVendor).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Daily spending for selected month
    const dailySpend = {};
    for (const e of exp) {
        const d = e.date || '';
        dailySpend[d] = (dailySpend[d] || 0) + (parseFloat(e.price) || 0);
    }
    const dailyEntries = Object.entries(dailySpend).sort((a, b) => a[0].localeCompare(b[0]));
    const maxDaily = Math.max(...dailyEntries.map(d => d[1]), 1);

    let html = '';

    // Summary row
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">';
    html += `<div class="stat-card" style="border-left:4px solid var(--red);"><div class="label">Total Expenses</div><div class="value">$${expTotal.toFixed(2)}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--green);"><div class="label">Total Income</div><div class="value">$${incTotal.toFixed(2)}</div></div>`;
    const net = incTotal - expTotal;
    const netColor = net >= 0 ? 'var(--green)' : 'var(--red)';
    html += `<div class="stat-card" style="border-left:4px solid ${netColor};"><div class="label">Net</div><div class="value" style="color:${netColor};">${net >= 0 ? '+' : ''}$${net.toFixed(2)}</div></div>`;
    html += '</div>';

    // Expense category chart
    if (expCatEntries.length > 0) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Expense Categories</h3>';
        html += '<div style="display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap;">';
        // Bar chart
        html += '<div style="flex:1;min-width:300px;">';
        for (let i = 0; i < expCatEntries.length; i++) {
            const [cat, amount] = expCatEntries[i];
            const pct = expTotal > 0 ? (amount / expTotal * 100) : 0;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            html += `<div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;">
                    <span style="text-transform:capitalize;">${esc(cat)}</span>
                    <span style="color:var(--gray-500);">$${amount.toFixed(2)} (${pct.toFixed(1)}%)</span>
                </div>
                <div style="height:20px;background:var(--gray-100);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
                </div>
            </div>`;
        }
        html += '</div>';
        // Donut legend
        html += '<div style="min-width:160px;">';
        for (let i = 0; i < expCatEntries.length; i++) {
            const [cat, amount] = expCatEntries[i];
            const pct = expTotal > 0 ? (amount / expTotal * 100) : 0;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;">
                <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0;"></div>
                <span style="text-transform:capitalize;">${esc(cat)}</span>
                <span style="color:var(--gray-400);margin-left:auto;">${pct.toFixed(0)}%</span>
            </div>`;
        }
        html += '</div></div>';
    }

    // Daily spending bar chart
    if (dailyEntries.length > 1) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Daily Spending</h3>';
        html += '<div style="display:flex;align-items:end;gap:2px;height:120px;margin-bottom:4px;padding:0 4px;">';
        for (const [day, amount] of dailyEntries) {
            const h = Math.max((amount / maxDaily) * 100, 2);
            html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;" title="$${amount.toFixed(2)} on ${day}">
                <div style="width:100%;max-width:32px;height:${h}%;background:var(--red);border-radius:3px 3px 0 0;opacity:0.8;"></div>
            </div>`;
        }
        html += '</div>';
        html += '<div style="display:flex;gap:2px;padding:0 4px;margin-bottom:24px;">';
        for (const [day] of dailyEntries) {
            html += `<div style="flex:1;text-align:center;font-size:9px;color:var(--gray-400);">${day.slice(8)}</div>`;
        }
        html += '</div>';
    }

    // Top vendors
    if (topVendors.length > 0) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Top Places/Vendors</h3>';
        html += '<table><thead><tr><th>#</th><th>Place</th><th>Total</th><th>%</th></tr></thead><tbody>';
        topVendors.forEach(([vendor, amount], i) => {
            const pct = expTotal > 0 ? (amount / expTotal * 100) : 0;
            html += `<tr><td>${i + 1}</td><td style="text-transform:capitalize;">${esc(vendor)}</td><td style="font-weight:600;">$${amount.toFixed(2)}</td><td>${pct.toFixed(1)}%</td></tr>`;
        });
        html += '</tbody></table>';
        html += '<div style="margin-bottom:24px;"></div>';
    }

    // Income categories
    if (incCatEntries.length > 0) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Income Categories</h3>';
        html += '<div style="min-width:300px;margin-bottom:24px;">';
        for (let i = 0; i < incCatEntries.length; i++) {
            const [cat, amount] = incCatEntries[i];
            const pct = incTotal > 0 ? (amount / incTotal * 100) : 0;
            const color = CHART_COLORS[(i + 4) % CHART_COLORS.length];
            html += `<div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;">
                    <span style="text-transform:capitalize;">${esc(cat)}</span>
                    <span style="color:var(--gray-500);">$${amount.toFixed(2)} (${pct.toFixed(1)}%)</span>
                </div>
                <div style="height:20px;background:var(--gray-100);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
                </div>
            </div>`;
        }
        html += '</div>';
    }

    // Monthly spending trend (all months, not filtered)
    const allExp = financeEntries.filter(e => e.kind === 'expense' && (!e.frequency || e.frequency === '' || e.frequency === 'one-time'));
    const allInc = financeEntries.filter(e => e.kind === 'income');
    const monthlyExp = {}, monthlyInc = {};
    for (const e of allExp) { const m = (e.date || '').slice(0, 7); if (m) monthlyExp[m] = (monthlyExp[m] || 0) + (parseFloat(e.price) || 0); }
    for (const e of allInc) { const m = (e.date || '').slice(0, 7); if (m) monthlyInc[m] = (monthlyInc[m] || 0) + (parseFloat(e.price) || 0); }
    const allMonths = [...new Set([...Object.keys(monthlyExp), ...Object.keys(monthlyInc)])].sort();
    if (allMonths.length >= 2) {
        const W = 600, H = 200, PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 40;
        const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
        const maxVal = Math.max(...allMonths.map(m => Math.max(monthlyExp[m] || 0, monthlyInc[m] || 0)), 1);
        const xStep = allMonths.length > 1 ? plotW / (allMonths.length - 1) : plotW / 2;

        function makePath(data, color) {
            const pts = allMonths.map((m, i) => {
                const x = PAD_L + i * xStep;
                const y = PAD_T + plotH - ((data[m] || 0) / maxVal) * plotH;
                return { x, y, m, val: data[m] || 0 };
            });
            const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
            let svg = `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
            for (const p of pts) {
                svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
                svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1) - 8}" text-anchor="middle" font-size="9" font-weight="600" fill="${color}">$${p.val.toFixed(0)}</text>`;
            }
            return svg;
        }

        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Monthly Trends</h3>';
        html += `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:220px;margin-bottom:24px;" preserveAspectRatio="xMidYMid meet">`;
        // Grid lines
        for (let i = 0; i <= 4; i++) {
            const y = PAD_T + (plotH / 4) * i;
            const val = maxVal - (maxVal / 4) * i;
            html += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--gray-200)" stroke-width="0.5"/>`;
            html += `<text x="${PAD_L - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--gray-400)">$${val.toFixed(0)}</text>`;
        }
        // Month labels
        allMonths.forEach((m, i) => {
            const x = PAD_L + i * xStep;
            const label = monthNames[parseInt(m.slice(5)) - 1] + ' ' + m.slice(2, 4);
            html += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--gray-400)">${label}</text>`;
        });
        html += makePath(monthlyExp, '#ef4444');
        html += makePath(monthlyInc, '#10b981');
        html += '</svg>';
        html += '<div style="display:flex;gap:16px;font-size:12px;color:var(--gray-500);margin-bottom:24px;">';
        html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:3px;background:#ef4444;border-radius:2px;"></span> Expenses</span>';
        html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:3px;background:#10b981;border-radius:2px;"></span> Income</span>';
        html += '</div>';
    }

    // Recurring cost context
    const personalRecurring = financeEntries.filter(e => e.kind === 'expense' && (e.frequency === 'monthly' || e.frequency === 'yearly'));
    const persRecMonthly = personalRecurring.filter(e => e.frequency === 'monthly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const persRecYearly = personalRecurring.filter(e => e.frequency === 'yearly').reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const persRecAnnual = persRecMonthly * 12 + persRecYearly;
    if (bizAnnual > 0 || persRecAnnual > 0) {
        html += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:16px;font-size:13px;color:var(--gray-600);">';
        if (bizAnnual > 0) html += `<div><strong>Business overhead:</strong> $${bizAnnual.toFixed(2)}/year ($${(bizAnnual / 12).toFixed(2)}/month)</div>`;
        if (persRecAnnual > 0) html += `<div${bizAnnual > 0 ? ' style="margin-top:6px;"' : ''}><strong>Personal recurring:</strong> $${persRecAnnual.toFixed(2)}/year ($${(persRecAnnual / 12).toFixed(2)}/month)</div>`;
        html += '</div>';
    }

    container.innerHTML = html;
}

async function saveFinance(kind) {
    const payload = { kind };
    if (kind === 'business') {
        const product = document.getElementById('finBizProduct').value.trim();
        if (!product) { showToast('Product name is required.', 'error'); return; }
        const freq = document.getElementById('finBizFrequency').value;
        if (freq === 'one-time') {
            // Save as expense with category=business so it shows in One-Time section
            payload.kind = 'expense';
            payload.price = document.getElementById('finBizPrice').value;
            payload.product = product;
            payload.company = document.getElementById('finBizCompany').value.trim();
            payload.category = 'business';
            payload.date = document.getElementById('finBizDate').value;
        } else {
            payload.price = document.getElementById('finBizPrice').value;
            payload.product = product;
            payload.company = document.getElementById('finBizCompany').value.trim();
            payload.businessUseCase = document.getElementById('finBizUseCase').value.trim();
            payload.frequency = freq;
            payload.recurringDate = document.getElementById('finBizRecurringDate').value.trim();
        }
    } else if (kind === 'expense') {
        const desc = document.getElementById('finExpDesc').value.trim();
        if (!desc) { showToast('Description is required.', 'error'); return; }
        payload.price = document.getElementById('finExpAmount').value;
        payload.product = desc;
        payload.category = document.getElementById('finExpCategory').value;
        payload.company = document.getElementById('finExpCompany').value.trim();
        const isRecurring = document.getElementById('finExpRecurring')?.checked;
        if (isRecurring) {
            payload.frequency = document.getElementById('finExpFrequency').value;
            payload.recurringDate = (document.getElementById('finExpRecurringDate').value || '').trim();
            payload.date = '';
        } else {
            payload.frequency = '';
            payload.date = document.getElementById('finExpDate').value;
        }
        payload.localAmount = document.getElementById('finExpLocal').value;
        payload.localCurrency = activeCurrency;
        payload.groupTag = (document.getElementById('finExpGroup')?.value || '').trim();
    } else {
        const src = document.getElementById('finIncSource').value.trim();
        if (!src) { showToast('Source is required.', 'error'); return; }
        payload.price = document.getElementById('finIncAmount').value;
        payload.product = src;
        payload.category = document.getElementById('finIncCategory').value;
        payload.company = document.getElementById('finIncCompany').value.trim();
        payload.date = document.getElementById('finIncDate').value;
    }
    if (editingFinanceId) payload.id = editingFinanceId;

    try {
        await apiFetch('/api/finances', { method: 'POST', body: JSON.stringify(payload) });
        showToast(editingFinanceId ? 'Entry updated.' : 'Entry added.', 'success');
        clearFinanceForm(kind);
        await loadFinances();
    } catch (e) {}
}

// editFinance is handled inline per table type (inlineEditBiz, inlineEditExp, inlineEditInc)

function clearFinanceForm(kind) {
    editingFinanceId = null;
    if (kind === 'business' || !kind) {
        ['finBizPrice','finBizProduct','finBizCompany','finBizUseCase','finBizRecurringDate','finBizDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('finBizFrequency'); if (sel) sel.value = 'monthly';
        toggleBizFrequency();
        const btn = document.querySelector('.fin-save-btn[data-kind="business"]'); if (btn) btn.textContent = 'Add';
    }
    if (kind === 'expense' || !kind) {
        ['finExpAmount','finExpLocal','finExpDesc','finExpCompany','finExpDate','finExpGroup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('finExpCategory'); if (sel) sel.value = 'groceries';
        const recCb = document.getElementById('finExpRecurring'); if (recCb) recCb.checked = false;
        toggleExpRecurring();
        const btn = document.querySelector('.fin-save-btn[data-kind="expense"]'); if (btn) btn.textContent = 'Add';
    }
    if (kind === 'income' || !kind) {
        ['finIncAmount','finIncSource','finIncCompany','finIncDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('finIncCategory'); if (sel) sel.value = 'salary';
        const btn = document.querySelector('.fin-save-btn[data-kind="income"]'); if (btn) btn.textContent = 'Add';
    }
}

function deleteFinance(id, name) {
    pendingConfirmAction = async () => {
        try {
            await apiFetch('/api/finances', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Deleted "' + name + '".', 'success');
            await loadFinances();
        } catch (e) {}
    };
    document.getElementById('modalTitle').textContent = 'Delete Entry';
    document.getElementById('modalMessage').textContent = `Delete "${name}"? This cannot be undone.`;
    document.getElementById('confirmModal').classList.add('active');
}
