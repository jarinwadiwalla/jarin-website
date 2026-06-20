/**
 * Cloudflare Pages Function — /api/foods
 *
 * GET    → list all foods
 * POST   → create or update
 * DELETE → delete by id
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM foods ORDER BY name COLLATE NOCASE ASC"
    ).all();
    return jsonResponse({ foods: results });
  } catch (err) {
    return errorResponse("Failed to load foods.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();
    const { id, name, calories, sugar, carbs, protein } = body;

    if (!name || !name.trim()) {
      return errorResponse("Food name is required.", 400);
    }

    const entryId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
    const existing = await context.env.SITE_DB.prepare(
      "SELECT createdAt FROM foods WHERE id = ?"
    ).bind(entryId).first();

    const data = {
      id: entryId,
      name: name.trim(),
      calories: parseFloat(calories) || 0,
      sugar:    parseFloat(sugar)    || 0,
      carbs:    parseFloat(carbs)    || 0,
      protein:  parseFloat(protein)  || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO foods (id, name, calories, sugar, carbs, protein, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(data.id, data.name, data.calories, data.sugar, data.carbs, data.protein, data.createdAt, data.updatedAt).run();

    return jsonResponse({ ok: true, food: data });
  } catch (err) {
    return errorResponse("Failed to save food.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;
    if (!id) return errorResponse("Must include id.", 400);
    await context.env.SITE_DB.prepare("DELETE FROM foods WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete food.", 500);
  }
}
