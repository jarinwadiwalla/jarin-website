/* ==========================================================================
   Guru Dashboard — Dashboard Module
   Stats, newsletter, subscribers, todos, focus banner, reading goal
   ========================================================================== */

// ==================== DASHBOARD STATS ====================
async function loadDashboardStats() {
    // Subscriber count
    try {
        const data = await apiFetch('/api/subscriber-count');
        document.getElementById('subscriberCount').textContent = data.count || 0;
    } catch (e) {
        document.getElementById('subscriberCount').textContent = '--';
    }

    // Draft count from API; published count from blog-publish endpoint
    try {
        const data = await apiFetch('/api/blog-drafts');
        const drafts = data.drafts || data || [];
        document.getElementById('draftCount').textContent = Array.isArray(drafts) ? drafts.length : 0;
    } catch (e) {
        document.getElementById('draftCount').textContent = '--';
    }
    try {
        const res = await apiFetch('/api/blog-count');
        document.getElementById('publishedCount').textContent = res.count || 0;
    } catch (e) {
        document.getElementById('publishedCount').textContent = '--';
    }

    // Poetry counts
    try {
        const data = await apiFetch('/api/poetry');
        const poems = data.poems || [];
        const published = poems.filter(p => p.published);
        const drafts = poems.filter(p => !p.published);
        document.getElementById('publishedPoemCount').textContent = published.length;
        document.getElementById('draftPoemCount').textContent = drafts.length;
        document.getElementById('totalPoemCount').textContent = poems.length;
    } catch (e) {
        document.getElementById('publishedPoemCount').textContent = '--';
        document.getElementById('draftPoemCount').textContent = '--';
        document.getElementById('totalPoemCount').textContent = '--';
    }
}

async function resyncSubscriberCount() {
    try {
        const data = await apiFetch('/api/subscriber-count', { method: 'POST' });
        document.getElementById('subscriberCount').textContent = data.count || 0;
        showToast(`Subscriber count resynced: ${data.count}`, 'success');
    } catch (e) {
        showToast('Failed to resync count.', 'error');
    }
}

// ==================== NEWSLETTER ====================

// ---- Visual editor (WYSIWYG mode for newsletter compose) ----
let _nlComposeMode = 'visual';

function setNlComposeMode(mode) {
    if (mode !== 'visual' && mode !== 'html') return;
    const visual = document.getElementById('nlVisualEditor');
    const textarea = document.getElementById('nlBody');
    const visualBtn = document.getElementById('nlModeVisual');
    const htmlBtn = document.getElementById('nlModeHtml');
    const hint = document.getElementById('nlModeHint');
    if (!visual || !textarea) return;

    if (mode === 'visual') {
        syncNlTextareaToVisual();
        visual.style.display = 'block';
        textarea.style.display = 'none';
        visualBtn.style.background = 'var(--primary)';
        visualBtn.style.color = 'white';
        htmlBtn.style.background = 'transparent';
        htmlBtn.style.color = 'var(--gray-600)';
        if (hint) hint.textContent = 'Click any text in the preview below to edit it directly. Drag images to insert.';
    } else {
        syncNlVisualToTextarea();
        visual.style.display = 'none';
        textarea.style.display = 'block';
        visualBtn.style.background = 'transparent';
        visualBtn.style.color = 'var(--gray-600)';
        htmlBtn.style.background = 'var(--primary)';
        htmlBtn.style.color = 'white';
        if (hint) hint.textContent = 'Edit raw HTML directly. Switch back to Visual to see the rendered preview.';
    }
    _nlComposeMode = mode;
}

function syncNlTextareaToVisual() {
    const visual = document.getElementById('nlVisualEditor');
    const textarea = document.getElementById('nlBody');
    if (!visual || !textarea) return;
    visual.innerHTML = textarea.value || '';
}

function syncNlVisualToTextarea() {
    const visual = document.getElementById('nlVisualEditor');
    const textarea = document.getElementById('nlBody');
    if (!visual || !textarea) return;
    textarea.value = visual.innerHTML || '';
}

// Ensure textarea is current before any send action
function syncNlBeforeSend() {
    if (_nlComposeMode === 'visual') syncNlVisualToTextarea();
}

// ---- Inline link editor ----
let _nlEditingLinkEl = null;

function findNlAncestorLink(node, root) {
    while (node && node !== root) {
        if (node.nodeType === 1 && node.tagName === 'A') return node;
        node = node.parentNode;
    }
    return null;
}

function openNlLinkPopup(linkEl) {
    _nlEditingLinkEl = linkEl;
    const popup = document.getElementById('nlLinkPopup');
    document.getElementById('nlLinkText').value = linkEl.textContent || '';
    document.getElementById('nlLinkUrl').value = linkEl.getAttribute('href') || '';
    const rect = linkEl.getBoundingClientRect();
    popup.style.display = 'block';
    popup.style.left = '-9999px';
    popup.style.top = '-9999px';
    const popupRect = popup.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + popupRect.width > window.innerWidth - 10) left = window.innerWidth - popupRect.width - 10;
    if (top + popupRect.height > window.innerHeight - 10) top = rect.top - popupRect.height - 6;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    setTimeout(() => document.getElementById('nlLinkUrl').focus(), 50);
}

function closeNlLinkPopup() {
    document.getElementById('nlLinkPopup').style.display = 'none';
    _nlEditingLinkEl = null;
}

