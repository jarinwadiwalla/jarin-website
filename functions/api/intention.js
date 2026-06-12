/**
 * Cloudflare Pages Function — /api/intention
 *
 * GET    → list ventures, goals, recent checkins, today rollups, weekly rollups
 * POST   → save-venture | delete-venture | save-goal | delete-goal
 *          | archive-goals | checkin | uncheckin | reorder-ventures | reorder-goals
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *
 * See docs/intention.md for the product plan.
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
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
  const qStartMonth = m - (m % 3);
  return new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1))
    .toISOString().slice(0, 10);
}

function newId() {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
}

// Defensive: if `schema/intention.sql` somehow didn't fully apply (a half-run
// migration, a fresh D1, a column missing because someone manually fiddled),
// re-running these ALTERs in a try/catch makes the endpoint self-healing.
// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so each column is
// tried individually — the catch absorbs "duplicate column" errors as no-ops.
async function ensureColumns(db) {
  const stmts = [
    "ALTER TABLE habits                 ADD COLUMN ventureId TEXT DEFAULT ''",
    "ALTER TABLE habits                 ADD COLUMN goalId    TEXT DEFAULT ''",
    "ALTER TABLE todos                  ADD COLUMN ventureId TEXT DEFAULT ''",
    "ALTER TABLE todos                  ADD COLUMN goalId    TEXT DEFAULT ''",
    "ALTER TABLE todos                  ADD COLUMN priority  INTEGER DEFAULT 0",
    "ALTER TABLE todos                  ADD COLUMN dueDate   TEXT DEFAULT ''",
    "ALTER TABLE calendar_events        ADD COLUMN ventureId TEXT DEFAULT ''",
    "ALTER TABLE office_work_categories ADD COLUMN ventureId TEXT DEFAULT ''",
    // v4.6.7: goals gain a priority (0=none, 1=P1, 2=P2, 3=P3) and a CSV
    // ventureIds column for goals that span multiple ventures.
    "ALTER TABLE goals                  ADD COLUMN priority   INTEGER DEFAULT 0",
    "ALTER TABLE goals                  ADD COLUMN ventureIds TEXT DEFAULT ''",
    // v4.6.8: T-shirt size (S/M/L/XL), blocking relationships (CSV of goal IDs),
    // and per-session office-work ↔ goal linking.
    "ALTER TABLE goals                  ADD COLUMN size       TEXT DEFAULT ''",
    "ALTER TABLE goals                  ADD COLUMN blockedBy  TEXT DEFAULT ''",
    "ALTER TABLE office_work_sessions   ADD COLUMN goalId     TEXT DEFAULT ''",
    // v4.6.9 follow-up: office-work categories can span multiple ventures
    // (CSV string). The singular ventureId column stays in sync with the
    // first item for back-compat with older filters / rollups.
    "ALTER TABLE office_work_categories ADD COLUMN ventureIds TEXT DEFAULT ''",
    // v4.6.18: archived done-lane cards — hidden from Kanban/horizon views,
    // still status='done' so progress rollups keep counting them.
    "ALTER TABLE goals                  ADD COLUMN archived   INTEGER DEFAULT 0",
  ];
  for (const sql of stmts) {
    try { await db.prepare(sql).run(); } catch { /* column already exists or table missing — fine */ }
  }
  // v4.6.8: lanes expand status from open/done/dropped to
  // backlog/todo/working/waiting/done/dropped. Existing 'open' rows map to 'todo'.
  // Idempotent — after first run no rows match WHERE so this is a no-op.
  try { await db.prepare("UPDATE goals SET status = 'todo' WHERE status = 'open'").run(); } catch { /* table missing — fine */ }
  // Also make sure the three core tables exist (paranoid). CREATE IF NOT EXISTS
  // is a no-op when present; this is the only call site that can heal a fresh DB.
  const tables = [
    `CREATE TABLE IF NOT EXISTS ventures (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        color TEXT DEFAULT '#3b82f6', icon TEXT DEFAULT '', tagline TEXT DEFAULT '',
        status TEXT DEFAULT 'active', sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, ventureId TEXT DEFAULT '', horizon TEXT NOT NULL,
        title TEXT NOT NULL, why TEXT DEFAULT '',
        targetValue REAL DEFAULT 0, targetDate TEXT DEFAULT '',
        status TEXT DEFAULT 'open', parentGoalId TEXT DEFAULT '',
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS goal_checkins (
        id TEXT PRIMARY KEY, goalId TEXT NOT NULL, date TEXT NOT NULL,
        progressNote TEXT DEFAULT '', value REAL DEFAULT 0,
        createdAt TEXT NOT NULL)`,
  ];
  for (const sql of tables) {
    try { await db.prepare(sql).run(); } catch { /* table already exists */ }
  }
}

