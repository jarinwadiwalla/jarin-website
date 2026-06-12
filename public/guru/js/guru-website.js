/* ==========================================================================
   Guru Dashboard — Website Module
   Blog editor, drafts, notes, poetry, about page, settings, image upload
   ========================================================================== */

// ==================== IMAGE MANIFEST ====================
// Source markdown often references images by their original extension (.png,
// .jpeg, .JPG), but scripts/optimize-images.js normalizes everything to .jpg
// (+ .webp). The published blog hides the mismatch via scripts/build-blog.js's
// rewriteImages(), which looks each <img src> up in image-manifest.json. The
// /guru preview renders raw markdown, so it shows whatever broken URL is in
// the source. Mirror the build's manifest lookup here so the preview matches
// what the live blog will actually publish.
let _imageManifest = {};
let _imageManifestLoaded = false;

(async function loadImageManifest() {
    try {
        const r = await fetch('/assets/image-manifest.json');
        if (!r.ok) return;
        _imageManifest = await r.json();
        _imageManifestLoaded = true;
        const pane = document.getElementById('previewPane');
        if (pane && !pane.querySelector('.empty-state')) updatePreview();
        const coverInput = document.getElementById('postImage');
        if (coverInput && coverInput.value.trim()) updateCoverPreview(coverInput.value.trim());
    } catch (_) {}
})();

function resolveImageSrc(src) {
    if (!src || !_imageManifestLoaded) return src;
    const direct = _imageManifest[src];
    if (direct && direct.jpg) return direct.jpg;
    const lowered = src.replace(/\.(JPG|JPEG|PNG)$/, m => m.toLowerCase());
    if (lowered !== src && _imageManifest[lowered] && _imageManifest[lowered].jpg) {
        return _imageManifest[lowered].jpg;
    }
    return src;
}

function rewriteImagesUsingManifest(html) {
    if (!_imageManifestLoaded) return html;
    return html.replace(/<img\s+([^>]*)>/gi, (match, attrs) => {
        const srcMatch = attrs.match(/src=["']([^"']+)["']/);
        if (!srcMatch) return match;
        const newSrc = resolveImageSrc(srcMatch[1]);
        if (newSrc === srcMatch[1]) return match;
        return match.replace(srcMatch[0], `src="${newSrc}"`);
    });
}

// ==================== BLOG EDITOR ====================
function autoSlug() {
    const title = document.getElementById('postTitle').value;
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    document.getElementById('postSlug').value = slug;
}

function updatePreview() {
    const body = document.getElementById('postBody').value;
    const title = document.getElementById('postTitle').value;
    const pane = document.getElementById('previewPane');

    if (!body && !title) {
        pane.innerHTML = '<div class="empty-state"><p>Start typing to see a preview...</p></div>';
        return;
    }

    let preview = '';
    const coverImage = resolveImageSrc(document.getElementById('postImage').value.trim());
    if (coverImage) preview += `<img src="${escapeHtml(coverImage)}" alt="Cover image" style="width:100%;border-radius:8px;margin-bottom:16px;">`;
    if (title) preview += `<h1>${escapeHtml(title)}</h1>`;
    if (body) preview += rewriteImagesUsingManifest(markdownToHtml(body));
    pane.innerHTML = preview;
    autoSaveBlogDraft();
}

// ==================== BLOG DRAFT AUTO-SAVE (localStorage) ====================
const BLOG_DRAFT_KEY = 'jarin-blog-draft';
let _blogDraftSaveTimer = null;

function autoSaveBlogDraft() {
    clearTimeout(_blogDraftSaveTimer);
    _blogDraftSaveTimer = setTimeout(() => {
        try {
            const data = getEditorData();
            if (!data.body && !data.title) return;
            const draft = { ...data, ts: Date.now() };
            localStorage.setItem(BLOG_DRAFT_KEY, JSON.stringify(draft));
            const status = document.getElementById('blogAutosaveStatus');
            if (status) {
                status.innerHTML = '<span style="color:#16a34a;">&#10003; Auto-saved at ' + new Date().toLocaleTimeString() + '</span>';
            }
        } catch (_) {}
    }, 800);
}