function saveNlLinkInEditor() {
    if (!_nlEditingLinkEl) return;
    const text = document.getElementById('nlLinkText').value;
    const url = document.getElementById('nlLinkUrl').value.trim();
    if (!url) {
        alert('URL cannot be empty. Click "Remove Link" to convert it back to plain text.');
        return;
    }
    _nlEditingLinkEl.setAttribute('href', url);
    if (text && text !== _nlEditingLinkEl.textContent) {
        _nlEditingLinkEl.textContent = text;
    }
    syncNlVisualToTextarea();
    autoSaveNlDraft();
    closeNlLinkPopup();
}

function removeNlLinkInEditor() {
    if (!_nlEditingLinkEl) return;
    const text = document.createTextNode(_nlEditingLinkEl.textContent);
    _nlEditingLinkEl.parentNode.replaceChild(text, _nlEditingLinkEl);
    syncNlVisualToTextarea();
    autoSaveNlDraft();
    closeNlLinkPopup();
}

// ---- Image upload (uses existing /api/blog-images) ----
async function uploadNlImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please select an image file.', 'error');
        return null;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'newsletter');
    try {
        const res = await fetch('/api/blog-images', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
        return data.url || data.path;
    } catch (e) {
        showToast('Image upload failed: ' + e.message, 'error');
        return null;
    }
}

function insertNlImageAtCursor(url) {
    const visual = document.getElementById('nlVisualEditor');
    const img = document.createElement('img');
    // Email clients can't resolve site-relative paths against the
    // newsletter HTML — they have no <base href> to anchor against.
    // Force the absolute origin so the email image actually loads.
    img.src = url && url.startsWith('/') ? 'https://jarinwadiwalla.com' + url : url;
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '12px 0';
    const sel = window.getSelection();
    if (sel.rangeCount && visual.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        visual.appendChild(img);
    }
    syncNlVisualToTextarea();
    autoSaveNlDraft();
}

async function handleNlImagePicker(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const btn = document.getElementById('nlInsertImageBtn');
    const orig = btn.textContent;
    btn.textContent = 'Uploading...';
    btn.disabled = true;
    const url = await uploadNlImageFile(file);
    btn.textContent = orig;
    btn.disabled = false;
    input.value = '';
    if (url) insertNlImageAtCursor(url);
}

// ---- Auto-save (localStorage) ----
const NL_DRAFT_KEY = 'jarin-newsletter-draft';
let _nlDraftSaveTimer = null;

function autoSaveNlDraft() {
    clearTimeout(_nlDraftSaveTimer);
    _nlDraftSaveTimer = setTimeout(() => {
        try {
            const subject = document.getElementById('nlSubject').value || '';
            const body = document.getElementById('nlBody').value || '';
            if (!body.trim() && !subject.trim()) return;
            const draft = { subject, body, ts: Date.now() };
            localStorage.setItem(NL_DRAFT_KEY, JSON.stringify(draft));
            const status = document.getElementById('nlAutosaveStatus');
            if (status) {
                status.innerHTML = '<span style="color:#16a34a;">&#10003; Auto-saved at ' + new Date().toLocaleTimeString() + '</span>';
            }
        } catch (_) {}
    }, 800);
}

function loadNlLocalDraft() {
    try {
        const raw = localStorage.getItem(NL_DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function showNlDraftBanner() {
    const draft = loadNlLocalDraft();
    if (!draft || (!draft.body && !draft.subject)) return;
    const banner = document.getElementById('nlDraftBanner');
    const info = document.getElementById('nlDraftInfo');
    if (!banner || !info) return;
    info.textContent = '"' + (draft.subject || 'Untitled') + '" — saved ' + new Date(draft.ts).toLocaleString();
    banner.style.display = 'block';
}

function restoreNlLocalDraft() {
    const draft = loadNlLocalDraft();
    if (!draft) return;
    document.getElementById('nlSubject').value = draft.subject || '';
    document.getElementById('nlBody').value = draft.body || '';
    syncNlTextareaToVisual();
    document.getElementById('nlDraftBanner').style.display = 'none';
    showToast('Draft restored.', 'success');
}

function dismissNlLocalDraft() {
    try { localStorage.removeItem(NL_DRAFT_KEY); } catch (_) {}
    document.getElementById('nlDraftBanner').style.display = 'none';
}

// Wire up the visual editor on first load
(function initNlVisualEditor() {
    const tryInit = () => {
        const visual = document.getElementById('nlVisualEditor');
        const textarea = document.getElementById('nlBody');
        if (!visual || !textarea || visual.dataset.bound) {
            if (!visual || !textarea) setTimeout(tryInit, 200);
            return;
        }
        visual.dataset.bound = '1';

        visual.addEventListener('input', () => {
            syncNlVisualToTextarea();
            autoSaveNlDraft();
        });

        visual.addEventListener('click', (e) => {
            const link = findNlAncestorLink(e.target, visual);
            if (link) {
                e.preventDefault();
                e.stopPropagation();
                openNlLinkPopup(link);
            }
        });

        visual.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
                document.execCommand('insertText', false, text);
            } else {
                const sel = window.getSelection();
                if (sel.rangeCount) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false);
                }
            }
            syncNlVisualToTextarea();
            autoSaveNlDraft();
        });

        visual.addEventListener('dragover', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
                e.preventDefault();
                visual.style.outline = '2px dashed var(--primary)';
            }
        });
        visual.addEventListener('dragleave', () => { visual.style.outline = 'none'; });
        visual.addEventListener('drop', async (e) => {
            visual.style.outline = 'none';
            const files = e.dataTransfer && e.dataTransfer.files;
            if (!files || files.length === 0) return;
            e.preventDefault();
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    const url = await uploadNlImageFile(file);
                    if (url) insertNlImageAtCursor(url);
                }
            }
        });

        visual.addEventListener('blur', syncNlVisualToTextarea);

        // Sync subject input + body textarea changes to auto-save
        const subjectInput = document.getElementById('nlSubject');
        if (subjectInput && !subjectInput.dataset.autoSaveBound) {
            subjectInput.addEventListener('input', autoSaveNlDraft);
            subjectInput.dataset.autoSaveBound = '1';
        }
        if (!textarea.dataset.autoSaveBound) {
            textarea.addEventListener('input', autoSaveNlDraft);
            textarea.dataset.autoSaveBound = '1';
        }

        // Close link popup on outside click
        document.addEventListener('mousedown', (e) => {
            const popup = document.getElementById('nlLinkPopup');
            if (popup && popup.style.display === 'block' && !popup.contains(e.target) && !findNlAncestorLink(e.target, visual)) {
                closeNlLinkPopup();
            }
        });

        showNlDraftBanner();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();

