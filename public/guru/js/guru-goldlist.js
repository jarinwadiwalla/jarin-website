/* ==========================================================================
   Guru Dashboard — Gold List Module
   Gold list CRUD, review system, phrase book, quiz engine, review email
   ========================================================================== */

/* Part of Speech multi-select helpers */
function getPOSValues() {
    const boxes = document.querySelectorAll('#glEntryPOSWrap input[type="checkbox"]');
    return Array.from(boxes).filter(cb => cb.checked).map(cb => cb.value).join(', ');
}
function setPOSValues(str) {
    const vals = (str || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const boxes = document.querySelectorAll('#glEntryPOSWrap input[type="checkbox"]');
    boxes.forEach(cb => { cb.checked = vals.includes(cb.value); });
    updatePOSLabel();
}
function clearPOSValues() {
    document.querySelectorAll('#glEntryPOSWrap input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updatePOSLabel();
}
function updatePOSLabel() {
    const text = getPOSValues();
    const label = document.querySelector('#glEntryPOSWrap .gl-multiselect-text');
    if (label) label.textContent = text || 'Not set';
}
function togglePOSDropdown() {
    const dd = document.getElementById('glPOSDropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
// Update label on checkbox change & close on outside click
document.addEventListener('change', function(e) {
    if (e.target.closest('#glEntryPOSWrap')) updatePOSLabel();
});
document.addEventListener('click', function(e) {
    const wrap = document.getElementById('glEntryPOSWrap');
    const dd = document.getElementById('glPOSDropdown');
    if (wrap && dd && !wrap.contains(e.target)) dd.style.display = 'none';
});

function toggleGlField(field) {
    const toggleIds = { rom: 'glToggleRom', audio: 'glToggleAudio', cat: 'glToggleCat', lang: 'glToggleLang' };
    const on = document.getElementById(toggleIds[field]).checked;
    document.querySelectorAll('.gl-field-' + field).forEach(el => el.style.display = on ? '' : 'none');
    localStorage.setItem('gl-show-' + field, on ? '1' : '0');
}
(function initGlToggles() {
    ['rom', 'audio', 'cat', 'lang'].forEach(field => {
        const toggleIds = { rom: 'glToggleRom', audio: 'glToggleAudio', cat: 'glToggleCat', lang: 'glToggleLang' };
        const on = localStorage.getItem('gl-show-' + field) === '1';
        const cb = document.getElementById(toggleIds[field]);
        if (cb) { cb.checked = on; if (on) document.querySelectorAll('.gl-field-' + field).forEach(el => el.style.display = ''); }
    });
})();

// Sticky language for the Single Entry form. The dropdown was hard-resetting
// to 'indonesian' on every save/clear, forcing the user to re-pick their
// working language for each successive word. Now it remembers the last
// user-picked language across saves, clears, and reloads.
const GL_LAST_LANG_KEY = 'gl-last-entry-language';
function _glDefaultLang() { return localStorage.getItem(GL_LAST_LANG_KEY) || 'indonesian'; }
function _glRememberLang(lang) { if (lang) localStorage.setItem(GL_LAST_LANG_KEY, lang); }
(function initGlLastLang() {
    const sel = document.getElementById('glEntryLang');
    if (!sel) return;
    const saved = localStorage.getItem(GL_LAST_LANG_KEY);
    if (saved) sel.value = saved;
    // Programmatic `.value = ...` (e.g. from editGoldListEntry) does not fire
    // 'change', so this only captures explicit user picks — exactly what we
    // want to persist.
    sel.addEventListener('change', () => _glRememberLang(sel.value));
})();
function getReviewIntervalDays(distillation) {
    const intervals = [14, 14, 21, 28, 42];
    return intervals[Math.min(distillation || 0, intervals.length - 1)];
}

// Day bucket using midnight local time as the day boundary.
// Returns the integer "day number" since epoch for the current calendar day.
function reviewDayBucket(timestamp) {
    const d = new Date(timestamp);
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}
let glAllEntries = [];
let currentGlEntryId = null;
let _lastAddedToday = 0;

function checkGoldListHabitAutoComplete() {
    if (_lastAddedToday >= glDailyGoal && habits.length) {
        const glHabit = habits.find(h => {
            if (h.status !== 'active' || !h.name || isHabitDone(h)) return false;
            const n = h.name.toLowerCase();
            return n.includes('gold list') || n.includes('goldlist') || n.includes('gold-list');
        });
        if (glHabit) {
            toggleHabit(glHabit.id, false);
        }
    }
}

function switchGlMode(mode) {
    document.querySelectorAll('.gl-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.gl-mode-btn[data-mode="${mode}"]`).classList.add('active');
    document.querySelectorAll('.gl-panel').forEach(p => p.style.display = 'none');
    document.getElementById(`glPanel-${mode}`).style.display = 'block';
}

// Capitalize the first letter of a language string ("persian" → "Persian").
// Tiny helper used by the breakdown line + language picker buttons.
function _glCap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

async function loadGoldList() {
    try {
        const langEl = document.getElementById('glFilterLang');
        const langFilter = langEl ? langEl.value : '';
        // Compute midnight local day boundary so the server can count today's entries
        const now6 = new Date();
        const dayStartMs = new Date(now6.getFullYear(), now6.getMonth(), now6.getDate(), 0, 0, 0, 0).getTime();
        // tzOffset = minutes ahead of UTC (e.g. Bali UTC+8 = 480). JS getTimezoneOffset() returns inverted sign.
        const tzOffset = -new Date().getTimezoneOffset();
        const params = [`dayStart=${dayStartMs}`, `tzOffset=${tzOffset}`];
        if (langFilter) params.push(`language=${langFilter}`);
        const url = `/api/goldlist?${params.join('&')}`;
        const data = await apiFetch(url);
        glAllEntries = data.entries || [];
        const stats = data.stats || {};

        document.getElementById('glTotalCount').textContent = stats.total || 0;
        document.getElementById('glLearnedCount').textContent = stats.learned || 0;

        // Compute reviewable count client-side so badge always matches group display
        const clientReviewable = glAllEntries.filter(e => isEntryReviewable(e)).length;
        const reviewableCount = Math.max(stats.reviewable || 0, clientReviewable);
        document.getElementById('glReviewableCount').textContent = reviewableCount;

        // Green highlight on "Ready to Review" card when words are due
        const reviewCard = document.getElementById('glReviewableCount').closest('.stat-card');
        if (reviewCard) {
            if (reviewableCount > 0) {
                reviewCard.classList.add('gl-review-active');
            } else {
                reviewCard.classList.remove('gl-review-active');
            }
        }

        // Per-language breakdown under the count. Computed client-side from
        // glAllEntries (always-current local cache) — survives offline sync
        // races where the server count momentarily lags. The server also
        // returns stats.reviewableByLanguage but we don't need it for the UI.
        const breakdown = {};
        for (const e of glAllEntries) {
            if (!isEntryReviewable(e)) continue;
            const lang = e.language || 'unknown';
            breakdown[lang] = (breakdown[lang] || 0) + 1;
        }
        const breakdownEl = document.getElementById('glReviewableBreakdown');
        if (breakdownEl) {
            const entries = Object.entries(breakdown).filter(([, n]) => n > 0);
            if (entries.length === 0) {
                breakdownEl.textContent = 'tap to start review';
            } else if (entries.length === 1) {
                const [lang, n] = entries[0];
                breakdownEl.textContent = `${n} ${_glCap(lang)} · tap to review`;
            } else {
                breakdownEl.textContent = entries
                    .sort((a, b) => b[1] - a[1])
                    .map(([lang, n]) => `${n} ${_glCap(lang)}`)
                    .join(' · ');
            }
        }

        // Daily words: count down from 10 based on words added today (resets at midnight local)
        // Use server/offline stats when available, but also count from local entries as fallback
        // (IDB may only have a language-filtered subset, so take the max of both counts)
        const clientAddedToday = glAllEntries.filter(e => {
            const ct = new Date(e.createdAt).getTime();
            return ct >= dayStartMs;
        }).length;
        const addedToday = Math.max(stats.addedToday || 0, clientAddedToday);
        const dailyRemaining = Math.max(0, glDailyGoal - addedToday);
        document.getElementById('glDailyCount').textContent = dailyRemaining;

        // Auto-complete the Gold List habit when 10 words are added
        _lastAddedToday = addedToday;
        checkGoldListHabitAutoComplete();

        renderGoldListGroups(glAllEntries.filter(e => !e.learned));
        renderLearnedWords(glAllEntries.filter(e => e.learned));
        renderPhraseBook(glAllEntries.filter(e => e.type === 'phrase' || e.type === 'idiom'));
    } catch (e) {
        // Retry once after a short delay (handles race with offline-first sync)
        if (!loadGoldList._retrying) {
            loadGoldList._retrying = true;
            setTimeout(() => { loadGoldList._retrying = false; loadGoldList(); }, 1000);
        } else {
            loadGoldList._retrying = false;
            document.getElementById('glGroups').innerHTML = '<div class="empty-state"><p>Could not load gold list.</p></div>';
        }
    }
}

function groupByListAndDistillation(entries) {
    const groups = {};
    for (const e of entries) {
        const key = `${e.listId}|D${e.distillation}`;
        if (!groups[key]) groups[key] = { listId: e.listId, distillation: e.distillation, language: e.language, entries: [] };
        groups[key].entries.push(e);
    }
    return Object.values(groups).sort((a, b) => {
        const aReady = isGroupReady(a.entries);
        const bReady = isGroupReady(b.entries);
        if (aReady !== bReady) return aReady ? -1 : 1;
        return new Date(b.entries[0].createdAt) - new Date(a.entries[0].createdAt);
    });
}

function isGroupReady(entries) {
    const todayBucket = reviewDayBucket(Date.now());
    const dist = entries[0]?.distillation || 0;
    const intervalDays = getReviewIntervalDays(dist);
    const latestBucket = entries.reduce((latest, e) => {
        const b = reviewDayBucket(e.lastReviewedAt || e.createdAt);
        return b > latest ? b : latest;
    }, 0);
    return (todayBucket - latestBucket) >= intervalDays;
}

function daysUntilReview(entries) {
    const todayBucket = reviewDayBucket(Date.now());
    const dist = entries[0]?.distillation || 0;
    const intervalDays = getReviewIntervalDays(dist);
    const latestBucket = entries.reduce((latest, e) => {
        const b = reviewDayBucket(e.lastReviewedAt || e.createdAt);
        return b > latest ? b : latest;
    }, 0);
    return Math.max(0, intervalDays - (todayBucket - latestBucket));
}

function isEntryReviewable(entry) {
    if (entry.learned) return false;
    const refBucket = reviewDayBucket(entry.lastReviewedAt || entry.createdAt);
    const todayBucket = reviewDayBucket(Date.now());
    const intervalDays = getReviewIntervalDays(entry.distillation);
    return (todayBucket - refBucket) >= intervalDays;
}

function filterGoldListWords() {
    const query = (document.getElementById('glSearchInput')?.value || '').trim().toLowerCase();
    const resultsEl = document.getElementById('glSearchResults');

    if (!query || query.length < 2) {
        resultsEl.style.display = 'none';
        // Show all word list groups
        document.getElementById('glGroups').style.display = '';
        return;
    }

    const matches = glAllEntries.filter(e =>
        (e.word || '').toLowerCase().includes(query) ||
        (e.translation || '').toLowerCase().includes(query) ||
        (e.romanization || '').toLowerCase().includes(query) ||
        (e.notes || '').toLowerCase().includes(query)
    );

    // Hide word list groups while searching
    document.getElementById('glGroups').style.display = 'none';
    resultsEl.style.display = 'block';

    if (!matches.length) {
        resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);">No matches for "' + escapeHtml(query) + '"</div>';
        return;
    }

    resultsEl.innerHTML = '<div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">' + matches.length + ' result' + (matches.length !== 1 ? 's' : '') + '</div>' +
        matches.slice(0, 50).map(e => {
            const rom = e.romanization ? ' <span style="color:var(--gray-400);font-size:12px;">(' + escapeHtml(e.romanization) + ')</span>' : '';
            const langTag = '<span class="gl-lang-tag ' + (e.language || '') + '" style="font-size:10px;padding:2px 6px;">' + (e.language || '') + '</span>';
            const status = e.learned ? '<span style="color:var(--green);font-size:11px;font-weight:600;">Learned</span>' : '';
            const listLabel = e.listId ? '<span style="font-size:10px;color:var(--gray-400);background:var(--gray-100);padding:2px 6px;border-radius:4px;">' + escapeHtml(e.listId) + (e.distillation > 0 ? ' D' + e.distillation : '') + '</span>' : '';
            const detail = buildWordDetail(e);
            return '<div class="gl-word-row" style="flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--gray-100);">' +
                langTag +
                '<span style="font-weight:600;cursor:pointer;" onclick="this.closest(\'.gl-word-row\').classList.toggle(\'expanded\')">' + escapeHtml(e.word) + '</span>' + rom +
                glPlayBtnHtml(e.audioUrl) +
                '<span class="gl-translation hidden" onclick="this.classList.toggle(\'hidden\')">' + escapeHtml(e.translation || '') + '</span>' +
                '<span style="flex:1;"></span>' +
                listLabel +
                status +
                '<button style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--primary);margin-left:4px;" onclick="editGoldListEntry(\'' + e.id + '\')" title="Edit">&#9998;</button>' +
                detail +
            '</div>';
        }).join('') +
        (matches.length > 50 ? '<div style="padding:8px;text-align:center;color:var(--gray-400);font-size:12px;">...and ' + (matches.length - 50) + ' more</div>' : '');
}

function buildWordDetail(e) {
    const parts = [];
    if (e.examples && e.examples.length) {
        const exHtml = e.examples.map(ex =>
            `<div class="gl-detail-example"><p><strong>${escapeHtml(ex.sentence)}</strong></p>` +
            `<p>${escapeHtml(ex.translation)}</p>` +
            (ex.romanization ? `<p style="color:var(--gray-400);font-style:italic;">${escapeHtml(ex.romanization)}</p>` : '') +
            `</div>`
        ).join('');
        parts.push(`<section><div class="gl-detail-label">Examples</div>${exHtml}</section>`);
    }
    if (e.usageNotes) parts.push(`<section><div class="gl-detail-label">Usage</div><p>${escapeHtml(e.usageNotes)}</p></section>`);
    if (e.culturalNotes) parts.push(`<section><div class="gl-detail-label">Cultural</div><p style="font-style:italic;">${escapeHtml(e.culturalNotes)}</p></section>`);
    if (e.rootFamily) parts.push(`<section><div class="gl-detail-label">Root Family</div><p>${escapeHtml(e.rootFamily)}</p></section>`);
    if (e.audioUrl) parts.push(`<section><div class="gl-detail-label">Audio</div><audio controls src="${escapeHtml(e.audioUrl)}" style="height:28px;"></audio></section>`);
    if (e.selfRatings && e.selfRatings.length > 0) {
        const ratingColors = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#10b981' };
        const dots = e.selfRatings.slice(-10).map(r => {
            const color = ratingColors[r.rating] || '#9ca3af';
            const dir = r.direction === 'reverse' ? 'E\u2192W' : 'W\u2192E';
            const date = r.date ? new Date(r.date).toLocaleDateString() : '';
            return `<span class="gl-rating-dot" style="background:${color};" title="${r.rating}/5 (${dir}) ${date}"></span>`;
        }).join('');
        parts.push(`<section><div class="gl-detail-label">Self-Rating Trend</div><div class="gl-rating-trend">${dots}</div></section>`);
    }
    if (!parts.length) parts.push(`<section><p style="color:var(--gray-400);font-style:italic;">No additional details.</p></section>`);
    return `<div class="gl-word-detail">${parts.join('')}</div>`;
}

function renderGoldListGroups(active) {
    const container = document.getElementById('glGroups');
    if (!active.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128218;</div><p>No active word lists. Add a head list above!</p></div>';
        return;
    }

    const groups = groupByListAndDistillation(active);
    container.innerHTML = groups.map((g, idx) => {
        const ready = isGroupReady(g.entries);
        const days = daysUntilReview(g.entries);
        const langTag = `<span class="gl-lang-tag ${g.language}">${g.language}</span>`;
        const distLabel = g.distillation === 0 ? 'Head List' : `Distillation ${g.distillation}`;
        const statusHtml = ready
            ? `<span class="gl-status-ready">Ready to review &middot; ${distLabel}</span>`
            : `<span class="gl-status-waiting">${days} day${days!==1?'s':''} until review &middot; ${distLabel}</span>`;

        const wordRows = g.entries.map(e => {
            const rom = e.romanization ? `<span class="gl-romanization">${escapeHtml(e.romanization)}</span>` : '';
            const posParts = (e.partOfSpeech || '').split(',').map(s => s.trim()).filter(Boolean);
            const metaTags = [e.category, ...posParts, e.difficulty, e.formality].filter(Boolean).map(t =>
                `<span class="gl-meta-tag">${escapeHtml(t)}</span>`).join('');
            const detail = buildWordDetail(e);
            return `<div class="gl-word-row" style="flex-wrap:wrap;">
                <span class="gl-word" style="cursor:pointer;" onclick="this.closest('.gl-word-row').classList.toggle('expanded')">${escapeHtml(e.word)} ${rom}</span>
                ${glPlayBtnHtml(e.audioUrl)}
                <span class="gl-translation hidden" onclick="this.classList.toggle('hidden')">${escapeHtml(e.translation)}</span>
                <button style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--primary);" onclick="editGoldListEntry('${e.id}')" title="Edit">&#9998;</button>
                <button style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--gray-400);" onclick="deleteGoldListEntry('${e.id}')" title="Delete">&#128465;</button>
                ${metaTags ? `<div class="gl-meta-tags" style="width:100%;padding-left:0;">${metaTags}</div>` : ''}
                ${detail}
            </div>`;
        }).join('');

        const reviewBtn = ready
            ? `<div style="padding:12px 16px;border-top:1px solid var(--gray-100);"><button class="btn btn-primary btn-sm" onclick="startDistillationQuiz('${g.listId}', ${g.distillation})" style="background:#b8860b;border-color:#b8860b;">Start Review Quiz</button> <small style="color:var(--gray-500);">Flashcard-style recall test — rate each word, then confirm</small></div>`
            : '';

        return `<div class="gl-group gl-dist-${Math.min(g.distillation, 4)}${ready ? ' gl-ready' : ''}" id="gl-group-${idx}">
            <div class="gl-group-header" onclick="this.parentNode.classList.toggle('open')">
                <div>
                    <div class="gl-group-title">${langTag} ${escapeHtml(g.listId)} &middot; ${distLabel}</div>
                    <div class="gl-group-meta">${g.entries.length} word${g.entries.length!==1?'s':''}</div>
                </div>
                ${statusHtml}
            </div>
            <div class="gl-group-body">${wordRows}${reviewBtn}</div>
        </div>`;
    }).join('');
}

let _learnedData = [];

function renderLearnedWords(learned) {
    _learnedData = learned;
    const searchEl = document.getElementById('glLearnedSearch');
    if (searchEl) searchEl.value = '';
    renderLearnedFiltered(learned);
}

function filterLearnedWords() {
    const q = (document.getElementById('glLearnedSearch').value || '').toLowerCase().trim();
    const langFilter = (document.getElementById('glLearnedLang')?.value || '').trim();
    let filtered = _learnedData;
    if (langFilter) {
        filtered = filtered.filter((w) => (w.language || '') === langFilter);
    }
    if (q) {
        filtered = filtered.filter((w) => {
            const text = [w.word, w.translation, w.romanization, w.category, w.notes, w.language].join(' ').toLowerCase();
            return text.includes(q);
        });
    }
    renderLearnedFiltered(filtered);
}

function renderLearnedFiltered(learned) {
    const container = document.getElementById('glLearned');
    if (!learned.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127942;</div><p>No words learned yet. Keep studying!</p></div>';
        return;
    }

    const byLang = {};
    for (const e of learned) {
        if (!byLang[e.language]) byLang[e.language] = [];
        byLang[e.language].push(e);
    }

    container.innerHTML = Object.entries(byLang).map(([lang, words]) =>
        `<h3 style="margin:16px 0 8px;text-transform:capitalize;">${lang} <small style="color:var(--gray-400);font-weight:400;">(${words.length})</small></h3>
        <div class="gl-learned-list">${words.map(w => {
            const rom = w.romanization ? ` <span class="gl-romanization">(${escapeHtml(w.romanization)})</span>` : '';
            const posParts = (w.partOfSpeech || '').split(',').map(s => s.trim()).filter(Boolean);
            const cats = [w.category, ...posParts].filter(Boolean).map(t => `<span class="gl-meta-tag">${escapeHtml(t)}</span>`).join('');
            const detail = buildWordDetail(w);
            return `<div class="gl-word-row gl-learned-item" style="flex-wrap:wrap;">
                <span class="gl-word" style="cursor:pointer;" onclick="this.closest('.gl-word-row').classList.toggle('expanded')">${escapeHtml(w.word)}</span>${rom} — <span class="gl-translation hidden" onclick="this.classList.toggle('hidden')">${escapeHtml(w.translation)}</span>
                ${glPlayBtnHtml(w.audioUrl)}
                <span style="flex:1;"></span>
                <button style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--primary);" onclick="editGoldListEntry('${w.id}')" title="Edit">&#9998;</button>
                ${cats ? `<div class="gl-meta-tags" style="width:100%;">${cats}</div>` : ''}
                ${detail}
            </div>`;
        }).join('')}</div>`
    ).join('');
}

let _phraseBookData = [];

function renderPhraseBook(phrases) {
    _phraseBookData = phrases;
    const searchEl = document.getElementById('glPhraseSearch');
    if (searchEl) searchEl.value = '';
    renderPhraseBookFiltered(phrases);
}

function renderPhraseBookFiltered(phrases) {
    const container = document.getElementById('glPhrases');
    if (!phrases.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128172;</div><p>No phrases or idioms yet. Add entries with type "Phrase" or "Idiom".</p></div>';
        return;
    }

    container.innerHTML = phrases.map(p => {
        const rom = p.romanization ? `<p class="gl-romanization">${escapeHtml(p.romanization)}</p>` : '';
        const exHtml = (p.examples || []).length > 0
            ? `<div class="gl-phrase-examples">${p.examples.map(ex =>
                `<p><strong>${escapeHtml(ex.sentence)}</strong></p><p style="color:var(--gray-500);">${escapeHtml(ex.translation)}</p>`
            ).join('')}</div>` : '';
        const badges = [p.language, p.type, p.formality].filter(Boolean).map(t => `<span class="gl-meta-tag">${escapeHtml(t)}</span>`).join(' ');
        const notes = p.usageNotes ? `<p style="font-size:13px;color:var(--gray-600);margin-top:6px;">${escapeHtml(p.usageNotes)}</p>` : '';
        const cultural = p.culturalNotes ? `<p style="font-size:13px;color:var(--gray-500);font-style:italic;margin-top:4px;">${escapeHtml(p.culturalNotes)}</p>` : '';
        return `<div class="gl-phrase-card">
            <div class="gl-phrase-header" onclick="this.parentNode.classList.toggle('expanded')">
                <span class="gl-phrase-chevron">&#9654;</span>
                <div class="gl-phrase-title"><h4>${escapeHtml(p.word)}</h4></div>
                <div class="gl-phrase-badges">${badges}</div>
                ${glPlayBtnHtml(p.audioUrl)}
                <button class="gl-phrase-edit" onclick="event.stopPropagation();editGoldListEntry('${p.id}')" title="Edit">&#9998;</button>
            </div>
            <div class="gl-phrase-detail">
                <p style="color:var(--gray-600);">${escapeHtml(p.translation)}</p>
                ${rom}${notes}${cultural}${exHtml}
            </div>
        </div>`;
    }).join('');
}

function filterPhraseBook() {
    const q = (document.getElementById('glPhraseSearch').value || '').toLowerCase().trim();
    const langFilter = (document.getElementById('glPhraseLang')?.value || '').trim();
    let filtered = _phraseBookData;
    if (langFilter) {
        filtered = filtered.filter((p) => (p.language || '') === langFilter);
    }
    if (q) {
        filtered = filtered.filter((p) => {
            const text = [p.word, p.translation, p.romanization, p.usageNotes, p.culturalNotes, p.language].join(' ').toLowerCase();
            return text.includes(q);
        });
    }
    renderPhraseBookFiltered(filtered);
}

// --- Batch Add ---
async function addGoldListBatch() {
    const language = document.getElementById('glLanguage').value;
    const category = document.getElementById('glBatchCategory').value.trim();
    const difficulty = document.getElementById('glBatchDifficulty').value;
    const textarea = document.getElementById('glBatchInput');
    const lines = textarea.value.trim().split('\n').filter(l => l.trim());

    if (!lines.length) {
        showToast('Enter at least one word.', 'error');
        return;
    }

    const entries = lines.map(line => {
        const parts = line.split(/\s*[=\-–—]\s*/);
        const wordPart = (parts[0] || '').trim();
        const rest = (parts[1] || '').trim();
        // Support: word = translation | romanization
        const restParts = rest.split(/\s*\|\s*/);
        return {
            word: wordPart,
            translation: (restParts[0] || '').trim(),
            romanization: (restParts[1] || '').trim(),
            category: category,
            difficulty: difficulty
        };
    }).filter(e => e.word);

    if (!entries.length) {
        showToast('Could not parse any entries.', 'error');
        return;
    }

    try {
        await apiFetch('/api/goldlist', {
            method: 'POST',
            body: JSON.stringify({ batch: true, language, entries, localDate: new Date().toLocaleDateString('en-CA') })
        });
        showToast(`Added ${entries.length} words to head list!`, 'success');
        textarea.value = '';
        loadGoldList();
    } catch (e) {
        // Error shown by apiFetch
    }
}

// --- Single Entry CRUD ---
function addExampleRow(sentence, translation, romanization) {
    const container = document.getElementById('glExamples');
    const romVisible = document.getElementById('glToggleRom').checked;
    const row = document.createElement('div');
    row.className = 'gl-example-row';
    row.innerHTML = `<input type="text" placeholder="Sentence in target language" value="${escapeHtml(sentence || '')}">
        <input type="text" placeholder="English translation" value="${escapeHtml(translation || '')}">
        <input type="text" class="gl-field-rom" placeholder="Romanization" style="max-width:150px;${romVisible ? '' : 'display:none;'}" value="${escapeHtml(romanization || '')}">
        <button class="btn btn-danger btn-sm" onclick="this.parentNode.remove()">X</button>`;
    container.appendChild(row);
}

function clearGlEntry() {
    currentGlEntryId = null;
    document.getElementById('glEntryTitle').textContent = 'Add Single Entry';
    document.getElementById('glWord').value = '';
    document.getElementById('glTranslation').value = '';
    document.getElementById('glRomanization').value = '';
    document.getElementById('glEntryLang').value = _glDefaultLang();
    document.getElementById('glEntryCategory').value = '';
    document.getElementById('glEntryType').value = 'word';
    clearPOSValues();
    document.getElementById('glEntryDifficulty').value = '';
    document.getElementById('glEntryFormality').value = 'neutral';
    document.getElementById('glEntryAudio').value = '';
    document.getElementById('glEntryRoot').value = '';
    document.getElementById('glEntryRootLang').value = '';
    document.getElementById('glEntryUsage').value = '';
    document.getElementById('glEntryCultural').value = '';
    document.getElementById('glExamples').innerHTML = '';
    document.getElementById('glDeleteEntryBtn').style.display = 'none';
    glResetAudioUI();
}

function editGoldListEntry(id) {
    const entry = glAllEntries.find(e => e.id === id);
    if (!entry) return;
    currentGlEntryId = id;
    switchGlMode('single');
    document.getElementById('glEntryTitle').textContent = 'Edit: ' + (entry.word || 'Untitled');
    document.getElementById('glWord').value = entry.word || '';
    document.getElementById('glTranslation').value = entry.translation || '';
    document.getElementById('glRomanization').value = entry.romanization || '';
    document.getElementById('glEntryLang').value = entry.language || 'persian';
    document.getElementById('glEntryCategory').value = entry.category || '';
    document.getElementById('glEntryType').value = entry.type || 'word';
    setPOSValues(entry.partOfSpeech || '');
    document.getElementById('glEntryDifficulty').value = entry.difficulty || '';
    document.getElementById('glEntryFormality').value = entry.formality || '';
    document.getElementById('glEntryAudio').value = entry.audioUrl || '';
    glResetAudioUI();
    if (entry.audioUrl) glShowAudioPreview(entry.audioUrl);
    document.getElementById('glEntryRoot').value = entry.rootFamily || '';
    document.getElementById('glEntryRootLang').value = entry.rootLanguage || '';
    document.getElementById('glEntryUsage').value = entry.usageNotes || '';
    document.getElementById('glEntryCultural').value = entry.culturalNotes || '';
    document.getElementById('glExamples').innerHTML = '';
    (entry.examples || []).forEach(ex => addExampleRow(ex.sentence, ex.translation, ex.romanization));
    document.getElementById('glDeleteEntryBtn').style.display = 'inline-flex';
}

// Collect the current single-entry form into a data object. Shared by
// saveGoldListEntry() and the duplicate-detection flow so both paths
// serialize the form the same way.
function _glReadEntryForm() {
    const exampleRows = document.querySelectorAll('#glExamples .gl-example-row');
    const examples = Array.from(exampleRows).map(row => {
        const inputs = row.querySelectorAll('input');
        return { sentence: inputs[0].value.trim(), translation: inputs[1].value.trim(), romanization: inputs[2].value.trim() };
    }).filter(ex => ex.sentence);

    return {
        id: currentGlEntryId,
        word: document.getElementById('glWord').value.trim(),
        translation: document.getElementById('glTranslation').value.trim(),
        romanization: document.getElementById('glRomanization').value.trim(),
        language: document.getElementById('glEntryLang').value,
        localDate: new Date().toLocaleDateString('en-CA'),
        category: document.getElementById('glEntryCategory').value.trim(),
        type: document.getElementById('glEntryType').value,
        partOfSpeech: getPOSValues(),
        difficulty: document.getElementById('glEntryDifficulty').value,
        formality: document.getElementById('glEntryFormality').value,
        audioUrl: document.getElementById('glEntryAudio').value.trim(),
        rootFamily: document.getElementById('glEntryRoot').value.trim(),
        rootLanguage: document.getElementById('glEntryRootLang').value,
        usageNotes: document.getElementById('glEntryUsage').value.trim(),
        culturalNotes: document.getElementById('glEntryCultural').value.trim(),
        examples,
    };
}

async function saveGoldListEntry() {
    const data = _glReadEntryForm();
    if (!data.word) { showToast('Word is required.', 'error'); return; }

    // Duplicate check — only for new entries. Editing an existing entry skips
    // this; the user is intentionally modifying that row, not adding a new one.
    if (!currentGlEntryId) {
        const dupe = _glFindDuplicate(data);
        if (dupe) {
            openDupeModal(dupe, data);
            return;
        }
    }

    try {
        const isNew = !currentGlEntryId;
        const result = await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify(data) });
        showToast('Entry saved!', 'success');
        if (isNew) {
            clearGlEntry();
        } else if (result.entry) {
            currentGlEntryId = result.entry.id;
        }
        loadGoldList();
    } catch (e) {
        // Error shown
    }
}

// ==================== DUPLICATE DETECTION + DIFF MODAL ====================
// Match on (normalized word, normalized language). Romanization is treated
// as an alternate key — useful when the same word is entered once in script
// and once in romanization with the same language tag.
function _glDupeNorm(s) { return (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' '); }

function _glFindDuplicate(newEntry) {
    if (!Array.isArray(glAllEntries)) return null;
    const w = _glDupeNorm(newEntry.word);
    const r = _glDupeNorm(newEntry.romanization);
    const lang = _glDupeNorm(newEntry.language);
    if (!w) return null;
    return glAllEntries.find(e => {
        if (newEntry.id && e.id === newEntry.id) return false;
        if (_glDupeNorm(e.language) !== lang) return false;
        const ew = _glDupeNorm(e.word);
        const er = _glDupeNorm(e.romanization);
        if (ew === w) return true;
        if (r && er && (er === w || er === r || ew === r)) return true;
        return false;
    }) || null;
}

// Fields shown in the diff modal, in display order. `get` extracts the
// display string from an entry; `apply` writes the chosen value back into
// the merged save payload (defaulting to identity for plain string fields).
const GL_DUPE_FIELDS = [
    { key: 'word',          label: 'Word / Phrase' },
    { key: 'translation',   label: 'Translation' },
    { key: 'romanization',  label: 'Romanization' },
    { key: 'language',      label: 'Language' },
    { key: 'type',          label: 'Type' },
    { key: 'partOfSpeech',  label: 'Part of Speech' },
    { key: 'difficulty',    label: 'Difficulty' },
    { key: 'formality',     label: 'Formality' },
    { key: 'category',      label: 'Category' },
    { key: 'rootFamily',    label: 'Root Family' },
    { key: 'rootLanguage',  label: 'Root Language' },
    { key: 'audioUrl',      label: 'Audio',  format: v => v ? '♫ recorded' : '' },
    { key: 'usageNotes',    label: 'Usage Notes' },
    { key: 'culturalNotes', label: 'Cultural Notes' },
    {
        key: 'examples',
        label: 'Examples',
        format: v => {
            if (!Array.isArray(v) || !v.length) return '';
            const first = v[0]?.sentence || '';
            const rest = v.length > 1 ? ` (+${v.length - 1} more)` : '';
            return `${first}${rest}`;
        },
        same: (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []),
    },
];

let glDupeState = null; // { existing, newEntry, picks: { [key]: 'existing'|'new' } }

function _glDupeDisplay(entry, field) {
    const raw = entry ? entry[field.key] : '';
    const txt = field.format ? field.format(raw) : (raw == null ? '' : String(raw));
    return txt;
}
function _glDupeIsSame(existing, newEntry, field) {
    if (field.same) return field.same(existing[field.key], newEntry[field.key]);
    return _glDupeNorm(_glDupeDisplay(existing, field)) === _glDupeNorm(_glDupeDisplay(newEntry, field));
}

function openDupeModal(existing, newEntry) {
    // Initial picks: prefer the side with a non-empty value; if both have
    // content, default to existing (least surprising — explicit "use new"
    // is one click away).
    const picks = {};
    for (const f of GL_DUPE_FIELDS) {
        const exHas = !!_glDupeDisplay(existing, f);
        const newHas = !!_glDupeDisplay(newEntry, f);
        picks[f.key] = (!exHas && newHas) ? 'new' : 'existing';
    }
    glDupeState = { existing, newEntry, picks };

    const sub = document.getElementById('glDupeSubtitle');
    if (sub) {
        const w = escapeHtml(existing.word || '');
        const lang = escapeHtml(existing.language || '');
        sub.innerHTML = `<strong>${w}</strong> (${lang}) is already in your list. Click a value to pick which one to keep, then save the merged result &mdash; or keep both as separate entries.`;
    }
    glDupeRenderBody();
    document.getElementById('glDupeModal').classList.add('active');
}

function closeDupeModal() {
    document.getElementById('glDupeModal').classList.remove('active');
    glDupeState = null;
}

function glDupeRenderBody() {
    const body = document.getElementById('glDupeBody');
    if (!body || !glDupeState) return;
    const { existing, newEntry, picks } = glDupeState;
    let diffs = 0;
    let html = '';
    for (const f of GL_DUPE_FIELDS) {
        const exVal = _glDupeDisplay(existing, f);
        const newVal = _glDupeDisplay(newEntry, f);
        const same = _glDupeIsSame(existing, newEntry, f);
        if (!same) diffs++;
        const exDisp = exVal || '—';
        const newDisp = newVal || '—';
        const exEmpty = exVal ? '' : 'empty';
        const newEmpty = newVal ? '' : 'empty';
        const exPicked = picks[f.key] === 'existing' ? 'picked' : '';
        const newPicked = picks[f.key] === 'new' ? 'picked' : '';
        html += `
            <div class="gl-dupe-row ${same ? '' : 'diff'}">
              <div class="gl-dupe-label">${escapeHtml(f.label)}</div>
              <div class="gl-dupe-val ${exEmpty} ${exPicked}" data-side="Existing" onclick="glDupePickField('${f.key}','existing')">
                <span class="pick-indicator">&#10003; Keep</span>${escapeHtml(exDisp)}
              </div>
              <div class="gl-dupe-arrow">&#8596;</div>
              <div class="gl-dupe-val ${newEmpty} ${newPicked}" data-side="New" onclick="glDupePickField('${f.key}','new')">
                <span class="pick-indicator">&#10003; Use</span>${escapeHtml(newDisp)}
              </div>
            </div>
        `;
    }
    body.innerHTML = html;
    const counter = document.getElementById('glDupeDiffCount');
    if (counter) counter.textContent = diffs ? `${diffs} difference${diffs === 1 ? '' : 's'}` : 'identical — nothing will change';
}

function glDupePickField(key, side) {
    if (!glDupeState) return;
    glDupeState.picks[key] = side;
    glDupeRenderBody();
}

function glDupePresetAll(side) {
    if (!glDupeState) return;
    for (const f of GL_DUPE_FIELDS) glDupeState.picks[f.key] = side;
    glDupeRenderBody();
}

async function glDupeSaveMerged() {
    if (!glDupeState) return;
    const { existing, newEntry, picks } = glDupeState;
    // Start from the existing entry (preserves createdAt, distillation,
    // lastReviewedAt, learned flag etc.) and overwrite per-field picks.
    const merged = { ...existing };
    for (const f of GL_DUPE_FIELDS) {
        merged[f.key] = (picks[f.key] === 'new') ? newEntry[f.key] : existing[f.key];
    }
    merged.id = existing.id;
    merged.localDate = newEntry.localDate;
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify(merged) });
        showToast('Merged into existing entry.', 'success');
        closeDupeModal();
        clearGlEntry();
        loadGoldList();
    } catch (e) {
        // apiFetch surfaces errors
    }
}

