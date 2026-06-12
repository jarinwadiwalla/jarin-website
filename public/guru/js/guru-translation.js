/* ==========================================================================
   Guru Dashboard — Translation Module (Persian audio → 3-lane transcript)

   v4.5.0:
     step 1 — upload to R2 (playlist=translation) + sessions list
     step 2 — Whisper transcription, render Persian segments
     step 3 — Claude pass for Latin + English + per-word definitions/roots,
              click-to-define on every Persian word
   ========================================================================== */

let translationSessions = [];          // R2 tracks merged with D1 status
let translationStatusByKey = {};       // audioKey → D1 row metadata
let currentTranslationSession = null;  // { key, audio, segments, translation }
const TRANSLATION_PLAYLIST = 'translation';

function _translationFmtBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function _translationFmtDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
        return iso;
    }
}

function _translationFmtClock(sec) {
    if (sec == null || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function _translationStatusBadge(status) {
    const map = {
        uploaded:     { label: 'Not transcribed', color: 'var(--gray-500)' },
        transcribing: { label: 'Transcribing…',    color: 'var(--blue)' },
        transcribed:  { label: 'Transcribed',      color: 'var(--green)' },
        translating:  { label: 'Translating…',     color: 'var(--blue)' },
        ready:        { label: 'Ready',            color: 'var(--green)' },
        failed:       { label: 'Failed',           color: 'var(--red)' },
    };
    const m = map[status] || map.uploaded;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${m.color};color:#fff;">${m.label}</span>`;
}

async function loadTranslationSessions() {
    const listEl = document.getElementById('translationSessionsList');
    if (!listEl) return;
    try {
        const [tracksRes, sessionsRes] = await Promise.all([
            apiFetch(`/api/audio?playlist=${TRANSLATION_PLAYLIST}`),
            apiFetch('/api/translation/sessions'),
        ]);
        translationStatusByKey = {};
        for (const s of (sessionsRes.sessions || [])) {
            translationStatusByKey[s.audioKey] = s;
        }
        translationSessions = (tracksRes.tracks || []).map((t) => {
            const row = translationStatusByKey[t.key];
            // Prefer the user-set D1 title over the auto-derived R2 filename
            return {
                ...t,
                displayTitle: row?.title || t.name || t.key,
                status: row?.status || 'uploaded',
                durationSec: row?.durationSec || 0,
            };
        }).sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
        renderTranslationSessions();
    } catch (e) {
        listEl.innerHTML = `<div style="color:var(--red);">Couldn't load sessions: ${esc(e.message)}</div>`;
    }
}

function renderTranslationSessions() {
    const listEl = document.getElementById('translationSessionsList');
    if (!listEl) return;
    if (!translationSessions.length) {
        listEl.innerHTML = `<div style="padding:16px;background:var(--gray-50);border-radius:8px;color:var(--gray-500);">No sessions yet. Upload a WhatsApp voice note above to get started.</div>`;
        return;
    }
    const rows = translationSessions.map(t => {
        const name = esc(t.displayTitle);
        const meta = [_translationFmtDate(t.uploaded), _translationFmtBytes(t.size)].filter(Boolean).join(' · ');
        const key = esc(t.key);
        const badge = _translationStatusBadge(t.status);
        return `<tr>
            <td style="padding:10px 8px;border-bottom:1px solid var(--gray-200);">
                <div style="font-weight:600;color:var(--gray-800);display:flex;align-items:center;gap:6px;">
                    <span>${name}</span>
                    <button class="btn-icon" title="Rename" onclick="renameTranslationSession('${key}')" style="background:none;border:none;cursor:pointer;color:var(--gray-500);padding:2px 4px;font-size:13px;line-height:1;">✎</button>
                </div>
                <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">${esc(meta)} · ${badge}</div>
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid var(--gray-200);text-align:right;white-space:nowrap;">
                <button class="btn btn-secondary btn-sm" onclick="openTranslationSession('${key}')">Open</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTranslationSession('${key}')">Delete</button>
            </td>
        </tr>`;
    }).join('');
    listEl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>`;
}

async function uploadTranslationAudio(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const progress = document.getElementById('translationUploadProgress');
    let done = 0;
    let failed = 0;
    for (const file of files) {
        progress.textContent = `Uploading ${file.name} (${done + 1}/${files.length})…`;
        const form = new FormData();
        form.append('file', file);
        form.append('playlist', TRANSLATION_PLAYLIST);
        try {
            await apiFetch('/api/audio', { method: 'POST', body: form, raw: true });
            done++;
        } catch (e) {
            failed++;
        }
    }
    progress.textContent = failed
        ? `Done — ${done} uploaded, ${failed} failed.`
        : `Done — ${done} file${done !== 1 ? 's' : ''} uploaded.`;
    document.getElementById('translationFileInput').value = '';
    setTimeout(() => { progress.textContent = ''; }, 4000);
    await loadTranslationSessions();
}

async function openTranslationSession(key) {
    const session = translationSessions.find(t => t.key === key);
    if (!session) return;
    document.getElementById('translationSessionsView').style.display = 'none';
    document.getElementById('translationSessionDetail').style.display = '';
    setTranslationDetailTitle(session.displayTitle, key);
    const meta = [_translationFmtDate(session.uploaded), _translationFmtBytes(session.size)].filter(Boolean).join(' · ');
    document.getElementById('translationSessionMeta').innerHTML =
        `${esc(meta)} · ${_translationStatusBadge(session.status)}`;
    const audio = document.getElementById('translationAudio');
    audio.src = (API_BASE || '') + session.url;
    audio.load();
    currentTranslationSession = { key, audio, transcript: null, translation: null, title: session.displayTitle };

    try {
        const data = await apiFetch(`/api/translation/sessions?audioKey=${encodeURIComponent(key)}`);
        const row = data.session;
        currentTranslationSession.transcript  = row?.transcript  || null;
        currentTranslationSession.translation = row?.translation || null;
        renderTranslationDetail();
    } catch (e) {
        document.getElementById('translationTranscriptArea').innerHTML =
            `<div style="color:var(--red);">Couldn't load session data: ${esc(e.message)}</div>`;
    }
}

function renderTranslationDetail() {
    const area = document.getElementById('translationTranscriptArea');
    if (!area || !currentTranslationSession) return;
    const { transcript, translation } = currentTranslationSession;

    if (translation?.segments?.length) {
        renderTranslationFullView(transcript, translation);
    } else if (transcript?.segments?.length) {
        renderTranslationOnlyTranscript(transcript);
    } else {
        renderTranslationEmpty();
    }
}

function renderTranslationEmpty() {
    document.getElementById('translationTranscriptArea').innerHTML = `
        <p style="margin:0 0 12px;">No transcript yet. Press <strong>Transcribe</strong> to run Whisper on this file (language: Persian).</p>
        <button class="btn btn-primary" onclick="runTranslationTranscribe()">Transcribe with Whisper</button>
    `;
}

function renderTranslationOnlyTranscript(transcript) {
    const area = document.getElementById('translationTranscriptArea');
    const segments = transcript.segments || [];
    const segHtml = segments.map((s) => `
        <div class="tx-segment" data-start="${s.start}" style="display:flex;gap:12px;padding:8px 10px;border-radius:6px;cursor:pointer;align-items:flex-start;">
            <button class="tx-seek" style="background:none;border:none;color:var(--blue);font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:2px 6px;cursor:pointer;flex-shrink:0;">${_translationFmtClock(s.start)}</button>
            <div dir="rtl" lang="fa" style="font-size:18px;line-height:1.7;flex:1;">${esc(s.text)}</div>
        </div>`).join('');

    area.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
            <div style="font-size:12px;color:var(--gray-500);">${segments.length} segment${segments.length !== 1 ? 's' : ''} · ${_translationFmtClock(transcript.duration)} · Whisper</div>
            <div style="display:flex;gap:6px;">
                <button class="btn btn-primary" onclick="runTranslationTranslate()">Translate with Claude</button>
                <button class="btn btn-secondary btn-sm" onclick="runTranslationTranscribe()">Re-transcribe</button>
            </div>
        </div>
        <div id="translationSegments">${segHtml}</div>
    `;
    wireSeekHandlers(segments);
}

function renderTranslationFullView(transcript, translation) {
    const area = document.getElementById('translationTranscriptArea');
    const segments = translation.segments || [];

    const segHtml = segments.map((s, i) => {
        const wordsHtml = (s.words || []).map((w, j) =>
            `<span class="tx-word" data-i="${i}" data-j="${j}" style="cursor:pointer;border-bottom:1px dotted var(--gray-400);padding:0 2px;">${esc(w.fa)}</span>`
        ).join(' ');
        const faDisplay = wordsHtml || esc(s.fa || '');
        return `
        <div class="tx-segment" data-start="${s.start}" style="display:grid;grid-template-columns:60px 1fr;gap:12px;padding:10px;border-radius:6px;border-bottom:1px solid var(--gray-100);">
            <button class="tx-seek" style="background:none;border:none;color:var(--blue);font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:2px 6px;cursor:pointer;text-align:left;align-self:start;">${_translationFmtClock(s.start)}</button>
            <div>
                <div dir="rtl" lang="fa" style="font-size:20px;line-height:2;color:var(--gray-800);">${faDisplay}</div>
                <div lang="fa-Latn" style="font-size:14px;line-height:1.6;color:var(--gray-600);font-style:italic;margin-top:4px;">${esc(s.latin || '')}</div>
                <div style="font-size:14px;line-height:1.6;color:var(--gray-700);margin-top:4px;">${esc(s.en || '')}</div>
                <div style="margin-top:6px;display:flex;justify-content:flex-end;">
                    <button class="tx-add-phrase btn btn-secondary btn-sm" data-i="${i}" style="font-size:11px;padding:3px 10px;">+ Save as phrase</button>
                </div>
            </div>
        </div>`;
    }).join('');

    area.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
            <div style="font-size:12px;color:var(--gray-500);">${segments.length} segment${segments.length !== 1 ? 's' : ''} · ${_translationFmtClock(transcript?.duration)} · Whisper + Claude (${esc(translation.model || 'claude')})</div>
            <div style="display:flex;gap:6px;">
                <button class="btn btn-secondary btn-sm" onclick="runTranslationTranslate()">Re-translate</button>
                <button class="btn btn-secondary btn-sm" onclick="runTranslationTranscribe()">Re-transcribe</button>
            </div>
        </div>
        <p style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Click any Persian word for its meaning + root. Click the timestamp to seek.</p>
        <div id="translationSegments" style="position:relative;">
            ${segHtml}
            <div id="translationWordTooltip" style="display:none;position:absolute;z-index:10;background:#fff;border:1px solid var(--gray-300);box-shadow:0 4px 12px rgba(0,0,0,0.12);border-radius:8px;padding:10px 12px;min-width:200px;max-width:320px;"></div>
        </div>
    `;
    wireSeekHandlers(segments);
}

function wireSeekHandlers(segments) {
    const area = document.getElementById('translationTranscriptArea');
    const audio = currentTranslationSession.audio;
    area.querySelectorAll('.tx-seek').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const seg = btn.closest('.tx-segment');
            const start = parseFloat(seg?.dataset.start);
            if (!isNaN(start)) { audio.currentTime = start; audio.play().catch(() => {}); }
        });
    });
    audio.ontimeupdate = () => {
        const t = audio.currentTime;
        let activeIdx = -1;
        for (let i = 0; i < segments.length; i++) {
            if (t >= segments[i].start && t < segments[i].end) { activeIdx = i; break; }
        }
        area.querySelectorAll('.tx-segment').forEach((el, i) => {
            el.style.background = (i === activeIdx) ? 'var(--yellow-light, #fff8d6)' : '';
        });
    };
}

