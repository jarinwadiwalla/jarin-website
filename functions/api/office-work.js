/**
 * Cloudflare Pages Function — /api/office-work
 *
 * GET  → categories, sessions (90d), today/week/month totals
 * POST → action-based: save-category, delete-category, log-session,
 *                      update-session, delete-session, reorder
 */

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function newId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function weekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function monthStart() {
  return new Date().toISOString().slice(0, 8) + "01";
}

function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const today = url.searchParams.get("today") || todayDate();
    const ws = weekStart();
    const ms = monthStart();
    const ago90 = ninetyDaysAgo();

    const [catRes, sessRes, todayTotalsRes, weekTotalsRes, monthTotalsRes] = await Promise.all([
      context.env.SITE_DB.prepare(
        "SELECT * FROM office_work_categories WHERE status = 'active' ORDER BY sortOrder ASC, createdAt ASC"
      ).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM office_work_sessions WHERE date >= ? ORDER BY date DESC, startedAt DESC"
      ).bind(ago90).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date = ? GROUP BY categoryId"
      ).bind(today).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date >= ? GROUP BY categoryId"
      ).bind(ws).all(),
      context.env.SITE_DB.prepare(
        "SELECT categoryId, SUM(durationSec) as total FROM office_work_sessions WHERE date >= ? GROUP BY categoryId"
      ).bind(ms).all(),
    ]);

    return new Response(
      JSON.stringify({
        categories: catRes.results,
        sessions: sessRes.results,
        todayTotals: todayTotalsRes.results,
        weekTotals: weekTotalsRes.results,
        monthTotals: monthTotalsRes.results,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to load office work." }), { status: 500, headers: CORS });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { action } = body;
    const now = new Date().toISOString();

    if (action === "save-category") {
      const { id, name, kind, color, linkedHabitId, ventureIds, sortOrder, status } = body;
      if (!name || !name.trim()) return new Response(JSON.stringify({ error: "name required." }), { status: 400, headers: CORS });

      const cid = id || newId();
      const existing = id
        ? await context.env.SITE_DB.prepare("SELECT * FROM office_work_categories WHERE id = ?").bind(id).first()
        : null;

      if (existing) {
        await context.env.SITE_DB.prepare(
          `UPDATE office_work_categories SET name=?, kind=?, color=?, linkedHabitId=?, ventureIds=?, sortOrder=?, status=?, updatedAt=? WHERE id=?`
        ).bind(
          name.trim(),
          kind || existing.kind,
          color || existing.color,
          linkedHabitId !== undefined ? linkedHabitId : existing.linkedHabitId,
          ventureIds !== undefined ? ventureIds : existing.ventureIds,
          sortOrder !== undefined ? sortOrder : existing.sortOrder,
          status || existing.status,
          now, cid
        ).run();
      } else {
        const maxRow = await context.env.SITE_DB.prepare(
          "SELECT MAX(sortOrder) as mx FROM office_work_categories"
        ).first();
        await context.env.SITE_DB.prepare(
          `INSERT INTO office_work_categories (id, name, kind, color, linkedHabitId, ventureIds, sortOrder, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        ).bind(
          cid, name.trim(), kind || "work", color || "#5C6BC0",
          linkedHabitId || "", ventureIds || "",
          sortOrder !== undefined ? sortOrder : ((maxRow?.mx || 0) + 1),
          now, now
        ).run();
      }
      return new Response(JSON.stringify({ ok: true, id: cid }), { status: 200, headers: CORS });
    }

    if (action === "delete-category") {
      const { id } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      await context.env.SITE_DB.prepare(
        "UPDATE office_work_categories SET status='archived', updatedAt=? WHERE id=?"
      ).bind(now, id).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "log-session") {
      const { categoryId, startedAt, endedAt, durationSec, date, notes, goalId } = body;
      if (!categoryId || !startedAt || !endedAt || durationSec === undefined) {
        return new Response(JSON.stringify({ error: "categoryId, startedAt, endedAt, durationSec required." }), { status: 400, headers: CORS });
      }
      const sid = newId();
      const sessionDate = date || todayDate();
      await context.env.SITE_DB.prepare(
        `INSERT INTO office_work_sessions (id, categoryId, date, startedAt, endedAt, durationSec, notes, goalId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sid, categoryId, sessionDate, startedAt, endedAt, durationSec, notes || "", goalId || "", now).run();
      return new Response(JSON.stringify({ ok: true, id: sid }), { status: 200, headers: CORS });
    }

    if (action === "update-session") {
      const { id, categoryId, startedAt, endedAt, durationSec, date, notes, goalId } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      const existing = await context.env.SITE_DB.prepare("SELECT * FROM office_work_sessions WHERE id = ?").bind(id).first();
      if (!existing) return new Response(JSON.stringify({ error: "Session not found." }), { status: 404, headers: CORS });
      await context.env.SITE_DB.prepare(
        `UPDATE office_work_sessions SET categoryId=?, date=?, startedAt=?, endedAt=?, durationSec=?, notes=?, goalId=? WHERE id=?`
      ).bind(
        categoryId || existing.categoryId,
        date || existing.date,
        startedAt || existing.startedAt,
        endedAt || existing.endedAt,
        durationSec !== undefined ? durationSec : existing.durationSec,
        notes !== undefined ? notes : existing.notes,
        goalId !== undefined ? goalId : existing.goalId,
        id
      ).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "delete-session") {
      const { id } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      await context.env.SITE_DB.prepare("DELETE FROM office_work_sessions WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "reorder") {
      const { entries } = body;
      if (!Array.isArray(entries)) return new Response(JSON.stringify({ error: "entries required." }), { status: 400, headers: CORS });
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE office_work_categories SET sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.sortOrder, now, e.id)
      );
      if (stmts.length) await context.env.SITE_DB.batch(stmts);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), { status: 400, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to process office-work action." }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
