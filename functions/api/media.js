/**
 * Cloudflare Pages Function — /api/media
 *
 * GET    → list all media entries
 * POST   → create or update a media entry
 * DELETE → delete entry by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM media_entries ORDER BY updatedAt DESC"
    ).all();

    return jsonResponse({ entries: results });
  } catch (err) {
    return errorResponse("Failed to load media.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();

    const { id, type, title, creator, status, rating, genre, notes,
            dateStarted, dateFinished, season, episode, pages, album, language } = body;

    if (!title || !title.trim()) {
      return errorResponse("Title is required.", 400);
    }

    if (!type || !['book', 'movie', 'show', 'music'].includes(type)) {
      return errorResponse("Type must be book, movie, show, or music.", 400);
    }

    const entryId = id || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);

    const existing = await context.env.SITE_DB.prepare(
      "SELECT * FROM media_entries WHERE id = ?"
    ).bind(entryId).first();

    let data;
    if (existing) {
      data = {
        ...existing,
        type: type || existing.type,
        title: title.trim(),
        creator: (creator || "").trim(),
        status: (status || existing.status || "want").trim(),
        rating: rating !== undefined ? rating : (existing.rating || ""),
        genre: (genre || "").trim(),
        notes: notes !== undefined ? (notes || "").trim() : (existing.notes || ""),
        dateStarted: dateStarted !== undefined ? (dateStarted || "").trim() : (existing.dateStarted || ""),
        dateFinished: dateFinished !== undefined ? (dateFinished || "").trim() : (existing.dateFinished || ""),
        season: season !== undefined ? season : (existing.season || ""),
        episode: episode !== undefined ? episode : (existing.episode || ""),
        pages: pages !== undefined ? pages : (existing.pages || ""),
        album: album !== undefined ? (album || "").trim() : (existing.album || ""),
        language: language !== undefined ? (language || "").trim() : (existing.language || ""),
        updatedAt: now,
      };
    } else {
      data = {
        id: entryId, type, title: title.trim(),
        creator: (creator || "").trim(),
        status: (status || "want").trim(),
        rating: rating || "", genre: (genre || "").trim(),
        notes: (notes || "").trim(),
        dateStarted: (dateStarted || "").trim(),
        dateFinished: (dateFinished || "").trim(),
        season: season || "", episode: episode || "",
        pages: pages || "", album: (album || "").trim(),
        language: (language || "").trim(),
        createdAt: now, updatedAt: now,
      };
    }

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO media_entries (id, type, title, creator, status, rating, genre, notes,
       dateStarted, dateFinished, season, episode, pages, album, language, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.type, data.title, data.creator, data.status, data.rating,
      data.genre, data.notes, data.dateStarted, data.dateFinished,
      data.season, data.episode, data.pages, data.album, data.language || "",
      data.createdAt || existing?.createdAt || now, data.updatedAt
    ).run();

    return jsonResponse({ ok: true, entry: data });
  } catch (err) {
    return errorResponse("Failed to save media entry.", 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const { id } = body;

    if (!id) {
      return errorResponse("Must include id.", 400);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM media_entries WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete media entry.", 500);
  }
}
