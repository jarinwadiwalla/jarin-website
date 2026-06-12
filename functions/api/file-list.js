/**
 * Cloudflare Pages Function — /api/file-list
 *
 * GET → lists all objects under files/ prefix in R2
 *
 * Environment bindings required:
 *   - BLOG_IMAGES (R2 bucket — jarin-blog-images)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const listed = await context.env.BLOG_IMAGES.list({ prefix: "files/", limit: 500 });

    const files = listed.objects.map((obj) => ({
      name: obj.key.replace("files/", ""),
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
      url: `/api/blog-image/${obj.key}`,
    }));

    files.sort((a, b) => b.uploaded.localeCompare(a.uploaded));

    return jsonResponse({ files });
  } catch (err) {
    return errorResponse("Failed to list files.", 500);
  }
}
