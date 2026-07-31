// One-off batch job: computes the walking route (minutes + geometry) between
// every pair of stages via FOSSGIS's public Valhalla foot-routing server
// and caches it in stage_routes, so the app never calls out to it on a
// live user request.
//
// Usage: node scripts/sweep-routes.js

const { STAGE_COORDS, fetchAndStoreRoute } = require("../routes");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const stages = Object.keys(STAGE_COORDS);
  const pairs = [];
  for (let i = 0; i < stages.length; i++) {
    for (let j = i + 1; j < stages.length; j++) {
      pairs.push([stages[i], stages[j]]);
    }
  }

  console.log(`Sweeping ${pairs.length} stage pairs...\n`);

  for (const [i, [a, b]] of pairs.entries()) {
    process.stdout.write(`[${i + 1}/${pairs.length}] ${a} <-> ${b} ... `);
    try {
      const { minutes } = await fetchAndStoreRoute(a, b);
      console.log(`${minutes} min`);
    } catch (err) {
      console.log("ERROR: " + err.message);
    }
    await delay(1100); // stay well under Valhalla's public demo rate limit
  }

  console.log("\nDone.");
}

main().then(() => process.exit(0));
