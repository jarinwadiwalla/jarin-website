/**
 * Cloudflare Pages Function — /api/todos
 *
 * GET    → list all todos (sorted by priority desc, then createdAt desc)
 * POST   → create or update a todo
 * DELETE → delete a todo
 */

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function newId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7);
}

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM todos ORDER BY completed ASC, priority DESC, createdAt DESC"
    ).all();
    return new Response(JSON.stringify({ todos: results }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to load todos." }), { status: 500, headers: CORS });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();
    const { id, text, completed, ventureId, goalId, priority, dueDate } = body;

    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "text is required." }), { status: 400, headers: CORS });
    }

    if (id) {
      const existing = await context.env.SITE_DB.prepare(
        "SELECT * FROM todos WHERE id = ?"
      ).bind(id).first();

      if (!existing) {
        return new Response(JSON.stringify({ error: "Todo not found." }), { status: 404, headers: CORS });
      }

      await context.env.SITE_DB.prepare(
        `UPDATE todos SET text=?, completed=?, ventureId=?, goalId=?, priority=?, dueDate=?, updatedAt=? WHERE id=?`
      ).bind(
        text.trim(),
        completed !== undefined ? (completed ? 1 : 0) : existing.completed,
        ventureId !== undefined ? ventureId : existing.ventureId,
        goalId !== undefined ? goalId : existing.goalId,
        priority !== undefined ? priority : existing.priority,
        dueDate !== undefined ? dueDate : existing.dueDate,
        now,
        id
      ).run();

      const updated = await context.env.SITE_DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
      return new Response(JSON.stringify({ ok: true, todo: updated }), { status: 200, headers: CORS });
    }

    const todoId = newId();
    await context.env.SITE_DB.prepare(
      `INSERT INTO todos (id, text, completed, ventureId, goalId, priority, dueDate, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).bind(
      todoId,
      text.trim(),
      ventureId || "",
      goalId || "",
      priority || 0,
      dueDate || "",
      now, now
    ).run();

    const todo = await context.env.SITE_DB.prepare("SELECT * FROM todos WHERE id = ?").bind(todoId).first();
    return new Response(JSON.stringify({ ok: true, todo }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to save todo." }), { status: 500, headers: CORS });
  }
}

export async function onRequestDelete(context) {
  try {
    const { id } = await context.request.json();
    if (!id) return new Response(JSON.stringify({ error: "id is required." }), { status: 400, headers: CORS });
    await context.env.SITE_DB.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete todo." }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
