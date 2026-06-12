/**
 * Cloudflare Pages Function — /api/measurements
 *
 * Body measurements CRUD.
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
    "SELECT * FROM body_measurements ORDER BY date DESC"
  ).all();
  return jsonResponse({ measurements: results });
}

export async function onRequestPost(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const now = new Date().toISOString();
  const id = body.id || generateId();

  await env.SITE_DB.prepare(
    `INSERT OR REPLACE INTO body_measurements (id, date, weightKg, bodyFatPct, chest, waist, hips, bicepL, bicepR, thighL, thighR, shoulders, neck, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM body_measurements WHERE id = ?), ?), ?)`
  ).bind(
    id,
    body.date || now.split("T")[0],
    body.weightKg || 0,
    body.bodyFatPct || 0,
    body.chest || 0,
    body.waist || 0,
    body.hips || 0,
    body.bicepL || 0,
    body.bicepR || 0,
    body.thighL || 0,
    body.thighR || 0,
    body.shoulders || 0,
    body.neck || 0,
    body.notes || "",
    id, now, now
  ).run();

  return jsonResponse({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (!body.id) return errorResponse("id is required", 400);

  await env.SITE_DB.prepare("DELETE FROM body_measurements WHERE id = ?").bind(body.id).run();
  return jsonResponse({ ok: true });
}
