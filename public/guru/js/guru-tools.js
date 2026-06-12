/* ==========================================================================
   Guru Dashboard — Tools Module
   Audio player, meditation timer, pomodoro, stopwatch, file management
   ========================================================================== */

// ==================== AUDIO PLAYER ====================
const audioEl = new Audio();
audioEl.crossOrigin = 'anonymous';

// Web Audio API bridge — keeps audio session alive when phone is locked
let audioCtx = null;
let audioSourceNode = null;

function ensureAudioContext() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioSourceNode = audioCtx.createMediaElementSource(audioEl);
        audioSourceNode.connect(audioCtx.destination);
    } catch (e) { /* fallback to plain HTML5 audio */ }
}

function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
}
let audioTracks = [];
let audioPlaylists = [];
let audioCurrentIdx = -1;
let audioCurrentPlaylist = '';
let audioManageMode = false;
let wakeLock = null;
let audioRepeatMode = 'off'; // 'off', 'all', 'one'
let audioUserPaused = false; // true when user explicitly pauses

// ==================== AUDIO TAG PARSING ====================
// Per-session cache of extracted metadata keyed by track URL.
// Each entry: { title, artist, album, coverBlobUrl, coverDataUrl }
const audioMetaCache = new Map();

// Synchsafe (ID3v2.4) integer — top bit of each byte is 0.
function _id3Synchsafe(dv, offset) {
    return (dv.getUint8(offset) << 21) | (dv.getUint8(offset + 1) << 14) | (dv.getUint8(offset + 2) << 7) | dv.getUint8(offset + 3);
}

function _decodeID3Text(buf, dataStart, frameSize) {
    if (frameSize < 1) return '';
    const enc = new DataView(buf).getUint8(dataStart);
    const bytes = new Uint8Array(buf, dataStart + 1, frameSize - 1);
    let str;
    try {
        if (enc === 1 || enc === 2) str = new TextDecoder('utf-16').decode(bytes);
        else if (enc === 3) str = new TextDecoder('utf-8').decode(bytes);
        else str = new TextDecoder('iso-8859-1').decode(bytes);
    } catch (_e) {
        str = new TextDecoder('utf-8').decode(bytes);
    }
    return str.replace(/\0+$/, '').trim();
}

function parseID3v2(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 10) return null;
    if (dv.getUint8(0) !== 0x49 || dv.getUint8(1) !== 0x44 || dv.getUint8(2) !== 0x33) return null;
    const major = dv.getUint8(3);
    const flags = dv.getUint8(5);
    const totalSize = _id3Synchsafe(dv, 6);
    let pos = 10;
    if (flags & 0x40) {
        const extSize = major === 4 ? _id3Synchsafe(dv, pos) : dv.getUint32(pos);
        pos += extSize;
    }
    const end = Math.min(pos + totalSize, buf.byteLength);
    const result = { title: null, artist: null, album: null, cover: null };

    while (pos < end - 10) {
        const id = String.fromCharCode(dv.getUint8(pos), dv.getUint8(pos + 1), dv.getUint8(pos + 2), dv.getUint8(pos + 3));
        if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
        const frameSize = major === 4 ? _id3Synchsafe(dv, pos + 4) : dv.getUint32(pos + 4);
        const dataStart = pos + 10;
        const dataEnd = dataStart + frameSize;
        if (dataEnd > end || frameSize <= 0) break;

        if (id === 'TIT2') result.title = _decodeID3Text(buf, dataStart, frameSize);
        else if (id === 'TPE1') result.artist = _decodeID3Text(buf, dataStart, frameSize);
        else if (id === 'TALB') result.album = _decodeID3Text(buf, dataStart, frameSize);
        else if (id === 'APIC') {
            // text encoding(1) + MIME(NUL-terminated) + picture type(1) + description(NUL-terminated) + picture data
            const enc = dv.getUint8(dataStart);
            let p = dataStart + 1;
            const mimeStart = p;
            while (p < dataEnd && dv.getUint8(p) !== 0) p++;
            const mime = new TextDecoder('iso-8859-1').decode(new Uint8Array(buf, mimeStart, p - mimeStart));
            p++; // null
            p++; // picture type
            if (enc === 1 || enc === 2) {
                // UTF-16 code units are 2 bytes — advance pair-by-pair so a high
                // byte of 0x00 inside a real character (e.g. the 'r' in "Cover")
                // can't be mistaken for the start of the 0x00 0x00 terminator,
                // which used to leave a stray null byte at the head of the cover
                // image data and prevented the browser from decoding the JPEG.
                while (p < dataEnd - 1 && !(dv.getUint8(p) === 0 && dv.getUint8(p + 1) === 0)) p += 2;
                p += 2;
            } else {
                while (p < dataEnd && dv.getUint8(p) !== 0) p++;
                p++;
            }
            if (p < dataEnd) {
                result.cover = { data: buf.slice(p, dataEnd), mime: mime || 'image/jpeg' };
            }
        }
        pos = dataEnd;
    }
    return result;
}

function _walkAtoms(dv, buf, start, end) {
    const out = {};
    let pos = start;
    while (pos < end - 8) {
        let size = dv.getUint32(pos);
        const type = String.fromCharCode(dv.getUint8(pos + 4), dv.getUint8(pos + 5), dv.getUint8(pos + 6), dv.getUint8(pos + 7));
        let headerSize = 8;
        if (size === 1) {
            // 64-bit extended size — high 32 bits ignored (audio files this big don't exist here)
            size = dv.getUint32(pos + 12);
            headerSize = 16;
        } else if (size === 0) {
            size = end - pos;
        }
        if (size < 8 || pos + size > end) break;
        out[type] = { start: pos + headerSize, end: pos + size };
        pos += size;
    }
    return out;
}

function _readMP4DataAtom(dv, buf, start, end) {
    const children = _walkAtoms(dv, buf, start, end);
    if (!children.data) return null;
    const cs = children.data.start;
    const ce = children.data.end;
    // data atom: type(4) + locale(4) + payload
    if (ce - cs < 8) return null;
    const dataType = dv.getUint32(cs);
    return { type: dataType, data: buf.slice(cs + 8, ce) };
}

function _findMoov(dv, buf) {
    // Fast path: walk top-level atoms from offset 0 (moov at start — modern fast-start MP4).
    const top = _walkAtoms(dv, buf, 0, buf.byteLength);
    if (top.moov) return { start: top.moov.start, end: top.moov.end };
    // Slow path: scan for the literal 'moov' signature so we can also parse
    // tail-fetched buffers (older iTunes M4As put moov at the end of the file).
    const u8 = new Uint8Array(buf);
    for (let i = 0; i + 8 <= u8.length; i++) {
        if (u8[i + 4] === 0x6d && u8[i + 5] === 0x6f && u8[i + 6] === 0x6f && u8[i + 7] === 0x76) {
            const size = dv.getUint32(i);
            if (size >= 8 && i + size <= buf.byteLength) {
                return { start: i + 8, end: i + size };
            }
        }
    }
    return null;
}