// Mirror of clampTooltipLeft in functions/lib/translation.js — keep in sync.
// (The browser bundle is a script concat, not an ESM build, so it can't
// import from the lib. The tests import the lib version directly.)
function _clampTooltipLeft(wordLeft, containerLeft, containerWidth, tooltipWidth) {
    const raw = wordLeft - containerLeft;
    const maxLeft = containerWidth - tooltipWidth;
    if (maxLeft <= 0) return 0;
    return Math.max(0, Math.min(maxLeft, raw));
}

// Wire word-click handlers exactly once at module load. Re-rendering the
// transcript area replaces children — but the persistent `document`
// listener keeps working via event delegation, reading the *current*
// session's segments from module state. This avoids the listener-leak +
// stale-closure bug in v4.5.0/v4.5.1 where every re-render added a fresh
// pair of listeners.
(function wireTranslationWordClicksOnce() {
    const ready = () => {
        document.addEventListener('click', (e) => {
            // Save-word button (inside the word tooltip). Takes precedence
            // over the dismiss-on-outside-click handler below.
            const addWordBtn = e.target.closest('.tx-add-word');
            if (addWordBtn) {
                e.stopPropagation();
                const i = parseInt(addWordBtn.dataset.i, 10);
                const j = parseInt(addWordBtn.dataset.j, 10);
                saveTranslationWordToGoldList(i, j, addWordBtn);
                return;
            }
            // Save-phrase button (inside each segment)
            const addPhraseBtn = e.target.closest('.tx-add-phrase');
            if (addPhraseBtn) {
                e.stopPropagation();
                const i = parseInt(addPhraseBtn.dataset.i, 10);
                saveTranslationPhraseToGoldList(i, addPhraseBtn);
                return;
            }

            const tooltip = document.getElementById('translationWordTooltip');
            if (!tooltip) return;

            const wordEl = e.target.closest('.tx-word');
            if (!wordEl) {
                // Click anywhere outside a word → dismiss. (Clicks inside
                // the tooltip itself are also "outside a word" but we want
                // those to leave the tooltip open.)
                if (!e.target.closest('#translationWordTooltip')) {
                    tooltip.style.display = 'none';
                }
                return;
            }

            const i = parseInt(wordEl.dataset.i, 10);
            const j = parseInt(wordEl.dataset.j, 10);
            const segments = currentTranslationSession?.translation?.segments || [];
            const w = segments[i]?.words?.[j];
            if (!w) return;

            const rootLine = w.root
                ? `<div style="margin-top:6px;font-size:12px;color:var(--gray-600);">Root: <span dir="rtl" lang="fa">${esc(w.root)}</span>${w.root_latin ? ` · <em>${esc(w.root_latin)}</em>` : ''}${w.root_en ? ` · ${esc(w.root_en)}` : ''}</div>`
                : '';
            tooltip.innerHTML = `
                <div dir="rtl" lang="fa" style="font-size:18px;font-weight:600;color:var(--gray-800);">${esc(w.fa)}</div>
                <div style="font-size:13px;font-style:italic;color:var(--gray-600);margin-top:2px;">${esc(w.latin || '')}</div>
                <div style="font-size:14px;color:var(--gray-800);margin-top:4px;">${esc(w.en || '')}</div>
                ${rootLine}
                <div style="margin-top:8px;text-align:right;">
                    <button class="tx-add-word btn btn-primary btn-sm" data-i="${i}" data-j="${j}" style="font-size:12px;padding:4px 10px;">+ Add to Gold List</button>
                </div>
            `;

            // Position below the clicked word, relative to the segments
            // container (the tooltip's positioned ancestor — both have
            // position:relative/absolute set in renderTranslationFullView).
            const container = document.getElementById('translationSegments');
            if (!container) return;
            tooltip.style.display = 'block';
            const wordRect = wordEl.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            // Show first to measure width, then clamp into the container
            const left = _clampTooltipLeft(wordRect.left, contRect.left, contRect.width, tooltip.offsetWidth);
            const top  = wordRect.bottom - contRect.top + 4;
            tooltip.style.left = left + 'px';
            tooltip.style.top  = top  + 'px';
        });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }
})();

