/**
 * Cloudflare Pages Function — /api/intention
 *
 * GET  → ventures, goals, checkins (90d), linked habits/todos, period markers
 * POST → action-based: save-venture, delete-venture, reorder-ventures,
 *                      save-goal, delete-goal, reorder-goals,
 *                      checkin, uncheckin
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

function weekStart(dateStr) {
  const d = new Date((dateStr || todayDate()) + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function quarterStart(dateStr) {
  const d = new Date((dateStr || todayDate()) + "T12:00:00Z");
  const q = Math.floor(d.getUTCMonth() / 3);
  return `${d.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01`;
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
    const ws = weekStart(today);
    const ago90 = ninetyDaysAgo();

    const [ventureRes, goalRes, checkinRes, todayCheckinRes, weekCheckinRes, habitRes, todoRes] =
      await Promise.all([
        context.env.SITE_DB.prepare(
          "SELECT * FROM ventures ORDER BY sortOrder ASC, createdAt ASC"
        ).all(),
        context.env.SITE_DB.prepare(
          "SELECT * FROM goals ORDER BY sortOrder ASC, createdAt ASC"
        ).all(),
        context.env.SITE_DB.prepare(
          "SELECT * FROM goal_checkins WHERE date >= ? ORDER BY date DESC"
        ).bind(ago90).all(),
        context.env.SITE_DB.prepare(
          "SELECT goalId, COUNT(*) as c FROM goal_checkins WHERE date = ? GROUP BY goalId"
        ).bind(today).all(),
        context.env.SITE_DB.prepare(
          "SELECT goalId, COUNT(*) as c FROM goal_checkins WHERE date >= ? GROUP BY goalId"
        ).bind(ws).all(),
        context.env.SITE_DB.prepare(
          "SELECT id, name, ventureId, goalId, currentStreak, lastCompletedDate, valueType, valueLabel FROM habits WHERE status = 'active'"
        ).all(),
        context.env.SITE_DB.prepare(
          "SELECT id, text, completed, ventureId, goalId, priority, dueDate FROM todos WHERE completed = 0"
        ).all(),
      ]);

    return new Response(
      JSON.stringify({
        ventures: ventureRes.results,
        goals: goalRes.results,
        recentCheckins: checkinRes.results,
        todayCheckins: todayCheckinRes.results,
        weekCheckins: weekCheckinRes.results,
        linkedHabits: habitRes.results,
        linkedTodos: todoRes.results,
        periods: { today, weekStart: ws, quarterStart: quarterStart(today) },
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to load intentions." }), { status: 500, headers: CORS });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { action } = body;
    const now = new Date().toISOString();

    // ── Ventures ──

    if (action === "save-venture") {
      const { id, name, color, icon, tagline, status, sortOrder } = body;
      if (!name || !name.trim()) {
        return new Response(JSON.stringify({ error: "name is required." }), { status: 400, headers: CORS });
      }
      const vid = id || newId();
      const existing = id
        ? await context.env.SITE_DB.prepare("SELECT * FROM ventures WHERE id = ?").bind(id).first()
        : null;

      if (existing) {
        await context.env.SITE_DB.prepare(
          "UPDATE ventures SET name=?, color=?, icon=?, tagline=?, status=?, sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(
          name.trim(),
          color || existing.color,
          icon !== undefined ? icon : existing.icon,
          tagline !== undefined ? tagline : existing.tagline,
          status || existing.status,
          sortOrder !== undefined ? sortOrder : existing.sortOrder,
          now, vid
        ).run();
      } else {
        const maxRow = await context.env.SITE_DB.prepare(
          "SELECT MAX(sortOrder) as mx FROM ventures"
        ).first();
        await context.env.SITE_DB.prepare(
          `INSERT INTO ventures (id, name, color, icon, tagline, status, sortOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
        ).bind(vid, name.trim(), color || "#5C6BC0", icon || "", tagline || "",
          sortOrder !== undefined ? sortOrder : ((maxRow?.mx || 0) + 1),
          now, now).run();
      }
      return new Response(JSON.stringify({ ok: true, id: vid }), { status: 200, headers: CORS });
    }

    if (action === "delete-venture") {
      const { id } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      await context.env.SITE_DB.prepare("UPDATE ventures SET status='archived', updatedAt=? WHERE id=?").bind(now, id).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "delete-venture-hard") {
      const { id } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      await context.env.SITE_DB.batch([
        context.env.SITE_DB.prepare("DELETE FROM ventures WHERE id = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE goals SET ventureIds='' WHERE ventureIds = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE habits SET ventureId='' WHERE ventureId = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE todos SET ventureId='' WHERE ventureId = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE office_work_categories SET ventureIds='' WHERE ventureIds = ?").bind(id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "reorder-ventures") {
      const { entries } = body;
      if (!Array.isArray(entries)) return new Response(JSON.stringify({ error: "entries required." }), { status: 400, headers: CORS });
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare("UPDATE ventures SET sortOrder=?, updatedAt=? WHERE id=?").bind(e.sortOrder, now, e.id)
      );
      if (stmts.length) await context.env.SITE_DB.batch(stmts);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    // ── Goals ──

    if (action === "save-goal") {
      const { id, ventureIds, horizon, title, why, targetDate, status, sortOrder, priority, size, blockedBy } = body;
      if (!title || !title.trim()) return new Response(JSON.stringify({ error: "title is required." }), { status: 400, headers: CORS });
      if (!horizon) return new Response(JSON.stringify({ error: "horizon is required." }), { status: 400, headers: CORS });

      const gid = id || newId();
      const existing = id
        ? await context.env.SITE_DB.prepare("SELECT * FROM goals WHERE id = ?").bind(id).first()
        : null;

      const vids = Array.isArray(ventureIds) ? ventureIds.join(",") : (ventureIds || "");
      const bby = Array.isArray(blockedBy) ? blockedBy.join(",") : (blockedBy || "");

      if (existing) {
        await context.env.SITE_DB.prepare(
          `UPDATE goals SET ventureIds=?, horizon=?, title=?, why=?, targetDate=?, status=?,
           sortOrder=?, priority=?, size=?, blockedBy=?, updatedAt=? WHERE id=?`
        ).bind(
          vids, horizon, title.trim(),
          why !== undefined ? why : existing.why,
          targetDate !== undefined ? targetDate : existing.targetDate,
          status || existing.status,
          sortOrder !== undefined ? sortOrder : existing.sortOrder,
          priority !== undefined ? priority : existing.priority,
          size !== undefined ? size : existing.size,
          bby, now, gid
        ).run();
      } else {
        const maxRow = await context.env.SITE_DB.prepare("SELECT MAX(sortOrder) as mx FROM goals").first();
        await context.env.SITE_DB.prepare(
          `INSERT INTO goals (id, ventureIds, horizon, title, why, targetDate, status, sortOrder, priority, size, blockedBy, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          gid, vids, horizon, title.trim(), why || "", targetDate || "",
          status || "todo",
          sortOrder !== undefined ? sortOrder : ((maxRow?.mx || 0) + 1),
          priority || 0, size || "", bby, now, now
        ).run();
      }
      return new Response(JSON.stringify({ ok: true, id: gid }), { status: 200, headers: CORS });
    }

    if (action === "delete-goal") {
      const { id } = body;
      if (!id) return new Response(JSON.stringify({ error: "id required." }), { status: 400, headers: CORS });
      await context.env.SITE_DB.batch([
        context.env.SITE_DB.prepare("DELETE FROM goals WHERE id = ?").bind(id),
        context.env.SITE_DB.prepare("DELETE FROM goal_checkins WHERE goalId = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE habits SET goalId='' WHERE goalId = ?").bind(id),
        context.env.SITE_DB.prepare("UPDATE todos SET goalId='' WHERE goalId = ?").bind(id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    if (action === "reorder-goals") {
      const { entries } = body;
      if (!Array.isArray(entries)) return new Response(JSON.stringify({ error: "entries required." }), { status: 400, headers: CORS });
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare("UPDATE goals SET sortOrder=?, updatedAt=? WHERE id=?").bind(e.sortOrder, now, e.id)
      );
      if (stmts.length) await context.env.SITE_DB.batch(stmts);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    // ── Checkins ──

    if (action === "checkin") {
      const { goalId, progressNote, value, date } = body;
      if (!goalId) return new Response(JSON.stringify({ error: "goalId required." }), { status: 400, headers: CORS });
      const d = date || todayDate();
      const existing = await context.env.SITE_DB.prepare(
        "SELECT id FROM goal_checkins WHERE goalId = ? AND date = ?"
      ).bind(goalId, d).first();

      if (existing) {
        await context.env.SITE_DB.prepare(
          "UPDATE goal_checkins SET progressNote=?, value=? WHERE id=?"
        ).bind(progressNote || "", value || 0, existing.id).run();
        return new Response(JSON.stringify({ ok: true, id: existing.id, updated: true }), { status: 200, headers: CORS });
      }

      const cid = newId();
      await context.env.SITE_DB.prepare(
        "INSERT INTO goal_checkins (id, goalId, date, progressNote, value, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(cid, goalId, d, progressNote || "", value || 0, now).run();
      return new Response(JSON.stringify({ ok: true, id: cid, updated: false }), { status: 200, headers: CORS });
    }

    if (action === "uncheckin") {
      const { goalId, date } = body;
      if (!goalId) return new Response(JSON.stringify({ error: "goalId required." }), { status: 400, headers: CORS });
      const d = date || todayDate();
      await context.env.SITE_DB.prepare(
        "DELETE FROM goal_checkins WHERE goalId = ? AND date = ?"
      ).bind(goalId, d).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), { status: 400, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to process intention action." }), { status: 500, headers: CORS });
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
