/**
 * Cloudflare Pages Function — /api/settings
 *
 * GET  → get site settings
 * POST → update site settings
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const DEFAULTS = {
  languages: {
    indonesian: false,
    persian: false,
  },
  calendarCategories: {},
};

function parseData(row) {
  try { return JSON.parse(row?.data || '{}'); } catch { return {}; }
}

async function ensureColumns(db) {
  const cols = [
    "ALTER TABLE settings ADD COLUMN calendarCategories TEXT DEFAULT '{}'",
    "ALTER TABLE settings ADD COLUMN data TEXT DEFAULT '{}'",
  ];
  for (const sql of cols) {
    try { await db.prepare(sql).run(); } catch { /* Column already exists */ }
  }
}

export async function onRequestGet(context) {
  try {
    await ensureColumns(context.env.SITE_DB);

    const row = await context.env.SITE_DB.prepare(
      "SELECT * FROM settings WHERE id = 'main'"
    ).first();

    if (!row) {
      return jsonResponse(DEFAULTS);
    }

    const extra = parseData(row);

    const result = {
      ...DEFAULTS,
      languages: { ...DEFAULTS.languages, ...JSON.parse(row.languages || '{}') },
      calendarCategories: JSON.parse(row.calendarCategories || '{}'),
      ...extra,
      updatedAt: row.updatedAt,
    };

    return jsonResponse(result);
  } catch (err) {
    return errorResponse("Failed to load settings.");
  }
}

export async function onRequestPost(context) {
  try {
    await ensureColumns(context.env.SITE_DB);

    const body = await context.request.json();

    const row = await context.env.SITE_DB.prepare(
      "SELECT * FROM settings WHERE id = 'main'"
    ).first();

    const existingExtra = parseData(row);

    const existing = row
      ? {
          ...DEFAULTS,
          languages: { ...DEFAULTS.languages, ...JSON.parse(row.languages || '{}') },
          calendarCategories: JSON.parse(row.calendarCategories || '{}'),
        }
      : DEFAULTS;

    const merged = {
      ...existing,
      ...body,
      languages: {
        ...existing.languages,
        ...(body.languages || {}),
      },
      calendarCategories: body.calendarCategories !== undefined
        ? body.calendarCategories
        : existing.calendarCategories,
    };

    // Merge extra data fields (trainingNotes, generalNotes, etc.)
    const extraFields = {};
    for (const key of Object.keys(body)) {
      if (key !== 'languages') {
        extraFields[key] = body[key];
      }
    }
    const mergedExtra = { ...existingExtra, ...extraFields };

    const now = new Date().toISOString();

    await context.env.SITE_DB.prepare(
      "INSERT OR REPLACE INTO settings (id, languages, calendarCategories, data, updatedAt) VALUES ('main', ?, ?, ?, ?)"
    ).bind(JSON.stringify(merged.languages), JSON.stringify(merged.calendarCategories), JSON.stringify(mergedExtra), now).run();

    const response = { ...merged, ...mergedExtra, updatedAt: now };
    delete response.data;

    return jsonResponse({ ok: true, settings: response });
  } catch (err) {
    return jsonResponse({ error: "Failed to save settings.", detail: err?.message || String(err) }, 500);
  }
}
