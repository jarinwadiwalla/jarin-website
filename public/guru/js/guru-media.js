/* ==========================================================================
   Guru Dashboard — Media Module
   Books, podcasts, videos — tracking and statistics
   ========================================================================== */

// ==================== MEDIA ====================
let mediaEntries = [];
let currentMediaMode = 'books';

function switchMediaMode(mode) {
    currentMediaMode = mode;
    document.querySelectorAll('.media-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.media-mode-btn[data-mode="${mode}"]`).classList.add('active');
    document.querySelectorAll('.media-panel').forEach(p => p.style.display = 'none');
    document.getElementById('media-panel-' + mode).style.display = '';
    if (mode === 'stats') renderMediaStats();
}

async function loadMedia() {
    try {
        const data = await apiFetch('/api/media');
        mediaEntries = data.entries || [];
        renderMedia();
    } catch (e) {
        document.getElementById('mediaBooksTable').innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

function renderMedia() {
    // Books
    const books = mediaEntries.filter(e => e.type === 'book');
    document.getElementById('mediaBooksReading').textContent = books.filter(e => e.status === 'in-progress').length;
    document.getElementById('mediaBooksQueue').textContent = books.filter(e => e.status === 'queue').length;
    document.getElementById('mediaBooksWant').textContent = books.filter(e => e.status === 'want').length;
    document.getElementById('mediaBooksFinished').textContent = books.filter(e => e.status === 'finished').length;
    document.getElementById('mediaBooksDropped').textContent = books.filter(e => e.status === 'dropped').length;

    const bSearch = (document.getElementById('mediaBooksSearch')?.value || '').toLowerCase();
    const bStatus = document.getElementById('mediaBooksFilterStatus')?.value || '';
    const bSort = document.getElementById('mediaBooksSort')?.value || 'updated-desc';
    let filteredBooks = books;
    if (bSearch) filteredBooks = filteredBooks.filter(e => ((e.title||'')+(e.creator||'')+(e.genre||'')).toLowerCase().includes(bSearch));
    if (bStatus) {
        filteredBooks = filteredBooks.filter(e => e.status === bStatus);
        filteredBooks = sortMediaEntries(filteredBooks, bSort);
        document.getElementById('mediaBooksTable').innerHTML = buildMediaTable(filteredBooks, 'book');
    } else {
        // Group by status sections
        const sections = [
            { status: 'in-progress', label: 'Currently Reading', color: 'var(--yellow)' },
            { status: 'queue', label: 'Queue', color: 'var(--purple)' },
            { status: 'want', label: 'Want to Read', color: 'var(--blue)' },
            { status: 'finished', label: 'Finished', color: 'var(--green)' },
            { status: 'dropped', label: 'Dropped', color: 'var(--gray-400)' },
        ];
        let html = '';
        for (const sec of sections) {
            let group = filteredBooks.filter(e => e.status === sec.status);
            if (!group.length) continue;
            group = sortMediaEntries(group, bSort);
            html += `<div style="margin-bottom:24px;">
                <h3 style="font-size:14px;font-weight:600;color:${sec.color};margin-bottom:8px;border-bottom:2px solid ${sec.color};padding-bottom:4px;">${sec.label} (${group.length})</h3>
                ${buildMediaTable(group, 'book')}
            </div>`;
        }
        document.getElementById('mediaBooksTable').innerHTML = html || '<div class="empty-state"><p>No books yet.</p></div>';
    }

    // Movies & Shows
    const visual = mediaEntries.filter(e => e.type === 'movie' || e.type === 'show');
    document.getElementById('mediaVisualWant').textContent = visual.filter(e => e.status === 'want').length;
    document.getElementById('mediaVisualWatching').textContent = visual.filter(e => e.status === 'in-progress').length;
    document.getElementById('mediaVisualFinished').textContent = visual.filter(e => e.status === 'finished').length;
    document.getElementById('mediaVisualDropped').textContent = visual.filter(e => e.status === 'dropped').length;

    const vSearch = (document.getElementById('mediaVisualSearch')?.value || '').toLowerCase();
    const vType = document.getElementById('mediaVisualFilterType')?.value || '';
    const vStatus = document.getElementById('mediaVisualFilterStatus')?.value || '';
    const vSort = document.getElementById('mediaVisualSort')?.value || 'updated-desc';
    let filteredVisual = visual;
    if (vSearch) filteredVisual = filteredVisual.filter(e => ((e.title||'')+(e.creator||'')+(e.genre||'')).toLowerCase().includes(vSearch));
    if (vType) filteredVisual = filteredVisual.filter(e => e.type === vType);
    if (vStatus) filteredVisual = filteredVisual.filter(e => e.status === vStatus);
    filteredVisual = sortMediaEntries(filteredVisual, vSort);
    document.getElementById('mediaVisualTable').innerHTML = buildMediaTable(filteredVisual, 'visual');

    // Music
    const music = mediaEntries.filter(e => e.type === 'music');
    document.getElementById('mediaMusicWant').textContent = music.filter(e => e.status === 'want').length;
    document.getElementById('mediaMusicListening').textContent = music.filter(e => e.status === 'in-progress').length;
    document.getElementById('mediaMusicFinished').textContent = music.filter(e => e.status === 'finished').length;
    document.getElementById('mediaMusicTotal').textContent = music.length;

    const mSearch = (document.getElementById('mediaMusicSearch')?.value || '').toLowerCase();
    const mStatus = document.getElementById('mediaMusicFilterStatus')?.value || '';
    const mSort = document.getElementById('mediaMusicSort')?.value || 'updated-desc';
    let filteredMusic = music;
    if (mSearch) filteredMusic = filteredMusic.filter(e => ((e.title||'')+(e.creator||'')+(e.album||'')+(e.genre||'')).toLowerCase().includes(mSearch));
    if (mStatus) filteredMusic = filteredMusic.filter(e => e.status === mStatus);
    filteredMusic = sortMediaEntries(filteredMusic, mSort);
    document.getElementById('mediaMusicTable').innerHTML = buildMediaTable(filteredMusic, 'music');

    if (currentMediaMode === 'stats') renderMediaStats();
}

function sortMediaEntries(entries, sortKey) {
    const sorted = [...entries];
    switch (sortKey) {
        case 'updated-desc': return sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        case 'date-desc': return sorted.sort((a, b) => (b.dateStarted || '').localeCompare(a.dateStarted || ''));
        case 'date-asc': return sorted.sort((a, b) => (a.dateStarted || '').localeCompare(b.dateStarted || ''));
        case 'finished-desc': return sorted.sort((a, b) => (b.dateFinished || '').localeCompare(a.dateFinished || ''));
        case 'finished-asc': return sorted.sort((a, b) => (a.dateFinished || '').localeCompare(b.dateFinished || ''));
        case 'created-desc': return sorted.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        case 'title-asc': return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        case 'creator-asc': return sorted.sort((a, b) => (a.creator || '').localeCompare(b.creator || ''));
        case 'rating-desc': return sorted.sort((a, b) => (parseInt(b.rating) || 0) - (parseInt(a.rating) || 0));
        default: return sorted;
    }
}

const MEDIA_STATUSES = ['want', 'queue', 'in-progress', 'finished', 'dropped'];
const STATUS_LABELS = { want: 'Want', queue: 'Queue', 'in-progress': 'In Progress', finished: 'Finished', dropped: 'Dropped' };
const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'id', label: 'Indonesian' },
    { value: 'fa', label: 'Persian' },
    { value: 'az', label: 'Azeri' },
    { value: 'ar', label: 'Arabic' },
];
const LANGUAGE_LABELS = { en: 'EN', id: 'ID', fa: 'FA', az: 'AZ', ar: 'AR' };

function buildLangCheckboxes(prefix, selectedCsv) {
    const selected = (selectedCsv || '').split(',').filter(Boolean);
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        LANGUAGE_OPTIONS.map(l => {
            const checked = selected.includes(l.value) ? 'checked' : '';
            return `<label style="font-size:11px;display:flex;align-items:center;gap:2px;cursor:pointer;"><input type="checkbox" name="${prefix}" value="${l.value}" ${checked} style="margin:0;"> ${l.label}</label>`;
        }).join('') + '</div>';
}

function readLangCheckboxes(prefix) {
    return [...document.querySelectorAll(`input[name="${prefix}"]:checked`)].map(c => c.value).join(',');
}
const STATUS_COLORS = { want: 'var(--blue-light)', queue: 'var(--purple-light)', 'in-progress': 'var(--yellow-light)', finished: 'var(--green-light)', dropped: 'var(--gray-200)' };
const STATUS_TEXT_COLORS = { want: 'var(--blue)', queue: 'var(--purple)', 'in-progress': 'var(--yellow)', finished: 'var(--green)', dropped: 'var(--gray-500)' };

function renderStars(rating) {
    const r = parseInt(rating) || 0;
    if (r === 0) return '<span style="color:var(--gray-300);">—</span>';
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= r ? '<span style="color:#f59e0b;">&#9733;</span>' : '<span style="color:var(--gray-200);">&#9733;</span>';
    return s;
}

function buildMediaTable(entries, panelType) {
    if (entries.length === 0) return '<div class="empty-state"><p>No entries match your filters.</p></div>';
    let html = '<table><thead><tr>';
    if (panelType === 'book') html += '<th style="width:30px;">#</th>';
    if (panelType === 'visual') html += '<th>Type</th>';
    html += '<th>Title</th><th>' + (panelType === 'music' ? 'Artist' : panelType === 'book' ? 'Author' : 'Creator') + '</th>';
    if (panelType === 'music') html += '<th>Album</th>';
    html += '<th>Genre</th>';
    if (panelType === 'book' || panelType === 'visual') html += '<th>Lang</th>';
    html += '<th>Date</th><th>Status</th><th>Rating</th><th></th></tr></thead><tbody>';
    let rowNum = 0;
    for (const e of entries) {
        rowNum++;
        const dateDisplay = e.dateStarted ? new Date(e.dateStarted + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        html += `<tr id="media-row-${e.id}">`;
        if (panelType === 'book') html += `<td style="font-size:11px;color:var(--gray-400);text-align:center;">${rowNum}</td>`;
        if (panelType === 'visual') html += `<td><span style="padding:2px 8px;border-radius:4px;font-size:11px;background:${e.type==='movie'?'var(--blue-light)':'var(--primary)'};color:${e.type==='movie'?'var(--blue)':'white'};text-transform:capitalize;">${esc(e.type)}</span></td>`;
        html += `<td style="font-weight:500;">${esc(e.title)}</td>`;
        html += `<td>${esc(e.creator || '—')}</td>`;
        if (panelType === 'music') html += `<td>${esc(e.album || '—')}</td>`;
        html += `<td>${esc(e.genre || '—')}</td>`;
        if (panelType === 'book' || panelType === 'visual') {
            const langs = (e.language || '').split(',').filter(Boolean);
            if (langs.length === 0) {
                html += '<td style="font-size:11px;color:var(--gray-400);">EN</td>';
            } else {
                html += '<td>' + langs.map(l => `<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:var(--primary);color:white;margin-right:2px;">${LANGUAGE_LABELS[l] || l.toUpperCase()}</span>`).join('') + '</td>';
            }
        }
        html += `<td style="font-size:12px;color:var(--gray-500);">${dateDisplay}</td>`;
        html += `<td><span style="padding:2px 8px;border-radius:4px;font-size:11px;background:${STATUS_COLORS[e.status]||'var(--gray-100)'};color:${STATUS_TEXT_COLORS[e.status]||'var(--gray-600)'};">${STATUS_LABELS[e.status]||e.status}</span></td>`;
        html += `<td style="font-size:14px;">${renderStars(e.rating)}</td>`;
        html += `<td style="white-space:nowrap;">
            <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineEditMedia('${e.id}','${panelType}')">Edit</button>
            <button class="btn" style="padding:3px 8px;font-size:11px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="deleteMedia('${e.id}')">Del</button>
        </td></tr>`;
    }
    return html + '</tbody></table>';
}

function inlineEditMedia(id, panelType) {
    const entry = mediaEntries.find(e => e.id === id);
    if (!entry) return;
    const is = 'style="padding:4px 6px;font-size:12px;width:100%;border:1px solid var(--gray-300);border-radius:4px;"';
    const row = document.getElementById('media-row-' + id);
    if (!row) return;
    const statusOpts = MEDIA_STATUSES.map(s => `<option value="${s}" ${s === entry.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('');
    const ratingOpts = '<option value="">—</option>' + [1,2,3,4,5].map(r => `<option value="${r}" ${r == entry.rating ? 'selected' : ''}>${r}</option>`).join('');

    let html = '';
    if (panelType === 'book') html += '<td></td>';
    if (panelType === 'visual') {
        const typeOpts = ['movie','show'].map(t => `<option value="${t}" ${t === entry.type ? 'selected' : ''}>${t}</option>`).join('');
        html += `<td><select id="ie-type-${id}" ${is}>${typeOpts}</select></td>`;
    }
    html += `<td><input type="text" value="${esc(entry.title)}" id="ie-title-${id}" ${is}></td>`;
    html += `<td><input type="text" value="${esc(entry.creator||'')}" id="ie-creator-${id}" ${is}></td>`;
    if (panelType === 'music') html += `<td><input type="text" value="${esc(entry.album||'')}" id="ie-album-${id}" ${is}></td>`;
    html += `<td><input type="text" value="${esc(entry.genre||'')}" id="ie-genre-${id}" ${is}></td>`;
    if (panelType === 'book' || panelType === 'visual') {
        html += `<td>${buildLangCheckboxes('ie-lang-' + id, entry.language || '')}</td>`;
    }
    html += `<td><input type="date" value="${esc(entry.dateStarted||'')}" id="ie-date-${id}" ${is}></td>`;
    html += `<td><select id="ie-status-${id}" ${is}>${statusOpts}</select></td>`;
    html += `<td><select id="ie-rating-${id}" ${is}>${ratingOpts}</select></td>`;
    html += `<td style="white-space:nowrap;">
        <button class="btn btn-primary" style="padding:3px 8px;font-size:11px;margin-right:4px;" onclick="inlineSaveMedia('${id}','${panelType}')">Save</button>
        <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="renderMedia()">Cancel</button>
    </td>`;
    row.innerHTML = html;
}

async function inlineSaveMedia(id, panelType) {
    const entry = mediaEntries.find(e => e.id === id);
    const payload = {
        id,
        type: panelType === 'visual' ? document.getElementById('ie-type-' + id).value : entry.type,
        title: document.getElementById('ie-title-' + id).value.trim(),
        creator: document.getElementById('ie-creator-' + id).value.trim(),
        genre: document.getElementById('ie-genre-' + id).value.trim(),
        dateStarted: document.getElementById('ie-date-' + id).value,
        status: document.getElementById('ie-status-' + id).value,
        rating: document.getElementById('ie-rating-' + id).value,
    };
    if (panelType === 'music') payload.album = document.getElementById('ie-album-' + id).value.trim();
    if (panelType === 'book' || panelType === 'visual') payload.language = readLangCheckboxes('ie-lang-' + id);
    if (!payload.title) { showToast('Title is required.', 'error'); return; }
    try {
        await apiFetch('/api/media', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Updated.', 'success');
        await loadMedia();
    } catch (e) {}
}

async function saveMedia(type) {
    const payload = { type };
    if (type === 'book') {
        payload.title = document.getElementById('mediaBookTitle').value.trim();
        payload.creator = document.getElementById('mediaBookCreator').value.trim();
        payload.genre = document.getElementById('mediaBookGenre').value.trim();
        payload.language = readLangCheckboxes('mediaBookLanguage');
        payload.dateStarted = document.getElementById('mediaBookDate').value;
        payload.status = document.getElementById('mediaBookStatus').value;
        payload.rating = document.getElementById('mediaBookRating').value;
    } else if (type === 'music') {
        payload.title = document.getElementById('mediaMusicTitle').value.trim();
        payload.creator = document.getElementById('mediaMusicCreator').value.trim();
        payload.genre = document.getElementById('mediaMusicGenre').value.trim();
        payload.album = document.getElementById('mediaMusicAlbum').value.trim();
        payload.dateStarted = document.getElementById('mediaMusicDate').value;
        payload.status = document.getElementById('mediaMusicStatus').value;
        payload.rating = document.getElementById('mediaMusicRating').value;
    }
    if (!payload.title) { showToast('Title is required.', 'error'); return; }
    try {
        await apiFetch('/api/media', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Added.', 'success');
        clearMediaForm(type);
        await loadMedia();
    } catch (e) {}
}

function saveMediaVisual() {
    const type = document.getElementById('mediaVisualType').value;
    const payload = {
        type,
        title: document.getElementById('mediaVisualTitle').value.trim(),
        creator: document.getElementById('mediaVisualCreator').value.trim(),
        genre: document.getElementById('mediaVisualGenre').value.trim(),
        language: readLangCheckboxes('mediaVisualLanguage'),
        dateStarted: document.getElementById('mediaVisualDate').value,
        status: document.getElementById('mediaVisualStatus').value,
        rating: document.getElementById('mediaVisualRating').value,
    };
    if (!payload.title) { showToast('Title is required.', 'error'); return; }
    apiFetch('/api/media', { method: 'POST', body: JSON.stringify(payload) })
        .then(() => {
            showToast('Added.', 'success');
            clearMediaForm('visual');
            loadMedia();
        })
        .catch(() => {});
}

function clearMediaForm(type) {
    if (type === 'book') {
        ['mediaBookTitle','mediaBookCreator','mediaBookGenre'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('mediaBookStatus'); if (sel) sel.value = 'want';
        const rat = document.getElementById('mediaBookRating'); if (rat) rat.value = '';
        document.querySelectorAll('input[name="mediaBookLanguage"]').forEach(c => c.checked = false);
        const dt = document.getElementById('mediaBookDate'); if (dt) dt.value = '';
    } else if (type === 'visual') {
        ['mediaVisualTitle','mediaVisualCreator','mediaVisualGenre'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('mediaVisualStatus'); if (sel) sel.value = 'want';
        const rat = document.getElementById('mediaVisualRating'); if (rat) rat.value = '';
        const tp = document.getElementById('mediaVisualType'); if (tp) tp.value = 'movie';
        document.querySelectorAll('input[name="mediaVisualLanguage"]').forEach(c => c.checked = false);
        const dt = document.getElementById('mediaVisualDate'); if (dt) dt.value = '';
    } else if (type === 'music') {
        ['mediaMusicTitle','mediaMusicCreator','mediaMusicGenre','mediaMusicAlbum'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const sel = document.getElementById('mediaMusicStatus'); if (sel) sel.value = 'want';
        const rat = document.getElementById('mediaMusicRating'); if (rat) rat.value = '';
        const dt = document.getElementById('mediaMusicDate'); if (dt) dt.value = '';
    }
}

function deleteMedia(id) {
    const entry = mediaEntries.find(e => e.id === id);
    const name = entry ? entry.title : '';
    pendingConfirmAction = async () => {
        try {
            await apiFetch('/api/media', { method: 'DELETE', body: JSON.stringify({ id }) });
            showToast('Deleted "' + name + '".', 'success');
            await loadMedia();
        } catch (e) {
            showToast('Failed to delete entry.', 'error');
        }
    };
    document.getElementById('modalTitle').textContent = 'Delete Entry';
    document.getElementById('modalMessage').textContent = `Delete "${name}"? This cannot be undone.`;
    document.getElementById('confirmModal').classList.add('active');
}

function renderMediaStats() {
    const container = document.getElementById('mediaStatsContent');
    const books = mediaEntries.filter(e => e.type === 'book');
    const movies = mediaEntries.filter(e => e.type === 'movie');
    const shows = mediaEntries.filter(e => e.type === 'show');
    const music = mediaEntries.filter(e => e.type === 'music');
    const all = mediaEntries;

    if (all.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No media entries yet. Add some books, movies, shows, or music to see stats.</p></div>';
        return;
    }

    let html = '';

    // Overview stats
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">';
    html += `<div class="stat-card" style="border-left:4px solid var(--blue);"><div class="label">Books</div><div class="value">${books.length}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--red);"><div class="label">Movies</div><div class="value">${movies.length}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--yellow);"><div class="label">Shows</div><div class="value">${shows.length}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--green);"><div class="label">Music</div><div class="value">${music.length}</div></div>`;
    html += '</div>';

    // Status breakdown
    html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Status Breakdown</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">';
    const wantCount = all.filter(e => e.status === 'want').length;
    const progressCount = all.filter(e => e.status === 'in-progress').length;
    const finishedCount = all.filter(e => e.status === 'finished').length;
    const droppedCount = all.filter(e => e.status === 'dropped').length;
    html += `<div class="stat-card" style="border-left:4px solid var(--blue);"><div class="label">Want</div><div class="value">${wantCount}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--yellow);"><div class="label">In Progress</div><div class="value">${progressCount}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--green);"><div class="label">Finished</div><div class="value">${finishedCount}</div></div>`;
    html += `<div class="stat-card" style="border-left:4px solid var(--gray-400);"><div class="label">Dropped</div><div class="value">${droppedCount}</div></div>`;
    html += '</div>';

    // Completion rate
    const total = all.length;
    const completionPct = total > 0 ? (finishedCount / total * 100) : 0;
    html += '<div style="margin-bottom:24px;">';
    html += `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>Completion Rate</span><span>${finishedCount}/${total} (${completionPct.toFixed(0)}%)</span></div>`;
    html += `<div style="height:20px;background:var(--gray-100);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${completionPct}%;background:var(--green);border-radius:4px;transition:width 0.3s;"></div></div>`;
    html += '</div>';

    // Rating distribution for finished items
    const rated = all.filter(e => e.status === 'finished' && parseInt(e.rating) > 0);
    if (rated.length > 0) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Rating Distribution</h3>';
        const ratingCounts = [0, 0, 0, 0, 0];
        for (const e of rated) ratingCounts[(parseInt(e.rating) || 1) - 1]++;
        const maxRating = Math.max(...ratingCounts, 1);
        html += '<div style="display:flex;align-items:end;gap:12px;height:100px;margin-bottom:24px;">';
        for (let i = 0; i < 5; i++) {
            const h = Math.max((ratingCounts[i] / maxRating) * 100, 4);
            html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;">
                <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">${ratingCounts[i]}</div>
                <div style="width:100%;max-width:48px;height:${h}%;background:var(--yellow);border-radius:4px 4px 0 0;opacity:0.8;"></div>
                <div style="margin-top:4px;font-size:13px;color:var(--gray-600);">${i + 1} &#9733;</div>
            </div>`;
        }
        html += '</div>';

        const avgRating = rated.reduce((s, e) => s + (parseInt(e.rating) || 0), 0) / rated.length;
        html += `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:16px;font-size:13px;color:var(--gray-600);margin-bottom:24px;">
            <strong>Average rating:</strong> ${avgRating.toFixed(1)} / 5 across ${rated.length} rated items.
        </div>`;
    }

    // Genre breakdown
    const genreCounts = {};
    for (const e of all) {
        const g = (e.genre || 'Untagged').trim();
        if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    const genreEntries = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
    if (genreEntries.length > 0) {
        html += '<h3 style="font-size:15px;margin-bottom:12px;color:var(--gray-700);">Top Genres</h3>';
        html += '<div style="min-width:300px;margin-bottom:24px;">';
        for (let i = 0; i < Math.min(genreEntries.length, 10); i++) {
            const [genre, count] = genreEntries[i];
            const pct = total > 0 ? (count / total * 100) : 0;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            html += `<div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;">
                    <span>${esc(genre)}</span>
                    <span style="color:var(--gray-500);">${count} (${pct.toFixed(0)}%)</span>
                </div>
                <div style="height:20px;background:var(--gray-100);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
                </div>
            </div>`;
        }
        html += '</div>';
    }

    container.innerHTML = html;
}
