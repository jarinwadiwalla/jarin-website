/**
 * Cloudflare Pages Function — /api/unsubscribe
 *
 * GET  ?email={email}&token={token} — renders confirmation page
 * POST { email, token } — marks subscriber as unsubscribed
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - UNSUBSCRIBE_SECRET (secret)
 */

async function hmacToken(email, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(email));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyToken(email, token, secret) {
  const expected = await hmacToken(email, secret);
  return token === expected;
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Jarin's Blog</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #1f2937; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { font-size: 16px; color: #6b7280; line-height: 1.6; margin: 8px 0; }
    .btn { display: inline-block; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; border: none; margin: 8px; text-decoration: none; }
    .btn-danger { background: #2D5F3F; color: white; }
    .btn-cancel { background: #e5e7eb; color: #374151; }
    .btn:hover { opacity: 0.9; }
    .logo { width: 48px; height: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <img src="https://jarinwadiwalla.com/images/lotus-icon.png" alt="Jarin" class="logo">
    ${body}
  </div>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const email = url.searchParams.get("email");
  const token = url.searchParams.get("token");
  const secret = context.env.UNSUBSCRIBE_SECRET || "default-secret";

  if (!email || !token) {
    return new Response(htmlPage("Invalid Link", "<h1>Invalid Link</h1><p>This unsubscribe link is missing required parameters.</p>"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const valid = await verifyToken(email, token, secret);
  if (!valid) {
    return new Response(htmlPage("Invalid Link", "<h1>Invalid Link</h1><p>This unsubscribe link is invalid or has expired.</p>"), {
      status: 403,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Look up current preferences
  const subscriber = await context.env.SITE_DB.prepare(
    "SELECT preferences FROM subscribers WHERE email = ?"
  ).bind(email.trim().toLowerCase()).first();
  const prefs = (subscriber?.preferences || 'blog').split(',');
  const hasBlog = prefs.includes('blog');
  const hasPoetry = prefs.includes('poetry');
  const safeEmail = email.replace(/</g, "&lt;");
  const safeEmailAttr = email.replace(/"/g, "&quot;");
  const safeTokenAttr = token.replace(/"/g, "&quot;");

  const body = `
    <h1>Email Preferences</h1>
    <p>Manage notifications for <strong>${safeEmail}</strong></p>
    <form method="POST" action="/api/unsubscribe" style="text-align:left;margin:24px 0;">
      <input type="hidden" name="email" value="${safeEmailAttr}">
      <input type="hidden" name="token" value="${safeTokenAttr}">
      <input type="hidden" name="action" value="update">
      <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" name="prefBlog" value="blog" ${hasBlog ? 'checked' : ''} style="width:18px;height:18px;">
        <span style="font-size:15px;color:#1f2937;">Blog posts</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;cursor:pointer;">
        <input type="checkbox" name="prefPoetry" value="poetry" ${hasPoetry ? 'checked' : ''} style="width:18px;height:18px;">
        <span style="font-size:15px;color:#1f2937;">Poetry</span>
      </label>
      <div style="text-align:center;">
        <button type="submit" class="btn btn-danger">Save Preferences</button>
      </div>
    </form>
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;">
      <form method="POST" action="/api/unsubscribe">
        <input type="hidden" name="email" value="${safeEmailAttr}">
        <input type="hidden" name="token" value="${safeTokenAttr}">
        <input type="hidden" name="action" value="unsubscribe">
        <p style="font-size:13px;color:#9ca3af;margin:0 0 8px;">Or unsubscribe from everything:</p>
        <button type="submit" class="btn btn-cancel" style="font-size:13px;padding:8px 16px;">Unsubscribe from all</button>
      </form>
    </div>
  `;

  return new Response(htmlPage("Email Preferences", body), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.UNSUBSCRIBE_SECRET || "default-secret";

  let email, token, action, prefBlog, prefPoetry;

  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    email = body.email;
    token = body.token;
    action = body.action || "unsubscribe";
    prefBlog = body.prefBlog;
    prefPoetry = body.prefPoetry;
  } else {
    const formData = await request.formData();
    email = formData.get("email");
    token = formData.get("token");
    action = formData.get("action") || "unsubscribe";
    prefBlog = formData.get("prefBlog");
    prefPoetry = formData.get("prefPoetry");
  }

  if (!email || !token) {
    return new Response(htmlPage("Error", "<h1>Error</h1><p>Missing email or token.</p>"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const valid = await verifyToken(email, token, secret);
  if (!valid) {
    return new Response(htmlPage("Invalid Link", "<h1>Invalid Link</h1><p>This unsubscribe link is invalid.</p>"), {
      status: 403,
      headers: { "Content-Type": "text/html" },
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();

  if (action === "update") {
    const prefs = [];
    if (prefBlog) prefs.push("blog");
    if (prefPoetry) prefs.push("poetry");

    if (prefs.length === 0) {
      // No preferences selected = full unsubscribe
      await env.SITE_DB.prepare(
        "UPDATE subscribers SET unsubscribed=1, unsubscribedAt=?, preferences='' WHERE email=?"
      ).bind(now, normalizedEmail).run();

      return new Response(
        htmlPage("Unsubscribed", "<h1>You've been unsubscribed</h1><p>You will no longer receive emails.</p><p>If this was a mistake, you can sign up again at <a href=\"https://jarinwadiwalla.com\" style=\"color:#2D5F3F;\">jarinwadiwalla.com</a>.</p>"),
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    await env.SITE_DB.prepare(
      "UPDATE subscribers SET preferences=?, unsubscribed=0 WHERE email=?"
    ).bind(prefs.join(","), normalizedEmail).run();

    const labels = prefs.map(p => p === "blog" ? "blog posts" : "poetry").join(" and ");
    return new Response(
      htmlPage("Preferences Updated", `<h1>Preferences Updated</h1><p>You'll now receive notifications for <strong>${labels}</strong>.</p><p><a href="https://jarinwadiwalla.com" style="color:#2D5F3F;">Back to website</a></p>`),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  // Full unsubscribe
  await env.SITE_DB.prepare(
    "UPDATE subscribers SET unsubscribed=1, unsubscribedAt=? WHERE email=?"
  ).bind(now, normalizedEmail).run();

  return new Response(
    htmlPage("Unsubscribed", "<h1>You've been unsubscribed</h1><p>You will no longer receive emails.</p><p>If this was a mistake, you can sign up again at <a href=\"https://jarinwadiwalla.com\" style=\"color:#2D5F3F;\">jarinwadiwalla.com</a>.</p>"),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
