/**
 * Cloudflare Pages Function — GET /api/newsletter-campaigns
 *
 * Lists all sent campaign records.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM campaigns ORDER BY sentAt DESC"
    ).all();

    const campaigns = results.map(row => ({
      ...row,
      errors: row.errors ? JSON.parse(row.errors) : undefined,
    }));

    return new Response(JSON.stringify({ campaigns }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    return jsonResponse({ campaigns: [], error: err.message });
  }
}