async function runTranslationTranscribe() {
    if (!currentTranslationSession) return;
    const area = document.getElementById('translationTranscriptArea');
    area.innerHTML = `<em>Transcribing with Whisper… (typically 5–15 seconds for a 1-minute clip)</em>`;
    try {
        const data = await apiFetch('/api/translation/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audioKey: currentTranslationSession.key }),
        });
        if (data?.transcript) {
            currentTranslationSession.transcript = data.transcript;
            currentTranslationSession.translation = null; // a fresh transcript invalidates the old translation
            renderTranslationDetail();
            loadTranslationSessions();
        } else {
            area.innerHTML = `<div style="color:var(--red);">Transcription returned no segments.</div>`;
        }
    } catch (e) {
        area.innerHTML = `<div style="color:var(--red);">Transcription failed: ${esc(e.message)}</div>`;
    }
}

async function runTranslationTranslate() {
    if (!currentTranslationSession) return;
    const area = document.getElementById('translationTranscriptArea');
    const key = currentTranslationSession.key;

    // Loop through the transcript in slices. Each call covers up to ~6
    // segments which keeps every individual Claude request well under
    // Cloudflare's 100s origin timeout (the v4.5.0 single-shot call
    // exceeded it on longer transcripts → 524 errors).
    let fromIndex = 0;
    area.innerHTML = `<em>Translating with Claude Sonnet 4.6…</em>`;

    try {
        // First call: server tells us the total
        let data = await apiFetch('/api/translation/translate', {
            method: 'POST',
            body: JSON.stringify({ audioKey: key, fromIndex }),
        });
        const total = data?.total || 0;

        const updateProgress = (done) => {
            const note = document.getElementById('translationProgressNote');
            if (note) note.textContent = `Translating ${done}/${total}…`;
        };

        // Render an initial view from the first batch so the user sees
        // segments appear immediately
        currentTranslationSession.translation = data.translation;
        renderTranslationDetail();
        const progressEl = document.createElement('div');
        progressEl.id = 'translationProgressNote';
        progressEl.style.cssText = 'font-size:13px;color:var(--blue);margin-bottom:8px;font-weight:600;';
        progressEl.textContent = `Translating ${data.toIndex}/${total}…`;
        const segWrap = document.getElementById('translationSegments');
        if (segWrap) segWrap.parentElement.insertBefore(progressEl, segWrap);

        fromIndex = data.nextIndex;
        while (fromIndex != null) {
            data = await apiFetch('/api/translation/translate', {
                method: 'POST',
                body: JSON.stringify({ audioKey: key, fromIndex }),
            });
            currentTranslationSession.translation = data.translation;
            renderTranslationDetail();
            // re-attach progress note after each render
            const note = document.createElement('div');
            note.id = 'translationProgressNote';
            note.style.cssText = 'font-size:13px;color:var(--blue);margin-bottom:8px;font-weight:600;';
            const wrap = document.getElementById('translationSegments');
            if (wrap && data.nextIndex != null) wrap.parentElement.insertBefore(note, wrap);
            updateProgress(data.toIndex);
            fromIndex = data.nextIndex;
        }
        // Final render — no more progress text
        loadTranslationSessions();
    } catch (e) {
        const segWrap = document.getElementById('translationSegments');
        const errEl = document.createElement('div');
        errEl.style.cssText = 'color:var(--red);margin:8px 0;';
        errEl.textContent = `Translation failed: ${e.message}`;
        if (segWrap) segWrap.parentElement.insertBefore(errEl, segWrap);
        else area.innerHTML = `<div style="color:var(--red);">Translation failed: ${esc(e.message)}</div>`;
    }
}

