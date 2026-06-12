/**
 * Cloudflare Pages Function — /api/blog-comments
 *
 * Full comment system: public read/submit, admin moderation.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - TURNSTILE_SECRET_KEY (secret)
 *   - RESEND_API_KEY (secret)
 *   - ADMIN_EMAIL (secret)
 */

import { jsonResponse, errorResponse } from "../lib/response.js";

// --- Lightweight MD5 (for Gravatar email hashing) ---
function md5(str) {
  function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const words = [];
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) << 3);
  words[len >> 2] |= 0x80 << ((len % 4) << 3);
  const bitLen = len * 8;
  const totalWords = (((len + 8) >>> 6) + 1) * 16;
  for (let i = words.length; i < totalWords; i++) words[i] = 0;
  words[totalWords - 2] = bitLen & 0xffffffff;
  words[totalWords - 1] = Math.floor(bitLen / 0x100000000);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < totalWords; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = md5ff(a,b,c,d,words[i],7,-680876936);d=md5ff(d,a,b,c,words[i+1],12,-389564586);c=md5ff(c,d,a,b,words[i+2],17,606105819);b=md5ff(b,c,d,a,words[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,words[i+4],7,-176418897);d=md5ff(d,a,b,c,words[i+5],12,1200080426);c=md5ff(c,d,a,b,words[i+6],17,-1473231341);b=md5ff(b,c,d,a,words[i+7],22,-45705983);
    a=md5ff(a,b,c,d,words[i+8],7,1770035416);d=md5ff(d,a,b,c,words[i+9],12,-1958414417);c=md5ff(c,d,a,b,words[i+10],17,-42063);b=md5ff(b,c,d,a,words[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,words[i+12],7,1804603682);d=md5ff(d,a,b,c,words[i+13],12,-40341101);c=md5ff(c,d,a,b,words[i+14],17,-1502002290);b=md5ff(b,c,d,a,words[i+15],22,1236535329);
    a=md5gg(a,b,c,d,words[i+1],5,-165796510);d=md5gg(d,a,b,c,words[i+6],9,-1069501632);c=md5gg(c,d,a,b,words[i+11],14,643717713);b=md5gg(b,c,d,a,words[i],20,-373897302);
    a=md5gg(a,b,c,d,words[i+5],5,-701558691);d=md5gg(d,a,b,c,words[i+10],9,38016083);c=md5gg(c,d,a,b,words[i+15],14,-660478335);b=md5gg(b,c,d,a,words[i+4],20,-405537848);
    a=md5gg(a,b,c,d,words[i+9],5,568446438);d=md5gg(d,a,b,c,words[i+14],9,-1019803690);c=md5gg(c,d,a,b,words[i+3],14,-187363961);b=md5gg(b,c,d,a,words[i+8],20,1163531501);
    a=md5gg(a,b,c,d,words[i+13],5,-1444681467);d=md5gg(d,a,b,c,words[i+2],9,-51403784);c=md5gg(c,d,a,b,words[i+7],14,1735328473);b=md5gg(b,c,d,a,words[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,words[i+5],4,-378558);d=md5hh(d,a,b,c,words[i+8],11,-2022574463);c=md5hh(c,d,a,b,words[i+11],16,1839030562);b=md5hh(b,c,d,a,words[i+14],23,-35309556);
    a=md5hh(a,b,c,d,words[i+1],4,-1530992060);d=md5hh(d,a,b,c,words[i+4],11,1272893353);c=md5hh(c,d,a,b,words[i+7],16,-155497632);b=md5hh(b,c,d,a,words[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,words[i+13],4,681279174);d=md5hh(d,a,b,c,words[i],11,-358537222);c=md5hh(c,d,a,b,words[i+3],16,-722521979);b=md5hh(b,c,d,a,words[i+6],23,76029189);
    a=md5hh(a,b,c,d,words[i+9],4,-640364487);d=md5hh(d,a,b,c,words[i+12],11,-421815835);c=md5hh(c,d,a,b,words[i+15],16,530742520);b=md5hh(b,c,d,a,words[i+2],23,-995338651);
    a=md5ii(a,b,c,d,words[i],6,-198630844);d=md5ii(d,a,b,c,words[i+7],10,1126891415);c=md5ii(c,d,a,b,words[i+14],15,-1416354905);b=md5ii(b,c,d,a,words[i+5],21,-57434055);
    a=md5ii(a,b,c,d,words[i+12],6,1700485571);d=md5ii(d,a,b,c,words[i+3],10,-1894986606);c=md5ii(c,d,a,b,words[i+10],15,-1051523);b=md5ii(b,c,d,a,words[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,words[i+8],6,1873313359);d=md5ii(d,a,b,c,words[i+15],10,-30611744);c=md5ii(c,d,a,b,words[i+6],15,-1560198380);b=md5ii(b,c,d,a,words[i+13],21,1309151649);
    a=md5ii(a,b,c,d,words[i+4],6,-145523070);d=md5ii(d,a,b,c,words[i+11],10,-1120210379);c=md5ii(c,d,a,b,words[i+2],15,718787259);b=md5ii(b,c,d,a,words[i+9],21,-343485551);
    a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
  }

  const hex = (n) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((n >> (i * 8 + 4)) & 0xf).toString(16) + ((n >> (i * 8)) & 0xf).toString(16);
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// --- Helpers ---
function generateId() {
  const rand = Math.random().toString(36).substring(2, 6);
  return `${Date.now()}-${rand}`;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// --- GET ---
export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug");
  const admin = url.searchParams.get("admin");

  if (admin === "1") {
    return getAdminComments(env, url.searchParams);
  }

  if (!slug) return errorResponse("slug is required", 400);

  const { results } = await env.SITE_DB.prepare(
    "SELECT id, slug, parent_id, author_name, email_hash, body, createdAt FROM blog_comments WHERE slug = ? AND status = 'approved' ORDER BY createdAt ASC"
  ).bind(slug).all();

  // Thread into tree: top-level comments with replies array
  const topLevel = [];
  const replyMap = {};
  for (const c of results) {
    if (!c.parent_id) {
      c.replies = [];
      topLevel.push(c);
      replyMap[c.id] = c;
    }
  }
  for (const c of results) {
    if (c.parent_id && replyMap[c.parent_id]) {
      replyMap[c.parent_id].replies.push(c);
    }
  }

  return jsonResponse({ comments: topLevel, count: results.length });
}

async function getAdminComments(env, params) {
  const status = params.get("status");
  const page = parseInt(params.get("page")) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = "SELECT * FROM blog_comments";
  const binds = [];
  if (status) {
    query += " WHERE status = ?";
    binds.push(status);
  }
  query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const { results } = await env.SITE_DB.prepare(query).bind(...binds).all();
  const { results: countResults } = await env.SITE_DB.prepare(
    "SELECT COUNT(*) as cnt FROM blog_comments WHERE status = 'pending'"
  ).all();

  return jsonResponse({
    comments: results,
    pending_count: countResults[0]?.cnt || 0,
  });
}

// --- POST ---
export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const slug = (body.slug || "").trim();
  const parentId = (body.parent_id || "").trim();
  const authorName = (body.author_name || "").trim();
  const authorEmail = (body.author_email || "").trim().toLowerCase();
  const commentBody = (body.body || "").trim();
  const notifyReplies = body.notify_replies ? 1 : 0;
  const turnstileToken = body.turnstile_token || "";

  // Validate
  if (!slug || slug.length > 200) return errorResponse("Invalid slug", 400);
  if (!authorName || authorName.length > 100) return errorResponse("Name is required (max 100 chars)", 400);
  if (!authorEmail || !EMAIL_RE.test(authorEmail) || authorEmail.length > 320) return errorResponse("Valid email is required", 400);
  if (!commentBody || commentBody.length > 5000) return errorResponse("Comment is required (max 5000 chars)", 400);

  // Verify Turnstile
  if (env.TURNSTILE_SECRET_KEY) {
    const tsRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get("CF-Connecting-IP"),
      }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) return errorResponse("CAPTCHA verification failed", 403);
  }

  // Rate limit: max 3 comments per IP per 10 minutes
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { results: rateResults } = await env.SITE_DB.prepare(
    "SELECT COUNT(*) as cnt FROM blog_comments WHERE ip_address = ? AND createdAt > ?"
  ).bind(ip, tenMinAgo).all();
  if ((rateResults[0]?.cnt || 0) >= 3) return errorResponse("Too many comments. Please wait a few minutes.", 429);

  // Enforce 1-level nesting
  if (parentId) {
    const parent = await env.SITE_DB.prepare(
      "SELECT id, parent_id FROM blog_comments WHERE id = ? AND slug = ?"
    ).bind(parentId, slug).first();
    if (!parent) return errorResponse("Parent comment not found", 400);
    if (parent.parent_id) return errorResponse("Cannot reply to a reply", 400);
  }

  const now = new Date().toISOString();
  const id = generateId();
  const emailHash = md5(authorEmail);
  const ua = (request.headers.get("User-Agent") || "").substring(0, 500);

  await env.SITE_DB.prepare(
    `INSERT INTO blog_comments (id, slug, parent_id, author_name, author_email, email_hash, body, status, notify_replies, ip_address, user_agent, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).bind(id, slug, parentId, authorName, authorEmail, emailHash, commentBody, notifyReplies, ip, ua, now, now).run();

  // Notify admin via email (fire-and-forget)
  if (env.RESEND_API_KEY && env.ADMIN_EMAIL) {
    context.waitUntil(sendAdminNotification(env, { id, slug, authorName, authorEmail, commentBody }));
  }

  return jsonResponse({
    success: true,
    comment: { id, status: "pending" },
    message: "Your comment has been submitted and is pending moderation.",
  }, 201);
}

// --- PUT (admin: approve/reject) ---
export async function onRequestPut(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const id = (body.id || "").trim();
  const status = (body.status || "").trim();
  if (!id) return errorResponse("id is required", 400);
  if (!["approved", "rejected"].includes(status)) return errorResponse("status must be approved or rejected", 400);

  const now = new Date().toISOString();
  await env.SITE_DB.prepare(
    "UPDATE blog_comments SET status = ?, updatedAt = ? WHERE id = ?"
  ).bind(status, now, id).run();

  // If approving a reply, notify parent commenter
  if (status === "approved" && env.RESEND_API_KEY) {
    context.waitUntil(sendReplyNotification(env, id));
  }

  return jsonResponse({ ok: true });
}

// --- DELETE (admin) ---
export async function onRequestDelete(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch { return errorResponse("Invalid JSON", 400); }

  const id = (body.id || "").trim();
  if (!id) return errorResponse("id is required", 400);

  // Delete the comment and any replies to it
  await env.SITE_DB.batch([
    env.SITE_DB.prepare("DELETE FROM blog_comments WHERE id = ?").bind(id),
    env.SITE_DB.prepare("DELETE FROM blog_comments WHERE parent_id = ?").bind(id),
  ]);

  return jsonResponse({ ok: true });
}

// --- Email helpers ---
async function sendAdminNotification(env, { id, slug, authorName, authorEmail, commentBody }) {
  try {
    const preview = commentBody.length > 300 ? commentBody.substring(0, 300) + "..." : commentBody;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Blog Comments <newsletter@jarinwadiwalla.com>",
        to: [env.ADMIN_EMAIL],
        subject: `New comment on "${slug}" by ${authorName}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a3d2a;">New Blog Comment</h2>
          <p><strong>Post:</strong> <a href="https://jarinwadiwalla.com/blog/${escapeHtml(slug)}/">${escapeHtml(slug)}</a></p>
          <p><strong>Author:</strong> ${escapeHtml(authorName)} (${escapeHtml(authorEmail)})</p>
          <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0;white-space:pre-wrap;">${escapeHtml(preview)}</p>
          </div>
          <p><a href="https://jarinwadiwalla.com/guru/#comments" style="display:inline-block;padding:10px 20px;background:#2D5F3F;color:white;border-radius:8px;text-decoration:none;">Review in Dashboard</a></p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error("Failed to send admin notification:", e);
  }
}

async function sendReplyNotification(env, replyId) {
  try {
    const reply = await env.SITE_DB.prepare(
      "SELECT * FROM blog_comments WHERE id = ?"
    ).bind(replyId).first();
    if (!reply || !reply.parent_id) return;

    const parent = await env.SITE_DB.prepare(
      "SELECT * FROM blog_comments WHERE id = ?"
    ).bind(reply.parent_id).first();
    if (!parent || !parent.notify_replies || !parent.author_email) return;

    const preview = reply.body.length > 300 ? reply.body.substring(0, 300) + "..." : reply.body;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Jarin's Blog <newsletter@jarinwadiwalla.com>",
        to: [parent.author_email],
        subject: `Someone replied to your comment on "${reply.slug}"`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a3d2a;">New Reply to Your Comment</h2>
          <p>${escapeHtml(reply.author_name)} replied to your comment on <a href="https://jarinwadiwalla.com/blog/${escapeHtml(reply.slug)}/#blog-comments">${escapeHtml(reply.slug)}</a>:</p>
          <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0;white-space:pre-wrap;">${escapeHtml(preview)}</p>
          </div>
          <p><a href="https://jarinwadiwalla.com/blog/${escapeHtml(reply.slug)}/#blog-comments" style="display:inline-block;padding:10px 20px;background:#2D5F3F;color:white;border-radius:8px;text-decoration:none;">View Comment</a></p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error("Failed to send reply notification:", e);
  }
}
