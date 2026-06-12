/**
 * Cloudflare Pages Function — /api/file-delete
 *
 * POST { key } → deletes file from R2
 *
 * Environment bindings required:
 *   - BLOG_IMAGES (R2 bucket — jarin-blog-images)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestPost(context) {
  try {
    const { key } = await context.request.json();

    if (!key || !key.startsWith('files/')) {
      return errorResponse("Invalid key.", 400);
    }

    await context.env.BLOG_IMAGES.delete(key);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Delete failed.", 500);
  }
}