function parseMP4(buf) {
    const dv = new DataView(buf);
    const moovBounds = _findMoov(dv, buf);
    if (!moovBounds) return null;
    const moov = _walkAtoms(dv, buf, moovBounds.start, moovBounds.end);
    if (!moov.udta) return null;
    const udta = _walkAtoms(dv, buf, moov.udta.start, moov.udta.end);
    if (!udta.meta) return null;
    // 'meta' has 4-byte version/flags prefix before children
    const meta = _walkAtoms(dv, buf, udta.meta.start + 4, udta.meta.end);
    if (!meta.ilst) return null;
    const ilst = _walkAtoms(dv, buf, meta.ilst.start, meta.ilst.end);

    const td = new TextDecoder('utf-8');
    const result = { title: null, artist: null, album: null, cover: null };
    const pick = (k) => {
        const it = ilst[k];
        if (!it) return null;
        return _readMP4DataAtom(dv, buf, it.start, it.end);
    };

    const nam = pick('\xa9nam');
    if (nam && nam.type === 1) result.title = td.decode(nam.data).replace(/\0+$/, '').trim();
    const art = pick('\xa9ART');
    if (art && art.type === 1) result.artist = td.decode(art.data).replace(/\0+$/, '').trim();
    const alb = pick('\xa9alb');
    if (alb && alb.type === 1) result.album = td.decode(alb.data).replace(/\0+$/, '').trim();
    const covr = pick('covr');
    if (covr) {
        // type 13 = JPEG, 14 = PNG
        const mime = covr.type === 14 ? 'image/png' : 'image/jpeg';
        result.cover = { data: covr.data, mime };
    }
    return result;
}

async function extractTrackMetadata(url) {
    try {
        // 512 KB covers most embedded tag blocks.
        const resp = await fetch(url, { headers: { Range: 'bytes=0-524287' } });
        if (!resp.ok && resp.status !== 206) return null;
        let buf = await resp.arrayBuffer();
        if (buf.byteLength < 8) return null;
        const dv = new DataView(buf);

        // ID3v2 (MP3)
        if (dv.getUint8(0) === 0x49 && dv.getUint8(1) === 0x44 && dv.getUint8(2) === 0x33) {
            // Tag total size lives in the header (synchsafe int + 10-byte header).
            // If the cover frame extends past our initial fetch, pull the full tag.
            const tagTotal = _id3Synchsafe(dv, 6) + 10;
            if (tagTotal > buf.byteLength && tagTotal <= 5 * 1024 * 1024) {
                try {
                    const r2 = await fetch(url, { headers: { Range: `bytes=0-${tagTotal - 1}` } });
                    if (r2.ok || r2.status === 206) buf = await r2.arrayBuffer();
                } catch (_e) { /* fall through with what we have */ }
            }
            return parseID3v2(buf);
        }
        // MP4 / M4A — 'ftyp' at offset 4
        if (dv.getUint8(4) === 0x66 && dv.getUint8(5) === 0x74 && dv.getUint8(6) === 0x79 && dv.getUint8(7) === 0x70) {
            const head = parseMP4(buf);
            if (head) return head;
            // moov atom may live at the end of the file (older iTunes exports);
            // grab the tail and let parseMP4 scan for the moov signature.
            try {
                const tailResp = await fetch(url, { headers: { Range: 'bytes=-524288' } });
                if (tailResp.ok || tailResp.status === 206) {
                    const tailBuf = await tailResp.arrayBuffer();
                    return parseMP4(tailBuf);
                }
            } catch (_e) { /* give up */ }
            return null;
        }
        return null;
    } catch (_e) {
        return null;
    }
}

async function loadAndApplyTrackMetadata(track) {
    if (!track || !track.url) return;
    let meta = audioMetaCache.get(track.url);
    if (!meta) {
        const parsed = await extractTrackMetadata(track.url);
        meta = parsed || {};
        if (parsed && parsed.cover) {
            const blob = new Blob([parsed.cover.data], { type: parsed.cover.mime });
            meta.coverBlobUrl = URL.createObjectURL(blob);
            meta.coverMime = parsed.cover.mime;
            delete meta.cover;
        }
        audioMetaCache.set(track.url, meta);
    }
    // Only apply if this track is still the current one
    if (audioTracks[audioCurrentIdx] === track) {
        applyTrackMetadata(track, meta);
    }
}

function applyTrackMetadata(track, meta) {
    const fallbackTitle = (track.name || '').replace(/\.[^.]+$/, '');
    const title = (meta && meta.title) || fallbackTitle;
    const artist = (meta && meta.artist) || '';
    const album = (meta && meta.album) || '';
    const coverUrl = meta && meta.coverBlobUrl;

    const titleEl = document.getElementById('audioTrackTitle');
    const artistEl = document.getElementById('audioTrackArtist');
    const albumEl = document.getElementById('audioTrackAlbum');
    const coverEl = document.getElementById('audioCoverArt');
    if (titleEl) titleEl.textContent = title;
    if (artistEl) { artistEl.textContent = artist; artistEl.style.display = artist ? '' : 'none'; }
    if (albumEl) { albumEl.textContent = album; albumEl.style.display = album ? '' : 'none'; }
    if (coverEl) {
        if (coverUrl) { coverEl.src = coverUrl; coverEl.style.display = ''; }
        else { coverEl.removeAttribute('src'); coverEl.style.display = 'none'; }
    }

    const miniName = document.getElementById('miniTrackName');
    const miniArtist = document.getElementById('miniTrackArtist');
    const miniCover = document.getElementById('miniCoverArt');
    if (miniName) miniName.textContent = title;
    if (miniArtist) { miniArtist.textContent = artist; miniArtist.style.display = artist ? '' : 'none'; }
    if (miniCover) {
        if (coverUrl) { miniCover.src = coverUrl; miniCover.style.display = ''; }
        else { miniCover.removeAttribute('src'); miniCover.style.display = 'none'; }
    }

    if ('mediaSession' in navigator) {
        const md = {
            title,
            artist: artist || track.playlist || 'Audio',
            album: album || track.playlist || 'Audio',
        };
        if (coverUrl) {
            md.artwork = [
                { src: coverUrl, sizes: '512x512', type: (meta && meta.coverMime) || 'image/jpeg' },
            ];
        }
        navigator.mediaSession.metadata = new MediaMetadata(md);
    }
}

function openAudioUpload() {
    document.getElementById('audioUploadArea').style.display =
        document.getElementById('audioUploadArea').style.display === 'none' ? 'block' : 'none';
}

