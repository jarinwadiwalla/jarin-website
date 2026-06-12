/**
 * Cloudflare Pages Function — /api/steps
 *
 * Daily step count storage. Accepts data from Garmin sync or manual entry.
 *
 * GET    → list step records (last 90 days by default)
 * POST   → upsert step count for a date
 * DELETE → delete step record by date
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM daily_steps ORDER BY date DESC LIMIT 365"
    ).all();
    return jsonResponse({ steps: results });
  } catch (err) {
    return errorResponse("Failed to load steps.");
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();
    const date = body.date || now.split("T")[0];
    const steps = parseInt(body.steps) || 0;
    const goal = parseInt(body.goal) || 8000;
    const distance = parseFloat(body.distance) || 0;
    const source = body.source || 'manual';

    if (steps < 0) return errorResponse("Steps must be positive.", 400);

    await context.env.SITE_DB.prepare(
      `INSERT INTO daily_steps (date, steps, goal, distance, source, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET steps=?, goal=?, distance=?, source=?, updatedAt=?`
    ).bind(date, steps, goal, distance, source, now, steps, goal, distance, source, now).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to save steps.");
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    if (!body.date) return errorResponse("date is required.", 400);
    await context.env.SITE_DB.prepare(
      "DELETE FROM daily_steps WHERE date = ?"
    ).bind(body.date).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete steps.");
  }
}
