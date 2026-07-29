const db = require("./db");
const { searchArtist } = require("./spotify");

const getCached = db.prepare("SELECT * FROM artist_info WHERE name = ?");
const upsert = db.prepare(`
  INSERT INTO artist_info (name, bio, image, genres, followers, spotify_url, spotify_verified, wikipedia_url, updated_at)
  VALUES (@name, @bio, @image, @genres, @followers, @spotifyUrl, @spotifyVerified, @wikipediaUrl, datetime('now'))
  ON CONFLICT(name) DO UPDATE SET
    bio = excluded.bio,
    image = excluded.image,
    genres = excluded.genres,
    followers = excluded.followers,
    spotify_url = excluded.spotify_url,
    spotify_verified = excluded.spotify_verified,
    wikipedia_url = excluded.wikipedia_url,
    updated_at = excluded.updated_at
`);

function rowToInfo(row) {
  return {
    bio: row.bio || null,
    image: row.image || null,
    wikipediaUrl: row.wikipedia_url || null,
    genres: row.genres ? JSON.parse(row.genres) : [],
    followers: row.followers,
    spotifyUrl: row.spotify_url,
    spotifyVerified: Boolean(row.spotify_verified)
  };
}

async function fetchWikipediaSummary(name) {
  for (const lang of ["es", "en"]) {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
      const r = await fetch(url, { headers: { "User-Agent": "Norlendario/1.0 (festival schedule app)" } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data.type === "disambiguation") continue;
      const image = (data.thumbnail && data.thumbnail.source) || (data.originalimage && data.originalimage.source) || null;
      if (!data.extract && !image) continue;
      return {
        bio: data.extract || null,
        image,
        url: data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page
      };
    } catch {
      // try the next language
    }
  }
  return null;
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

// Looks up an artist from Spotify + Wikipedia and writes the result into
// artist_info so future requests read from the DB instead of hitting those
// APIs again. Used both by the on-demand endpoint (cache miss fallback) and
// by scripts/sweep-artists.js (bulk pre-fill).
async function fetchAndStoreArtistInfo(name) {
  const [wiki, spotify] = await Promise.all([fetchWikipediaSummary(name), searchArtist(name)]);

  const info = {
    bio: (wiki && wiki.bio) || null,
    image: (spotify && spotify.image) || (wiki && wiki.image) || null,
    wikipediaUrl: (wiki && wiki.url) || null,
    genres: (spotify && spotify.genres) || [],
    followers: (spotify && spotify.followers) ?? null,
    spotifyUrl: (spotify && spotify.spotifyUrl) || "https://open.spotify.com/search/" + encodeURIComponent(name),
    spotifyVerified: Boolean(spotify && spotify.spotifyUrl)
  };

  upsert.run({
    name,
    bio: info.bio,
    image: info.image,
    genres: JSON.stringify(info.genres),
    followers: info.followers,
    spotifyUrl: info.spotifyUrl,
    spotifyVerified: info.spotifyVerified ? 1 : 0,
    wikipediaUrl: info.wikipediaUrl
  });

  return info;
}

// Reads the cached row for `name` if present; otherwise fetches live from
// Spotify/Wikipedia and stores it (write-through), so a newly-added artist
// that missed the bulk sweep still gets cached on first view.
async function getArtistInfo(name) {
  const row = getCached.get(name);
  const info = row ? rowToInfo(row) : await fetchAndStoreArtistInfo(name);

  const events = await fetchBandsintownEvents(name); // upcoming shows change day to day, kept live
  return { ...info, events };
}

module.exports = { getArtistInfo, fetchAndStoreArtistInfo };