function toggleAudioManage() {
    audioManageMode = !audioManageMode;
    document.getElementById('audioManageBtn').textContent = audioManageMode ? 'Done' : 'Manage';
    renderAudioTrackList();
}

function handleAudioDrop(e) {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'var(--gray-300)';
    handleAudioFiles(e.dataTransfer.files);
}

async function handleAudioFiles(files) {
    if (!files.length) return;
    const playlist = document.getElementById('audioPlaylistInput').value.trim() || 'default';
    const progress = document.getElementById('audioUploadProgress');
    const total = files.length;
    let done = 0;

    for (const file of files) {
        if (!file.type.startsWith('audio/')) continue;
        progress.textContent = `Uploading ${++done}/${total}: ${file.name}`;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('playlist', playlist);
        try {
            await apiFetch('/api/audio', { method: 'POST', body: formData, raw: true });
        } catch (e) {
            showToast(`Failed: ${file.name}`, 'error');
        }
    }
    progress.textContent = `Done! ${done} files uploaded.`;
    setTimeout(() => { progress.textContent = ''; }, 3000);
    document.getElementById('audioFileInput').value = '';
    loadAudioLibrary();
}

async function loadAudioLibrary() {
    try {
        const data = await apiFetch('/api/audio');
        audioTracks = data.tracks || [];
        audioPlaylists = data.playlists || [];
        // Cache track listing for offline access
        localStorage.setItem('audio-tracks', JSON.stringify(audioTracks));
        localStorage.setItem('audio-playlists', JSON.stringify(audioPlaylists));
    } catch (e) {
        // Offline fallback: load from localStorage
        const cached = localStorage.getItem('audio-tracks');
        if (cached) {
            audioTracks = JSON.parse(cached);
            audioPlaylists = JSON.parse(localStorage.getItem('audio-playlists') || '[]');
        }
    }
    renderAudioPlaylists();
    if (audioCurrentPlaylist) {
        await loadAudioOrder(audioCurrentPlaylist);
        renderAudioTrackList();
    } else if (audioPlaylists.length) {
        await selectAudioPlaylist(audioPlaylists[0]);
    } else {
        document.getElementById('audioTrackList').innerHTML =
            '<div style="text-align:center;padding:20px;color:var(--gray-400);">No audio uploaded yet. Click Upload to add tracks.</div>';
    }
}

function renderAudioPlaylists() {
    const container = document.getElementById('audioPlaylistTabs');
    container.innerHTML = audioPlaylists.map(pl =>
        `<button class="btn btn-sm ${pl === audioCurrentPlaylist ? 'btn-primary' : 'btn-secondary'}" onclick="selectAudioPlaylist('${pl}')">${pl}</button>`
    ).join('');
}

async function selectAudioPlaylist(pl) {
    audioCurrentPlaylist = pl;
    renderAudioPlaylists();
    await loadAudioOrder(pl);
    renderAudioTrackList();
}

const audioTrackOrder = {}; // playlist -> [keys] custom order

async function loadAudioOrder(playlist) {
    try {
        const data = await apiFetch(`/api/audio-order?playlist=${encodeURIComponent(playlist)}`);
        if (data.order && data.order.length) audioTrackOrder[playlist] = data.order;
    } catch (e) { /* no saved order */ }
}

async function saveAudioOrder(playlist, orderedKeys) {
    audioTrackOrder[playlist] = orderedKeys;
    try {
        await apiFetch('/api/audio-order', {
            method: 'PUT',
            body: JSON.stringify({ playlist, order: orderedKeys }),
        });
    } catch (e) {
        showToast('Failed to save order', 'error');
    }
}

function getOrderedTracks(playlist) {
    const filtered = audioTracks.filter(t => t.playlist === playlist);
    const order = audioTrackOrder[playlist];
    if (!order || !order.length) return filtered;
    // Sort by saved order, unrecognized keys go at the end
    const orderMap = new Map(order.map((k, i) => [k, i]));
    return [...filtered].sort((a, b) => {
        const ai = orderMap.has(a.key) ? orderMap.get(a.key) : 9999;
        const bi = orderMap.has(b.key) ? orderMap.get(b.key) : 9999;
        return ai - bi;
    });
}

let audioDragIdx = null;

async function renderAudioTrackList() {
    const container = document.getElementById('audioTrackList');
    const filtered = getOrderedTracks(audioCurrentPlaylist);

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);">No tracks in this playlist.</div>';
        updateOfflineBtn();
        return;
    }

    // Check which tracks are cached
    const cache = await caches.open('guru-audio-v1').catch(() => null);
    const cachedKeys = new Set();
    if (cache) {
        for (const t of filtered) {
            const match = await cache.match(t.url);
            if (match) cachedKeys.add(t.url);
        }
    }

    const otherPlaylists = audioPlaylists.filter(p => p !== audioCurrentPlaylist);

    container.innerHTML = filtered.map((t, i) => {
        const globalIdx = audioTracks.indexOf(t);
        const isPlaying = globalIdx === audioCurrentIdx;
        const name = t.name.replace(/\.[^.]+$/, '');
        const sizeMB = (t.size / (1024 * 1024)).toFixed(1);
        const isCached = cachedKeys.has(t.url);
        const offlineIcon = isCached
            ? `<span title="Saved offline" style="font-size:12px;color:var(--green);cursor:pointer;" onclick="event.stopPropagation();removeAudioOffline('${t.url}')">&#9745;</span>`
            : `<span title="Save offline" style="font-size:12px;color:var(--gray-300);cursor:pointer;" onclick="event.stopPropagation();saveAudioOffline('${t.url}')">&#9744;</span>`;

        let manageControls = '';
        if (audioManageMode) {
            const moveOptions = otherPlaylists.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
            manageControls = `
                <span draggable="true" data-drag-idx="${i}" style="cursor:grab;font-size:16px;color:var(--gray-400);padding:0 4px;user-select:none;" title="Drag to reorder" onclick="event.stopPropagation()">&#9776;</span>
                <select onchange="event.stopPropagation();moveAudioTrack('${t.key}', this.value);this.selectedIndex=0;" style="font-size:11px;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px;color:var(--gray-500);background:white;cursor:pointer;" onclick="event.stopPropagation()">
                    <option value="">Move to...</option>
                    ${moveOptions}
                    <option value="__new__">+ New playlist</option>
                </select>
                <button onclick="event.stopPropagation();deleteAudioTrack('${t.key}')" style="background:none;border:none;color:var(--coral);cursor:pointer;font-size:14px;" title="Delete">&#10005;</button>`;
        }

        return `<div data-track-idx="${i}" data-track-key="${t.key}" onclick="playAudioTrack(${globalIdx})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-radius:6px;transition:background 0.15s;${isPlaying ? 'background:var(--primary-light,#ede9fe);' : ''}" onmouseover="if(!this.classList.contains('drag-over'))this.style.background=this.style.background||'var(--gray-50)'" onmouseout="if(!this.classList.contains('drag-over'))this.style.background='${isPlaying ? 'var(--primary-light,#ede9fe)' : ''}'">
            <span style="font-size:16px;width:24px;text-align:center;">${isPlaying ? '&#128266;' : '&#127925;'}</span>
            <span style="flex:1;font-weight:${isPlaying ? '600' : '400'};color:${isPlaying ? 'var(--primary)' : 'var(--gray-700)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</span>
            ${offlineIcon}
            <span style="font-size:11px;color:var(--gray-400);">${sizeMB} MB</span>${manageControls}
        </div>`;
    }).join('');

    // Attach drag-and-drop listeners in manage mode
    if (audioManageMode) {
        container.querySelectorAll('[draggable="true"]').forEach(handle => {
            const row = handle.closest('[data-track-idx]');
            handle.addEventListener('dragstart', (e) => {
                audioDragIdx = parseInt(row.dataset.trackIdx);
                row.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });
            handle.addEventListener('dragend', () => {
                row.style.opacity = '1';
                container.querySelectorAll('[data-track-idx]').forEach(r => {
                    r.classList.remove('drag-over');
                    r.style.borderTop = '';
                    r.style.borderBottom = '';
                });
            });
        });
        container.querySelectorAll('[data-track-idx]').forEach(row => {
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const targetIdx = parseInt(row.dataset.trackIdx);
                container.querySelectorAll('[data-track-idx]').forEach(r => { r.style.borderTop = ''; r.style.borderBottom = ''; });
                if (targetIdx < audioDragIdx) row.style.borderTop = '2px solid var(--primary)';
                else if (targetIdx > audioDragIdx) row.style.borderBottom = '2px solid var(--primary)';
            });
            row.addEventListener('dragleave', () => {
                row.style.borderTop = '';
                row.style.borderBottom = '';
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                const targetIdx = parseInt(row.dataset.trackIdx);
                if (audioDragIdx === null || audioDragIdx === targetIdx) return;
                reorderAudioTrack(audioDragIdx, targetIdx);
                audioDragIdx = null;
            });
        });
    }

    updateOfflineBtn();
}

