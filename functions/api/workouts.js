/**
 * Cloudflare Pages Function — /api/workouts
 *
 * Workout CRUD with JSON exercises blob.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from "../lib/response.js";

function generateId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
}

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const type = url.searchParams.get("type");
  const limit = parseInt(url.searchParams.get("limit")) || 200;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = "SELECT * FROM workouts";
  const conditions = [];
  const binds = [];

  if (type) { conditions.push("type = ?"); binds.push(type); }
  if (from) { conditions.push("date >= ?"); binds.push(from); }
  if (to) { conditions.push("date <= ?"); binds.push(to); }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY date DESC, createdAt DESC LIMIT ?";
  binds.push(limit);

  const { results } = await env.SITE_DB.prepare(query).bind(...binds).all();

  // Parse exercises JSON for each workout
  const workouts = results.map((w) => ({
    ...w,
    exercises: typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises,
  }));

  // Stats
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStr = weekStart.toISOString().split("T")[0];
  const monthStr = monthStart.toISOString().split("T")[0];

  const thisWeek = workouts.filter((w) => w.date >= weekStr).length;
  const thisMonth = workouts.filter((w) => w.date >= monthStr).length;
  const monthVolume = workouts
    .filter((w) => w.date >= monthStr)
    .reduce((sum, w) => sum + (w.totalVolumeKg || 0), 0);

  return jsonResponse({
    workouts,
    stats: {
      total: workouts.length,
      thisWeek,
      thisMonth,
      monthVolume: Math.round(monthVolume),
      lastWorkout: workouts[0]?.date || null,
    },
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const now = new Date().toISOString();
  const id = body.id || generateId();

  const exercises = typeof body.exercises === "string" ? body.exercises : JSON.stringify(body.exercises || []);

  await env.SITE_DB.prepare(
    `INSERT OR REPLACE INTO workouts (id, date, name, type, notes, durationMinutes, bodyweightKg, exercises, totalVolumeKg, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM workouts WHERE id = ?), ?), ?)`
  ).bind(
    id,
    body.date || now.split("T")[0],
    body.name || "",
    body.type || "custom",
    body.notes || "",
    body.durationMinutes || 0,
    body.bodyweightKg || 0,
    exercises,
    body.totalVolumeKg || 0,
    id, now, now
  ).run();

  return jsonResponse({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  if (!body.id) return errorResponse("id is required", 400);

  await env.SITE_DB.prepare("DELETE FROM workouts WHERE id = ?").bind(body.id).run();
  return jsonResponse({ ok: true });
}
