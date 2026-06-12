/* ==========================================================================
   Guru Dashboard — Blog Comments Moderation
   ========================================================================== */

async function loadComments() {
    const status = document.getElementById('commentStatusFilter').value;
    const container = document.getElementById('commentsList');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);">Loading comments...</div>';

    try {
        const params = ['admin=1'];
        if (status) params.push('status=' + encodeURIComponent(status));
        const data = await apiFetch('/api/blog-comments?' + params.join('&'));
        const comments = data.comments || [];
        const pendingCount = data.pending_count || 0;

        // Update pending badge
        const badge = document.getElementById('commentPendingBadge');
        if (pendingCount > 0) {
            badge.textContent = pendingCount + ' pending';
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }

        if (!comments.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--gray-400);">' +
                '<div style="font-size:32px;margin-bottom:8px;">&#128172;</div>' +
                '<p>No ' + (status || '') + ' comments</p></div>';
            return;
        }

        container.innerHTML = comments.map(renderCommentCard).join('');
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">Failed to load comments.</div>';
    }
}

function renderCommentCard(c) {
    const avatar = 'https://www.gravatar.com/avatar/' + escapeHtml(c.email_hash || '') + '?s=64&d=mp';
    const statusColors = { pending: 'var(--yellow)', approved: 'var(--green)', rejected: '#ef4444' };
    const statusColor = statusColors[c.status] || 'var(--gray-400)';
    const bodyPreview = (c.body || '').length > 200 ? escapeHtml(c.body.substring(0, 200)) + '...' : escapeHtml(c.body || '');
    const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const parentLabel = c.parent_id ? '<span style="font-size:11px;background:var(--gray-100);padding:2px 8px;border-radius:4px;color:var(--gray-500);">Reply</span>' : '';

    let actions = '';
    if (c.status !== 'approved') {
        actions += '<button class="btn btn-sm" style="background:var(--green);color:white;border:none;" onclick="approveComment(\'' + c.id + '\')">Approve</button> ';
    }
    if (c.status !== 'rejected') {
        actions += '<button class="btn btn-sm" style="background:var(--yellow);color:white;border:none;" onclick="rejectComment(\'' + c.id + '\')">Reject</button> ';
    }
    actions += '<button class="btn btn-sm" style="background:#ef4444;color:white;border:none;" onclick="deleteComment(\'' + c.id + '\')">Delete</button>';

    return '<div style="display:flex;gap:12px;padding:16px;border-bottom:1px solid var(--gray-100);align-items:flex-start;">' +
        '<img src="' + avatar + '" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;" alt="">' +
        '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
                '<strong style="font-size:14px;">' + escapeHtml(c.author_name || '') + '</strong>' +
                '<span style="font-size:12px;color:var(--gray-400);">' + escapeHtml(c.author_email || '') + '</span>' +
                parentLabel +
                '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';" title="' + escapeHtml(c.status || '') + '"></span>' +
                '<span style="font-size:11px;color:var(--gray-400);">' + escapeHtml(c.status || '') + '</span>' +
            '</div>' +
            '<div style="margin-bottom:6px;">' +
                '<a href="/blog/' + escapeHtml(c.slug || '') + '/" target="_blank" style="font-size:12px;color:var(--primary);text-decoration:none;">' + escapeHtml(c.slug || '') + '</a>' +
            '</div>' +
            '<div style="font-size:13px;color:var(--gray-600);margin-bottom:8px;white-space:pre-wrap;word-break:break-word;">' + bodyPreview + '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                actions +
                '<span style="margin-left:auto;font-size:11px;color:var(--gray-400);">' + date + '</span>' +
                (c.ip_address ? '<span style="font-size:11px;color:var(--gray-300);">IP: ' + escapeHtml(c.ip_address) + '</span>' : '') +
            '</div>' +
        '</div>' +
    '</div>';
}

async function approveComment(id) {
    try {
        await apiFetch('/api/blog-comments', {
            method: 'PUT',
            body: JSON.stringify({ id: id, status: 'approved' })
        });
        showToast('Comment approved', 'success');
        loadComments();
    } catch (e) {
        showToast('Failed to approve comment', 'error');
    }
}

async function rejectComment(id) {
    try {
        await apiFetch('/api/blog-comments', {
            method: 'PUT',
            body: JSON.stringify({ id: id, status: 'rejected' })
        });
        showToast('Comment rejected', 'success');
        loadComments();
    } catch (e) {
        showToast('Failed to reject comment', 'error');
    }
}

function deleteComment(id) {
    openModal('Delete Comment', 'Delete this comment and all its replies? This cannot be undone.', 'Delete', 'btn-danger', async () => {
        try {
            await apiFetch('/api/blog-comments', {
                method: 'DELETE',
                body: JSON.stringify({ id: id })
            });
            showToast('Comment deleted', 'success');
            loadComments();
        } catch (e) {
            showToast('Failed to delete comment', 'error');
        }
    });
}