async function renameTranslationSession(key) {
    const session = translationSessions.find(t => t.key === key);
    const current = session?.displayTitle || '';
    const next = window.prompt('New name for this session:', current);
    if (next == null) return; // cancelled
    const title = next.trim();
    if (!title || title === current) return;
    try {
        await apiFetch('/api/translation/sessions', {
            method: 'PATCH',
            body: JSON.stringify({ audioKey: key, title }),
        });
        showToast('Renamed', 'success');
        await loadTranslationSessions();
        // If the detail view is open for this session, update the heading
        // and the snapshot title used by Gold-List save buttons.
        if (currentTranslationSession?.key === key) {
            currentTranslationSession.title = title;
            setTranslationDetailTitle(title, key);
        }
    } catch (e) {
        showToast(`Rename failed: ${e.message}`, 'error');
    }
}

function setTranslationDetailTitle(title, key) {
    const el = document.getElementById('translationSessionTitle');
    if (!el) return;
    el.innerHTML = `
        <span>${esc(title)}</span>
        <button class="btn-icon" title="Rename" onclick="renameTranslationSession('${esc(key)}')" style="background:none;border:none;cursor:pointer;color:var(--gray-500);padding:2px 4px;font-size:15px;line-height:1;margin-left:6px;vertical-align:baseline;">✎</button>
    `;
}

