/**
 * Cloudflare Pages Function — /api/meals
 *
 * GET    → list meal entries (optional ?date=YYYY-MM-DD filter; otherwise all)
 * POST   → create or update
 * DELETE → delete by id
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const dateFilter = url.searchParams.get('date');
    let query, binds;
    if (dateFilter) {
      query = "SELECT * FROM meal_entries WHERE date = ? ORDER BY time ASC, createdAt ASC";
      binds = [dateFilter];
    } else {
      query = "SELECT * FROM meal_entries ORDER BY date DESC, time ASC, createdAt ASC";
      binds = [];
    }
    const stmt = context.env.SITE_DB.prepare(query);
    const { results } = await (binds.length ? stmt.bind(...binds).all() : stmt.all());
    return jsonResponse({ entries: results });
  } catch (err) {
    return errorResponse("Failed to load meal entries.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();
    const { id, date, time, mealType, foodId, foodName, grams,
            calories, sugar, carbs, protein, mood, notes } = body;

    if (!date || !date.trim()) {
      return errorResponse("Date is required.", 400);
    }
    if (!foodName || !foodName.trim()) {
      return errorResponse("Food is required.", 400);
    }

    const entryId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
    const existing = await context.env.SITE_DB.prepare(
      "SELECT createdAt FROM meal_entries WHERE id = ?"
    ).bind(entryId).first();

    const data = {
      id: entryId,
      date: date.trim(),
      time: (time || '').trim(),
      mealType: (mealType || '').trim(),
      foodId: (foodId || '').trim(),
      foodName: foodName.trim(),
      grams:    parseFloat(grams)    || 0,
      calories: parseFloat(calories) || 0,
      sugar:    parseFloat(sugar)    || 0,
      carbs:    parseFloat(carbs)    || 0,
      protein:  parseFloat(protein)  || 0,
      mood: (mood || '').trim(),
      notes: (notes || '').trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO meal_entries
       (id, date, time, mealType, foodId, foodName, grams, calories, sugar, carbs, protein, mood, notes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.date, data.time, data.mealType, data.foodId, data.foodName,
      data.grams, data.calories, data.sugar, data.carbs, data.protein,
      data.mood, data.notes, data.createdAt, data.updatedAt
    ).run();

    return jsonResponse({ ok: true, entry: data });
  } catch (err) {
    return errorResponse("Failed to save meal entry.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;
    if (!id) return errorResponse("Must include id.", 400);
    await context.env.SITE_DB.prepare("DELETE FROM meal_entries WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete meal entry.", 500);
  }
}
