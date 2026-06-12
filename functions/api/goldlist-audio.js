/**
 * Cloudflare Pages Function — /api/goldlist-audio
 *
 * POST   → upload a recorded audio blob (multipart/form-data, field "file") to R2
 *          under the `goldlist/` prefix. Returns the streaming URL.
 * DELETE → remove an audio object by key (body { key }).
 *
 * Environment bindings required:
 *   - AUDIO_BUCKET (R2 bucket: jarin-audio)
 */

import { jsonResponse, errorResponse } from "../lib/response.js";

const ALLOWED_TYPES = {
  "audio/webm": ".webm",
  "audio/webm;codecs=opus": ".webm",
  "audio/ogg": ".ogg",
  "audio/ogg;codecs=opus": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

function extFor(mime) {
  if (!mime) return null;
  if (ALLOWED_TYPES[mime]) return ALLOWED_TYPES[mime];
  const base = mime.split(";")[0].trim();
  return ALLOWED_TYPES[base] || null;
}

export async function onRequestPost(context) {
  try {
    if (!context.env.AUDIO_BUCKET) {
      return errorResponse("AUDIO_BUCKET binding not configured", 500);
    }

    const formData = await context.request.formData();
    const file = formData.get("file");
    const entryId = (formData.get("entryId") || "").toString().replace(/[^a-zA-Z0-9_-]/g, "");

    if (!file || !file.name) return errorResponse("No file provided.", 400);

    const ext = extFor(file.type);
    if (!ext) return errorResponse("Unsupported audio type: " + file.type, 400);

    const stamp = Date.now();
    const idPart = entryId || "anon";
    const key = `goldlist/${idPart}-${stamp}${ext}`;
    const arrayBuffer = await file.arrayBuffer();

    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return errorResponse("Recording exceeds 5MB.", 413);
    }

    await context.env.AUDIO_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type.split(";")[0].trim() },
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        size: String(arrayBuffer.byteLength),
        entryId: idPart,
      },
    });

    return jsonResponse({
      ok: true,
      key,
      url: `/api/audio-stream/${key}`,
      size: arrayBuffer.byteLength,
    });
  } catch (err) {
    return errorResponse("Upload failed: " + (err?.message || String(err)));
  }
}

export async function onRequestDelete(context) {
  try {
    if (!context.env.AUDIO_BUCKET) {
      return errorResponse("AUDIO_BUCKET binding not configured", 500);
    }
    const body = await context.request.json();
    const key = (body?.key || "").toString();
    if (!key.startsWith("goldlist/")) {
      return errorResponse("Refusing to delete key outside goldlist/ prefix.", 400);
    }
    await context.env.AUDIO_BUCKET.delete(key);
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Delete failed: " + (err?.message || String(err)));
  }
}
