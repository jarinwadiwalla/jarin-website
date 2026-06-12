/**
 * Cloudflare Pages Function — /api/goldlist-email
 *
 * POST → Select up to 10 due/random goldlist entries, build a styled
 *         vocabulary review email, and send it via Resend.
 * GET  → Preview the email HTML without sending.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - RESEND_API_KEY (secret — Resend API key)
 *   - ADMIN_EMAIL (secret — recipient address)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';
import { getReviewIntervalMs, escapeHtml } from '../lib/utils.js';

const MAX_REVIEW_WORDS = 10;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function rowToEntry(row) {
  return {
    ...row,
    learned: !!row.learned,
    examples: JSON.parse(row.examples || '[]'),
    selfRatings: JSON.parse(row.selfRatings || '[]'),
    lastReviewedAt: row.lastReviewedAt || null,
    learnedAt: row.learnedAt || null,
  };
}

async function getAllGoldlistEntries(db) {
  const { results } = await db.prepare(
    "SELECT * FROM goldlist ORDER BY createdAt DESC"
  ).all();
  return results.map(rowToEntry);
}

function selectReviewEntries(entries) {
  const now = Date.now();

  // Only consider active (not learned) entries
  const active = entries.filter((e) => !e.learned);

  // Entries that are due for review (14+ days since last review or creation)
  const due = active.filter((e) => {
    const refDate = new Date(e.lastReviewedAt || e.createdAt).getTime();
    return (now - refDate) >= getReviewIntervalMs(e.distillation);
  });

  if (due.length > 0) {
    // Sort oldest-reviewed first so the most overdue words come first
    due.sort((a, b) => {
      const aRef = new Date(a.lastReviewedAt || a.createdAt).getTime();
      const bRef = new Date(b.lastReviewedAt || b.createdAt).getTime();
      return aRef - bRef;
    });
    return due.slice(0, MAX_REVIEW_WORDS);
  }

  // No due entries — pick random active entries
  if (active.length === 0) return [];
  const shuffled = active.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, MAX_REVIEW_WORDS);
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildWordCard(entry) {
  const romanization = entry.romanization
    ? `<p style="font-size:15px;color:#6b7280;font-style:italic;margin:4px 0 0;">${escapeHtml(entry.romanization)}</p>`
    : "";

  const translation = entry.translation
    ? `<p style="font-size:15px;color:#9ca3af;margin:8px 0 0;">${escapeHtml(entry.translation)}</p>`
    : "";

  const example = entry.example
    ? `<p style="font-size:14px;color:#6b7280;margin:10px 0 0;padding:8px 12px;background:#f3f4f6;border-radius:6px;border-left:3px solid #2D5F3F;">${escapeHtml(entry.example)}</p>`
    : "";

  const notes = entry.notes
    ? `<p style="font-size:13px;color:#9ca3af;margin:8px 0 0;font-style:italic;">${escapeHtml(entry.notes)}</p>`
    : "";

  const tags = [];
  if (entry.language) tags.push(capitalize(entry.language));
  if (entry.category) tags.push(capitalize(entry.category));
  const tagHtml = tags.length > 0
    ? `<p style="margin:10px 0 0;">${tags.map((t) => `<span style="display:inline-block;font-size:11px;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:2px 8px;margin-right:6px;">${escapeHtml(t)}</span>`).join("")}</p>`
    : "";

  const distillation = entry.distillation
    ? `<span style="font-size:11px;color:#9ca3af;margin-left:8px;">Distillation ${entry.distillation}</span>`
    : "";

  return `<tr><td style="padding:16px 24px;border-bottom:1px solid #f3f4f6;">
    <p style="font-size:22px;font-weight:700;color:#1f2937;margin:0;">${escapeHtml(entry.word)}${distillation}</p>
    ${romanization}
    ${translation}
    ${example}
    ${notes}
    ${tagHtml}
  </td></tr>`;
}

function buildEmailHtml(entries, dateStr, isDueReview) {
  const subtitle = isDueReview
    ? `You have ${entries.length} word${entries.length === 1 ? "" : "s"} due for review today.`
    : `Here are ${entries.length} word${entries.length === 1 ? "" : "s"} from your active vocabulary to keep fresh.`;

  const wordCards = entries.map(buildWordCard).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:100%;">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1a3d2a,#2D5F3F);padding:32px;text-align:center;">
    <h1 style="color:#ffffff;font-size:22px;margin:0 0 4px;">Daily Vocabulary Review</h1>
    <p style="color:#a7c4b5;font-size:14px;margin:0;">${escapeHtml(dateStr)}</p>
  </td></tr>

  <!-- Subtitle -->
  <tr><td style="padding:24px 24px 8px;">
    <p style="font-size:15px;color:#6b7280;margin:0;line-height:1.5;">${subtitle}</p>
  </td></tr>

  <!-- Word cards -->
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${wordCards}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:24px;text-align:center;">
    <a href="https://jarinwadiwalla.com/vocabulary/" style="display:inline-block;padding:12px 28px;background:#2D5F3F;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Open Vocabulary Page</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="font-size:12px;color:#9ca3af;margin:0;">
      This is an automated vocabulary review email from
      <a href="https://jarinwadiwalla.com" style="color:#9ca3af;">jarinwadiwalla.com</a>.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                          */
