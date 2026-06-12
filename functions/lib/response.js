/**
 * Shared response utilities for API functions.
 *
 * CORS headers are handled globally by _middleware.js.
 * These helpers just standardize JSON responses.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}
