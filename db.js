const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Railway's filesystem is ephemeral across redeploys unless a volume is
// mounted at DATA_DIR — point it at a volume in production to persist data.
const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "norlendario.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    act_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, act_id)
  );

  CREATE TABLE IF NOT EXISTS artist_info (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    image TEXT,
    genres TEXT,
    followers INTEGER,
    spotify_url TEXT,
    spotify_verified INTEGER NOT NULL DEFAULT 0,
    image_override TEXT,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stage_routes (
    pair_key TEXT PRIMARY KEY,
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    minutes REAL,
    geometry TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS festival_days (
    id TEXT PRIMARY KEY,
    weekday TEXT NOT NULL,
    date_num INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS festival_acts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id TEXT NOT NULL REFERENCES festival_days(id) ON DELETE CASCADE,
    artist TEXT NOT NULL,
    stage TEXT NOT NULL,
    time TEXT,
    tba INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS act_comments (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    act_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, act_id)
  );
`);

// Drop columns from an older schema version, if this DB predates the switch
// to Spotify-only artist info (no bio/description scraped from the web).
const existingColumns = db.prepare("PRAGMA table_info(artist_info)").all().map((c) => c.name);
if (existingColumns.includes("bio")) db.exec("ALTER TABLE artist_info DROP COLUMN bio");
if (existingColumns.includes("wikipedia_url")) db.exec("ALTER TABLE artist_info DROP COLUMN wikipedia_url");
if (!existingColumns.includes("image_override")) db.exec("ALTER TABLE artist_info ADD COLUMN image_override TEXT");
if (!existingColumns.includes("description")) db.exec("ALTER TABLE artist_info ADD COLUMN description TEXT");

module.exports = db;
