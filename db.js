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

  CREATE TABLE IF NOT EXISTS route_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    act_id TEXT NOT NULL,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    visitor_token TEXT,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_route_comments_owner ON route_comments(owner_id);

  CREATE TABLE IF NOT EXISTS people_favorites (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followee_id)
  );
`);

// Drop columns from an older schema version, if this DB predates the switch
// to Spotify-only artist info (no bio/description scraped from the web).
const existingColumns = db.prepare("PRAGMA table_info(artist_info)").all().map((c) => c.name);
if (existingColumns.includes("bio")) db.exec("ALTER TABLE artist_info DROP COLUMN bio");
if (existingColumns.includes("wikipedia_url")) db.exec("ALTER TABLE artist_info DROP COLUMN wikipedia_url");
if (!existingColumns.includes("image_override")) db.exec("ALTER TABLE artist_info ADD COLUMN image_override TEXT");
if (!existingColumns.includes("description")) db.exec("ALTER TABLE artist_info ADD COLUMN description TEXT");

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("share_token")) {
  db.exec("ALTER TABLE users ADD COLUMN share_token TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_share_token ON users(share_token)");
if (!userColumns.includes("last_seen_comments_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_seen_comments_at TEXT");
}
if (!userColumns.includes("first_name")) {
  db.exec("ALTER TABLE users ADD COLUMN first_name TEXT");
}
if (!userColumns.includes("last_name")) {
  db.exec("ALTER TABLE users ADD COLUMN last_name TEXT");
}
if (!userColumns.includes("avatar_path")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_path TEXT");
}
if (!userColumns.includes("email")) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");
if (!userColumns.includes("consent_ip")) {
  db.exec("ALTER TABLE users ADD COLUMN consent_ip TEXT");
}
if (!userColumns.includes("consent_user_agent")) {
  db.exec("ALTER TABLE users ADD COLUMN consent_user_agent TEXT");
}
if (!userColumns.includes("consent_policy_version")) {
  db.exec("ALTER TABLE users ADD COLUMN consent_policy_version TEXT");
}
if (!userColumns.includes("reset_token")) {
  db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT");
}
if (!userColumns.includes("reset_token_expires_at")) {
  db.exec("ALTER TABLE users ADD COLUMN reset_token_expires_at TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)");
if (!userColumns.includes("google_id")) {
  db.exec("ALTER TABLE users ADD COLUMN google_id TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)");

// One-off migration from the old single-note-per-act act_comments table to
// the threaded route_comments table (personal notes become the owner's
// first thread entry). Safe to run every boot — it's a no-op once the old
// table is gone.
const hasOldCommentsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='act_comments'").get();
if (hasOldCommentsTable) {
  const oldRows = db
    .prepare(
      "SELECT ac.user_id, ac.act_id, ac.comment, ac.updated_at, u.username FROM act_comments ac JOIN users u ON u.id = ac.user_id"
    )
    .all();
  const insertMigrated = db.prepare(`
    INSERT INTO route_comments (owner_id, act_id, author_user_id, author_name, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const migrate = db.transaction((rows) => {
    for (const r of rows) {
      insertMigrated.run(r.user_id, r.act_id, r.user_id, r.username, r.comment, r.updated_at);
    }
    db.exec("DROP TABLE act_comments");
  });
  migrate(oldRows);
}

module.exports = db;