async function sendTestEmail() {
    syncNlBeforeSend();
    const subject = document.getElementById('nlSubject').value.trim();
    const body = document.getElementById('nlBody').value.trim();
    const testEmail = document.getElementById('testEmail').value.trim();

    if (!subject || !body) {
        showToast('Subject and body are required.', 'error');
        return;
    }
    if (!testEmail) {
        showToast('Enter a test email address.', 'error');
        return;
    }

    try {
        await apiFetch('/api/newsletter-send', {
            method: 'POST',
            body: JSON.stringify({ subject, htmlBody: body, testEmails: [testEmail] })
        });
        showToast(`Test email sent to ${testEmail}!`, 'success');
    } catch (e) {
        // Error already shown
    }
}

function sendToAll() {
    syncNlBeforeSend();
    const subject = document.getElementById('nlSubject').value.trim();
    const body = document.getElementById('nlBody').value.trim();
    const audience = document.getElementById('nlAudience')?.value || 'all';

    if (!subject || !body) {
        showToast('Subject and body are required.', 'error');
        return;
    }

    const audienceLabel = audience === 'all' ? 'ALL subscribers' : audience === 'blog' ? 'blog subscribers' : 'poetry subscribers';
    openModal(
        'Send Newsletter',
        `This will send "${subject}" to ${audienceLabel}. This action cannot be undone. Are you sure?`,
        'Send',
        'btn-danger',
        async () => {
            try {
                await apiFetch('/api/newsletter-send', {
                    method: 'POST',
                    body: JSON.stringify({ subject, htmlBody: body, contentType: audience })
                });
                showToast(`Newsletter sent to ${audienceLabel}!`, 'success');
                document.getElementById('nlSubject').value = '';
                document.getElementById('nlBody').value = '';
                syncNlTextareaToVisual();
                try { localStorage.removeItem(NL_DRAFT_KEY); } catch (_) {}
                loadCampaigns();
            } catch (e) {
                // Error already shown
            }
        }
    );
}

async function loadCampaigns() {
    try {
        const campaigns = await apiFetch('/api/newsletter-campaigns');
        renderCampaigns(campaigns);
    } catch (e) {
        document.getElementById('campaignList').innerHTML =
            '<div class="empty-state"><p>Could not load campaigns.</p></div>';
    }
}