function loadBlogLocalDraft() {
    try {
        const raw = localStorage.getItem(BLOG_DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function showBlogDraftBanner() {
    const draft = loadBlogLocalDraft();
    if (!draft || (!draft.body && !draft.title)) return;
    const banner = document.getElementById('blogDraftBanner');
    const info = document.getElementById('blogDraftInfo');
    if (!banner || !info) return;
    info.textContent = '"' + (draft.title || 'Untitled') + '" — saved ' + new Date(draft.ts).toLocaleString();
    banner.style.display = 'block';
}

function restoreBlogLocalDraft() {
    const draft = loadBlogLocalDraft();
    if (!draft) return;
    currentDraftId = draft.id || null;
    document.getElementById('postTitle').value = draft.title || '';
    document.getElementById('postSlug').value = draft.slug || '';
    document.getElementById('postDate').value = draft.date || '';
    document.getElementById('postImage').value = draft.image || '';
    document.getElementById('postDescription').value = draft.excerpt || '';
    document.getElementById('postBody').value = draft.body || '';
    document.getElementById('postScheduledAt').value = draft.scheduledAt ? draft.scheduledAt.slice(0, 16) : '';
    updateCoverPreview(draft.image || '');
    updatePreview();
    document.getElementById('blogDraftBanner').style.display = 'none';
    showToast('Draft restored.', 'success');
}

function dismissBlogLocalDraft() {
    try { localStorage.removeItem(BLOG_DRAFT_KEY); } catch (_) {}
    document.getElementById('blogDraftBanner').style.display = 'none';
}

// Wire up auto-save on all editor inputs once the DOM is ready
(function initBlogAutoSave() {
    const tryInit = () => {
        const fields = ['postTitle', 'postSlug', 'postDate', 'postImage', 'postDescription', 'postScheduledAt'];
        let bound = 0;
        for (const id of fields) {
            const el = document.getElementById(id);
            if (el && !el.dataset.autoSaveBound) {
                el.addEventListener('input', autoSaveBlogDraft);
                el.dataset.autoSaveBound = '1';
                bound++;
            }
        }
        if (bound < fields.length) { setTimeout(tryInit, 200); return; }
        showBlogDraftBanner();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();

function newPost() {
    clearEditor();
    document.getElementById('postDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('editorTitle').textContent = 'New Blog Post';
    document.getElementById('postTitle').focus();
}

function clearEditor() {
    currentDraftId = null;
    document.getElementById('postTitle').value = '';
    document.getElementById('postSlug').value = '';
    document.getElementById('postDate').value = '';
    document.getElementById('postImage').value = '';
    document.getElementById('postDescription').value = '';
    document.getElementById('postBody').value = '';
    document.getElementById('postScheduledAt').value = '';
    document.getElementById('editorTitle').textContent = 'New Blog Post';
    document.getElementById('deleteDraftBtn').style.display = 'none';
    document.getElementById('deletePublishedBtn').style.display = 'none';
    const sendBlogBtn = document.getElementById('sendBlogBtn');
    if (sendBlogBtn) sendBlogBtn.style.display = 'none';
    const status = document.getElementById('blogAutosaveStatus');
    if (status) status.innerHTML = '';
    try { localStorage.removeItem(BLOG_DRAFT_KEY); } catch (_) {}
    updateCoverPreview('');
    updatePreview();
}

function loadDraftIntoEditor(draft) {
    currentDraftId = draft.slug;
    document.getElementById('postTitle').value = draft.title || '';
    document.getElementById('postSlug').value = draft.slug || '';
    document.getElementById('postDate').value = draft.date || '';
    document.getElementById('postImage').value = draft.image || '';
    document.getElementById('postDescription').value = draft.excerpt || draft.description || '';
    document.getElementById('postBody').value = draft.body || '';
    document.getElementById('postScheduledAt').value = draft.scheduledAt ? draft.scheduledAt.slice(0, 16) : '';
    document.getElementById('editorTitle').textContent = 'Edit Draft: ' + (draft.title || 'Untitled');
    document.getElementById('deleteDraftBtn').style.display = 'inline-flex';
    updateCoverPreview(draft.image || '');
    updatePreview();
}

function getEditorData() {
    const scheduledRaw = document.getElementById('postScheduledAt').value;
    return {
        id: currentDraftId,
        title: document.getElementById('postTitle').value.trim(),
        slug: document.getElementById('postSlug').value.trim(),
        date: document.getElementById('postDate').value,
        image: document.getElementById('postImage').value.trim(),
        excerpt: document.getElementById('postDescription').value.trim(),
        body: document.getElementById('postBody').value,
        scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null
    };
}

async function saveDraft() {
    const data = getEditorData();
    if (!data.title) {
        showToast('Please enter a title before saving.', 'error');
        return;
    }
    if (!data.slug) {
        autoSlug();
        data.slug = document.getElementById('postSlug').value.trim();
    }
    if (!data.slug) {
        showToast('Could not generate a slug from the title.', 'error');
        return;
    }
    try {
        const result = await apiFetch('/api/blog-drafts', {
            method: 'POST',
            body: JSON.stringify({ draft: data })
        });
        currentDraftId = data.slug || currentDraftId;
        document.getElementById('deleteDraftBtn').style.display = 'inline-flex';
        try { localStorage.removeItem(BLOG_DRAFT_KEY); } catch (_) {}
        showToast('Draft saved successfully!', 'success');
        loadDrafts();
    } catch (e) {
        // Error already shown by apiFetch
    }
}

function publishPost() {
    const data = getEditorData();
    if (!data.title || !data.body) {
        showToast('Title and body are required to publish.', 'error');
        return;
    }
    openModal(
        'Publish Post',
        `Are you sure you want to publish "${data.title}"? This will make it live on the website.`,
        'Publish',
        'btn-success',
        async () => {
            try {
                await apiFetch('/api/blog-publish', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                try { localStorage.removeItem(BLOG_DRAFT_KEY); } catch (_) {}
                showToast('Post published successfully!', 'success');
                clearEditor();
                loadDrafts();
                loadDashboardStats();
            } catch (e) {
                // Error already shown
            }
        }
    );
}

function schedulePost() {
    const data = getEditorData();
    if (!data.title || !data.body) {
        showToast('Title and body are required to schedule.', 'error');
        return;
    }
    if (!data.scheduledAt) {
        showToast('Please set a schedule date/time before scheduling.', 'error');
        document.getElementById('postScheduledAt').focus();
        return;
    }
    const schedDate = new Date(data.scheduledAt);
    openModal(
        'Schedule Post',
        `Schedule "${data.title}" to be published on ${schedDate.toLocaleString()}?`,
        'Schedule',
        'btn-primary',
        async () => {
            try {
                await apiFetch('/api/blog-drafts', {
                    method: 'POST',
                    body: JSON.stringify({ draft: data })
                });
                showToast(`Post scheduled for ${schedDate.toLocaleString()}!`, 'success');
                loadDrafts();
            } catch (e) {
                // Error already shown
            }
        }
    );
}

async function publishScheduled() {
    const resultDiv = document.getElementById('scheduledResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color:var(--gray-500);">Checking for scheduled items...</p>';
    try {
        const data = await apiFetch('/api/publish-scheduled', { method: 'POST' });
        const blogs = data.published?.blogs || [];
        const poems = data.published?.poems || [];
        const errors = data.errors || [];
        let html = '';
        if (blogs.length === 0 && poems.length === 0 && errors.length === 0) {
            html = '<p style="color:var(--gray-500);">No items are due for publishing right now.</p>';
        } else {
            if (blogs.length > 0) html += `<p style="color:var(--green-600,#16a34a);">Published blogs: ${blogs.map(b => `<strong>${escapeHtml(b)}</strong>`).join(', ')}</p>`;
            if (poems.length > 0) html += `<p style="color:var(--green-600,#16a34a);">Published poems: ${poems.map(p => `<strong>${escapeHtml(p)}</strong>`).join(', ')}</p>`;
            if (errors.length > 0) html += `<p style="color:var(--red-600,#dc2626);">Errors: ${errors.map(e => escapeHtml(e)).join('; ')}</p>`;
        }
        resultDiv.innerHTML = html;
        loadDrafts();
        loadPoems();
        loadDashboardStats();
    } catch (e) {
        resultDiv.innerHTML = '<p style="color:var(--red-600,#dc2626);">Failed to run scheduled publish check.</p>';
    }
}

async function deleteDraft() {
    if (!currentDraftId) return;
    openModal(
        'Delete Draft',
        'Are you sure you want to delete this draft? This cannot be undone.',
        'Delete',
        'btn-danger',
        async () => {
            try {
                await apiFetch('/api/blog-drafts', {
                    method: 'DELETE',
                    body: JSON.stringify({ slug: currentDraftId })
                });
                showToast('Draft deleted.', 'success');
                clearEditor();
                loadDrafts();
            } catch (e) {
                // Error already shown
            }
        }
    );
}

function previewBlogPost() {
    const data = getEditorData();
    if (!data.body) { showToast('Write some content to preview.', 'error'); return; }
    const html = rewriteImagesUsingManifest(markdownToHtml(data.body));
    const dateStr = data.date ? new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${location.origin}/">
<title>Preview: ${escapeHtml(data.title || 'Untitled')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://jarinwadiwalla.com/css/style.css">
<link rel="stylesheet" href="https://jarinwadiwalla.com/css/blog.css">
<style>body{margin:0;padding:0;} .preview-banner{background:#fef3c7;color:#92400e;text-align:center;padding:8px;font-size:13px;font-weight:600;position:sticky;top:0;z-index:100;}</style>
</head>
<body>
<div class="preview-banner">PREVIEW — This is how your post will appear on jarinwadiwalla.com</div>
<div class="primary-container">
<main><div class="container">
<article class="blog-post">
<header class="featured-banner"><section class="article-header">
<h1>${escapeHtml(data.title || 'Untitled')}</h1>
${dateStr ? `<time>${dateStr}</time>` : ''}
</section></header>
<div class="blog-post-content">${html}</div>
</article>
</div></main>
</div>
</body></html>`);
    win.document.close();
}

async function loadPublishedPosts() {
    const container = document.getElementById('publishedPostList');
    container.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
    try {
        const res = await apiFetch('/api/blog-posts');
        const posts = res.posts || [];
        if (posts.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No published posts.</p></div>';
            return;
        }
        container.innerHTML = posts.map(p => `<div class="draft-item" onclick="loadPublishedPost('${escapeHtml(p.slug)}')">
            <div>
                <div class="draft-title">${escapeHtml(p.title || p.slug)}</div>
                <div class="draft-date">${p.date || ''} &middot; /${p.slug}</div>
            </div>
            <span class="status-badge" style="background:var(--green);color:#fff;">Published</span>
        </div>`).join('');
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><p>Could not load published posts.</p></div>';
    }
}

async function loadPublishedPost(slug) {
    try {
        const res = await apiFetch(`/api/blog-posts?slug=${encodeURIComponent(slug)}`);
        const post = res.post;
        if (!post) { showToast('Could not load post.', 'error'); return; }
        currentDraftId = null;
        document.getElementById('postTitle').value = post.title || '';
        document.getElementById('postSlug').value = post.slug || '';
        document.getElementById('postDate').value = post.date || '';
        document.getElementById('postImage').value = post.image || '';
        document.getElementById('postDescription').value = post.excerpt || '';
        document.getElementById('postBody').value = post.body || '';
        document.getElementById('postScheduledAt').value = '';
        document.getElementById('editorTitle').textContent = 'Edit Published: ' + (post.title || slug);
        document.getElementById('deleteDraftBtn').style.display = 'none';
        document.getElementById('deletePublishedBtn').style.display = 'inline-flex';
        document.getElementById('deletePublishedBtn').dataset.slug = slug;
        const sendBlogBtn = document.getElementById('sendBlogBtn');
        if (sendBlogBtn) sendBlogBtn.style.display = 'inline-flex';
        updatePreview();
    } catch (e) {
        showToast('Failed to load post.', 'error');
    }
}

function deletePublishedPost() {
    const slug = document.getElementById('deletePublishedBtn').dataset.slug;
    if (!slug) return;
    openModal(
        'Delete Published Post',
        'Are you sure you want to delete this published post from the website? This cannot be undone.',
        'Delete',
        'btn-danger',
        async () => {
            try {
                await apiFetch('/api/blog-posts', {
                    method: 'DELETE',
                    body: JSON.stringify({ slug })
                });
                showToast('Published post deleted.', 'success');
                clearEditor();
                loadPublishedPosts();
                loadDashboardStats();
            } catch (e) {
                // Error shown
            }
        }
    );
}

// ==================== LOAD DRAFTS ====================
let _loadedDrafts = [];

function findDraftBySlug(slug) {
    return _loadedDrafts.find(d => d.slug === slug);
}

function openDraftBySlug(slug) {
    const draft = findDraftBySlug(slug);
    if (draft) loadDraftIntoEditor(draft);
}

async function loadDrafts() {
    try {
        const data = await apiFetch('/api/blog-drafts');
        const drafts = data.drafts || data || [];
        _loadedDrafts = drafts;
        renderDraftList(drafts);
        document.getElementById('draftCount').textContent = drafts.length;
    } catch (e) {
        document.getElementById('draftList').innerHTML =
            '<div class="empty-state"><p>Could not load drafts.</p></div>';
    }
}

function renderDraftList(drafts) {
    const container = document.getElementById('draftList');
    if (!drafts || drafts.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128196;</div><p>No drafts yet. Click "New Post" to start writing.</p></div>';
        return;
    }
    container.innerHTML = drafts.map(d => {
        let badge = '<span class="status-badge status-draft">Draft</span>';
        if (d.scheduledAt) {
            const dt = new Date(d.scheduledAt);
            badge = `<span class="status-badge status-scheduled" title="Scheduled: ${escapeHtml(dt.toLocaleString())}">Scheduled</span>`;
        }
        return `<div class="draft-item" data-draft-slug="${escapeHtml(d.slug || '')}">
            <div>
                <div class="draft-title">${escapeHtml(d.title || 'Untitled')}</div>
                <div class="draft-date">${escapeHtml(d.date || 'No date')} &middot; /${escapeHtml(d.slug || '')}${d.scheduledAt ? ' &middot; Publishes: ' + escapeHtml(new Date(d.scheduledAt).toLocaleString()) : ''}</div>
            </div>
            ${badge}
        </div>`;
    }).join('');
    container.querySelectorAll('.draft-item[data-draft-slug]').forEach(el => {
        el.addEventListener('click', () => openDraftBySlug(el.dataset.draftSlug));
    });
}

// ==================== NOTES (Training / General) ====================
let notesTabs = [];
let notesActiveTab = null;

function toggleNotesPanel(type) {
    const panel = document.getElementById('notesPanel-' + type);
    if (panel.style.display === 'none') {
        panel.style.display = '';
        loadNotes();
    } else {
        panel.style.display = 'none';
    }
}

async function loadNotes() {
    try {
        const data = await apiFetch('/api/settings');
        notesTabs = data.notesTabs || [];
        // Migrate old format
        if (!notesTabs.length) {
            if (data.trainingNotes || data.generalNotes) {
                if (data.trainingNotes) notesTabs.push({ id: 'notes-training', title: 'Training', notes: data.trainingNotes });
                if (data.generalNotes) notesTabs.push({ id: 'notes-general', title: 'General', notes: data.generalNotes });
            } else {
                notesTabs = [{ id: 'notes-' + Date.now(), title: 'General', notes: '' }];
            }
        }
        notesActiveTab = notesTabs[0]?.id || null;
        const savedAt = data.notesSavedAt || '';
        if (savedAt) {
            document.getElementById('notesSavedAt').textContent = 'Last saved: ' + new Date(savedAt).toLocaleString();
        }
        renderNotesTabs();
    } catch (e) {}
}

function renderNotesTabs() {
    const bar = document.getElementById('notesTabBar');
    const content = document.getElementById('notesContent');
    const tab = notesTabs.find(t => t.id === notesActiveTab) || notesTabs[0];
    if (!tab) return;

    bar.innerHTML = notesTabs.map(t => {
        const active = t.id === tab.id;
        return `<div style="display:flex;align-items:center;gap:2px;">` +
            `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="switchNotesTab('${t.id}')" style="padding:4px 12px;font-size:12px;">${escapeHtml(t.title)}</button>` +
            (active ? `<button class="btn btn-secondary btn-sm" onclick="renameNotesTab('${t.id}')" style="padding:4px 6px;font-size:10px;" title="Rename">&#9998;</button>` : '') +
            (active && notesTabs.length > 1 ? `<button class="btn btn-sm" onclick="deleteNotesTab('${t.id}')" style="padding:4px 6px;font-size:10px;background:var(--red);color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Delete">&times;</button>` : '') +
            `</div>`;
    }).join('');

    content.innerHTML = `<textarea id="notesTextarea" placeholder="Write your notes here..." style="width:100%;min-height:400px;padding:14px;font-size:14px;line-height:1.7;border:1px solid var(--gray-200);border-radius:8px;resize:vertical;font-family:inherit;">${escapeHtml(tab.notes || '')}</textarea>`;
}

function switchNotesTab(id) {
    const textarea = document.getElementById('notesTextarea');
    if (textarea) {
        const current = notesTabs.find(t => t.id === notesActiveTab);
        if (current) current.notes = textarea.value;
    }
    notesActiveTab = id;
    renderNotesTabs();
}

function addNotesTab() {
    const textarea = document.getElementById('notesTextarea');
    if (textarea) {
        const current = notesTabs.find(t => t.id === notesActiveTab);
        if (current) current.notes = textarea.value;
    }
    const title = prompt('Tab name:');
    if (!title || !title.trim()) return;
    const newTab = { id: 'notes-' + Date.now(), title: title.trim(), notes: '' };
    notesTabs.push(newTab);
    notesActiveTab = newTab.id;
    renderNotesTabs();
}

function renameNotesTab(id) {
    const tab = notesTabs.find(t => t.id === id);
    if (!tab) return;
    const title = prompt('Rename tab:', tab.title);
    if (!title || !title.trim()) return;
    tab.title = title.trim();
    renderNotesTabs();
}

function deleteNotesTab(id) {
    if (notesTabs.length <= 1) return;
    if (!confirm('Delete this tab and its notes?')) return;
    notesTabs = notesTabs.filter(t => t.id !== id);
    notesActiveTab = notesTabs[0].id;
    renderNotesTabs();
}

async function saveNotes() {
    const textarea = document.getElementById('notesTextarea');
    if (textarea) {
        const current = notesTabs.find(t => t.id === notesActiveTab);
        if (current) current.notes = textarea.value;
    }
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ notesTabs, notesSavedAt: new Date().toISOString() }),
        });
        document.getElementById('notesSavedAt').textContent = 'Last saved: ' + new Date().toLocaleString();
        showToast('Notes saved.', 'success');
    } catch (e) {
        showToast('Failed to save notes.', 'error');
    }
}

function cancelNotesEdit(type) {
    renderNotes(type);
    document.getElementById('notesSaveBtn-' + type).style.display = 'none';
    document.getElementById('notesCancelBtn-' + type).style.display = 'none';
}

// ==================== POETRY ====================
let currentPoemId = null;

function newPoem() {
    clearPoemEditor();
    document.getElementById('poemTitle').focus();
}

function insertPoemLink() {
    mdFormat('poemBody', 'link');
}

// Wrap the current selection (or insert a placeholder) with `before`/`after`.
// After insertion, selection is set to highlight the placeholder so the user
// can immediately overtype it. Dispatches an `input` event so any
// oninput="updatePreview()" handler refreshes the live preview.
function mdInsertAtCursor(textareaId, before, after, placeholder) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    const text = selected || placeholder;
    const inserted = before + text + after;
    ta.value = ta.value.substring(0, start) + inserted + ta.value.substring(end);
    ta.focus();
    const innerStart = start + before.length;
    ta.setSelectionRange(innerStart, innerStart + text.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// Prepend `prefix` to every line in the current selection (or to the line
// the cursor is on if there's no selection). Idempotent: if a line already
// starts with the prefix, it's stripped instead — so clicking H2 twice
// toggles the heading off.
function mdPrefixLine(textareaId, prefix) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.substring(lineStart, lineEnd);
    const lines = block.split('\n');
    const allHave = lines.every(l => l.startsWith(prefix));
    const newLines = allHave ? lines.map(l => l.slice(prefix.length)) : lines.map(l => prefix + l);
    const newBlock = newLines.join('\n');
    ta.value = value.substring(0, lineStart) + newBlock + value.substring(lineEnd);
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + newBlock.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function mdInsertLink(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    const text = prompt('Link text:', selected || '');
    if (text === null || !text.trim()) return;
    const url = prompt('URL (https://...):', 'https://');
    if (url === null || !url.trim() || url.trim() === 'https://') return;
    const md = '[' + text.trim() + '](' + url.trim() + ')';
    ta.value = ta.value.substring(0, start) + md + ta.value.substring(end);
    const newPos = start + md.length;
    ta.focus();
    ta.setSelectionRange(newPos, newPos);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function mdFormat(textareaId, kind) {
    switch (kind) {
        case 'bold':       mdInsertAtCursor(textareaId, '**', '**', 'bold text'); break;
        case 'italic':     mdInsertAtCursor(textareaId, '*', '*', 'italic text'); break;
        case 'code':       mdInsertAtCursor(textareaId, '`', '`', 'code'); break;
        case 'h2':         mdPrefixLine(textareaId, '## '); break;
        case 'h3':         mdPrefixLine(textareaId, '### '); break;
        case 'list':       mdPrefixLine(textareaId, '- '); break;
        case 'quote':      mdPrefixLine(textareaId, '> '); break;
        case 'link':       mdInsertLink(textareaId); break;
        case 'imgcaption': mdInsertCaptionedImage(textareaId); break;
    }
}

// Inserts a captioned-image template at the cursor on its own paragraph
// (blank lines on each side so the renderer treats it as a standalone
// figure). The URL placeholder is selected so the user can paste a real
// link first, then move on to fill alt and caption.
function mdInsertCaptionedImage(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart;
    const value = ta.value;
    const charBefore = start > 0 ? value.charAt(start - 1) : '';
    const charBefore2 = start > 1 ? value.charAt(start - 2) : '';
    const prefix = (start === 0)
        ? ''
        : (charBefore === '\n' && charBefore2 === '\n')
            ? ''
            : (charBefore === '\n')
                ? '\n'
                : '\n\n';
    const charAfter = value.charAt(start);
    const suffix = (charAfter === '\n' || start === value.length) ? '\n' : '\n\n';
    const altText = 'alt text';
    const urlText = 'image-url';
    const captionText = 'caption text';
    const template = `![${altText}](${urlText})\n*${captionText}*`;
    const inserted = prefix + template + suffix;
    ta.value = value.substring(0, start) + inserted + value.substring(start);
    ta.focus();
    const urlStart = start + prefix.length + 2 /* ![ */ + altText.length + 2 /* ]( */;
    const urlEnd = urlStart + urlText.length;
    ta.setSelectionRange(urlStart, urlEnd);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function updatePoemSaveBtn() {
    const btn = document.getElementById('poemSaveBtn');
    if (btn) btn.textContent = currentPoemId ? 'Update Poem' : 'Save Poem';
}

function clearPoemEditor() {
    currentPoemId = null;
    document.getElementById('poemTitle').value = '';
    document.getElementById('poemBody').value = '';
    document.getElementById('poemOrder').value = '0';
    document.getElementById('poemPublished').checked = false;
    document.getElementById('poemScheduledAt').value = '';
    document.getElementById('poemEditorTitle').textContent = 'New Poem';
    document.getElementById('deletePoemBtn').style.display = 'none';
    const sendBtn = document.getElementById('sendPoemBtn');
    if (sendBtn) sendBtn.style.display = 'none';
    updatePoemSaveBtn();
}

function loadPoemIntoEditor(poem) {
    currentPoemId = poem.id;
    document.getElementById('poemTitle').value = poem.title || '';
    document.getElementById('poemBody').value = poem.body || '';
    document.getElementById('poemOrder').value = poem.order || 0;
    document.getElementById('poemPublished').checked = !!poem.published;
    document.getElementById('poemScheduledAt').value = poem.scheduledAt ? poem.scheduledAt.slice(0, 16) : '';
    document.getElementById('poemEditorTitle').textContent = 'Edit: ' + (poem.title || 'Untitled');
    document.getElementById('deletePoemBtn').style.display = 'inline-flex';
    const sendBtn = document.getElementById('sendPoemBtn');
    if (sendBtn) sendBtn.style.display = poem.published ? 'inline-flex' : 'none';
    updatePoemSaveBtn();
}

async function savePoem() {
    const title = document.getElementById('poemTitle').value.trim();
    const body = document.getElementById('poemBody').value;
    const order = parseInt(document.getElementById('poemOrder').value) || 0;
    const published = document.getElementById('poemPublished').checked;
    const scheduledRaw = document.getElementById('poemScheduledAt').value;
    const scheduledAt = scheduledRaw ? new Date(scheduledRaw).toISOString() : null;

    if (!title) {
        showToast('Please enter a title.', 'error');
        return;
    }

    // Generate slug-based ID matching server logic so offline IDB and server use the same key
    const poemId = currentPoemId || title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');

    try {
        const result = await apiFetch('/api/poetry', {
            method: 'POST',
            body: JSON.stringify({ id: poemId, title, body, order, published, scheduledAt })
        });
        // Keep editor locked to this poem so subsequent saves are updates, not creates
        if (!currentPoemId) {
            currentPoemId = poemId;
            document.getElementById('poemEditorTitle').textContent = 'Edit: ' + title;
            document.getElementById('deletePoemBtn').style.display = 'inline-flex';
            updatePoemSaveBtn();
        } else if (result.poem && result.poem.id) {
            currentPoemId = result.poem.id;
            document.getElementById('poemEditorTitle').textContent = 'Edit: ' + title;
            document.getElementById('deletePoemBtn').style.display = 'inline-flex';
            updatePoemSaveBtn();
        }
        showToast('Poem saved!', 'success');
        loadPoems();

        // Auto-complete the poem habit when publishing
        if (published && habits.length) {
            const poemHabit = habits.find(h => h.name && h.name.toLowerCase().includes('poem') && !isHabitDone(h));
            if (poemHabit) toggleHabit(poemHabit.id, false);
        }
    } catch (e) {
        // Error shown by apiFetch
    }
}

function deletePoem() {
    if (!currentPoemId) return;
    openModal(
        'Delete Poem',
        'Are you sure you want to delete this poem? This cannot be undone.',
        'Delete',
        'btn-danger',
        async () => {
            try {
                await apiFetch('/api/poetry', {
                    method: 'DELETE',
                    body: JSON.stringify({ id: currentPoemId })
                });
                showToast('Poem deleted.', 'success');
                clearPoemEditor();
                loadPoems();
            } catch (e) {
                // Error shown
            }
        }
    );
}

async function loadPoems() {
    try {
        const data = await apiFetch('/api/poetry');
        const poems = data.poems || [];
        renderPoemList(poems);
    } catch (e) {
        document.getElementById('poemList').innerHTML =
            '<div class="empty-state"><p>Could not load poems.</p></div>';
    }
}

function renderPoemList(poems) {
    const container = document.getElementById('poemList');
    if (!poems || poems.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9998;</div><p>No poems yet. Click "+ New Poem" to start.</p></div>';
        return;
    }
    // Sort poems based on dropdown
    const sortMode = (document.getElementById('poemSortSelect') || {}).value || 'newest';
    const sorted = [...poems].sort((a, b) => {
        switch (sortMode) {
            case 'newest': return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            case 'oldest': return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
            case 'title-az': return (a.title || '').localeCompare(b.title || '');
            case 'title-za': return (b.title || '').localeCompare(a.title || '');
            case 'order': return (a.order || 0) - (b.order || 0);
            default: return 0;
        }
    });
    container.innerHTML = sorted.map(p => {
        let status;
        const isFutureSchedule = p.scheduledAt && new Date(p.scheduledAt) > new Date();
        if (isFutureSchedule && !p.published) {
            status = `<span class="status-badge status-scheduled" title="Scheduled: ${new Date(p.scheduledAt).toLocaleString()}">Scheduled</span>`;
        } else if (p.published) {
            status = '<span class="status-badge status-sent">Published</span>';
        } else {
            status = '<span class="status-badge status-draft">Draft</span>';
        }
        const preview = (p.body || '').slice(0, 60).replace(/\n/g, ' ');
        const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '';
        const schedStr = isFutureSchedule ? ' &middot; Publishes: ' + new Date(p.scheduledAt).toLocaleString() : '';
        const viewLink = p.published ? `<a href="/poetry/${encodeURIComponent(p.id)}/" target="_blank" onclick="event.stopPropagation();" style="font-size:11px;color:var(--primary-color);margin-right:8px;">View</a>` : '';
        return `<div class="poem-item" onclick='loadPoemIntoEditor(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
            <div class="poem-info">
                <div class="poem-name">${escapeHtml(p.title || 'Untitled')}</div>
                <div class="poem-meta">${dateStr ? dateStr + ' &middot; ' : ''}${preview ? escapeHtml(preview) + '...' : 'Empty'} &middot; Order: ${p.order || 0}${schedStr}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">${viewLink}${status}</div>
        </div>`;
    }).join('');
}

// ==================== ABOUT PAGE EDITOR ====================
async function loadAboutContent() {
    try {
        const data = await apiFetch('/api/about');
        const content = data.content || '';
        document.getElementById('aboutContent').value = content;
        updateAboutPreview();

        // If empty, load from the static page as a starting point
        if (!content) {
            try {
                const resp = await fetch('/about');
                const html = await resp.text();
                const match = html.match(/<div class="wrapper">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/main>/);
                if (match) {
                    document.getElementById('aboutContent').value = match[1].trim();
                    updateAboutPreview();
                }
            } catch (e) {}
        }
    } catch (e) {
        // Error shown
    }
}

function updateAboutPreview() {
    const content = document.getElementById('aboutContent').value;
    document.getElementById('aboutPreview').innerHTML = content || '<div class="empty-state"><p>Start typing to see a preview...</p></div>';
}

async function saveAboutContent() {
    const content = document.getElementById('aboutContent').value;
    try {
        await apiFetch('/api/about', {
            method: 'POST',
            body: JSON.stringify({ content })
        });
        showToast('About page saved!', 'success');
    } catch (e) {
        // Error shown
    }
}

// ==================== SITE SETTINGS ====================
let glDailyGoal = 10;

async function loadSettings() {
    try {
        const data = await apiFetch('/api/settings');
        const langs = data.languages || {};
        document.getElementById('toggleIndonesian').checked = !!langs.indonesian;
        document.getElementById('togglePersian').checked = !!langs.persian;
        if (data.dailyWordGoal) {
            glDailyGoal = parseInt(data.dailyWordGoal) || 10;
            document.getElementById('glDailyGoal').value = glDailyGoal;
        }
        // Site title fields
        document.getElementById('siteTitleEn').value = data.siteTitle || '';
        document.getElementById('siteTitleId').value = data.siteTitleId || '';
        document.getElementById('siteTitleFa').value = data.siteTitleFa || '';
        // Site tagline fields
        document.getElementById('siteTaglineEn1').value = data.siteTaglineEn1 || '';
        document.getElementById('siteTaglineEn2').value = data.siteTaglineEn2 || '';
        document.getElementById('siteTaglineId1').value = data.siteTaglineId1 || '';
        document.getElementById('siteTaglineId2').value = data.siteTaglineId2 || '';
        document.getElementById('siteTaglineFa1').value = data.siteTaglineFa1 || '';
        document.getElementById('siteTaglineFa2').value = data.siteTaglineFa2 || '';
    } catch (e) {
        // Defaults are off, which is fine
    }
}

async function saveSiteBranding() {
    const payload = {
        siteTitle: document.getElementById('siteTitleEn').value.trim(),
        siteTitleId: document.getElementById('siteTitleId').value.trim(),
        siteTitleFa: document.getElementById('siteTitleFa').value.trim(),
        siteTaglineEn1: document.getElementById('siteTaglineEn1').value.trim(),
        siteTaglineEn2: document.getElementById('siteTaglineEn2').value.trim(),
        siteTaglineId1: document.getElementById('siteTaglineId1').value.trim(),
        siteTaglineId2: document.getElementById('siteTaglineId2').value.trim(),
        siteTaglineFa1: document.getElementById('siteTaglineFa1').value.trim(),
        siteTaglineFa2: document.getElementById('siteTaglineFa2').value.trim(),
    };
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showToast('Site branding saved.', 'success');
    } catch (e) { /* Error shown by apiFetch */ }
}

async function saveDailyGoal(val) {
    glDailyGoal = parseInt(val) || 10;
    document.getElementById('glDailyGoal').value = glDailyGoal;
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ dailyWordGoal: glDailyGoal })
        });
        loadGoldList();
    } catch (e) { /* Error shown */ }
}

async function saveLanguageToggle(language, enabled) {
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ languages: { [language]: enabled } })
        });
        showToast(`${language.charAt(0).toUpperCase() + language.slice(1)} ${enabled ? 'enabled' : 'disabled'} on public site.`, 'success');
    } catch (e) {
        // Error shown by apiFetch
    }
}

