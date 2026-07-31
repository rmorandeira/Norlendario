require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { getArtistInfo, fetchAndStoreArtistInfo, setManualOverride } = require("./artistInfo");
const { STAGE_COORDS, getRoute, fetchAndStoreRoute } = require("./routes");
const schedule = require("./schedule");
const FESTIVAL_DATA = require("./public/data.js");

const app = express();
app.set("trust proxy", 1); // Railway sits behind a TLS-terminating proxy

const avatarsDir = path.join(__dirname, "public", "uploads", "avatars");
fs.mkdirSync(avatarsDir, { recursive: true });

// Bumped from the 100kb default so a resized avatar photo (sent as a data
// URL) fits — everything else on this API is tiny JSON.
app.use(express.json({ limit: "2mb" }));
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
const favoriteCounts = db.prepare(
  "SELECT act_id, COUNT(*) AS count FROM favorites GROUP BY act_id"
);
const addFavorite = db.prepare(
  "INSERT OR IGNORE INTO favorites (user_id, act_id) VALUES (?, ?)"
);
const removeFavorite = db.prepare(
  "DELETE FROM favorites WHERE user_id = ? AND act_id = ?"
);
const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const getUserById = db.prepare(
  "SELECT id, username, share_token, last_seen_comments_at, first_name, last_name, avatar_path FROM users WHERE id = ?"
);
const updateProfile = db.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?");
const updateAvatarPath = db.prepare("UPDATE users SET avatar_path = ? WHERE id = ?");
const listPeople = db.prepare(`
  SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_path, u.share_token,
         COUNT(f.id) AS attending_count
  FROM users u
  LEFT JOIN favorites f ON f.user_id = u.id
  WHERE u.id != ?
  GROUP BY u.id
  ORDER BY u.username COLLATE NOCASE
`);
const listPeopleFavoriteIds = db.prepare("SELECT followee_id FROM people_favorites WHERE follower_id = ?");
const addPeopleFavorite = db.prepare("INSERT OR IGNORE INTO people_favorites (follower_id, followee_id) VALUES (?, ?)");
const removePeopleFavorite = db.prepare("DELETE FROM people_favorites WHERE follower_id = ? AND followee_id = ?");
const setShareToken = db.prepare("UPDATE users SET share_token = ? WHERE id = ?");
const markCommentsSeen = db.prepare("UPDATE users SET last_seen_comments_at = datetime('now') WHERE id = ?");
const findUserByShareToken = db.prepare("SELECT id, username FROM users WHERE share_token = ?");
const listRouteComments = db.prepare(
  "SELECT id, act_id, author_user_id, author_name, visitor_token, comment, created_at FROM route_comments WHERE owner_id = ? ORDER BY created_at ASC"
);
const insertRouteComment = db.prepare(`
  INSERT INTO route_comments (owner_id, act_id, author_user_id, author_name, visitor_token, comment)
  VALUES (@ownerId, @actId, @authorUserId, @authorName, @visitorToken, @comment)
`);
const getRouteCommentById = db.prepare("SELECT * FROM route_comments WHERE id = ? AND owner_id = ?");
const updateRouteCommentText = db.prepare("UPDATE route_comments SET comment = ? WHERE id = ?");
const deleteRouteCommentById = db.prepare("DELETE FROM route_comments WHERE id = ?");
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

// A comment belongs to whoever authored it: an account holder (compared by
// user id) or, for public-link visitors without an account, whoever holds
// the matching client-generated visitor token.
function canModifyRouteComment(row, viewerUserId, viewerVisitorToken) {
  if (row.author_user_id) return row.author_user_id === viewerUserId;
  return Boolean(viewerVisitorToken) && row.visitor_token === viewerVisitorToken;
}

// lastSeenAt is only meaningful for the owner viewing their own thread
// (GET /api/comments) — everywhere else it's omitted and isNew stays false.
function serializeRouteComment(row, viewerUserId, viewerVisitorToken, lastSeenAt) {
  const mine = canModifyRouteComment(row, viewerUserId, viewerVisitorToken);
  return {
    id: row.id,
    actId: row.act_id,
    authorName: row.author_name,
    comment: row.comment,
    createdAt: row.created_at,
    mine,
    isNew: Boolean(lastSeenAt) && !mine && row.created_at > lastSeenAt
  };
}

function serializeRouteComments(rows, viewerUserId, viewerVisitorToken, lastSeenAt) {
  const map = {};
  rows.forEach((row) => {
    if (!map[row.act_id]) map[row.act_id] = [];
    map[row.act_id].push(serializeRouteComment(row, viewerUserId, viewerVisitorToken, lastSeenAt));
  });
  return map;
}

