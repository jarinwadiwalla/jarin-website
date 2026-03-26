/**
 * Cloudflare Pages Function — /api/subscribers
 *
 * GET    — Lists all subscribers
 * DELETE — Removes a subscriber by email
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

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
      headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ subscribers: [], error: "Failed to fetch subscribers." }),
      { status: 500, headers }
    );
  }
}

export async function onRequestDelete(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await context.request.json();
    const email = (body.email || "").trim().toLowerCase();

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "Email is required." }),
        { status: 400, headers }
      );
    }

    const existing = await context.env.SITE_DB.prepare(
      "SELECT email FROM subscribers WHERE email = ?"
    ).bind(email).first();

    if (!existing) {
      return new Response(
        JSON.stringify({ success: false, error: "Subscriber not found." }),
        { status: 404, headers }
      );
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM subscribers WHERE email = ?"
    ).bind(email).run();

    return new Response(
      JSON.stringify({ success: true, message: "Subscriber removed." }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to remove subscriber." }),
      { status: 500, headers }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
