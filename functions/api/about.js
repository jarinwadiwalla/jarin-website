/**
 * Cloudflare Pages Function — /api/about
 *
 * GET  → get about page content
 * POST → save about page content
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const row = await context.env.SITE_DB.prepare(
      "SELECT * FROM about WHERE id = 'main'"
    ).first();

    return jsonResponse(row || { content: "" });
  } catch (err) {
    return errorResponse("Failed to load about content.");
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { content } = body;

    if (content === undefined) {
      return errorResponse("Content is required.", 400);
    }

    const now = new Date().toISOString();

    await context.env.SITE_DB.prepare(
      "INSERT OR REPLACE INTO about (id, content, updatedAt) VALUES ('main', ?, ?)"
    ).bind(content, now).run();

    return jsonResponse({ ok: true, content, updatedAt: now });
  } catch (err) {
    return errorResponse("Failed to save about content.");
  }
}