// The route/artist sweeps take longer than most proxies keep a request
// open (Railway's included), so they run in the background — the endpoint
// returns immediately and progress is polled via /api/admin/sweep-status.
const sweepStatus = {
  routes: { running: false, result: null },
  artists: { running: false, result: null }
};

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
  const user = getUserById.get(req.session.userId);
  if (user.avatar_path) {
    fs.unlink(path.join(__dirname, "public", user.avatar_path.replace(/^\//, "")), () => {});
  }
  deleteUser.run(req.session.userId); // favorites cascade via the FK
  req.session.destroy(() => res.status(204).end());
});

function serializeProfile(user) {
  return {
    username: user.username,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    avatarPath: user.avatar_path || null
  };
}

app.get("/api/profile", requireAuth, (req, res) => {
  res.json(serializeProfile(getUserById.get(req.session.userId)));
});

app.put("/api/profile", requireAuth, (req, res) => {
  const firstName = String(req.body.firstName || "").trim().slice(0, 60);
  const lastName = String(req.body.lastName || "").trim().slice(0, 60);
  updateProfile.run(firstName, lastName, req.session.userId);
  res.json({ firstName, lastName });
});

app.post("/api/profile/avatar", requireAuth, (req, res) => {
  const dataUrl = String(req.body.imageDataUrl || "");
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: "invalid_image" });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: "image_too_large" });

  const user = getUserById.get(req.session.userId);
  if (user.avatar_path) {
    fs.unlink(path.join(__dirname, "public", user.avatar_path.replace(/^\//, "")), () => {});
  }
  const ext = match[1] === "jpg" ? "jpeg" : match[1];
  const fileName = `${req.session.userId}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(avatarsDir, fileName), buffer);
  const avatarPath = "/uploads/avatars/" + fileName;
  updateAvatarPath.run(avatarPath, req.session.userId);
  res.json({ avatarPath });
});

// --- Gente: directory of registered users, public to any signed-in account
// (see the share-link token comment above — this is the one place that
// deliberately makes routes discoverable without the exact link) ---

app.get("/api/people", requireAuth, (req, res) => {
  const rows = listPeople.all(req.session.userId);
  const favoriteIds = new Set(listPeopleFavoriteIds.all(req.session.userId).map((r) => r.followee_id));
  res.json(
    rows.map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name || "",
      lastName: r.last_name || "",
      avatarPath: r.avatar_path || null,
      attendingCount: r.attending_count,
      shareToken: ensureShareToken(r.id, r.share_token),
      isFavorite: favoriteIds.has(r.id)
    }))
  );
});

app.post("/api/people/:id/favorite", requireAuth, (req, res) => {
  addPeopleFavorite.run(req.session.userId, req.params.id);
  res.status(201).json({ ok: true });
});

app.delete("/api/people/:id/favorite", requireAuth, (req, res) => {
  removePeopleFavorite.run(req.session.userId, req.params.id);
  res.status(204).end();
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

// Public aggregate counts (no user identities) so guests can see how popular
// a show is on the calendar even without an account.
app.get("/api/favorites/counts", (req, res) => {
  const rows = favoriteCounts.all();
  const map = {};
  rows.forEach((r) => {
    map[r.act_id] = r.count;
  });
  res.json(map);
});

// --- Comment threads on Mi ruta stops (own route, authenticated) ---

app.get("/api/comments", requireAuth, (req, res) => {
  const user = getUserById.get(req.session.userId);
  const lastSeen = user.last_seen_comments_at || "0000-00-00 00:00:00";
  const rows = listRouteComments.all(req.session.userId);
  res.json(serializeRouteComments(rows, req.session.userId, null, lastSeen));
});

app.post("/api/comments", requireAuth, (req, res) => {
  const actId = String(req.body.actId || "");
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!actId || !comment) return res.status(400).json({ error: "act_id_and_comment_required" });
  const info = insertRouteComment.run({
    ownerId: req.session.userId,
    actId,
    authorUserId: req.session.userId,
    authorName: req.session.username,
    visitorToken: null,
    comment
  });
  const row = getRouteCommentById.get(info.lastInsertRowid, req.session.userId);
  res.status(201).json(serializeRouteComment(row, req.session.userId, null));
});

app.put("/api/comments/:id", requireAuth, (req, res) => {
  const row = getRouteCommentById.get(req.params.id, req.session.userId);
  if (!row || !canModifyRouteComment(row, req.session.userId, null)) {
    return res.status(404).json({ error: "not_found" });
  }
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!comment) return res.status(400).json({ error: "comment_required" });
  updateRouteCommentText.run(comment, row.id);
  res.json(serializeRouteComment({ ...row, comment }, req.session.userId, null));
});

app.delete("/api/comments/:id", requireAuth, (req, res) => {
  const row = getRouteCommentById.get(req.params.id, req.session.userId);
  if (!row || !canModifyRouteComment(row, req.session.userId, null)) {
    return res.status(404).json({ error: "not_found" });
  }
  deleteRouteCommentById.run(row.id);
  res.status(204).end();
});

app.post("/api/comments/mark-read", requireAuth, (req, res) => {
  markCommentsSeen.run(req.session.userId);
  res.status(204).end();
});

// --- Sharing a route publicly: anyone with the link can view it and add
// their own comments, but can only edit/delete comments they authored ---

function ensureShareToken(userId, currentToken) {
  if (currentToken) return currentToken;
  const token = crypto.randomBytes(9).toString("base64url");
  setShareToken.run(token, userId);
  return token;
}

app.get("/api/share-link", requireAuth, (req, res) => {
  const user = getUserById.get(req.session.userId);
  res.json({ token: ensureShareToken(req.session.userId, user.share_token) });
});

app.get("/api/shared/:token", (req, res) => {
  const owner = findUserByShareToken.get(req.params.token);
  if (!owner) return res.status(404).json({ error: "not_found" });
  const favorites = listFavorites.all(owner.id).map((r) => r.act_id);
  const rows = listRouteComments.all(owner.id);
  const visitorToken = String(req.query.visitorToken || "");
  res.json({
    username: owner.username,
    favorites,
    comments: serializeRouteComments(rows, req.session.userId || null, visitorToken)
  });
});

app.post("/api/shared/:token/comments", (req, res) => {
  const owner = findUserByShareToken.get(req.params.token);
  if (!owner) return res.status(404).json({ error: "not_found" });

  const actId = String(req.body.actId || "");
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!actId || !comment) return res.status(400).json({ error: "act_id_and_comment_required" });

  let authorUserId = null;
  let authorName;
  let visitorToken = null;
  if (req.session.userId === owner.id) {
    authorUserId = owner.id;
    authorName = req.session.username;
  } else {
    authorName = String(req.body.authorName || "").trim().slice(0, 40);
    visitorToken = String(req.body.visitorToken || "").trim();
    if (!authorName || !visitorToken) {
      return res.status(400).json({ error: "name_and_visitor_token_required" });
    }
  }

  const info = insertRouteComment.run({ ownerId: owner.id, actId, authorUserId, authorName, visitorToken, comment });
  const row = getRouteCommentById.get(info.lastInsertRowid, owner.id);
  res.status(201).json(serializeRouteComment(row, req.session.userId || null, visitorToken));
});

app.put("/api/shared/:token/comments/:id", (req, res) => {
  const owner = findUserByShareToken.get(req.params.token);
  if (!owner) return res.status(404).json({ error: "not_found" });
  const row = getRouteCommentById.get(req.params.id, owner.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const visitorToken = String(req.body.visitorToken || "");
  if (!canModifyRouteComment(row, req.session.userId || null, visitorToken)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!comment) return res.status(400).json({ error: "comment_required" });
  updateRouteCommentText.run(comment, row.id);
  res.json(serializeRouteComment({ ...row, comment }, req.session.userId || null, visitorToken));
});

app.delete("/api/shared/:token/comments/:id", (req, res) => {
  const owner = findUserByShareToken.get(req.params.token);
  if (!owner) return res.status(404).json({ error: "not_found" });
  const row = getRouteCommentById.get(req.params.id, owner.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const visitorToken = String(req.body.visitorToken || "");
  if (!canModifyRouteComment(row, req.session.userId || null, visitorToken)) {
    return res.status(403).json({ error: "forbidden" });
  }
  deleteRouteCommentById.run(row.id);
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
// time + route geometry between every stage pair. Responds immediately;
// check progress via GET /api/admin/sweep-status.
app.post("/api/admin/sweep-routes", requireAdmin, (req, res) => {
  if (sweepStatus.routes.running) {
    return res.status(409).json({ error: "already_running" });
  }
  sweepStatus.routes.running = true;
  sweepStatus.routes.result = null;
  res.json({ started: true });

  (async () => {
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
    sweepStatus.routes.running = false;
    sweepStatus.routes.result = { swept: results.length, results, finishedAt: new Date().toISOString() };
  })();
});

// One-off remote trigger for the same sweep scripts/sweep-artists.js does
// locally — lets us pre-fill artist_info on a host (e.g. Railway) we can't
// SSH into directly. Same fire-and-forget pattern as sweep-routes above.
app.post("/api/admin/sweep-artists", requireAdmin, (req, res) => {
  if (sweepStatus.artists.running) {
    return res.status(409).json({ error: "already_running" });
  }
  sweepStatus.artists.running = true;
  sweepStatus.artists.result = null;
  res.json({ started: true });

  (async () => {
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
    sweepStatus.artists.running = false;
    sweepStatus.artists.result = { swept: results.length, results, finishedAt: new Date().toISOString() };
  })();
});

app.get("/api/admin/sweep-status", requireAdmin, (req, res) => {
  res.json(sweepStatus);
});

app.get("/api/admin/artists", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM artist_info ORDER BY name COLLATE NOCASE").all();
  res.json(
    rows.map((r) => ({
      name: r.name,
      image: r.image,
      imageOverride: r.image_override,
      description: r.description,
      genres: r.genres ? JSON.parse(r.genres) : [],
      followers: r.followers,
      spotifyUrl: r.spotify_url,
      spotifyVerified: Boolean(r.spotify_verified),
      updatedAt: r.updated_at
    }))
  );
});

// Manual admin edit — stored in image_override/description, separate from
// the Spotify-sourced columns, so a later sweep never overwrites it.
app.put("/api/admin/artists/:name", requireAdmin, (req, res) => {
  const { image, description } = req.body;
  res.json(setManualOverride(req.params.name, { image, description }));
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

// Client-rendered page for a publicly shared route — same SPA shell, the
// client reads the token out of the URL itself.
app.get("/ruta/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Norlendario listening on port ${port}`);
});
