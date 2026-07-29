(function () {
  const SECRET_KEY = "norlendario_admin_secret";
  let secret = sessionStorage.getItem(SECRET_KEY) || "";
  let activeTab = "acts";

  const els = {
    gate: document.getElementById("adminGate"),
    gateError: document.getElementById("adminGateError"),
    secretInput: document.getElementById("adminSecretInput"),
    secretSubmit: document.getElementById("adminSecretSubmit"),
    app: document.getElementById("adminApp"),
    tabs: document.getElementById("adminTabs"),
    main: document.getElementById("adminMain")
  };

  async function adminFetch(path, options = {}) {
    const headers = { "x-admin-secret": secret };
    if (options.body) headers["Content-Type"] = "application/json";
    const r = await fetch(path, { ...options, headers });
    if (r.status === 401) throw new Error("unauthorized");
    if (!r.ok) throw new Error("request_failed_" + r.status);
    if (r.status === 204) return null;
    return r.json();
  }

  async function tryEnter() {
    secret = els.secretInput.value.trim();
    try {
      await adminFetch("/api/admin/days"); // cheap authenticated call, just to validate the secret
      sessionStorage.setItem(SECRET_KEY, secret);
      showApp();
    } catch {
      els.gateError.textContent = "Secreto incorrecto o error de conexión.";
    }
  }

  els.secretSubmit.addEventListener("click", tryEnter);
  els.secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryEnter();
  });

  function showApp() {
    els.gate.style.display = "none";
    els.app.style.display = "block";
    renderTab();
  }

  els.tabs.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      els.tabs.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("active", b === btn));
      renderTab();
    });
  });

  function renderTab() {
    if (activeTab === "acts") renderActsTab();
    else if (activeTab === "artists") renderArtistsTab();
    else renderUsersTab();
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;");
  }

  // ---- Programación (acts) ----

  async function renderActsTab() {
    els.main.innerHTML = "<p>Cargando…</p>";
    const [acts, days] = await Promise.all([adminFetch("/api/admin/acts"), adminFetch("/api/admin/days")]);
    const stages = FESTIVAL_DATA.stages;

    let html = `
      <div class="admin-toolbar">
        <button id="addActBtn" class="admin-btn-primary">+ Añadir acto</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Día</th><th>Hora</th><th>Escenario</th><th>Artista</th><th></th></tr></thead>
          <tbody>`;
    acts.forEach((act) => {
      html += `
        <tr data-id="${act.id}">
          <td>${act.weekday} ${act.dateNum}</td>
          <td>${act.tba ? "Por confirmar" : act.time}</td>
          <td>${act.stage}</td>
          <td>${act.artist}</td>
          <td class="admin-row-actions">
            <button class="admin-btn-edit" data-id="${act.id}">Editar</button>
            <button class="admin-btn-danger" data-id="${act.id}">Eliminar</button>
          </td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
    els.main.innerHTML = html;

    document.getElementById("addActBtn").addEventListener("click", () => openActForm(null, days, stages));
    els.main.querySelectorAll(".admin-btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = acts.find((a) => String(a.id) === btn.dataset.id);
        openActForm(act, days, stages);
      });
    });
    els.main.querySelectorAll(".admin-btn-danger").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este acto?")) return;
        await adminFetch("/api/admin/acts/" + btn.dataset.id, { method: "DELETE" });
        renderActsTab();
      });
    });
  }

  function openActForm(act, days, stages) {
    const isNew = !act;
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";
    overlay.innerHTML = `
      <div class="admin-modal">
        <h2>${isNew ? "Añadir acto" : "Editar acto"}</h2>
        <label>Día
          <select id="formDay">
            ${days.map((d) => `<option value="${d.id}" ${act && act.dayId === d.id ? "selected" : ""}>${d.weekday} ${d.dateNum}</option>`).join("")}
          </select>
        </label>
        <label>Escenario
          <select id="formStage">
            ${stages.map((s) => `<option value="${escapeAttr(s)}" ${act && act.stage === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </label>
        <label>Artista
          <input type="text" id="formArtist" value="${act ? escapeAttr(act.artist) : ""}" />
        </label>
        <label class="admin-checkbox-label">
          <input type="checkbox" id="formTba" ${act && act.tba ? "checked" : ""} /> Por confirmar (sin hora)
        </label>
        <label id="formTimeLabel">Hora (HH:MM)
          <input type="text" id="formTime" value="${act && act.time ? act.time : ""}" placeholder="20:00" />
        </label>
        <div class="admin-modal-actions">
          <button id="formSave" class="admin-btn-primary">Guardar</button>
          <button id="formCancel" class="admin-btn">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const tbaCheckbox = overlay.querySelector("#formTba");
    const timeLabel = overlay.querySelector("#formTimeLabel");
    function syncTimeVisibility() {
      timeLabel.style.display = tbaCheckbox.checked ? "none" : "flex";
    }
    tbaCheckbox.addEventListener("change", syncTimeVisibility);
    syncTimeVisibility();

    overlay.querySelector("#formCancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#formSave").addEventListener("click", async () => {
      const payload = {
        dayId: overlay.querySelector("#formDay").value,
        stage: overlay.querySelector("#formStage").value,
        artist: overlay.querySelector("#formArtist").value.trim(),
        tba: tbaCheckbox.checked,
        time: overlay.querySelector("#formTime").value.trim()
      };
      if (!payload.artist || (!payload.tba && !payload.time)) {
        alert("Rellena artista y hora (o marca 'Por confirmar').");
        return;
      }
      if (isNew) await adminFetch("/api/admin/acts", { method: "POST", body: JSON.stringify(payload) });
      else await adminFetch("/api/admin/acts/" + act.id, { method: "PUT", body: JSON.stringify(payload) });
      overlay.remove();
      renderActsTab();
    });
  }

  // ---- Artistas ----

  async function renderArtistsTab() {
    els.main.innerHTML = "<p>Cargando…</p>";
    const artists = await adminFetch("/api/admin/artists");
    let html = `
      <div class="admin-toolbar">
        <button id="regenAllBtn" class="admin-btn-primary">Regenerar todos (Spotify)</button>
        <span id="regenAllStatus" class="admin-status"></span>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th></th><th>Nombre</th><th>Spotify</th><th>Géneros</th><th>Seguidores</th><th>Actualizado</th><th></th></tr></thead>
          <tbody>`;
    artists.forEach((a) => {
      html += `
        <tr data-name="${escapeAttr(a.name)}">
          <td><div class="admin-thumb" style="background-image:url('${a.image || ""}')"></div></td>
          <td>${a.name}</td>
          <td>${a.spotifyVerified ? "✓" : "—"}</td>
          <td>${a.genres.join(", ") || "—"}</td>
          <td>${typeof a.followers === "number" ? a.followers : "—"}</td>
          <td>${a.updatedAt ? new Date(a.updatedAt + "Z").toLocaleString() : "—"}</td>
          <td><button class="admin-btn-regen">Regenerar</button></td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
    els.main.innerHTML = html;

    document.getElementById("regenAllBtn").addEventListener("click", async () => {
      const status = document.getElementById("regenAllStatus");
      status.textContent = "Regenerando todos, puede tardar un minuto…";
      await adminFetch("/api/admin/sweep-artists", { method: "POST" });
      status.textContent = "Hecho.";
      renderArtistsTab();
    });

    els.main.querySelectorAll(".admin-btn-regen").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.closest("tr").dataset.name;
        btn.textContent = "…";
        await adminFetch("/api/admin/artists/" + encodeURIComponent(name) + "/regenerate", { method: "POST" });
        renderArtistsTab();
      });
    });
  }

  // ---- Usuarios ----

  async function renderUsersTab() {
    els.main.innerHTML = "<p>Cargando…</p>";
    const users = await adminFetch("/api/admin/users");
    let html = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Usuario</th><th>Creado</th><th>Favoritos</th><th></th></tr></thead>
          <tbody>`;
    users.forEach((u) => {
      html += `
        <tr data-id="${u.id}">
          <td>${u.username}</td>
          <td>${new Date(u.createdAt + "Z").toLocaleString()}</td>
          <td>${u.favoriteCount}</td>
          <td><button class="admin-btn-danger">Eliminar</button></td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
    els.main.innerHTML = html;

    els.main.querySelectorAll(".admin-btn-danger").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        if (!confirm(`¿Eliminar la cuenta "${row.children[0].textContent}"? Se borrarán también sus favoritos.`)) return;
        await adminFetch("/api/admin/users/" + row.dataset.id, { method: "DELETE" });
        renderUsersTab();
      });
    });
  }

  if (secret) {
    adminFetch("/api/admin/days")
      .then(showApp)
      .catch(() => {
        sessionStorage.removeItem(SECRET_KEY);
        secret = "";
      });
  }
})();