// ==================== BLOG IMAGE UPLOAD ====================
let imageUploadMode = 'cover'; // 'cover' or 'inline'
let imageUploadFile = null;
let imageUploadPasteHandler = null;

const IMAGE_IS_TOUCH = (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
const IMAGE_COMPRESS_SAFETY_CAP = 2400; // never exceed this even on "Original"
const IMAGE_COMPRESS_SIZE_THRESHOLD = 2 * 1024 * 1024; // 2 MB
const IMAGE_COMPRESS_QUALITY = 0.85;
// Types that benefit from canvas re-encoding; SVG and GIF should pass through untouched.
const IMAGE_COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function openImageUploader(mode) {
    imageUploadMode = mode;
    imageUploadFile = null;
    document.getElementById('imageModalTitle').textContent = mode === 'cover' ? 'Upload Cover Image' : 'Upload Inline Image';
    document.getElementById('imageUploadPreview').style.display = 'none';
    document.getElementById('imageUploadBtn').disabled = true;
    document.getElementById('imageUploadBtn').textContent = 'Upload & Insert';
    document.getElementById('imageFileInput').value = '';
    const camInput = document.getElementById('imageCameraInput');
    if (camInput) camInput.value = '';
    document.getElementById('imageAltInput').value = '';
    const sizeSel = document.getElementById('imageSizeInput');
    if (sizeSel) sizeSel.value = '1200';
    const progressBar = document.getElementById('imageUploadProgressBar');
    if (progressBar) progressBar.style.display = 'none';
    const progressFill = document.getElementById('imageUploadProgressFill');
    if (progressFill) progressFill.style.width = '0%';

    // Toggle the mobile-only action row on touch devices.
    const mobileActions = document.getElementById('imageMobileActions');
    if (mobileActions) mobileActions.style.display = IMAGE_IS_TOUCH ? 'flex' : 'none';

    // On touch devices the "drag & drop" copy is misleading — show a tap hint instead.
    if (IMAGE_IS_TOUCH) {
        const label = document.getElementById('imageDropZoneLabel');
        const hint = document.getElementById('imageDropZoneHint');
        if (label) label.textContent = 'Or tap to pick an image';
        if (hint) hint.textContent = 'JPEG, PNG, WebP, GIF, SVG';
    }

    // Auto-fill folder from slug
    const slug = document.getElementById('postSlug').value.trim();
    document.getElementById('imageFolderInput').value = slug || 'general';
    document.getElementById('imageUploadModal').style.display = 'flex';

    // Paste support: while the modal is open, an image in the system clipboard becomes the selected file.
    imageUploadPasteHandler = function(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    e.preventDefault();
                    handleImageSelect(file);
                    return;
                }
            }
        }
    };
    document.addEventListener('paste', imageUploadPasteHandler);
}

