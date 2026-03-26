/**
 * Cloudflare Pages Function — /api/notes
 *
 * GET    → list all notes
 * POST   → create/update a note
 * DELETE → delete a note by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM notes ORDER BY createdAt DESC"
    ).all();

    const notes = results.map(row => ({
      ...row,
      completed: !!row.completed,
    }));

    return new Response(
      JSON.stringify({ notes }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load notes." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { id, text, completed } = body;

    if (!text || !text.trim()) {
      return new Response(
        JSON.stringify({ error: "Text is required." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const noteId = id || String(Date.now());
    const now = new Date().toISOString();

    const existing = await context.env.SITE_DB.prepare(
      "SELECT id, createdAt FROM notes WHERE id = ?"
    ).bind(noteId).first();

    if (existing) {
      await context.env.SITE_DB.prepare(
        "UPDATE notes SET text=?, completed=?, updatedAt=? WHERE id=?"
      ).bind(text.trim(), completed ? 1 : 0, now, noteId).run();
    } else {
      await context.env.SITE_DB.prepare(
        "INSERT INTO notes (id, text, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)"
      ).bind(noteId, text.trim(), completed ? 1 : 0, now, now).run();
    }

    const data = {
      id: noteId,
      text: text.trim(),
      completed: !!completed,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    return new Response(
      JSON.stringify({ ok: true, note: data }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to save note." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Must include id." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM notes WHERE id = ?"
    ).bind(id).run();

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete note." }),
      { status: 500, headers: CORS_HEADERS }
    );
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
