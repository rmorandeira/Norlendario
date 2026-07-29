// One-time seed: copies the festival lineup from public/data.js into
// festival_days / festival_acts, so the backoffice can edit it from the DB
// instead of a static file. Safe to re-run — no-ops if festival_days
// already has rows. Same logic is exposed remotely via
// POST /api/admin/migrate-schedule for hosts without shell access.
//
// Usage: node scripts/migrate-schedule-to-db.js

const { seedFromStaticData } = require("../schedule");

const result = seedFromStaticData();
if (!result.seeded) {
  console.log("festival_days already has rows — skipping seed.");
} else {
  console.log(`Seeded ${result.days} days and ${result.acts} acts into the database.`);
}
