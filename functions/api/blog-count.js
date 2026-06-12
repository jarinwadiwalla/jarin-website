/**
 * Cloudflare Pages Function — /api/blog-count
 *
 * GET → returns { count: N } for published blog posts
 *       Counts .md files in blog/posts/ via GitLab Repository Tree API
 *
 * Environment bindings required:
 *   - GITLAB_TOKEN (secret)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const GITLAB_PROJECT = "jarinwadiwalla%2Fjarin-website";
const GITLAB_API = "https://gitlab.com/api/v4";

export async function onRequestGet(context) {
  try {
    const token = context.env.GITLAB_TOKEN;
    if (!token) {
      // Return 0 instead of error — non-critical stat
      return jsonResponse({ count: 0 });
    }

    const res = await fetch(
      `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/tree?path=blog/posts&per_page=100&ref=main`,
      { headers: { "PRIVATE-TOKEN": token } }
    );

    if (!res.ok) {
      // Degrade gracefully — non-critical stat shouldn't surface as a 502 in the dashboard
      return jsonResponse({ count: 0 });
    }

    const files = await res.json();
    const mdFiles = files.filter(f => f.type === "blob" && f.name.endsWith(".md"));

    return jsonResponse({ count: mdFiles.length });
  } catch (err) {
    return jsonResponse({ count: 0 });
  }
}
