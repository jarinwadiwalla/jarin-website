/**
 * Cloudflare Pages Function — /api/audio-order
 *
 * GET  → get track order for a playlist (?playlist=xxx)
 * PUT  → save track order for a playlist
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

async function ensureTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS audio_order (
      playlist TEXT PRIMARY KEY,
      track_order TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`
  ).run();
}

export async function onRequestGet(context) {
  try {
    const db = context.env.SITE_DB;
    await ensureTable(db);

    const url = new URL(context.request.url);
    const playlist = url.searchParams.get("playlist");

    if (!playlist) {
      return errorResponse("playlist parameter is required.", 400);
    }

    const row = await db.prepare(
      "SELECT track_order FROM audio_order WHERE playlist = ?"
    ).bind(playlist).first();

    const order = row ? JSON.parse(row.track_order) : [];

    return jsonResponse({ playlist, order });
  } catch (err) {
    return errorResponse("Failed to get order.");
  }
}

export async function onRequestPut(context) {
  try {
    const db = context.env.SITE_DB;
    await ensureTable(db);

    const body = await context.request.json();
    const { playlist, order } = body;

    if (!playlist || !Array.isArray(order)) {
      return errorResponse("playlist and order (array) are required.", 400);
    }

    await db.prepare(
      `INSERT INTO audio_order (playlist, track_order, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(playlist) DO UPDATE SET track_order = excluded.track_order, updatedAt = excluded.updatedAt`
    ).bind(playlist, JSON.stringify(order), new Date().toISOString()).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to save order.");
  }
}
