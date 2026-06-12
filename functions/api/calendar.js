/**
 * Cloudflare Pages Function — /api/calendar
 *
 * Uses D1 (SQLite) for calendar event storage.
 *
 * GET    → list all calendar events
 * POST   → create/update/modify events (action-based routing)
 * DELETE → delete event by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM calendar_events ORDER BY date ASC, startTime ASC"
    ).all();

    const events = results.map(row => ({
      id: row.id,
      title: row.title,
      date: row.date,
      endDate: row.endDate || '',
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: !!row.allDay,
      category: row.category,
      ventureId: row.ventureId || '',
      notes: row.notes,
      recurrence: row.recurrence,
      recurrenceEnd: row.recurrenceEnd,
      exceptions: JSON.parse(row.exceptions || '{}'),
      deletedOccurrences: JSON.parse(row.deletedOccurrences || '[]'),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return jsonResponse({ events });
  } catch (err) {
    return errorResponse("Failed to load calendar events.");
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action || 'save';
    const now = new Date().toISOString();

    if (action === 'save') {
      const id = body.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);

      if (!body.title || !body.title.trim()) {
        return errorResponse("Title is required.", 400);
      }

      const endDate = body.endDate || '';
      if (endDate && body.date && endDate < body.date) {
        return errorResponse("End date must be on or after start date.", 400);
      }

      const existing = await context.env.SITE_DB.prepare(
        "SELECT id, ventureId FROM calendar_events WHERE id = ?"
      ).bind(id).first();

      // Honor partial updates on linkage: omitted ventureId preserves the existing one.
      const nextVentureId = body.ventureId !== undefined
        ? (body.ventureId || '')
        : (existing && existing.ventureId !== undefined ? (existing.ventureId || '') : '');

      if (existing) {
        await context.env.SITE_DB.prepare(
          `UPDATE calendar_events SET title=?, date=?, endDate=?, startTime=?, endTime=?, allDay=?,
           category=?, ventureId=?, notes=?, recurrence=?, recurrenceEnd=?, exceptions=?,
           deletedOccurrences=?, updatedAt=? WHERE id=?`
        ).bind(
          body.title.trim(),
          body.date || '',
          endDate,
          body.startTime || '',
          body.endTime || '',
          body.allDay ? 1 : 0,
          body.category || 'other',
          nextVentureId,
          (body.notes || '').trim(),
          body.recurrence || 'none',
          body.recurrenceEnd || '',
          JSON.stringify(body.exceptions || {}),
          JSON.stringify(body.deletedOccurrences || []),
          now,
          id
        ).run();
      } else {
        await context.env.SITE_DB.prepare(
          `INSERT INTO calendar_events (id, title, date, endDate, startTime, endTime, allDay,
           category, ventureId, notes, recurrence, recurrenceEnd, exceptions, deletedOccurrences,
           createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          body.title.trim(),
          body.date || '',
          endDate,
          body.startTime || '',
          body.endTime || '',
          body.allDay ? 1 : 0,
          body.category || 'other',
          nextVentureId,
          (body.notes || '').trim(),
          body.recurrence || 'none',
          body.recurrenceEnd || '',
          JSON.stringify(body.exceptions || {}),
          JSON.stringify(body.deletedOccurrences || []),
          now,
          now
        ).run();
      }

      return jsonResponse({ ok: true, id });
    }

    if (action === 'edit-occurrence') {
      const { id, occurrenceDate, updates } = body;
      if (!id || !occurrenceDate) {
        return errorResponse("id and occurrenceDate required.", 400);
      }

      const row = await context.env.SITE_DB.prepare(
        "SELECT exceptions FROM calendar_events WHERE id = ?"
      ).bind(id).first();

      if (!row) {
        return errorResponse("Event not found.", 404);
      }

      const exceptions = JSON.parse(row.exceptions || '{}');
      exceptions[occurrenceDate] = updates;

      await context.env.SITE_DB.prepare(
        "UPDATE calendar_events SET exceptions=?, updatedAt=? WHERE id=?"
      ).bind(JSON.stringify(exceptions), now, id).run();

      return jsonResponse({ ok: true });
    }

    if (action === 'delete-occurrence') {
      const { id, occurrenceDate } = body;
      if (!id || !occurrenceDate) {
        return errorResponse("id and occurrenceDate required.", 400);
      }

      const row = await context.env.SITE_DB.prepare(
        "SELECT deletedOccurrences FROM calendar_events WHERE id = ?"
      ).bind(id).first();

      if (!row) {
        return errorResponse("Event not found.", 404);
      }

      const deleted = JSON.parse(row.deletedOccurrences || '[]');
      if (!deleted.includes(occurrenceDate)) deleted.push(occurrenceDate);

      await context.env.SITE_DB.prepare(
        "UPDATE calendar_events SET deletedOccurrences=?, updatedAt=? WHERE id=?"
      ).bind(JSON.stringify(deleted), now, id).run();

      return jsonResponse({ ok: true });
    }

    if (action === 'delete-this-and-future') {
      const { id, occurrenceDate } = body;
      if (!id || !occurrenceDate) {
        return errorResponse("id and occurrenceDate required.", 400);
      }

      const row = await context.env.SITE_DB.prepare(
        "SELECT date, exceptions, deletedOccurrences FROM calendar_events WHERE id = ?"
      ).bind(id).first();

      if (!row) {
        return errorResponse("Event not found.", 404);
      }

      // If the picked date is at or before the series start, nothing remains — hard delete.
      if (occurrenceDate <= row.date) {
        await context.env.SITE_DB.prepare(
          "DELETE FROM calendar_events WHERE id = ?"
        ).bind(id).run();
        return jsonResponse({ ok: true, deleted: true });
      }

      // Otherwise, end the series the day before this occurrence.
      const endDate = new Date(occurrenceDate + 'T12:00:00');
      endDate.setDate(endDate.getDate() - 1);
      const recEnd = endDate.toISOString().split('T')[0];

      // Drop now-irrelevant exceptions / deletedOccurrences past the cutoff.
      const exceptions = JSON.parse(row.exceptions || '{}');
      const cleanedExceptions = {};
      for (const [d, v] of Object.entries(exceptions)) {
        if (d <= recEnd) cleanedExceptions[d] = v;
      }
      const deleted = JSON.parse(row.deletedOccurrences || '[]')
        .filter(d => d <= recEnd);

      await context.env.SITE_DB.prepare(
        "UPDATE calendar_events SET recurrenceEnd=?, exceptions=?, deletedOccurrences=?, updatedAt=? WHERE id=?"
      ).bind(recEnd, JSON.stringify(cleanedExceptions), JSON.stringify(deleted), now, id).run();

      return jsonResponse({ ok: true });
    }

    if (action === 'edit-future') {
      const { id, occurrenceDate, updates } = body;
      if (!id || !occurrenceDate) {
        return errorResponse("id and occurrenceDate required.", 400);
      }

      const row = await context.env.SITE_DB.prepare(
        "SELECT * FROM calendar_events WHERE id = ?"
      ).bind(id).first();

      if (!row) {
        return errorResponse("Event not found.", 404);
      }

      // End original series the day before
      const endDate = new Date(occurrenceDate + 'T12:00:00');
      endDate.setDate(endDate.getDate() - 1);
      const recEnd = endDate.toISOString().split('T')[0];

      await context.env.SITE_DB.prepare(
        "UPDATE calendar_events SET recurrenceEnd=?, updatedAt=? WHERE id=?"
      ).bind(recEnd, now, id).run();

      // Create new event starting from occurrenceDate
      const newId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
      const merged = {
        title: row.title,
        endDate: row.endDate || '',
        startTime: row.startTime,
        endTime: row.endTime,
        allDay: row.allDay,
        category: row.category,
        ventureId: row.ventureId || '',
        notes: row.notes,
        recurrence: row.recurrence,
        ...updates,
      };

      await context.env.SITE_DB.prepare(
        `INSERT INTO calendar_events (id, title, date, endDate, startTime, endTime, allDay,
         category, ventureId, notes, recurrence, recurrenceEnd, exceptions, deletedOccurrences,
         createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?)`
      ).bind(
        newId,
        (merged.title || '').trim(),
        occurrenceDate,
        merged.endDate || '',
        merged.startTime || '',
        merged.endTime || '',
        merged.allDay ? 1 : 0,
        merged.category || 'other',
        merged.ventureId || '',
        (merged.notes || '').trim(),
        merged.recurrence || 'none',
        merged.recurrenceEnd || '',
        now,
        now
      ).run();

      return jsonResponse({ ok: true, id: newId });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    return errorResponse("Failed to save calendar event.");
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
      "DELETE FROM calendar_events WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete calendar event.");
  }
}
