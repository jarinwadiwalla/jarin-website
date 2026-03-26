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
<body style="margin:0;padding:0;background:#fdf8f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f6;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#3d2e26,#7d5f52);padding:32px;text-align:center;">
    <h1 style="color:#ffffff;font-size:22px;margin:12px 0 0;">Welcome!</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="font-size:16px;color:#3d2e26;line-height:1.6;margin:0 0 16px;">
      Hey ${firstName}!
    </p>
    <p style="font-size:16px;color:#5c4539;line-height:1.6;margin:0 0 16px;">
      Thanks for subscribing. You'll receive updates on sound healing, community circles, and wellness practices.
    </p>
    <p style="font-size:16px;color:#3d2e26;margin:0;">
      — Jarin
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #eaddd7;text-align:center;">
    <p style="font-size:12px;color:#bfa094;margin:0;">
      You're receiving this because you signed up at jarinwadiwalla.com.
      <a href="${unsubUrl}" style="color:#bfa094;">Unsubscribe</a>
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
        from: "Jarin Wadiwalla <newsletter@jarinwadiwalla.com>",
        to: [env.ADMIN_EMAIL],
        subject,
        html,
      }),
    }).catch((err) => console.error("Admin notification error:", err))
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();
    const firstName = (body.firstName || "").trim();
    const lastName = (body.lastName || "").trim();
    const email = (body.email || "").trim().toLowerCase();

    if (!firstName || !email) {
      return new Response(
        JSON.stringify({ success: false, message: "First name and email are required." }),
        { status: 400, headers }
      );
    }

    if (firstName.length > 100 || lastName.length > 100) {
      return new Response(
        JSON.stringify({ success: false, message: "Name is too long." }),
        { status: 400, headers }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 320) {
      return new Response(
        JSON.stringify({ success: false, message: "Please enter a valid email address." }),
        { status: 400, headers }
      );
    }

    const existing = await env.SITE_DB.prepare(
      "SELECT * FROM subscribers WHERE email = ?"
    ).bind(email).first();

    if (existing) {
      if (existing.unsubscribed) {
        await env.SITE_DB.prepare(
          "UPDATE subscribers SET unsubscribed=0, unsubscribedAt='', resubscribedAt=? WHERE email=?"
        ).bind(new Date().toISOString(), email).run();

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

        return new Response(
          JSON.stringify({ success: true, message: "Welcome back! You've been re-subscribed." }),
          { status: 200, headers }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "You're already subscribed!" }),
        { status: 200, headers }
      );
    }

    const subscribedAt = new Date().toISOString();
    await env.SITE_DB.prepare(
      "INSERT INTO subscribers (email, firstName, lastName, subscribedAt) VALUES (?, ?, ?, ?)"
    ).bind(email, firstName, lastName, subscribedAt).run();

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
            subject: "Welcome!",
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

    return new Response(
      JSON.stringify({ success: true, message: "You're subscribed! Check your inbox for a welcome email.", count: newCount }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "Something went wrong. Please try again." }),
      { status: 500, headers }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