async function moveAudioTrack(key, newPlaylist) {
    if (!newPlaylist) return;
    if (newPlaylist === '__new__') {
        const name = prompt('New playlist name:');
        if (!name || !name.trim()) return;
        newPlaylist = name.trim();
    }
    try {
        await apiFetch('/api/audio', {
            method: 'PATCH',
            body: JSON.stringify({ key, newPlaylist }),
        });
        showToast(`Moved to ${newPlaylist}`, 'success');
        await loadAudioLibrary();
    } catch (e) {
        showToast('Failed to move track', 'error');
    }
}

async function reorderAudioTrack(fromIdx, toIdx) {
    const filtered = getOrderedTracks(audioCurrentPlaylist);
    const keys = filtered.map(t => t.key);
    const [moved] = keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, moved);
    await saveAudioOrder(audioCurrentPlaylist, keys);
    renderAudioTrackList();
}

function playAudioTrack(idx) {
    audioCurrentIdx = idx;
    const track = audioTracks[idx];
    if (!track) return;

    audioUserPaused = false;
    ensureAudioContext();
    audioEl.src = track.url;
    audioEl.play();

    document.getElementById('audioNowPlaying').style.display = 'block';
    document.getElementById('audioPlayBtn').textContent = '⏸';

    // Immediate render with the cached metadata (or filename fallback) so the UI
    // is never blank while the tag fetch resolves.
    const cachedMeta = audioMetaCache.get(track.url) || {};
    applyTrackMetadata(track, cachedMeta);
    renderAudioTrackList();

    // MediaSession action handlers (metadata is set by applyTrackMetadata above
    // and refreshed once the tag fetch resolves).
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => { audioUserPaused = false; audioEl.play(); updatePlayBtn(); });
        navigator.mediaSession.setActionHandler('pause', () => { audioUserPaused = true; audioEl.pause(); updatePlayBtn(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => audioPlayerPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => audioPlayerNext());
        navigator.mediaSession.setActionHandler('seekbackward', () => audioPlayerSeekBack());
        navigator.mediaSession.setActionHandler('seekforward', () => audioPlayerSeekFwd());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime != null) audioEl.currentTime = details.seekTime;
        });
    }

    // Async: parse embedded tags (cover art, title, artist, album) and re-apply.
    loadAndApplyTrackMetadata(track);
}

function updatePlayBtn() {
    document.getElementById('audioPlayBtn').textContent = audioEl.paused ? '▶' : '⏸';
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = audioEl.paused ? 'paused' : 'playing';
    }
}

function audioPlayerToggle() {
    if (audioCurrentIdx < 0 && audioTracks.length) {
        playAudioTrack(0);
        return;
    }
    if (audioEl.paused) { audioUserPaused = false; resumeAudioContext(); audioEl.play(); }
    else { audioUserPaused = true; audioEl.pause(); }
    updatePlayBtn();
}

function audioPlayerNext() {
    if (!audioTracks.length) return;
    const filtered = getOrderedTracks(audioCurrentPlaylist);
    const currentInFiltered = filtered.indexOf(audioTracks[audioCurrentIdx]);
    const nextIdx = (currentInFiltered + 1) % filtered.length;
    playAudioTrack(audioTracks.indexOf(filtered[nextIdx]));
}

function audioPlayerPrev() {
    if (!audioTracks.length) return;
    // If more than 3s in, restart current track
    if (audioEl.currentTime > 3) {
        audioEl.currentTime = 0;
        return;
    }
    const filtered = getOrderedTracks(audioCurrentPlaylist);
    const currentInFiltered = filtered.indexOf(audioTracks[audioCurrentIdx]);
    const prevIdx = (currentInFiltered - 1 + filtered.length) % filtered.length;
    playAudioTrack(audioTracks.indexOf(filtered[prevIdx]));
}

function audioPlayerSeekBack() { audioEl.currentTime = Math.max(0, audioEl.currentTime - 15); }
function audioPlayerSeekFwd() { audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 15); }

function seekAudio(val) {
    if (audioEl.duration) audioEl.currentTime = (val / 100) * audioEl.duration;
}

function formatAudioTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
}

// Audio element events
audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    const cur = formatAudioTime(audioEl.currentTime);
    document.getElementById('audioSeekBar').value = pct;
    document.getElementById('audioCurrentTime').textContent = cur;
    // Mini player at top of page
    const miniSeek = document.getElementById('miniSeekBar');
    if (miniSeek) miniSeek.value = pct;
    const miniCur = document.getElementById('miniCurrentTime');
    if (miniCur) miniCur.textContent = cur;
    // MediaSession position state
    if ('mediaSession' in navigator && audioEl.duration) {
        navigator.mediaSession.setPositionState({
            duration: audioEl.duration,
            playbackRate: audioEl.playbackRate,
            position: audioEl.currentTime,
        });
    }
});

