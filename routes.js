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

// A couple of stage names in data.js are short internal identifiers
// (also used in act_ids for favorites/comments — never rename those)
// that Google Maps doesn't resolve reliably on their own. Keep in sync
// with STAGE_DISPLAY_NAMES in public/app.js.
const STAGE_DISPLAY_NAMES = {
  "Azcárraga": "Plaza de Azcárraga"
};

function directionsUrl(fromStage, toStage) {
  const origin = encodeURIComponent((STAGE_DISPLAY_NAMES[fromStage] || fromStage) + ", A Coruña, España");
  const destination = encodeURIComponent((STAGE_DISPLAY_NAMES[toStage] || toStage) + ", A Coruña, España");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
}

// The public OSRM demo server only has a driving profile compiled in — it
// accepts the /foot/ path segment but still weights `duration` using car
// speeds (~25-35 km/h), so trusting it gives absurdly fast "walking" times.
// The route `distance` (actual path length over the street/path network) is
// fine though, so minutes are derived from that at a fixed walking pace.
const WALK_METERS_PER_MINUTE = 80; // ~4.8 km/h

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// OSRM's public foot-routing graph has real gaps in some A Coruña streets
// (first seen at Azcárraga: its plaza isn't well connected in OSM's
// pedestrian data, so OSRM silently snapped the origin to a node 188m away
// near an unrelated tunnel — every route computed "from Azcárraga" was
// actually walked from there instead, giving distances way off from what
// Google Maps shows for the same pair). Rather than chase that per stage,
// treat a bad snap on either end as "no reliable route": fall back to
// straight-line distance with a typical historic-center detour factor, and
// a straight connecting line instead of a misleading traced polyline.
const MAX_TRUSTED_SNAP_METERS = 120;
const FALLBACK_DETOUR_FACTOR = 1.3;

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

  const wellSnapped = data.waypoints.every((wp) => wp.distance <= MAX_TRUSTED_SNAP_METERS);

  let minutes, geometry;
  if (wellSnapped) {
    minutes = Math.max(1, Math.round(route.distance / WALK_METERS_PER_MINUTE));
    geometry = route.geometry.coordinates; // [ [lng, lat], ... ]
  } else {
    const straight = haversineMeters(a, b);
    minutes = Math.max(1, Math.round((straight * FALLBACK_DETOUR_FACTOR) / WALK_METERS_PER_MINUTE));
    geometry = [
      [a.lng, a.lat],
      [b.lng, b.lat]
    ];
  }

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
//
// The cache is keyed by the unordered pair (pairKey sorts the two stage
// names), so the same row serves both directions — but its geometry was
// only ever walked one way when it was swept. If the caller wants the
// other direction, the coordinate order has to be flipped or the origin
// (green marker) and destination (red marker) end up swapped on the map.
function getRoute(fromStage, toStage) {
  const row = getCached.get(pairKey(fromStage, toStage));
  let geometry = row ? JSON.parse(row.geometry) : null;
  if (geometry && row.from_stage !== fromStage) {
    geometry = geometry.slice().reverse();
  }
  return {
    minutes: row ? row.minutes : null,
    geometry,
    directionsUrl: directionsUrl(fromStage, toStage)
  };
}

module.exports = { STAGE_COORDS, getRoute, fetchAndStoreRoute };