async function glDupeSaveAsNew() {
    if (!glDupeState) return;
    const payload = { ...glDupeState.newEntry };
    delete payload.id; // force-create a new row alongside the existing one
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Saved as a separate entry.', 'success');
        closeDupeModal();
        clearGlEntry();
        loadGoldList();
    } catch (e) {
        // apiFetch surfaces errors
    }
}

function deleteCurrentGlEntry() {
    if (!currentGlEntryId) return;
    openModal('Delete Entry', 'Delete this vocabulary entry?', 'Delete', 'btn-danger', async () => {
        await deleteGoldListEntry(currentGlEntryId);
        clearGlEntry();
    });
}

async function completeReview(btn, listId, distillation) {
    const group = btn.closest('.gl-group');
    const checkboxes = group.querySelectorAll('.gl-word-row input[type=checkbox]');
    const reviewEntries = [];
    checkboxes.forEach(cb => { reviewEntries.push({ id: cb.dataset.id, learned: cb.checked }); });
    if (!reviewEntries.length) return;
    const learnedCount = reviewEntries.filter(e => e.learned).length;
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify({ action: 'review', entries: reviewEntries }) });
        showToast(`Review complete! ${learnedCount} learned, ${reviewEntries.length - learnedCount} moved to next distillation.`, 'success');
        loadGoldList();
    } catch (e) { /* Error shown */ }
}

