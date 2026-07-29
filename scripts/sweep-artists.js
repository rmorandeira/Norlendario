// One-off batch job: looks up every artist in the festival lineup on Spotify
// + Wikipedia and stores the result in artist_info, so the app reads from
// the DB instead of hitting those APIs on every ficha view.
//
// Usage: node scripts/sweep-artists.js

require("dotenv").config();
const FESTIVAL_DATA = require("../public/data.js");
const { fetchAndStoreArtistInfo } = require("../artistInfo");

function uniqueArtistNames() {
  const names = new Set();
  for (const day of FESTIVAL_DATA.days) {
    for (const act of day.acts) names.add(act.artist);
  }
  return Array.from(names);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const names = uniqueArtistNames();
  console.log(`Sweeping ${names.length} artists...\n`);

  const misses = [];

  for (const [i, name] of names.entries()) {
    process.stdout.write(`[${i + 1}/${names.length}] ${name} ... `);
    try {
      const info = await fetchAndStoreArtistInfo(name);
      const bits = [];
      if (info.spotifyVerified) bits.push("spotify ✓");
      else bits.push("spotify ✗ (search link only)");
      if (info.image) bits.push("image ✓");
      if (info.bio) bits.push("bio ✓");
      console.log(bits.join(", "));
      if (!info.spotifyVerified) misses.push(name);
    } catch (err) {
      console.log("ERROR: " + err.message);
      misses.push(name);
    }
    await delay(150); // be polite to the APIs
  }

  console.log("\nDone.");
  if (misses.length) {
    console.log(`\nNo confirmed Spotify match for ${misses.length} artist(s):`);
    misses.forEach((n) => console.log(" - " + n));
  }
}

main().then(() => process.exit(0));
