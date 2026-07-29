// One-time seed: copies the festival lineup from public/data.js into
// festival_days / festival_acts, so the backoffice can edit it from the DB
// instead of a static file. Safe to re-run — no-ops if festival_days
// already has rows.
//
// Usage: node scripts/migrate-schedule-to-db.js

const db = require("../db");
const FESTIVAL_DATA = require("../public/data.js");

function main() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM festival_days").get();
  if (existing.n > 0) {
    console.log(`festival_days already has ${existing.n} row(s) — skipping seed.`);
    return;
  }

  const insertDay = db.prepare(
    "INSERT INTO festival_days (id, weekday, date_num, sort_order) VALUES (?, ?, ?, ?)"
  );
  const insertAct = db.prepare(
    "INSERT INTO festival_acts (day_id, artist, stage, time, tba) VALUES (?, ?, ?, ?, ?)"
  );

  const seed = db.transaction(() => {
    FESTIVAL_DATA.days.forEach((day, i) => {
      insertDay.run(day.id, day.weekday, day.dateNum, i);
      for (const act of day.acts) {
        insertAct.run(day.id, act.artist, act.stage, act.time || null, act.tba ? 1 : 0);
      }
    });
  });
  seed();

  const days = db.prepare("SELECT COUNT(*) AS n FROM festival_days").get().n;
  const acts = db.prepare("SELECT COUNT(*) AS n FROM festival_acts").get().n;
  console.log(`Seeded ${days} days and ${acts} acts into the database.`);
}

main();