async function deleteGoldListEntry(id) {
    try {
        await apiFetch('/api/goldlist', { method: 'DELETE', body: JSON.stringify({ id }) });
        showToast('Entry removed.', 'success');
        loadGoldList();
    } catch (e) { /* Error shown */ }
}

// --- Quiz Engine ---
let quizDeck = [];
let quizIndex = 0;
let quizResults = []; // {id, rating, direction}
let quizMode = 'practice'; // 'practice' or 'distillation'
let quizDirection = 'mixed';
let quizDistillationInfo = null;

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function startPracticeQuiz() {
    const lang = document.getElementById('quizLang').value;
    const pool = document.getElementById('quizPool').value;
    quizDirection = document.getElementById('quizDir').value;
    const count = parseInt(document.getElementById('quizCount').value) || 10;

    let candidates = [...glAllEntries];
    if (lang) candidates = candidates.filter(e => e.language === lang);
    if (pool === 'active') candidates = candidates.filter(e => !e.learned);
    else if (pool === 'learned') candidates = candidates.filter(e => e.learned);
    else if (pool === 'reviewable') candidates = candidates.filter(isEntryReviewable);
    // 'all' = no filter

    if (!candidates.length) { showToast('No words match your filters.', 'error'); return; }

    quizDeck = shuffleArray(candidates).slice(0, Math.min(count, candidates.length));
    quizIndex = 0;
    quizResults = [];
    quizMode = 'practice';
    quizDistillationInfo = null;

    document.getElementById('quizModeLabel').textContent = 'Practice Quiz';
    openQuiz();
}

