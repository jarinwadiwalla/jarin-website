/**
 * Cloudflare Pages Function — /api/habits
 *
 * GET    → list habits + today's logs + recent 90-day logs
 * POST   → save/complete/uncomplete/reorder habits
 * DELETE → delete habit and its logs
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

/** Monday of the current ISO week (UTC) */
function currentWeekStart() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** 1st of the current month (UTC) */
function currentMonthStart() {
  const d = new Date();
  return d.toISOString().slice(0, 8) + "01";
}

/** Monday of the ISO week containing dateStr */
function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** 1st of the month containing dateStr */
function getMonthStart(dateStr) {
  return dateStr.slice(0, 8) + "01";
}

/** 1st of the month before monthStr (which must be YYYY-MM-DD of a 1st) */
function prevMonthStart(monthStr) {
  const d = new Date(monthStr + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** Previous Monday relative to a week-start */
function prevWeekStart(weekStr) {
  const d = new Date(weekStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Recalculate streak by walking backwards through logs.
 * frequency: 'daily' | 'weekly' | 'monthly'
 * Returns { currentStreak, longestStreak }.
 */
/** Day-of-week index: sun=0 ... sat=6 */
const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseScheduleDays(str) {
  if (!str) return null;
  const nums = str.split(',').map(s => DAY_MAP[s.trim()]).filter(n => n !== undefined);
  return nums.length > 0 ? new Set(nums) : null;
}

function isScheduledDay(dateStr, schedSet) {
  return schedSet.has(new Date(dateStr + "T12:00:00").getUTCDay());
}

async function recalcStreak(db, habitId, frequency, scheduleDays) {
  const { results: logs } = await db.prepare(
    "SELECT date FROM habit_logs WHERE habitId = ? ORDER BY date DESC"
  ).bind(habitId).all();

  if (logs.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const dates = logs.map(l => l.date);

  if (frequency === "weekly") {
    const weekSet = new Set(dates.map(d => getWeekStart(d)));
    const weeks = [...weekSet].sort().reverse();
    const thisWeek = currentWeekStart();
    const lastWeek = prevWeekStart(thisWeek);

    let currentStreak = 0;
    if (weeks[0] === thisWeek || weeks[0] === lastWeek) {
      currentStreak = 1;
      for (let i = 1; i < weeks.length; i++) {
        if (weeks[i] === prevWeekStart(weeks[i - 1])) {
          currentStreak++;
        } else break;
      }
    }

    let longestStreak = 1, streak = 1;
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i] === prevWeekStart(weeks[i - 1])) {
        streak++;
        if (streak > longestStreak) longestStreak = streak;
      } else { streak = 1; }
    }
    return { currentStreak, longestStreak };
  }

  if (frequency === "monthly") {
    const monthSet = new Set(dates.map(d => getMonthStart(d)));
    const months = [...monthSet].sort().reverse();
    const thisMonth = currentMonthStart();
    const lastMonth = prevMonthStart(thisMonth);

    let currentStreak = 0;
    if (months[0] === thisMonth || months[0] === lastMonth) {
      currentStreak = 1;
      for (let i = 1; i < months.length; i++) {
        if (months[i] === prevMonthStart(months[i - 1])) {
          currentStreak++;
        } else break;
      }
    }

    let longestStreak = 1, streak = 1;
    for (let i = 1; i < months.length; i++) {
      if (months[i] === prevMonthStart(months[i - 1])) {
        streak++;
        if (streak > longestStreak) longestStreak = streak;
      } else { streak = 1; }
    }
    return { currentStreak, longestStreak };
  }

  // Daily — schedule-aware
  const schedSet = parseScheduleDays(scheduleDays);

  if (schedSet) {
    // Walk backwards through scheduled days, check if each has a log
    const dateSet = new Set(dates);
    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;

    // Generate scheduled days for last 365 days, newest first
    const scheduled = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (schedSet.has(d.getDay())) {
        scheduled.push(d.toISOString().slice(0, 10));
      }
    }

    // Current streak (allow today to be incomplete)
    for (let i = 0; i < scheduled.length; i++) {
      if (dateSet.has(scheduled[i])) {
        currentStreak++;
      } else if (i === 0 && scheduled[i] === todayDate()) {
        continue; // today not done yet, don't break
      } else {
        break;
      }
    }

    // Longest streak
    for (const ds of scheduled.slice().reverse()) {
      if (dateSet.has(ds)) {
        streak++;
        if (streak > longestStreak) longestStreak = streak;
      } else {
        streak = 0;
      }
    }

    return { currentStreak, longestStreak };
  }

  // Daily without schedule — original logic
  const today = todayDate();
  const yesterday = yesterdayDate();

  let currentStreak = 0;
  if (dates[0] === today || dates[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + "T12:00:00");
      const curr = new Date(dates[i] + "T12:00:00");
      const diff = (prev - curr) / 86400000;
      if (diff === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  let longestStreak = 1;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + "T12:00:00");
    const curr = new Date(dates[i] + "T12:00:00");
    const diff = (prev - curr) / 86400000;
    if (diff === 1) {
      streak++;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 1;
    }
  }

  return { currentStreak, longestStreak };
}

export async function onRequestGet(context) {
  try {
    // Accept client's local date to avoid UTC vs local timezone mismatch
    const url = new URL(context.request.url);
    const today = url.searchParams.get("today") || todayDate();
    const ninetyAgo = ninetyDaysAgo();
    const weekStart = currentWeekStart();
    const monthStart = currentMonthStart();

    const [habitsResult, todayLogsResult, recentLogsResult, weekLogsResult, monthLogsResult] = await Promise.all([
      context.env.SITE_DB.prepare(
        "SELECT * FROM habits ORDER BY stackGroup ASC, stackOrder ASC, createdAt ASC"
      ).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM habit_logs WHERE date = ?"
      ).bind(today).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM habit_logs WHERE date >= ? ORDER BY date DESC"
      ).bind(ninetyAgo).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM habit_logs WHERE date >= ?"
      ).bind(weekStart).all(),
      context.env.SITE_DB.prepare(
        "SELECT * FROM habit_logs WHERE date >= ?"
      ).bind(monthStart).all(),
    ]);

    return jsonResponse({
      habits: habitsResult.results,
      todayLogs: todayLogsResult.results,
      recentLogs: recentLogsResult.results,
      weekLogs: weekLogsResult.results,
      monthLogs: monthLogsResult.results,
    });
  } catch (err) {
    return errorResponse("Failed to load habits.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action || "save";
    const now = new Date().toISOString();
    // Use client's local date if provided to avoid UTC timezone mismatch
    const today = body.today || todayDate();

    // ── Complete a habit for today ──
    if (action === "complete") {
      const { id } = body;
      if (!id) {
        return errorResponse("id is required.", 400);
      }

      const habit = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(id).first();

      if (!habit) {
        return errorResponse("Habit not found.", 404);
      }

      const freq = habit.frequency || "daily";
      // When scheduleDays is set, completion is per-day regardless of frequency
      const effectiveFreq = habit.scheduleDays ? "daily" : freq;

      // Period-duplicate guard for weekly/monthly habits
      if (effectiveFreq === "weekly") {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT id FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentWeekStart()).first();
        if (existing) {
          return errorResponse("Already completed this week.", 409);
        }
      } else if (effectiveFreq === "monthly") {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT id FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentMonthStart()).first();
        if (existing) {
          return errorResponse("Already completed this month.", 409);
        }
      }

      // Insert log (ignore if already exists for today)
      const logId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
      const logNotes = (body.notes || "").trim();
      const logValue = parseFloat(body.value) || 0;
      await context.env.SITE_DB.prepare(
        "INSERT OR IGNORE INTO habit_logs (id, habitId, date, notes, value, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(logId, id, today, logNotes, logValue, now).run();
      // Update value if log already existed
      if (logValue > 0) {
        await context.env.SITE_DB.prepare(
          "UPDATE habit_logs SET value = ? WHERE habitId = ? AND date = ?"
        ).bind(logValue, id, today).run();
      }

      // Recalculate streak from logs (use effective frequency to honor scheduleDays)
      const { currentStreak, longestStreak } = await recalcStreak(context.env.SITE_DB, id, effectiveFreq, habit.scheduleDays);

      // Count total completions
      const countRow = await context.env.SITE_DB.prepare(
        "SELECT COUNT(*) as c FROM habit_logs WHERE habitId = ?"
      ).bind(id).first();

      await context.env.SITE_DB.prepare(
        "UPDATE habits SET currentStreak=?, longestStreak=?, totalCompletions=?, lastCompletedDate=?, updatedAt=? WHERE id=?"
      ).bind(currentStreak, longestStreak, countRow.c, today, now, id).run();

      return jsonResponse({ ok: true, currentStreak, longestStreak, totalCompletions: countRow.c });
    }

    // ── Update note on a habit log ──
    if (action === "update-note") {
      const { id, date, notes } = body;
      if (!id) {
        return errorResponse("id is required.", 400);
      }
      const logDate = date || today;
      await context.env.SITE_DB.prepare(
        "UPDATE habit_logs SET notes = ? WHERE habitId = ? AND date = ?"
      ).bind((notes || "").trim(), id, logDate).run();

      return jsonResponse({ ok: true });
    }

    // ── Uncomplete a habit for today ──
    if (action === "uncomplete") {
      const { id } = body;
      if (!id) {
        return errorResponse("id is required.", 400);
      }

      const habit = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(id).first();
      const freq = habit?.frequency || "daily";
      // When scheduleDays is set, uncompletion is per-day regardless of frequency
      const effectiveFreq = habit?.scheduleDays ? "daily" : freq;

      // Delete logs for the current period
      if (effectiveFreq === "weekly") {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentWeekStart()).run();
      } else if (effectiveFreq === "monthly") {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentMonthStart()).run();
      } else {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date = ?"
        ).bind(id, today).run();
      }

      const { currentStreak, longestStreak } = await recalcStreak(context.env.SITE_DB, id, effectiveFreq, habit?.scheduleDays);

      const countRow = await context.env.SITE_DB.prepare(
        "SELECT COUNT(*) as c FROM habit_logs WHERE habitId = ?"
      ).bind(id).first();

      const lastLog = await context.env.SITE_DB.prepare(
        "SELECT date FROM habit_logs WHERE habitId = ? ORDER BY date DESC LIMIT 1"
      ).bind(id).first();

      await context.env.SITE_DB.prepare(
        "UPDATE habits SET currentStreak=?, longestStreak=?, totalCompletions=?, lastCompletedDate=?, updatedAt=? WHERE id=?"
      ).bind(currentStreak, longestStreak, countRow.c, lastLog?.date || "", now, id).run();

      return jsonResponse({ ok: true, currentStreak, longestStreak, totalCompletions: countRow.c });
    }

    // ── Save (create or update) a habit definition ──
    if (action === "save") {
      const { id, name, category, frequency, stackGroup, stackOrder, status, valueType, valueLabel, scheduleDays, ventureId, goalId } = body;
      if (!name || !name.trim()) {
        return errorResponse("Habit name is required.", 400);
      }

      const habitId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);

      const existing = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(habitId).first();

      if (existing) {
        await context.env.SITE_DB.prepare(
          "UPDATE habits SET name=?, category=?, frequency=?, stackGroup=?, stackOrder=?, status=?, valueType=?, valueLabel=?, scheduleDays=?, ventureId=?, goalId=?, updatedAt=? WHERE id=?"
        ).bind(
          name.trim(),
          category || existing.category,
          frequency || existing.frequency,
          stackGroup !== undefined ? stackGroup : existing.stackGroup,
          stackOrder !== undefined ? stackOrder : existing.stackOrder,
          status || existing.status,
          valueType !== undefined ? valueType : (existing.valueType || ''),
          valueLabel !== undefined ? valueLabel : (existing.valueLabel || ''),
          scheduleDays !== undefined ? scheduleDays : (existing.scheduleDays || ''),
          ventureId !== undefined ? (ventureId || '') : (existing.ventureId || ''),
          goalId !== undefined ? (goalId || '') : (existing.goalId || ''),
          now,
          habitId
        ).run();
      } else {
        // For new habits, auto-assign stackOrder to end of group
        let order = stackOrder;
        if (order === undefined || order === null) {
          const maxRow = await context.env.SITE_DB.prepare(
            "SELECT MAX(stackOrder) as mx FROM habits WHERE stackGroup = ?"
          ).bind(stackGroup || "").first();
          order = (maxRow?.mx || 0) + 1;
        }

        await context.env.SITE_DB.prepare(
          `INSERT INTO habits (id, name, category, frequency, stackGroup, stackOrder, currentStreak, longestStreak, totalCompletions, lastCompletedDate, status, valueType, valueLabel, scheduleDays, ventureId, goalId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, '', 'active', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          habitId,
          name.trim(),
          category || "general",
          frequency || "daily",
          stackGroup || "",
          order,
          valueType || "",
          valueLabel || "",
          scheduleDays || "",
          ventureId || "",
          goalId || "",
          now, now
        ).run();
      }

      return jsonResponse({ ok: true, id: habitId });
    }

    // ── Reorder habits ──
    if (action === "reorder") {
      const { entries } = body;
      if (!Array.isArray(entries)) {
        return errorResponse("entries array is required.", 400);
      }

      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE habits SET stackGroup=?, stackOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.stackGroup || "", e.stackOrder || 0, now, e.id)
      );

      if (stmts.length > 0) {
        await context.env.SITE_DB.batch(stmts);
      }

      return jsonResponse({ ok: true });
    }

    return errorResponse("Unknown action: " + action, 400);
  } catch (err) {
    return errorResponse("Failed to process habit action.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return errorResponse("id is required.", 400);
    }

    await context.env.SITE_DB.batch([
      context.env.SITE_DB.prepare("DELETE FROM habit_logs WHERE habitId = ?").bind(id),
      context.env.SITE_DB.prepare("DELETE FROM habits WHERE id = ?").bind(id),
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete habit.", 500);
  }
}
