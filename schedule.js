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

module.exports = { getFestivalData, listDays, listActsForAdmin, createAct, updateAct, deleteAct };
