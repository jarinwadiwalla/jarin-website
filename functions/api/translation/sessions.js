/**
 * Cloudflare Pages Function — /api/translation/sessions
 *
 * GET    → list all translation sessions (?audioKey=… returns just that one,
 *          with the full transcript JSON parsed)
 * PATCH  → body { audioKey, title } updates the display title (upsert)
 * DELETE → body { audioKey } removes the D1 row AND the underlying R2 audio
 *
 * Env required:
 *   - SITE_DB      (D1; see schema/translation-sessions.sql)
 *   - AUDIO_BUCKET (R2)
 */

import { jsonResponse, errorResponse } from '../../lib/response.js';
import { parseSessionRow } from '../../lib/translation.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const audioKey = url.searchParams.get('audioKey');

  try {
    if (audioKey) {
      const row = await context.env.SITE_DB.prepare(
        'SELECT * FROM translation_sessions WHERE audioKey = ?'
      ).bind(audioKey).first();
      return jsonResponse({ session: parseSessionRow(row) });
    }

    const { results } = await context.env.SITE_DB.prepare(
      // Omit the heavy transcript/translation JSON in the list — fetched on demand
      `SELECT audioKey, title, durationSec, language, status, error, createdAt, updatedAt
       FROM translation_sessions ORDER BY updatedAt DESC`
    ).all();
    return jsonResponse({ sessions: results || [] });
  } catch (e) {
    return errorResponse(`Failed to load sessions: ${e.message}`);
  }
}

export async function onRequestPatch(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const audioKey = (body?.audioKey || '').trim();
  const title = (body?.title || '').trim();
  if (!audioKey) return errorResponse('audioKey is required', 400);
  if (!title)    return errorResponse('title is required', 400);

  const now = new Date().toISOString();
  try {
    // Upsert — first rename of a never-translated session creates the row
    await context.env.SITE_DB.prepare(
      `INSERT INTO translation_sessions (audioKey, title, status, createdAt, updatedAt)
       VALUES (?, ?, 'uploaded', ?, ?)
       ON CONFLICT(audioKey) DO UPDATE SET title=excluded.title, updatedAt=excluded.updatedAt`
    ).bind(audioKey, title, now, now).run();
    return jsonResponse({ ok: true, audioKey, title });
  } catch (e) {
    return errorResponse(`Failed to rename: ${e.message}`);
  }
}

export async function onRequestDelete(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const audioKey = (body?.audioKey || '').trim();
  if (!audioKey) return errorResponse('audioKey is required', 400);

  try {
    await context.env.SITE_DB.prepare(
      'DELETE FROM translation_sessions WHERE audioKey = ?'
    ).bind(audioKey).run();
    await context.env.AUDIO_BUCKET.delete(audioKey);
    return jsonResponse({ ok: true });
  } catch (e) {
    return errorResponse(`Failed to delete: ${e.message}`);
  }
}
