/**
 * Cloudflare Pages Function — /api/finances
 *
 * GET    → list all finance entries
 * POST   → create or update a finance entry
 * DELETE → delete entry by id
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
      "SELECT * FROM finances ORDER BY createdAt DESC"
    ).all();

    return new Response(
      JSON.stringify({ entries: results }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load finances." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();

    const { id, price, product, company, businessUseCase, recurringDate, frequency,
            kind, description, category, date, localAmount, localCurrency } = body;

    if (!product || !product.trim()) {
      return new Response(
        JSON.stringify({ error: "Product/source name is required." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const entryId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);

    const existing = await context.env.SITE_DB.prepare(
      "SELECT * FROM finances WHERE id = ?"
    ).bind(entryId).first();

    let data;
    if (existing) {
      data = {
        ...existing,
        price: price !== undefined ? price : existing.price,
        product: product.trim(),
        company: (company || "").trim(),
        businessUseCase: (businessUseCase || "").trim(),
        recurringDate: (recurringDate || "").trim(),
        frequency: (frequency || existing.frequency || "monthly").trim(),
        kind: (kind || existing.kind || "business").trim(),
        description: description !== undefined ? (description || "").trim() : (existing.description || ""),
        category: category !== undefined ? (category || "").trim() : (existing.category || ""),
        date: date !== undefined ? (date || "").trim() : (existing.date || ""),
        localAmount: localAmount !== undefined ? localAmount : (existing.localAmount || ""),
        localCurrency: localCurrency !== undefined ? (localCurrency || "").trim() : (existing.localCurrency || ""),
        updatedAt: now,
      };
    } else {
      data = {
        id: entryId,
        price: price || "", product: product.trim(),
        company: (company || "").trim(),
        businessUseCase: (businessUseCase || "").trim(),
        recurringDate: (recurringDate || "").trim(),
        frequency: (frequency || "monthly").trim(),
        kind: (kind || "business").trim(),
        description: (description || "").trim(),
        category: (category || "").trim(),
        date: (date || "").trim(),
        localAmount: localAmount || "",
        localCurrency: (localCurrency || "").trim(),
        createdAt: now, updatedAt: now,
      };
    }

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO finances (id, price, product, company, businessUseCase, recurringDate,
       frequency, kind, description, category, date, localAmount, localCurrency, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.price, data.product, data.company, data.businessUseCase,
      data.recurringDate, data.frequency, data.kind, data.description,
      data.category, data.date, data.localAmount, data.localCurrency,
      data.createdAt || existing?.createdAt || now, data.updatedAt
    ).run();

    return new Response(
      JSON.stringify({ ok: true, entry: data }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to save finance entry." }),
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
      "DELETE FROM finances WHERE id = ?"
    ).bind(id).run();

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete finance entry." }),
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
