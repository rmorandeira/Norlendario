const db = require("./db");
const FESTIVAL_DATA = require("./public/data.js");

const listDaysStmt = db.prepare("SELECT * FROM festival_days ORDER BY sort_order");
const listActsForDayStmt = db.prepare("SELECT * FROM festival_acts WHERE day_id = ? ORDER BY tba, time");
const listAllActsStmt = db.prepare(`
  SELECT festival_acts.*, festival_days.weekday, festival_days.date_num, festival_days.sort_order
  FROM festival_acts
  JOIN festival_days ON festival_days.id = festival_acts.day_id
  ORDER BY festival_days.sort_order, festival_acts.tba, festival_acts.time
`);
const getActStmt = db.prepare("SELECT * FROM festival_acts WHERE id = ?");
const insertActStmt = db.prepare(
  "INSERT INTO festival_acts (day_id, artist, stage, time, tba) VALUES (@dayId, @artist, @stage, @time, @tba)"
);
const updateActStmt = db.prepare(
  "UPDATE festival_acts SET day_id = @dayId, artist = @artist, stage = @stage, time = @time, tba = @tba WHERE id = @id"
);
const deleteActStmt = db.prepare("DELETE FROM festival_acts WHERE id = ?");
const countDaysStmt = db.prepare("SELECT COUNT(*) AS n FROM festival_days");
const insertDayStmt = db.prepare("INSERT INTO festival_days (id, weekday, date_num, sort_order) VALUES (?, ?, ?, ?)");
const insertRawActStmt = db.prepare(
  "INSERT INTO festival_acts (day_id, artist, stage, time, tba) VALUES (?, ?, ?, ?, ?)"
);

function actRowToPublic(row) {
  const act = { artist: row.artist, stage: row.stage };
  if (row.tba) act.tba = true;
  else act.time = row.time;
  return act;
}

// Shape matches the original FESTIVAL_DATA.days from public/data.js, so the
// frontend can keep reading FESTIVAL_DATA.days synchronously after boot
// populates it from this endpoint.
function getFestivalData() {
  const days = listDaysStmt.all().map((day) => ({
    id: day.id,
    weekday: day.weekday,
    dateNum: day.date_num,
    acts: listActsForDayStmt.all(day.id).map(actRowToPublic)
  }));
  return { stages: FESTIVAL_DATA.stages, days };
}

function listDays() {
  return listDaysStmt.all().map((d) => ({ id: d.id, weekday: d.weekday, dateNum: d.date_num }));
}

function listActsForAdmin() {
  return listAllActsStmt.all().map((row) => ({
    id: row.id,
    dayId: row.day_id,
    weekday: row.weekday,
    dateNum: row.date_num,
    artist: row.artist,
    stage: row.stage,
    time: row.time,
    tba: Boolean(row.tba)
  }));
}

function createAct({ dayId, artist, stage, time, tba }) {
  const info = insertActStmt.run({ dayId, artist, stage, time: tba ? null : time, tba: tba ? 1 : 0 });
  return getActStmt.get(info.lastInsertRowid);
}

function updateAct(id, { dayId, artist, stage, time, tba }) {
  updateActStmt.run({ id, dayId, artist, stage, time: tba ? null : time, tba: tba ? 1 : 0 });
  return getActStmt.get(id);
}

function deleteAct(id) {
  deleteActStmt.run(id);
}

// One-time seed from public/data.js — no-ops if festival_days already has
// rows. Used by both scripts/migrate-schedule-to-db.js (local) and the
// admin endpoint (for hosts we can't shell into, e.g. Railway).
function seedFromStaticData() {
  if (countDaysStmt.get().n > 0) {
    return { seeded: false, days: 0, acts: 0 };
  }

  let acts = 0;
  const seed = db.transaction(() => {
    FESTIVAL_DATA.days.forEach((day, i) => {
      insertDayStmt.run(day.id, day.weekday, day.dateNum, i);
      for (const act of day.acts) {
        insertRawActStmt.run(day.id, act.artist, act.stage, act.time || null, act.tba ? 1 : 0);
        acts++;
      }
    });
  });
  seed();

  return { seeded: true, days: FESTIVAL_DATA.days.length, acts };
}

module.exports = {
  getFestivalData,
  listDays,
  listActsForAdmin,
  createAct,
  updateAct,
  deleteAct,
  seedFromStaticData
};
