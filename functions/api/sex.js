/**
 * Cloudflare Pages Function — /api/sex
 *
 * Sex/intimacy log CRUD. One row per encounter.
 * Tracks self + partner orgasm counts and optional notes.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from "../lib/response.js";

function generateId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
}

// Self-healing migration — runs once per request and is a no-op after the
// first invocation against a given D1, so we don't depend on a manual
// wrangler d1 execute for first-time deploys.
async function ensureSexTable(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS sex_log (id TEXT PRIMARY KEY, date TEXT NOT NULL, selfOrgasms INTEGER DEFAULT 0, partnerOrgasms INTEGER DEFAULT 0, notes TEXT DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);"
  );
  await db.exec("CREATE INDEX IF NOT EXISTS idx_sex_log_date ON sex_log(date);");
}

function clampCount(v) {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 0) return 0;
  if (n > 99) return 99;
  return n;
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSexTable(env.SITE_DB);
  const { results } = await env.SITE_DB.prepare(
    "SELECT * FROM sex_log ORDER BY date DESC, createdAt DESC"
  ).all();

  // Stats
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStr = weekStart.toISOString().split("T")[0];
  const monthStr = monthStart.toISOString().split("T")[0];

  const thisWeek = results.filter((r) => r.date >= weekStr).length;
  const thisMonth = results.filter((r) => r.date >= monthStr).length;

  return jsonResponse({
    entries: results,
    stats: {
      total: results.length,
      thisWeek,
      thisMonth,
      last: results[0]?.date || null,
    },
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  await ensureSexTable(env.SITE_DB);
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const now = new Date().toISOString();
  const date = body.date || now.split("T")[0];
  const selfOrgasms = clampCount(body.selfOrgasms);
  const partnerOrgasms = clampCount(body.partnerOrgasms);
  const notes = (body.notes || "").toString().slice(0, 4000);

  if (body.id) {
    // Update existing entry. Preserve createdAt.
    const existing = await env.SITE_DB.prepare("SELECT createdAt FROM sex_log WHERE id = ?")
      .bind(body.id).first();
    if (!existing) return errorResponse("Entry not found", 404);
    await env.SITE_DB.prepare(
      `UPDATE sex_log SET date = ?, selfOrgasms = ?, partnerOrgasms = ?, notes = ?, updatedAt = ?
       WHERE id = ?`
    ).bind(date, selfOrgasms, partnerOrgasms, notes, now, body.id).run();
    return jsonResponse({ ok: true, id: body.id });
  }

  const id = generateId();
  await env.SITE_DB.prepare(
    `INSERT INTO sex_log (id, date, selfOrgasms, partnerOrgasms, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, date, selfOrgasms, partnerOrgasms, notes, now, now).run();

  return jsonResponse({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { env } = context;
  await ensureSexTable(env.SITE_DB);
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (!body.id) return errorResponse("id is required", 400);
  await env.SITE_DB.prepare("DELETE FROM sex_log WHERE id = ?").bind(body.id).run();
  return jsonResponse({ ok: true });
}
