/**
 * Shared utility functions for API handlers.
 */

// Adaptive review intervals — longer gaps for deeper distillation levels
export function getReviewIntervalMs(distillation) {
  const intervals = [14, 14, 21, 28, 42]; // days per distillation level
  const days = intervals[Math.min(distillation || 0, intervals.length - 1)];
  return days * 24 * 60 * 60 * 1000;
}

export function getReviewIntervalDays(distillation) {
  const intervals = [14, 14, 21, 28, 42];
  return intervals[Math.min(distillation || 0, intervals.length - 1)];
}

// Compute the day bucket integer for a timestamp using midnight local-day boundary.
// The caller passes tzOffsetMinutes (positive for ahead of UTC, e.g. Bali = 480).
export function reviewDayBucket(timestamp, tzOffsetMinutes) {
  const offsetMs = (tzOffsetMinutes || 0) * 60 * 1000;
  // Convert to local time
  const localMs = timestamp + offsetMs;
  return Math.floor(localMs / 86400000);
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
