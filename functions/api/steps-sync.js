/**
 * Cloudflare Pages Function — /api/steps-sync
 *
 * Triggers the garmin-sync GitHub Actions workflow to fetch fresh step data.
 *
 * POST → dispatch the sync-steps.yml workflow
 *
 * Reads the GitHub PAT from the settings table (key: githubPat).
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const days = body.days || 1;

    // Read GitHub PAT from settings (stored in the 'data' JSON column)
    const row = await context.env.SITE_DB.prepare(
      "SELECT data FROM settings WHERE id = 'main'"
    ).first();

    if (!row || !row.data) {
      return errorResponse("Settings not found. Save a GitHub PAT in settings first.", 400);
    }

    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      data = {};
    }

    const pat = data.githubPat || '';
    if (!pat) {
      return errorResponse("GitHub PAT not configured in settings.", 400);
    }

    // Dispatch the GitHub Actions workflow
    const resp = await fetch(
      'https://api.github.com/repos/JarinJohn/garmin-sync/actions/workflows/sync-steps.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'jarin-website',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { days: String(days) },
        }),
      }
    );

    if (resp.status === 204) {
      return jsonResponse({ ok: true, message: 'Sync triggered. Steps will update in ~30 seconds.' });
    }

    const errText = await resp.text();
    return errorResponse(`GitHub API error (${resp.status}): ${errText}`, resp.status);
  } catch (err) {
    return errorResponse("Failed to trigger sync.");
  }
}
