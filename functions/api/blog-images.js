/**
 * Cloudflare Pages Function — /api/blog-images
 *
 * POST   → upload image to R2 (multipart/form-data with "file" and optional "folder")
 * GET    → list images (optional ?folder=xxx)
 * DELETE → delete image by key
 *
 * Environment bindings required:
 *   - BLOG_IMAGES (R2 bucket)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const ALLOWED_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder") || "general";

    if (!file || !file.name) {
      return errorResponse("No file provided.", 400);
    }

    if (!ALLOWED_TYPES[file.type]) {
      return errorResponse("Unsupported file type. Use JPEG, PNG, WebP, GIF, or SVG.", 400);
    }

    // Sanitize filename
    const ext = ALLOWED_TYPES[file.type];
    const baseName = file.name
      .replace(/\.[^.]+$/, "") // remove extension
      .replace(/[^a-zA-Z0-9_-]/g, "-") // sanitize
      .replace(/-+/g, "-") // collapse dashes
      .toLowerCase();
    const sanitizedFolder = folder.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const key = `blog-images/${sanitizedFolder}/${baseName}${ext}`;

    const arrayBuffer = await file.arrayBuffer();

    await context.env.BLOG_IMAGES.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        size: String(arrayBuffer.byteLength),
      },
    });

    const url = `/api/blog-image/${key}`;

    return jsonResponse({ ok: true, key, url, size: arrayBuffer.byteLength });
  } catch (err) {
    return errorResponse("Upload failed.");
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const folder = url.searchParams.get("folder");
    const prefix = folder
      ? `blog-images/${folder.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}/`
      : "blog-images/";

    const listed = await context.env.BLOG_IMAGES.list({ prefix, limit: 500 });

    const images = listed.objects.map((obj) => ({
      key: obj.key,
      url: `/api/blog-image/${obj.key}`,
      size: obj.size,
      uploaded: obj.uploaded,
      contentType: obj.httpMetadata?.contentType || "image/jpeg",
    }));

    return jsonResponse({ images });
  } catch (err) {
    return errorResponse("Failed to list images.");
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { key } = body;

    if (!key) {
      return errorResponse("Key is required.", 400);
    }

    await context.env.BLOG_IMAGES.delete(key);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete image.");
  }
}
