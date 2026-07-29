(function () {
  const STAGE_COLOR_VARS = {
    "Azcárraga": "--stage-1",
    "Campo da Leña": "--stage-2",
    "Santa Margarida": "--stage-3",
    "Castelo de Santo Antón": "--stage-4",
    "Praza de María Pita": "--stage-5",
    "Praia de Riazor": "--stage-6",
    "O Portiño": "--stage-7"
  };

  const DEFAULT_DURATION = 60; // minutes, used for the last act on a stage each day
  const MAX_DURATION = 90; // minutes, cap when the next act starts later than this
  const MIN_DURATION = 30; // minutes, floor so a block always stays readable

  const APP_VERSION = "1.2.0";
  const THEME_KEY = "noroeste_theme";

  const state = {
    lang: (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es",
    theme: localStorage.getItem(THEME_KEY), // "light" | "dark" | null (follow system)
    dayIndex: 0,
    detail: null, // { act, day }
    user: null, // null (signed out) | "guest" | username
    favorites: new Set(),
    favoritesOnly: false,
    authMode: "login", // "login" | "signup"
    authError: null
  };

  function effectiveTheme() {
    return state.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme;
  }

  function toggleTheme() {
    state.theme = effectiveTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, state.theme);
    applyTheme();
    renderUserBadge();
  }

  applyTheme();

  const els = {
    dayTabs: document.getElementById("dayTabs"),
    favFilterContainer: document.getElementById("favFilterContainer"),
    timeline: document.getElementById("timeline"),
    tbaSection: document.getElementById("tbaSection"),
    authGate: document.getElementById("authGate"),
    artistViewBackdrop: document.getElementById("artistViewBackdrop")
  };
  els.artistViewBackdrop.addEventListener("click", () => closeDetail());

  function actId(day, act) {
    return day.id + "::" + act.stage + "::" + act.artist;
  }

  function isGuest() {
    return state.user === "guest";
  }

  function isFavorite(day, act) {
    return state.favorites.has(actId(day, act));
  }

  async function toggleFavorite(day, act) {
    const id = actId(day, act);
    const willFavorite = !state.favorites.has(id);
    if (willFavorite) state.favorites.add(id);
    else state.favorites.delete(id);

    try {
      if (willFavorite) await Api.addFavorite(id);
      else await Api.removeFavorite(id);
    } catch {
      if (willFavorite) state.favorites.delete(id);
      else state.favorites.add(id);
    }

    const day2 = FESTIVAL_DATA.days[state.dayIndex];
    renderTimeline(day2);
    renderTba(day2);
    if (state.detail) renderDetail();
  }

  function starButton(day, act) {
    const fav = isFavorite(day, act);
    const btn = document.createElement("button");
    btn.className = "star-btn" + (fav ? " is-fav" : "");
    btn.setAttribute("aria-label", t(state.lang, fav ? "favoriteRemove" : "favoriteAdd"));
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M12 3.5l2.47 5.15 5.53.76-4 3.98.95 5.61L12 16.3l-4.95 2.7.95-5.61-4-3.98 5.53-.76z"/></svg>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(day, act);
    });
    return btn;
  }

  function normalizeMinutes(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    const hour = h < 6 ? h + 24 : h; // after-midnight slots belong to the same festival day
    return hour * 60 + m;
  }

  function formatHourLabel(hourFloat) {
    const h = Math.floor(hourFloat) % 24;
    return String(h).padStart(2, "0") + ":00";
  }

  function formatDayDate(lang, day) {
    const weekday = t(lang, "weekdays." + day.weekday);
    const month = t(lang, "month");
    return lang === "en" ? `${weekday}, ${month} ${day.dateNum}` : `${weekday} ${day.dateNum} de ${month}`;
  }

  function formatTimeForDisplay(lang, act) {
    if (act.tba) return t(lang, "timeTBA");
    return act.time + "h";
  }

  function mapsUrl(stage) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(stage + ", A Coruña, España");
  }

  function stagesWithActs(day) {
    return FESTIVAL_DATA.stages.filter((stage) => day.acts.some((a) => a.stage === stage && !a.tba));
  }

  // Row height is capped to whatever the busiest day would get, so a
  // single-stage day doesn't stretch its row to fill the whole viewport —
  // it keeps the same row size as every other day and just leaves the
  // leftover space blank.
  const MAX_STAGES_PER_DAY = Math.max(...FESTIVAL_DATA.days.map((d) => stagesWithActs(d).length || 1));

  function computeLayout(day) {
    const timedActs = day.acts.filter((a) => !a.tba);
    const byStage = {};
    for (const stage of stagesWithActs(day)) byStage[stage] = [];
    for (const act of timedActs) byStage[act.stage].push(act);

    let rangeStart = Infinity;
    let rangeEnd = -Infinity;

    const blocks = [];

    for (const stage of Object.keys(byStage)) {
      const acts = byStage[stage]
        .map((a) => ({ ...a, startMin: normalizeMinutes(a.time) }))
        .sort((a, b) => a.startMin - b.startMin);

      acts.forEach((act, i) => {
        const isLast = i === acts.length - 1;
        let duration = DEFAULT_DURATION;
        if (!isLast) {
          duration = Math.min(acts[i + 1].startMin - act.startMin, MAX_DURATION);
        }
        duration = Math.max(duration, MIN_DURATION);

        rangeStart = Math.min(rangeStart, act.startMin);
        rangeEnd = Math.max(rangeEnd, act.startMin + duration);

        blocks.push({ ...act, duration });
      });
    }

    const rangeStartHour = Math.floor(rangeStart / 60);
    const rangeEndHour = Math.ceil(rangeEnd / 60);

    return { byStage, blocks, rangeStartHour, rangeEndHour, stages: Object.keys(byStage) };
  }

  function renderDayTabs() {
    els.dayTabs.innerHTML = "";
    FESTIVAL_DATA.days.forEach((day, i) => {
      const btn = document.createElement("button");
      btn.className = "day-tab" + (i === state.dayIndex ? " active" : "");
      btn.innerHTML = `<span class="wd">${t(state.lang, "weekdays." + day.weekday)}</span><span class="dn">${day.dateNum}</span>`;
      btn.addEventListener("click", () => {
        state.dayIndex = i;
        state.detail = null;
        renderAll();
      });
      els.dayTabs.appendChild(btn);
    });
  }

  function renderFavFilter() {
    els.favFilterContainer.innerHTML = "";
    if (isGuest()) return; // favorites are an account-only feature
    const favBtn = document.createElement("button");
    favBtn.className = "fav-filter-btn" + (state.favoritesOnly ? " active" : "");
    favBtn.innerHTML = `★ ${t(state.lang, state.favoritesOnly ? "favHideBtn" : "favShowBtn")}`;
    favBtn.addEventListener("click", () => {
      state.favoritesOnly = !state.favoritesOnly;
      renderAll();
    });
    els.favFilterContainer.appendChild(favBtn);
  }

  function renderTimeline(day) {
    els.timeline.innerHTML = "";
    const timedActs = day.acts.filter((a) => !a.tba);

    if (timedActs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-msg";
      empty.textContent = t(state.lang, "noTimedActs");
      els.timeline.appendChild(empty);
      return;
    }

    const layout = computeLayout(day);
    const totalHours = layout.rangeEndHour - layout.rangeStartHour;
    els.timeline.style.setProperty("--total-hours", totalHours);

    // hint
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.style.setProperty("--total-hours", totalHours);

    // ruler
    const ruler = document.createElement("div");
    ruler.className = "ruler";
    for (let h = layout.rangeStartHour; h <= layout.rangeEndHour; h++) {
      const mark = document.createElement("div");
      mark.className = "ruler-mark";
      mark.style.setProperty("--start", h - layout.rangeStartHour);
      mark.textContent = formatHourLabel(h);
      ruler.appendChild(mark);
    }
    grid.appendChild(ruler);

    // stage rows
    layout.stages.forEach((stage) => {
      const row = document.createElement("div");
      row.className = "stage-row";

      const label = document.createElement("div");
      label.className = "stage-label";
      label.innerHTML = `<i style="background:var(${STAGE_COLOR_VARS[stage]})"></i><span>${stage}</span>`;
      row.appendChild(label);

      const track = document.createElement("div");
      track.className = "stage-track";

      layout.blocks
        .filter((b) => b.stage === stage)
        .forEach((block) => {
          const fav = isFavorite(day, block);
          const el = document.createElement("div");
          el.className = "act-block" + (state.favoritesOnly && !fav ? " dimmed" : "");
          el.tabIndex = 0;
          el.setAttribute("role", "button");
          el.style.setProperty("--start", block.startMin / 60 - layout.rangeStartHour);
          el.style.setProperty("--dur", block.duration / 60);
          el.style.setProperty("--stage-color", `var(${STAGE_COLOR_VARS[stage]})`);
          el.innerHTML = `<span class="act-time">${block.time}</span><span class="act-name">${block.artist}</span>`;
          if (!isGuest()) el.appendChild(starButton(day, block));
          el.addEventListener("click", () => openDetail(block, day));
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openDetail(block, day);
            }
          });
          track.appendChild(el);
        });

      row.appendChild(track);
      grid.appendChild(row);
    });

    els.timeline.appendChild(grid);
    capRowHeight(grid, ruler);
  }

  function capRowHeight(grid, ruler) {
    const available = grid.clientHeight - ruler.clientHeight;
    if (available <= 0) return;
    const maxRowHeight = Math.floor(available / MAX_STAGES_PER_DAY);
    grid.style.setProperty("--max-row-height", maxRowHeight + "px");
  }

  function renderTba(day) {
    const tbaActs = day.acts.filter((a) => a.tba);
    els.tbaSection.innerHTML = "";
    if (tbaActs.length === 0) return;

    const title = document.createElement("h3");
    title.textContent = t(state.lang, "tbaTitle");
    els.tbaSection.appendChild(title);

    const note = document.createElement("p");
    note.className = "tba-note";
    note.textContent = t(state.lang, "tbaNote");
    els.tbaSection.appendChild(note);

    const list = document.createElement("div");
    list.className = "tba-list";
    tbaActs.forEach((act) => {
      const fav = isFavorite(day, act);
      const chip = document.createElement("div");
      chip.className = "tba-chip" + (state.favoritesOnly && !fav ? " dimmed" : "");
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.style.setProperty("--stage-color", `var(${STAGE_COLOR_VARS[act.stage]})`);
      chip.innerHTML = `<i style="background:var(${STAGE_COLOR_VARS[act.stage]})"></i>${act.artist} <span class="tba-stage">· ${act.stage}</span>`;
      if (!isGuest()) chip.appendChild(starButton(day, act));
      chip.addEventListener("click", () => openDetail(act, day));
      chip.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(act, day);
        }
      });
      list.appendChild(chip);
    });
    els.tbaSection.appendChild(list);
  }

  function openDetail(act, day) {
    state.detail = { act, day, extra: null, extraStatus: "loading" };
    renderDetail();
    document.body.classList.add("detail-open");
    loadArtistExtra(act.artist);
  }

  function closeDetail() {
    document.body.classList.remove("detail-open");
    state.detail = null;
  }

  function renderDetail() {
    let panel = document.getElementById("artistView");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "artistView";
      panel.className = "artist-view";
      document.body.appendChild(panel);
    }
    if (!state.detail) {
      panel.innerHTML = "";
      return;
    }
    const { act, day } = state.detail;
    const lang = state.lang;
    const spotifyUrl = (state.detail.extra && state.detail.extra.spotifyUrl) || "https://open.spotify.com/search/" + encodeURIComponent(act.artist);
    const fav = isFavorite(day, act);
    const starHTML = isGuest()
      ? ""
      : `<button class="star-btn detail-star${fav ? " is-fav" : ""}" id="detailStarBtn" aria-label="${t(lang, fav ? "favoriteRemove" : "favoriteAdd")}">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M12 3.5l2.47 5.15 5.53.76-4 3.98.95 5.61L12 16.3l-4.95 2.7.95-5.61-4-3.98 5.53-.76z"/></svg>
        </button>`;

    panel.innerHTML = `
      <div class="artist-view-inner">
        <button class="back-btn" id="backBtn">&larr; ${t(lang, "back")}</button>
        <div class="artist-card">
          <div class="artist-card-header">
            ${starHTML}
            <span class="stage-pill" style="background:var(${STAGE_COLOR_VARS[act.stage]})">${act.stage}</span>
          </div>
          <h2>${act.artist}</h2>
          <div class="event-meta">
            <div class="event-date">${formatDayDate(lang, day)}</div>
            <div class="event-time">${formatTimeForDisplay(lang, act)}</div>
            <a class="event-venue" href="${mapsUrl(act.stage)}" target="_blank" rel="noopener noreferrer">${act.stage}</a>
          </div>
          <div class="artist-extra" id="artistExtra">${renderArtistExtraHTML()}</div>
          <div class="detail-actions">
            <a class="spotify-btn" id="spotifyBtn" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.59 14.4a.62.62 0 0 1-.86.21c-2.36-1.44-5.34-1.77-8.84-.97a.63.63 0 1 1-.28-1.23c3.83-.87 7.12-.5 9.77 1.12a.63.63 0 0 1 .21.87Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.7-1.66-6.82-2.14-10.02-1.17a.78.78 0 1 1-.45-1.49c3.65-1.11 8.19-.57 11.28 1.33a.78.78 0 0 1 .26 1.07Zm.11-2.83c-3.24-1.92-8.6-2.1-11.7-1.16a.94.94 0 1 1-.55-1.8c3.56-1.08 9.46-.87 13.19 1.34a.94.94 0 0 1-.94 1.62Z"/></svg>
              ${t(lang, "spotifyBtn")}
            </a>
          </div>
        </div>
      </div>
    `;
    document.getElementById("backBtn").addEventListener("click", closeDetail);
    const starBtn = document.getElementById("detailStarBtn");
    if (starBtn) starBtn.addEventListener("click", () => toggleFavorite(day, act));
  }

  function formatGenres(genres) {
    return genres.map((g) => g.replace(/\b\w/g, (c) => c.toUpperCase())).join(", ");
  }

  function formatFollowers(lang, n) {
    const formatted = new Intl.NumberFormat(lang === "en" ? "en-US" : "es-ES").format(n);
    return lang === "en" ? `${formatted} followers on Spotify` : `${formatted} seguidores en Spotify`;
  }

  function renderArtistExtraHTML() {
    const lang = state.lang;
    const status = state.detail.extraStatus;
    const extra = state.detail.extra;

    if (status === "loading") {
      return `<p class="extra-status">${t(lang, "extraLoading")}</p>`;
    }
    if (status === "error") {
      return `<p class="extra-status">${t(lang, "noExtraInfo")}</p>`;
    }

    const hasGenres = extra && extra.genres && extra.genres.length > 0;
    const hasFollowers = extra && typeof extra.followers === "number";
    const hasImage = extra && extra.image;
    const hasEvents = extra && extra.events && extra.events.length > 0;

    if (!hasGenres && !hasFollowers && !hasImage && !hasEvents) {
      return `<p class="extra-status">${t(lang, "noExtraInfo")}</p>`;
    }

    let html = "";
    if (hasImage) {
      html += `<img class="artist-photo" src="${extra.image}" alt="${state.detail.act.artist}" loading="lazy" />`;
    }
    if (hasGenres || hasFollowers) {
      const parts = [];
      if (hasGenres) parts.push(formatGenres(extra.genres));
      if (hasFollowers) parts.push(formatFollowers(lang, extra.followers));
      html += `<p class="artist-description">${parts.join(" · ")}</p>`;
    }
    if (hasEvents) {
      html += `<h3 class="upcoming-shows-title">${t(lang, "upcomingShowsTitle")}</h3><ul class="upcoming-shows">`;
      html += extra.events
        .map((ev) => {
          const date = ev.date ? new Date(ev.date).toLocaleDateString(lang === "en" ? "en-GB" : "es-ES") : "";
          const place = [ev.venue, ev.city].filter(Boolean).join(" · ");
          return `<li><a href="${ev.url}" target="_blank" rel="noopener noreferrer"><span class="show-date">${date}</span> ${place}</a></li>`;
        })
        .join("");
      html += `</ul>`;
    }
    return html;
  }

  async function loadArtistExtra(artistName) {
    try {
      const r = await fetch("/api/artist-info?name=" + encodeURIComponent(artistName));
      const data = await r.json();
      if (!state.detail || state.detail.act.artist !== artistName) return;
      state.detail.extra = data;
      state.detail.extraStatus = "loaded";
    } catch {
      if (!state.detail || state.detail.act.artist !== artistName) return;
      state.detail.extraStatus = "error";
    }
    const container = document.getElementById("artistExtra");
    if (container) container.innerHTML = renderArtistExtraHTML();
    const spotifyBtn = document.getElementById("spotifyBtn");
    if (spotifyBtn && state.detail.extra && state.detail.extra.spotifyUrl) {
      spotifyBtn.href = state.detail.extra.spotifyUrl;
    }
  }

  function renderHeader() {
    document.querySelector(".subtitle").textContent = t(state.lang, "subtitle");
  }

  function renderUserBadge() {
    let badge = document.getElementById("userBadge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "userBadge";
      badge.className = "user-badge";
      document.querySelector(".top").appendChild(badge);
    }
    const guest = isGuest();
    const label = guest ? t(state.lang, "guestLabel") : state.user;
    const actionLabel = guest ? t(state.lang, "loginBtn") : t(state.lang, "logout");
    const isDark = effectiveTheme() === "dark";

    badge.innerHTML = `
      <span class="user-name">${label}</span>
      <button class="icon-btn" id="themeToggleBtn" aria-label="Toggle dark/light theme">${isDark ? "☀️" : "🌙"}</button>
      <button class="icon-btn" id="langToggleBtn" aria-label="Switch language">${t(state.lang, "langBtn")}</button>
      <button class="icon-btn" id="logoutBtn">${actionLabel}</button>
    `;
    document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);
    document.getElementById("langToggleBtn").addEventListener("click", () => {
      state.lang = state.lang === "es" ? "en" : "es";
      renderAll();
    });
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  }

  async function handleLogout() {
    if (state.user && state.user !== "guest") {
      try {
        await Api.logout();
      } catch {
        /* ignore */
      }
    }
    state.user = null;
    state.favorites = new Set();
    state.detail = null;
    document.body.classList.remove("detail-open");
    const badge = document.getElementById("userBadge");
    if (badge) badge.remove();
    showGate();
  }

  function renderAll() {
    const day = FESTIVAL_DATA.days[state.dayIndex];
    renderHeader();
    renderDayTabs();
    renderFavFilter();
    renderTimeline(day);
    renderTba(day);
    renderDetail();
    renderUserBadge();
  }

  // --- Auth gate ---

  function renderGate() {
    const lang = state.lang;
    const isSignup = state.authMode === "signup";
    els.authGate.innerHTML = `
      <div class="gate-card">
        <h1>${t(lang, "gateTitle")}</h1>
        <div class="auth-tabs">
          <button type="button" class="auth-tab${!isSignup ? " active" : ""}" data-mode="login">${t(lang, "loginBtn")}</button>
          <button type="button" class="auth-tab${isSignup ? " active" : ""}" data-mode="signup">${t(lang, "signupBtn")}</button>
        </div>
        <p class="gate-subtitle">${t(lang, isSignup ? "gateSubtitleSignup" : "gateSubtitleLogin")}</p>
        <form id="authForm" novalidate>
          <label>${t(lang, "usernameLabel")}
            <input type="text" name="username" autocomplete="username" required minlength="3" maxlength="32" />
          </label>
          <label>${t(lang, "passwordLabel")}
            <input type="password" name="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="4" />
          </label>
          ${
            isSignup
              ? `<label>${t(lang, "confirmPasswordLabel")}
            <input type="password" name="confirmPassword" autocomplete="new-password" required minlength="4" />
          </label>`
              : ""
          }
          ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
          <button type="submit" class="auth-submit">${t(lang, isSignup ? "signupBtn" : "loginBtn")}</button>
        </form>
        <div class="gate-divider"><span>${t(lang, "orDivider")}</span></div>
        <button class="guest-btn" id="guestBtn">${t(lang, "guestBtn")}</button>
        <p class="gate-disclaimer">${t(lang, "unofficialDisclaimer")}<br />v${APP_VERSION}</p>
      </div>
    `;

    document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);
    els.authGate.querySelectorAll(".auth-tab").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        state.authMode = tabBtn.dataset.mode;
        state.authError = null;
        renderGate();
      });
    });
    document.getElementById("guestBtn").addEventListener("click", handleGuestLogin);
  }

  function authErrorMessage(err) {
    const map = {
      username_length: "errUsernameLength",
      password_length: "errPasswordLength",
      password_mismatch: "errPasswordMismatch",
      username_taken: "errUsernameTaken",
      invalid_credentials: "errInvalidCredentials"
    };
    return t(state.lang, map[err && err.message] || "errGeneric");
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim();
    const password = form.password.value;
    const isSignup = state.authMode === "signup";

    if (isSignup && password !== form.confirmPassword.value) {
      state.authError = authErrorMessage(new Error("password_mismatch"));
      renderGate();
      return;
    }

    try {
      const data = isSignup ? await Api.signup(username, password) : await Api.login(username, password);
      state.user = data.username;
      state.favorites = new Set(await Api.getFavorites());
      state.authError = null;
      hideGate();
      renderAll();
    } catch (err) {
      state.authError = authErrorMessage(err);
      renderGate();
    }
  }

  function handleGuestLogin() {
    state.user = "guest";
    state.favorites = new Set(); // favorites are an account-only feature
    state.authError = null;
    hideGate();
    renderAll();
  }

  function showGate() {
    document.body.classList.add("gate-open");
    renderGate();
  }

  function hideGate() {
    document.body.classList.remove("gate-open");
    els.authGate.innerHTML = "";
  }

  async function boot() {
    try {
      const me = await Api.me();
      if (me.username) {
        state.user = me.username;
        state.favorites = new Set(await Api.getFavorites());
        renderAll();
        return;
      }
    } catch {
      /* fall through to guest */
    }
    // No login wall on first load — the calendar itself is the home screen,
    // browsable as a guest. "Iniciar sesión" in the corner opens the gate
    // for anyone who wants an account.
    state.user = "guest";
    state.favorites = new Set();
    renderAll();
  }

  boot();
})();
