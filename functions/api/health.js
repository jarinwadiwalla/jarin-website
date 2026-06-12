/**
 * Cloudflare Pages Function — /api/health
 *
 * GET → checks D1, KV, and R2 bindings are accessible
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - SITE_KV (KV namespace)
 *   - BLOG_IMAGES (R2 bucket)
 *   - AUDIO_BUCKET (R2 bucket)
 */

export async function onRequestGet(context) {
  const checks = {};
  let allOk = true;

  // D1
  try {
    const row = await context.env.SITE_DB.prepare(
      "SELECT COUNT(*) as c FROM settings"
    ).first();
    checks.d1 = { ok: true, detail: `settings rows: ${row.c}` };
  } catch (e) {
    checks.d1 = { ok: false, detail: e?.message || String(e) };
    allOk = false;
  }

  // KV
  try {
    const list = await context.env.SITE_KV.list({ limit: 1 });
    checks.kv = { ok: true, detail: `accessible (${list.keys.length >= 0 ? 'connected' : 'empty'})` };
  } catch (e) {
    checks.kv = { ok: false, detail: e?.message || String(e) };
    allOk = false;
  }

  // R2 — Blog Images
  try {
    const list = await context.env.BLOG_IMAGES.list({ limit: 1 });
    checks.r2_blog_images = { ok: true, detail: `accessible` };
  } catch (e) {
    checks.r2_blog_images = { ok: false, detail: e?.message || String(e) };
    allOk = false;
  }

  // R2 — Audio
  try {
    const list = await context.env.AUDIO_BUCKET.list({ limit: 1 });
    checks.r2_audio = { ok: true, detail: `accessible` };
  } catch (e) {
    checks.r2_audio = { ok: false, detail: e?.message || String(e) };
    allOk = false;
  }

  const status = allOk ? 200 : 503;

  return new Response(
    JSON.stringify({
      status: allOk ? "healthy" : "degraded",
      version: "4.0.2",
      timestamp: new Date().toISOString(),
      checks,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