function closeImageModal() {
    document.getElementById('imageUploadModal').style.display = 'none';
    imageUploadFile = null;
    if (imageUploadPasteHandler) {
        document.removeEventListener('paste', imageUploadPasteHandler);
        imageUploadPasteHandler = null;
    }
}

function handleImageDrop(e) {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'var(--gray-300)';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageSelect(file);
}

function handleImageSelect(file) {
    if (!file) return;
    imageUploadFile = file;
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('imageUploadPreviewImg').src = e.target.result;
        document.getElementById('imageUploadPreview').style.display = 'block';
        document.getElementById('imageUploadStatus').textContent = file.name + ' (' + formatBytes(file.size) + ')';
    };
    reader.readAsDataURL(file);
    document.getElementById('imageUploadBtn').disabled = false;
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// Downscale a photo to the given target longest-edge via canvas. targetWidth=0 means "no resize"
// (we still cap at IMAGE_COMPRESS_SAFETY_CAP to keep file sizes reasonable). Returns the original
// File when no re-encoding is needed.
async function compressImageIfLarge(file, targetWidth) {
    if (!IMAGE_COMPRESSIBLE_TYPES.has(file.type)) return file;
    const cap = targetWidth > 0 ? targetWidth : IMAGE_COMPRESS_SAFETY_CAP;
    // Skip re-encoding when the user picked "Original" and the file is already small.
    if (targetWidth === 0 && file.size < IMAGE_COMPRESS_SIZE_THRESHOLD) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;
        const longest = Math.max(width, height);
        const scale = longest > cap ? cap / longest : 1;
        // Original-size small file: no scale, no re-encode needed.
        if (scale === 1 && file.size < IMAGE_COMPRESS_SIZE_THRESHOLD) {
            bitmap.close && bitmap.close();
            return file;
        }
        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close && bitmap.close();
        // Preserve PNG transparency; everything else can re-encode as JPEG for size.
        const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, IMAGE_COMPRESS_QUALITY));
        if (!blob || blob.size >= file.size) return file; // fall back if compression didn't help
        const newName = file.name.replace(/\.[^.]+$/, '') + (outType === 'image/png' ? '.png' : '.jpg');
        return new File([blob], newName, { type: outType, lastModified: Date.now() });
    } catch (e) {
        return file;
    }
}

