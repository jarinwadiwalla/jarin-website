/**
 * Pure helpers for the Translation feature (v4.5.0).
 * No I/O — safe to import from both the Pages Functions and unit tests.
 */

const MIME_BY_EXT = {
  mp3:  'audio/mpeg',
  m4a:  'audio/mp4',
  aac:  'audio/aac',
  ogg:  'audio/ogg',
  opus: 'audio/opus',
  wav:  'audio/wav',
  flac: 'audio/flac',
};

/**
 * Derive a human-readable title from an R2 audio key.
 *  "translation/whatsapp-2026-05-11.opus" → "whatsapp 2026 05 11"
 */
export function titleFromKey(key) {
  if (!key) return '';
  const tail = key.split('/').pop() || key;
  return tail.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

/**
 * Map an audio file extension to the MIME type Whisper expects.
 * Falls back to application/octet-stream when the extension is unknown
 * (Whisper accepts the file based on its filename in that case).
 */
export function mimeFromKey(key) {
  if (!key) return 'application/octet-stream';
  const m = key.match(/\.([^.]+)$/);
  const ext = (m ? m[1] : '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * Parse a row from translation_sessions, inflating the JSON-encoded
 * transcript and translation columns. Returns null for falsy input.
 *
 * Throws if the stored JSON is malformed — callers can decide whether to
 * surface that as a 500 or fall back to "not yet generated".
 */
export function parseSessionRow(row) {
  if (!row) return null;
  return {
    ...row,
    transcript:  row.transcript  ? JSON.parse(row.transcript)  : null,
    translation: row.translation ? JSON.parse(row.translation) : null,
  };
}

/**
 * Merge a slice of newly-translated segments (from Claude) into an existing
 * saved translation, keyed by position into the Whisper transcript.
 *
 * The result is always exactly transcriptSegments.length entries long:
 *   - Positions inside [fromIndex, fromIndex + claudeSegments.length) are
 *     overwritten with the corresponding Claude segment, zipped with the
 *     transcript's timestamp.
 *   - Other positions are inherited from `existing.segments` (if the
 *     existing array length matches the transcript) or filled with
 *     placeholder entries (timestamp + transcript text, no latin/en/words).
 *
 * This is the merge step that makes chunked translation possible — the
 * frontend can call /api/translation/translate repeatedly with advancing
 * fromIndex values and each call only has to convince Claude to translate a
 * small batch.
 */
export function mergeTranslationSlice(existing, transcriptSegments, claudeSegments, fromIndex) {
  const transcript = Array.isArray(transcriptSegments) ? transcriptSegments : [];
  const claude = Array.isArray(claudeSegments) ? claudeSegments : [];
  const from = Math.max(0, Number(fromIndex) | 0);

  // Start from existing if it matches transcript length, otherwise placeholders
  let segments;
  if (existing?.segments?.length === transcript.length) {
    segments = existing.segments.slice();
  } else {
    segments = transcript.map((src) => ({
      start: src.start,
      end:   src.end,
      fa:    (src.text || '').trim(),
      latin: '',
      en:    '',
      words: [],
    }));
  }

  const upper = Math.min(transcript.length, from + claude.length);
  for (let i = from; i < upper; i++) {
    const src = transcript[i];
    const tr  = claude[i - from] || {};
    segments[i] = {
      start: src.start,
      end:   src.end,
      fa:    tr.fa    || (src.text || '').trim(),
      latin: tr.latin || '',
      en:    tr.en    || '',
      words: Array.isArray(tr.words) ? tr.words : [],
    };
  }

  return segments;
}

/**
 * Convenience wrapper: zip a *complete* Claude response back with the
 * transcript. Equivalent to mergeTranslationSlice with no existing and
 * fromIndex=0. Kept for backward-compat with v4.5.0 tests.
 */
export function zipTranslationSegments(transcriptSegments, claudeSegments) {
  return mergeTranslationSlice(null, transcriptSegments, claudeSegments, 0);
}

/**
 * Map a language-tag-style ISO code (the form Whisper / `lang` attributes
 * use, e.g. "fa", "id") to the Gold List's free-form language string
 * ("persian", "indonesian", …). The Gold List uses human-readable names
 * rather than ISO codes — see the static <option> values in
 * marketing/guru.html and existing data already stored under those names.
 *
 * Unknown codes fall back to "other" to keep the Gold List add path
 * non-destructive (the entry still saves, just sorted under the catch-all).
 */
const ISO_TO_GOLD_LIST_LANGUAGE = {
  fa: 'persian',
  id: 'indonesian',
  de: 'german',
  es: 'spanish',
};

export function mapIsoToGoldListLanguage(iso) {
  if (!iso) return 'other';
  const key = String(iso).toLowerCase().split('-')[0]; // "fa-IR" → "fa"
  return ISO_TO_GOLD_LIST_LANGUAGE[key] || 'other';
}

/**
 * Group reviewable entries by their language column. Used by the GET
 * /api/goldlist stats block to drive the per-language breakdown under the
 * "Ready to Review" card.
 *
 *  - `entries` is the full Gold List array (each item must have `language`).
 *  - `isReviewable` is the predicate already defined in the endpoint —
 *    passed in to avoid duplicating its tz/distillation logic in the lib.
 *
 * Entries with no language are bucketed under "unknown" (matches the
 * existing convention in the API's byLanguage stat). Entries that aren't
 * reviewable are skipped. Returns {} when nothing is reviewable.
 */
export function summarizeReviewableByLanguage(entries, isReviewable) {
  const out = {};
  if (!Array.isArray(entries) || typeof isReviewable !== 'function') return out;
  for (const e of entries) {
    if (!isReviewable(e)) continue;
    const lang = e.language || 'unknown';
    out[lang] = (out[lang] || 0) + 1;
  }
  return out;
}

/**
 * Clamp the tooltip's `left` coordinate so it stays inside the segments
 * container. With RTL Persian text the user often clicks words near the
 * right edge, and a naive `wordLeft - containerLeft` can push the tooltip
 * past the container's right side (since the tooltip extends to the right
 * from its anchor).
 *
 * Inputs are CSS-pixel measurements from getBoundingClientRect / offsetWidth.
 * Returns the clamped left value, never negative and never beyond
 * (containerWidth - tooltipWidth). When the tooltip is wider than the
 * container, returns 0 (overflow on the right is preferable to negative).
 */
export function clampTooltipLeft(wordLeft, containerLeft, containerWidth, tooltipWidth) {
  const raw = wordLeft - containerLeft;
  const maxLeft = containerWidth - tooltipWidth;
  if (maxLeft <= 0) return 0;
  return Math.max(0, Math.min(maxLeft, raw));
}
