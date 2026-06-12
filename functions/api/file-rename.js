/**
 * Cloudflare Pages Function — /api/file-rename
 *
 * POST { oldKey, newName } → copies R2 object to new key, deletes old
 *
 * Environment bindings required:
 *   - BLOG_IMAGES (R2 bucket — jarin-blog-images)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

function sanitizeName(name) {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = name.slice(lastDot).toLowerCase();
  const base = name.slice(0, lastDot)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!base) return null;
  return base + ext;
}

export async function onRequestPost(context) {
  try {
    const { oldKey, newName } = await context.request.json();

    if (!oldKey || !oldKey.startsWith('files/')) {
      return errorResponse("Invalid key.", 400);
    }

    if (!newName || typeof newName !== 'string') {
      return errorResponse("Missing new name.", 400);
    }

    const sanitized = sanitizeName(newName);
    if (!sanitized) {
      return errorResponse("Invalid new filename.", 400);
    }

    const newKey = `files/${sanitized}`;

    if (newKey === oldKey) {
      return jsonResponse({ ok: true, key: newKey });
    }

    // Copy: get old object, put with new key
    const obj = await context.env.BLOG_IMAGES.get(oldKey);
    if (!obj) {
      return errorResponse("File not found.", 404);
    }

    await context.env.BLOG_IMAGES.put(newKey, obj.body, {
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata,
    });

    // Delete old
    await context.env.BLOG_IMAGES.delete(oldKey);

    return jsonResponse({ ok: true, key: newKey, name: sanitized });
  } catch (err) {
    return errorResponse("Rename failed: " + (err.message || "unknown"), 500);
  }
}
