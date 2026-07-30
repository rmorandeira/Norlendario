const Api = {
  async me() {
    const r = await fetch("/api/auth/me");
    return r.json();
  },
  async signup(username, password) {
    const r = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "generic");
    return data;
  },
  async login(username, password) {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "generic");
    return data;
  },
  async logout() {
    await fetch("/api/auth/logout", { method: "POST" });
  },
  async deleteAccount() {
    await fetch("/api/auth/account", { method: "DELETE" });
  },
  async getFavorites() {
    const r = await fetch("/api/favorites");
    if (!r.ok) return [];
    return r.json();
  },
  async addFavorite(actId) {
    await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actId })
    });
  },
  async removeFavorite(actId) {
    await fetch("/api/favorites/" + encodeURIComponent(actId), { method: "DELETE" });
  },
  async getFavoriteCounts() {
    const r = await fetch("/api/favorites/counts");
    if (!r.ok) return {};
    return r.json();
  },
  async getComments() {
    const r = await fetch("/api/comments");
    if (!r.ok) return {};
    return r.json();
  },
  async setComment(actId, comment) {
    await fetch("/api/comments/" + encodeURIComponent(actId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment })
    });
  }
};