async function uploadImage() {
    if (!imageUploadFile) return;
    const btn = document.getElementById('imageUploadBtn');
    const statusEl = document.getElementById('imageUploadStatus');
    const progressBar = document.getElementById('imageUploadProgressBar');
    const progressFill = document.getElementById('imageUploadProgressFill');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    try {
        const folder = document.getElementById('imageFolderInput').value.trim() || 'general';
        const sizeSel = document.getElementById('imageSizeInput');
        const targetWidth = sizeSel ? parseInt(sizeSel.value, 10) || 0 : 1200;
        const originalSize = imageUploadFile.size;

        if (statusEl) statusEl.textContent = 'Preparing image…';
        const uploadFile = await compressImageIfLarge(imageUploadFile, targetWidth);
        if (statusEl && uploadFile !== imageUploadFile) {
            statusEl.textContent = 'Compressed ' + formatBytes(originalSize) + ' → ' + formatBytes(uploadFile.size);
        }

        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('folder', folder);

        if (progressBar) progressBar.style.display = 'block';
        if (progressFill) progressFill.style.width = '0%';

        const data = await xhrUploadWithProgress('/api/blog-images', formData, (pct) => {
            if (progressFill) progressFill.style.width = pct + '%';
            if (statusEl) statusEl.textContent = 'Uploading… ' + pct + '%';
        });

        if (data.ok) {
            const alt = document.getElementById('imageAltInput').value.trim() || uploadFile.name;
            if (imageUploadMode === 'cover') {
                document.getElementById('postImage').value = data.url;
                updateCoverPreview(data.url);
            } else {
                // Embed |<width> in the alt text so the build (and live preview) emit width="N".
                // targetWidth === 0 = "Original" — let the image render at its natural size.
                const altWithWidth = targetWidth > 0 ? `${alt}|${targetWidth}` : alt;
                const textarea = document.getElementById('postBody');
                const pos = textarea.selectionStart;
                const before = textarea.value.substring(0, pos);
                const after = textarea.value.substring(pos);
                textarea.value = before + `\n![${altWithWidth}](${data.url})\n` + after;
                updatePreview();
            }
            showToast('Image uploaded!', 'success');
            closeImageModal();
        } else {
            showToast(data.error || 'Upload failed', 'error');
        }
    } catch (e) {
        showToast((e && e.message) || 'Upload failed', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Upload & Insert';
    if (progressBar) progressBar.style.display = 'none';
}

// XHR upload that reports byte-level progress to a callback. Falls back to fetch behavior on response.
function xhrUploadWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = function() {
            try {
                const data = JSON.parse(xhr.responseText || '{}');
                if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                else reject(new Error(data.error || ('Upload failed (' + xhr.status + ')')));
            } catch (err) {
                reject(new Error('Upload failed: invalid response'));
            }
        };
        xhr.onerror = function() { reject(new Error('Network error during upload')); };
        xhr.ontimeout = function() { reject(new Error('Upload timed out')); };
        xhr.send(formData);
    });
}

