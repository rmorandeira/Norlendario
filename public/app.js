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
    activeView: "calendar", // "calendar" | "route" | "user"
    detail: null, // { act, day }
    user: null, // null (signed out) | "guest" | username
    favorites: new Set(),
    favoritesOnly: false,
    authMode: "login", // "login" | "signup"
    authError: null,
    confirmingDelete: false
  };

  const NAV_ICONS = {
    calendar:
      '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>',
    route:
      '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15 5.1 9 3 3 5v15.9l6-2.1 6 2.1 6-2V3l-6 2.1ZM15 19l-6-2.1V5l6 2.1V19Z"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12Zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9V22h19.6v-2.7c0-3.3-6.5-4.9-9.8-4.9Z"/></svg>'
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
    if (state.activeView === "user") renderUserView();
  }

  applyTheme();

  const els = {
    calendarView: document.getElementById("calendarView"),
    routeView: document.getElementById("routeView"),
    userView: document.getElementById("userView"),
    bottomNav: document.getElementById("bottomNav"),
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

  function estimatedDurationFor(day, act) {
    if (act.tba) return null;
    const block = computeLayout(day).blocks.find((b) => b.stage === act.stage && b.time === act.time && b.artist === act.artist);
    return block ? block.duration : null;
  }

  const artistInfoCache = new Map(); // artist name -> info object, reused across route-item thumbnails

  async function loadArtistThumb(containerId, artistName) {
    let info = artistInfoCache.get(artistName);
    if (!info) {
      try {
        const r = await fetch("/api/artist-info?name=" + encodeURIComponent(artistName));
        info = await r.json();
      } catch {
        info = {};
      }
      artistInfoCache.set(artistName, info);
    }
    const el = document.getElementById(containerId);
    if (el && info.image) {
      el.style.backgroundImage = `url("${info.image}")`;
      el.classList.remove("route-thumb-empty");
    }
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
    state.confirmingDelete = false;
    document.body.classList.remove("detail-open");
    showGate();
  }

  async function handleDeleteAccount() {
    try {
      await Api.deleteAccount();
    } catch {
      /* reset client state regardless — the account may already be gone */
    }
    state.confirmingDelete = false;
    handleLogout();
  }

  // --- Bottom nav & Mi ruta / Usuario pages ---

  function renderBottomNav() {
    const labels = { calendar: "navCalendar", route: "navRoute", user: "navUser" };
    els.bottomNav.innerHTML = Object.keys(NAV_ICONS)
      .map(
        (view) => `
        <button class="bottom-nav-btn${state.activeView === view ? " active" : ""}" data-view="${view}">
          ${NAV_ICONS[view]}
          <span>${t(state.lang, labels[view])}</span>
        </button>`
      )
      .join("");
    els.bottomNav.querySelectorAll(".bottom-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeView = btn.dataset.view;
        renderAll();
      });
    });
  }

  function routeItems() {
    const items = [];
    for (const idStr of state.favorites) {
      const [dayId, stage, artist] = idStr.split("::");
      const day = FESTIVAL_DATA.days.find((d) => d.id === dayId);
      const act = day && day.acts.find((a) => a.stage === stage && a.artist === artist);
      if (day && act) items.push({ day, act });
    }
    const dayOrder = FESTIVAL_DATA.days.map((d) => d.id);
    items.sort((a, b) => {
      const dayDiff = dayOrder.indexOf(a.day.id) - dayOrder.indexOf(b.day.id);
      if (dayDiff !== 0) return dayDiff;
      if (a.act.tba !== b.act.tba) return a.act.tba ? 1 : -1;
      if (a.act.tba) return 0;
      return normalizeMinutes(a.act.time) - normalizeMinutes(b.act.time);
    });
    return items;
  }

  function renderRouteView() {
    const lang = state.lang;

    if (isGuest()) {
      els.routeView.innerHTML = `
        <div class="page-inner">
          <h2>${t(lang, "routeTitle")}</h2>
          <p class="empty-msg">${t(lang, "routeGuestMsg")}</p>
          <button class="guest-btn" id="routeLoginBtn">${t(lang, "loginBtn")}</button>
        </div>`;
      document.getElementById("routeLoginBtn").addEventListener("click", handleLogout);
      return;
    }

    const items = routeItems();
    if (items.length === 0) {
      els.routeView.innerHTML = `
        <div class="page-inner">
          <h2>${t(lang, "routeTitle")}</h2>
          <p class="empty-msg">${t(lang, "routeEmptyMsg")}</p>
        </div>`;
      return;
    }

    let html = `<div class="page-inner"><h2>${t(lang, "routeTitle")}</h2>`;
    let lastDayId = null;
    let lastAct = null;
    const connectors = [];
    const thumbs = [];

    items.forEach(({ day, act }, idx) => {
      const sameDay = day.id === lastDayId;
      if (!sameDay) {
        html += `<h3 class="route-day-heading">${formatDayDate(lang, day)}</h3>`;
      } else if (lastAct && lastAct.stage !== act.stage) {
        const connectorId = "routeConnector-" + idx;
        connectors.push({ id: connectorId, from: lastAct.stage, to: act.stage });
        html += `<div class="route-connector" id="${connectorId}"></div>`;
      }
      const thumbId = "routeThumb-" + idx;
      thumbs.push({ id: thumbId, artist: act.artist });
      const duration = estimatedDurationFor(day, act);
      html += `
        <button class="route-item" data-idx="${idx}" style="--stage-color:var(${STAGE_COLOR_VARS[act.stage]})">
          <div class="route-thumb route-thumb-empty" id="${thumbId}"></div>
          <span class="route-item-main">
            <span class="route-item-top">
              <span class="route-time">${formatTimeForDisplay(lang, act)}</span>
              ${duration ? `<span class="route-duration">· ${t(lang, "routeDurationMin").replace("{min}", duration)}</span>` : ""}
            </span>
            <span class="route-artist">${act.artist}</span>
            <span class="route-stage">${act.stage}</span>
          </span>
        </button>`;
      lastDayId = day.id;
      lastAct = act;
    });
    html += `</div>`;
    els.routeView.innerHTML = html;

    els.routeView.querySelectorAll(".route-item").forEach((el) => {
      el.addEventListener("click", () => {
        const { day, act } = items[Number(el.dataset.idx)];
        openDetail(act, day);
      });
    });

    connectors.forEach(({ id, from, to }) => loadRouteConnector(id, from, to));
    thumbs.forEach(({ id, artist }) => loadArtistThumb(id, artist));
  }

  async function loadRouteConnector(containerId, from, to) {
    let data;
    try {
      const r = await fetch("/api/route-between?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
      data = await r.json();
    } catch {
      data = { minutes: null, geometry: null, directionsUrl: null };
    }

    const container = document.getElementById(containerId);
    if (!container) return; // user navigated away before this resolved

    const lang = state.lang;
    const walkLabel = typeof data.minutes === "number" ? t(lang, "routeWalkMinutes").replace("{min}", data.minutes) : t(lang, "routeWalkUnknown");

    container.innerHTML = `
      ${data.geometry ? `<div class="route-map" id="${containerId}-map"></div>` : ""}
      <a class="route-connector-info" href="${data.directionsUrl}" target="_blank" rel="noopener noreferrer">🚶 ${walkLabel}</a>
    `;

    if (data.geometry && window.L) {
      const mapEl = document.getElementById(containerId + "-map");
      const latlngs = data.geometry.map(([lng, lat]) => [lat, lng]);
      const map = L.map(mapEl, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(map);
      const line = L.polyline(latlngs, { color: "#2a78d6", weight: 4 }).addTo(map);
      L.circleMarker(latlngs[0], { radius: 6, color: "#fff", weight: 2, fillColor: "#1baf7a", fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#fff", weight: 2, fillColor: "#e34948", fillOpacity: 1 }).addTo(
        map
      );
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
      mapEl.addEventListener("click", () => window.open(data.directionsUrl, "_blank", "noopener"));
    }
  }

  function renderUserView() {
    const lang = state.lang;
    const guest = isGuest();
    const isDark = effectiveTheme() === "dark";
    const label = guest ? t(lang, "guestLabel") : state.user;

    els.userView.innerHTML = `
      <div class="page-inner">
        <h2>${t(lang, "userTitle")}</h2>
        <p class="user-current-name">${label}</p>

        <div class="settings-row">
          <span>${t(lang, "languageLabel")}</span>
          <button class="icon-btn" id="langToggleBtn">${t(lang, "langBtn")}</button>
        </div>
        <div class="settings-row">
          <span>${t(lang, "themeLabel")}</span>
          <button class="icon-btn" id="themeToggleBtn">${isDark ? "☀️" : "🌙"} ${t(lang, isDark ? "lightModeBtn" : "darkModeBtn")}</button>
        </div>

        ${
          guest
            ? `<button class="guest-btn" id="userLoginBtn">${t(lang, "loginBtn")}</button>`
            : `
          <button class="guest-btn" id="userLogoutBtn">${t(lang, "logout")}</button>
          <button class="danger-btn" id="userDeleteBtn">${t(lang, "deleteAccountBtn")}</button>
          ${
            state.confirmingDelete
              ? `<div class="confirm-delete">
                   <p>${t(lang, "deleteAccountConfirm")}</p>
                   <div class="confirm-delete-actions">
                     <button class="danger-btn" id="confirmDeleteBtn">${t(lang, "deleteAccountConfirmBtn")}</button>
                     <button class="icon-btn" id="cancelDeleteBtn">${t(lang, "cancelBtn")}</button>
                   </div>
                 </div>`
              : ""
          }`
        }
      </div>
    `;

    document.getElementById("langToggleBtn").addEventListener("click", () => {
      state.lang = state.lang === "es" ? "en" : "es";
      renderAll();
    });
    document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);

    if (guest) {
      document.getElementById("userLoginBtn").addEventListener("click", handleLogout);
    } else {
      document.getElementById("userLogoutBtn").addEventListener("click", handleLogout);
      document.getElementById("userDeleteBtn").addEventListener("click", () => {
        state.confirmingDelete = true;
        renderUserView();
      });
      if (state.confirmingDelete) {
        document.getElementById("confirmDeleteBtn").addEventListener("click", handleDeleteAccount);
        document.getElementById("cancelDeleteBtn").addEventListener("click", () => {
          state.confirmingDelete = false;
          renderUserView();
        });
      }
    }
  }

  function renderAll() {
    renderBottomNav();
    els.calendarView.style.display = state.activeView === "calendar" ? "" : "none";
    els.routeView.style.display = state.activeView === "route" ? "" : "none";
    els.userView.style.display = state.activeView === "user" ? "" : "none";

    if (state.activeView === "calendar") {
      const day = FESTIVAL_DATA.days[state.dayIndex];
      renderDayTabs();
      renderFavFilter();
      renderTimeline(day);
      renderTba(day);
    } else if (state.activeView === "route") {
      renderRouteView();
    } else if (state.activeView === "user") {
      renderUserView();
    }
    renderDetail();
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