export async function onRequestGet(context) {
  try {
    await ensureColumns(context.env.SITE_DB);

    const url = new URL(context.request.url);
    const today = url.searchParams.get("today") || todayDate();
    const weekStart = currentWeekStart();
    const quarterStart = currentQuarterStart();
    const ninetyAgo = ninetyDaysAgo();

    const [venturesRes, goalsRes, checkinsRes, todayCheckinsRes, weekCheckinsRes, linkedHabitsRes, linkedTodosRes] = await Promise.all([
      context.env.SITE_DB.prepare(
        "SELECT * FROM ventures ORDER BY status ASC, sortOrder ASC, createdAt ASC"
      ).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM goals ORDER BY horizon ASC, sortOrder ASC, createdAt ASC"
      ).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM goal_checkins WHERE date >= ? ORDER BY date DESC, createdAt DESC"
      ).bind(ninetyAgo).all(),
      context.env.SITE_DB.prepare(
        "SELECT goalId, COUNT(*) as c, MAX(value) as v FROM goal_checkins WHERE date = ? GROUP BY goalId"
      ).bind(today).all(),
      context.env.SITE_DB.prepare(
        "SELECT goalId, COUNT(*) as c, SUM(value) as totalValue FROM goal_checkins WHERE date >= ? GROUP BY goalId"
      ).bind(weekStart).all(),
      // Habits linked to a goal — used to render "linked habits" on Intention tab goal cards.
      // Kept tiny: only the fields needed for cross-rendering.
      context.env.SITE_DB.prepare(
        "SELECT id, name, ventureId, goalId, currentStreak, lastCompletedDate, valueType, valueLabel FROM habits WHERE goalId IS NOT NULL AND goalId != '' AND status = 'active'"
      ).all(),
      // Todos linked to a goal — same purpose.
      context.env.SITE_DB.prepare(
        "SELECT id, text, completed, ventureId, goalId, priority, dueDate FROM todos WHERE goalId IS NOT NULL AND goalId != ''"
      ).all(),
    ]);

    return jsonResponse({
      ventures: venturesRes.results,
      goals: goalsRes.results,
      recentCheckins: checkinsRes.results,
      todayCheckins: todayCheckinsRes.results,
      weekCheckins: weekCheckinsRes.results,
      linkedHabits: linkedHabitsRes.results,
      linkedTodos: linkedTodosRes.results,
      periods: { today, weekStart, quarterStart },
    });
  } catch (err) {
    // Surface the actual underlying error so we can root-cause without redeploying.
    // Personal-admin context — no need to redact.
    return jsonResponse({
      error: "Failed to load intention data.",
      detail: err?.message || String(err),
      stack: err?.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : undefined,
    }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action || "save-venture";
    const now = new Date().toISOString();
    const today = body.today || todayDate();

    // ── Ventures ──

    if (action === "save-venture") {
      const { id, name, color, icon, tagline, status, sortOrder } = body;
      if (!name || !name.trim()) return errorResponse("Venture name is required.", 400);

      if (id) {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT * FROM ventures WHERE id = ?"
        ).bind(id).first();
        if (!existing) return errorResponse("Venture not found.", 404);

        await context.env.SITE_DB.prepare(
          "UPDATE ventures SET name=?, color=?, icon=?, tagline=?, status=?, sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(
          name.trim(),
          color || existing.color,
          icon !== undefined ? icon : existing.icon,
          tagline !== undefined ? tagline : existing.tagline,
          status || existing.status,
          sortOrder !== undefined ? sortOrder : existing.sortOrder,
          now,
          id
        ).run();
        return jsonResponse({ ok: true, id });
      }

      const ventureId = newId();
      let order = sortOrder;
      if (order === undefined || order === null) {
        const maxRow = await context.env.SITE_DB.prepare(
          "SELECT MAX(sortOrder) as mx FROM ventures"
        ).first();
        order = (maxRow?.mx || 0) + 1;
      }
      await context.env.SITE_DB.prepare(
        "INSERT INTO ventures (id, name, color, icon, tagline, status, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        ventureId,
        name.trim(),
        color || '#3b82f6',
        icon || '',
        tagline || '',
        status || 'active',
        order,
        now, now
      ).run();
      return jsonResponse({ ok: true, id: ventureId });
    }

    if (action === "delete-venture") {
      const { id } = body;
      if (!id) return errorResponse("id is required.", 400);
      // Soft delete — keep goals/history intact, just hide the venture.
      // Goals retain ventureId for reference; user can reactivate.
      await context.env.SITE_DB.prepare(
        "UPDATE ventures SET status='archived', updatedAt=? WHERE id=?"
      ).bind(now, id).run();
      return jsonResponse({ ok: true });
    }

    if (action === "delete-venture-hard") {
      // Permanent delete. Drops the venture row and clears the ventureId
      // foreign-key-like column on every linked row so goals / habits / todos
      // / calendar events / office-work categories don't end up pointing
      // at a phantom venture. Linked rows themselves are preserved — they
      // become "personal" (empty ventureId) so deleting a venture doesn't
      // cascade and accidentally destroy years of habit history.
      const { id } = body;
      if (!id) return errorResponse("id is required.", 400);
      const venture = await context.env.SITE_DB.prepare(
        "SELECT id FROM ventures WHERE id = ?"
      ).bind(id).first();
      if (!venture) return errorResponse("Venture not found.", 404);

      await context.env.SITE_DB.batch([
        context.env.SITE_DB.prepare("UPDATE goals                   SET ventureId='', updatedAt=? WHERE ventureId=?").bind(now, id),
        context.env.SITE_DB.prepare("UPDATE habits                  SET ventureId='', updatedAt=? WHERE ventureId=?").bind(now, id),
        context.env.SITE_DB.prepare("UPDATE todos                   SET ventureId='', updatedAt=? WHERE ventureId=?").bind(now, id),
        context.env.SITE_DB.prepare("UPDATE calendar_events         SET ventureId='', updatedAt=? WHERE ventureId=?").bind(now, id),
        context.env.SITE_DB.prepare("UPDATE office_work_categories  SET ventureId='', updatedAt=? WHERE ventureId=?").bind(now, id),
        context.env.SITE_DB.prepare("DELETE FROM ventures WHERE id = ?").bind(id),
      ]);
      return jsonResponse({ ok: true, deleted: 'venture', cleared: ['goals', 'habits', 'todos', 'calendar_events', 'office_work_categories'] });
    }

    if (action === "reorder-ventures") {
      const { entries } = body;
      if (!Array.isArray(entries)) return errorResponse("entries array is required.", 400);
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE ventures SET sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.sortOrder || 0, now, e.id)
      );
      if (stmts.length > 0) await context.env.SITE_DB.batch(stmts);
      return jsonResponse({ ok: true });
    }

    // ── Goals ──

    if (action === "save-goal") {
      const { id, ventureId, ventureIds, horizon, title, why, targetValue, targetDate, status, parentGoalId, sortOrder, priority, size, blockedBy } = body;
      if (!title || !title.trim()) return errorResponse("Goal title is required.", 400);
      const validHorizons = ['daily', 'weekly', 'quarterly', 'yearly'];
      if (!horizon || !validHorizons.includes(horizon)) {
        return errorResponse("Valid horizon required (daily|weekly|quarterly|yearly).", 400);
      }
      // v4.6.8: status was open/done/dropped; expanded to swim-lane values.
      // 'open' still accepted on the wire — treated as alias for 'todo'.
      const validStatuses = new Set(['backlog', 'todo', 'working', 'waiting', 'done', 'dropped']);
      const normalizeStatus = (s) => {
        if (!s) return null;
        if (s === 'open') return 'todo';
        return validStatuses.has(s) ? s : null;
      };

      const validSize = (s) => {
        const v = String(s || '').toUpperCase();
        return ['S', 'M', 'L', 'XL'].includes(v) ? v : '';
      };
      const sanitizeBlockedBy = (val) => {
        if (val == null) return null; // signal: don't touch on UPDATE
        if (Array.isArray(val)) return val.filter(Boolean).join(',');
        return String(val || '').split(',').map(s => s.trim()).filter(Boolean).join(',');
      };
      const nextBlockedBy = blockedBy !== undefined ? sanitizeBlockedBy(blockedBy) : null;

      // ventureIds is the canonical multi-venture list (CSV string). If the
      // client sends ventureIds we use it directly. If only ventureId is sent
      // (older clients or auto-pre-fill in modals), wrap it as a 1-element CSV.
      // The singular ventureId column is kept in sync with the first item for
      // any older code path that filters on it (e.g. existing rollup queries).
      const sanitizeIds = (csv) => String(csv || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      let nextVentureIds;
      if (ventureIds !== undefined) {
        // Accept either CSV string or array.
        nextVentureIds = Array.isArray(ventureIds)
          ? ventureIds.filter(Boolean)
          : sanitizeIds(ventureIds);
      } else if (ventureId !== undefined) {
        nextVentureIds = ventureId ? [ventureId] : [];
      } else {
        nextVentureIds = null; // signal: don't touch on UPDATE
      }
      const nextPrimaryVenture = nextVentureIds && nextVentureIds.length > 0 ? nextVentureIds[0] : '';
      const nextVentureIdsCsv = nextVentureIds ? nextVentureIds.join(',') : null;

      const validPrio = (p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0;
      };

      if (id) {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT * FROM goals WHERE id = ?"
        ).bind(id).first();
        if (!existing) return errorResponse("Goal not found.", 404);

        const normalizedStatus = normalizeStatus(status);
        await context.env.SITE_DB.prepare(
          "UPDATE goals SET ventureId=?, ventureIds=?, horizon=?, title=?, why=?, targetValue=?, targetDate=?, status=?, parentGoalId=?, sortOrder=?, priority=?, size=?, blockedBy=?, updatedAt=? WHERE id=?"
        ).bind(
          nextVentureIdsCsv !== null ? nextPrimaryVenture : (existing.ventureId || ''),
          nextVentureIdsCsv !== null ? nextVentureIdsCsv : (existing.ventureIds || ''),
          horizon,
          title.trim(),
          why !== undefined ? why : existing.why,
          targetValue !== undefined ? (parseFloat(targetValue) || 0) : existing.targetValue,
          targetDate !== undefined ? targetDate : existing.targetDate,
          normalizedStatus !== null ? normalizedStatus : (existing.status || 'todo'),
          parentGoalId !== undefined ? parentGoalId : existing.parentGoalId,
          sortOrder !== undefined ? sortOrder : existing.sortOrder,
          priority !== undefined ? validPrio(priority) : (existing.priority || 0),
          size !== undefined ? validSize(size) : (existing.size || ''),
          nextBlockedBy !== null ? nextBlockedBy : (existing.blockedBy || ''),
          now,
          id
        ).run();
        return jsonResponse({ ok: true, id });
      }

      const goalId = newId();
      let order = sortOrder;
      if (order === undefined || order === null) {
        const maxRow = await context.env.SITE_DB.prepare(
          "SELECT MAX(sortOrder) as mx FROM goals WHERE horizon = ? AND ventureId = ?"
        ).bind(horizon, nextPrimaryVenture).first();
        order = (maxRow?.mx || 0) + 1;
      }
      const normalizedStatus = normalizeStatus(status);
      await context.env.SITE_DB.prepare(
        "INSERT INTO goals (id, ventureId, ventureIds, horizon, title, why, targetValue, targetDate, status, parentGoalId, sortOrder, priority, size, blockedBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        goalId,
        nextPrimaryVenture,
        nextVentureIdsCsv || '',
        horizon,
        title.trim(),
        why || '',
        parseFloat(targetValue) || 0,
        targetDate || '',
        normalizedStatus || 'todo',
        parentGoalId || '',
        order,
        validPrio(priority),
        validSize(size),
        nextBlockedBy || '',
        now, now
      ).run();
      return jsonResponse({ ok: true, id: goalId });
    }

    if (action === "archive-goals") {
      // Batch archive/unarchive. Status is untouched — archived done goals
      // still count as done in progress rollups; they just leave the boards.
      const { ids, archived } = body;
      if (!Array.isArray(ids) || ids.length === 0) return errorResponse("ids array is required.", 400);
      const flag = (archived === 0 || archived === false) ? 0 : 1;
      await context.env.SITE_DB.batch(ids.map(id =>
        context.env.SITE_DB.prepare("UPDATE goals SET archived=?, updatedAt=? WHERE id=?").bind(flag, now, id)
      ));
      return jsonResponse({ ok: true, count: ids.length });
    }

    if (action === "delete-goal") {
      const { id } = body;
      if (!id) return errorResponse("id is required.", 400);
      // Hard delete — goals are user-created and dropped ones should disappear.
      // Also drops checkins so the rollup math stays clean.
      await context.env.SITE_DB.batch([
        context.env.SITE_DB.prepare("DELETE FROM goal_checkins WHERE goalId = ?").bind(id),
        context.env.SITE_DB.prepare("DELETE FROM goals WHERE id = ?").bind(id),
      ]);
      return jsonResponse({ ok: true });
    }

    if (action === "reorder-goals") {
      const { entries } = body;
      if (!Array.isArray(entries)) return errorResponse("entries array is required.", 400);
      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE goals SET sortOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.sortOrder || 0, now, e.id)
      );
      if (stmts.length > 0) await context.env.SITE_DB.batch(stmts);
      return jsonResponse({ ok: true });
    }

    // ── Checkins ──

    // One tap on the dashboard widget = one checkin for today.
    // If a checkin already exists for (goalId, date), we update it rather than
    // duplicating — so re-tapping doesn't pollute the rollups.
    if (action === "checkin") {
      const { goalId, progressNote, value, date } = body;
      if (!goalId) return errorResponse("goalId is required.", 400);
      const checkinDate = date || today;

      const goal = await context.env.SITE_DB.prepare(
        "SELECT id FROM goals WHERE id = ?"
      ).bind(goalId).first();
      if (!goal) return errorResponse("Goal not found.", 404);

      const existing = await context.env.SITE_DB.prepare(
        "SELECT * FROM goal_checkins WHERE goalId = ? AND date = ? ORDER BY createdAt DESC LIMIT 1"
      ).bind(goalId, checkinDate).first();

      // Honor partial updates: omitting progressNote/value preserves the existing values
      // so a plain "+ Progress" tap doesn't clobber an earlier note for the same day.
      const nextNote = progressNote !== undefined
        ? String(progressNote || '').trim()
        : (existing ? (existing.progressNote || '') : '');
      const nextValue = value !== undefined
        ? (parseFloat(value) || 0)
        : (existing ? (existing.value || 0) : 0);

      if (existing) {
        await context.env.SITE_DB.prepare(
          "UPDATE goal_checkins SET progressNote=?, value=? WHERE id=?"
        ).bind(nextNote, nextValue, existing.id).run();
        return jsonResponse({ ok: true, id: existing.id, updated: true });
      }

      const checkinId = newId();
      await context.env.SITE_DB.prepare(
        "INSERT INTO goal_checkins (id, goalId, date, progressNote, value, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(checkinId, goalId, checkinDate, nextNote, nextValue, now).run();
      return jsonResponse({ ok: true, id: checkinId, updated: false });
    }

    if (action === "uncheckin") {
      const { goalId, date } = body;
      if (!goalId) return errorResponse("goalId is required.", 400);
      const checkinDate = date || today;
      await context.env.SITE_DB.prepare(
        "DELETE FROM goal_checkins WHERE goalId = ? AND date = ?"
      ).bind(goalId, checkinDate).run();
      return jsonResponse({ ok: true });
    }

    return errorResponse("Unknown action: " + action, 400);
  } catch (err) {
    // Surface the actual underlying error (same reasoning as the GET catch).
    return jsonResponse({
      error: "Failed to process intention action.",
      detail: err?.message || String(err),
      stack: err?.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : undefined,
    }, 500);
  }
}
