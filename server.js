const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const db = require("./db");

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

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "unauthenticated" });
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

app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Norlendario listening on port ${port}`);
});