audioEl.addEventListener('loadedmetadata', () => {
    const dur = formatAudioTime(audioEl.duration);
    document.getElementById('audioDuration').textContent = dur;
    const miniDur = document.getElementById('miniDuration');
    if (miniDur) miniDur.textContent = dur;
});

audioEl.addEventListener('ended', () => {
    if (audioRepeatMode === 'one') {
        audioEl.currentTime = 0;
        audioEl.play();
    } else if (audioRepeatMode === 'all') {
        audioPlayerNext();
    } else {
        // 'off' — advance but stop at end of playlist
        const filtered = getOrderedTracks(audioCurrentPlaylist);
        const currentInFiltered = filtered.indexOf(audioTracks[audioCurrentIdx]);
        if (currentInFiltered < filtered.length - 1) {
            audioPlayerNext();
        }
    }
});

audioEl.addEventListener('play', () => { updatePlayBtn(); showMiniPlayer(); requestWakeLock(); });
audioEl.addEventListener('pause', () => { updatePlayBtn(); updateMiniPlayBtn(); releaseWakeLock(); });

// ==================== WAKE LOCK (prevent screen sleep during playback) ====================
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* wake lock request failed (e.g. low battery) */ }
}

function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// Re-acquire wake lock when page becomes visible again (browser releases it on hide)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !audioEl.paused) {
        requestWakeLock();
    }
});

// If audio was interrupted by the OS while backgrounded (not user-paused), resume when user returns
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audioCurrentIdx >= 0 && audioEl.paused && audioEl.currentTime > 0 && !audioUserPaused) {
        resumeAudioContext();
        audioEl.play().catch(() => {});
        updatePlayBtn();
    }
});

// ==================== REPEAT MODE ====================
function cycleRepeatMode() {
    if (audioRepeatMode === 'off') audioRepeatMode = 'all';
    else if (audioRepeatMode === 'all') audioRepeatMode = 'one';
    else audioRepeatMode = 'off';
    updateRepeatButtons();
}

function updateRepeatButtons() {
    const labels = { off: '🔁', all: '🔁', one: '🔂' };
    const colors = { off: 'var(--gray-400)', all: 'var(--primary)', one: 'var(--green)' };
    const titles = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
    const mainBtn = document.getElementById('audioRepeatBtn');
    const miniBtn = document.getElementById('miniRepeatBtn');
    if (mainBtn) { mainBtn.textContent = labels[audioRepeatMode]; mainBtn.style.color = colors[audioRepeatMode]; mainBtn.title = titles[audioRepeatMode]; }
    if (miniBtn) { miniBtn.textContent = labels[audioRepeatMode]; miniBtn.style.color = colors[audioRepeatMode]; miniBtn.title = titles[audioRepeatMode]; }
}

// ==================== MINI PLAYER ====================
let miniPlayerHidden = false;

function showMiniPlayer() {
    if (miniPlayerHidden) return;
    document.getElementById('miniPlayer').style.display = '';
    // The idle "♪ Music" rail link and the docked player share the rail foot.
    const idle = document.getElementById('railMusicLink');
    if (idle) idle.style.display = 'none';
    updateMiniPlayer();
}

function hideMiniPlayer() {
    document.getElementById('miniPlayer').style.display = 'none';
    const idle = document.getElementById('railMusicLink');
    if (idle) idle.style.display = '';
    miniPlayerHidden = true;
}

function updateMiniPlayBtn() {
    document.getElementById('miniPlayBtn').innerHTML = audioEl.paused ? '&#9654;' : '&#9208;';
}

function updateMiniPlayer() {
    if (audioCurrentIdx < 0) return;
    const track = audioTracks[audioCurrentIdx];
    if (!track) return;
    // Prefer cached parsed metadata so the mini player reflects the same
    // title/artist/cover as the main player; falls back to filename.
    applyTrackMetadata(track, audioMetaCache.get(track.url) || {});
    updateMiniPlayBtn();
}

// Show mini player when navigating away from Tools tab
const origSwitchTab2 = switchTab;
switchTab = function(tabName) {
    origSwitchTab2(tabName);
    if (tabName !== 'tools' && audioCurrentIdx >= 0 && !audioEl.paused) {
        miniPlayerHidden = false;
        showMiniPlayer();
    }
};

async function deleteAudioTrack(key) {
    if (!confirm('Delete this track?')) return;
    try {
        await apiFetch('/api/audio', { method: 'DELETE', body: JSON.stringify({ key }) });
        showToast('Track deleted', 'success');
        loadAudioLibrary();
    } catch (e) {
        showToast('Failed to delete', 'error');
    }
}

// ==================== AUDIO OFFLINE ====================
const AUDIO_CACHE_NAME = 'guru-audio-v1';

async function saveAudioOffline(url) {
    try {
        showToast('Downloading...', 'info');
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fetch failed');
        const cache = await caches.open(AUDIO_CACHE_NAME);
        await cache.put(url, response);
        showToast('Saved offline', 'success');
        renderAudioTrackList();
    } catch (e) {
        showToast('Download failed: ' + e.message, 'error');
    }
}

async function removeAudioOffline(url) {
    try {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        await cache.delete(url);
        showToast('Removed from offline', 'success');
        renderAudioTrackList();
    } catch (e) {
        showToast('Failed to remove', 'error');
    }
}

async function downloadPlaylistOffline() {
    const filtered = getOrderedTracks(audioCurrentPlaylist);
    if (!filtered.length) { showToast('No tracks in playlist', 'error'); return; }

    const cache = await caches.open(AUDIO_CACHE_NAME);
    // Check which are already cached
    const uncached = [];
    for (const t of filtered) {
        const match = await cache.match(t.url);
        if (!match) uncached.push(t);
    }

    if (!uncached.length) {
        // All cached — offer to remove
        if (confirm('All tracks already saved offline. Remove them?')) {
            for (const t of filtered) await cache.delete(t.url);
            showToast('Playlist removed from offline', 'success');
            renderAudioTrackList();
        }
        return;
    }

    const totalMB = (uncached.reduce((s, t) => s + t.size, 0) / (1024 * 1024)).toFixed(1);
    if (!confirm(`Download ${uncached.length} track${uncached.length > 1 ? 's' : ''} (${totalMB} MB) for offline?`)) return;

    const btn = document.getElementById('audioOfflineBtn');
    let done = 0;
    btn.disabled = true;

    for (const t of uncached) {
        btn.textContent = `${++done}/${uncached.length}...`;
        try {
            const resp = await fetch(t.url);
            if (resp.ok) await cache.put(t.url, resp);
        } catch (e) { /* skip failed */ }
    }

    btn.disabled = false;
    btn.textContent = 'Save Offline';
    showToast(`${done} tracks saved offline`, 'success');
    renderAudioTrackList();
}

