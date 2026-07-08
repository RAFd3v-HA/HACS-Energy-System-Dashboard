class EnergySystemDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._panel = null;
    this._config = null;
    this._draft = null;
    this._loaded = false;
    this._loading = false;
    this._saving = false;
    this._tab = "electric";
    this._boundClick = (event) => this._onClick(event);
    this._boundChange = (event) => this._onChange(event);
  }

  set hass(value) {
    this._hass = value;
    if (!this.isConnected) return;
    if (!this._loaded && !this._loading) {
      this._loadConfig();
      return;
    }
    if (this._loaded && this._tab !== "config") this._render();
  }

  get hass() {
    return this._hass;
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", this._boundClick);
    this.shadowRoot.addEventListener("change", this._boundChange);
    this._renderLoading();
    if (this._hass && !this._loaded && !this._loading) this._loadConfig();
  }

  disconnectedCallback() {
    this.shadowRoot.removeEventListener("click", this._boundClick);
    this.shadowRoot.removeEventListener("change", this._boundChange);
  }

  async _loadConfig() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      const config = await this._hass.callWS({
        type: "energy_system_dashboard/get_config",
      });
      this._config = config;
      this._draft = this._clone(config);
      this._loaded = true;
      this._render();
    } catch (error) {
      this._renderError(`Konfiguration konnte nicht geladen werden: ${error?.message || error}`);
    } finally {
      this._loading = false;
    }
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _state(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId] || null;
  }

  _numeric(entityId) {
    const state = this._state(entityId);
    if (!state || ["unknown", "unavailable", "none", ""].includes(String(state.state).toLowerCase())) return null;
    const value = Number(state.state);
    return Number.isFinite(value) ? value : null;
  }

  _unit(entityId) {
    return this._state(entityId)?.attributes?.unit_of_measurement || "";
  }

  _powerW(entityId) {
    const value = this._numeric(entityId);
    if (value === null) return null;
    const unit = String(this._unit(entityId)).trim().toLowerCase();
    if (unit === "kw") return value * 1000;
    if (unit === "mw") return value * 1000000;
    return value;
  }

  _energyKWh(entityId) {
    const value = this._numeric(entityId);
    if (value === null) return null;
    const unit = String(this._unit(entityId)).trim().toLowerCase();
    if (unit === "wh") return value / 1000;
    if (unit === "kwh") return value;
    if (unit === "mwh") return value * 1000;
    if (unit === "gwh") return value * 1000000;
    if (unit === "j") return value / 3600000;
    if (unit === "kj") return value / 3600;
    if (unit === "mj") return value / 3.6;
    if (unit === "gj") return value * 277.7777777778;
    return null;
  }

  _temperature(entityId) {
    const value = this._numeric(entityId);
    if (value === null) return null;
    return value;
  }

  _formatPowerW(value, signed = false) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const sign = signed && value > 0 ? "+" : "";
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${sign}${(value / 1000000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} MW`;
    if (abs >= 1000) return `${sign}${(value / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} kW`;
    return `${sign}${Math.round(value).toLocaleString("de-DE")} W`;
  }

  _formatEnergyKWh(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${value.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kWh`;
  }

  _formatTemp(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
  }

  _displayState(entityId) {
    const state = this._state(entityId);
    if (!state) return "—";
    if (["unknown", "unavailable", "none", ""].includes(String(state.state).toLowerCase())) return "—";
    return this._esc(state.state);
  }

  _friendly(entityId) {
    const state = this._state(entityId);
    return state?.attributes?.friendly_name || entityId || "—";
  }

  _entityList(kind = "any") {
    if (!this._hass) return [];
    const states = Object.values(this._hass.states);
    return states
      .filter((state) => {
        const unit = String(state.attributes?.unit_of_measurement || "").toLowerCase();
        const deviceClass = String(state.attributes?.device_class || "").toLowerCase();
        const domain = state.entity_id.split(".")[0];
        if (kind === "power") return deviceClass === "power" || ["w", "kw", "mw"].includes(unit);
        if (kind === "energy") return deviceClass === "energy" || ["wh", "kwh", "mwh", "gwh", "j", "kj", "mj", "gj"].includes(unit);
        if (kind === "temperature") return deviceClass === "temperature" || ["°c", "°f", "c", "f"].includes(unit);
        if (kind === "percentage") return unit === "%" || deviceClass === "battery";
        if (kind === "binary") return domain === "binary_sensor" || domain === "switch";
        return true;
      })
      .sort((a, b) => this._friendly(a.entity_id).localeCompare(this._friendly(b.entity_id), "de"));
  }

  _entityOptions(kind, selected, allowEmpty = true) {
    const options = [];
    if (allowEmpty) options.push(`<option value="">— nicht zugeordnet —</option>`);
    for (const state of this._entityList(kind)) {
      const id = state.entity_id;
      const current = id === selected ? " selected" : "";
      const unit = state.attributes?.unit_of_measurement ? ` · ${state.attributes.unit_of_measurement}` : "";
      options.push(`<option value="${this._esc(id)}"${current}>${this._esc(this._friendly(id))} · ${this._esc(id)}${this._esc(unit)}</option>`);
    }
    return options.join("");
  }

  _moduleStatus(module) {
    if (module.status_entity) {
      const raw = String(this._state(module.status_entity)?.state || "").toLowerCase();
      if (["unavailable", "unknown", ""].includes(raw)) return { cls: "unknown", text: "UNKNOWN" };
      if (["off", "standby", "idle", "0", "false", "aus"].includes(raw)) return { cls: "idle", text: String(this._state(module.status_entity)?.state || "STANDBY").toUpperCase() };
      if (["fault", "error", "störung", "alarm"].some((token) => raw.includes(token))) return { cls: "fault", text: String(this._state(module.status_entity)?.state || "FAULT").toUpperCase() };
      return { cls: "active", text: String(this._state(module.status_entity)?.state || "ACTIVE").toUpperCase() };
    }
    const power = this._powerW(module.power_entity);
    if (power === null) return { cls: "unknown", text: "UNKNOWN" };
    return Math.abs(power) >= 10 ? { cls: "active", text: "ACTIVE" } : { cls: "idle", text: "STANDBY" };
  }

  _gridFlow() {
    const grid = this._config?.grid;
    if (!grid?.enabled) return { power: null, mode: "disabled", label: "DEAKTIVIERT" };
    const raw = this._powerW(grid.power_entity);
    if (raw === null) return { power: null, mode: "unknown", label: "UNKNOWN" };
    const importPositive = grid.direction !== "export_positive";
    const importing = importPositive ? raw >= 0 : raw < 0;
    return {
      power: Math.abs(raw),
      mode: importing ? "import" : "export",
      label: importing ? "IMPORT" : "EXPORT",
    };
  }

  _areaChildren(parentId, config = this._config) {
    return (config?.areas || []).filter((area) => area.parent_id === parentId);
  }

  _areaResidual(area, config = this._config) {
    const total = this._powerW(area.power_entity);
    if (total === null) return null;
    const children = this._areaChildren(area.id, config);
    const childPowers = children.map((child) => this._powerW(child.power_entity));
    if (childPowers.some((value) => value === null)) return null;
    return total - childPowers.reduce((sum, value) => sum + value, 0);
  }

  _rootAreas(config = this._config) {
    return (config?.areas || []).filter((area) => !area.parent_id || !(config.areas || []).some((candidate) => candidate.id === area.parent_id));
  }

  _leafAreas(config = this._config) {
    return (config?.areas || []).filter((area) => this._areaChildren(area.id, config).length === 0);
  }

  _renderLoading() {
    this.shadowRoot.innerHTML = `${this._styles()}<main class="shell"><div class="loading">ENERGY SYSTEM<br><span>Konfiguration wird geladen …</span></div></main>`;
  }

  _renderError(message) {
    this.shadowRoot.innerHTML = `${this._styles()}<main class="shell"><div class="error-box">${this._esc(message)}</div></main>`;
  }

  _render() {
    if (!this._loaded || !this._config) return;
    const admin = Boolean(this._hass?.user?.is_admin);
    const title = this._config.name || "ENERGY SYSTEM";
    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <main class="shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">HOME ASSISTANT / ENERGY TOPOLOGY</div>
            <h1>${this._esc(title)}</h1>
          </div>
          <div class="live-state"><span class="pulse"></span> LIVE <strong>${new Date().toLocaleTimeString("de-DE")}</strong></div>
        </header>
        <nav class="tabs">
          ${this._tabButton("electric", "ELEKTRISCH")}
          ${this._tabButton("thermal", "THERMISCH")}
          ${this._tabButton("areas", "BEREICHE")}
          ${admin ? this._tabButton("config", "KONFIGURATION") : ""}
        </nav>
        <section class="content">
          ${this._tab === "electric" ? this._renderElectric() : ""}
          ${this._tab === "thermal" ? this._renderThermal() : ""}
          ${this._tab === "areas" ? this._renderAreas() : ""}
          ${this._tab === "config" ? this._renderConfig() : ""}
        </section>
      </main>`;
  }

  _tabButton(tab, label) {
    return `<button class="tab ${this._tab === tab ? "active" : ""}" data-action="set-tab" data-tab="${tab}">${label}</button>`;
  }

  _renderElectric() {
    const config = this._config;
    const gridFlow = this._gridFlow();
    const topNodes = [];

    if (config.grid?.enabled) {
      topNodes.push(this._node({
        code: "GRID",
        name: config.grid.name || "Netz",
        main: this._formatPowerW(gridFlow.power),
        state: gridFlow.label,
        status: gridFlow.mode === "unknown" ? "unknown" : gridFlow.mode === "import" ? "active" : "good",
        custom: `
          <div class="mini-line"><span>BEZUG</span><strong>${this._formatEnergyKWh(this._energyKWh(config.grid.import_energy_entity))}</strong></div>
          <div class="mini-line"><span>EINSPEISUNG</span><strong>${this._formatEnergyKWh(this._energyKWh(config.grid.export_energy_entity))}</strong></div>`,
        metaLeft: "REFERENCE",
        metaRight: config.grid.direction === "export_positive" ? "EXPORT +" : "IMPORT +",
      }));
    }

    for (const module of config.generation || []) {
      const power = this._powerW(module.power_entity);
      topNodes.push(this._node({
        code: module.type === "solar" ? "PV" : "GEN",
        name: module.name || "Erzeuger",
        main: this._formatPowerW(power),
        state: power !== null && power > 10 ? "PRODUCTION" : power === null ? "UNKNOWN" : "IDLE",
        status: power === null ? "unknown" : power > 10 ? "good" : "idle",
        custom: module.energy_entity ? `<div class="mini-line"><span>ENERGIE</span><strong>${this._formatEnergyKWh(this._energyKWh(module.energy_entity))}</strong></div>` : "",
        metaLeft: "SOURCE",
        metaRight: module.power_entity ? this._friendly(module.power_entity) : "NO ENTITY",
      }));
    }

    for (const module of config.storage || []) {
      const power = this._powerW(module.power_entity);
      const soc = this._numeric(module.soc_entity);
      const state = power === null ? "UNKNOWN" : power > 10 ? "CHARGE" : power < -10 ? "DISCHARGE" : "IDLE";
      topNodes.push(this._node({
        code: "BAT",
        name: module.name || "Batterie",
        main: soc === null ? this._formatPowerW(power, true) : `${soc.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
        state,
        status: power === null ? "unknown" : Math.abs(power) > 10 ? "active" : "idle",
        custom: `
          <div class="mini-line"><span>GELADEN</span><strong>${this._formatEnergyKWh(this._energyKWh(module.charge_energy_entity))}</strong></div>
          <div class="mini-line"><span>ENTLADEN</span><strong>${this._formatEnergyKWh(this._energyKWh(module.discharge_energy_entity))}</strong></div>`,
        metaLeft: this._formatPowerW(power, true),
        metaRight: "STORAGE",
      }));
    }

    const rootAreas = this._rootAreas();
    const areaNodes = rootAreas.map((area) => this._renderAreaNode(area, 0, false)).join("");

    return `
      <div class="system-note">ELEKTRISCHES EINLINIENSCHEMA · AKTUELLE LEISTUNG + ENERGIEZÄHLER</div>
      <div class="node-row top-nodes">${topNodes.length ? topNodes.join("") : this._empty("Keine Netzreferenz, Erzeuger oder Speicher konfiguriert.")}</div>
      <div class="wire vertical ${topNodes.length ? "active" : ""}"></div>
      <div class="bus">
        <span>ELEKTRISCHE VERTEILUNG</span>
        <strong>${this._housePowerLabel()}</strong>
      </div>
      <div class="wire vertical active"></div>
      <div class="node-row area-overview">${areaNodes || this._empty("Noch keine Bereiche konfiguriert.")}</div>`;
  }

  _housePowerLabel() {
    const leafAreas = this._leafAreas();
    const seenEntities = new Set();
    const measured = [];

    for (const area of leafAreas) {
      const entityId = String(area.power_entity || "").trim();
      if (!entityId || seenEntities.has(entityId)) continue;

      const power = this._powerW(entityId);
      if (power === null) continue;

      seenEntities.add(entityId);
      measured.push(power);
    }

    if (!measured.length) return "KEIN MESSWERT";
    return this._formatPowerW(measured.reduce((sum, value) => sum + value, 0));
  }

  _renderAreaNode(area, depth = 0, includeNested = true) {
    const power = this._powerW(area.power_entity);
    const residual = this._areaResidual(area);
    const children = this._areaChildren(area.id);
    const childLines = children
      .map((child) => `<div class="mini-line"><span>${this._esc(child.name)}</span><strong>${this._formatPowerW(this._powerW(child.power_entity))}</strong></div>`)
      .join("");
    return this._node({
      code: depth === 0 ? "AREA" : "SUB",
      name: area.name,
      main: this._formatPowerW(power),
      state: area.power_entity ? "MEASURED" : "NO METER",
      status: power === null ? "unknown" : "active",
      custom: `${area.energy_entity ? `<div class="mini-line"><span>ENERGIE</span><strong>${this._formatEnergyKWh(this._energyKWh(area.energy_entity))}</strong></div>` : ""}${childLines}${residual !== null && children.length ? `<div class="mini-line residual"><span>NICHT ZUGEORDNET</span><strong>${this._formatPowerW(residual)}</strong></div>` : ""}`,
      metaLeft: `${children.length} SUB AREAS`,
      metaRight: area.power_entity ? "METER" : "UNMETERED",
    });
  }

  _node({ code, name, main, state, status = "unknown", metaLeft = "", metaRight = "", custom = "" }) {
    return `
      <article class="node status-${status}">
        <div class="node-head"><span class="node-code">${this._esc(code)}</span><span class="status"><i></i>${this._esc(state)}</span></div>
        <div class="node-name">${this._esc(name)}</div>
        <div class="node-main">${this._esc(main)}</div>
        ${custom ? `<div class="node-custom">${custom}</div>` : ""}
        <div class="node-meta"><span>${this._esc(metaLeft)}</span><span>${this._esc(metaRight)}</span></div>
      </article>`;
  }

  _renderThermal() {
    const heating = this._config.heating || [];
    const toBuffer = heating.filter((module) => module.target === "buffer");
    const toRoom = heating.filter((module) => module.target !== "buffer");
    const buffer = this._config.buffer || {};

    return `
      <div class="system-note">THERMISCHES ANLAGENFLIESSBILD · MESSWERTE OHNE ERSATZWERTE</div>
      <div class="thermal-grid">
        <section class="thermal-source-bank">
          <div class="section-label">WÄRMEERZEUGER / PUFFER</div>
          <div class="node-row heating-nodes">${toBuffer.length ? toBuffer.map((module) => this._renderHeatingNode(module)).join("") : this._empty("Keine dem Pufferspeicher zugeordneten Wärmeerzeuger.")}</div>
        </section>
        <div class="thermal-arrow">↓</div>
        ${buffer.enabled ? this._renderBuffer(buffer) : this._empty("Pufferspeicher ist nicht aktiviert.")}
        <div class="thermal-arrow">↓</div>
        <div class="distribution-box"><span>HEIZVERTEILUNG</span><strong>THERMAL LOAD</strong></div>
        <section class="thermal-source-bank room-bank">
          <div class="section-label">DIREKTE RAUMWÄRME / SONSTIGE WÄRMESENKEN</div>
          <div class="node-row heating-nodes">${toRoom.length ? toRoom.map((module) => this._renderHeatingNode(module)).join("") : this._empty("Keine direkten Wärmeerzeuger konfiguriert.")}</div>
        </section>
      </div>`;
  }

  _renderHeatingNode(module) {
    const status = this._moduleStatus(module);
    const typeCodes = {
      heatpump: "HP",
      boiler: "BOILER",
      electric_heater: "E-HEATER",
      fireplace: "FIRE",
    };
    const details = [];
    if (module.supply_entity) details.push(["VL", this._formatTemp(this._temperature(module.supply_entity))]);
    if (module.return_entity) details.push(["RL", this._formatTemp(this._temperature(module.return_entity))]);
    if (module.temperature_entity) details.push(["TEMP", this._formatTemp(this._temperature(module.temperature_entity))]);
    if (module.power_entity) details.push(["POWER", this._formatPowerW(this._powerW(module.power_entity))]);
    if (module.energy_entity) details.push(["ENERGY", this._formatEnergyKWh(this._energyKWh(module.energy_entity))]);

    return this._node({
      code: typeCodes[module.type] || "HEAT",
      name: module.name || "Wärmeerzeuger",
      main: module.power_entity ? this._formatPowerW(this._powerW(module.power_entity)) : (details[0]?.[1] || "—"),
      state: status.text,
      status: status.cls,
      custom: details.map(([key, value]) => `<div class="mini-line"><span>${key}</span><strong>${this._esc(value)}</strong></div>`).join(""),
      metaLeft: module.target === "buffer" ? "→ BUFFER" : "→ ROOM",
      metaRight: module.status_entity ? "STATUS LINK" : "POWER STATE",
    });
  }

  _renderBuffer(buffer) {
    const sensors = buffer.temperature_entities || [];
    const rows = sensors.map((entityId, index) => {
      const temp = this._temperature(entityId);
      return `<div class="buffer-row"><span>T${String(index + 1).padStart(2, "0")}</span><div class="buffer-line"></div><strong>${this._formatTemp(temp)}</strong><small>${this._esc(this._friendly(entityId))}</small></div>`;
    }).join("");

    return `
      <article class="buffer">
        <div class="buffer-head"><span>BUF</span><strong>${this._esc(buffer.name || "Pufferspeicher")}</strong><em>${sensors.length} TEMP POINTS</em></div>
        <div class="buffer-body">${rows || `<div class="buffer-empty">KEINE TEMPERATURFÜHLER ZUGEORDNET</div>`}</div>
      </article>`;
  }

  _renderAreas() {
    const roots = this._rootAreas();
    return `
      <div class="system-note">ZÄHLERHIERARCHIE · LEISTUNG UND ZUGEORDNETE ENERGIEZÄHLER</div>
      <div class="area-tree">${roots.length ? roots.map((area) => this._renderAreaTree(area, 0)).join("") : this._empty("Keine Bereiche konfiguriert.")}</div>`;
  }

  _renderAreaTree(area, depth) {
    const children = this._areaChildren(area.id);
    const power = this._powerW(area.power_entity);
    const residual = this._areaResidual(area);
    return `
      <div class="tree-row" style="--depth:${depth}">
        <span class="tree-branch">${depth ? "├─" : "■"}</span>
        <span class="tree-name">${this._esc(area.name)}</span>
        <span class="tree-source">${area.power_entity ? this._esc(area.power_entity) : "NO METER"}</span>
        <strong>${this._formatPowerW(power)}</strong>
        <strong class="tree-energy">${this._formatEnergyKWh(this._energyKWh(area.energy_entity))}</strong>
      </div>
      ${children.map((child) => this._renderAreaTree(child, depth + 1)).join("")}
      ${children.length && residual !== null ? `
        <div class="tree-row residual-row" style="--depth:${depth + 1}">
          <span class="tree-branch">└─</span>
          <span class="tree-name">Nicht zugeordnet</span>
          <span class="tree-source">CALCULATED: PARENT − DIRECT CHILDREN</span>
          <strong>${this._formatPowerW(residual)}</strong>
          <strong class="tree-energy">—</strong>
        </div>` : ""}`;
  }

  _renderConfig() {
    if (!this._draft) this._draft = this._clone(this._config);
    const d = this._draft;
    const isAdmin = Boolean(this._hass?.user?.is_admin);
    if (!isAdmin) return this._empty("Konfiguration ist nur für Administratoren verfügbar.");

    return `
      <div class="config-toolbar">
        <div><span>TOPOLOGY EDITOR</span><strong>Änderungen werden erst mit SPEICHERN übernommen.</strong></div>
        <button class="primary" data-action="save-config" ${this._saving ? "disabled" : ""}>${this._saving ? "SPEICHERT …" : "SPEICHERN"}</button>
      </div>
      <div class="config-grid">
        ${this._configGridSection(d)}
        ${this._configGenerationSection(d)}
        ${this._configStorageSection(d)}
        ${this._configHeatingSection(d)}
        ${this._configBufferSection(d)}
        ${this._configAreasSection(d)}
      </div>`;
  }

  _configGridSection(d) {
    return `
      <section class="config-card wide">
        <div class="config-head"><span>01 / GRID</span><strong>NETZREFERENZ</strong></div>
        <label class="check-row"><input type="checkbox" data-bind="grid.enabled" ${d.grid?.enabled ? "checked" : ""}><span>Zentrale Netzreferenz vorhanden</span></label>
        <div class="form-grid">
          ${this._field("Name", `<input data-bind="grid.name" value="${this._esc(d.grid?.name || "Netz")}">`)}
          ${this._field("Leistungs-Entity", `<select data-bind="grid.power_entity">${this._entityOptions("power", d.grid?.power_entity)}</select>`)}
          ${this._field("Bezug Energie / kWh", `<select data-bind="grid.import_energy_entity">${this._entityOptions("energy", d.grid?.import_energy_entity)}</select>`)}
          ${this._field("Einspeisung Energie / kWh", `<select data-bind="grid.export_energy_entity">${this._entityOptions("energy", d.grid?.export_energy_entity)}</select>`)}
          ${this._field("Vorzeichen", `<select data-bind="grid.direction"><option value="import_positive" ${d.grid?.direction !== "export_positive" ? "selected" : ""}>Positiv = Netzbezug</option><option value="export_positive" ${d.grid?.direction === "export_positive" ? "selected" : ""}>Positiv = Einspeisung</option></select>`)}
        </div>
      </section>`;
  }

  _configGenerationSection(d) {
    return `
      <section class="config-card">
        <div class="config-head"><span>02 / SOURCE</span><strong>ERZEUGER</strong><button data-action="add-generation">+ ADD</button></div>
        ${(d.generation || []).map((module, index) => `
          <div class="module-editor">
            <div class="module-editor-head"><span>GEN ${String(index + 1).padStart(2, "0")}</span><button class="danger" data-action="remove-module" data-group="generation" data-index="${index}">REMOVE</button></div>
            ${this._field("Typ", `<select data-array="generation" data-index="${index}" data-field="type"><option value="solar" ${module.type === "solar" ? "selected" : ""}>PV / Solar</option><option value="generator" ${module.type === "generator" ? "selected" : ""}>Sonstiger Erzeuger</option></select>`)}
            ${this._field("Name", `<input data-array="generation" data-index="${index}" data-field="name" value="${this._esc(module.name || "")}">`)}
            ${this._field("Leistung", `<select data-array="generation" data-index="${index}" data-field="power_entity">${this._entityOptions("power", module.power_entity)}</select>`)}
            ${this._field("Erzeugte Energie / kWh", `<select data-array="generation" data-index="${index}" data-field="energy_entity">${this._entityOptions("energy", module.energy_entity)}</select>`)}
          </div>`).join("") || `<div class="config-empty">KEINE ERZEUGER</div>`}
      </section>`;
  }

  _configStorageSection(d) {
    return `
      <section class="config-card">
        <div class="config-head"><span>03 / STORAGE</span><strong>BATTERIESPEICHER</strong><button data-action="add-storage">+ ADD</button></div>
        ${(d.storage || []).map((module, index) => `
          <div class="module-editor">
            <div class="module-editor-head"><span>BAT ${String(index + 1).padStart(2, "0")}</span><button class="danger" data-action="remove-module" data-group="storage" data-index="${index}">REMOVE</button></div>
            ${this._field("Name", `<input data-array="storage" data-index="${index}" data-field="name" value="${this._esc(module.name || "")}">`)}
            ${this._field("Leistung (+ Laden / − Entladen)", `<select data-array="storage" data-index="${index}" data-field="power_entity">${this._entityOptions("power", module.power_entity)}</select>`)}
            ${this._field("Ladezustand", `<select data-array="storage" data-index="${index}" data-field="soc_entity">${this._entityOptions("percentage", module.soc_entity)}</select>`)}
            ${this._field("Geladene Energie / kWh", `<select data-array="storage" data-index="${index}" data-field="charge_energy_entity">${this._entityOptions("energy", module.charge_energy_entity)}</select>`)}
            ${this._field("Entladene Energie / kWh", `<select data-array="storage" data-index="${index}" data-field="discharge_energy_entity">${this._entityOptions("energy", module.discharge_energy_entity)}</select>`)}
          </div>`).join("") || `<div class="config-empty">KEINE BATTERIESPEICHER</div>`}
      </section>`;
  }

  _configHeatingSection(d) {
    return `
      <section class="config-card wide">
        <div class="config-head"><span>04 / THERMAL SOURCE</span><strong>WÄRMEERZEUGER</strong><button data-action="add-heating">+ ADD</button></div>
        <div class="module-grid">
          ${(d.heating || []).map((module, index) => `
            <div class="module-editor">
              <div class="module-editor-head"><span>HEAT ${String(index + 1).padStart(2, "0")}</span><button class="danger" data-action="remove-module" data-group="heating" data-index="${index}">REMOVE</button></div>
              ${this._field("Typ", `<select data-array="heating" data-index="${index}" data-field="type">
                <option value="heatpump" ${module.type === "heatpump" ? "selected" : ""}>Wärmepumpe</option>
                <option value="boiler" ${module.type === "boiler" ? "selected" : ""}>Heizkessel</option>
                <option value="electric_heater" ${module.type === "electric_heater" ? "selected" : ""}>Elektrischer Heizstab</option>
                <option value="fireplace" ${module.type === "fireplace" ? "selected" : ""}>Kamin / Ofen</option>
              </select>`)}
              ${this._field("Name", `<input data-array="heating" data-index="${index}" data-field="name" value="${this._esc(module.name || "")}">`)}
              ${this._field("Wärmeabgabe an", `<select data-array="heating" data-index="${index}" data-field="target"><option value="buffer" ${module.target === "buffer" ? "selected" : ""}>Pufferspeicher</option><option value="room" ${module.target !== "buffer" ? "selected" : ""}>Raum / direkt</option></select>`)}
              ${this._field("Status", `<select data-array="heating" data-index="${index}" data-field="status_entity">${this._entityOptions("any", module.status_entity)}</select>`)}
              ${this._field("Elektrische Leistung", `<select data-array="heating" data-index="${index}" data-field="power_entity">${this._entityOptions("power", module.power_entity)}</select>`)}
              ${this._field("Elektrische Energie / kWh", `<select data-array="heating" data-index="${index}" data-field="energy_entity">${this._entityOptions("energy", module.energy_entity)}</select>`)}
              ${this._field("Vorlauf", `<select data-array="heating" data-index="${index}" data-field="supply_entity">${this._entityOptions("temperature", module.supply_entity)}</select>`)}
              ${this._field("Rücklauf", `<select data-array="heating" data-index="${index}" data-field="return_entity">${this._entityOptions("temperature", module.return_entity)}</select>`)}
              ${this._field("Haupttemperatur / Kessel / Brennraum", `<select data-array="heating" data-index="${index}" data-field="temperature_entity">${this._entityOptions("temperature", module.temperature_entity)}</select>`)}
            </div>`).join("") || `<div class="config-empty">KEINE WÄRMEERZEUGER</div>`}
        </div>
      </section>`;
  }

  _configBufferSection(d) {
    const selectedTemps = d.buffer?.temperature_entities || [];
    return `
      <section class="config-card">
        <div class="config-head"><span>05 / BUFFER</span><strong>PUFFERSPEICHER</strong></div>
        <label class="check-row"><input type="checkbox" data-bind="buffer.enabled" ${d.buffer?.enabled ? "checked" : ""}><span>Pufferspeicher anzeigen</span></label>
        ${this._field("Name", `<input data-bind="buffer.name" value="${this._esc(d.buffer?.name || "Pufferspeicher")}">`)}
        ${this._field("Temperaturfühler · Mehrfachauswahl", `<select multiple size="10" data-bind="buffer.temperature_entities">${this._entityList("temperature").map((state) => `<option value="${this._esc(state.entity_id)}" ${selectedTemps.includes(state.entity_id) ? "selected" : ""}>${this._esc(this._friendly(state.entity_id))} · ${this._esc(state.entity_id)}</option>`).join("")}</select>`)}
        <div class="hint">Reihenfolge der Auswahl entspricht in V0.1 der Anzeige T01 … Txx.</div>
      </section>`;
  }

  _configAreasSection(d) {
    const areas = d.areas || [];
    return `
      <section class="config-card wide">
        <div class="config-head"><span>06 / METER TREE</span><strong>HAUSBEREICHE UND ZÄHLERHIERARCHIE</strong><button data-action="add-area">+ ADD AREA</button></div>
        <div class="area-editor-head"><span>BEREICH</span><span>PARENT</span><span>LEISTUNGS-ENTITY</span><span>ENERGIE-ENTITY</span><span></span></div>
        ${areas.map((area, index) => `
          <div class="area-editor-row">
            <input data-array="areas" data-index="${index}" data-field="name" value="${this._esc(area.name || "")}">
            <select data-array="areas" data-index="${index}" data-field="parent_id">
              <option value="" ${!area.parent_id ? "selected" : ""}>— ROOT —</option>
              ${areas.filter((candidate) => candidate.id !== area.id).map((candidate) => `<option value="${this._esc(candidate.id)}" ${area.parent_id === candidate.id ? "selected" : ""}>${this._esc(candidate.name)}</option>`).join("")}
            </select>
            <select data-array="areas" data-index="${index}" data-field="power_entity">${this._entityOptions("power", area.power_entity)}</select>
            <select data-array="areas" data-index="${index}" data-field="energy_entity">${this._entityOptions("energy", area.energy_entity)}</select>
            <button class="danger" data-action="remove-area" data-index="${index}" ${areas.length <= 1 ? "disabled" : ""}>REMOVE</button>
          </div>`).join("")}
        <div class="hint">Restlast = Bereichsleistung − Summe der direkten Unterzähler. Energie wird pro Bereich aus der zugeordneten Wh/kWh-Entity angezeigt und nicht aus dem Live-Wattwert im Browser hochgezählt.</div>
      </section>`;
  }

  _field(label, control) {
    return `<label class="field"><span>${this._esc(label)}</span>${control}</label>`;
  }

  _empty(text) {
    return `<div class="empty">${this._esc(text)}</div>`;
  }

  async _onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "set-tab") {
      this._tab = button.dataset.tab;
      if (this._tab === "config") this._draft = this._clone(this._config);
      this._render();
      return;
    }

    if (!this._draft) this._draft = this._clone(this._config);

    if (action === "add-generation") {
      this._draft.generation.push({ id: this._id("gen"), type: "solar", name: "PV", power_entity: "", energy_entity: "" });
      this._render();
      return;
    }
    if (action === "add-storage") {
      this._draft.storage.push({ id: this._id("bat"), type: "battery", name: "Batterie", power_entity: "", soc_entity: "", charge_energy_entity: "", discharge_energy_entity: "" });
      this._render();
      return;
    }
    if (action === "add-heating") {
      this._draft.heating.push({ id: this._id("heat"), type: "heatpump", name: "Wärmepumpe", target: "buffer", status_entity: "", power_entity: "", energy_entity: "", supply_entity: "", return_entity: "", temperature_entity: "" });
      this._render();
      return;
    }
    if (action === "add-area") {
      this._draft.areas.push({ id: this._id("area"), name: "Neuer Bereich", parent_id: this._draft.areas[0]?.id || null, power_entity: "", energy_entity: "" });
      this._render();
      return;
    }
    if (action === "remove-module") {
      const group = button.dataset.group;
      const index = Number(button.dataset.index);
      if (Array.isArray(this._draft[group]) && Number.isInteger(index)) this._draft[group].splice(index, 1);
      this._render();
      return;
    }
    if (action === "remove-area") {
      const index = Number(button.dataset.index);
      const area = this._draft.areas[index];
      if (!area || this._draft.areas.length <= 1) return;
      this._draft.areas.forEach((candidate) => {
        if (candidate.parent_id === area.id) candidate.parent_id = area.parent_id || null;
      });
      this._draft.areas.splice(index, 1);
      this._render();
      return;
    }
    if (action === "save-config") {
      await this._saveConfig();
    }
  }

  _onChange(event) {
    if (!this._draft) return;
    const target = event.target;

    if (target.dataset.bind) {
      const [root, field] = target.dataset.bind.split(".");
      if (!this._draft[root]) this._draft[root] = {};
      if (target.multiple) {
        this._draft[root][field] = Array.from(target.selectedOptions).map((option) => option.value);
      } else if (target.type === "checkbox") {
        this._draft[root][field] = target.checked;
      } else {
        this._draft[root][field] = target.value;
      }
      return;
    }

    if (target.dataset.array) {
      const group = target.dataset.array;
      const index = Number(target.dataset.index);
      const field = target.dataset.field;
      if (!Array.isArray(this._draft[group]) || !this._draft[group][index]) return;
      this._draft[group][index][field] = target.type === "checkbox" ? target.checked : target.value || (field === "parent_id" ? null : "");
    }
  }

  async _saveConfig() {
    if (!this._hass || this._saving) return;
    this._saving = true;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "energy_system_dashboard/save_config",
        config: this._draft,
      });
      this._config = result.config;
      this._draft = this._clone(result.config);
      this._tab = "electric";
      this._render();
    } catch (error) {
      this._saving = false;
      this._renderError(`Konfiguration konnte nicht gespeichert werden: ${error?.message || error}`);
      return;
    }
    this._saving = false;
  }

  _id(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  _styles() {
    return `
      <style>
        :host {
          --bg: #111417;
          --panel: #171b1f;
          --panel-2: #1d2227;
          --line: #3a4249;
          --line-strong: #7b858d;
          --text: #f2f4f5;
          --muted: #8e989f;
          --good: #63c58b;
          --active: #e2b759;
          --thermal: #5d9fc6;
          --fault: #dc6262;
          --radius: 2px;
          display: block;
          min-height: 100vh;
          background: var(--bg);
          color: var(--text);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        * { box-sizing: border-box; }
        button, input, select { font: inherit; }
        button { cursor: pointer; }
        .shell { min-height: 100vh; padding: 28px 34px 54px; background:
          linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px), var(--bg);
          background-size: 28px 28px;
        }
        .topbar { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:18px; gap:20px; }
        .eyebrow, .system-note, .section-label { color:var(--muted); font-size:11px; letter-spacing:.16em; font-weight:700; }
        h1 { margin:5px 0 0; font-size:28px; letter-spacing:.055em; font-weight:650; }
        .live-state { color:var(--muted); font:600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; }
        .live-state strong { color:var(--text); margin-left:10px; }
        .pulse { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--good); margin-right:8px; box-shadow:0 0 0 4px rgba(99,197,139,.1); }
        .tabs { display:flex; gap:0; border-bottom:1px solid var(--line); margin-top:10px; overflow:auto; }
        .tab { appearance:none; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); padding:15px 22px 13px; font-size:11px; font-weight:750; letter-spacing:.12em; }
        .tab:hover { color:var(--text); background:rgba(255,255,255,.02); }
        .tab.active { color:var(--text); border-bottom-color:var(--text); }
        .content { padding-top:24px; }
        .system-note { margin-bottom:22px; }
        .node-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:18px; align-items:start; }
        .top-nodes { max-width:1400px; margin:0 auto; }
        .area-overview { max-width:1500px; margin:0 auto; }
        .node { min-width:0; border:1px solid var(--line); background:rgba(23,27,31,.96); position:relative; box-shadow:0 10px 26px rgba(0,0,0,.12); }
        .node::before { content:""; position:absolute; left:-1px; top:-1px; bottom:-1px; width:3px; background:var(--line-strong); }
        .node.status-active::before { background:var(--active); }
        .node.status-good::before { background:var(--good); }
        .node.status-fault::before { background:var(--fault); }
        .node.status-idle::before, .node.status-unknown::before { background:var(--line-strong); }
        .node-head, .node-meta { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 13px; }
        .node-head { border-bottom:1px solid var(--line); }
        .node-code { color:var(--text); font:750 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; }
        .status { color:var(--muted); font:700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.08em; white-space:nowrap; }
        .status i { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--line-strong); margin-right:7px; }
        .status-active .status i { background:var(--active); }
        .status-good .status i { background:var(--good); }
        .status-fault .status i { background:var(--fault); }
        .node-name { padding:14px 14px 0; color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .node-main { padding:8px 14px 18px; font:600 31px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:-.045em; }
        .node-custom { padding:0 14px 12px; }
        .mini-line { display:flex; align-items:center; justify-content:space-between; border-top:1px dotted var(--line); min-height:28px; gap:12px; font:600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .mini-line span { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mini-line strong { font-weight:650; white-space:nowrap; }
        .mini-line.residual { color:var(--active); }
        .node-meta { border-top:1px solid var(--line); color:var(--muted); font:600 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.06em; }
        .node-meta span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .wire.vertical { width:1px; height:36px; background:var(--line); margin:0 auto; position:relative; }
        .wire.active::after { content:""; position:absolute; left:-2px; top:-4px; width:5px; height:10px; background:var(--active); animation:flow-v 1.6s linear infinite; }
        @keyframes flow-v { from { transform:translateY(0); } to { transform:translateY(40px); } }
        .bus { max-width:1500px; margin:0 auto; height:46px; border-top:2px solid var(--line-strong); border-bottom:2px solid var(--line-strong); display:flex; align-items:center; justify-content:center; gap:18px; background:rgba(255,255,255,.018); font:700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; }
        .bus strong { color:var(--active); font-size:14px; }
        .thermal-grid { max-width:1500px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; }
        .thermal-source-bank { width:100%; }
        .section-label { margin-bottom:12px; }
        .heating-nodes { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
        .thermal-arrow { text-align:center; color:var(--thermal); font:700 26px/1 ui-monospace, monospace; padding:12px 0; }
        .buffer { border:1px solid var(--line); background:var(--panel); width:min(760px,100%); margin:0 auto; }
        .buffer-head { display:grid; grid-template-columns:72px 1fr auto; gap:12px; align-items:center; padding:13px 16px; border-bottom:1px solid var(--line); }
        .buffer-head span { font:750 11px/1 ui-monospace, monospace; letter-spacing:.14em; }
        .buffer-head strong { font-size:13px; }
        .buffer-head em { color:var(--muted); font:650 9px/1 ui-monospace, monospace; font-style:normal; letter-spacing:.08em; }
        .buffer-body { padding:14px 16px; }
        .buffer-row { display:grid; grid-template-columns:42px 1fr 90px minmax(120px,240px); gap:10px; min-height:38px; align-items:center; }
        .buffer-row > span { color:var(--thermal); font:700 11px/1 ui-monospace, monospace; }
        .buffer-line { height:1px; background:linear-gradient(90deg,var(--thermal),var(--line)); }
        .buffer-row strong { font:650 15px/1 ui-monospace, monospace; text-align:right; }
        .buffer-row small { color:var(--muted); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .buffer-empty { padding:24px; color:var(--muted); text-align:center; font:650 10px/1.4 ui-monospace, monospace; letter-spacing:.08em; }
        .distribution-box { width:min(760px,100%); margin:0 auto; border:1px solid var(--thermal); padding:15px 18px; display:flex; justify-content:space-between; color:var(--text); background:rgba(93,159,198,.07); font:700 11px/1 ui-monospace, monospace; letter-spacing:.1em; }
        .distribution-box strong { color:var(--thermal); }
        .room-bank { margin-top:34px; }
        .area-tree { max-width:1500px; margin:0 auto; border-top:1px solid var(--line); }
        .tree-row { display:grid; grid-template-columns:32px minmax(180px,1fr) minmax(260px,2fr) 130px 150px; align-items:center; min-height:43px; border-bottom:1px solid var(--line); padding-left:calc(var(--depth) * 28px); font:600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .tree-row:hover { background:rgba(255,255,255,.025); }
        .tree-branch { color:var(--line-strong); }
        .tree-name { font-weight:700; }
        .tree-source { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
        .tree-row strong { text-align:right; font-size:14px; }
        .tree-energy { color:var(--good); }
        .residual-row .tree-name, .residual-row strong { color:var(--active); }
        .config-toolbar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 16px; border:1px solid var(--line); background:var(--panel); margin-bottom:18px; }
        .config-toolbar div { display:flex; flex-direction:column; gap:5px; }
        .config-toolbar span { color:var(--muted); font:700 10px/1 ui-monospace, monospace; letter-spacing:.12em; }
        .config-toolbar strong { font-size:12px; }
        .primary, .config-head button, .danger { appearance:none; border:1px solid var(--line-strong); background:transparent; color:var(--text); min-height:34px; padding:0 14px; font:700 10px/1 ui-monospace, monospace; letter-spacing:.08em; }
        .primary { background:var(--text); color:var(--bg); border-color:var(--text); min-width:130px; }
        button:disabled { opacity:.45; cursor:not-allowed; }
        .config-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; align-items:start; }
        .config-card { border:1px solid var(--line); background:rgba(23,27,31,.96); min-width:0; }
        .config-card.wide { grid-column:1 / -1; }
        .config-head { min-height:46px; padding:9px 12px; border-bottom:1px solid var(--line); display:grid; grid-template-columns:auto 1fr auto; gap:12px; align-items:center; }
        .config-head span, .module-editor-head span { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; }
        .config-head strong { font-size:12px; letter-spacing:.05em; }
        .check-row { display:flex; align-items:center; gap:10px; padding:14px; border-bottom:1px solid var(--line); font-size:12px; }
        .check-row input { accent-color:var(--text); width:17px; height:17px; }
        .form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); }
        .field { display:flex; flex-direction:column; gap:7px; padding:12px 14px; border-bottom:1px solid var(--line); }
        .field > span { color:var(--muted); font:650 10px/1.2 ui-monospace, monospace; }
        .field input, .field select, .area-editor-row input, .area-editor-row select { width:100%; min-width:0; min-height:38px; border:1px solid var(--line); border-radius:0; background:#101316; color:var(--text); padding:7px 9px; font-size:11px; outline:none; }
        .field select[multiple] { min-height:230px; }
        .field input:focus, .field select:focus, .area-editor-row input:focus, .area-editor-row select:focus { border-color:var(--line-strong); }
        .module-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
        .module-editor { border-right:1px solid var(--line); border-bottom:1px solid var(--line); min-width:0; }
        .module-editor-head { display:flex; align-items:center; justify-content:space-between; min-height:40px; padding:5px 10px 5px 14px; background:rgba(255,255,255,.018); }
        .danger { color:var(--fault); border-color:rgba(220,98,98,.42); }
        .config-empty { color:var(--muted); padding:30px; text-align:center; font:650 10px/1 ui-monospace, monospace; letter-spacing:.08em; }
        .hint { color:var(--muted); padding:12px 14px; font-size:10px; line-height:1.5; }
        .area-editor-head, .area-editor-row { display:grid; grid-template-columns:1fr 1fr 2fr 2fr 90px; gap:8px; padding:8px 10px; align-items:center; }
        .area-editor-head { color:var(--muted); border-bottom:1px solid var(--line); font:650 9px/1 ui-monospace, monospace; letter-spacing:.08em; }
        .area-editor-row { border-bottom:1px solid var(--line); }
        .empty { border:1px dashed var(--line); color:var(--muted); padding:28px; text-align:center; width:100%; font:650 10px/1.5 ui-monospace, monospace; letter-spacing:.06em; }
        .loading, .error-box { min-height:60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text); font:750 17px/1.5 ui-monospace, monospace; letter-spacing:.12em; text-align:center; }
        .loading span { color:var(--muted); font-size:11px; margin-top:8px; }
        .error-box { color:var(--fault); }
        @media (max-width: 900px) {
          .shell { padding:18px 14px 40px; }
          .topbar { align-items:flex-start; }
          h1 { font-size:22px; }
          .config-grid { grid-template-columns:1fr; }
          .config-card.wide { grid-column:auto; }
          .form-grid { grid-template-columns:1fr; }
          .area-editor-head { display:none; }
          .area-editor-row { grid-template-columns:1fr; padding:12px; }
          .tree-row { grid-template-columns:26px minmax(120px,1fr) 92px 112px; padding-left:calc(var(--depth) * 14px); }
          .tree-source { display:none; }
          .buffer-row { grid-template-columns:34px 1fr 80px; }
          .buffer-row small { display:none; }
        }
      </style>`;
  }
}

if (!customElements.get("energy-system-dashboard-panel")) {
  customElements.define("energy-system-dashboard-panel", EnergySystemDashboardPanel);
}