function renderCampaigns(campaigns) {
    const container = document.getElementById('campaignList');
    if (!campaigns || campaigns.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128231;</div><p>No campaigns sent yet.</p></div>';
        return;
    }
    let html = '<table><thead><tr><th>Subject</th><th>Sent</th><th>Recipients</th><th>Status</th></tr></thead><tbody>';
    campaigns.forEach(c => {
        const statusClass = c.status === 'sent' ? 'status-sent' : (c.status === 'failed' ? 'status-failed' : 'status-draft');
        html += `<tr>
            <td>${escapeHtml(c.subject || '')}</td>
            <td>${c.sentAt || '--'}</td>
            <td>${c.recipientCount || '--'}</td>
            <td><span class="status-badge ${statusClass}">${c.status || 'unknown'}</span></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ==================== EMAIL TEMPLATES ====================
const DEFAULT_POEM_TEMPLATE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#4a1942,#6b2fa0);padding:32px;text-align:center;">
    <h1 style="color:#ffffff;font-size:22px;margin:0;">New Poem</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="font-size:16px;color:#1f2937;margin:0 0 8px;">Hey {{firstName}},</p>
    <p style="font-size:15px;color:#374151;margin:0 0 24px;">I just published a new poem:</p>
    <h2 style="font-family:Georgia,serif;font-size:24px;color:#1f2937;margin:0 0 8px;text-align:center;">{{title}}</h2>
    <p style="font-size:13px;color:#9ca3af;text-align:center;margin:0 0 20px;">{{date}}</p>
    <div style="white-space:pre-wrap;font-family:Georgia,serif;font-size:16px;line-height:1.8;color:#374151;padding:16px 24px;border-left:3px solid #6b2fa0;margin:0 0 24px;">{{content}}</div>
    <p style="text-align:center;margin:24px 0;">
      <a href="{{url}}" style="display:inline-block;padding:12px 28px;background:#6b2fa0;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Read on Website</a>
    </p>
    <p style="font-size:16px;color:#1f2937;margin:0;">— Jarin</p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      You're receiving this because you subscribed to poetry updates at jarinwadiwalla.com.
      <a href="{{unsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

const DEFAULT_BLOG_TEMPLATE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#1a3d2a,#2D5F3F);padding:32px;text-align:center;">
    <h1 style="color:#ffffff;font-size:22px;margin:0;">New Blog Post</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="font-size:16px;color:#1f2937;margin:0 0 8px;">Hey {{firstName}},</p>
    <p style="font-size:15px;color:#374151;margin:0 0 24px;">I just published a new blog post:</p>
    <h2 style="font-size:22px;color:#1f2937;margin:0 0 8px;">{{title}}</h2>
    <p style="font-size:13px;color:#9ca3af;margin:0 0 16px;">{{date}}</p>
    <div style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 24px;">{{content}}</div>
    <p style="text-align:center;margin:24px 0;">
      <a href="{{url}}" style="display:inline-block;padding:12px 28px;background:#2D5F3F;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Read Full Post</a>
    </p>
    <p style="font-size:16px;color:#1f2937;margin:0;">— Jarin</p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      You're receiving this because you subscribed to blog updates at jarinwadiwalla.com.
      <a href="{{unsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

async function loadEmailTemplates() {
    try {
        const data = await apiFetch('/api/settings');
        document.getElementById('tplPoem').value = data.poemEmailTemplate || DEFAULT_POEM_TEMPLATE;
        document.getElementById('tplBlog').value = data.blogEmailTemplate || DEFAULT_BLOG_TEMPLATE;
    } catch (e) {}
}

async function saveEmailTemplates() {
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({
                poemEmailTemplate: document.getElementById('tplPoem').value,
                blogEmailTemplate: document.getElementById('tplBlog').value,
            }),
        });
        showToast('Email templates saved.', 'success');
    } catch (e) { showToast('Failed to save templates.', 'error'); }
}

async function sendPoemToSubscribers() {
    const title = document.getElementById('poemTitle').value.trim();
    const body = document.getElementById('poemBody').value;
    if (!title || !body) { showToast('Poem has no content.', 'error'); return; }
    const tpl = document.getElementById('tplPoem')?.value || DEFAULT_POEM_TEMPLATE;
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const poemId = currentPoemId || title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const url = 'https://jarinwadiwalla.com/poetry/' + poemId + '/';
    const contentHtml = escapeHtml(body).replace(/\n/g, '<br>');
    const htmlBody = tpl
        .replace(/\{\{title\}\}/g, escapeHtml(title))
        .replace(/\{\{content\}\}/g, contentHtml)
        .replace(/\{\{date\}\}/g, date)
        .replace(/\{\{url\}\}/g, url);

    openModal('Send Poem to Subscribers', `Send "${title}" to all poetry subscribers?`, 'Send', 'btn-primary', async () => {
        try {
            const res = await apiFetch('/api/newsletter-send', {
                method: 'POST',
                body: JSON.stringify({ subject: 'New Poem: ' + title, htmlBody: htmlBody, contentType: 'poetry' }),
            });
            showToast(res.message || 'Poem sent to subscribers!', 'success');
            loadCampaigns();
        } catch (e) { showToast('Failed to send poem.', 'error'); }
    });
}

// Render a blog post into the configured email template. The
// {{content}} variable becomes a 300-char text preview (markdown
// stripped). All sends to blog subscribers go through this so the
// preview shown in the newsletter compose pane matches the wire.
function buildBlogEmailHtml({ title, body, slug, date }) {
    const tpl = document.getElementById('tplBlog')?.value || DEFAULT_BLOG_TEMPLATE;
    const dateStr = date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const slugForUrl = slug || (title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const url = 'https://jarinwadiwalla.com/blog/' + slugForUrl + '/';
    const cleanBody = body || '';
    const preview = cleanBody.replace(/[#*_`>[\]()!]/g, '').slice(0, 300).trim() + (cleanBody.length > 300 ? '...' : '');
    return tpl
        .replace(/\{\{title\}\}/g, escapeHtml(title || ''))
        .replace(/\{\{content\}\}/g, '<p>' + escapeHtml(preview) + '</p>')
        .replace(/\{\{date\}\}/g, dateStr)
        .replace(/\{\{url\}\}/g, url);
}

// Populates the newsletter compose form (subject / HTML body /
// audience) with a blog post rendered through the blog template,
// then switches the editor to Visual mode so the user sees the
// rendered preview immediately. Does NOT send — user must click
// "Send to Subscribers" or "Send Test" themselves.
function loadBlogPostIntoNewsletter({ title, body, slug, date }) {
    if (!title) { showToast('Post needs a title.', 'error'); return; }
    const html = buildBlogEmailHtml({ title, body, slug, date });
    const subjEl = document.getElementById('nlSubject');
    const bodyEl = document.getElementById('nlBody');
    const audSel = document.getElementById('nlAudience');
    if (subjEl) subjEl.value = 'New Post: ' + title;
    if (bodyEl) bodyEl.value = html;
    if (audSel) audSel.value = 'blog';
    setNlComposeMode('visual');
    syncNlTextareaToVisual();
    showToast('Loaded "' + title + '" — review the preview, then send.', 'success');
}

