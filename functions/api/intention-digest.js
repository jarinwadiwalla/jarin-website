/**
 * Cloudflare Pages Function — /api/intention-digest
 *
 * Daily morning email digest for the personal Intention system.
 *
 * Actions (all POST):
 *   - action: "preview"  → returns the rendered HTML without sending (for the Settings preview)
 *   - action: "send"     → renders + sends to the configured recipient via Resend, always
 *   - action: "check"    → cron entry point — sends iff:
 *                           (a) enabled is true,
 *                           (b) current UTC hour === configured hour (with optional offset),
 *                           (c) lastSentAt is not today already (idempotency).
 *
 * Settings (stored in settings.data.intentionDigest):
 *   { enabled, hour, email, lastSentAt }
 *   - hour is interpreted as UTC for simplicity (Cloudflare runs in UTC; the user
 *     picks a UTC hour that maps to their local morning). Future slice could add tz.
 *
 * Environment bindings required:
 *   - SITE_DB        (D1)
 *   - RESEND_API_KEY (secret)
 *
 * See docs/intention.md for the product plan.
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const FROM_ADDR = "Jarin <newsletter@jarinwadiwalla.com>";
const SITE_ORIGIN = 'https://jarinwadiwalla.com';

// ──────────────── date helpers (mirror intention.js) ────────────────

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function currentWeekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function currentQuarterStart() {
  const d = new Date();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(d.getUTCFullYear(), m - (m % 3), 1)).toISOString().slice(0, 10);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ──────────────── settings ────────────────

function parseData(row) {
  try { return JSON.parse(row?.data || '{}'); } catch { return {}; }
}

async function readDigestConfig(env) {
  const row = await env.SITE_DB.prepare(
    "SELECT data FROM settings WHERE id = 'main'"
  ).first();
  const data = parseData(row);
  const cfg = data.intentionDigest || {};
  return {
    enabled: !!cfg.enabled,
    hour: Number.isInteger(cfg.hour) ? cfg.hour : 13,   // 13 UTC ≈ 6am Pacific / 8am Eastern
    email: (cfg.email || '').trim(),
    lastSentAt: cfg.lastSentAt || '',
  };
}

async function writeDigestLastSent(env, when) {
  const row = await env.SITE_DB.prepare(
    "SELECT data FROM settings WHERE id = 'main'"
  ).first();
  const data = parseData(row);
  data.intentionDigest = { ...(data.intentionDigest || {}), lastSentAt: when };
  const now = new Date().toISOString();
  if (row) {
    await env.SITE_DB.prepare(
      "UPDATE settings SET data = ?, updatedAt = ? WHERE id = 'main'"
    ).bind(JSON.stringify(data), now).run();
  } else {
    await env.SITE_DB.prepare(
      "INSERT INTO settings (id, languages, calendarCategories, data, updatedAt) VALUES ('main', '{}', '{}', ?, ?)"
    ).bind(JSON.stringify(data), now).run();
  }
}

// ──────────────── digest data fetch ────────────────

async function loadDigestData(env) {
  const today = todayDate();
  const yesterday = yesterdayDate();
  const weekStart = currentWeekStart();
  const quarterStart = currentQuarterStart();

  const [venturesRes, goalsRes, todayCheckinsRes, yesterdayCheckinsRes, todosRes] = await Promise.all([
    env.SITE_DB.prepare(
      "SELECT id, name, color, icon FROM ventures WHERE status = 'active'"
    ).all(),
    env.SITE_DB.prepare(
      "SELECT * FROM goals WHERE status = 'open' ORDER BY horizon ASC, sortOrder ASC"
    ).all(),
    env.SITE_DB.prepare(
      "SELECT goalId FROM goal_checkins WHERE date = ?"
    ).bind(today).all(),
    env.SITE_DB.prepare(
      "SELECT goalId FROM goal_checkins WHERE date = ?"
    ).bind(yesterday).all(),
    env.SITE_DB.prepare(
      "SELECT * FROM todos WHERE completed = 0"
    ).all(),
  ]);

  return {
    today,
    yesterday,
    weekStart,
    quarterStart,
    ventures: venturesRes.results,
    goals: goalsRes.results,
    todayCheckinGoalIds: new Set(todayCheckinsRes.results.map(r => r.goalId)),
    yesterdayCheckinGoalIds: new Set(yesterdayCheckinsRes.results.map(r => r.goalId)),
    todos: todosRes.results,
  };
}

// ──────────────── render ────────────────

function ventureChip(v) {
  if (!v) return '';
  const color = v.color || '#3b82f6';
  const label = (v.icon ? v.icon + ' ' : '') + v.name;
  return `<span style="background:${color}22;color:${color};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500;">${esc(label)}</span>`;
}

function renderGoalRow(g, ventureById, isChecked) {
  const v = ventureById.get(g.ventureId);
  const check = isChecked ? '✓ ' : '○ ';
  const checkColor = isChecked ? '#22c55e' : '#9ca3af';
  return `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
      <span style="color:${checkColor};font-weight:700;flex-shrink:0;width:18px;">${check}</span>
      <div style="flex:1;">
        <span style="color:#111827;${isChecked ? 'text-decoration:line-through;color:#6b7280;' : ''}">${esc(g.title)}</span>
        ${v ? ` ${ventureChip(v)}` : ''}
      </div>
    </div>`;
}

function renderTodoRow(t, ventureById) {
  const v = ventureById.get(t.ventureId);
  const prio = t.priority || 0;
  const prioMark = prio >= 3 ? '<span style="color:#ef4444;font-weight:700;">!!!</span> ' :
                   prio === 2 ? '<span style="color:#f59e0b;font-weight:700;">!!</span> ' :
                   prio === 1 ? '<span style="color:#3b82f6;font-weight:700;">!</span> ' : '';
  const today = todayDate();
  const overdue = t.dueDate && t.dueDate < today;
  const due = t.dueDate
    ? `<span style="color:${overdue ? '#ef4444' : '#6b7280'};font-size:12px;font-weight:${overdue ? '600' : '400'};margin-left:8px;">due ${esc(t.dueDate)}</span>`
    : '';
  return `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
      <span style="flex-shrink:0;width:18px;">${prioMark || '·'}</span>
      <div style="flex:1;">
        <span style="color:#111827;">${esc(t.text)}</span>
        ${v ? ` ${ventureChip(v)}` : ''}
        ${due}
      </div>
    </div>`;
}

function section(title, bodyHtml, emptyMsg) {
  return `
    <h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:24px 0 8px;">${esc(title)}</h2>
    ${bodyHtml || `<p style="color:#9ca3af;font-size:13px;margin:0;">${esc(emptyMsg || 'Nothing here.')}</p>`}
  `;
}

function renderDigestHtml(data) {
  const ventureById = new Map(data.ventures.map(v => [v.id, v]));

  const dailyGoals = data.goals.filter(g => g.horizon === 'daily');
  const weeklyGoals = data.goals.filter(g => g.horizon === 'weekly');
  const quarterlyGoals = data.goals.filter(g => g.horizon === 'quarterly');

  const missedYesterday = dailyGoals.filter(g =>
    !data.yesterdayCheckinGoalIds.has(g.id) &&
    g.createdAt && g.createdAt.slice(0, 10) <= data.yesterday
  );

  const sortedTodos = [...data.todos].sort((a, b) => {
    const pa = a.priority || 0, pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    const da = a.dueDate || '9999-12-31';
    const db = b.dueDate || '9999-12-31';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const top3Todos = sortedTodos.slice(0, 3);

  const dailyHtml = dailyGoals.length
    ? dailyGoals.map(g => renderGoalRow(g, ventureById, data.todayCheckinGoalIds.has(g.id))).join('')
    : '';
  const weeklyHtml = weeklyGoals.length
    ? weeklyGoals.map(g => renderGoalRow(g, ventureById, false)).join('')
    : '';
  const quarterlyHtml = quarterlyGoals.length
    ? quarterlyGoals.map(g => renderGoalRow(g, ventureById, false)).join('')
    : '';
  const todosHtml = top3Todos.length
    ? top3Todos.map(t => renderTodoRow(t, ventureById)).join('')
    : '';
  const missedHtml = missedYesterday.length
    ? missedYesterday.map(g => renderGoalRow(g, ventureById, false)).join('')
    : '';

  const headerDate = new Date(data.today + 'T00:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Intention digest — ${esc(data.today)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:white;border-radius:8px;border:1px solid #e5e7eb;max-width:600px;width:100%;">
        <tr><td style="padding:24px 28px;">
          <p style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;font-weight:600;">Intention digest</p>
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px;font-weight:700;">${esc(headerDate)}</h1>
          <p style="color:#6b7280;font-size:13px;margin:0;">A short orientation for your day.</p>

          ${section('Today — Daily Goals', dailyHtml, 'No daily goals set. Add some on the Intention tab.')}
          ${section('This Week — Weekly Goals', weeklyHtml, 'No weekly goals set. Run the Weekly Review on Sunday.')}
          ${section('Top 3 To-Dos', todosHtml, 'No open to-dos right now.')}
          ${section('Yesterday — Missed Daily Goals', missedHtml, 'Nothing missed yesterday. Nice.')}
          ${section('Strategic Anchors — Quarterly Goals', quarterlyHtml, 'No quarterly goals set.')}

          <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
            Sent by your /guru → Intention digest. Open <a href="${SITE_ORIGIN}/guru" style="color:#3b82f6;">the dashboard</a> to update anything.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ──────────────── send via Resend ────────────────

async function sendDigest(env, recipient, html, subject) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!recipient) {
    return { ok: false, error: 'No recipient configured' };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDR,
      to: [recipient],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${errBody}` };
  }
  return { ok: true };
}

// ──────────────── routes ────────────────

export async function onRequestGet(context) {
  // Convenience: GET returns the rendered HTML (same as preview) so the user
  // can open /api/intention-digest in a browser to eyeball formatting.
  try {
    const data = await loadDigestData(context.env);
    const html = renderDigestHtml(data);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    return errorResponse('Failed to render digest.', 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const action = body.action || 'preview';

    if (action === 'preview') {
      const data = await loadDigestData(context.env);
      const html = renderDigestHtml(data);
      return jsonResponse({ ok: true, html, today: data.today });
    }

    if (action === 'send') {
      // Manual send — bypasses time check, used by the Settings UI's "Send now" button.
      const cfg = await readDigestConfig(context.env);
      const recipient = (body.email || cfg.email || '').trim();
      if (!recipient) return errorResponse('No recipient — set one in Settings.', 400);

      const data = await loadDigestData(context.env);
      const html = renderDigestHtml(data);
      const subject = `Intention — ${data.today}`;
      const sent = await sendDigest(context.env, recipient, html, subject);
      if (!sent.ok) return errorResponse(sent.error, 500);

      await writeDigestLastSent(context.env, new Date().toISOString());
      return jsonResponse({ ok: true, sent: true, to: recipient });
    }

    if (action === 'check') {
      // Cron entry point. External cron hits this hourly; we decide whether to send.
      const cfg = await readDigestConfig(context.env);
      if (!cfg.enabled) return jsonResponse({ ok: true, skipped: 'disabled' });
      if (!cfg.email) return jsonResponse({ ok: true, skipped: 'no-recipient' });

      const nowHourUTC = new Date().getUTCHours();
      if (nowHourUTC !== cfg.hour) {
        return jsonResponse({ ok: true, skipped: 'not-the-hour', nowHourUTC, configured: cfg.hour });
      }

      // Idempotency: don't send twice in one day even if cron fires multiple times in the hour.
      const today = todayDate();
      const lastSentDay = (cfg.lastSentAt || '').slice(0, 10);
      if (lastSentDay === today) {
        return jsonResponse({ ok: true, skipped: 'already-sent-today', lastSentAt: cfg.lastSentAt });
      }

      const data = await loadDigestData(context.env);
      const html = renderDigestHtml(data);
      const subject = `Intention — ${data.today}`;
      const sent = await sendDigest(context.env, cfg.email, html, subject);
      if (!sent.ok) return errorResponse(sent.error, 500);

      await writeDigestLastSent(context.env, new Date().toISOString());
      return jsonResponse({ ok: true, sent: true, to: cfg.email });
    }

    return errorResponse('Unknown action: ' + action, 400);
  } catch (err) {
    return errorResponse('Digest failed: ' + (err?.message || 'unknown'), 500);
  }
}
