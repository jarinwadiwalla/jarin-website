/**
 * Cloudflare Pages Function — /api/office-work
 *
 * GET    → list categories, sessions (last 90d), and rollups
 * POST   → save-category | delete-category | log-session | delete-session
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function currentWeekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function currentMonthStart() {
  const d = new Date();
  return d.toISOString().slice(0, 8) + "01";
}

function newId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const today = url.searchParams.get("today") || new Date().toISOString().slice(0, 10);
    const ninetyAgo = ninetyDaysAgo();
    const weekStart = currentWeekStart();
    const monthStart = currentMonthStart();

    const [catsRes, sessionsRes, todayRes, weekRes, monthRes] = await Promise.all([
      context.env.SITE_DB.prepare(
        "SELECT * FROM office_work_categories WHERE status = 'active' ORDER BY sortOrder ASC, createdAt ASC"
      ).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM office_work_sessions WHERE date >= ? ORDER BY startedAt DESC"
      ).bind(ninetyAgo).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date = ? GROUP BY categoryId"
      ).bind(today).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date >= ? GROUP BY categoryId"
      ).bind(weekStart).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date >= ? GROUP BY categoryId"
      ).bind(monthStart).all(),
    ]);

    return jsonResponse({
      categories: catsRes.results,
      sessions: sessionsRes.results,
      todayTotals: todayRes.results,
      weekTotals: weekRes.results,
      monthTotals: monthRes.results,
    });
  } catch (err) {
    return errorResponse("Failed to load office work data.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action || "save-category";
    const now = new Date().toISOString();

    if (action === "save-category") {
      const { id, name, kind, color, linkedHabitId, ventureId, ventureIds, sortOrder, status } = body;
      if (!name || !name.trim()) {
        return errorResponse("name is required.", 400);
      }
      const k = kind === 'study' ? 'study' : 'work';

      // v4.6.9 follow-up: ventureIds is the canonical multi-venture list (CSV
      // string or array). When the client sends it we use it directly; the
      // singular ventureId column is kept in sync with the first item for any
      // older filter / rollup that still keys on it. Mirrors the same pattern
      // used for goals in v4.6.7.
      const sanitizeIds = (csv) => String(csv || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      let nextVentureIds;
      if (ventureIds !== undefined) {
        nextVentureIds = Array.isArray(ventureIds)
          ? ventureIds.filter(Boolean)
          : sanitizeIds(ventureIds);
      } else if (ventureId !== undefined) {
        nextVentureIds = ventureId ? [ventureId] : [];
      } else {
        nextVentureIds = null; // signal: don't touch on UPDATE
      }
      const nextPrimaryVenture = nextVentureIds && nextVentureIds.length > 0 ? nextVentureIds[0] : '';
      const nextVentureIdsCsv = nextVentureIds ? nextVentureIds.join(',') : null;

      if (id) {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT ventureId, ventureIds FROM office_work_categories WHERE id = ?"
        ).bind(id).first();
        await context.env.SITE_DB.prepare(
          "UPDATE office_work_categories SET name=?, kind=?, color=?, linkedHabitId=?, ventureId=?, ventureIds=?, sortOrder=?, status=?, updatedAt=? WHERE id=?"
        ).bind(
          name.trim(),
          k,
          color || '#3b82f6',
          linkedHabitId || '',
          nextVentureIdsCsv !== null ? nextPrimaryVenture : (existing ? (existing.ventureId || '') : ''),
          nextVentureIdsCsv !== null ? nextVentureIdsCsv : (existing ? (existing.ventureIds || '') : ''),
          sortOrder || 0,
          status || 'active',
          now,
          id
        ).run();
        return jsonResponse({ ok: true, id });
      }

      const newCatId = newId();
      await context.env.SITE_DB.prepare(
        "INSERT INTO office_work_categories (id, name, kind, color, linkedHabitId, ventureId, ventureIds, sortOrder, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        newCatId,
        name.trim(),
        k,
        color || '#3b82f6',
        linkedHabitId || '',
        nextPrimaryVenture,
        nextVentureIdsCsv || '',
        sortOrder || 0,
        'active',
        now,
        now
      ).run();
      return jsonResponse({ ok: true, id: newCatId });
    }

    if (action === "delete-category") {
      const { id } = body;
      if (!id) return errorResponse("id is required.", 400);
      // Soft delete — keep sessions for analytics
      await context.env.SITE_DB.prepare(
        "UPDATE office_work_categories SET status='archived', updatedAt=? WHERE id=?"
      ).bind(now, id).run();
      return jsonResponse({ ok: true });
    }

    if (action === "log-session") {
      const { categoryId, startedAt, endedAt, durationSec, date, notes, goalId } = body;
      if (!categoryId || !startedAt || !endedAt || durationSec == null) {
        return errorResponse("categoryId, startedAt, endedAt, durationSec are required.", 400);
      }
      const dur = Math.max(0, parseInt(durationSec) || 0);
      const sessionDate = date || new Date(endedAt).toISOString().slice(0, 10);
      const sessionId = newId();
      await context.env.SITE_DB.prepare(
        "INSERT INTO office_work_sessions (id, categoryId, date, startedAt, endedAt, durationSec, notes, goalId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        sessionId,
        categoryId,
        sessionDate,
        startedAt,
        endedAt,
        dur,
        (notes || '').trim(),
        goalId || '',
        now
      ).run();
      return jsonResponse({ ok: true, id: sessionId });
    }

    if (action === "update-session") {
      const { id, categoryId, startedAt, endedAt, durationSec, date, notes, goalId } = body;
      if (!id) return errorResponse("id is required.", 400);
      if (!categoryId || !startedAt || !endedAt || durationSec == null) {
        return errorResponse("categoryId, startedAt, endedAt, durationSec are required.", 400);
      }
      // Honor partial updates: omitted goalId preserves the existing value
      // so "edit duration" doesn't clobber an earlier goal tag.
      const existing = await context.env.SITE_DB.prepare(
        "SELECT goalId FROM office_work_sessions WHERE id = ?"
      ).bind(id).first();
      const nextGoalId = goalId !== undefined
        ? (goalId || '')
        : (existing ? (existing.goalId || '') : '');
      const dur = Math.max(0, parseInt(durationSec) || 0);
      const sessionDate = date || new Date(endedAt).toISOString().slice(0, 10);
      await context.env.SITE_DB.prepare(
        "UPDATE office_work_sessions SET categoryId=?, date=?, startedAt=?, endedAt=?, durationSec=?, notes=?, goalId=? WHERE id=?"
      ).bind(
        categoryId,
        sessionDate,
        startedAt,
        endedAt,
        dur,
        (notes || '').trim(),
        nextGoalId,
        id
      ).run();
      return jsonResponse({ ok: true, id });
    }

    if (action === "delete-session") {
      const { id } = body;
      if (!id) return errorResponse("id is required.", 400);
      await context.env.SITE_DB.prepare(
        "DELETE FROM office_work_sessions WHERE id = ?"
      ).bind(id).run();
      return jsonResponse({ ok: true });
    }

    if (action === "reorder") {
      const { entries } = body;
      if (!Array.isArray(entries)) {
        return errorResponse("entries array is required.", 400);
      }
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE office_work_categories SET sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.sortOrder || 0, now, e.id)
      );
      if (stmts.length > 0) {
        await context.env.SITE_DB.batch(stmts);
      }
      return jsonResponse({ ok: true });
    }

    return errorResponse("Unknown action: " + action, 400);
  } catch (err) {
    return errorResponse("Failed to process office-work action.", 500);
  }
}