function updateCoverPreview(url) {
    const preview = document.getElementById('coverImagePreview');
    const img = document.getElementById('coverImagePreviewImg');
    if (url) {
        img.src = resolveImageSrc(url);
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
}

// Update cover preview when image URL changes
document.getElementById('postImage').addEventListener('input', function() {
    updateCoverPreview(this.value.trim());
});

// Image browser
function openImageBrowser() {
    document.getElementById('imageBrowserModal').style.display = 'flex';
    loadImageBrowser();
}

function closeImageBrowser() {
    document.getElementById('imageBrowserModal').style.display = 'none';
}

async function loadImageBrowser() {
    const grid = document.getElementById('imageBrowserGrid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--gray-400);">Loading...</div>';

    try {
        const data = await apiFetch('/api/blog-images');
        const images = data.images || [];

        if (images.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--gray-400);">No images uploaded yet.</div>';
            return;
        }

        grid.innerHTML = images.map(img => {
            const name = img.key.split('/').pop();
            return `<div style="border:1px solid var(--gray-200);border-radius:8px;overflow:hidden;cursor:pointer;transition:border-color 0.2s;" onclick="insertBrowserImage('${img.url}','${esc(name)}')" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--gray-200)'">
                <img src="${img.url}" alt="${esc(name)}" style="width:100%;height:140px;object-fit:cover;" loading="lazy">
                <div style="padding:6px 8px;font-size:11px;color:var(--gray-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
                <div style="padding:0 8px 6px;display:flex;gap:4px;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();copyImageUrl('${img.url}')" style="font-size:10px;padding:2px 6px;">Copy URL</button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteBlogImage('${img.key}')" style="font-size:10px;padding:2px 6px;">Delete</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--coral);">Failed to load images.</div>';
    }
}

function insertBrowserImage(url, name) {
    const sizeSel = document.getElementById('imageBrowserSizeInput');
    const width = sizeSel ? parseInt(sizeSel.value, 10) || 0 : 0;
    const altWithWidth = width > 0 ? `${name}|${width}` : name;
    const textarea = document.getElementById('postBody');
    const pos = textarea.selectionStart;
    const before = textarea.value.substring(0, pos);
    const after = textarea.value.substring(pos);
    textarea.value = before + `\n![${altWithWidth}](${url})\n` + after;
    updatePreview();
    closeImageBrowser();
    showToast('Image inserted!', 'success');
}

function copyImageUrl(url) {
    navigator.clipboard.writeText(url).then(() => showToast('URL copied!', 'success'));
}

async function deleteBlogImage(key) {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    try {
        await apiFetch('/api/blog-images', { method: 'DELETE', body: JSON.stringify({ key }) });
        showToast('Image deleted', 'success');
        loadImageBrowser();
    } catch (e) {
        showToast('Failed to delete', 'error');
    }
}
