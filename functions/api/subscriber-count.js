/**
 * Cloudflare Pages Function — /api/subscriber-count
 *
 * GET  → returns active subscriber count
 * POST → same as GET (kept for compatibility with resync button)
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const row = await context.env.SITE_DB.prepare(
      "SELECT COUNT(*) as count FROM subscribers WHERE unsubscribed = 0"
    ).first();

    return new Response(JSON.stringify({ count: row?.count || 0 }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ count: 0 }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  }
}

export async function onRequestPost(context) {
  try {
    const row = await context.env.SITE_DB.prepare(
      "SELECT COUNT(*) as count FROM subscribers WHERE unsubscribed = 0"
    ).first();

    const count = row?.count || 0;

    return jsonResponse({ synced: true, count });
  } catch (err) {
    return jsonResponse({ synced: false, error: "Failed to get count." }, 500);
  }
}
