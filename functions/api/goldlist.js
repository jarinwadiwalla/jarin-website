/**
 * Cloudflare Pages Function — /api/goldlist
 *
 * GET    → list entries with optional filters
 * POST   → create/update, batch add, review, self-rate
 * DELETE → delete entry by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';
import { getReviewIntervalMs, getReviewIntervalDays, reviewDayBucket, hashString } from '../lib/utils.js';
import { summarizeReviewableByLanguage } from '../lib/translation.js';

function rowToEntry(row) {
  return {
    ...row,
    learned: !!row.learned,
    examples: JSON.parse(row.examples || '[]'),
    selfRatings: JSON.parse(row.selfRatings || '[]'),
    lastReviewedAt: row.lastReviewedAt || null,
    learnedAt: row.learnedAt || null,
  };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const langFilter = url.searchParams.get("language");
    const learnedFilter = url.searchParams.get("learned");
    const reviewableFilter = url.searchParams.get("reviewable") === "true";
    const dailyFilter = url.searchParams.get("daily") === "true";

    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM goldlist ORDER BY createdAt DESC"
    ).all();

    const entries = results.map(rowToEntry);

    if (dailyFilter) {
      const candidates = entries.filter((e) => e.word);
      if (candidates.length === 0) {
        return jsonResponse({ entry: null });
      }
      const today = new Date().toISOString().slice(0, 10);
      const index = hashString(today) % candidates.length;
      return jsonResponse({ entry: candidates[index] });
    }

    let filtered = entries;

    if (langFilter) {
      filtered = filtered.filter((e) => e.language === langFilter);
    }
    if (learnedFilter !== null && learnedFilter !== undefined) {
      const wantLearned = learnedFilter === "true";
      filtered = filtered.filter((e) => e.learned === wantLearned);
    }

    const now = Date.now();
    // Client passes tzOffsetMinutes for accurate midnight local-day bucketing
    const tzOffset = parseInt(url.searchParams.get("tzOffset")) || 0;
    const todayBucket = reviewDayBucket(now, tzOffset);
    const isReviewable = (e) => {
      if (e.learned) return false;
      const refMs = new Date(e.lastReviewedAt || e.createdAt).getTime();
      const refBucket = reviewDayBucket(refMs, tzOffset);
      return (todayBucket - refBucket) >= getReviewIntervalDays(e.distillation);
    };
    if (reviewableFilter) {
      filtered = filtered.filter(isReviewable);
    }

    const byLanguage = {};
    const byCategory = {};
    let totalReviews = 0;

    for (const e of entries) {
      const lang = e.language || "unknown";
      byLanguage[lang] = (byLanguage[lang] || 0) + 1;
      if (e.category) {
        byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      }
      totalReviews += e.reviewCount || 0;
    }

    // Count words added today (across all languages) using client's midnight day boundary
    const dayStartParam = url.searchParams.get("dayStart");
    let addedToday = 0;
    if (dayStartParam) {
      const dayStartMs = parseInt(dayStartParam);
      if (!isNaN(dayStartMs)) {
        addedToday = entries.filter(e => new Date(e.createdAt).getTime() >= dayStartMs).length;
      }
    }

    const stats = {
      total: entries.length,
      learned: entries.filter((e) => e.learned).length,
      active: entries.filter((e) => !e.learned).length,
      reviewable: entries.filter(isReviewable).length,
      reviewableByLanguage: summarizeReviewableByLanguage(entries, isReviewable),
      addedToday,
      byLanguage,
      byCategory,
      totalReviews,
    };

    return jsonResponse({ entries: filtered, stats });
  } catch (err) {
    return errorResponse("Failed to load gold list.", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const now = new Date().toISOString();
    // Use client's local date for listId so it matches the user's calendar day
    const localDate = body.localDate || now.slice(0, 10);

    // Self-rate action
    if (body.action === "self-rate") {
      const { id, rating, direction } = body;

      if (!id || !rating) {
        return errorResponse("id and rating are required for self-rate.", 400);
      }

      const row = await context.env.SITE_DB.prepare(
        "SELECT * FROM goldlist WHERE id = ?"
      ).bind(id).first();

      if (!row) {
        return errorResponse("Entry not found.", 404);
      }

      const data = rowToEntry(row);
      data.reviewCount = (data.reviewCount || 0) + 1;

      const ratings = Array.isArray(data.selfRatings) ? data.selfRatings : [];
      ratings.push({ rating, date: now, direction: direction || "forward" });
      if (ratings.length > 20) {
        ratings.splice(0, ratings.length - 20);
      }
      data.selfRatings = ratings;

      await context.env.SITE_DB.prepare(
        "UPDATE goldlist SET reviewCount=?, selfRatings=?, updatedAt=? WHERE id=?"
      ).bind(data.reviewCount, JSON.stringify(data.selfRatings), now, id).run();

      data.updatedAt = now;
      return jsonResponse({ ok: true, entry: data });
    }

    // Review/distill action (with optional self-rating per entry)
    if (body.action === "review" && Array.isArray(body.entries)) {
      const stmts = [];
      for (const entry of body.entries) {
        // Append self-rating if provided
        if (entry.rating) {
          const row = await context.env.SITE_DB.prepare(
            "SELECT selfRatings, reviewCount FROM goldlist WHERE id = ?"
          ).bind(entry.id).first();
          if (row) {
            const ratings = JSON.parse(row.selfRatings || '[]');
            ratings.push({ rating: entry.rating, date: now, direction: entry.direction || 'forward' });
            if (ratings.length > 20) ratings.splice(0, ratings.length - 20);
            stmts.push(
              context.env.SITE_DB.prepare(
                "UPDATE goldlist SET selfRatings=?, reviewCount=?, updatedAt=? WHERE id=?"
              ).bind(JSON.stringify(ratings), (row.reviewCount || 0) + 1, now, entry.id)
            );
          }
        }

        if (entry.learned) {
          stmts.push(
            context.env.SITE_DB.prepare(
              "UPDATE goldlist SET learned=1, learnedAt=?, updatedAt=? WHERE id=?"
            ).bind(now, now, entry.id)
          );
        } else {
          stmts.push(
            context.env.SITE_DB.prepare(
              "UPDATE goldlist SET distillation=distillation+1, lastReviewedAt=?, updatedAt=? WHERE id=?"
            ).bind(now, now, entry.id)
          );
        }
      }
      if (stmts.length > 0) {
        await context.env.SITE_DB.batch(stmts);
      }

      return jsonResponse({ ok: true });
    }

    // Batch add
    if (body.batch && Array.isArray(body.entries)) {
      const language = (body.language || "").trim().toLowerCase();
      const listId = body.listId || `${language}-${localDate}`;
      const created = [];
      const stmts = [];

      for (const item of body.entries) {
        if (!item.word || !item.word.trim()) continue;
        const id = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
        const data = {
          id, word: item.word.trim(),
          translation: (item.translation || "").trim(),
          notes: (item.notes || "").trim(),
          language, listId,
          distillation: 0, learned: false,
          createdAt: now, lastReviewedAt: null, learnedAt: null, updatedAt: now,
          romanization: (item.romanization || "").trim(),
          category: (item.category || "").trim(),
          tags: (item.tags || "").trim(),
          usageNotes: (item.usageNotes || "").trim(),
          culturalNotes: (item.culturalNotes || "").trim(),
          formality: (item.formality || "").trim(),
          difficulty: (item.difficulty || "").trim(),
          partOfSpeech: (item.partOfSpeech || "").trim(),
          audioUrl: (item.audioUrl || "").trim(),
          type: (item.type || "word").trim(),
          examples: Array.isArray(item.examples) ? item.examples : [],
          rootFamily: (item.rootFamily || "").trim(),
          rootLanguage: (item.rootLanguage || "").trim(),
          reviewCount: 0, selfRatings: [],
        };

        stmts.push(
          context.env.SITE_DB.prepare(
            `INSERT INTO goldlist (id, word, translation, notes, language, listId, distillation, learned,
             createdAt, lastReviewedAt, learnedAt, updatedAt, romanization, category, tags, usageNotes,
             culturalNotes, formality, difficulty, partOfSpeech, audioUrl, type, examples, rootFamily,
             rootLanguage, reviewCount, selfRatings) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]')`
          ).bind(
            data.id, data.word, data.translation, data.notes, data.language, data.listId,
            data.createdAt, null, null, data.updatedAt,
            data.romanization, data.category, data.tags, data.usageNotes, data.culturalNotes,
            data.formality, data.difficulty, data.partOfSpeech, data.audioUrl, data.type,
            JSON.stringify(data.examples), data.rootFamily, data.rootLanguage
          )
        );
        created.push(data);
      }

      if (stmts.length > 0) {
        await context.env.SITE_DB.batch(stmts);
      }

      return jsonResponse({ ok: true, count: created.length, entries: created });
    }

    // Single add/update
    const { id, word, translation, notes, language, listId, distillation, learned,
            romanization, category, tags, usageNotes, culturalNotes,
            formality, difficulty, partOfSpeech, audioUrl, type,
            examples, rootFamily, rootLanguage, reviewCount, selfRatings } = body;

    if (!word || !word.trim()) {
      return errorResponse("Word is required.", 400);
    }

    const entryId = id || String(Date.now());
    const lang = (language || "").trim().toLowerCase();

    const existing = await context.env.SITE_DB.prepare(
      "SELECT * FROM goldlist WHERE id = ?"
    ).bind(entryId).first();

    let data;
    if (existing) {
      const prev = rowToEntry(existing);
      const newLang = lang || prev.language;
      let newListId = prev.listId;
      if (newLang !== prev.language && prev.listId && prev.listId.startsWith(prev.language)) {
        newListId = prev.listId.replace(prev.language, newLang);
      }
      data = {
        ...prev,
        word: word.trim(),
        translation: (translation || "").trim(),
        notes: (notes || "").trim(),
        language: newLang,
        listId: listId || newListId,
        learned: learned !== undefined ? !!learned : prev.learned,
        updatedAt: now,
        romanization: romanization !== undefined ? romanization : (prev.romanization ?? ""),
        category: category !== undefined ? category : (prev.category ?? ""),
        tags: tags !== undefined ? tags : (prev.tags ?? ""),
        usageNotes: usageNotes !== undefined ? usageNotes : (prev.usageNotes ?? ""),
        culturalNotes: culturalNotes !== undefined ? culturalNotes : (prev.culturalNotes ?? ""),
        formality: formality !== undefined ? formality : (prev.formality ?? ""),
        difficulty: difficulty !== undefined ? difficulty : (prev.difficulty ?? ""),
        partOfSpeech: partOfSpeech !== undefined ? partOfSpeech : (prev.partOfSpeech ?? ""),
        audioUrl: audioUrl !== undefined ? audioUrl : (prev.audioUrl ?? ""),
        type: type !== undefined ? type : (prev.type ?? "word"),
        examples: examples !== undefined ? examples : (prev.examples ?? []),
        rootFamily: rootFamily !== undefined ? rootFamily : (prev.rootFamily ?? ""),
        rootLanguage: rootLanguage !== undefined ? rootLanguage : (prev.rootLanguage ?? ""),
        reviewCount: reviewCount !== undefined ? reviewCount : (prev.reviewCount ?? 0),
        selfRatings: selfRatings !== undefined ? selfRatings : (prev.selfRatings ?? []),
      };
    } else {
      data = {
        id: entryId, word: word.trim(),
        translation: (translation || "").trim(),
        notes: (notes || "").trim(),
        language: lang,
        listId: listId || `${lang}-${localDate}`,
        distillation: distillation || 0,
        learned: !!learned,
        createdAt: now, lastReviewedAt: null, learnedAt: null, updatedAt: now,
        romanization: (romanization || "").trim(),
        category: (category || "").trim(),
        tags: (tags || "").trim(),
        usageNotes: (usageNotes || "").trim(),
        culturalNotes: (culturalNotes || "").trim(),
        formality: (formality || "").trim(),
        difficulty: (difficulty || "").trim(),
        partOfSpeech: (partOfSpeech || "").trim(),
        audioUrl: (audioUrl || "").trim(),
        type: (type || "word").trim(),
        examples: Array.isArray(examples) ? examples : [],
        rootFamily: (rootFamily || "").trim(),
        rootLanguage: (rootLanguage || "").trim(),
        reviewCount: reviewCount || 0,
        selfRatings: Array.isArray(selfRatings) ? selfRatings : [],
      };
    }

    await context.env.SITE_DB.prepare(
      `INSERT OR REPLACE INTO goldlist (id, word, translation, notes, language, listId, distillation, learned,
       createdAt, lastReviewedAt, learnedAt, updatedAt, romanization, category, tags, usageNotes,
       culturalNotes, formality, difficulty, partOfSpeech, audioUrl, type, examples, rootFamily,
       rootLanguage, reviewCount, selfRatings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.word, data.translation, data.notes, data.language, data.listId,
      data.distillation || 0, data.learned ? 1 : 0,
      data.createdAt || existing?.createdAt || now, data.lastReviewedAt, data.learnedAt, data.updatedAt,
      data.romanization, data.category, data.tags, data.usageNotes, data.culturalNotes,
      data.formality, data.difficulty, data.partOfSpeech, data.audioUrl, data.type,
      JSON.stringify(data.examples), data.rootFamily, data.rootLanguage,
      data.reviewCount, JSON.stringify(data.selfRatings)
    ).run();

    return jsonResponse({ ok: true, entry: data });
  } catch (err) {
    return errorResponse("Failed to save entry.", 500);
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
      "DELETE FROM goldlist WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete entry.", 500);
  }
}
