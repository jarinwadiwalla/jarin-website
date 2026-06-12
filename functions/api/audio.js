/**
 * Cloudflare Pages Function — /api/audio
 *
 * POST   → upload audio file(s) to R2 (multipart/form-data)
 * GET    → list audio files (optional ?playlist=xxx)
 * PATCH  → move a track to a different playlist
 * DELETE → delete audio file by key
 *
 * Environment bindings required:
 *   - AUDIO_BUCKET (R2 bucket: jarin-audio)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const ALLOWED_TYPES = {
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/flac": ".flac",
  "audio/x-m4a": ".m4a",
};

function sanitize(str) {
  return str
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const playlist = formData.get("playlist") || "default";
    const sanitizedPlaylist = sanitize(playlist) || "default";

    // Collect all file entries
    const files = formData.getAll("file");
    if (!files.length || !files[0].name) {
      return errorResponse("No files provided.", 400);
    }

    const results = [];
    for (const file of files) {
      if (!file.name) continue;

      const ext = ALLOWED_TYPES[file.type];
      if (!ext) {
        results.push({ name: file.name, error: "Unsupported type: " + file.type });
        continue;
      }

      const baseName = sanitize(file.name) || "audio";
      const key = `${sanitizedPlaylist}/${baseName}${ext}`;
      const arrayBuffer = await file.arrayBuffer();

      await context.env.AUDIO_BUCKET.put(key, arrayBuffer, {
        httpMetadata: { contentType: file.type },
        customMetadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          size: String(arrayBuffer.byteLength),
          playlist: sanitizedPlaylist,
        },
      });

      results.push({
        name: file.name,
        key,
        url: `/api/audio-stream/${key}`,
        size: arrayBuffer.byteLength,
      });
    }

    return jsonResponse({ ok: true, uploaded: results });
  } catch (err) {
    return errorResponse("Upload failed.");
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const playlist = url.searchParams.get("playlist");
    const prefix = playlist ? `${sanitize(playlist)}/` : "";

    const listed = await context.env.AUDIO_BUCKET.list({ prefix, limit: 1000 });

    // Group by playlist (first path segment)
    const tracks = [];
    const playlists = new Set();

    for (const obj of listed.objects) {
      const parts = obj.key.split("/");
      const pl = parts[0] || "default";
      playlists.add(pl);

      const fileName = parts.slice(1).join("/");
      tracks.push({
        key: obj.key,
        url: `/api/audio-stream/${obj.key}`,
        name: obj.customMetadata?.originalName || fileName,
        playlist: pl,
        size: obj.size,
        uploaded: obj.uploaded,
      });
    }

    return jsonResponse({ tracks, playlists: [...playlists].sort() });
  } catch (err) {
    return errorResponse("Failed to list audio.");
  }
}

export async function onRequestPatch(context) {
  try {
    const body = await context.request.json();
    const { key, newPlaylist } = body;

    if (!key || !newPlaylist) {
      return errorResponse("key and newPlaylist are required.", 400);
    }

    const sanitizedPlaylist = sanitize(newPlaylist) || "default";
    const fileName = key.split("/").slice(1).join("/");
    const newKey = `${sanitizedPlaylist}/${fileName}`;

    if (newKey === key) {
      return errorResponse("Track is already in that playlist.", 400);
    }

    // Get existing object
    const obj = await context.env.AUDIO_BUCKET.get(key);
    if (!obj) {
      return errorResponse("Track not found.", 404);
    }

    // Copy to new key with updated metadata
    const arrayBuffer = await obj.arrayBuffer();
    await context.env.AUDIO_BUCKET.put(newKey, arrayBuffer, {
      httpMetadata: obj.httpMetadata,
      customMetadata: {
        ...obj.customMetadata,
        playlist: sanitizedPlaylist,
      },
    });

    // Delete old key
    await context.env.AUDIO_BUCKET.delete(key);

    return jsonResponse({ ok: true, oldKey: key, newKey, playlist: sanitizedPlaylist });
  } catch (err) {
    return errorResponse("Failed to move track.");
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { key } = body;

    if (!key) {
      return errorResponse("Key is required.", 400);
    }

    await context.env.AUDIO_BUCKET.delete(key);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete.");
  }
}
