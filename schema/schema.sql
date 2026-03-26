-- Jarin Website — D1 Schema
-- Run: npx wrangler d1 execute jarin-site --file=schema/schema.sql --remote

-- Finances
CREATE TABLE IF NOT EXISTS finances (
    id TEXT PRIMARY KEY,
    price TEXT DEFAULT '',
    product TEXT NOT NULL,
    company TEXT DEFAULT '',
    businessUseCase TEXT DEFAULT '',
    recurringDate TEXT DEFAULT '',
    frequency TEXT DEFAULT 'monthly',
    kind TEXT DEFAULT 'business',
    description TEXT DEFAULT '',
    category TEXT DEFAULT '',
    date TEXT DEFAULT '',
    localAmount TEXT DEFAULT '',
    localCurrency TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- Habits
CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    frequency TEXT DEFAULT 'daily',
    stackGroup TEXT DEFAULT '',
    stackOrder INTEGER DEFAULT 0,
    currentStreak INTEGER DEFAULT 0,
    longestStreak INTEGER DEFAULT 0,
    totalCompletions INTEGER DEFAULT 0,
    lastCompletedDate TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_logs (
    id TEXT PRIMARY KEY,
    habitId TEXT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_unique ON habit_logs(habitId, date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habitId ON habit_logs(habitId);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
CREATE INDEX IF NOT EXISTS idx_habits_status ON habits(status);

-- Blog drafts
CREATE TABLE IF NOT EXISTS blog_drafts (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT DEFAULT '',
    author TEXT DEFAULT 'Jarin',
    excerpt TEXT DEFAULT '',
    image TEXT DEFAULT '',
    body TEXT NOT NULL,
    scheduledAt TEXT,
    updatedAt TEXT NOT NULL
);

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS subscribers (
    email TEXT PRIMARY KEY,
    firstName TEXT DEFAULT '',
    lastName TEXT DEFAULT '',
    subscribedAt TEXT NOT NULL,
    unsubscribed INTEGER DEFAULT 0,
    unsubscribedAt TEXT DEFAULT '',
    resubscribedAt TEXT DEFAULT ''
);

-- Newsletter campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    sentAt TEXT NOT NULL,
    totalSent INTEGER DEFAULT 0,
    totalRecipients INTEGER DEFAULT 0,
    status TEXT DEFAULT 'sent',
    errors TEXT DEFAULT '[]'
);