async function openLoadBlogPostPicker() {
    let posts = [];
    try {
        const data = await apiFetch('/api/blog-posts');
        posts = data.posts || [];
    } catch (e) {
        showToast('Failed to load blog posts.', 'error');
        return;
    }
    if (!posts.length) { showToast('No published posts yet.', 'error'); return; }

    const existing = document.getElementById('blogPostPickerModal');
    if (existing) existing.remove();

    const items = posts.map(p => `
        <button type="button" class="bp-pick-item" data-slug="${escapeHtml(p.slug)}" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;border-bottom:1px solid var(--gray-200);cursor:pointer;">
            <div style="font-weight:600;color:var(--gray-800);font-size:14px;">${escapeHtml(p.title || p.slug)}</div>
            ${p.date ? '<div style="font-size:12px;color:var(--gray-400);margin-top:2px;">' + escapeHtml(p.date) + '</div>' : ''}
        </button>`).join('');

    const modal = document.createElement('div');
    modal.id = 'blogPostPickerModal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-box" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--gray-200);">
                <h3 style="margin:0;font-size:16px;">Select a Blog Post</h3>
                <button type="button" id="bpPickClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);">&times;</button>
            </div>
            <div style="overflow-y:auto;">${items}</div>
        </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#bpPickClose').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelectorAll('.bp-pick-item').forEach(btn => {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--gray-50)');
        btn.addEventListener('mouseleave', () => btn.style.background = '');
        btn.addEventListener('click', async () => {
            const slug = btn.dataset.slug;
            modal.remove();
            try {
                const detail = await apiFetch('/api/blog-posts?slug=' + encodeURIComponent(slug));
                const full = detail.post || {};
                loadBlogPostIntoNewsletter({
                    title: full.title || slug,
                    body: full.body || '',
                    slug: full.slug || slug,
                    date: full.date || '',
                });
            } catch (e) {
                showToast('Failed to load post body.', 'error');
            }
        });
    });
}

// "Send to Subscribers" button on the published-post editor used to
// confirm-and-send directly. Now it routes through the newsletter
// compose pane so the user sees the rendered preview first.
function sendBlogToSubscribers() {
    const title = document.getElementById('postTitle')?.value?.trim() || '';
    const body = document.getElementById('postBody')?.value || '';
    const slug = document.getElementById('postSlug')?.value?.trim() || '';
    const date = document.getElementById('postDate')?.value || '';
    if (!title) { showToast('Blog post has no title.', 'error'); return; }
    if (typeof switchWebMode === 'function') switchWebMode('newsletter');
    loadBlogPostIntoNewsletter({ title, body, slug, date });
}

// ==================== SUBSCRIBERS ====================
async function loadSubscribers() {
    try {
        const data = await apiFetch('/api/subscribers');
        const subscribers = data.subscribers || data || [];
        renderSubscribers(subscribers);
    } catch (e) {
        document.getElementById('subscriberTable').innerHTML =
            '<div class="empty-state"><p>Could not load subscribers.</p></div>';
    }
}

