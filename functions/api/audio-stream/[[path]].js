/**
 * Cloudflare Pages Function — /api/audio-stream/[[path]]
 *
 * Serves audio files from R2 with range request support for seeking.
 *
 * Environment bindings required:
 *   - AUDIO_BUCKET (R2 bucket: jarin-audio)
 */

export async function onRequestGet(context) {
  try {
    const key = context.params.path?.join("/");

    if (!key) {
      return new Response("Not found", { status: 404 });
    }

    if (!context.env.AUDIO_BUCKET) {
      return new Response("AUDIO_BUCKET binding not configured", { status: 500 });
    }

    const rangeHeader = context.request.headers.get("Range");

    const object = rangeHeader
      ? await context.env.AUDIO_BUCKET.get(key, { range: context.request.headers })
      : await context.env.AUDIO_BUCKET.get(key);

    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "audio/mpeg");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    if (rangeHeader && object.range) {
      const { offset, length } = object.range;
      const end = offset + length - 1;
      headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
      headers.set("Content-Length", String(length));
      return new Response(object.body, { status: 206, headers });
    }

    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    return new Response("Stream error: " + (err?.message || String(err)), {
      status: 500,
    });
  }
}

// CORS preflight handled by _middleware.js

export async function onRequestHead(context) {
  const key = context.params.path?.join("/");
  if (!key) return new Response(null, { status: 404 });

  const object = await context.env.AUDIO_BUCKET.head(key);
  if (!object) return new Response(null, { status: 404 });

  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "audio/mpeg",
      "Content-Length": String(object.size),
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
