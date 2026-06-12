/**
 * Cloudflare Pages Function — /api/subscribers
 *
 * GET    — Lists all subscribers
 * DELETE — Removes a subscriber by email
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT email, firstName, lastName, subscribedAt, unsubscribed FROM subscribers ORDER BY subscribedAt ASC"
    ).all();

    const subscribers = results.map(row => ({
      ...row,
      unsubscribed: !!row.unsubscribed,
    }));

    return new Response(JSON.stringify({ subscribers }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (err) {
    return jsonResponse({ subscribers: [], error: "Failed to fetch subscribers." }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const email = (body.email || "").trim().toLowerCase();

    if (!email) {
      return errorResponse("Email is required.", 400);
    }

    const existing = await context.env.SITE_DB.prepare(
      "SELECT email FROM subscribers WHERE email = ?"
    ).bind(email).first();

    if (!existing) {
      return jsonResponse({ success: false, error: "Subscriber not found." }, 404);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM subscribers WHERE email = ?"
    ).bind(email).run();

    return jsonResponse({ success: true, message: "Subscriber removed." });
  } catch (err) {
    return jsonResponse({ success: false, error: "Failed to remove subscriber." }, 500);
  }
}
