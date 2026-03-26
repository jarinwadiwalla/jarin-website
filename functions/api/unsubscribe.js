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
  <title>${title} — Jarin Wadiwalla</title>
  <style>
    body { font-family: 'Nunito Sans', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #fdf8f6; color: #3d2e26; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 24px; font-weight: 300; margin-bottom: 12px; }
    p { font-size: 16px; color: #5c4539; line-height: 1.6; margin: 8px 0; }
    .btn { display: inline-block; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; border: none; margin: 8px; text-decoration: none; }
    .btn-danger { background: #7d5f52; color: white; }
    .btn-cancel { background: #eaddd7; color: #5c4539; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
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

  const body = `
    <h1>Unsubscribe</h1>
    <p>Are you sure you want to unsubscribe <strong>${email.replace(/</g, "&lt;")}</strong>?</p>
    <form method="POST" action="/api/unsubscribe">
      <input type="hidden" name="email" value="${email.replace(/"/g, "&quot;")}">
      <input type="hidden" name="token" value="${token.replace(/"/g, "&quot;")}">
      <button type="submit" class="btn btn-danger">Yes, Unsubscribe</button>
      <a href="https://jarinwadiwalla.com" class="btn btn-cancel">Cancel</a>
    </form>
  `;

  return new Response(htmlPage("Unsubscribe", body), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.UNSUBSCRIBE_SECRET || "default-secret";

  let email, token;

  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    email = body.email;
    token = body.token;
  } else {
    const formData = await request.formData();
    email = formData.get("email");
    token = formData.get("token");
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
  await env.SITE_DB.prepare(
    "UPDATE subscribers SET unsubscribed=1, unsubscribedAt=? WHERE email=?"
  ).bind(new Date().toISOString(), normalizedEmail).run();

  return new Response(
    htmlPage("Unsubscribed", "<h1>You've been unsubscribed</h1><p>You will no longer receive emails.</p><p>If this was a mistake, you can sign up again at <a href=\"https://jarinwadiwalla.com\" style=\"color:#7d5f52;\">jarinwadiwalla.com</a>.</p>"),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
