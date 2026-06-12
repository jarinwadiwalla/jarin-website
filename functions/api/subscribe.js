/**
 * Cloudflare Pages Function — POST /api/subscribe
 *
 * Accepts { firstName, lastName, email }, validates input,
 * stores the subscriber in D1 with deduplication,
 * sends a welcome email via Resend, and handles resubscription.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - RESEND_API_KEY (secret)
 *   - UNSUBSCRIBE_SECRET (secret)
 *   - ADMIN_EMAIL (secret — receives new-subscriber notifications)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

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

function buildWelcomeEmail(firstName, unsubUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#1a3d2a,#2D5F3F);padding:32px;text-align:center;">
    <img src="https://jarinwadiwalla.com/images/lotus-icon.png" alt="Jarin" width="48" height="48" style="border-radius:8px;">
    <h1 style="color:#ffffff;font-size:22px;margin:12px 0 0;">Welcome!</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 16px;">
      Hey ${firstName}!
    </p>
    <p style="font-size:16px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Thanks for subscribing to my blog. You'll receive updates when I publish new posts about software engineering, languages, yoga, poetry, and whatever else I'm exploring.
    </p>
    <p style="font-size:16px;color:#374151;line-height:1.6;margin:0 0 16px;">
      In the meantime, check out the latest on the blog:
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="https://jarinwadiwalla.com/blog/" style="display:inline-block;padding:12px 28px;background:#2D5F3F;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Read the Blog</a>
    </p>
    <p style="font-size:16px;color:#1f2937;margin:0;">
      — Jarin
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      You're receiving this because you signed up at jarinwadiwalla.com.
      <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function sendAdminNotification(env, context, { firstName, lastName, email, isResub }) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const subject = isResub
    ? `Re-subscriber: ${name} (${email})`
    : `New subscriber: ${name} (${email})`;
  const html = `<p><strong>${isResub ? "Re-subscriber" : "New subscriber"}</strong></p>
<p>Name: ${name}<br>Email: ${email}<br>Time: ${new Date().toISOString()}</p>`;

  context.waitUntil(
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Jarin's Blog <newsletter@jarinwadiwalla.com>",
        to: [env.ADMIN_EMAIL],
        subject,
        html,
      }),
    }).catch((err) => console.error("Admin notification error:", err))
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const firstName = (body.firstName || "").trim();
    const lastName = (body.lastName || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const preferences = (body.preferences || "blog").trim();

    if (!firstName || !email) {
      return jsonResponse({ success: false, message: "First name and email are required." }, 400);
    }

    if (firstName.length > 100 || lastName.length > 100) {
      return jsonResponse({ success: false, message: "Name is too long." }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 320) {
      return jsonResponse({ success: false, message: "Please enter a valid email address." }, 400);
    }

    const existing = await env.SITE_DB.prepare(
      "SELECT * FROM subscribers WHERE email = ?"
    ).bind(email).first();

    if (existing) {
      if (existing.unsubscribed) {
        await env.SITE_DB.prepare(
          "UPDATE subscribers SET unsubscribed=0, unsubscribedAt='', resubscribedAt=?, preferences=? WHERE email=?"
        ).bind(new Date().toISOString(), preferences, email).run();

        if (env.RESEND_API_KEY) {
          const unsubSecret = env.UNSUBSCRIBE_SECRET || "default-secret";
          const token = await hmacToken(email, unsubSecret);
          const unsubUrl = `https://jarinwadiwalla.com/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

          context.waitUntil(
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "Jarin <newsletter@jarinwadiwalla.com>",
                to: [email],
                subject: "Welcome back!",
                html: buildWelcomeEmail(existing.firstName || firstName, unsubUrl),
                headers: {
                  "List-Unsubscribe": `<${unsubUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }),
            }).catch((err) => console.error("Welcome-back email error:", err))
          );
        }

        sendAdminNotification(env, context, { firstName: existing.firstName || firstName, lastName: existing.lastName || lastName, email, isResub: true });

        return jsonResponse({ success: true, message: "Welcome back! You've been re-subscribed." });
      }

      return jsonResponse({ success: true, message: "You're already subscribed!" });
    }

    const subscribedAt = new Date().toISOString();
    await env.SITE_DB.prepare(
      "INSERT INTO subscribers (email, firstName, lastName, subscribedAt, preferences) VALUES (?, ?, ?, ?, ?)"
    ).bind(email, firstName, lastName, subscribedAt, preferences).run();

    // Get count for response
    const countRow = await env.SITE_DB.prepare(
      "SELECT COUNT(*) as count FROM subscribers"
    ).first();
    const newCount = countRow?.count || 0;

    if (env.RESEND_API_KEY) {
      const unsubSecret = env.UNSUBSCRIBE_SECRET || "default-secret";
      const token = await hmacToken(email, unsubSecret);
      const unsubUrl = `https://jarinwadiwalla.com/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

      context.waitUntil(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Jarin <newsletter@jarinwadiwalla.com>",
            to: [email],
            subject: "Welcome to Jarin's Blog!",
            html: buildWelcomeEmail(firstName, unsubUrl),
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
        }).then((res) => {
          if (!res.ok) console.error(`Welcome email failed: ${res.status}`);
        }).catch((err) => {
          console.error("Welcome email error:", err);
        })
      );
    }

    sendAdminNotification(env, context, { firstName, lastName, email, isResub: false });

    return jsonResponse({ success: true, message: "You're subscribed! Check your inbox for a welcome email.", count: newCount });
  } catch (err) {
    return jsonResponse({ success: false, message: "Something went wrong. Please try again." }, 500);
  }
}
