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

const WALK_METERS_PER_MINUTE = 80; // ~4.8 km/h — only used by the network-error fallback below

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const FALLBACK_DETOUR_FACTOR = 1.3; // typical urban pedestrian detour over straight-line

// Valhalla encodes its shape as a polyline with 6 decimal places of
// precision (vs. the usual 5), so the standard polyline decoder doesn't
// apply as-is.
function decodePolyline6(encoded) {
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e6, lat / 1e6]); // [lng, lat], matching our stored geometry convention
  }
  return coords;
}

// Switched from OSRM's public demo server to FOSSGIS's public Valhalla
// instance: OSRM's foot-routing graph has real connectivity gaps in parts
// of A Coruña (Azcárraga's plaza wasn't reachable within 150m of its real
// location, so every route "from Azcárraga" was silently walked from an
// unrelated node near a tunnel instead) and its distances ran consistently
// 20-40% longer than the same walks on Google Maps. Valhalla's pedestrian
// costing snaps cleanly at every stage tried and lines up much closer with
// Google Maps for the same pairs.
async function fetchAndStoreRoute(fromStage, toStage) {
  const a = STAGE_COORDS[fromStage];
  const b = STAGE_COORDS[toStage];
  if (!a || !b) throw new Error("unknown stage: " + fromStage + " / " + toStage);

  let minutes, geometry;
  try {
    const r = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [
          { lat: a.lat, lon: a.lng },
          { lat: b.lat, lon: b.lng }
        ],
        costing: "pedestrian",
        units: "kilometers"
      })
    });
    if (!r.ok) throw new Error("Valhalla request failed: " + r.status);
    const data = await r.json();
    const leg = data.trip && data.trip.legs && data.trip.legs[0];
    if (!leg) throw new Error("no route found");

    minutes = Math.max(1, Math.round(leg.summary.time / 60));
    geometry = decodePolyline6(leg.shape);
  } catch {
    // Network hiccup or Valhalla itself down — a straight line is still a
    // more honest preview than nothing, and it's the same estimate style
    // already proven reasonable for Azcárraga while Valhalla was down.
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
