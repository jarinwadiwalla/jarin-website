/**
 * Pure streak calculation helpers — no DB, no Date.now() coupling.
 *
 * The API handler in functions/api/habits.js has its own copies of these
 * functions wired into the D1 query path. This module exists so the same
 * logic can be unit tested without spinning up D1.
 */

export const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Parse a comma-separated schedule-day string ("mon,wed,fri") into a Set
 * of day-of-week integers (0=Sun..6=Sat). Returns null when the input is
 * empty / no valid days, meaning "every day".
 */
export function parseScheduleDays(str) {
  if (!str) return null;
  const nums = str.split(',').map(s => DAY_MAP[s.trim().toLowerCase()]).filter(n => n !== undefined);
  return nums.length > 0 ? new Set(nums) : null;
}

/**
 * Check if a YYYY-MM-DD date string falls on a scheduled day.
 */
export function isScheduledDay(dateStr, schedSet) {
  if (!schedSet) return true;
  return schedSet.has(new Date(dateStr + 'T12:00:00').getUTCDay());
}

/**
 * Pure daily streak calculation — given a sorted-descending array of
 * completion date strings (YYYY-MM-DD), return { currentStreak, longestStreak }.
 *
 * referenceDate is the "today" date string used for the current-streak head;
 * pass in the user's local today rather than relying on UTC.
 *
 * If scheduleDays is provided, the streak walks only the scheduled days.
 */
export function calcDailyStreak(dates, referenceDate, scheduleDays) {
  if (!dates || dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const dateSet = new Set(dates);
  const schedSet = parseScheduleDays(scheduleDays);

  // ----- Schedule-aware path -----
  if (schedSet) {
    // Walk back 365 days collecting only scheduled dates, newest first
    const refMs = new Date(referenceDate + 'T12:00:00').getTime();
    const scheduled = [];
    for (let i = 0; i < 365; i++) {
      const ms = refMs - i * 86400000;
      const d = new Date(ms);
      if (schedSet.has(d.getUTCDay())) {
        scheduled.push(d.toISOString().slice(0, 10));
      }
    }

    // Current streak — allow today to be incomplete without breaking
    let currentStreak = 0;
    for (let i = 0; i < scheduled.length; i++) {
      if (dateSet.has(scheduled[i])) {
        currentStreak++;
      } else if (i === 0 && scheduled[i] === referenceDate) {
        continue; // today not done yet
      } else {
        break;
      }
    }

    // Longest streak — walk oldest to newest
    let longestStreak = 0;
    let streak = 0;
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

  // ----- Plain daily path -----
  const yesterday = new Date(new Date(referenceDate + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10);

  let currentStreak = 0;
  if (dates[0] === referenceDate || dates[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T12:00:00');
      const curr = new Date(dates[i] + 'T12:00:00');
      const diff = (prev - curr) / 86400000;
      if (diff === 1) currentStreak++;
      else break;
    }
  }

  let longestStreak = 1;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T12:00:00');
    const curr = new Date(dates[i] + 'T12:00:00');
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
