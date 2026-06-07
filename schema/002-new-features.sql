-- Migration 002: Todos, Intentions, Office Work
-- Run: npx wrangler d1 execute jarin-site --file=schema/002-new-features.sql --remote

-- ── Extend habits table ──
ALTER TABLE habits ADD COLUMN scheduleDays TEXT DEFAULT '';
ALTER TABLE habits ADD COLUMN valueType TEXT DEFAULT '';
ALTER TABLE habits ADD COLUMN valueLabel TEXT DEFAULT '';
ALTER TABLE habits ADD COLUMN ventureId TEXT DEFAULT '';
ALTER TABLE habits ADD COLUMN goalId TEXT DEFAULT '';

-- ── Todos ──
CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    ventureId TEXT DEFAULT '',
    goalId TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    dueDate TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);

-- ── Ventures ──
CREATE TABLE IF NOT EXISTS ventures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#5C6BC0',
    icon TEXT DEFAULT '',
    tagline TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- ── Goals ──
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    ventureIds TEXT DEFAULT '',
    horizon TEXT NOT NULL,
    title TEXT NOT NULL,
    why TEXT DEFAULT '',
    targetDate TEXT DEFAULT '',
    status TEXT DEFAULT 'todo',
    sortOrder INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    size TEXT DEFAULT '',
    blockedBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goals_horizon ON goals(horizon);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

CREATE TABLE IF NOT EXISTS goal_checkins (
    id TEXT PRIMARY KEY,
    goalId TEXT NOT NULL,
    date TEXT NOT NULL,
    progressNote TEXT DEFAULT '',
    value REAL DEFAULT 0,
    createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_goalId ON goal_checkins(goalId);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON goal_checkins(date);

-- ── Office Work ──
CREATE TABLE IF NOT EXISTS office_work_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'work',
    color TEXT DEFAULT '#5C6BC0',
    linkedHabitId TEXT DEFAULT '',
    ventureIds TEXT DEFAULT '',
    sortOrder INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_work_sessions (
    id TEXT PRIMARY KEY,
    categoryId TEXT NOT NULL,
    date TEXT NOT NULL,
    startedAt TEXT NOT NULL,
    endedAt TEXT NOT NULL,
    durationSec INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    goalId TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ows_date ON office_work_sessions(date);
CREATE INDEX IF NOT EXISTS idx_ows_cat ON office_work_sessions(categoryId);