function startDistillationQuiz(listId, distillation) {
    const group = glAllEntries.filter(e => !e.learned && e.listId === listId && e.distillation === distillation);
    if (!group.length) { showToast('No entries in this group.', 'error'); return; }

    quizDeck = shuffleArray([...group]);
    quizIndex = 0;
    quizResults = [];
    quizMode = 'distillation';
    quizDirection = 'forward';
    quizDistillationInfo = { listId, distillation };

    document.getElementById('quizModeLabel').textContent = 'Distillation Review';
    openQuiz();
}

function startReviewableQuiz() {
    const reviewable = glAllEntries.filter(isEntryReviewable);
    if (!reviewable.length) { showToast('No words ready for review.', 'error'); return; }

    // If multiple languages have reviewable words, let the user pick one
    // (or "all"). Single-language case skips the picker for one fewer tap.
    const byLang = {};
    for (const e of reviewable) {
        const lang = e.language || 'unknown';
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push(e);
    }
    const langs = Object.keys(byLang);
    if (langs.length <= 1) {
        startReviewableQuizForLanguage(null);
        return;
    }

    const options = [
        { value: null, label: `All (${reviewable.length})` },
        ...langs.sort().map((l) => ({ value: l, label: `${_glCap(l)} (${byLang[l].length})` })),
    ];
    openLanguagePickerModal('Review which language?', options, startReviewableQuizForLanguage);
}

