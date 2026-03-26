/**
 * Cloudflare Pages Function — /api/blog-drafts
 *
 * GET    → list all blog drafts
 * POST   → save/update a draft by slug
 * DELETE → delete a draft by slug
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
      "SELECT * FROM blog_drafts ORDER BY updatedAt DESC"
    ).all();

    const drafts = results.map(row => ({
      ...row,
      scheduledAt: row.scheduledAt || null,
    }));

    return new Response(
      JSON.stringify({ drafts }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load drafts." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { draft } = body;

    if (!draft || !draft.slug || !draft.title || !draft.body) {
      return new Response(
        JSON.stringify({ error: "Draft must include slug, title, and body." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const data = {
      slug: draft.slug,
      title: draft.title,
      date: draft.date || new Date().toISOString().slice(0, 10),
      author: draft.author || "Jarin",
      excerpt: draft.excerpt || "",
      image: draft.image || "",
      body: draft.body,
      scheduledAt: draft.scheduledAt || null,
      updatedAt: new Date().toISOString(),
    };

    await context.env.SITE_DB.prepare(
      "INSERT OR REPLACE INTO blog_drafts (slug, title, date, author, excerpt, image, body, scheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      data.slug, data.title, data.date, data.author, data.excerpt,
      data.image, data.body, data.scheduledAt, data.updatedAt
    ).run();

    return new Response(
      JSON.stringify({ ok: true, draft: data }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to save draft." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { slug } = body;

    if (!slug) {
      return new Response(
        JSON.stringify({ error: "Must include slug." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM blog_drafts WHERE slug = ?"
    ).bind(slug).run();

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete draft." }),
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
