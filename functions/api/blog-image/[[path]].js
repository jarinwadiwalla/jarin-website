/**
 * Cloudflare Pages Function — /api/blog-image/[[path]]
 *
 * Serves images from R2 bucket with proper content-type and caching.
 *
 * Environment bindings required:
 *   - BLOG_IMAGES (R2 bucket)
 */

export async function onRequestGet(context) {
  const key = context.params.path?.join("/");

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  const object = await context.env.BLOG_IMAGES.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  const url = new URL(context.request.url);
  if (url.searchParams.get("download") === "1") {
    const filename = key.split("/").pop() || "file";
    const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    const encoded = encodeURIComponent(filename);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
    );
  }

  return new Response(object.body, { headers });
}
