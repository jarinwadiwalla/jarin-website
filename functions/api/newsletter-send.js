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

import { jsonResponse, errorResponse } from '../lib/response.js';

const SITE_ORIGIN = 'https://jarinwadiwalla.com';

// Email clients can't resolve site-relative URLs in HTML emails — there's
// no document base to anchor against. Rewrite any <img src="/..."> (or
// <a href="/...">) to absolute URLs so images load and links work.
function absolutizeUrls(html) {
  if (!html) return html;
  return html
    .replace(/(<img\b[^>]*\bsrc=)(["'])(\/(?!\/)[^"']*)\2/gi,
      (_, pre, q, path) => `${pre}${q}${SITE_ORIGIN}${path}${q}`)
    .replace(/(<a\b[^>]*\bhref=)(["'])(\/(?!\/)[^"']*)\2/gi,
      (_, pre, q, path) => `${pre}${q}${SITE_ORIGIN}${path}${q}`);
}

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
    return jsonResponse({ success: false, message: "RESEND_API_KEY not configured." }, 500);
  }

  try {
    const body = await request.json();
    const { subject, htmlBody, textBody, testEmails, contentType } = body;

    if (!subject || !htmlBody) {
      return jsonResponse({ success: false, message: "Subject and htmlBody are required." }, 400);
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

      // Filter by content type preference if specified
      const type = contentType || 'all';
      recipients = type === 'all'
        ? results
        : results.filter(s => (s.preferences || 'blog').split(',').includes(type));

      if (recipients.length === 0) {
        return jsonResponse({ success: false, message: "No matching subscribers found." }, 400);
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
      personalizedHtml = absolutizeUrls(personalizedHtml);

      // Cross-promotion: invite subscribers to the other content type
      const prefs = (sub.preferences || 'blog').split(',');
      const sendingType = contentType || 'all';
      let crossPromo = '';
      if (sendingType === 'blog' && !prefs.includes('poetry')) {
        crossPromo = `<div style="background:#f5f0ff;border:1px solid #e5ddf5;border-radius:8px;padding:16px;margin:16px 0;text-align:center;font-size:14px;color:#4a1942;">
          I also share poetry. <a href="${unsubUrl}" style="color:#6b2fa0;font-weight:600;">Update your preferences</a> to receive new poems too.
        </div>`;
      } else if (sendingType === 'poetry' && !prefs.includes('blog')) {
        crossPromo = `<div style="background:#f0f7f2;border:1px solid #d5e8da;border-radius:8px;padding:16px;margin:16px 0;text-align:center;font-size:14px;color:#1a3d2a;">
          I also write blog posts about books, languages, and yoga. <a href="${unsubUrl}" style="color:#2D5F3F;font-weight:600;">Update your preferences</a> to receive new posts too.
        </div>`;
      }
      if (crossPromo) {
        // Insert before the closing </table> or append before unsubscribe footer
        const lastTdClose = personalizedHtml.lastIndexOf('</td></tr>\n</table>');
        if (lastTdClose > -1) {
          personalizedHtml = personalizedHtml.slice(0, lastTdClose) + crossPromo + personalizedHtml.slice(lastTdClose);
        } else {
          personalizedHtml = personalizedHtml.replace('</body>', crossPromo + '</body>');
        }
      }

      if (!personalizedHtml.includes(unsubUrl)) {
        personalizedHtml += `<p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">You're receiving this because you subscribed at jarinwadiwalla.com. <a href="${unsubUrl}" style="color:#999;">Unsubscribe</a></p>`;
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

    return jsonResponse({
      success: true,
      message: `Sent ${totalSent} of ${recipients.length} emails.`,
      totalSent,
      totalRecipients: recipients.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return jsonResponse({ success: false, message: "Failed to send newsletter: " + err.message }, 500);
  }
}