// Module-level: which language (if any) the active review-count picker is
// scoped to. Read by launchReviewableQuizFromPicker so the slice is filtered.
let _reviewPickerLanguage = null;

function startReviewableQuizForLanguage(language) {
    _reviewPickerLanguage = language;
    let reviewable = glAllEntries.filter(isEntryReviewable);
    if (language) {
        reviewable = reviewable.filter((e) => (e.language || 'unknown') === language);
    }
    if (!reviewable.length) { showToast('No words ready for review.', 'error'); return; }

    if (reviewable.length > 20) {
        showReviewCountPicker(reviewable.length, language);
        return;
    }

    beginReviewQuiz(reviewable);
}

function showReviewCountPicker(total, language) {
    const overlay = document.getElementById('quizOverlay');
    overlay.classList.add('active');
    document.getElementById('quizCardArea').style.display = 'none';
    document.getElementById('quizRating').style.display = 'none';
    document.getElementById('quizModeLabel').textContent = 'Review Quiz';
    document.getElementById('quizProgressText').textContent = '';
    document.getElementById('quizProgressFill').style.width = '0%';

    const langLabel = language ? `${_glCap(language)} ` : '';
    document.getElementById('quizSummary').innerHTML = `<div style="text-align:center;padding:40px 20px;">
        <h2 style="margin-bottom:16px;">Review Ready ${langLabel}Words</h2>
        <p style="color:var(--gray-500);margin-bottom:24px;"><strong>${total}</strong> words are ready for review.</p>
        <div style="margin-bottom:24px;">
            <label style="font-weight:600;display:block;margin-bottom:8px;">How many to review?</label>
            <input type="number" id="reviewableCount" value="20" min="1" max="${total}" style="padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:16px;width:80px;text-align:center;">
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('reviewableCount').value=${total}" style="margin-left:8px;">All ${total}</button>
        </div>
        <div class="btn-group" style="justify-content:center;">
            <button class="btn btn-primary" onclick="launchReviewableQuizFromPicker()" style="background:#b8860b;border-color:#b8860b;">Start Review</button>
            <button class="btn btn-secondary" onclick="exitQuiz()">Cancel</button>
        </div>
    </div>`;
    document.getElementById('quizSummary').style.display = 'flex';
    document.removeEventListener('keydown', quizKeyHandler);
    document.addEventListener('keydown', quizKeyHandler);
}