function closeTranslationSession() {
    const audio = document.getElementById('translationAudio');
    audio.pause();
    audio.removeAttribute('src');
    audio.ontimeupdate = null;
    audio.load();
    currentTranslationSession = null;
    document.getElementById('translationSessionDetail').style.display = 'none';
    document.getElementById('translationSessionsView').style.display = '';
}

async function saveTranslationWordToGoldList(i, j, btn) {
    const segments = currentTranslationSession?.translation?.segments || [];
    const w = segments[i]?.words?.[j];
    if (!w || !w.fa) return;

    const sessionTitle = currentTranslationSession?.title || 'Translation session';
    const entry = {
        word:         w.fa,
        translation:  w.en    || '',
        romanization: w.latin || '',
        language:     'persian',
        notes:        `From Translation: ${sessionTitle}`,
    };
    if (w.root) {
        entry.rootFamily = w.root;
        entry.rootLanguage = 'persian';
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify(entry) });
        btn.textContent = '✓ Added';
        showToast(`Added "${w.fa}" to Gold List`, 'success');
        if (typeof loadGoldList === 'function') loadGoldList();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = originalLabel;
        showToast(`Save failed: ${e.message}`, 'error');
    }
}

async function saveTranslationPhraseToGoldList(i, btn) {
    const segments = currentTranslationSession?.translation?.segments || [];
    const s = segments[i];
    if (!s || !s.fa) return;

    const sessionTitle = currentTranslationSession?.title || 'Translation session';
    const entry = {
        word:         s.fa,
        translation:  s.en    || '',
        romanization: s.latin || '',
        language:     'persian',
        type:         'phrase',
        notes:        `From Translation: ${sessionTitle}`,
    };

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await apiFetch('/api/goldlist', { method: 'POST', body: JSON.stringify(entry) });
        btn.textContent = '✓ Saved as phrase';
        showToast('Phrase saved to Gold List', 'success');
        if (typeof loadGoldList === 'function') loadGoldList();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = originalLabel;
        showToast(`Save failed: ${e.message}`, 'error');
    }
}

async function deleteTranslationSession(key) {
    openModal('Delete session?', 'This permanently removes the audio file AND any saved transcript/translation.', 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/translation/sessions', { method: 'DELETE', body: JSON.stringify({ audioKey: key }) });
            showToast('Deleted', 'success');
            await loadTranslationSessions();
        } catch (e) {
            showToast(`Delete failed: ${e.message}`, 'error');
        }
    });
}

// Drag-and-drop wiring for the upload zone
(function wireTranslationDropzone() {
    const ready = () => {
        const zone = document.getElementById('translationUploadArea');
        if (!zone) return;
        const setHover = (on) => {
            zone.style.background = on ? 'var(--blue-light, #e6f0ff)' : 'var(--gray-50)';
            zone.style.borderColor = on ? 'var(--blue, #4a90e2)' : 'var(--gray-300)';
        };
        zone.addEventListener('dragover', (e) => { e.preventDefault(); setHover(true); });
        zone.addEventListener('dragleave', () => setHover(false));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            setHover(false);
            if (e.dataTransfer?.files?.length) uploadTranslationAudio(e.dataTransfer.files);
        });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }
})();