async function updateOfflineBtn() {
    const btn = document.getElementById('audioOfflineBtn');
    if (!btn) return;
    const filtered = audioTracks.filter(t => t.playlist === audioCurrentPlaylist);
    if (!filtered.length) { btn.textContent = 'Save Offline'; return; }
    const cache = await caches.open(AUDIO_CACHE_NAME).catch(() => null);
    if (!cache) return;
    let cachedCount = 0;
    for (const t of filtered) {
        if (await cache.match(t.url)) cachedCount++;
    }
    if (cachedCount === filtered.length) {
        btn.textContent = 'Saved Offline';
        btn.style.color = 'var(--green)';
    } else if (cachedCount > 0) {
        btn.textContent = `${cachedCount}/${filtered.length} Offline`;
        btn.style.color = '';
    } else {
        btn.textContent = 'Save Offline';
        btn.style.color = '';
    }
}

// ==================== MEDITATION TIMER ====================
let medSeconds = 1200;
let medTotal = 1200;
let medInterval = null;
let medRunning = false;

function setMedTimer(min) {
    if (medRunning) return;
    medSeconds = min * 60;
    medTotal = medSeconds;
    document.getElementById('medCustomMin').value = min;
    document.querySelectorAll('.med-preset').forEach(b => b.classList.remove('active'));
    const match = document.querySelector(`.med-preset[onclick="setMedTimer(${min})"]`);
    if (match) match.classList.add('active');
    renderMedTimer();
}

function renderMedTimer() {
    const m = Math.floor(medSeconds / 60);
    const s = medSeconds % 60;
    document.getElementById('medTimerDisplay').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function toggleMedTimer() {
    const endEarlyBtn = document.getElementById('medEndEarlyBtn');
    if (medRunning) {
        clearInterval(medInterval);
        medRunning = false;
        releaseWakeLock();
        document.getElementById('medStartBtn').textContent = 'Resume';
        document.getElementById('medStatus').textContent = 'Paused';
        // Show End Early only if some time has elapsed
        if (endEarlyBtn && medSeconds < medTotal) endEarlyBtn.style.display = '';
    } else {
        if (medSeconds <= 0) setMedTimer(parseInt(document.getElementById('medCustomMin').value) || 20);
        const isFirstStart = medSeconds === medTotal;
        medRunning = true;
        requestWakeLock();
        document.getElementById('medStartBtn').textContent = 'Pause';
        document.getElementById('medStatus').textContent = 'Meditating...';
        if (endEarlyBtn) endEarlyBtn.style.display = 'none';
        if (isFirstStart) { try { playMedSound(); } catch (_e) { /* ignore */ } }
        medInterval = setInterval(() => {
            medSeconds--;
            renderMedTimer();
            if (medSeconds <= 0) {
                clearInterval(medInterval);
                medRunning = false;
                releaseWakeLock();
                document.getElementById('medStartBtn').textContent = 'Start';
                document.getElementById('medStatus').textContent = 'Session complete!';
                try { playMedSound(); } catch (e) { /* AudioContext failure shouldn't block habit completion */ }
                autoCompleteMeditationHabit(Math.round(medTotal / 60));
            }
        }, 1000);
    }
}

function resetMedTimer() {
    clearInterval(medInterval);
    medRunning = false;
    releaseWakeLock();
    medSeconds = medTotal;
    renderMedTimer();
    document.getElementById('medStartBtn').textContent = 'Start';
    document.getElementById('medStatus').textContent = '';
    const endEarlyBtn = document.getElementById('medEndEarlyBtn');
    if (endEarlyBtn) endEarlyBtn.style.display = 'none';
}

function endMedEarly() {
    clearInterval(medInterval);
    medRunning = false;
    releaseWakeLock();
    const elapsedSec = medTotal - medSeconds;
    const elapsedMin = Math.floor(elapsedSec / 60);
    const elapsedS = elapsedSec % 60;
    const timeStr = elapsedMin + ':' + String(elapsedS).padStart(2, '0');
    document.getElementById('medStartBtn').textContent = 'Start';
    document.getElementById('medStatus').textContent = `Session ended early at ${timeStr}`;
    document.getElementById('medEndEarlyBtn').style.display = 'none';
    try { playMedSound(); } catch (e) { /* AudioContext failure shouldn't block habit completion */ }
    autoCompleteMeditationHabit(elapsedMin || Math.round(elapsedSec / 60));
}

// Meditation timer sounds — all synthesized via Web Audio API
const MED_SOUNDS = {
    bowl: { name: 'Singing Bowl', play: playSoundBowl },
    bell: { name: 'Temple Bell', play: playSoundBell },
    chime: { name: 'Wind Chimes', play: playSoundChime },
    gong: { name: 'Deep Gong', play: playSoundGong },
    tone: { name: 'Gentle Tone', play: playSoundTone },
};

function getMedSound() { return localStorage.getItem('medSound') || 'bowl'; }
function setMedSound(key) {
    localStorage.setItem('medSound', key);
    const sel = document.getElementById('medSoundSelect');
    if (sel) sel.value = key;
}
// Restore saved sound on load
document.addEventListener('DOMContentLoaded', function() {
    const sel = document.getElementById('medSoundSelect');
    if (sel) sel.value = getMedSound();
});

function playMedSound() { (MED_SOUNDS[getMedSound()] || MED_SOUNDS.bowl).play(); }
function previewMedSound() { playMedSound(); }

function _medTone(ctx, freq, start, dur, gain, type) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(start); osc.stop(start + dur);
}

function playSoundBowl() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = ctx.currentTime;
    _medTone(ctx, 220, n, 4, 0.3); _medTone(ctx, 440, n, 3.5, 0.15);
    _medTone(ctx, 660, n + 0.02, 3, 0.08); _medTone(ctx, 880, n + 0.03, 2.5, 0.04);
    _medTone(ctx, 220, n + 2, 4, 0.25); _medTone(ctx, 440, n + 2, 3.5, 0.12);
    _medTone(ctx, 660, n + 2.02, 3, 0.06);
    _medTone(ctx, 220, n + 4, 5, 0.2); _medTone(ctx, 440, n + 4, 4, 0.1);
    _medTone(ctx, 660, n + 4.02, 3.5, 0.05);
}