function launchReviewableQuizFromPicker() {
    const count = parseInt(document.getElementById('reviewableCount').value) || 20;
    let reviewable = glAllEntries.filter(isEntryReviewable);
    if (_reviewPickerLanguage) {
        reviewable = reviewable.filter((e) => (e.language || 'unknown') === _reviewPickerLanguage);
    }
    beginReviewQuiz(shuffleArray([...reviewable]).slice(0, Math.min(count, reviewable.length)));
}

// Reusable language-picker modal — used by startReviewableQuiz when
// multiple languages are due for review. Buttons are built dynamically
// from `options`; clicking one invokes onPick(value) and closes the modal.
function openLanguagePickerModal(title, options, onPick) {
    const titleEl = document.getElementById('languagePickerTitle');
    const btnContainer = document.getElementById('languagePickerButtons');
    const modal = document.getElementById('languagePickerModal');
    if (!titleEl || !btnContainer || !modal) return;
    titleEl.textContent = title;
    btnContainer.innerHTML = '';
    for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = opt.label;
        btn.style.width = '100%';
        btn.style.background = '#b8860b';
        btn.style.borderColor = '#b8860b';
        btn.addEventListener('click', () => {
            closeLanguagePickerModal();
            onPick(opt.value);
        });
        btnContainer.appendChild(btn);
    }
    modal.classList.add('active');
}