/* ------------------------------------------------------------------ */

export async function onRequestPost(context) {
  const { env } = context;

  if (!env.RESEND_API_KEY) {
    return jsonResponse({ success: false, message: "RESEND_API_KEY not configured." }, 500);
  }

  if (!env.ADMIN_EMAIL) {
    return jsonResponse({ success: false, message: "ADMIN_EMAIL not configured." }, 500);
  }

  try {
    const allEntries = await getAllGoldlistEntries(env.SITE_DB);
    const active = allEntries.filter((e) => !e.learned);

    if (active.length === 0) {
      return jsonResponse({ success: false, message: "No active vocabulary entries found." }, 400);
    }

    const now = Date.now();
    const dueEntries = active.filter((e) => {
      const refDate = new Date(e.lastReviewedAt || e.createdAt).getTime();
      return (now - refDate) >= getReviewIntervalMs(e.distillation);
    });
    const isDueReview = dueEntries.length > 0;

    const selected = selectReviewEntries(allEntries);

    if (selected.length === 0) {
      return jsonResponse({ success: false, message: "No entries available for review." }, 400);
    }

    const dateStr = formatDate(new Date());
    const subject = `Your Daily Vocabulary Review — ${dateStr}`;
    const html = buildEmailHtml(selected, dateStr, isDueReview);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Jarin <newsletter@jarinwadiwalla.com>",
        to: [env.ADMIN_EMAIL],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return jsonResponse({ success: false, message: `Resend error: ${res.status} ${errBody}` }, 502);
    }

    const resData = await res.json();

    return jsonResponse({
      success: true,
      message: `Review email sent with ${selected.length} word${selected.length === 1 ? "" : "s"}.`,
      emailId: resData.id,
      wordCount: selected.length,
      isDueReview,
    });
  } catch (err) {
    return jsonResponse({ success: false, message: "Failed to send review email: " + err.message }, 500);
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const allEntries = await getAllGoldlistEntries(env.SITE_DB);
    const active = allEntries.filter((e) => !e.learned);

    if (active.length === 0) {
      return jsonResponse({ success: false, message: "No active vocabulary entries found." }, 400);
    }

    const now = Date.now();
    const dueEntries = active.filter((e) => {
      const refDate = new Date(e.lastReviewedAt || e.createdAt).getTime();
      return (now - refDate) >= getReviewIntervalMs(e.distillation);
    });
    const isDueReview = dueEntries.length > 0;

    const selected = selectReviewEntries(allEntries);

    if (selected.length === 0) {
      return jsonResponse({ success: false, message: "No entries available for review." }, 400);
    }

    const dateStr = formatDate(new Date());
    const html = buildEmailHtml(selected, dateStr, isDueReview);

    // HTML preview — not JSON, keep as raw Response
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    return jsonResponse({ success: false, message: "Failed to build preview: " + err.message }, 500);
  }
}
