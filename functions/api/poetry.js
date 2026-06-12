/**
 * Cloudflare Pages Function — /api/poetry
 *
 * GET    → list all poems; ?published=true → only published
 * POST   → create/update a poem
 * DELETE → delete a poem by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const publishedOnly = url.searchParams.get("published") === "true";

    let results;
    if (publishedOnly) {
      const now = new Date().toISOString();
      ({ results } = await context.env.SITE_DB.prepare(
        "SELECT * FROM poems WHERE published = 1 AND (scheduledAt IS NULL OR scheduledAt = '' OR scheduledAt <= ?) ORDER BY sortOrder ASC, createdAt DESC"
      ).bind(now).all());
    } else {
      ({ results } = await context.env.SITE_DB.prepare(
        "SELECT * FROM poems ORDER BY sortOrder ASC, createdAt DESC"
      ).all());
    }

    const poems = results.map(row => ({
      id: row.id,
      title: row.title,
      body: row.body,
      published: !!row.published,
      order: row.sortOrder,
      scheduledAt: row.scheduledAt || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return jsonResponse({ poems });
  } catch (err) {
    return errorResponse("Failed to load poems.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { id, title, body: poemBody, published, order, scheduledAt } = body;

    if (!title || !title.trim()) {
      return errorResponse("Title is required.", 400);
    }

    const poemId = id || title.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
    const now = new Date().toISOString();

    const existing = await context.env.SITE_DB.prepare(
      "SELECT * FROM poems WHERE id = ?"
    ).bind(poemId).first();

    const data = {
      id: poemId,
      title: title.trim(),
      body: (poemBody || "").trim(),
      published: published !== undefined ? !!published : existing ? !!existing.published : false,
      order: order !== undefined ? order : existing ? existing.sortOrder : 0,
      scheduledAt: scheduledAt !== undefined ? (scheduledAt || null) : existing ? existing.scheduledAt || null : null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await context.env.SITE_DB.prepare(
      "INSERT OR REPLACE INTO poems (id, title, body, published, sortOrder, scheduledAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      data.id, data.title, data.body, data.published ? 1 : 0,
      data.order, data.scheduledAt, data.createdAt, data.updatedAt
    ).run();

    return jsonResponse({ ok: true, poem: data });
  } catch (err) {
    return errorResponse("Failed to save poem.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return errorResponse("Must include id.", 400);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM poems WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete poem.", 500);
  }
}
