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

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM finances ORDER BY createdAt DESC"
    ).all();

    return jsonResponse({ entries: results });
  } catch (err) {
    return errorResponse("Failed to load finances.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();

    const { id, price, product, company, businessUseCase, recurringDate, frequency,
            kind, description, category, date, localAmount, localCurrency, groupTag } = body;

    if (!product || !product.trim()) {
      return errorResponse("Product/source name is required.", 400);
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
        frequency: (frequency !== undefined ? frequency : existing.frequency || "").trim(),
        kind: (kind || existing.kind || "business").trim(),
        description: description !== undefined ? (description || "").trim() : (existing.description || ""),
        category: category !== undefined ? (category || "").trim() : (existing.category || ""),
        date: date !== undefined ? (date || "").trim() : (existing.date || ""),
        localAmount: localAmount !== undefined ? localAmount : (existing.localAmount || ""),
        localCurrency: localCurrency !== undefined ? (localCurrency || "").trim() : (existing.localCurrency || ""),
        groupTag: groupTag !== undefined ? (groupTag || "").trim() : (existing.groupTag || ""),
        updatedAt: now,
      };
    } else {
      data = {
        id: entryId,
        price: price || "", product: product.trim(),
        company: (company || "").trim(),
        businessUseCase: (businessUseCase || "").trim(),
        recurringDate: (recurringDate || "").trim(),
        frequency: (frequency !== undefined ? frequency : "").trim(),
        kind: (kind || "business").trim(),
        description: (description || "").trim(),
        category: (category || "").trim(),
        date: (date || "").trim(),
        localAmount: localAmount || "",
        localCurrency: (localCurrency || "").trim(),
        groupTag: (groupTag || "").trim(),
        createdAt: now, updatedAt: now,
      };
    }

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO finances (id, price, product, company, businessUseCase, recurringDate,
       frequency, kind, description, category, date, localAmount, localCurrency, groupTag, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.price, data.product, data.company, data.businessUseCase,
      data.recurringDate, data.frequency, data.kind, data.description,
      data.category, data.date, data.localAmount, data.localCurrency, data.groupTag,
      data.createdAt || existing?.createdAt || now, data.updatedAt
    ).run();

    return jsonResponse({ ok: true, entry: data });
  } catch (err) {
    return errorResponse("Failed to save finance entry.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return errorResponse("Must include id.", 400);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM finances WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete finance entry.", 500);
  }
}