function renderSubscribers(subscribers) {
    const container = document.getElementById('subscriberTable');
    if (!subscribers || subscribers.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128101;</div><p>No subscribers yet.</p></div>';
        return;
    }
    const active = subscribers.filter(s => !s.unsubscribed).length;
    const unsub = subscribers.length - active;
    let html = `<p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">${active} active` + (unsub > 0 ? `, ${unsub} unsubscribed` : '') + ` — ${subscribers.length} total</p>`;
    html += '<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Signup Date</th><th></th></tr></thead><tbody>';
    subscribers.forEach(s => {
        const date = s.subscribedAt ? new Date(s.subscribedAt).toLocaleDateString() : '--';
        const name = escapeHtml([s.firstName, s.lastName].filter(Boolean).join(' ') || '--');
        const status = s.unsubscribed
            ? '<span style="background:var(--red-light);color:var(--red);padding:2px 8px;border-radius:4px;font-size:12px;">Unsubscribed</span>'
            : '<span style="background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:4px;font-size:12px;">Active</span>';
        html += `<tr>
            <td>${name}</td>
            <td>${escapeHtml(s.email || '--')}</td>
            <td>${status}</td>
            <td>${date}</td>
            <td><button class="btn btn-sm" style="background:var(--red-light);color:var(--red);font-size:12px;padding:4px 10px;" onclick="deleteSubscriber('${escapeHtml(s.email)}')">Delete</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ==================== SUBSCRIBER MODAL ====================
async function openSubscriberModal() {
    const modal = document.getElementById('subscriberModal');
    const content = document.getElementById('subscriberModalContent');
    modal.classList.add('active');
    content.innerHTML = '<p>Loading subscribers...</p>';
    try {
        const data = await apiFetch('/api/subscribers');
        const subscribers = data.subscribers || data || [];
        renderSubscriberModal(subscribers);
    } catch (e) {
        content.innerHTML = '<p>Could not load subscribers.</p>';
    }
}

function closeSubscriberModal() {
    document.getElementById('subscriberModal').classList.remove('active');
}

document.getElementById('subscriberModal').addEventListener('click', function(e) {
    if (e.target === this) closeSubscriberModal();
});

function renderSubscriberModal(subscribers) {
    const container = document.getElementById('subscriberModalContent');
    if (!subscribers || subscribers.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128101;</div><p>No subscribers yet.</p></div>';
        return;
    }
    const active = subscribers.filter(s => !s.unsubscribed);
    const unsub = subscribers.filter(s => s.unsubscribed);
    let html = `<p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">${active.length} active` + (unsub.length > 0 ? `, ${unsub.length} unsubscribed` : '') + ` — ${subscribers.length} total</p>`;
    html += '<table class="subscriber-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Status</th><th>Signed Up</th></tr></thead><tbody>';
    // Show active first, then unsubscribed
    const sorted = [...active, ...unsub];
    sorted.forEach((s, i) => {
        const date = s.subscribedAt ? new Date(s.subscribedAt).toLocaleDateString() : '--';
        const name = escapeHtml([s.firstName, s.lastName].filter(Boolean).join(' ') || '--');
        const status = s.unsubscribed
            ? '<span style="background:var(--red-light);color:var(--red);padding:2px 8px;border-radius:4px;font-size:12px;">Unsubscribed</span>'
            : '<span style="background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:4px;font-size:12px;">Active</span>';
        html += `<tr>
            <td style="color:var(--gray-400);font-size:12px;">${i + 1}</td>
            <td>${name}</td>
            <td>${escapeHtml(s.email || '--')}</td>
            <td>${status}</td>
            <td>${date}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ==================== ADD SUBSCRIBER MANUALLY ====================
async function addSubscriberManual() {
    const firstName = document.getElementById('addSubFirstName').value.trim();
    const lastName = document.getElementById('addSubLastName').value.trim();
    const email = document.getElementById('addSubEmail').value.trim();
    const msgEl = document.getElementById('addSubMessage');

    if (!firstName || !email) {
        msgEl.textContent = 'First name and email are required.';
        msgEl.style.color = '#dc2626';
        return;
    }

    try {
        const data = await apiFetch('/api/subscribe', {
            method: 'POST',
            body: JSON.stringify({ firstName, lastName, email })
        });
        msgEl.textContent = data.message || 'Subscriber added!';
        msgEl.style.color = '#16a34a';
        document.getElementById('addSubFirstName').value = '';
        document.getElementById('addSubLastName').value = '';
        document.getElementById('addSubEmail').value = '';
        loadSubscribers();
        loadDashboardStats();
    } catch (e) {
        msgEl.textContent = 'Failed to add subscriber.';
        msgEl.style.color = '#dc2626';
    }
}

async function deleteSubscriber(email) {
    openModal(
        'Delete Subscriber',
        `Are you sure you want to permanently remove <strong>${escapeHtml(email)}</strong>? This cannot be undone.`,
        'Delete',
        'btn-danger',
        async () => {
            try {
                await apiFetch('/api/subscribers', {
                    method: 'DELETE',
                    body: JSON.stringify({ email })
                });
                showToast('Subscriber removed.', 'success');
                loadSubscribers();
                loadDashboardStats();
            } catch (e) {
                showToast('Failed to remove subscriber.', 'error');
            }
        }
    );
}

// ==================== TO-DO LIST ====================
// Module-level cache so the dashboard's venture filter chip row (and any other
// cross-widget filter) can re-render todos without re-fetching.
let _todosCache = [];

async function loadTodos() {
    try {
        const data = await apiFetch('/api/todos');
        _todosCache = data.todos || [];
        renderTodoList(_todosCache);
    } catch (e) {
        document.getElementById('todoList').innerHTML =
            '<div class="empty-state"><p>Could not load todos.</p></div>';
    }
}

function _todoPriorityMeta(p) {
    // 0 = none, 1 = low, 2 = med, 3 = high
    if (p >= 3) return { label: 'High', color: '#ef4444', symbol: '!!!' };
    if (p === 2) return { label: 'Med',  color: '#f59e0b', symbol: '!!' };
    if (p === 1) return { label: 'Low',  color: '#3b82f6', symbol: '!' };
    return null;
}

function _todoVentureMeta(t) {
    if (!t.ventureId || typeof intVentures === 'undefined') return null;
    return intVentures.find(v => v.id === t.ventureId) || null;
}

function _todoGoalMeta(t) {
    if (!t.goalId || typeof intGoals === 'undefined') return null;
    return intGoals.find(g => g.id === t.goalId) || null;
}

function _todoSort(arr) {
    return [...arr].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        // Higher priority first (3 → 0).
        const pa = a.priority || 0, pb = b.priority || 0;
        if (pa !== pb) return pb - pa;
        // Earlier due date first; blanks sort last.
        const da = a.dueDate || '9999-12-31';
        const db = b.dueDate || '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function renderTodoList(todos) {
    const container = document.getElementById('todoList');
    if (!todos || todos.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9745;</div><p>No tasks yet. Add one above!</p></div>';
        return;
    }
    // Honor the dashboard venture filter (shared with the Intention tab via intActiveVentureId).
    const activeVen = (typeof intActiveVentureId !== 'undefined') ? intActiveVentureId : '';
    const scoped = activeVen
        ? todos.filter(t => t.ventureId === activeVen)
        : todos;
    if (scoped.length === 0) {
        container.innerHTML = '<div class="empty-state"><p style="color:var(--gray-400);">No tasks for this venture yet.</p></div>';
        return;
    }
    const sorted = _todoSort(scoped);
    container.innerHTML = sorted.map(t => renderTodoRow(t)).join('');
}

function renderTodoRow(t) {
    const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '';
    const prio = _todoPriorityMeta(t.priority || 0);
    const ven = _todoVentureMeta(t);
    const goal = _todoGoalMeta(t);

    // Inline chips that only render when the field is set. Keeps the row compact for plain todos.
    const chips = [];
    if (prio) {
        chips.push(`<span title="${prio.label} priority" style="background:${prio.color}22;color:${prio.color};border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;letter-spacing:0.04em;">${prio.symbol}</span>`);
    }
    if (ven) {
        chips.push(`<span title="${escapeHtml(ven.name)}" style="background:${escapeHtml(ven.color || '#3b82f6')}22;color:${escapeHtml(ven.color || '#3b82f6')};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">${ven.icon ? escapeHtml(ven.icon) + ' ' : ''}${escapeHtml(ven.name)}</span>`);
    }
    if (goal) {
        chips.push(`<span title="rolls up to ${goal.horizon} goal: ${escapeHtml(goal.title)}" style="background:#f3f4f6;color:var(--gray-600);border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">→ ${escapeHtml(goal.title)}</span>`);
    }
    if (t.dueDate) {
        const overdue = !t.completed && t.dueDate < new Date().toISOString().slice(0, 10);
        chips.push(`<span style="color:${overdue ? '#ef4444' : 'var(--gray-500)'};font-size:11px;font-weight:${overdue ? '600' : '500'};">due ${escapeHtml(t.dueDate)}</span>`);
    }

    return `<div class="todo-item" id="todo-row-${t.id}">
        <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTodo('${t.id}', this.checked)">
        <span class="todo-text ${t.completed ? 'completed' : ''}" ondblclick="editTodoInline(this, '${t.id}')">${escapeHtml(t.text)}</span>
        ${chips.length ? `<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:8px;">${chips.join('')}</span>` : ''}
        <span class="todo-date">${date}</span>
        <div class="todo-actions">
            <button title="Edit" onclick="openTodoModal('${t.id}')">&#9776;</button>
            <button title="Delete" onclick="deleteTodo('${t.id}')">&#128465;</button>
        </div>
    </div>`;
}

// ──────────────── todo edit modal ────────────────
// v4.6.11: replaces the inline `.todo-details` panel that used to expand under
// each row. Centralizes editing in one overlay and adds the Promote-to-Goal
// surface — turn a to-do into a daily/weekly/quarterly/yearly Intention goal
// in one click.

let _todoModalId = null;

function openTodoModal(id) {
    const t = _todosCache.find(x => x.id === id);
    if (!t) return;
    _todoModalId = id;
    document.getElementById('tmEditId').value = id;
    document.getElementById('tmEditText').value = t.text || '';
    document.getElementById('tmEditPrio').value = String(t.priority || 0);
    document.getElementById('tmEditDue').value = t.dueDate || '';
    document.getElementById('tmEditVenture').innerHTML = buildVentureOptions(t.ventureId || '');
    document.getElementById('tmEditGoal').innerHTML = buildGoalOptions(t.ventureId || '', t.goalId || '');
    document.getElementById('todoEditModal').style.display = 'flex';
}

function closeTodoModal() {
    document.getElementById('todoEditModal').style.display = 'none';
    _todoModalId = null;
}

// Mirror of tfRebuildGoalOptions for the modal's single set of selectors.
function tmRebuildGoalOptions() {
    const venEl = document.getElementById('tmEditVenture');
    const goalEl = document.getElementById('tmEditGoal');
    if (!venEl || !goalEl) return;
    const all = (typeof intGoals !== 'undefined' && intGoals) ? intGoals : [];
    const current = goalEl.value;
    const stillValid = all.some(g => g.id === current && g.ventureId === venEl.value);
    goalEl.innerHTML = buildGoalOptions(venEl.value, stillValid ? current : '');
}

async function saveTodoModal() {
    const id = _todoModalId;
    if (!id) return;
    const cached = _todosCache.find(x => x.id === id);
    if (!cached) return;
    const text = document.getElementById('tmEditText').value.trim() || cached.text;
    const payload = {
        id,
        text,
        completed: !!cached.completed,
        priority: parseInt(document.getElementById('tmEditPrio').value) || 0,
        dueDate: document.getElementById('tmEditDue').value || '',
        ventureId: document.getElementById('tmEditVenture').value || '',
        goalId: document.getElementById('tmEditGoal').value || '',
    };
    try {
        await apiFetch('/api/todos', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Task updated.', 'success');
        closeTodoModal();
        await loadTodos();
    } catch (e) {
        showToast('Failed to save task.', 'error');
    }
}

function deleteTodoFromModal() {
    const id = _todoModalId;
    if (!id) return;
    // closeTodoModal() first so the confirm dialog is the only modal on screen —
    // belt-and-suspenders to the universal #confirmModal z-index fix in 4.6.11.
    closeTodoModal();
    deleteTodo(id);
}

// Promote a to-do into an Intention goal at the chosen horizon. The to-do
// stays on the list and gets `goalId` linked to the freshly-created goal, so
// the chip "→ Goal title" shows up under the row.
async function promoteTodoToGoal(horizon) {
    const id = _todoModalId;
    if (!id) return;
    const cached = _todosCache.find(x => x.id === id);
    if (!cached) return;
    const text = document.getElementById('tmEditText').value.trim() || cached.text;
    if (!text) { showToast('Task text is required.', 'error'); return; }
    const validHorizons = ['daily', 'weekly', 'quarterly', 'yearly'];
    if (!validHorizons.includes(horizon)) return;

    const ventureId = document.getElementById('tmEditVenture').value || '';
    const priority = parseInt(document.getElementById('tmEditPrio').value) || 0;
    const dueDate = document.getElementById('tmEditDue').value || '';

    const goalBody = {
        action: 'save-goal',
        horizon,
        title: text,
        ventureIds: ventureId ? [ventureId] : [],
        priority,
        targetDate: dueDate,
        status: 'todo',
    };

    try {
        const res = await apiFetch('/api/intention', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(goalBody),
        });
        const newGoalId = res?.id;
        if (!newGoalId) throw new Error('Goal creation returned no id');

        // Link the to-do to the new goal so the row's "→ Goal title" chip shows.
        await apiFetch('/api/todos', {
            method: 'POST',
            body: JSON.stringify({
                id,
                text: cached.text,
                completed: !!cached.completed,
                priority: cached.priority || 0,
                dueDate: cached.dueDate || '',
                ventureId,
                goalId: newGoalId,
            }),
        });

        // Refresh both Intention (so the new goal appears in the dropdown) and
        // todos (so the link chip renders). loadIntention() is provided by
        // guru-intention.js.
        if (typeof loadIntention === 'function') await loadIntention();
        await loadTodos();
        closeTodoModal();
        const horizonLabel = horizon.charAt(0).toUpperCase() + horizon.slice(1);
        showToast(`Promoted to ${horizonLabel} goal.`, 'success');
    } catch (e) {
        showToast('Could not promote to goal.', 'error');
    }
}

async function addTodo() {
    const input = document.getElementById('todoInput');
    const text = input.value.trim();
    if (!text) return;

    try {
        await apiFetch('/api/todos', {
            method: 'POST',
            body: JSON.stringify({ text, completed: false })
        });
        input.value = '';
        loadTodos();
    } catch (e) {
        // Error shown
    }
}

async function toggleTodo(id, completed) {
    // text is required by /api/todos save; pull it from cache so the row's render
    // doesn't need to embed the (possibly long, possibly quote-laden) text in onclick.
    const cached = _todosCache.find(t => t.id === id);
    const text = cached ? cached.text : '';
    try {
        // Omitting ventureId/goalId/priority/dueDate preserves existing values
        // (todos.js honors partial updates).
        await apiFetch('/api/todos', {
            method: 'POST',
            body: JSON.stringify({ id, text, completed })
        });
        loadTodos();
    } catch (e) {
        // Error shown
    }
}

function editTodoInline(el, id) {
    const currentText = el.textContent;
    el.contentEditable = true;
    el.classList.add('editing');
    el.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function save() {
        el.contentEditable = false;
        el.classList.remove('editing');
        const newText = el.textContent.trim();
        if (newText && newText !== currentText) {
            apiFetch('/api/todos', {
                method: 'POST',
                body: JSON.stringify({ id, text: newText, completed: el.classList.contains('completed') })
            }).then(() => loadTodos()).catch(() => {});
        } else {
            el.textContent = currentText;
        }
    }

    el.onblur = save;
    el.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { el.textContent = currentText; el.contentEditable = false; el.classList.remove('editing'); }
    };
}

async function deleteTodo(id) {
    try {
        await apiFetch('/api/todos', {
            method: 'DELETE',
            body: JSON.stringify({ id })
        });
        showToast('Task removed.', 'success');
        loadTodos();
    } catch (e) {
        // Error shown
    }
}

// ==================== FOCUS BANNER ====================
// Consolidated settings loader — fetches /api/settings once for focus banner and reading goal
async function loadDashboardSettings() {
    try {
        const data = await apiFetch('/api/settings');
        // Focus banner
        const focusText = data.focusBanner || '';
        document.getElementById('focusBannerText').textContent = focusText || 'Click to set a focus reminder...';
        document.getElementById('focusBannerText').style.opacity = focusText ? '1' : '0.5';
        // Reading goal
        const goalText = data.readingGoal || '';
        document.getElementById('readingGoalText').textContent = goalText || 'Click to set a reading goal...';
        document.getElementById('readingGoalText').style.opacity = goalText ? '1' : '0.6';
    } catch (e) {}
}

async function loadFocusBanner() {
    try {
        const data = await apiFetch('/api/settings');
        const text = data.focusBanner || '';
        document.getElementById('focusBannerText').textContent = text || 'Click to set a focus reminder...';
        document.getElementById('focusBannerText').style.opacity = text ? '1' : '0.5';
    } catch (e) {}
}

function editFocusBanner() {
    const current = document.getElementById('focusBannerText').textContent;
    document.getElementById('focusBannerInput').value = current === 'Click to set a focus reminder...' ? '' : current;
    document.getElementById('focusBanner').style.display = 'none';
    document.getElementById('focusBannerEditor').style.display = 'block';
    document.getElementById('focusBannerInput').focus();
}

async function saveFocusBanner() {
    const text = document.getElementById('focusBannerInput').value.trim();
    document.getElementById('focusBannerText').textContent = text || 'Click to set a focus reminder...';
    document.getElementById('focusBannerText').style.opacity = text ? '1' : '0.5';
    document.getElementById('focusBanner').style.display = '';
    document.getElementById('focusBannerEditor').style.display = 'none';
    try {
        await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify({ focusBanner: text }) });
    } catch (e) { showToast('Failed to save banner', 'error'); }
}

function cancelFocusBanner() {
    document.getElementById('focusBanner').style.display = '';
    document.getElementById('focusBannerEditor').style.display = 'none';
}

document.getElementById('focusBannerInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveFocusBanner(); }
    if (e.key === 'Escape') cancelFocusBanner();
});

// ==================== READING GOAL ====================
async function loadReadingGoal() {
    try {
        const data = await apiFetch('/api/settings');
        const text = data.readingGoal || '';
        document.getElementById('readingGoalText').textContent = text || 'Click to set a reading goal...';
        document.getElementById('readingGoalText').style.opacity = text ? '1' : '0.6';
    } catch (e) {}
}

function editReadingGoal() {
    const current = document.getElementById('readingGoalText').textContent;
    document.getElementById('readingGoalInput').value = current === 'Click to set a reading goal...' ? '' : current;
    document.getElementById('booksReadingGoal').style.display = 'none';
    document.getElementById('readingGoalEditor').style.display = 'block';
    document.getElementById('readingGoalInput').focus();
}

async function saveReadingGoal() {
    const text = document.getElementById('readingGoalInput').value.trim();
    document.getElementById('readingGoalText').textContent = text || 'Click to set a reading goal...';
    document.getElementById('readingGoalText').style.opacity = text ? '1' : '0.6';
    document.getElementById('booksReadingGoal').style.display = '';
    document.getElementById('readingGoalEditor').style.display = 'none';
    try {
        await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify({ readingGoal: text }) });
    } catch (e) { showToast('Failed to save goal', 'error'); }
}

function cancelReadingGoal() {
    document.getElementById('booksReadingGoal').style.display = '';
    document.getElementById('readingGoalEditor').style.display = 'none';
}

document.getElementById('readingGoalInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveReadingGoal(); }
    if (e.key === 'Escape') cancelReadingGoal();
});
