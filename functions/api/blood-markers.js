/**
 * Cloudflare Pages Function — /api/blood-markers
 *
 * Blood/hormone marker tracking CRUD.
 * Each row stores one marker reading (marker name + value) for a given date.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from "../lib/response.js";

function generateId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
}

export async function onRequestGet(context) {
  const { results } = await context.env.SITE_DB.prepare(
    "SELECT * FROM blood_markers ORDER BY date DESC, marker ASC"
  ).all();
  return jsonResponse({ markers: results });
}

export async function onRequestPost(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const now = new Date().toISOString();
  const date = body.date || now.split("T")[0];
  const notes = body.notes || "";

  // Accept { date, entries: [{ marker, value }] } for batch panel logging
  if (Array.isArray(body.entries)) {
    // Delete existing markers for this date, then insert fresh
    await env.SITE_DB.prepare("DELETE FROM blood_markers WHERE date = ?").bind(date).run();
    for (const entry of body.entries) {
      if (!entry.marker || entry.value === undefined || entry.value === null || entry.value === "") continue;
      const val = parseFloat(entry.value);
      if (isNaN(val)) continue;
      const id = generateId();
      await env.SITE_DB.prepare(
        `INSERT INTO blood_markers (id, date, marker, value, notes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, date, entry.marker, val, notes, now, now).run();
    }
    return jsonResponse({ ok: true });
  }

  return errorResponse("entries array is required", 400);
}

export async function onRequestDelete(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (body.date) {
    await env.SITE_DB.prepare("DELETE FROM blood_markers WHERE date = ?").bind(body.date).run();
    return jsonResponse({ ok: true });
  }
  if (body.id) {
    await env.SITE_DB.prepare("DELETE FROM blood_markers WHERE id = ?").bind(body.id).run();
    return jsonResponse({ ok: true });
  }

  return errorResponse("date or id is required", 400);
}
