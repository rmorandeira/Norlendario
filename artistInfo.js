const db = require("./db");
const { searchArtist } = require("./spotify");

const getCached = db.prepare("SELECT * FROM artist_info WHERE name = ?");
const upsert = db.prepare(`
  INSERT INTO artist_info (name, image, genres, followers, spotify_url, spotify_verified, updated_at)
  VALUES (@name, @image, @genres, @followers, @spotifyUrl, @spotifyVerified, datetime('now'))
  ON CONFLICT(name) DO UPDATE SET
    image = excluded.image,
    genres = excluded.genres,
    followers = excluded.followers,
    spotify_url = excluded.spotify_url,
    spotify_verified = excluded.spotify_verified,
    updated_at = excluded.updated_at
`);

function rowToInfo(row) {
  return {
    image: row.image || null,
    genres: row.genres ? JSON.parse(row.genres) : [],
    followers: row.followers,
    spotifyUrl: row.spotify_url,
    spotifyVerified: Boolean(row.spotify_verified)
  };
}

async function fetchBandsintownEvents(name) {
  try {
    const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=norlendario_festival&date=upcoming`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map((ev) => ({
      date: ev.datetime,
      venue: ev.venue && ev.venue.name,
      city: ev.venue && [ev.venue.city, ev.venue.country].filter(Boolean).join(", "),
      url: ev.url
    }));
  } catch {
    return [];
  }
}

// Looks up an artist on Spotify and writes the result into artist_info so
// future requests read from the DB instead of hitting Spotify again. Only
// called by scripts/sweep-artists.js — never from a live user request.
async function fetchAndStoreArtistInfo(name) {
  const spotify = await searchArtist(name);

  const info = {
    image: (spotify && spotify.image) || null,
    genres: (spotify && spotify.genres) || [],
    followers: (spotify && spotify.followers) ?? null,
    spotifyUrl: (spotify && spotify.spotifyUrl) || "https://open.spotify.com/search/" + encodeURIComponent(name),
    spotifyVerified: Boolean(spotify && spotify.spotifyUrl)
  };

  upsert.run({
    name,
    image: info.image,
    genres: JSON.stringify(info.genres),
    followers: info.followers,
    spotifyUrl: info.spotifyUrl,
    spotifyVerified: info.spotifyVerified ? 1 : 0
  });

  return info;
}

function fallbackInfo(name) {
  return {
    image: null,
    genres: [],
    followers: null,
    spotifyUrl: "https://open.spotify.com/search/" + encodeURIComponent(name),
    spotifyVerified: false
  };
}

// Reads-only from artist_info — never calls Spotify on a live request, so
// end-user traffic can't trigger those lookups. An artist missing from the
// cache (e.g. added after the last sweep) just gets the search-link
// fallback until scripts/sweep-artists.js is run again.
async function getArtistInfo(name) {
  const row = getCached.get(name);
  const info = row ? rowToInfo(row) : fallbackInfo(name);

  const events = await fetchBandsintownEvents(name); // upcoming shows change day to day, kept live
  return { ...info, events };
}

module.exports = { getArtistInfo, fetchAndStoreArtistInfo };
