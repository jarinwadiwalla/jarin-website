/**
 * Cloudflare Pages Function — POST /api/newsletter-send
 *
 * Sends email campaigns via Resend to subscribers.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - RESEND_API_KEY (secret)
 *   - UNSUBSCRIBE_SECRET (secret)
 */

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

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

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ success: false, message: "RESEND_API_KEY not configured." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const { subject, htmlBody, textBody, testEmails } = body;

    if (!subject || !htmlBody) {
      return new Response(
        JSON.stringify({ success: false, message: "Subject and htmlBody are required." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const isTest = Array.isArray(testEmails) && testEmails.length > 0;
    let recipients;

    if (isTest) {
      recipients = testEmails.map((email) => ({
        email,
        firstName: "Test",
      }));
    } else {
      const { results } = await env.SITE_DB.prepare(
        "SELECT * FROM subscribers WHERE unsubscribed = 0"
      ).all();

      recipients = results;

      if (recipients.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "No active subscribers found." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }
    }

    const unsubSecret = env.UNSUBSCRIBE_SECRET || "default-secret";
    const emails = [];
    for (const sub of recipients) {
      const token = await hmacToken(sub.email, unsubSecret);
      const unsubUrl = `https://jarinwadiwalla.com/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${token}`;

      let personalizedHtml = htmlBody
        .replace(/\{\{firstName\}\}/g, sub.firstName || "")
        .replace(/\{\{lastName\}\}/g, sub.lastName || "")
        .replace(/\{\{email\}\}/g, sub.email)
        .replace(/\{\{unsubscribeUrl\}\}/g, unsubUrl);

      if (!personalizedHtml.includes(unsubUrl)) {
        personalizedHtml += `<p style="font-size:12px;color:#bfa094;margin-top:32px;border-top:1px solid #eaddd7;padding-top:16px;">You're receiving this because you subscribed at jarinwadiwalla.com. <a href="${unsubUrl}" style="color:#bfa094;">Unsubscribe</a></p>`;
      }

      let personalizedText = textBody || "";
      if (personalizedText) {
        personalizedText = personalizedText
          .replace(/\{\{firstName\}\}/g, sub.firstName || "")
          .replace(/\{\{lastName\}\}/g, sub.lastName || "")
          .replace(/\{\{email\}\}/g, sub.email)
          .replace(/\{\{unsubscribeUrl\}\}/g, unsubUrl);
      }

      emails.push({
        from: "Jarin <newsletter@jarinwadiwalla.com>",
        to: [sub.email],
        subject: subject,
        html: personalizedHtml,
        text: personalizedText || undefined,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    }

    let totalSent = 0;
    const errors = [];
    for (let i = 0; i < emails.length; i += 100) {
      const batch = emails.slice(i, i + 100);
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (res.ok) {
        totalSent += batch.length;
      } else {
        const errBody = await res.text();
        errors.push(`Batch ${Math.floor(i / 100) + 1}: ${res.status} ${errBody}`);
      }
    }

    if (!isTest) {
      const campaignId = `campaign-${Date.now()}`;
      await env.SITE_DB.prepare(
        "INSERT INTO campaigns (id, subject, sentAt, totalSent, totalRecipients, status, errors) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        campaignId, subject, new Date().toISOString(),
        totalSent, recipients.length,
        errors.length > 0 ? "partial" : "sent",
        errors.length > 0 ? JSON.stringify(errors) : '[]'
      ).run();
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${totalSent} of ${recipients.length} emails.`,
        totalSent,
        totalRecipients: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "Failed to send newsletter: " + err.message }),
      { status: 500, headers: CORS_HEADERS }
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