function playSoundBell() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = ctx.currentTime;
    // High metallic bell — fundamental + bright overtones
    _medTone(ctx, 523, n, 3, 0.25); _medTone(ctx, 1047, n, 2.5, 0.15);
    _medTone(ctx, 1568, n + 0.01, 2, 0.08); _medTone(ctx, 2093, n + 0.02, 1.5, 0.04);
    // Second ring
    _medTone(ctx, 523, n + 2.5, 3, 0.2); _medTone(ctx, 1047, n + 2.5, 2.5, 0.12);
    _medTone(ctx, 1568, n + 2.51, 2, 0.06);
    // Third ring
    _medTone(ctx, 523, n + 5, 4, 0.18); _medTone(ctx, 1047, n + 5, 3, 0.09);
}

function playSoundChime() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = ctx.currentTime;
    // Cascading high tones like wind chimes
    const notes = [1047, 1175, 1319, 1397, 1568, 1760, 1976];
    notes.forEach(function(f, i) {
        _medTone(ctx, f, n + i * 0.3, 2.5, 0.12);
        _medTone(ctx, f * 2, n + i * 0.3 + 0.01, 1.5, 0.04);
    });
    // Gentle resolve
    _medTone(ctx, 1047, n + 3, 4, 0.15); _medTone(ctx, 1319, n + 3.1, 3.5, 0.1);
}

function playSoundGong() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = ctx.currentTime;
    // Deep, resonant gong — low fundamental with slow decay
    _medTone(ctx, 65, n, 8, 0.35); _medTone(ctx, 130, n + 0.01, 7, 0.2);
    _medTone(ctx, 195, n + 0.02, 6, 0.1); _medTone(ctx, 260, n + 0.03, 5, 0.05);
    // Shimmer
    _medTone(ctx, 520, n + 0.05, 3, 0.03); _medTone(ctx, 780, n + 0.07, 2, 0.02);
    // Second strike
    _medTone(ctx, 65, n + 4, 8, 0.25); _medTone(ctx, 130, n + 4.01, 6, 0.15);
    _medTone(ctx, 195, n + 4.02, 5, 0.07);
}

function playSoundTone() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = ctx.currentTime;
    // Soft, warm A4 tone with triangle wave — gentle and minimal
    _medTone(ctx, 440, n, 5, 0.2, 'triangle');
    _medTone(ctx, 880, n + 0.01, 4, 0.06, 'triangle');
    // Second
    _medTone(ctx, 440, n + 3, 5, 0.15, 'triangle');
    _medTone(ctx, 880, n + 3.01, 4, 0.05, 'triangle');
    // Third — softer
    _medTone(ctx, 440, n + 6, 6, 0.1, 'triangle');
}

async function autoCompleteMeditationHabit(minutes) {
    // Habits may not be loaded if user hasn't visited the Habits tab yet
    if (!habits.length) {
        try {
            const localToday = new Date().toLocaleDateString('en-CA');
            const data = await apiFetch('/api/habits?today=' + localToday);
            habits = data.habits || [];
            todayLogsData = data.todayLogs || [];
            habitLogs = data.recentLogs || [];
            weekLogsData = data.weekLogs || [];
            monthLogsData = data.monthLogs || [];
        } catch (_e) { return; }
    }
    // Must filter status==='active' — an archived "meditation" habit (added in v4.2.22)
    // would otherwise be matched first by find(), blocking the active habit from completing.
    const medHabit = habits.find(h => h.status === 'active' && h.name && h.name.toLowerCase().includes('meditat') && !isHabitDone(h));
    if (medHabit) {
        toggleHabit(medHabit.id, false, minutes);
        showToast(`Meditation habit auto-completed! (${minutes} min)`, 'success');
    }
}

// ==================== POMODORO TIMER ====================
let pomSeconds = 1500;
let pomTotal = 1500;
let pomInterval = null;
let pomRunning = false;
let pomPhase = 'work'; // 'work' or 'break'
let pomSessions = 0;

function getPomWorkSec() { return (parseInt(document.getElementById('pomWorkMin').value) || 25) * 60; }
function getPomBreakSec() { return (parseInt(document.getElementById('pomBreakMin').value) || 5) * 60; }

function renderPomTimer() {
    const m = Math.floor(pomSeconds / 60);
    const s = pomSeconds % 60;
    document.getElementById('pomTimerDisplay').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    document.getElementById('pomTimerDisplay').style.color = pomPhase === 'break' ? 'var(--green)' : 'var(--gray-800)';
    document.getElementById('pomPhaseLabel').textContent = pomPhase === 'break' ? 'Break' : 'Work';
    document.getElementById('pomPhaseLabel').style.color = pomPhase === 'break' ? 'var(--green)' : 'var(--primary)';
    document.getElementById('pomSessionCount').textContent = pomSessions;
}

function togglePomTimer() {
    if (pomRunning) {
        clearInterval(pomInterval);
        pomRunning = false;
        document.getElementById('pomStartBtn').textContent = 'Resume';
        document.getElementById('pomStatus').textContent = 'Paused';
    } else {
        pomRunning = true;
        document.getElementById('pomStartBtn').textContent = 'Pause';
        document.getElementById('pomStatus').textContent = pomPhase === 'work' ? 'Focus time...' : 'Take a break!';
        pomInterval = setInterval(() => {
            pomSeconds--;
            renderPomTimer();
            if (pomSeconds <= 0) {
                clearInterval(pomInterval);
                pomRunning = false;
                if (pomPhase === 'work') {
                    pomSessions++;
                    pomPhase = 'break';
                    pomSeconds = getPomBreakSec();
                    pomTotal = pomSeconds;
                    document.getElementById('pomStartBtn').textContent = 'Start Break';
                    document.getElementById('pomStatus').textContent = 'Work session #' + pomSessions + ' done! Take a break.';
                    playPomAlert();
                } else {
                    pomPhase = 'work';
                    pomSeconds = getPomWorkSec();
                    pomTotal = pomSeconds;
                    document.getElementById('pomStartBtn').textContent = 'Start Work';
                    document.getElementById('pomStatus').textContent = 'Break over! Ready for session #' + (pomSessions + 1) + '.';
                    playPomAlert();
                }
                renderPomTimer();
            }
        }, 1000);
    }
}

function resetPomTimer() {
    clearInterval(pomInterval);
    pomRunning = false;
    pomPhase = 'work';
    pomSeconds = getPomWorkSec();
    pomTotal = pomSeconds;
    pomSessions = 0;
    renderPomTimer();
    document.getElementById('pomStartBtn').textContent = 'Start';
    document.getElementById('pomStatus').textContent = '';
}

function playPomAlert() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    function beep(freq, time, dur) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.2, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + dur);
    }
    beep(880, now, 0.15);
    beep(880, now + 0.2, 0.15);
    beep(1100, now + 0.4, 0.3);
}

// ==================== STOPWATCH ====================
let swRunning = false;
let swStartTime = 0;
let swElapsed = 0;
let swInterval = null;
let swLaps = [];

