require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { getArtistInfo, fetchAndStoreArtistInfo } = require("./artistInfo");
const { STAGE_COORDS, getRoute, fetchAndStoreRoute } = require("./routes");
const schedule = require("./schedule");
const FESTIVAL_DATA = require("./public/data.js");

const app = express();
app.set("trust proxy", 1); // Railway sits behind a TLS-terminating proxy

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash) VALUES (?, ?)"
);
const findUserByUsername = db.prepare(
  "SELECT * FROM users WHERE username = ?"
);
const listFavorites = db.prepare(
  "SELECT act_id FROM favorites WHERE user_id = ?"
);
const addFavorite = db.prepare(
  "INSERT OR IGNORE INTO favorites (user_id, act_id) VALUES (?, ?)"
);
const removeFavorite = db.prepare(
  "DELETE FROM favorites WHERE user_id = ? AND act_id = ?"
);
const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const listUsersStmt = db.prepare(`
  SELECT users.id, users.username, users.created_at, COUNT(favorites.id) AS favorite_count
  FROM users
  LEFT JOIN favorites ON favorites.user_id = users.id
  GROUP BY users.id
  ORDER BY users.created_at DESC
`);
const deleteUserByIdStmt = db.prepare("DELETE FROM users WHERE id = ?");

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || req.get("x-admin-secret") !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.post("/api/auth/signup", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "username_length" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "password_length" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  let userId;
  try {
    userId = insertUser.run(username, passwordHash).lastInsertRowid;
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "username_taken" });
    }
    throw err;
  }

  req.session.userId = userId;
  req.session.username = username;
  res.json({ username });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = findUserByUsername.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.get("/api/auth/me", (req, res) => {
  res.json({ username: req.session.username || null });
});

app.delete("/api/auth/account", requireAuth, (req, res) => {
  deleteUser.run(req.session.userId); // favorites cascade via the FK
  req.session.destroy(() => res.status(204).end());
});

app.get("/api/favorites", requireAuth, (req, res) => {
  const rows = listFavorites.all(req.session.userId);
  res.json(rows.map((r) => r.act_id));
});

app.post("/api/favorites", requireAuth, (req, res) => {
  const actId = String(req.body.actId || "");
  if (!actId) return res.status(400).json({ error: "act_id_required" });
  addFavorite.run(req.session.userId, actId);
  res.status(201).json({ ok: true });
});

app.delete("/api/favorites/:actId", requireAuth, (req, res) => {
  removeFavorite.run(req.session.userId, req.params.actId);
  res.status(204).end();
});

app.get("/api/artist-info", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name_required" });
  try {
    res.json(await getArtistInfo(name));
  } catch {
    res.status(502).json({ error: "lookup_failed" });
  }
});

app.get("/api/route-between", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!STAGE_COORDS[from] || !STAGE_COORDS[to]) {
    return res.status(400).json({ error: "unknown_stage" });
  }
  res.json(getRoute(from, to));
});

app.get("/api/festival-data", (req, res) => {
  res.json(schedule.getFestivalData());
});

// One-off remote trigger for scripts/sweep-routes.js — precomputes walking
// time + route geometry between every stage pair.
app.post("/api/admin/sweep-routes", requireAdmin, async (req, res) => {
  const stages = Object.keys(STAGE_COORDS);
  const results = [];
  for (let i = 0; i < stages.length; i++) {
    for (let j = i + 1; j < stages.length; j++) {
      try {
        const { minutes } = await fetchAndStoreRoute(stages[i], stages[j]);
        results.push({ from: stages[i], to: stages[j], minutes });
      } catch (err) {
        results.push({ from: stages[i], to: stages[j], error: err.message });
      }
    }
  }
  res.json({ swept: results.length, results });
});

// One-off remote trigger for the same sweep scripts/sweep-artists.js does
// locally — lets us pre-fill artist_info on a host (e.g. Railway) we can't
// SSH into directly.
app.post("/api/admin/sweep-artists", requireAdmin, async (req, res) => {
  const names = new Set(schedule.listActsForAdmin().map((a) => a.artist));

  const results = [];
  for (const name of names) {
    try {
      const info = await fetchAndStoreArtistInfo(name);
      results.push({ name, spotifyVerified: info.spotifyVerified });
    } catch (err) {
      results.push({ name, error: err.message });
    }
  }

  res.json({ swept: results.length, results });
});

app.get("/api/admin/artists", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM artist_info ORDER BY name COLLATE NOCASE").all();
  res.json(
    rows.map((r) => ({
      name: r.name,
      image: r.image,
      genres: r.genres ? JSON.parse(r.genres) : [],
      followers: r.followers,
      spotifyUrl: r.spotify_url,
      spotifyVerified: Boolean(r.spotify_verified),
      updatedAt: r.updated_at
    }))
  );
});

app.post("/api/admin/artists/:name/regenerate", requireAdmin, async (req, res) => {
  try {
    const info = await fetchAndStoreArtistInfo(req.params.name);
    res.json(info);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json(
    listUsersStmt.all().map((r) => ({
      id: r.id,
      username: r.username,
      createdAt: r.created_at,
      favoriteCount: r.favorite_count
    }))
  );
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  deleteUserByIdStmt.run(req.params.id); // favorites cascade via the FK
  res.status(204).end();
});

app.get("/api/admin/days", requireAdmin, (req, res) => {
  res.json(schedule.listDays());
});

// One-off remote trigger for scripts/migrate-schedule-to-db.js — seeds
// festival_days/festival_acts from public/data.js. No-ops if already seeded.
app.post("/api/admin/migrate-schedule", requireAdmin, (req, res) => {
  res.json(schedule.seedFromStaticData());
});

app.get("/api/admin/acts", requireAdmin, (req, res) => {
  res.json(schedule.listActsForAdmin());
});

app.post("/api/admin/acts", requireAdmin, (req, res) => {
  const { dayId, artist, stage, time, tba } = req.body;
  if (!dayId || !artist || !stage) {
    return res.status(400).json({ error: "day_artist_stage_required" });
  }
  res.status(201).json(schedule.createAct({ dayId, artist, stage, time: time || null, tba: Boolean(tba) }));
});

app.put("/api/admin/acts/:id", requireAdmin, (req, res) => {
  const { dayId, artist, stage, time, tba } = req.body;
  if (!dayId || !artist || !stage) {
    return res.status(400).json({ error: "day_artist_stage_required" });
  }
  res.json(schedule.updateAct(req.params.id, { dayId, artist, stage, time: time || null, tba: Boolean(tba) }));
});

app.delete("/api/admin/acts/:id", requireAdmin, (req, res) => {
  schedule.deleteAct(req.params.id);
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Norlendario listening on port ${port}`);
});