function closeLanguagePickerModal() {
    document.getElementById('languagePickerModal')?.classList.remove('active');
}

function beginReviewQuiz(entries) {
    quizDeck = shuffleArray([...entries]);
    quizIndex = 0;
    quizResults = [];
    quizMode = 'distillation';
    quizDirection = 'forward';
    quizDistillationInfo = { listId: 'all', distillation: -1 };
    document.getElementById('quizModeLabel').textContent = 'Review Quiz';
    openQuiz();
}

function openQuiz() {
    const overlay = document.getElementById('quizOverlay');
    overlay.classList.add('active');
    document.getElementById('quizSummary').style.display = 'none';
    document.getElementById('quizCardArea').style.display = 'flex';
    showQuizCard();
    document.removeEventListener('keydown', quizKeyHandler);
    document.addEventListener('keydown', quizKeyHandler);
}

function getCardDirection(index) {
    if (quizDirection === 'forward') return 'forward';
    if (quizDirection === 'reverse') return 'reverse';
    return index % 2 === 0 ? 'forward' : 'reverse';
}

function showQuizCard() {
    if (quizIndex >= quizDeck.length) { showQuizSummary(); return; }
    const entry = quizDeck[quizIndex];
    const dir = getCardDirection(quizIndex);

    document.getElementById('quizProgressText').textContent = `Card ${quizIndex + 1} of ${quizDeck.length}`;
    document.getElementById('quizProgressFill').style.width = `${((quizIndex) / quizDeck.length) * 100}%`;

    const dirLabel = dir === 'forward' ? 'Word \u2192 English' : 'English \u2192 Word';
    document.getElementById('quizDirection').textContent = dirLabel;

    if (dir === 'forward') {
        document.getElementById('quizPrompt').textContent = entry.word || '';
        document.getElementById('quizRom').textContent = entry.romanization || '';
        document.getElementById('quizTranslation').textContent = entry.translation || '';
    } else {
        document.getElementById('quizPrompt').textContent = entry.translation || '';
        document.getElementById('quizRom').textContent = '';
        document.getElementById('quizTranslation').textContent = entry.word || '';
    }

    const posParts = (entry.partOfSpeech || '').split(',').map(s => s.trim()).filter(Boolean);
    const meta = [entry.language, ...posParts, entry.type !== 'word' ? entry.type : ''].filter(Boolean).join(' \u00b7 ');
    document.getElementById('quizMeta').textContent = meta;

    // Build full word details for reveal
    document.getElementById('quizDetails').innerHTML = buildWordDetail(entry);

    // Reset card state
    document.getElementById('quizAnswer').style.display = 'none';
    document.getElementById('quizRevealBtn').style.display = '';
    document.getElementById('quizRating').style.display = 'none';

    // Store direction for rating
    document.getElementById('quizCardArea').dataset.direction = dir;
}

function revealAnswer() {
    document.getElementById('quizAnswer').style.display = 'block';
    document.getElementById('quizRevealBtn').style.display = 'none';
    document.getElementById('quizRating').style.display = '';
}

async function rateQuizCard(rating) {
    const entry = quizDeck[quizIndex];
    const dir = document.getElementById('quizCardArea').dataset.direction || 'forward';

    quizResults.push({ id: entry.id, rating, direction: dir, word: entry.word, translation: entry.translation });

    if (quizMode === 'practice') {
        apiFetch('/api/goldlist', {
            method: 'POST',
            body: JSON.stringify({ action: 'self-rate', id: entry.id, rating, direction: dir })
        }).catch(() => {});
    } else if (quizMode === 'distillation') {
        // Auto-save each card so progress isn't lost if quiz is interrupted
        apiFetch('/api/goldlist', {
            method: 'POST',
            body: JSON.stringify({ action: 'review', entries: [{ id: entry.id, learned: rating >= 4, rating, direction: dir }] })
        }).catch(() => {});
    }

    quizIndex++;
    showQuizCard();
}

function showQuizSummary() {
    document.getElementById('quizCardArea').style.display = 'none';
    document.getElementById('quizRating').style.display = 'none';
    document.getElementById('quizProgressFill').style.width = '100%';
    document.getElementById('quizProgressText').textContent = 'Complete';

    const total = quizResults.length;
    const avg = total ? (quizResults.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : '0';
    const struggle = quizResults.filter(r => r.rating <= 2).length;
    const ok = quizResults.filter(r => r.rating === 3).length;
    const strong = quizResults.filter(r => r.rating >= 4).length;

    const ratingColors = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#10b981' };

    let html = `<h2>Quiz Complete!</h2>
        <div class="quiz-summary-stats">
            <div class="quiz-summary-stat"><div class="value">${total}</div><div class="label">Cards</div></div>
            <div class="quiz-summary-stat"><div class="value">${avg}</div><div class="label">Avg Rating</div></div>
            <div class="quiz-summary-stat"><div class="value">${strong}</div><div class="label">Strong (4-5)</div></div>
        </div>
        <div class="quiz-summary-breakdown">
            <span class="item"><span class="dot" style="background:#ef4444;"></span>${struggle} struggled</span>
            <span class="item"><span class="dot" style="background:#eab308;"></span>${ok} hesitated</span>
            <span class="item"><span class="dot" style="background:#22c55e;"></span>${strong} strong</span>
        </div>`;

    if (quizMode === 'distillation') {
        const learned = quizResults.filter(r => r.rating >= 4);
        const advanced = quizResults.filter(r => r.rating < 4);
        html += `<div style="margin:20px 0;padding:16px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
            <strong style="color:#166534;">${learned.length} word${learned.length !== 1 ? 's' : ''} learned</strong> (rated 4-5)<br>
            <span style="color:var(--gray-600);">${advanced.length} word${advanced.length !== 1 ? 's' : ''} advance to next distillation</span> (rated 1-3)
        </div>
        <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">Progress saved automatically.</p>
        <div class="btn-group" style="justify-content:center;">
            <button class="btn btn-primary" onclick="exitQuiz();loadGoldList();" style="background:#b8860b;border-color:#b8860b;">Done</button>
        </div>`;
    } else {
        html += `<div class="btn-group" style="justify-content:center;margin-top:16px;">`;
        if (struggle > 0) {
            html += `<button class="btn btn-secondary" onclick="retryWeakWords()">Review Weak Words (${struggle})</button>`;
        }
        html += `<button class="btn btn-primary" onclick="exitQuiz()" style="background:#b8860b;border-color:#b8860b;">Done</button>
        </div>`;
    }

    document.getElementById('quizSummary').innerHTML = html;
    document.getElementById('quizSummary').style.display = 'flex';
}

async function confirmDistillationReview() {
    const entries = quizResults.map(r => ({
        id: r.id,
        learned: r.rating >= 4,
        rating: r.rating,
        direction: r.direction
    }));
    const learnedCount = entries.filter(e => e.learned).length;
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify({ action: 'review', entries }) });
        showToast(`Review saved! ${learnedCount} learned, ${entries.length - learnedCount} advanced.`, 'success');
        exitQuiz();
        loadGoldList();
    } catch (e) { showToast('Failed to save review.', 'error'); }
}

