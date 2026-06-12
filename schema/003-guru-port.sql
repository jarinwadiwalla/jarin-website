-- Migration 003: Guru dashboard port (design + plumbing from bijan-john-website)
-- Purely additive: creates missing tables and columns. Existing data is untouched.
-- Run: npx wrangler d1 execute jarin-site --file=schema/003-guru-port.sql --remote

-- ── Settings (key-value app config) ──
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    languages TEXT DEFAULT '{}',
    calendarCategories TEXT DEFAULT '{}',
    updatedAt TEXT NOT NULL
);

-- ── About page content ──
CREATE TABLE IF NOT EXISTS about (
    id TEXT PRIMARY KEY,
    content TEXT DEFAULT '',
    updatedAt TEXT NOT NULL
);

-- ── Poems ──
CREATE TABLE IF NOT EXISTS poems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    published INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    scheduledAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- ── Media tracker ──
CREATE TABLE IF NOT EXISTS media_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    creator TEXT DEFAULT '',
    status TEXT DEFAULT 'want',
    rating TEXT DEFAULT '',
    genre TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    dateStarted TEXT DEFAULT '',
    dateFinished TEXT DEFAULT '',
    season TEXT DEFAULT '',
    episode TEXT DEFAULT '',
    pages TEXT DEFAULT '',
    album TEXT DEFAULT '',
    language TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- ── Gold List (language vocabulary) ──
CREATE TABLE IF NOT EXISTS goldlist (
    id TEXT PRIMARY KEY,
    word TEXT NOT NULL,
    translation TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    language TEXT DEFAULT '',
    listId TEXT DEFAULT '',
    distillation INTEGER DEFAULT 0,
    learned INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    lastReviewedAt TEXT,
    learnedAt TEXT,
    updatedAt TEXT NOT NULL,
    romanization TEXT DEFAULT '',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    usageNotes TEXT DEFAULT '',
    culturalNotes TEXT DEFAULT '',
    formality TEXT DEFAULT '',
    difficulty TEXT DEFAULT '',
    partOfSpeech TEXT DEFAULT '',
    audioUrl TEXT DEFAULT '',
    type TEXT DEFAULT 'word',
    examples TEXT DEFAULT '[]',
    rootFamily TEXT DEFAULT '',
    rootLanguage TEXT DEFAULT '',
    reviewCount INTEGER DEFAULT 0,
    selfRatings TEXT DEFAULT '[]'
);

-- ── Calendar ──
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    endDate TEXT DEFAULT '',
    startTime TEXT DEFAULT '',
    endTime TEXT DEFAULT '',
    allDay INTEGER DEFAULT 0,
    category TEXT DEFAULT 'other',
    notes TEXT DEFAULT '',
    recurrence TEXT DEFAULT 'none',
    recurrenceEnd TEXT DEFAULT '',
    exceptions TEXT DEFAULT '{}',
    deletedOccurrences TEXT DEFAULT '[]',
    ventureId TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_calendar_category ON calendar_events(category);

-- ── Workouts & body ──
CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    name TEXT DEFAULT '',
    type TEXT DEFAULT 'custom',
    notes TEXT DEFAULT '',
    durationMinutes INTEGER DEFAULT 0,
    bodyweightKg REAL DEFAULT 0,
    exercises TEXT DEFAULT '[]',
    totalVolumeKg REAL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_workouts_type ON workouts(type);

CREATE TABLE IF NOT EXISTS body_measurements (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    weightKg REAL DEFAULT 0,
    bodyFatPct REAL DEFAULT 0,
    chest REAL DEFAULT 0,
    waist REAL DEFAULT 0,
    hips REAL DEFAULT 0,
    bicepL REAL DEFAULT 0,
    bicepR REAL DEFAULT 0,
    thighL REAL DEFAULT 0,
    thighR REAL DEFAULT 0,
    shoulders REAL DEFAULT 0,
    neck REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_measurements_date ON body_measurements(date);

CREATE TABLE IF NOT EXISTS daily_steps (
    date TEXT PRIMARY KEY,
    steps INTEGER DEFAULT 0,
    goal INTEGER DEFAULT 8000,
    distance REAL DEFAULT 0,
    source TEXT DEFAULT 'manual',
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blood_markers (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    marker TEXT NOT NULL,
    value REAL NOT NULL,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blood_markers_date ON blood_markers(date);
CREATE INDEX IF NOT EXISTS idx_blood_markers_marker ON blood_markers(marker);

CREATE TABLE IF NOT EXISTS sex_log (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    selfOrgasms INTEGER DEFAULT 0,
    partnerOrgasms INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sex_log_date ON sex_log(date);

-- ── Translation sessions ──
CREATE TABLE IF NOT EXISTS translation_sessions (
    audioKey     TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    durationSec  INTEGER DEFAULT 0,
    language     TEXT DEFAULT 'fa',
    status       TEXT DEFAULT 'uploaded',
    transcript   TEXT,
    translation  TEXT,
    error        TEXT DEFAULT '',
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_translation_status ON translation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_translation_updated ON translation_sessions(updatedAt);

-- ── Blog comments ──
CREATE TABLE IF NOT EXISTS blog_comments (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    parent_id TEXT DEFAULT '',
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    notify_replies INTEGER DEFAULT 0,
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_slug ON blog_comments(slug);
CREATE INDEX IF NOT EXISTS idx_comments_status ON blog_comments(status);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON blog_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_slug_status ON blog_comments(slug, status);
CREATE INDEX IF NOT EXISTS idx_comments_ip_created ON blog_comments(ip_address, createdAt);

-- ── Audio playlist order ──
CREATE TABLE IF NOT EXISTS audio_order (
    playlist TEXT PRIMARY KEY,
    track_order TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- ── Column additions to existing tables (verified missing on live DB 2026-06-12) ──
ALTER TABLE finances ADD COLUMN groupTag TEXT DEFAULT '';
ALTER TABLE habit_logs ADD COLUMN value REAL DEFAULT 0;
ALTER TABLE goals ADD COLUMN ventureId TEXT DEFAULT '';
ALTER TABLE goals ADD COLUMN targetValue REAL DEFAULT 0;
ALTER TABLE goals ADD COLUMN parentGoalId TEXT DEFAULT '';
ALTER TABLE office_work_categories ADD COLUMN ventureId TEXT DEFAULT '';
ALTER TABLE subscribers ADD COLUMN preferences TEXT DEFAULT 'blog';
