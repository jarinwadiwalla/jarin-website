/**
 * Cloudflare Pages Function — POST /api/translation/transcribe
 *
 * Body: { audioKey: "translation/foo.opus" }
 *
 * Fetches the audio from R2 (AUDIO_BUCKET), sends it to OpenAI Whisper with
 * language="fa" and word + segment timestamps, then upserts a row in
 * translation_sessions with the resulting transcript JSON.
 *
 * Env required:
 *   - OPENAI_API_KEY (secret)
 *   - AUDIO_BUCKET   (R2 binding)
 *   - SITE_DB        (D1 binding; see schema/translation-sessions.sql)
 */

import { jsonResponse, errorResponse } from '../../lib/response.js';
import { titleFromKey, mimeFromKey } from '../../lib/translation.js';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function onRequestPost(context) {
  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) return errorResponse('OPENAI_API_KEY not configured', 500);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const audioKey = (body?.audioKey || '').trim();
  if (!audioKey) return errorResponse('audioKey is required', 400);

  const now = new Date().toISOString();
  const title = titleFromKey(audioKey);

  // Mark as transcribing (upsert)
  await context.env.SITE_DB.prepare(
    `INSERT INTO translation_sessions (audioKey, title, status, createdAt, updatedAt)
     VALUES (?, ?, 'transcribing', ?, ?)
     ON CONFLICT(audioKey) DO UPDATE SET
       status='transcribing', error='', updatedAt=excluded.updatedAt`
  ).bind(audioKey, title, now, now).run();

  // Fetch audio from R2
  const obj = await context.env.AUDIO_BUCKET.get(audioKey);
  if (!obj) {
    await markFailed(context.env.SITE_DB, audioKey, 'Audio file not found in R2');
    return errorResponse('Audio file not found', 404);
  }

  const buf = await obj.arrayBuffer();
  const fileName = audioKey.split('/').pop() || 'audio.opus';
  const audioBlob = new Blob([buf], { type: mimeFromKey(audioKey) });

  // Build Whisper form
  const form = new FormData();
  form.append('file', audioBlob, fileName);
  form.append('model', 'whisper-1');
  form.append('language', 'fa');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');

  let whisperJson;
  try {
    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      await markFailed(context.env.SITE_DB, audioKey, `Whisper ${res.status}: ${text.slice(0, 300)}`);
      return errorResponse(`Whisper failed (${res.status})`, 502);
    }
    whisperJson = await res.json();
  } catch (e) {
    await markFailed(context.env.SITE_DB, audioKey, `Whisper request error: ${e.message}`);
    return errorResponse('Whisper request failed', 502);
  }

  const transcript = {
    duration: whisperJson.duration || 0,
    language: whisperJson.language || 'fa',
    segments: (whisperJson.segments || []).map((s) => ({
      start: s.start,
      end:   s.end,
      text:  (s.text || '').trim(),
    })),
    words: (whisperJson.words || []).map((w) => ({
      word:  w.word,
      start: w.start,
      end:   w.end,
    })),
  };

  const updatedAt = new Date().toISOString();
  await context.env.SITE_DB.prepare(
    `INSERT INTO translation_sessions (audioKey, title, durationSec, language, status, transcript, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'transcribed', ?, ?, ?)
     ON CONFLICT(audioKey) DO UPDATE SET
       transcript=excluded.transcript,
       durationSec=excluded.durationSec,
       language=excluded.language,
       status='transcribed',
       error='',
       updatedAt=excluded.updatedAt`
  ).bind(
    audioKey, title,
    Math.round(transcript.duration),
    transcript.language,
    JSON.stringify(transcript),
    now, updatedAt,
  ).run();

  return jsonResponse({ ok: true, audioKey, status: 'transcribed', transcript });
}

async function markFailed(db, audioKey, msg) {
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `UPDATE translation_sessions SET status='failed', error=?, updatedAt=? WHERE audioKey=?`
    ).bind(msg.slice(0, 500), now, audioKey).run();
  } catch { /* swallow — error path */ }
}
