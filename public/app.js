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

  // Canvas can't read CSS custom properties, so the share-image card uses
  // this hardcoded copy of the dark-theme stage colors from style.css.
  const STAGE_COLOR_HEX = {
    "Azcárraga": "#3987e5",
    "Campo da Leña": "#d95926",
    "Santa Margarida": "#199e70",
    "Castelo de Santo Antón": "#c98500",
    "Praza de María Pita": "#d55181",
    "Praia de Riazor": "#008300",
    "O Portiño": "#9085e9"
  };

  const DEFAULT_DURATION = 60; // minutes, used for the last act on a stage each day
  const MAX_DURATION = 90; // minutes, cap when the next act starts later than this
  const MIN_DURATION = 30; // minutes, floor so a block always stays readable

  const APP_VERSION = "1.3.1";
  const THEME_KEY = "noroeste_theme";

  // Hardcoded rather than location.origin so shared text/images always point
  // at the real production app, even when tested from localhost.
  const APP_URL = "https://norlendario.web.up.railway.app";

  const state = {
    lang: (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es",
    theme: localStorage.getItem(THEME_KEY), // "light" | "dark" | null (follow system)
    dayIndex: 0,
    activeView: "calendar", // "calendar" | "route" | "user"
    detail: null, // { act, day }
    user: null, // null (signed out) | "guest" | username
    favorites: new Set(),
    favCounts: new Map(), // actId -> public aggregate favorite count, visible to guests too
    comments: new Map(), // actId -> personal note, account-only like favorites
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function commentsMapFromObject(obj) {
    return new Map(Object.entries(obj || {}));
  }

  function formatCommentMeta(lang, updatedAt) {
    if (!updatedAt) return "";
    const d = new Date(updatedAt.replace(" ", "T") + "Z");
    if (isNaN(d)) return "";
    const day = d.getDate();
    const month = d.toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { month: "short" }).replace(".", "");
    const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${monthCap} ${hh}:${mm} · ${state.user}`;
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

    const prevCount = state.favCounts.get(id) || 0;
    state.favCounts.set(id, Math.max(0, prevCount + (willFavorite ? 1 : -1)));

    try {
      if (willFavorite) await Api.addFavorite(id);
      else await Api.removeFavorite(id);
    } catch {
      if (willFavorite) state.favorites.delete(id);
      else state.favorites.add(id);
      state.favCounts.set(id, prevCount);
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
  // leftover space blank. Recomputed after loadFestivalData() replaces
  // FESTIVAL_DATA.days with the DB-sourced (and admin-editable) lineup.
  let maxStagesPerDay = 1;
  function recomputeMaxStagesPerDay() {
    maxStagesPerDay = Math.max(...FESTIVAL_DATA.days.map((d) => stagesWithActs(d).length || 1));
  }
  recomputeMaxStagesPerDay();

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
  let currentRouteItems = []; // the {day, act} list from the last renderRouteView(), for comment/share handlers

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
          const favCount = state.favCounts.get(actId(day, block)) || 0;
          const attendingText =
            favCount > 0
              ? t(state.lang, favCount === 1 ? "attendingCountOne" : "attendingCount").replace("{count}", favCount)
              : "";
          el.innerHTML = `<span class="act-time">${block.time}${
            favCount > 0 ? ` <span class="act-fav-count">· ${attendingText}</span>` : ""
          }</span><span class="act-name">${block.artist}</span>`;
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
    const maxRowHeight = Math.floor(available / maxStagesPerDay);
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
          <h2>${act.artist}</h2>
          <div class="event-meta">
            <div class="event-meta-row">
              <span class="event-date">${formatDayDate(lang, day)}</span>
              <a class="event-venue" href="${mapsUrl(act.stage)}" target="_blank" rel="noopener noreferrer">
                <i style="background:var(${STAGE_COLOR_VARS[act.stage]})"></i>${act.stage}
              </a>
            </div>
            <div class="event-time">${formatTimeForDisplay(lang, act)}</div>
          </div>
          <div class="artist-extra" id="artistExtra">${renderArtistExtraHTML()}</div>
          <div class="detail-actions">
            <a class="spotify-btn" id="spotifyBtn" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.59 14.4a.62.62 0 0 1-.86.21c-2.36-1.44-5.34-1.77-8.84-.97a.63.63 0 1 1-.28-1.23c3.83-.87 7.12-.5 9.77 1.12a.63.63 0 0 1 .21.87Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.7-1.66-6.82-2.14-10.02-1.17a.78.78 0 1 1-.45-1.49c3.65-1.11 8.19-.57 11.28 1.33a.78.78 0 0 1 .26 1.07Zm.11-2.83c-3.24-1.92-8.6-2.1-11.7-1.16a.94.94 0 1 1-.55-1.8c3.56-1.08 9.46-.87 13.19 1.34a.94.94 0 0 1-.94 1.62Z"/></svg>
              ${t(lang, "spotifyBtn")}
            </a>
            <button class="share-btn" id="shareArtistBtn" aria-label="${t(lang, "shareBtn")}">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81a3 3 0 1 0-3-3c0 .24.04.47.09.7L7.04 9.81A3 3 0 1 0 6 15.5c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65a2.92 2.92 0 1 0 2.92-2.92Z"/></svg>
            </button>
            ${starHTML}
          </div>
        </div>
      </div>
    `;
    document.getElementById("backBtn").addEventListener("click", closeDetail);
    const starBtn = document.getElementById("detailStarBtn");
    if (starBtn) starBtn.addEventListener("click", () => toggleFavorite(day, act));
    document.getElementById("shareArtistBtn").addEventListener("click", () => shareArtist(act));
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

    const hasDescription = extra && extra.description;
    const hasGenres = extra && extra.genres && extra.genres.length > 0;
    const hasFollowers = extra && typeof extra.followers === "number";
    const hasImage = extra && extra.image;
    const hasEvents = extra && extra.events && extra.events.length > 0;

    if (!hasDescription && !hasGenres && !hasFollowers && !hasImage && !hasEvents) {
      return `<p class="extra-status">${t(lang, "noExtraInfo")}</p>`;
    }

    let html = "";
    if (hasImage) {
      html += `<img class="artist-photo" src="${extra.image}" alt="${state.detail.act.artist}" loading="lazy" />`;
    }
    if (hasDescription) {
      html += `<p class="artist-description">${extra.description}</p>`;
    } else if (hasGenres || hasFollowers) {
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
    state.comments = new Map();
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

  // --- Sharing (artist ficha + Mi ruta) ---

  function shareViaWebShareOrWhatsapp(shareData, text) {
    if (navigator.share) {
      navigator.share(shareData).catch(() => {
        /* user cancelled the native share sheet — nothing to do */
      });
    } else {
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    }
  }

  function shareArtist(act) {
    const lang = state.lang;
    const spotifyUrl =
      (state.detail && state.detail.extra && state.detail.extra.spotifyUrl) ||
      "https://open.spotify.com/search/" + encodeURIComponent(act.artist);
    const text = `${t(lang, "shareArtistText").replace("{artist}", act.artist)}\n${spotifyUrl}`;
    shareViaWebShareOrWhatsapp({ title: act.artist, text }, text);
  }

  function buildRouteShareText(items) {
    const lang = state.lang;
    const lines = [t(lang, "shareRouteHeader")];
    let lastDayId = null;
    items.forEach(({ day, act }) => {
      if (day.id !== lastDayId) {
        lines.push("");
        lines.push(formatDayDate(lang, day).toUpperCase());
        lastDayId = day.id;
      }
      lines.push(`• ${formatTimeForDisplay(lang, act)} — ${act.artist} (${act.stage})`);
      const comment = state.comments.get(actId(day, act));
      if (comment) lines.push(`   💬 "${comment.comment}"`);
    });
    lines.push("");
    lines.push(t(lang, "shareRouteFooter"));
    lines.push(APP_URL);
    return lines.join("\n");
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Shares the route as an actual image (not just text) wherever possible —
  // WhatsApp (and any other app in the native share sheet) receives the
  // photo plus a text caption. Only falls back to a text-only wa.me link on
  // browsers without Web Share file support (mainly desktop).
  async function shareRoute(items) {
    const blob = await buildRouteStoryBlob(items);
    if (!blob) return;
    const file = new File([blob], "mi-ruta-noroeste-2026.png", { type: "image/png" });
    const text = buildRouteShareText(items);

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: t(state.lang, "routeTitle") });
      } catch {
        /* user cancelled the native share sheet */
      }
      return;
    }

    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    triggerBlobDownload(blob, "mi-ruta-noroeste-2026.png");
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function loadCanvasImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Renders "Mi ruta" as a 1080x1920 Instagram Story image: full lineup +
  // comments (condensed, truncated with a "+N" line if it overflows), plus
  // one randomly featured artist up top. We can't embed real audio here —
  // Instagram doesn't expose a public API for that to outside websites, and
  // Spotify's API gives us metadata/images only, not licensed track audio —
  // so the featured artist is a visual cue for the person to add the real
  // song themselves via Instagram's own music sticker after sharing.
  async function buildRouteStoryBlob(items) {
    const lang = state.lang;
    const width = 1080;
    const height = 1920;
    const padding = 56;
    const bottomSafe = 180; // leaves room for Instagram's own story UI

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 52px system-ui, sans-serif";
    ctx.fillText("NORLENDARIO", padding, 100);
    ctx.fillStyle = "#c3c2b7";
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillText(APP_URL, padding, 140);
    ctx.fillStyle = "#898781";
    ctx.font = "500 26px system-ui, sans-serif";
    ctx.fillText(t(lang, "shareRouteHeader"), padding, 178);
    ctx.strokeStyle = "#2c2c2a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, 212);
    ctx.lineTo(width - padding, 212);
    ctx.stroke();

    // --- Featured artist, picked at random each time this is shared ---
    const featured = items[Math.floor(Math.random() * items.length)].act;
    const heroSize = 300;
    const heroX = (width - heroSize) / 2;
    const heroY = 274;
    const heroCx = width / 2;
    const heroCy = heroY + heroSize / 2;

    ctx.fillStyle = "#898781";
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t(lang, "storyFeaturedLabel").toUpperCase(), heroCx, 250);

    const featuredInfo = artistInfoCache.get(featured.artist);
    const heroImg = await loadCanvasImage(featuredInfo && featuredInfo.image);
    ctx.save();
    drawRoundedRect(ctx, heroX, heroY, heroSize, heroSize, 28);
    ctx.clip();
    if (heroImg) {
      ctx.drawImage(heroImg, heroX, heroY, heroSize, heroSize);
    } else {
      ctx.fillStyle = STAGE_COLOR_HEX[featured.stage] || "#444";
      ctx.fillRect(heroX, heroY, heroSize, heroSize);
      ctx.fillStyle = "#fff";
      ctx.font = "700 120px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(featured.artist[0].toUpperCase(), heroCx, heroCy + 6);
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 46px system-ui, sans-serif";
    ctx.fillText(featured.artist, heroCx, heroY + heroSize + 56);
    ctx.fillStyle = "#c3c2b7";
    ctx.font = "500 28px system-ui, sans-serif";
    ctx.fillText(`${formatTimeForDisplay(lang, featured)} · ${featured.stage}`, heroCx, heroY + heroSize + 96);
    ctx.fillStyle = "#898781";
    ctx.font = "500 24px system-ui, sans-serif";
    ctx.fillText(t(lang, "storyMusicHint"), heroCx, heroY + heroSize + 138);
    ctx.textAlign = "left";

    ctx.strokeStyle = "#2c2c2a";
    ctx.beginPath();
    ctx.moveTo(padding, heroY + heroSize + 172);
    ctx.lineTo(width - padding, heroY + heroSize + 172);
    ctx.stroke();

    // --- Condensed full lineup below, truncated if it would overflow ---
    const avatarSize = 64;
    const rowGap = 18;
    const rowHeight = avatarSize + 16;
    const dayHeadingHeight = 42;
    const textX = padding + avatarSize + 24;
    const commentMaxWidth = width - padding - textX - 32;

    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    mctx.font = "500 22px system-ui, sans-serif";

    const rows = [];
    let lastDayId = null;
    items.forEach(({ day, act }) => {
      if (day.id !== lastDayId) {
        rows.push({ type: "day", label: formatDayDate(lang, day).toUpperCase() });
        lastDayId = day.id;
      }
      const comment = state.comments.get(actId(day, act));
      const commentLines = comment ? wrapCanvasText(mctx, comment.comment, commentMaxWidth) : [];
      rows.push({ type: "act", act, commentLines });
    });

    function rowPx(row) {
      if (row.type === "day") return dayHeadingHeight;
      let h = rowHeight + rowGap;
      if (row.commentLines.length) h += row.commentLines.length * 28 + 20 + 10;
      return h;
    }

    const listTop = heroY + heroSize + 200;
    const availableHeight = height - bottomSafe - listTop;
    const moreLineHeight = 44;
    let visibleRows = rows;
    let hiddenActCount = 0;
    let used = rows.reduce((sum, r) => sum + rowPx(r), 0);
    while (used > availableHeight && visibleRows.length) {
      const dropped = visibleRows[visibleRows.length - 1];
      visibleRows = visibleRows.slice(0, -1);
      used -= rowPx(dropped);
      if (dropped.type === "act") hiddenActCount++;
      if (used + (hiddenActCount ? moreLineHeight : 0) <= availableHeight) break;
    }
    while (visibleRows.length && visibleRows[visibleRows.length - 1].type === "day") {
      visibleRows = visibleRows.slice(0, -1);
    }

    let y = listTop;
    for (const row of visibleRows) {
      if (row.type === "day") {
        ctx.fillStyle = "#898781";
        ctx.font = "700 24px system-ui, sans-serif";
        ctx.fillText(row.label, padding, y);
        y += dayHeadingHeight;
        continue;
      }
      const { act, commentLines } = row;
      const info = artistInfoCache.get(act.artist);
      const img = await loadCanvasImage(info && info.image);
      const cx = padding + avatarSize / 2;
      const cy = y + avatarSize / 2;

      ctx.fillStyle = STAGE_COLOR_HEX[act.stage] || "#666";
      ctx.fillRect(padding - 18, y, 5, avatarSize);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (img) {
        ctx.drawImage(img, padding, y, avatarSize, avatarSize);
      } else {
        ctx.fillStyle = STAGE_COLOR_HEX[act.stage] || "#444";
        ctx.fillRect(padding, y, avatarSize, avatarSize);
        ctx.fillStyle = "#fff";
        ctx.font = "700 26px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(act.artist[0].toUpperCase(), cx, cy + 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 28px system-ui, sans-serif";
      ctx.fillText(act.artist, textX, y + 30);
      ctx.fillStyle = "#c3c2b7";
      ctx.font = "500 22px system-ui, sans-serif";
      ctx.fillText(`${formatTimeForDisplay(lang, act)} · ${act.stage}`, textX, y + 58);

      y += rowHeight;

      if (commentLines.length) {
        const bubbleHeight = commentLines.length * 28 + 20;
        ctx.fillStyle = "#1a1a19";
        drawRoundedRect(ctx, textX, y, commentMaxWidth, bubbleHeight, 12);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "italic 500 22px system-ui, sans-serif";
        commentLines.forEach((line, i) => {
          ctx.fillText(line, textX + 16, y + 26 + i * 28);
        });
        y += bubbleHeight + 10;
      }
      y += rowGap;
    }

    if (hiddenActCount > 0) {
      ctx.fillStyle = "#898781";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText(t(lang, "shareMoreCount").replace("{count}", hiddenActCount), padding, y + 8);
    }

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function shareRouteImageToInstagram(items) {
    const blob = await buildRouteStoryBlob(items);
    if (!blob) return;
    const file = new File([blob], "mi-ruta-noroeste-2026.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch {
        /* user cancelled the native share sheet — nothing to do */
      }
      return;
    }

    // No file-sharing support (most desktop browsers): fall back to a plain
    // download so the image can still be uploaded to a story manually.
    triggerBlobDownload(blob, "mi-ruta-noroeste-2026.png");
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

    currentRouteItems = items;

    let html = `<div class="page-inner">
      <div class="route-header">
        <div class="route-header-text">
          <h2>${t(lang, "routeTitle")}</h2>
          <p class="page-subtitle">${t(lang, "routeSubtitle")}</p>
        </div>
        <div class="route-share-actions">
          <button class="route-icon-btn" id="routeShareBtn" aria-label="${t(lang, "shareBtn")}" title="${t(lang, "shareBtn")}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81a3 3 0 1 0-3-3c0 .24.04.47.09.7L7.04 9.81A3 3 0 1 0 6 15.5c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65a2.92 2.92 0 1 0 2.92-2.92Z"/></svg>
          </button>
          <button class="route-icon-btn" id="routeInstagramBtn" aria-label="${t(lang, "shareInstagramBtn")}" title="${t(lang, "shareInstagramBtn")}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 4.8A1.8 1.8 0 1 1 12 10.2a1.8 1.8 0 0 1 0 3.6ZM7 4h6.17L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1L9.83 4H7Zm2.83 2L8 8H7v9h10V8h-2.83L12.5 6h-2.67Z"/></svg>
          </button>
        </div>
      </div>`;
    let lastDayId = null;
    let lastAct = null;
    const connectors = [];
    const thumbs = [];

    items.forEach(({ day, act }, idx) => {
      const sameDay = day.id === lastDayId;
      if (!sameDay) {
        if (lastDayId !== null) html += `</div>`;
        html += `<h3 class="route-day-heading">${formatDayDate(lang, day)}</h3>`;
        html += `<div class="route-day-group">`;
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
        </button>
        <div class="route-comment" data-idx="${idx}">${routeCommentBlockHTML(idx)}</div>`;
      lastDayId = day.id;
      lastAct = act;
    });
    html += `</div></div>`;
    els.routeView.innerHTML = html;

    els.routeView.querySelectorAll(".route-item").forEach((el) => {
      el.addEventListener("click", () => {
        const { day, act } = items[Number(el.dataset.idx)];
        openDetail(act, day);
      });
    });

    items.forEach((_, idx) => wireCommentBlock(idx));

    document.getElementById("routeShareBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = t(lang, "generatingImage");
      try {
        await shareRoute(items);
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
    document.getElementById("routeInstagramBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = t(lang, "generatingImage");
      try {
        await shareRouteImageToInstagram(items);
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });

    connectors.forEach(({ id, from, to }) => loadRouteConnector(id, from, to));
    thumbs.forEach(({ id, artist }) => loadArtistThumb(id, artist));
  }

  // --- Personal comments on Mi ruta stops ---

  function routeCommentBlockHTML(idx) {
    const item = currentRouteItems[idx];
    const lang = state.lang;
    const comment = state.comments.get(actId(item.day, item.act));
    if (comment) {
      const meta = formatCommentMeta(lang, comment.updatedAt);
      return `
        <div class="comment-bubble">
          <p>${escapeHtml(comment.comment)}</p>
          <button class="comment-edit-btn" data-idx="${idx}" aria-label="${t(lang, "editCommentBtn")}">✏️</button>
        </div>
        ${meta ? `<div class="comment-meta">${meta}</div>` : ""}`;
    }
    return `<button class="comment-add-btn" data-idx="${idx}">${t(lang, "addCommentBtn")}…</button>`;
  }

  function wireCommentBlock(idx) {
    const container = els.routeView.querySelector(`.route-comment[data-idx="${idx}"]`);
    if (!container) return;
    const btn = container.querySelector(".comment-add-btn, .comment-edit-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        startCommentEdit(idx);
      });
    }
  }

  function renderRouteCommentBlock(idx) {
    const container = els.routeView.querySelector(`.route-comment[data-idx="${idx}"]`);
    if (!container) return;
    container.innerHTML = routeCommentBlockHTML(idx);
    wireCommentBlock(idx);
  }

  function startCommentEdit(idx) {
    const item = currentRouteItems[idx];
    if (!item) return;
    const container = els.routeView.querySelector(`.route-comment[data-idx="${idx}"]`);
    if (!container) return;
    const lang = state.lang;
    const existing = state.comments.get(actId(item.day, item.act));
    const current = existing ? existing.comment : "";
    container.innerHTML = `
      <form class="comment-form">
        <textarea maxlength="200" placeholder="${t(lang, "commentPlaceholder")}">${escapeHtml(current)}</textarea>
        <div class="comment-form-actions">
          <button type="submit" class="comment-save-btn">${t(lang, "saveBtn")}</button>
          <button type="button" class="comment-cancel-btn" data-action="cancel">${t(lang, "cancelBtn")}</button>
          ${current ? `<button type="button" class="comment-delete-btn" data-action="delete">${t(lang, "deleteBtn")}</button>` : ""}
        </div>
      </form>`;
    const form = container.querySelector("form");
    const textarea = form.querySelector("textarea");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    form.addEventListener("click", (e) => e.stopPropagation());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveComment(idx, textarea.value);
    });
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => renderRouteCommentBlock(idx));
    const delBtn = form.querySelector('[data-action="delete"]');
    if (delBtn) delBtn.addEventListener("click", () => saveComment(idx, ""));
  }

  async function saveComment(idx, text) {
    const item = currentRouteItems[idx];
    if (!item) return;
    const id = actId(item.day, item.act);
    const trimmed = text.trim();
    const previous = state.comments.get(id);
    if (trimmed) state.comments.set(id, { comment: trimmed, updatedAt: previous ? previous.updatedAt : null });
    else state.comments.delete(id);
    renderRouteCommentBlock(idx);
    try {
      const result = await Api.setComment(id, trimmed);
      if (trimmed && result) {
        state.comments.set(id, result);
        renderRouteCommentBlock(idx);
      }
    } catch {
      /* best-effort; the comment stays client-side even if the request fails */
    }
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
      <a class="route-connector-info" href="${data.directionsUrl}" target="_blank" rel="noopener noreferrer">
        <span class="route-walk-icon">🚶</span><span class="route-walk-label">${walkLabel}</span>
      </a>
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
      // The container has just been inserted via innerHTML, so Leaflet can
      // compute the wrong pixel size/bounds if fitBounds runs in the same
      // tick (every map ends up framed the same way) — invalidateSize
      // after a layout pass fixes it.
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(line.getBounds(), { padding: [16, 16] });
      }, 0);
      mapEl.addEventListener("click", () => window.open(data.directionsUrl, "_blank", "noopener"));
    }
  }

  function renderUserView() {
    const lang = state.lang;
    const guest = isGuest();
    const isDark = effectiveTheme() === "dark";
    const isEn = lang === "en";

    els.userView.innerHTML = `
      <div class="page-inner">
        <div class="route-header-text">
          <h2 class="app-name-heading">${t(lang, "appName")}</h2>
          <p class="page-subtitle">${t(lang, "routeSubtitle")}</p>
        </div>

        ${
          guest
            ? ""
            : `
        <div class="settings-row">
          <span>${t(lang, "usernameLabel")}</span>
          <span class="settings-value">${state.user}</span>
        </div>
        <div class="settings-row">
          <span>${t(lang, "passwordFieldLabel")}</span>
          <span class="settings-value settings-value-muted">••••••••••••</span>
        </div>`
        }

        <div class="settings-row">
          <span>${t(lang, "languageLabel")}</span>
          <button class="mode-switch" id="langToggleBtn" role="switch" aria-checked="${isEn}" aria-label="${t(lang, "languageLabel")}">
            <span class="mode-switch-label">${isEn ? "EN" : "ES"}</span>
            <span class="mode-switch-dot"></span>
          </button>
        </div>
        <div class="settings-row">
          <span>${t(lang, "themeLabel")}</span>
          <button class="mode-switch" id="themeToggleBtn" role="switch" aria-checked="${isDark}" aria-label="${t(lang, "themeLabel")}">
            <span class="mode-switch-label">${isDark ? "🌙" : "☀️"}</span>
            <span class="mode-switch-dot"></span>
          </button>
        </div>

        <div class="about-block">
          <p>${t(lang, "aboutP1")}</p>
          <p>${t(lang, "aboutP2")}</p>
          <p>${t(lang, "aboutP3")}</p>
          <div class="kofi-container">
            <a href="https://ko-fi.com/F1F41CM0Q" target="_blank" rel="noopener noreferrer"><img height="36" style="border:0;height:36px" src="https://storage.ko-fi.com/cdn/kofi3.png?v=6" alt="Buy Me a Coffee at ko-fi.com" /></a>
          </div>
          <p>${t(lang, "aboutContact").replace("{email}", '<a href="mailto:rmorandeira@gmail.com">rmorandeira@gmail.com</a>')}</p>
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
        <div class="route-header-text">
          <h1 class="app-name-heading">${t(lang, "appName")}</h1>
          <p class="page-subtitle">${t(lang, "routeSubtitle")}</p>
        </div>
        <h2 class="gate-mode-heading">${t(lang, isSignup ? "gateModeSignup" : "gateModeLogin")}</h2>
        <form id="authForm" novalidate>
          <label>${t(lang, "nameFieldLabel")}
            <input type="text" name="username" autocomplete="username" required minlength="3" maxlength="32" />
          </label>
          <label>${t(lang, "passwordLabel")}
            <input type="password" name="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="4" />
          </label>
          ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
          ${
            isSignup
              ? `<div class="gate-form-actions">
                   <button type="button" class="guest-btn" id="cancelSignupBtn">${t(lang, "cancelBtn")}</button>
                   <button type="submit" class="auth-submit">${t(lang, "signupBtn")}</button>
                 </div>`
              : `<button type="submit" class="auth-submit">${t(lang, "loginBtn")}</button>`
          }
        </form>
        ${
          isSignup
            ? `<div class="gate-warning">
                 <p>${t(lang, "signupWarning1")}</p>
                 <p>${t(lang, "signupWarning2")}</p>
                 <p>${t(lang, "signupWarning3")}</p>
               </div>`
            : `<div class="gate-divider"><span>${t(lang, "orDivider")}</span></div>
               <button class="guest-btn" id="guestBtn">${t(lang, "guestBtn")}</button>
               <p class="gate-switch-mode">${t(lang, "noAccountPrompt")} <button type="button" class="gate-switch-link" id="switchToSignupBtn">${t(lang, "createAccountLink")}</button></p>`
        }
        <p class="gate-disclaimer">${t(lang, "unofficialDisclaimer")}<br />v${APP_VERSION}</p>
      </div>
    `;

    document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);
    if (isSignup) {
      document.getElementById("cancelSignupBtn").addEventListener("click", () => {
        state.authMode = "login";
        state.authError = null;
        renderGate();
      });
    } else {
      document.getElementById("guestBtn").addEventListener("click", handleGuestLogin);
      document.getElementById("switchToSignupBtn").addEventListener("click", () => {
        state.authMode = "signup";
        state.authError = null;
        renderGate();
      });
    }
  }

  function authErrorMessage(err) {
    const map = {
      username_length: "errUsernameLength",
      password_length: "errPasswordLength",
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

    try {
      const data = isSignup ? await Api.signup(username, password) : await Api.login(username, password);
      state.user = data.username;
      state.favorites = new Set(await Api.getFavorites());
      state.comments = commentsMapFromObject(await Api.getComments());
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
    state.comments = new Map();
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

  async function loadFestivalData() {
    try {
      const r = await fetch("/api/festival-data");
      const data = await r.json();
      if (data && Array.isArray(data.days) && data.days.length) {
        FESTIVAL_DATA.days = data.days;
        if (Array.isArray(data.stages) && data.stages.length) FESTIVAL_DATA.stages = data.stages;
        recomputeMaxStagesPerDay();
      }
    } catch {
      // fall back to the static public/data.js lineup baked into the page
    }
  }

  async function loadFavCounts() {
    try {
      state.favCounts = new Map(Object.entries(await Api.getFavoriteCounts()));
    } catch {
      state.favCounts = new Map();
    }
  }

  async function boot() {
    await loadFestivalData();
    await loadFavCounts();
    try {
      const me = await Api.me();
      if (me.username) {
        state.user = me.username;
        state.favorites = new Set(await Api.getFavorites());
        state.comments = commentsMapFromObject(await Api.getComments());
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
    state.comments = new Map();
    renderAll();
  }

  boot();
})();
