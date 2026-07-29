const db = require("./db");

// Geocoded once via OpenStreetMap Nominatim — these venues never move, so
// there's no reason to geocode them again on every boot.
const STAGE_COORDS = {
  "Azcárraga": { lat: 43.3698456, lng: -8.3931007 },
  "Campo da Leña": { lat: 43.3730877, lng: -8.3967175 },
  "Santa Margarida": { lat: 43.3611023, lng: -8.4135179 },
  "Castelo de Santo Antón": { lat: 43.3656897, lng: -8.3875228 },
  "Praza de María Pita": { lat: 43.3710378, lng: -8.395942 },
  "Praia de Riazor": { lat: 43.3691443, lng: -8.4091041 },
  "O Portiño": { lat: 43.3721994, lng: -8.4459327 }
};

const getCached = db.prepare("SELECT * FROM stage_routes WHERE pair_key = ?");
const upsert = db.prepare(`
  INSERT INTO stage_routes (pair_key, from_stage, to_stage, minutes, geometry, updated_at)
  VALUES (@pairKey, @fromStage, @toStage, @minutes, @geometry, datetime('now'))
  ON CONFLICT(pair_key) DO UPDATE SET
    minutes = excluded.minutes,
    geometry = excluded.geometry,
    updated_at = excluded.updated_at
`);

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function directionsUrl(fromStage, toStage) {
  const origin = encodeURIComponent(fromStage + ", A Coruña, España");
  const destination = encodeURIComponent(toStage + ", A Coruña, España");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
}

// Only called by scripts/sweep-routes.js — never on a live user request.
async function fetchAndStoreRoute(fromStage, toStage) {
  const a = STAGE_COORDS[fromStage];
  const b = STAGE_COORDS[toStage];
  if (!a || !b) throw new Error("unknown stage: " + fromStage + " / " + toStage);

  const url = `https://router.project-osrm.org/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("OSRM request failed: " + r.status);
  const data = await r.json();
  const route = data.routes && data.routes[0];
  if (!route) throw new Error("no route found");

  const minutes = Math.round(route.duration / 60);
  const geometry = route.geometry.coordinates; // [ [lng, lat], ... ]

  upsert.run({
    pairKey: pairKey(fromStage, toStage),
    fromStage,
    toStage,
    minutes,
    geometry: JSON.stringify(geometry)
  });

  return { minutes, geometry };
}

// Reads-only from stage_routes. A cache miss still returns a working
// Google Maps directions link — it just won't have a minutes estimate or
// a map preview until scripts/sweep-routes.js has run.
function getRoute(fromStage, toStage) {
  const row = getCached.get(pairKey(fromStage, toStage));
  return {
    minutes: row ? row.minutes : null,
    geometry: row ? JSON.parse(row.geometry) : null,
    directionsUrl: directionsUrl(fromStage, toStage)
  };
}

module.exports = { STAGE_COORDS, getRoute, fetchAndStoreRoute };
