/**
 * Cloudflare Pages Function — POST /api/translation/translate
 *
 * Body: { audioKey, fromIndex?, toIndex? }
 *
 * Translates a *slice* of the saved Whisper transcript with Claude Sonnet 4.6
 * via the Anthropic Messages API, then merges that slice into the
 * accumulated `translation` JSON on the session row.
 *
 * Slicing exists because a single Claude call covering an entire transcript
 * can exceed Cloudflare's 100s origin timeout (524 errors). The frontend
 * loops, calling this endpoint with advancing fromIndex values until
 * nextIndex comes back null.
 *
 * Defaults: if fromIndex/toIndex are omitted, we translate segments
 * [0, DEFAULT_SLICE). toIndex is capped at fromIndex + MAX_SLICE to
 * keep every individual call well under the timeout.
 *
 * Env required:
 *   - ANTHROPIC_API_KEY (secret)
 *   - SITE_DB (D1)
 */

import { jsonResponse, errorResponse } from '../../lib/response.js';
import { mergeTranslationSlice } from '../../lib/translation.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const DEFAULT_SLICE = 6;
const MAX_SLICE = 10;

const SYSTEM_PROMPT = `You are a Persian (Farsi) language teacher helping an English-speaking learner. For each Persian transcript segment given to you, you will return:

1. fa: The Persian text exactly as provided (do not rewrite the script).
2. latin: A romanization using standard scholarly transliteration. Use macrons for long vowels (ā, ī, ū), digraphs for non-Latin sounds (kh, gh, zh, sh, ch), and include short vowels (a, e, o) that are absent in Persian script.
3. en: A natural, idiomatic English translation — not word-for-word.
4. words: An array of the meaningful words in the segment, in order, excluding pure punctuation and pure filler. For each word include:
   - fa (Persian script, exactly as it appears)
   - latin (romanized, same rules as above)
   - en (the meaning in this context, short — like a dictionary gloss)
   - root, root_latin, root_en (OPTIONAL): include only when the word has a clear identifiable root — an Arabic trilateral root (e.g. ك-ت-ب) written in Persian/Arabic script, or a Persian verbal infinitive (e.g. خواستن). Omit these three fields when there isn't a meaningful root to surface.

Preserve segment order. Always use the save_translation tool to return your answer — never reply in plain text.`;

const SAVE_TRANSLATION_TOOL = {
  name: 'save_translation',
  description: 'Save the structured 3-lane translation of the Persian segments.',
  input_schema: {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fa:    { type: 'string', description: 'Persian text exactly as given' },
            latin: { type: 'string', description: 'Latin transliteration' },
            en:    { type: 'string', description: 'Natural English translation' },
            words: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fa:         { type: 'string' },
                  latin:      { type: 'string' },
                  en:         { type: 'string' },
                  root:       { type: 'string', description: 'Optional Arabic/Persian root in Persian script' },
                  root_latin: { type: 'string', description: 'Optional root romanized' },
                  root_en:    { type: 'string', description: 'Optional root meaning in English' },
                },
                required: ['fa', 'latin', 'en'],
              },
            },
          },
          required: ['fa', 'latin', 'en', 'words'],
        },
      },
    },
    required: ['segments'],
  },
};

export async function onRequestPost(context) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return errorResponse('ANTHROPIC_API_KEY not configured', 500);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const audioKey = (body?.audioKey || '').trim();
  if (!audioKey) return errorResponse('audioKey is required', 400);

  const row = await context.env.SITE_DB.prepare(
    'SELECT * FROM translation_sessions WHERE audioKey = ?'
  ).bind(audioKey).first();

  if (!row) return errorResponse('Session not found — upload + transcribe first', 404);
  if (!row.transcript) return errorResponse('Transcribe with Whisper first', 400);

  let transcript;
  try {
    transcript = JSON.parse(row.transcript);
  } catch {
    return errorResponse('Saved transcript is corrupted', 500);
  }
  const transcriptSegments = transcript.segments || [];
  if (!transcriptSegments.length) return errorResponse('Transcript has no segments to translate', 400);

  // Resolve the slice [fromIndex, toIndex) — capped at MAX_SLICE so a single
  // Claude call cannot drag the whole endpoint over Cloudflare's 100s budget
  const fromIndex = Math.max(0, Number(body?.fromIndex) | 0);
  const requestedTo = body?.toIndex != null ? Number(body.toIndex) : (fromIndex + DEFAULT_SLICE);
  const toIndex = Math.min(
    transcriptSegments.length,
    Math.max(fromIndex + 1, requestedTo),
    fromIndex + MAX_SLICE,
  );

  if (fromIndex >= transcriptSegments.length) {
    return errorResponse(`fromIndex ${fromIndex} is beyond transcript length ${transcriptSegments.length}`, 400);
  }

  const slice = transcriptSegments.slice(fromIndex, toIndex);
  const sliceTexts = slice.map((s) => (s.text || '').trim()).filter(Boolean);
  if (!sliceTexts.length) return errorResponse('Slice contains no translatable text', 400);

  const now = new Date().toISOString();
  await context.env.SITE_DB.prepare(
    `UPDATE translation_sessions SET status='translating', error='', updatedAt=? WHERE audioKey=?`
  ).bind(now, audioKey).run();

  const userMessage = `Translate these ${sliceTexts.length} Persian segments (slice ${fromIndex + 1}–${toIndex} of ${transcriptSegments.length}). Return one structured entry per segment, preserving order.\n\n` +
    sliceTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');

  let claudeJson;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        tools: [SAVE_TRANSLATION_TOOL],
        tool_choice: { type: 'tool', name: 'save_translation' },
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      await markFailed(context.env.SITE_DB, audioKey, `Claude ${res.status}: ${text.slice(0, 300)}`);
      return errorResponse(`Claude failed (${res.status})`, 502);
    }
    claudeJson = await res.json();
  } catch (e) {
    await markFailed(context.env.SITE_DB, audioKey, `Claude request error: ${e.message}`);
    return errorResponse('Claude request failed', 502);
  }

  const toolUse = (claudeJson.content || []).find((c) => c.type === 'tool_use' && c.name === 'save_translation');
  if (!toolUse?.input?.segments) {
    await markFailed(context.env.SITE_DB, audioKey, 'Claude did not return a save_translation tool call');
    return errorResponse('Claude response missing translation', 502);
  }

  const existing = row.translation ? JSON.parse(row.translation) : null;
  const mergedSegments = mergeTranslationSlice(existing, transcriptSegments, toolUse.input.segments, fromIndex);

  const translation = {
    model: MODEL,
    generatedAt: existing?.generatedAt || now,
    updatedAt: now,
    segments: mergedSegments,
  };

  const isComplete = toIndex >= transcriptSegments.length;
  const nextIndex = isComplete ? null : toIndex;
  const newStatus = isComplete ? 'ready' : 'translating';

  await context.env.SITE_DB.prepare(
    `UPDATE translation_sessions
     SET translation=?, status=?, error='', updatedAt=?
     WHERE audioKey=?`
  ).bind(JSON.stringify(translation), newStatus, now, audioKey).run();

  return jsonResponse({
    ok: true,
    audioKey,
    status: newStatus,
    fromIndex,
    toIndex,
    nextIndex,
    total: transcriptSegments.length,
    translation,
    usage: claudeJson.usage || null,
  });
}

async function markFailed(db, audioKey, msg) {
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `UPDATE translation_sessions SET status='failed', error=?, updatedAt=? WHERE audioKey=?`
    ).bind(msg.slice(0, 500), now, audioKey).run();
  } catch { /* swallow */ }
}