function retryWeakWords() {
    const weakIds = new Set(quizResults.filter(r => r.rating <= 2).map(r => r.id));
    const weakEntries = quizDeck.filter(e => weakIds.has(e.id));
    if (!weakEntries.length) { exitQuiz(); return; }

    quizDeck = shuffleArray(weakEntries);
    quizIndex = 0;
    quizResults = [];
    document.getElementById('quizSummary').style.display = 'none';
    document.getElementById('quizCardArea').style.display = 'flex';
    showQuizCard();
}

function exitQuiz() {
    document.getElementById('quizOverlay').classList.remove('active');
    document.removeEventListener('keydown', quizKeyHandler);
    quizDeck = [];
    quizResults = [];
    quizIndex = 0;
}

function quizKeyHandler(e) {
    if (!document.getElementById('quizOverlay').classList.contains('active')) return;
    // Don't intercept system shortcuts like Cmd+C / Ctrl+C — let the browser copy.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // If the user has text selected on the card, they're mid-copy — don't advance.
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.toString().length > 0) return;
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const revealBtn = document.getElementById('quizRevealBtn');
        if (revealBtn.style.display !== 'none') { revealAnswer(); }
    }
    if (e.key >= '1' && e.key <= '5') {
        if (document.getElementById('quizRating').style.display !== 'none') {
            rateQuizCard(parseInt(e.key));
        }
    }
    if (e.key === 'Escape') { exitQuiz(); }
}

// --- Review Email ---
async function previewReviewEmail() {
    const div = document.getElementById('glEmailPreview');
    div.style.display = 'block';
    div.innerHTML = '<p style="color:var(--gray-500);">Loading preview...</p>';
    try {
        const resp = await fetch('/api/goldlist-email');
        const html = await resp.text();
        div.innerHTML = html;
    } catch (e) {
        div.innerHTML = '<p style="color:var(--red);">Failed to load preview.</p>';
    }
}

async function sendReviewEmail() {
    try {
        await apiFetch('/api/goldlist-email', { method: 'POST' });
        showToast('Review email sent!', 'success');
    } catch (e) { /* Error shown */ }
}

// --- Pronunciation Recording (Gold List edit modal) ---
let glMediaRecorder = null;
let glRecordedChunks = [];
let glRecordStream = null;

function glResetAudioUI() {
    if (glMediaRecorder && glMediaRecorder.state !== 'inactive') {
        try { glMediaRecorder.stop(); } catch (e) { /* ignore */ }
    }
    if (glRecordStream) {
        glRecordStream.getTracks().forEach(t => t.stop());
        glRecordStream = null;
    }
    glMediaRecorder = null;
    glRecordedChunks = [];
    const btn = document.getElementById('glRecordBtn');
    const status = document.getElementById('glRecordStatus');
    const preview = document.getElementById('glAudioPreview');
    const clearBtn = document.getElementById('glClearAudioBtn');
    if (btn) { btn.textContent = '● Record'; btn.disabled = false; btn.classList.remove('btn-danger'); btn.classList.add('btn-secondary'); }
    if (status) status.textContent = '';
    if (preview) { preview.style.display = 'none'; preview.removeAttribute('src'); }
    if (clearBtn) clearBtn.style.display = 'none';
}

function glShowAudioPreview(srcUrl) {
    const preview = document.getElementById('glAudioPreview');
    const clearBtn = document.getElementById('glClearAudioBtn');
    if (preview) { preview.src = srcUrl; preview.style.display = ''; }
    if (clearBtn) clearBtn.style.display = '';
}

async function glToggleRecord() {
    const btn = document.getElementById('glRecordBtn');
    const status = document.getElementById('glRecordStatus');

    if (glMediaRecorder && glMediaRecorder.state === 'recording') {
        glMediaRecorder.stop();
        return;
    }

    if (!navigator.mediaDevices || !window.MediaRecorder) {
        showToast('Recording not supported in this browser.', 'error');
        return;
    }

    try {
        glRecordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
        glMediaRecorder = mime ? new MediaRecorder(glRecordStream, { mimeType: mime }) : new MediaRecorder(glRecordStream);
        glRecordedChunks = [];
        glMediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) glRecordedChunks.push(ev.data); };
        glMediaRecorder.onstop = async () => {
            if (glRecordStream) {
                glRecordStream.getTracks().forEach(t => t.stop());
                glRecordStream = null;
            }
            btn.textContent = '● Record';
            btn.disabled = false;
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-secondary');
            const blob = new Blob(glRecordedChunks, { type: glMediaRecorder.mimeType || 'audio/webm' });
            if (!blob.size) { status.textContent = 'Empty recording.'; return; }
            status.textContent = 'Uploading…';
            try {
                const fd = new FormData();
                const ext = (blob.type.includes('mp4') ? '.m4a' : (blob.type.includes('ogg') ? '.ogg' : '.webm'));
                fd.append('file', blob, `recording${ext}`);
                if (currentGlEntryId) fd.append('entryId', currentGlEntryId);
                const resp = await fetch('/api/goldlist-audio', { method: 'POST', body: fd });
                const data = await resp.json();
                if (!resp.ok || !data.url) throw new Error(data.error || 'Upload failed');
                document.getElementById('glEntryAudio').value = data.url;
                glShowAudioPreview(data.url);
                status.textContent = 'Saved (remember to Save Entry).';
            } catch (e) {
                status.textContent = '';
                showToast('Recording upload failed: ' + e.message, 'error');
            }
        };
        glMediaRecorder.start();
        btn.textContent = '■ Stop';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-danger');
        status.textContent = 'Recording…';
    } catch (e) {
        showToast('Microphone access denied.', 'error');
        glResetAudioUI();
    }
}

function glClearAudio() {
    const url = document.getElementById('glEntryAudio').value;
    document.getElementById('glEntryAudio').value = '';
    const preview = document.getElementById('glAudioPreview');
    if (preview) { preview.style.display = 'none'; preview.removeAttribute('src'); }
    document.getElementById('glClearAudioBtn').style.display = 'none';
    document.getElementById('glRecordStatus').textContent = 'Cleared (save entry to confirm).';
    // Best-effort R2 cleanup for keys we own
    if (url && url.startsWith('/api/audio-stream/goldlist/')) {
        const key = url.replace('/api/audio-stream/', '');
        fetch('/api/goldlist-audio', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        }).catch(() => { /* ignore — not critical */ });
    }
}

// Inline ▶ playback for list rows. One shared <audio> element so only one plays at a time.
let _glRowAudio = null;
function glPlayAudio(srcUrl, btn) {
    if (!_glRowAudio) {
        _glRowAudio = new Audio();
        _glRowAudio.addEventListener('ended', () => {
            document.querySelectorAll('.gl-play-btn.playing').forEach(b => {
                b.classList.remove('playing');
                b.innerHTML = '&#9654;';
            });
        });
    }
    const wasPlaying = btn.classList.contains('playing');
    // Reset any other playing button
    document.querySelectorAll('.gl-play-btn.playing').forEach(b => {
        b.classList.remove('playing');
        b.innerHTML = '&#9654;';
    });
    _glRowAudio.pause();
    if (wasPlaying) return;
    _glRowAudio.src = srcUrl;
    _glRowAudio.play().then(() => {
        btn.classList.add('playing');
        btn.innerHTML = '&#9632;';
    }).catch(() => {
        showToast('Could not play audio.', 'error');
    });
}

function glPlayBtnHtml(audioUrl) {
    if (!audioUrl) return '';
    return `<button class="gl-play-btn" onclick="event.stopPropagation();glPlayAudio('${escapeHtml(audioUrl)}', this)" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--primary);padding:0 4px;" title="Play pronunciation">&#9654;</button>`;
}
