/**
 * Cloudflare Pages Middleware — CORS handler
 *
 * Runs on every request under functions/.
 * - Short-circuits OPTIONS preflight requests with a 204
 * - Adds CORS headers to all other responses
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function corsMiddleware(context) {
  // Handle preflight
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Run downstream handler
  const response = await context.next();

  // Clone response and add CORS headers
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

export const onRequest = [corsMiddleware];
