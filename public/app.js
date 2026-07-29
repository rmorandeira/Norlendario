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

  const state = {
    lang: (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es",
    dayIndex: 0,
    detail: null, // { act, day }
    user: null, // null (signed out) | "guest" | username
    favorites: new Set(),
    favoritesOnly: false,
    authMode: "login", // "login" | "signup"
    authError: null
  };

  const els = {
    dayTabs: document.getElementById("dayTabs"),
    legend: document.getElementById("legend"),
    timeline: document.getElementById("timeline"),
    tbaSection: document.getElementById("tbaSection"),
    authGate: document.getElementById("authGate")
  };

  function actId(day, act) {
    return day.id + "::" + act.stage + "::" + act.artist;
  }

  function isFavorite(day, act) {
    return state.favorites.has(actId(day, act));
  }

  async function toggleFavorite(day, act) {
    const id = actId(day, act);
    const willFavorite = !state.favorites.has(id);
    if (willFavorite) state.favorites.add(id);
    else state.favorites.delete(id);

    if (state.user === "guest") {
      GuestFavorites.save(state.favorites);
    } else {
      try {
        if (willFavorite) await Api.addFavorite(id);
        else await Api.removeFavorite(id);
      } catch {
        if (willFavorite) state.favorites.delete(id);
        else state.favorites.add(id);
      }
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

  function stagesWithActs(day) {
    return FESTIVAL_DATA.stages.filter((stage) => day.acts.some((a) => a.stage === stage && !a.tba));
  }

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

    const langBtn = document.createElement("button");
    langBtn.className = "lang-toggle";
    langBtn.textContent = t(state.lang, "langBtn");
    langBtn.setAttribute("aria-label", "Switch language");
    langBtn.addEventListener("click", () => {
      state.lang = state.lang === "es" ? "en" : "es";
      renderAll();
    });
    els.dayTabs.appendChild(langBtn);
  }

  function renderLegend(day) {
    els.legend.innerHTML = "";
    const title = document.createElement("span");
    title.className = "legend-title";
    title.textContent = t(state.lang, "stages");
    els.legend.appendChild(title);

    stagesWithActs(day).forEach((stage) => {
      const chip = document.createElement("span");
      chip.className = "legend-chip";
      chip.innerHTML = `<i style="background:var(${STAGE_COLOR_VARS[stage]})"></i>${stage}`;
      els.legend.appendChild(chip);
    });

    const favBtn = document.createElement("button");
    favBtn.className = "fav-filter-btn" + (state.favoritesOnly ? " active" : "");
    favBtn.innerHTML = `★ ${t(state.lang, "favoritesOnlyBtn")}`;
    favBtn.addEventListener("click", () => {
      state.favoritesOnly = !state.favoritesOnly;
      renderAll();
    });
    els.legend.appendChild(favBtn);
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
    const hint = document.createElement("p");
    hint.className = "tap-hint";
    hint.textContent = t(state.lang, "tapHint");
    els.timeline.appendChild(hint);

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
          el.appendChild(starButton(day, block));
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
      chip.appendChild(starButton(day, act));
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
    state.detail = { act, day };
    renderDetail();
    document.body.classList.add("detail-open");
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
    const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(act.artist);
    const fav = isFavorite(day, act);

    panel.innerHTML = `
      <div class="artist-view-inner">
        <button class="back-btn" id="backBtn">&larr; ${t(lang, "back")}</button>
        <div class="artist-card">
          <span class="stage-pill" style="background:var(${STAGE_COLOR_VARS[act.stage]})">${act.stage}</span>
          <h2>${act.artist}</h2>
          <dl class="artist-meta">
            <div><dt>${t(lang, "day")}</dt><dd>${formatDayDate(lang, day)}</dd></div>
            <div><dt>${t(lang, "schedule")}</dt><dd>${formatTimeForDisplay(lang, act)}</dd></div>
            <div><dt>${t(lang, "stage")}</dt><dd>${act.stage}</dd></div>
          </dl>
          <div class="detail-actions">
            <a class="spotify-btn" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.59 14.4a.62.62 0 0 1-.86.21c-2.36-1.44-5.34-1.77-8.84-.97a.63.63 0 1 1-.28-1.23c3.83-.87 7.12-.5 9.77 1.12a.63.63 0 0 1 .21.87Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.7-1.66-6.82-2.14-10.02-1.17a.78.78 0 1 1-.45-1.49c3.65-1.11 8.19-.57 11.28 1.33a.78.78 0 0 1 .26 1.07Zm.11-2.83c-3.24-1.92-8.6-2.1-11.7-1.16a.94.94 0 1 1-.55-1.8c3.56-1.08 9.46-.87 13.19 1.34a.94.94 0 0 1-.94 1.62Z"/></svg>
              ${t(lang, "spotifyBtn")}
            </a>
            <button class="star-btn detail-star${fav ? " is-fav" : ""}" id="detailStarBtn" aria-label="${t(lang, fav ? "favoriteRemove" : "favoriteAdd")}">
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M12 3.5l2.47 5.15 5.53.76-4 3.98.95 5.61L12 16.3l-4.95 2.7.95-5.61-4-3.98 5.53-.76z"/></svg>
            </button>
          </div>
          <p class="spotify-note">${t(lang, "spotifyNote")}</p>
        </div>
      </div>
    `;
    document.getElementById("backBtn").addEventListener("click", closeDetail);
    document.getElementById("detailStarBtn").addEventListener("click", () => toggleFavorite(day, act));
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
    const label = state.user === "guest" ? t(state.lang, "guestLabel") : state.user;
    badge.innerHTML = `<span class="user-name">${label}</span><button class="logout-btn" id="logoutBtn">${t(state.lang, "logout")}</button>`;
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
    renderLegend(day);
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
        <p class="gate-subtitle">${t(lang, "gateSubtitle")}</p>
        <form id="authForm" novalidate>
          <label>${t(lang, "usernameLabel")}
            <input type="text" name="username" autocomplete="username" required minlength="3" maxlength="32" />
          </label>
          <label>${t(lang, "passwordLabel")}
            <input type="password" name="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="4" />
          </label>
          ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
          <button type="submit" class="auth-submit">${t(lang, isSignup ? "signupBtn" : "loginBtn")}</button>
        </form>
        <button class="auth-toggle-mode" id="authToggleMode">${t(lang, isSignup ? "toggleToLogin" : "toggleToSignup")}</button>
        <div class="gate-divider"><span>${t(lang, "orDivider")}</span></div>
        <button class="guest-btn" id="guestBtn">${t(lang, "guestBtn")}</button>
      </div>
    `;

    document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);
    document.getElementById("authToggleMode").addEventListener("click", () => {
      state.authMode = isSignup ? "login" : "signup";
      state.authError = null;
      renderGate();
    });
    document.getElementById("guestBtn").addEventListener("click", handleGuestLogin);
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
    state.favorites = GuestFavorites.load();
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
      /* fall through to gate */
    }
    showGate();
  }

  boot();
})();
