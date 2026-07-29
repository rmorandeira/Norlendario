let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  try {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!r.ok) return null;
    const data = await r.json();
    tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return tokenCache.token;
  } catch {
    return null;
  }
}

async function searchArtist(name) {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = "https://api.spotify.com/v1/search?type=artist&limit=1&q=" + encodeURIComponent(name);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const data = await r.json();
    const artist = data.artists && data.artists.items && data.artists.items[0];
    if (!artist) return null;

    return {
      name: artist.name,
      image: (artist.images && artist.images[0] && artist.images[0].url) || null,
      genres: artist.genres || [],
      followers: (artist.followers && artist.followers.total) ?? null,
      spotifyUrl: (artist.external_urls && artist.external_urls.spotify) || null
    };
  } catch {
    return null;
  }
}

module.exports = { searchArtist };