function formatStopwatch(ms) {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

function updateStopwatch() {
    const elapsed = swElapsed + (Date.now() - swStartTime);
    document.getElementById('swDisplay').textContent = formatStopwatch(elapsed);
}

function toggleStopwatch() {
    if (swRunning) {
        swElapsed += Date.now() - swStartTime;
        clearInterval(swInterval);
        swRunning = false;
        document.getElementById('swStartBtn').textContent = 'Resume';
        document.getElementById('swStartBtn').classList.remove('btn-danger');
        document.getElementById('swStartBtn').classList.add('btn-success');
        document.getElementById('swLapBtn').disabled = true;
    } else {
        swStartTime = Date.now();
        swRunning = true;
        swInterval = setInterval(updateStopwatch, 10);
        document.getElementById('swStartBtn').textContent = 'Stop';
        document.getElementById('swStartBtn').classList.remove('btn-success');
        document.getElementById('swStartBtn').classList.add('btn-danger');
        document.getElementById('swLapBtn').disabled = false;
    }
}

function lapStopwatch() {
    if (!swRunning) return;
    const elapsed = swElapsed + (Date.now() - swStartTime);
    const lapTime = swLaps.length ? elapsed - swLaps.reduce((a, b) => a + b, 0) : elapsed;
    swLaps.push(lapTime);
    const container = document.getElementById('swLaps');
    container.innerHTML = swLaps.map((l, i) =>
        `<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid var(--gray-100);font-size:13px;font-variant-numeric:tabular-nums;">` +
        `<span style="color:var(--gray-500);">Lap ${i + 1}</span><span style="font-weight:600;">${formatStopwatch(l)}</span></div>`
    ).reverse().join('');
}

function resetStopwatch() {
    clearInterval(swInterval);
    swRunning = false;
    swElapsed = 0;
    swLaps = [];
    document.getElementById('swDisplay').textContent = '00:00.00';
    document.getElementById('swStartBtn').textContent = 'Start';
    document.getElementById('swStartBtn').classList.remove('btn-danger');
    document.getElementById('swStartBtn').classList.add('btn-success');
    document.getElementById('swLapBtn').disabled = true;
    document.getElementById('swLaps').innerHTML = '';
}

// ==================== FILES ====================
function toggleFileUpload() {
    const area = document.getElementById('fileUploadArea');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

async function uploadFile(file) {
    if (!file) return;
    const progress = document.getElementById('fileUploadProgress');
    const bar = document.getElementById('fileProgressBar');
    const text = document.getElementById('fileProgressText');
    const status = document.getElementById('fileUploadStatus');

    progress.style.display = 'block';
    status.textContent = 'Getting upload URL...';
    bar.style.width = '0%';
    text.textContent = '0%';

    try {
        // Step 1: Get presigned URL
        const presign = await apiFetch('/api/file-presign', {
            method: 'POST',
            body: JSON.stringify({ filename: file.name, size: file.size }),
        });

        if (!presign.url) throw new Error(presign.error || 'Failed to get upload URL');

        // Step 2: Upload directly to R2
        status.textContent = 'Uploading ' + file.name + '...';
        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', presign.url);
            xhr.setRequestHeader('Content-Type', presign.contentType);
            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    bar.style.width = pct + '%';
                    text.textContent = pct + '%';
                }
            };
            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error('Upload failed: HTTP ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(file);
        });

        status.textContent = 'Upload complete!';
        document.getElementById('fileInput').value = '';
        setTimeout(() => { progress.style.display = 'none'; }, 2000);
        showToast('File uploaded!', 'success');
        loadFiles();
    } catch (e) {
        status.textContent = 'Failed: ' + e.message;
        showToast('Upload failed: ' + e.message, 'error');
    }
}

async function loadFiles() {
    const container = document.getElementById('fileList');
    try {
        const data = await apiFetch('/api/file-list');
        const files = data.files || [];
        if (!files.length) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);">No files uploaded yet.</div>';
            return;
        }
        const icons = { video: '🎬', audio: '🎵', image: '🖼️', pdf: '📄', default: '📁' };
        container.innerHTML = files.map(f => {
            const ext = '.' + f.name.split('.').pop().toLowerCase();
            let icon = icons.default;
            if (['.mp4', '.mov', '.webm'].includes(ext)) icon = icons.video;
            else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) icon = icons.audio;
            else if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) icon = icons.image;
            else if (ext === '.pdf') icon = icons.pdf;
            const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
            const date = new Date(f.uploaded).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const sep = f.url.includes('?') ? '&' : '?';
            const dlUrl = `${f.url}${sep}download=1`;
            const btnStyle = 'background:none;border:none;cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;';
            return `<div style="display:flex;align-items:center;gap:6px;padding:10px 8px;border-bottom:1px solid var(--gray-100);">
                <span style="font-size:20px;">${icon}</span>
                <span style="flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">${esc(f.name)}</span>
                <span style="font-size:11px;color:var(--gray-400);">${sizeMB} MB</span>
                <span style="font-size:11px;color:var(--gray-400);">${date}</span>
                <a href="${f.url}" target="_blank" rel="noopener" title="Open" style="${btnStyle}text-decoration:none;color:var(--primary);">👁</a>
                <a href="${dlUrl}" download="${esc(f.name)}" title="Download" style="${btnStyle}text-decoration:none;color:var(--primary);">⬇</a>
                <button onclick="copyToClipboard('${f.url}')" title="Copy URL" style="${btnStyle}color:var(--gray-500);">🔗</button>
                <button onclick="renameFile('${f.key}','${esc(f.name)}')" title="Rename" style="${btnStyle}color:var(--blue);">✏️</button>
                <button onclick="deleteFile('${f.key}')" title="Delete" style="${btnStyle}color:var(--red);">🗑</button>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--coral);">Failed to load files.</div>';
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(location.origin + text).then(() => showToast('URL copied!', 'success'));
}

async function deleteFile(key) {
    if (!confirm('Delete this file?')) return;
    try {
        await apiFetch('/api/file-delete', { method: 'POST', body: JSON.stringify({ key }) });
        showToast('File deleted', 'success');
        loadFiles();
    } catch (e) { showToast('Failed to delete', 'error'); }
}

async function renameFile(oldKey, currentName) {
    const newName = prompt('Enter new filename:', currentName);
    if (!newName || newName === currentName) return;
    try {
        const res = await apiFetch('/api/file-rename', { method: 'POST', body: JSON.stringify({ oldKey, newName }) });
        if (res.ok) {
            showToast('File renamed', 'success');
            loadFiles();
        } else {
            showToast(res.error || 'Rename failed', 'error');
        }
    } catch (e) { showToast('Rename failed: ' + e.message, 'error'); }
}
