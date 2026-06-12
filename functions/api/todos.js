/**
 * Cloudflare Pages Function — /api/todos
 *
 * GET    → list all todos
 * POST   → create/update a todo
 * DELETE → delete a todo by id
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.SITE_DB.prepare(
      "SELECT * FROM todos ORDER BY createdAt DESC"
    ).all();

    const todos = results.map(row => ({
      ...row,
      completed: !!row.completed,
    }));

    return jsonResponse({ todos });
  } catch (err) {
    return errorResponse("Failed to load todos.");
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { id, text, completed, ventureId, goalId, priority, dueDate } = body;

    if (!text || !text.trim()) {
      return errorResponse("Text is required.", 400);
    }

    const todoId = id || String(Date.now());
    const now = new Date().toISOString();

    const existing = await context.env.SITE_DB.prepare(
      "SELECT * FROM todos WHERE id = ?"
    ).bind(todoId).first();

    // Honor partial updates: if a linkage field is omitted, keep the existing value.
    const nextVentureId = ventureId !== undefined ? (ventureId || '') : (existing ? (existing.ventureId || '') : '');
    const nextGoalId    = goalId    !== undefined ? (goalId    || '') : (existing ? (existing.goalId    || '') : '');
    const nextPriority  = priority  !== undefined ? (parseInt(priority) || 0) : (existing ? (existing.priority || 0) : 0);
    const nextDueDate   = dueDate   !== undefined ? (dueDate   || '') : (existing ? (existing.dueDate   || '') : '');

    if (existing) {
      await context.env.SITE_DB.prepare(
        "UPDATE todos SET text=?, completed=?, ventureId=?, goalId=?, priority=?, dueDate=?, updatedAt=? WHERE id=?"
      ).bind(text.trim(), completed ? 1 : 0, nextVentureId, nextGoalId, nextPriority, nextDueDate, now, todoId).run();
    } else {
      await context.env.SITE_DB.prepare(
        "INSERT INTO todos (id, text, completed, ventureId, goalId, priority, dueDate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(todoId, text.trim(), completed ? 1 : 0, nextVentureId, nextGoalId, nextPriority, nextDueDate, now, now).run();
    }

    const data = {
      id: todoId,
      text: text.trim(),
      completed: !!completed,
      ventureId: nextVentureId,
      goalId: nextGoalId,
      priority: nextPriority,
      dueDate: nextDueDate,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    return jsonResponse({ ok: true, todo: data });
  } catch (err) {
    return errorResponse("Failed to save todo.");
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
      "DELETE FROM todos WHERE id = ?"
    ).bind(id).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse("Failed to delete todo.");
  }
}
