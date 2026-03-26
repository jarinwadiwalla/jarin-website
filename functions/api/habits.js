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

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

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

function currentWeekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function currentMonthStart() {
  const d = new Date();
  return d.toISOString().slice(0, 8) + "01";
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getMonthStart(dateStr) {
  return dateStr.slice(0, 8) + "01";
}

function prevMonthStart(monthStr) {
  const d = new Date(monthStr + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function prevWeekStart(weekStr) {
  const d = new Date(weekStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

async function recalcStreak(db, habitId, frequency) {
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

  // Daily
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

    return new Response(
      JSON.stringify({
        habits: habitsResult.results,
        todayLogs: todayLogsResult.results,
        recentLogs: recentLogsResult.results,
        weekLogs: weekLogsResult.results,
        monthLogs: monthLogsResult.results,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load habits." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action || "save";
    const now = new Date().toISOString();
    const today = body.today || todayDate();

    if (action === "complete") {
      const { id } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "id is required." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const habit = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(id).first();

      if (!habit) {
        return new Response(
          JSON.stringify({ error: "Habit not found." }),
          { status: 404, headers: CORS_HEADERS }
        );
      }

      const freq = habit.frequency || "daily";

      if (freq === "weekly") {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT id FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentWeekStart()).first();
        if (existing) {
          return new Response(
            JSON.stringify({ error: "Already completed this week." }),
            { status: 409, headers: CORS_HEADERS }
          );
        }
      } else if (freq === "monthly") {
        const existing = await context.env.SITE_DB.prepare(
          "SELECT id FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentMonthStart()).first();
        if (existing) {
          return new Response(
            JSON.stringify({ error: "Already completed this month." }),
            { status: 409, headers: CORS_HEADERS }
          );
        }
      }

      const logId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
      const logNotes = (body.notes || "").trim();
      await context.env.SITE_DB.prepare(
        "INSERT OR IGNORE INTO habit_logs (id, habitId, date, notes, createdAt) VALUES (?, ?, ?, ?, ?)"
      ).bind(logId, id, today, logNotes, now).run();

      const { currentStreak, longestStreak } = await recalcStreak(context.env.SITE_DB, id, freq);

      const countRow = await context.env.SITE_DB.prepare(
        "SELECT COUNT(*) as c FROM habit_logs WHERE habitId = ?"
      ).bind(id).first();

      await context.env.SITE_DB.prepare(
        "UPDATE habits SET currentStreak=?, longestStreak=?, totalCompletions=?, lastCompletedDate=?, updatedAt=? WHERE id=?"
      ).bind(currentStreak, longestStreak, countRow.c, today, now, id).run();

      return new Response(
        JSON.stringify({ ok: true, currentStreak, longestStreak, totalCompletions: countRow.c }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "update-note") {
      const { id, date, notes } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "id is required." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }
      const logDate = date || today;
      await context.env.SITE_DB.prepare(
        "UPDATE habit_logs SET notes = ? WHERE habitId = ? AND date = ?"
      ).bind((notes || "").trim(), id, logDate).run();

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "uncomplete") {
      const { id } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "id is required." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const habit = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(id).first();
      const freq = habit?.frequency || "daily";

      if (freq === "weekly") {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentWeekStart()).run();
      } else if (freq === "monthly") {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date >= ?"
        ).bind(id, currentMonthStart()).run();
      } else {
        await context.env.SITE_DB.prepare(
          "DELETE FROM habit_logs WHERE habitId = ? AND date = ?"
        ).bind(id, today).run();
      }

      const { currentStreak, longestStreak } = await recalcStreak(context.env.SITE_DB, id, freq);

      const countRow = await context.env.SITE_DB.prepare(
        "SELECT COUNT(*) as c FROM habit_logs WHERE habitId = ?"
      ).bind(id).first();

      const lastLog = await context.env.SITE_DB.prepare(
        "SELECT date FROM habit_logs WHERE habitId = ? ORDER BY date DESC LIMIT 1"
      ).bind(id).first();

      await context.env.SITE_DB.prepare(
        "UPDATE habits SET currentStreak=?, longestStreak=?, totalCompletions=?, lastCompletedDate=?, updatedAt=? WHERE id=?"
      ).bind(currentStreak, longestStreak, countRow.c, lastLog?.date || "", now, id).run();

      return new Response(
        JSON.stringify({ ok: true, currentStreak, longestStreak, totalCompletions: countRow.c }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "save") {
      const { id, name, category, frequency, stackGroup, stackOrder, status } = body;
      if (!name || !name.trim()) {
        return new Response(
          JSON.stringify({ error: "Habit name is required." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const habitId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);

      const existing = await context.env.SITE_DB.prepare(
        "SELECT * FROM habits WHERE id = ?"
      ).bind(habitId).first();

      if (existing) {
        await context.env.SITE_DB.prepare(
          "UPDATE habits SET name=?, category=?, frequency=?, stackGroup=?, stackOrder=?, status=?, updatedAt=? WHERE id=?"
        ).bind(
          name.trim(),
          category || existing.category,
          frequency || existing.frequency,
          stackGroup !== undefined ? stackGroup : existing.stackGroup,
          stackOrder !== undefined ? stackOrder : existing.stackOrder,
          status || existing.status,
          now,
          habitId
        ).run();
      } else {
        let order = stackOrder;
        if (order === undefined || order === null) {
          const maxRow = await context.env.SITE_DB.prepare(
            "SELECT MAX(stackOrder) as mx FROM habits WHERE stackGroup = ?"
          ).bind(stackGroup || "").first();
          order = (maxRow?.mx || 0) + 1;
        }

        await context.env.SITE_DB.prepare(
          `INSERT INTO habits (id, name, category, frequency, stackGroup, stackOrder, currentStreak, longestStreak, totalCompletions, lastCompletedDate, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, '', 'active', ?, ?)`
        ).bind(
          habitId,
          name.trim(),
          category || "general",
          frequency || "daily",
          stackGroup || "",
          order,
          now, now
        ).run();
      }

      return new Response(
        JSON.stringify({ ok: true, id: habitId }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "reorder") {
      const { entries } = body;
      if (!Array.isArray(entries)) {
        return new Response(
          JSON.stringify({ error: "entries array is required." }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const stmts = entries.map(e =>
        context.env.SITE_DB.prepare(
          "UPDATE habits SET stackGroup=?, stackOrder=?, updatedAt=? WHERE id=?"
        ).bind(e.stackGroup || "", e.stackOrder || 0, now, e.id)
      );

      if (stmts.length > 0) {
        await context.env.SITE_DB.batch(stmts);
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action: " + action }),
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to process habit action." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "id is required." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await context.env.SITE_DB.batch([
      context.env.SITE_DB.prepare("DELETE FROM habit_logs WHERE habitId = ?").bind(id),
      context.env.SITE_DB.prepare("DELETE FROM habits WHERE id = ?").bind(id),
    ]);

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete habit." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
