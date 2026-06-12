/**
 * Cloudflare Pages Function — /api/blog-drafts
 *
 * GET    → list all blog drafts
 * POST   → save/update a draft by slug
 * DELETE → delete a draft by slug
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM blog_drafts ORDER BY updatedAt DESC"
    ).all();

    const drafts = results.map(row => ({
      ...row,
      scheduledAt: row.scheduledAt || null,
    }));

    return jsonResponse({ drafts });
  } catch (err) {
    return errorResponse("Failed to load drafts.");
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { draft } = body;

    if (!draft || !draft.slug || !draft.title || !draft.body) {
      return errorResponse("Draft must include slug, title, and body.", 400);
    }

    const data = {
      slug: draft.slug,
      title: draft.title,
      date: draft.date || new Date().toISOString().slice(0, 10),
      author: draft.author || "Jarin",
      excerpt: draft.excerpt || "",
      image: draft.image || "",
      body: draft.body,
      scheduledAt: draft.scheduledAt || null,
      updatedAt: new Date().toISOString(),
    };

    await context.env.SITE_DB.prepare(
      "INSERT OR REPLACE INTO blog_drafts (slug, title, date, author, excerpt, image, body, scheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      data.slug, data.title, data.date, data.author, data.excerpt,
      data.image, data.body, data.scheduledAt, data.updatedAt
    ).run();

    return jsonResponse({ ok: true, draft: data });
  } catch (err) {
    return errorResponse("Failed to save draft.");
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { slug } = body;

    if (!slug) {
      return errorResponse("Must include slug.", 400);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM blog_drafts WHERE slug = ?"
    ).bind(slug).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete draft.");
  }
}
