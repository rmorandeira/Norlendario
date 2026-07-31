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
  async addComment(actId, comment) {
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actId, comment })
    });
    if (!r.ok) throw new Error("add_comment_failed");
    return r.json();
  },
  async editComment(id, comment) {
    const r = await fetch("/api/comments/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment })
    });
    if (!r.ok) throw new Error("edit_comment_failed");
    return r.json();
  },
  async deleteComment(id) {
    await fetch("/api/comments/" + encodeURIComponent(id), { method: "DELETE" });
  },
  async markCommentsRead() {
    await fetch("/api/comments/mark-read", { method: "POST", keepalive: true });
  },
  async getShareLink() {
    const r = await fetch("/api/share-link");
    if (!r.ok) return null;
    return r.json();
  },
  async getSharedRoute(token, visitorToken) {
    const qs = visitorToken ? "?visitorToken=" + encodeURIComponent(visitorToken) : "";
    const r = await fetch("/api/shared/" + encodeURIComponent(token) + qs);
    if (!r.ok) return null;
    return r.json();
  },
  async addSharedComment(token, { actId, comment, authorName, visitorToken }) {
    const r = await fetch("/api/shared/" + encodeURIComponent(token) + "/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actId, comment, authorName, visitorToken })
    });
    if (!r.ok) throw new Error("add_shared_comment_failed");
    return r.json();
  },
  async editSharedComment(token, id, { comment, visitorToken }) {
    const r = await fetch("/api/shared/" + encodeURIComponent(token) + "/comments/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment, visitorToken })
    });
    if (!r.ok) throw new Error("edit_shared_comment_failed");
    return r.json();
  },
  async deleteSharedComment(token, id, visitorToken) {
    const r = await fetch("/api/shared/" + encodeURIComponent(token) + "/comments/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorToken })
    });
    return r.ok;
  }
};
