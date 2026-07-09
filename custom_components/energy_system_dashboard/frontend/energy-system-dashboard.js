const ENERGY_SYSTEM_DASHBOARD_VERSION = "0.3.5";

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
    this._saveNotice = "";
    this._tab = "system";
    this._cardConfig = null;
    this._dailyEnergy = {};
    this._dailyLoading = false;
    this._layoutLevelId = null;
    this._viewLevelId = null;
    this._selectedAreaId = null;
    this._dragAreaId = null;
    this._dragOrigin = null;
    this._dailyRefreshTimer = null;
    this._boundClick = (event) => this._onClick(event);
    this._boundChange = (event) => this._onChange(event);
    this._boundDragStart = (event) => this._onDragStart(event);
    this._boundDragOver = (event) => this._onDragOver(event);
    this._boundDrop = (event) => this._onDrop(event);
    this._boundDragEnd = () => { this._dragAreaId = null; this._dragOrigin = null; };
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

  set cardConfig(value) {
    const previousDefaultFloor = this._cardConfig?.default_floor || "";
    this._cardConfig = value ? {
      view: value.view || "system",
      display: value.display || "full",
      title: value.title || "",
      floor_selector: value.floor_selector !== false,
      default_floor: value.default_floor || "",
      show_daily_energy: value.show_daily_energy !== false,
      show_status: value.show_status !== false,
    } : null;
    if (this._cardConfig) this._tab = this._cardConfig.view;
    if ((this._cardConfig?.default_floor || "") !== previousDefaultFloor) this._viewLevelId = null;
    if (this.isConnected && this._loaded) {
      this._syncLayoutState();
      this._render();
    }
  }

  get cardConfig() {
    return this._cardConfig;
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", this._boundClick);
    this.shadowRoot.addEventListener("change", this._boundChange);
    this.shadowRoot.addEventListener("dragstart", this._boundDragStart);
    this.shadowRoot.addEventListener("dragover", this._boundDragOver);
    this.shadowRoot.addEventListener("drop", this._boundDrop);
    this.shadowRoot.addEventListener("dragend", this._boundDragEnd);
    this._renderLoading();
    if (this._hass && !this._loaded && !this._loading) this._loadConfig();
    if (!this._dailyRefreshTimer) {
      this._dailyRefreshTimer = window.setInterval(() => this._refreshDailyEnergy(), 60000);
    }
  }

  disconnectedCallback() {
    this.shadowRoot.removeEventListener("click", this._boundClick);
    this.shadowRoot.removeEventListener("change", this._boundChange);
    this.shadowRoot.removeEventListener("dragstart", this._boundDragStart);
    this.shadowRoot.removeEventListener("dragover", this._boundDragOver);
    this.shadowRoot.removeEventListener("drop", this._boundDrop);
    this.shadowRoot.removeEventListener("dragend", this._boundDragEnd);
    if (this._dailyRefreshTimer) window.clearInterval(this._dailyRefreshTimer);
    this._dailyRefreshTimer = null;
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
      this._syncLayoutState();
      this._render();
      await this._refreshDailyEnergy();
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

  _energyStateKWh(entityId) {
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

  _syncLayoutState(config = this._draft || this._config) {
    this._normalizeHierarchyLevels(config);
    const levels = this._buildingLevels(config);
    const allLevels = this._sortedLevels(config);
    const fallbackLevelId = levels[0]?.id || allLevels[0]?.id || null;
    if (!allLevels.some((level) => level.id === this._layoutLevelId)) this._layoutLevelId = fallbackLevelId;
    if (this._cardConfig?.default_floor && !this._viewLevelId) {
      const requestedFloor = levels.find((level) => String(level.name || "").toLowerCase() === String(this._cardConfig.default_floor).toLowerCase());
      if (requestedFloor) this._viewLevelId = requestedFloor.id;
    }
    if (!levels.some((level) => level.id === this._viewLevelId)) this._viewLevelId = fallbackLevelId;
    if (!(config?.areas || []).some((area) => area.id === this._selectedAreaId)) {
      this._selectedAreaId = (config?.areas || []).find((area) => area.id !== "house")?.id || this._houseArea(config)?.id || config?.areas?.[0]?.id || null;
    }
  }

  _energyEntityIds(config = this._config) {
    const ids = [];
    const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
    add(config?.grid?.import_energy_entity);
    add(config?.grid?.export_energy_entity);
    for (const module of config?.generation || []) add(module.energy_entity);
    for (const module of config?.storage || []) {
      add(module.charge_energy_entity);
      add(module.discharge_energy_entity);
    }
    for (const module of config?.heating || []) {
      add(module.energy_entity);
      add(module.thermal_energy_entity);
    }
    for (const area of config?.areas || []) {
      add(area.energy_entity);
      add(area.thermal_energy_entity);
      for (const key of ["energy_terms", "thermal_energy_terms"]) {
        for (const term of area[key] || []) {
          if (term?.source_type === "entity") add(term.source_id);
        }
      }
    }
    return ids;
  }
  _dailyEnergyKWh(entityId) {
    if (!entityId) return null;
    const cached = this._dailyEnergy[entityId];
    if (cached !== undefined) return cached;
    const state = this._state(entityId);
    const label = `${entityId} ${state?.attributes?.friendly_name || ""}`.toLowerCase();
    if (["today", "daily", "heute", "tag"].some((token) => label.includes(token))) {
      return this._energyStateKWh(entityId);
    }
    return null;
  }

  async _refreshDailyEnergy(config = this._config) {
    if (!this._hass || !this._loaded || this._dailyLoading) return;
    const ids = this._energyEntityIds(config);
    if (!ids.length) {
      this._dailyEnergy = {};
      return;
    }
    this._dailyLoading = true;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    try {
      const result = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: new Date().toISOString(),
        statistic_ids: ids,
        period: "day",
        types: ["change"],
        units: { energy: "kWh" },
      });
      const daily = {};
      for (const entityId of ids) {
        const rows = Array.isArray(result?.[entityId]) ? result[entityId] : [];
        const changes = rows.map((row) => Number(row?.change)).filter((value) => Number.isFinite(value));
        if (changes.length) daily[entityId] = changes.reduce((sum, value) => sum + value, 0);
        else {
          const state = this._state(entityId);
          const label = `${entityId} ${state?.attributes?.friendly_name || ""}`.toLowerCase();
          daily[entityId] = ["today", "daily", "heute", "tag"].some((token) => label.includes(token)) ? this._energyStateKWh(entityId) : null;
        }
      }
      this._dailyEnergy = daily;
      if (this.isConnected) this._render();
    } catch (error) {
      console.warn("Energy System Dashboard: Tagesenergie konnte nicht geladen werden", error);
    } finally {
      this._dailyLoading = false;
    }
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
    const power = this._powerW(module.power_entity || module.thermal_power_entity);
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

  _areaById(areaId, config = this._config) {
    return (config?.areas || []).find((area) => area.id === areaId) || null;
  }

  _floorPresets() {
    return [
      { name: "3. UG", rank: -30 },
      { name: "2. UG", rank: -20 },
      { name: "UG", rank: -10 },
      { name: "EG", rank: 0 },
      { name: "OG", rank: 10 },
      { name: "2. OG", rank: 20 },
      { name: "3. OG", rank: 30 },
      { name: "DG", rank: 40 },
    ];
  }

  _floorRank(name) {
    const normalized = String(name || "").trim().toUpperCase();
    const aliases = {
      "KG": -10,
      "KELLER": -10,
      "KELLERGESCHOSS": -10,
      "ERDGESCHOSS": 0,
      "1. OG": 10,
      "1. OBERGESCHOSS": 10,
      "OBERGESCHOSS": 10,
      "DACHGESCHOSS": 40,
    };
    if (aliases[normalized] !== undefined) return aliases[normalized];
    const preset = this._floorPresets().find((item) => item.name.toUpperCase() === normalized);
    return preset ? preset.rank : null;
  }

  _sortedLevels(config = this._config) {
    return [...(config?.levels || [])].sort((a, b) => {
      const rankA = this._floorRank(a.name);
      const rankB = this._floorRank(b.name);
      if (rankA !== null && rankB !== null && rankA !== rankB) return rankA - rankB;
      if (rankA !== null && rankB === null) return -1;
      if (rankA === null && rankB !== null) return 1;
      return Number(a.order || 0) - Number(b.order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de");
    });
  }

  _buildingLevels(config = this._config, includeEmpty = false) {
    const areaLevelIds = new Set((config?.areas || []).filter((area) => area.id !== "house").map((area) => area.level_id));
    const levels = this._sortedLevels(config).filter((level) => includeEmpty || areaLevelIds.has(level.id));
    return levels.sort((a, b) => {
      const rankA = this._floorRank(a.name);
      const rankB = this._floorRank(b.name);
      if (rankA !== null && rankB !== null && rankA !== rankB) return rankB - rankA;
      if (rankA !== null && rankB === null) return -1;
      if (rankA === null && rankB !== null) return 1;
      return Number(a.order || 0) - Number(b.order || 0);
    });
  }

  _levelById(levelId, config = this._config) {
    return (config?.levels || []).find((level) => level.id === levelId) || null;
  }

  _ensureFloor(name, config = this._draft) {
    if (!config) return null;
    const normalized = String(name || "").trim();
    if (!normalized) return null;
    const existing = (config.levels || []).find((level) => String(level.name || "").trim().toLowerCase() === normalized.toLowerCase());
    if (existing) return existing;
    const rank = this._floorRank(normalized);
    const level = {
      id: this._id("level"),
      name: normalized,
      order: rank === null ? (config.levels || []).length : rank,
    };
    config.levels = [...(config.levels || []), level];
    return level;
  }

  _floorSelectOptions(area, config = this._draft || this._config) {
    const existing = this._sortedLevels(config);
    const existingNames = new Set(existing.map((level) => String(level.name || "").trim().toLowerCase()));
    const existingOptions = existing.map((level) => `<option value="${this._esc(level.id)}" ${level.id === area.level_id ? "selected" : ""}>${this._esc(level.name)}</option>`).join("");
    const presetOptions = this._floorPresets()
      .filter((preset) => !existingNames.has(preset.name.toLowerCase()))
      .map((preset) => `<option value="__floor__:${this._esc(preset.name)}">${this._esc(preset.name)}</option>`)
      .join("");
    return `${existingOptions}${presetOptions ? `<optgroup label="WEITERES STOCKWERK">${presetOptions}</optgroup>` : ""}`;
  }

  _houseArea(config = this._config) {
    return this._areaById("house", config);
  }

  _isConfiguredGrid(config = this._config) {
    const grid = config?.grid;
    return Boolean(grid?.enabled && [grid.power_entity, grid.import_energy_entity, grid.export_energy_entity].some(Boolean));
  }

  _isConfiguredGeneration(module) {
    return Boolean(module && [module.power_entity, module.energy_entity].some(Boolean));
  }

  _isConfiguredStorage(module) {
    return Boolean(module && [module.power_entity, module.soc_entity, module.charge_energy_entity, module.discharge_energy_entity].some(Boolean));
  }

  _isConfiguredHeating(module) {
    return Boolean(module && [
      module.status_entity,
      module.power_entity,
      module.energy_entity,
      module.thermal_power_entity,
      module.thermal_energy_entity,
      module.supply_entity,
      module.return_entity,
      module.temperature_entity,
    ].some(Boolean));
  }
  _isConfiguredBuffer(buffer = this._config?.buffer) {
    return Boolean(buffer?.enabled && Array.isArray(buffer.temperature_entities) && buffer.temperature_entities.some(Boolean));
  }

  _areaHasMeasure(area, kind) {
    if (!area) return false;
    const keyMap = {
      power: ["power_entity", "power_terms"],
      energy: ["energy_entity", "energy_terms"],
      thermal_power: ["thermal_power_entity", "thermal_power_terms"],
      thermal_energy: ["thermal_energy_entity", "thermal_energy_terms"],
    };
    const [entityKey, termsKey] = keyMap[kind] || keyMap.power;
    if (area.mode !== "calculated") return Boolean(area[entityKey]);
    return (area[termsKey] || []).some((term) => term?.source_id);
  }

  _isConfiguredElectricalArea(area) {
    return this._areaHasMeasure(area, "power") || this._areaHasMeasure(area, "energy");
  }

  _isConfiguredThermalArea(area) {
    return this._areaHasMeasure(area, "thermal_power") || this._areaHasMeasure(area, "thermal_energy");
  }

  _isConfiguredArea(area) {
    return this._isConfiguredElectricalArea(area) || this._isConfiguredThermalArea(area);
  }
  _overviewLevels(config = this._config, kind = "any") {
    const isConfigured = (area) => kind === "thermal"
      ? this._branchHasConfig(area, "thermal", config)
      : kind === "electric"
        ? this._branchHasConfig(area, "electric", config)
        : this._branchHasConfig(area, "any", config);
    const configuredLevelIds = new Set((config?.areas || [])
      .filter((area) => area.id !== "house" && isConfigured(area))
      .map((area) => area.level_id));
    return this._buildingLevels(config).filter((level) => configuredLevelIds.has(level.id));
  }
  _childrenOf(parentId, config = this._draft || this._config) {
    return (config?.areas || []).filter((area) => area.id !== "house" && area.parent_id === parentId);
  }

  _normalizeHierarchyLevels(config = this._draft || this._config) {
    if (!config?.areas?.length) return;
    const areas = config.areas;
    const ids = new Set(areas.map((area) => area.id));
    for (const area of areas) {
      if (area.id === "house") continue;
      if (area.parent_id && area.parent_id !== "house" && !ids.has(area.parent_id)) area.parent_id = "house";
      if (!area.parent_id) area.parent_id = "house";
    }
    for (let pass = 0; pass < areas.length; pass += 1) {
      let changed = false;
      for (const area of areas) {
        if (area.id === "house" || !area.parent_id || area.parent_id === "house") continue;
        const parent = this._areaById(area.parent_id, config);
        if (parent && area.level_id !== parent.level_id) {
          area.level_id = parent.level_id;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  _moveBranchToLevel(area, levelId, config = this._draft || this._config, stack = new Set()) {
    if (!area || area.id === "house" || stack.has(area.id)) return;
    stack.add(area.id);
    area.level_id = levelId;
    area.layout_mode = "docked";
    for (const child of this._childrenOf(area.id, config)) {
      this._moveBranchToLevel(child, levelId, config, new Set(stack));
    }
  }

  _hierarchyDepth(area, config = this._draft || this._config) {
    if (!area || area.id === "house") return 0;
    let depth = 0;
    let current = area;
    const visited = new Set();
    while (current?.parent_id && current.parent_id !== "house" && !visited.has(current.id)) {
      visited.add(current.id);
      depth += 1;
      current = this._areaById(current.parent_id, config);
    }
    return depth;
  }

  _directChildOptions(parentId, config = this._draft || this._config) {
    const children = this._childrenOf(parentId, config);
    return `<option value="">— Unterbereich auswählen —</option>` + children
      .map((child) => `<option value="${this._esc(child.id)}">${this._esc(child.name)} · ${child.mode === "calculated" ? "C" : "M"}</option>`)
      .join("");
  }

  _isHierarchyDescendant(descendantId, ancestorId, config = this._draft || this._config) {
    if (!descendantId || !ancestorId || descendantId === ancestorId) return descendantId === ancestorId;
    const visited = new Set();
    let current = this._areaById(descendantId, config);
    while (current?.parent_id && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.parent_id === ancestorId) return true;
      current = this._areaById(current.parent_id, config);
    }
    return false;
  }

  _areaOptionsForParent(area, config = this._draft || this._config) {
    const currentId = area?.id || "";
    return (config?.areas || [])
      .filter((candidate) => candidate.id !== currentId && !this._isHierarchyDescendant(candidate.id, currentId, config))
      .map((candidate) => `<option value="${this._esc(candidate.id)}" ${candidate.id === area.parent_id ? "selected" : ""}>${this._esc(candidate.name)}</option>`)
      .join("");
  }

  _areaOptionsForChildAssignment(parentId, config = this._draft || this._config) {
    const directChildIds = new Set(this._childrenOf(parentId, config).map((area) => area.id));
    return `<option value="">— Bestehenden Bereich auswählen —</option>` + (config?.areas || [])
      .filter((candidate) => candidate.id !== "house" && candidate.id !== parentId && !directChildIds.has(candidate.id) && !this._isHierarchyDescendant(parentId, candidate.id, config))
      .map((candidate) => `<option value="${this._esc(candidate.id)}">${this._esc(candidate.name)}</option>`)
      .join("");
  }

  _levelSelector(config = this._config, selectedLevelId = this._viewLevelId, action = "set-view-level", kind = "any") {
    const levels = this._overviewLevels(config, kind);
    if (!levels.length) return "";
    return `<div class="view-level-toolbar"><span>STOCKWERK</span><div class="view-level-tabs">${levels.map((level) => `<button class="view-level-tab ${level.id === selectedLevelId ? "active" : ""}" data-action="${action}" data-level-id="${this._esc(level.id)}">${this._esc(level.name)}</button>`).join("")}</div></div>`;
  }
  _gridCells(items, minimumSpan = 3) {
    if (!items.length) return "";
    const span = Math.max(minimumSpan, Math.floor(12 / Math.min(items.length, Math.floor(12 / minimumSpan))));
    return items.map((item) => `<div class="system-cell" style="grid-column:span ${span}">${item}</div>`).join("");
  }

  _layoutsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  _clampLayout(layout) {
    const w = Math.max(1, Math.min(6, Number(layout?.w || 3)));
    const h = Math.max(1, Math.min(4, Number(layout?.h || 2)));
    const x = Math.max(1, Math.min(13 - w, Number(layout?.x || 1)));
    const y = Math.max(1, Math.min(100, Number(layout?.y || 1)));
    return { x, y, w, h };
  }

  _layoutMode(area) {
    return area?.layout_mode === "free" ? "free" : "docked";
  }

  _dockedAreas(levelId, config = this._draft || this._config, excludeId = null) {
    return (config?.areas || [])
      .filter((area) => area.id !== "house" && area.id !== excludeId && area.level_id === levelId && this._layoutMode(area) === "docked")
      .sort((a, b) => Number(a.dock_order || 0) - Number(b.dock_order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
  }

  _normalizeDockOrder(levelId, config = this._draft || this._config) {
    const roots = this._dockedAreas(levelId, config)
      .filter((area) => this._isVisualRoot(area, config));
    roots.forEach((area, index) => { area.dock_order = index; });
    const parents = (config?.areas || []).filter((area) => area.id === "house" || area.level_id === levelId);
    for (const parent of parents) {
      this._sameLevelChildren(parent.id, levelId, config)
        .filter((area) => this._layoutMode(area) === "docked")
        .forEach((area, index) => { area.dock_order = index; });
    }
  }
  _dockedLayouts(levelId, config = this._draft || this._config, excludeId = null) {
    const items = this._dockedAreas(levelId, config, excludeId)
      .filter((area) => this._isVisualRoot(area, config));
    const result = new Map();
    let row = [];
    let rowWidth = 0;
    let y = 1;

    const flush = () => {
      if (!row.length) return;
      const rowWidthActual = row.reduce((sum, area) => sum + this._groupSize(area, config).w, 0);
      const startX = Math.floor((12 - rowWidthActual) / 2) + 1;
      const rowHeight = Math.max(...row.map((area) => this._groupSize(area, config).h));
      let x = startX;
      for (const area of row) {
        const size = this._groupSize(area, config);
        result.set(area.id, { x, y, w: size.w, h: size.h });
        x += size.w;
      }
      y += rowHeight;
      row = [];
      rowWidth = 0;
    };

    for (const area of items) {
      const size = this._groupSize(area, config);
      if (row.length && rowWidth + size.w > 12) flush();
      row.push(area);
      rowWidth += size.w;
    }
    flush();
    return result;
  }
  _effectiveLayout(area, config = this._draft || this._config) {
    if (!area) return { x: 1, y: 1, w: 3, h: 2 };
    if (area.id === "house") return { x: 1, y: 1, w: 12, h: 2 };
    if (!this._isVisualRoot(area, config)) return this._clampLayout(area.layout);
    if (this._layoutMode(area) === "docked") {
      return this._dockedLayouts(area.level_id, config).get(area.id) || this._groupSize(area, config);
    }
    const layout = this._clampLayout(area.layout);
    const group = this._groupSize(area, config);
    return { ...layout, w: Math.max(layout.w, group.w), h: Math.max(layout.h, group.h) };
  }
  _findFreeLayout(area, desired, config = this._draft || this._config) {
    const start = this._clampLayout(desired);
    const occupied = (config?.areas || [])
      .filter((candidate) => candidate.id !== "house" && candidate.id !== area.id && candidate.level_id === area.level_id && this._isVisualRoot(candidate, config))
      .map((candidate) => this._effectiveLayout(candidate, config));
    const positions = [];
    const maxRows = Math.max(12, this._levelRows(this._levelById(area.level_id, config), config) + 8);
    for (let y = 1; y <= maxRows; y += 1) {
      for (let x = 1; x <= 13 - start.w; x += 1) {
        positions.push({ x, y, w: start.w, h: start.h, distance: Math.abs(x - start.x) + Math.abs(y - start.y) });
      }
    }
    positions.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    const free = positions.find((candidate) => occupied.every((other) => !this._layoutsOverlap(candidate, other)));
    return free ? { x: free.x, y: free.y, w: free.w, h: free.h } : start;
  }

  _firstFreeLayout(levelId, config = this._draft || this._config, width = 3, height = 2) {
    const probe = { id: "__new__", level_id: levelId, layout: { x: 1, y: 1, w: width, h: height }, layout_mode: "free" };
    return this._findFreeLayout(probe, probe.layout, config);
  }

  _dockBounds(levelId, config = this._draft || this._config, excludeId = null) {
    const layouts = [...this._dockedLayouts(levelId, config, excludeId).values()];
    if (!layouts.length) return null;
    return {
      x1: Math.min(...layouts.map((item) => item.x)),
      y1: Math.min(...layouts.map((item) => item.y)),
      x2: Math.max(...layouts.map((item) => item.x + item.w - 1)),
      y2: Math.max(...layouts.map((item) => item.y + item.h - 1)),
    };
  }

  _shouldDock(levelId, column, row, config = this._draft || this._config, excludeId = null) {
    const bounds = this._dockBounds(levelId, config, excludeId);
    if (!bounds) return true;
    const threshold = 0.75;
    return column >= bounds.x1 - threshold && column <= bounds.x2 + threshold && row >= bounds.y1 - threshold && row <= bounds.y2 + threshold;
  }

  _dockAt(area, levelId, column, row, config = this._draft || this._config) {
    area.level_id = levelId;
    area.layout_mode = "docked";
    if (!this._isVisualRoot(area, config)) {
      const siblings = this._childrenOf(area.parent_id, config)
        .filter((item) => item.id !== area.id && item.level_id === levelId)
        .sort((a, b) => Number(a.dock_order || 0) - Number(b.dock_order || 0));
      area.dock_order = siblings.length;
      siblings.push(area);
      siblings.forEach((item, index) => { item.dock_order = index; });
      return;
    }
    const ordered = this._dockedAreas(levelId, config, area.id)
      .filter((item) => this._isVisualRoot(item, config));
    const layouts = this._dockedLayouts(levelId, config, area.id);
    const dropKey = row * 100 + column;
    let insertion = ordered.length;
    for (let index = 0; index < ordered.length; index += 1) {
      const layout = layouts.get(ordered[index].id) || this._groupSize(ordered[index], config);
      const key = (layout.y + layout.h / 2) * 100 + (layout.x + layout.w / 2);
      if (dropKey < key) { insertion = index; break; }
    }
    ordered.splice(insertion, 0, area);
    ordered.forEach((item, index) => { item.dock_order = index; });
  }
  _calculationTerms(area, kind) {
    if (!area) return [];
    const keyMap = {
      power: "power_terms",
      energy: "energy_terms",
      thermal_power: "thermal_power_terms",
      thermal_energy: "thermal_energy_terms",
    };
    return area[keyMap[kind] || "power_terms"] || [];
  }
  _calculationDependencies(area, config = this._config) {
    if (!area || area.mode !== "calculated") return [];
    return [...new Set([
      ...(area.power_terms || []),
      ...(area.energy_terms || []),
      ...(area.thermal_power_terms || []),
      ...(area.thermal_energy_terms || []),
    ]
      .filter((term) => term?.source_type === "area" && term?.source_id)
      .map((term) => term.source_id))];
  }
  _dependsOn(areaId, targetId, config = this._draft || this._config, stack = new Set()) {
    if (!areaId || stack.has(areaId)) return false;
    if (areaId === targetId) return true;
    stack.add(areaId);
    const area = this._areaById(areaId, config);
    return this._calculationDependencies(area, config).some((dependency) => this._dependsOn(dependency, targetId, config, new Set(stack)));
  }

  _measureSourceOptions(kind, currentAreaId, term, config = this._draft || this._config) {
    const selected = term?.source_id ? `${term.source_type || "area"}:${term.source_id}` : "";
    const isEnergy = kind === "energy" || kind === "thermal_energy";
    const isThermal = kind === "thermal_power" || kind === "thermal_energy";
    const areaMetric = isEnergy ? (isThermal ? "THERMISCHE ENERGIE HEUTE" : "ENERGIE HEUTE") : (isThermal ? "THERMISCHE LEISTUNG" : "AKTUELLE LEISTUNG");
    const areaOptions = (config?.areas || [])
      .filter((area) => area.id !== currentAreaId && !this._dependsOn(area.id, currentAreaId, config))
      .map((area) => {
        const value = `area:${area.id}`;
        return `<option value="${this._esc(value)}" ${value === selected ? "selected" : ""}>${this._esc(area.name)} · ${areaMetric}</option>`;
      }).join("");
    const entityOptions = this._entityList(isEnergy ? "energy" : "power")
      .map((state) => {
        const value = `entity:${state.entity_id}`;
        const unit = state.attributes?.unit_of_measurement ? ` · ${state.attributes.unit_of_measurement}` : "";
        return `<option value="${this._esc(value)}" ${value === selected ? "selected" : ""}>${this._esc(this._friendly(state.entity_id))} · ${this._esc(state.entity_id)}${this._esc(unit)}</option>`;
      }).join("");
    return `<option value="">— Messwert auswählen —</option><optgroup label="BEREICHSWERTE">${areaOptions}</optgroup><optgroup label="HOME ASSISTANT ENTITIES">${entityOptions}</optgroup>`;
  }
  _parseMeasureSource(value) {
    const raw = String(value || "");
    const index = raw.indexOf(":");
    if (index <= 0) return { source_type: "area", source_id: "" };
    const sourceType = raw.slice(0, index);
    return {
      source_type: sourceType === "entity" ? "entity" : "area",
      source_id: raw.slice(index + 1),
    };
  }

  _measureTermValue(term, kind, config = this._config, stack = new Set()) {
    if (!term?.source_id) return null;
    const isEnergy = kind === "energy" || kind === "thermal_energy";
    if (term.source_type === "entity") {
      return isEnergy ? this._dailyEnergyKWh(term.source_id) : this._powerW(term.source_id);
    }
    const sourceArea = this._areaById(term.source_id, config);
    if (kind === "thermal_energy") return this._areaThermalTodayEnergy(sourceArea, config, new Set(stack));
    if (kind === "thermal_power") return this._areaThermalPower(sourceArea, config, new Set(stack));
    if (kind === "energy") return this._areaTodayEnergy(sourceArea, config, new Set(stack));
    return this._areaPower(sourceArea, config, new Set(stack));
  }
  _areaCalculatedValue(area, kind, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    const terms = this._calculationTerms(area, kind);
    if (!terms.length) return null;
    stack.add(area.id);
    let result = 0;
    for (const term of terms) {
      const value = this._measureTermValue(term, kind, config, new Set(stack));
      if (value === null || !Number.isFinite(value)) return null;
      result += term.op === "-" ? -value : value;
    }
    return result;
  }

  _areaPower(area, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    if (area.mode !== "calculated") return this._powerW(area.power_entity);
    return this._areaCalculatedValue(area, "power", config, stack);
  }

  _areaThermalPower(area, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    if (area.mode !== "calculated") return this._powerW(area.thermal_power_entity);
    return this._areaCalculatedValue(area, "thermal_power", config, stack);
  }
  _areaTodayEnergy(area, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    if (area.mode !== "calculated") return this._dailyEnergyKWh(area.energy_entity);
    return this._areaCalculatedValue(area, "energy", config, stack);
  }

  _areaThermalTodayEnergy(area, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    if (area.mode !== "calculated") return this._dailyEnergyKWh(area.thermal_energy_entity);
    return this._areaCalculatedValue(area, "thermal_energy", config, stack);
  }
  _measureTermLabel(term, kind, config = this._config) {
    if (!term?.source_id) return "?";
    if (term.source_type === "entity") return this._friendly(term.source_id);
    const area = this._areaById(term.source_id, config);
    const suffix = kind === "energy" ? " · HEUTE" : kind === "thermal_power" ? " · THERMISCH" : kind === "thermal_energy" ? " · THERMISCH HEUTE" : "";
    return `${area?.name || "?"}${suffix}`;
  }
  _areaFormula(area, config = this._config, kind = "power") {
    if (!area || area.mode !== "calculated") {
      const entityMap = {
        power: "power_entity",
        energy: "energy_entity",
        thermal_power: "thermal_power_entity",
        thermal_energy: "thermal_energy_entity",
      };
      const entityId = area?.[entityMap[kind] || "power_entity"];
      return entityId ? `DIREKT · ${this._friendly(entityId)}` : "NICHT KONFIGURIERT";
    }
    const terms = this._calculationTerms(area, kind);
    if (!terms.length) return kind.includes("energy") ? "ENERGIE-BERECHNUNG FEHLT" : "LEISTUNGS-BERECHNUNG FEHLT";
    return terms.map((term, index) => `${index === 0 && term.op !== "-" ? "" : term.op === "-" ? "− " : "+ "}${this._measureTermLabel(term, kind, config)}`).join(" ");
  }
  _isVisualRoot(area, config = this._config) {
    if (!area || area.id === "house") return false;
    if (!area.parent_id || area.parent_id === "house") return true;
    const parent = this._areaById(area.parent_id, config);
    return !parent || parent.level_id !== area.level_id;
  }

  _visualRootAreas(levelId, config = this._config) {
    return (config?.areas || [])
      .filter((area) => area.id !== "house" && area.level_id === levelId && this._isVisualRoot(area, config))
      .sort((a, b) => Number(a.dock_order || 0) - Number(b.dock_order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
  }

  _sameLevelChildren(parentId, levelId, config = this._config) {
    return this._childrenOf(parentId, config)
      .filter((area) => area.level_id === levelId)
      .sort((a, b) => Number(a.dock_order || 0) - Number(b.dock_order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
  }

  _branchHasConfig(area, kind = "any", config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return false;
    stack.add(area.id);
    const own = kind === "thermal" ? this._isConfiguredThermalArea(area)
      : kind === "electric" ? this._isConfiguredElectricalArea(area)
      : this._isConfiguredArea(area);
    if (own) return true;
    return this._sameLevelChildren(area.id, area.level_id, config)
      .some((child) => this._branchHasConfig(child, kind, config, new Set(stack)));
  }

  _branchValue(area, kind, config = this._config, stack = new Set()) {
    if (!area || stack.has(area.id)) return null;
    const getter = kind === "energy" ? (item) => this._areaTodayEnergy(item, config, new Set(stack))
      : kind === "thermal_power" ? (item) => this._areaThermalPower(item, config, new Set(stack))
      : kind === "thermal_energy" ? (item) => this._areaThermalTodayEnergy(item, config, new Set(stack))
      : (item) => this._areaPower(item, config, new Set(stack));
    if (this._areaHasMeasure(area, kind)) return getter(area);
    stack.add(area.id);
    const values = this._sameLevelChildren(area.id, area.level_id, config)
      .map((child) => this._branchValue(child, kind, config, new Set(stack)))
      .filter((value) => value !== null && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  _levelValue(level, kind, config = this._config) {
    if (!level) return null;
    const values = this._visualRootAreas(level.id, config)
      .map((area) => this._branchValue(area, kind, config))
      .filter((value) => value !== null && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  _levelPower(level, config = this._config) { return this._levelValue(level, "power", config); }
  _levelTodayEnergy(level, config = this._config) { return this._levelValue(level, "energy", config); }
  _levelThermalPower(level, config = this._config) { return this._levelValue(level, "thermal_power", config); }
  _levelThermalTodayEnergy(level, config = this._config) { return this._levelValue(level, "thermal_energy", config); }

  _totalLevelValue(kind, config = this._config) {
    const viewKind = kind.startsWith("thermal") ? "thermal" : "electric";
    const values = this._overviewLevels(config, viewKind)
      .map((level) => this._levelValue(level, kind, config))
      .filter((value) => value !== null && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  _levelRows(level, config = this._config) {
    if (!level) return 2;
    const roots = this._visualRootAreas(level.id, config);
    if (!roots.length) return 2;
    return Math.max(2, ...roots.map((area) => {
      const layout = this._effectiveLayout(area, config);
      return Number(layout.y || 1) + Number(layout.h || 2) - 1;
    }));
  }
  _groupSize(area, config = this._draft || this._config, stack = new Set()) {
    const base = this._clampLayout(area?.layout);
    if (!area || stack.has(area.id)) return base;
    const nextStack = new Set(stack);
    nextStack.add(area.id);
    const children = this._sameLevelChildren(area.id, area.level_id, config);
    if (!children.length) return base;
    const childRows = children.reduce((sum, child) => {
      const childSize = this._groupSize(child, config, nextStack);
      return sum + Math.max(3, Number(childSize.h || 1));
    }, 0);
    return { ...base, w: base.w, h: Math.min(100, Math.max(2, base.h) + childRows) };
  }

  _flowPhase(duration = 1.8) {
    return `-${((Date.now() / 1000) % duration).toFixed(3)}s`;
  }

  _flowWire(kind = "electric", height = 36) {
    return `<div class="wire vertical active flow-${kind}" style="height:${height}px;--flow-phase:${this._flowPhase(1.8)}"></div>`;
  }

  _renderLoading() {
    this.shadowRoot.innerHTML = `${this._styles()}<main class="shell"><div class="loading">ENERGY SYSTEM<br><span>Konfiguration wird geladen …</span></div></main>`;
  }

  _renderError(message) {
    this.shadowRoot.innerHTML = `${this._styles()}<main class="shell"><div class="error-box">${this._esc(message)}</div></main>`;
  }

  _render() {
    if (!this._loaded || !this._config) return;
    if (this._cardConfig) {
      this._renderCard();
      return;
    }
    const admin = Boolean(this._hass?.user?.is_admin);
    const title = this._config.name || "ENERGY SYSTEM";
    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <main class="shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">HOME ASSISTANT / ENERGY TOPOLOGY · V${ENERGY_SYSTEM_DASHBOARD_VERSION}</div>
            <h1>${this._esc(title)}</h1>
          </div>
          <div class="live-state"><span class="pulse"></span> LIVE <strong>${new Date().toLocaleTimeString("de-DE")}</strong></div>
        </header>
        <nav class="tabs">
          ${this._tabButton("system", "SYSTEM")}
          ${this._tabButton("electric", "ELEKTRISCH")}
          ${this._tabButton("thermal", "THERMISCH")}
          ${admin ? this._tabButton("config", "KONFIGURATION") : ""}
        </nav>
        <section class="content">
          ${this._tab === "system" ? this._renderSystem() : ""}
          ${this._tab === "electric" ? this._renderElectric() : ""}
          ${this._tab === "thermal" ? this._renderThermal() : ""}
          ${this._tab === "config" ? this._renderConfig() : ""}
        </section>
      </main>`;
  }

  _renderCard() {
    this._syncLayoutState(this._config);
    const options = this._cardConfig || {};
    const levels = this._overviewLevels(this._config);
    if (options.default_floor && !levels.some((level) => String(level.name || "").toLowerCase() === String(options.default_floor).toLowerCase())) {
      this.shadowRoot.innerHTML = `${this._styles()}<ha-card class="readonly-card"><div class="card-error"><strong>Stockwerk „${this._esc(options.default_floor)}“ wurde nicht gefunden.</strong><span>Verfügbar: ${this._esc(levels.map((level) => level.name).join(", ") || "keine Stockwerke")}</span></div></ha-card>`;
      return;
    }
    const view = options.view || "system";
    const content = view === "electrical" ? this._renderElectric()
      : view === "thermal" ? this._renderThermal()
      : view === "building" ? this._renderAreas()
      : this._renderSystem();
    const classes = [
      "readonly-card",
      options.display === "compact" ? "display-compact" : "display-full",
      options.floor_selector === false ? "hide-floor-selector" : "",
      options.show_daily_energy === false ? "hide-daily" : "",
      options.show_status === false ? "hide-status" : "",
    ].filter(Boolean).join(" ");
    const title = options.title || this._config.name || "ENERGY SYSTEM";
    this.shadowRoot.innerHTML = `${this._styles()}<ha-card class="${classes}"><div class="card-head"><div><span>ENERGY SYSTEM / READ ONLY · V${ENERGY_SYSTEM_DASHBOARD_VERSION}</span><strong>${this._esc(title)}</strong></div><em><i></i> LIVE</em></div><div class="card-content">${content}</div></ha-card>`;
  }

  _tabButton(tab, label) {
    return `<button class="tab ${this._tab === tab ? "active" : ""}" data-action="set-tab" data-tab="${tab}">${label}</button>`;
  }

  _electricalNodes() {
    const config = this._config;
    const gridFlow = this._gridFlow();
    const nodes = [];
    if (this._isConfiguredGrid(config)) {
      nodes.push(this._node({
        code: "GRID",
        name: config.grid.name || "Netz",
        main: this._formatPowerW(gridFlow.power),
        state: gridFlow.label,
        status: gridFlow.mode === "unknown" ? "unknown" : gridFlow.mode === "import" ? "active" : "good",
        custom: `<div class="mini-line daily-value"><span>BEZUG HEUTE</span><strong>${this._formatEnergyKWh(this._dailyEnergyKWh(config.grid.import_energy_entity))}</strong></div><div class="mini-line daily-value"><span>EINSPEISUNG HEUTE</span><strong>${this._formatEnergyKWh(this._dailyEnergyKWh(config.grid.export_energy_entity))}</strong></div>`,
        metaLeft: "REFERENCE",
        metaRight: config.grid.direction === "export_positive" ? "EXPORT +" : "IMPORT +",
      }));
    }
    for (const module of (config.generation || []).filter((item) => this._isConfiguredGeneration(item))) {
      const power = this._powerW(module.power_entity);
      nodes.push(this._node({
        code: module.type === "solar" ? "PV" : "GEN",
        name: module.name || "Erzeuger",
        main: this._formatPowerW(power),
        state: power !== null && power > 10 ? "PRODUCTION" : power === null ? "UNKNOWN" : "IDLE",
        status: power === null ? "unknown" : power > 10 ? "good" : "idle",
        custom: module.energy_entity ? `<div class="mini-line daily-value"><span>HEUTE</span><strong>${this._formatEnergyKWh(this._dailyEnergyKWh(module.energy_entity))}</strong></div>` : "",
        metaLeft: "SOURCE",
        metaRight: module.power_entity ? this._friendly(module.power_entity) : "NO ENTITY",
      }));
    }
    for (const module of (config.storage || []).filter((item) => this._isConfiguredStorage(item))) {
      const power = this._powerW(module.power_entity);
      const soc = this._numeric(module.soc_entity);
      const state = power === null ? "UNKNOWN" : power > 10 ? "CHARGE" : power < -10 ? "DISCHARGE" : "IDLE";
      nodes.push(this._node({
        code: "BAT",
        name: module.name || "Batterie",
        main: soc === null ? this._formatPowerW(power, true) : `${soc.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
        state,
        status: power === null ? "unknown" : Math.abs(power) > 10 ? "active" : "idle",
        custom: `<div class="mini-line daily-value"><span>LADEN HEUTE</span><strong>${this._formatEnergyKWh(this._dailyEnergyKWh(module.charge_energy_entity))}</strong></div><div class="mini-line daily-value"><span>ENTLADEN HEUTE</span><strong>${this._formatEnergyKWh(this._dailyEnergyKWh(module.discharge_energy_entity))}</strong></div>`,
        metaLeft: this._formatPowerW(power, true),
        metaRight: "STORAGE",
      }));
    }
    return nodes;
  }

  _renderSystem() {
    const config = this._config;
    this._syncLayoutState(config);
    const electrical = this._electricalNodes();
    const configuredHeating = (config.heating || []).filter((module) => this._isConfiguredHeating(module));
    const conversions = configuredHeating.filter((module) => module.power_entity).map((module) => this._renderHeatingNode(module, "electric"));
    const thermalSources = configuredHeating.filter((module) => module.target === "buffer").map((module) => this._renderHeatingNode(module, "thermal"));
    const roomSources = configuredHeating.filter((module) => module.target !== "buffer").map((module) => this._renderHeatingNode(module, "thermal"));
    const buffer = config.buffer || {};
    const electricLevels = this._overviewLevels(config, "electric");
    const thermalLevels = this._overviewLevels(config, "thermal");
    const sections = [];

    if (electrical.length || electricLevels.length) {
      sections.push(`<section class="system-zone electrical-zone">
        <div class="section-label split-label"><span>01 / ELEKTRISCH</span><strong>${this._housePowerLabel()}</strong></div>
        ${electrical.length ? `<div class="system-grid module-board">${this._gridCells(electrical)}</div>${this._flowWire("electric")}` : ""}
        ${electricLevels.length ? `<div class="bus"><span>ELEKTRISCHE VERTEILUNG</span><strong>${this._housePowerLabel()}</strong></div>${this._renderBuildingStack(config, null, false, "electric")}` : ""}
      </section>`);
    }

    if (conversions.length) {
      sections.push(`<div class="conversion-band"><span>02 / ENERGIEWANDLUNG</span><strong>ELEKTRISCH → WÄRME</strong></div><div class="system-grid module-board conversion-board">${this._gridCells(conversions)}</div>`);
    }

    if (thermalSources.length || roomSources.length || this._isConfiguredBuffer(buffer) || thermalLevels.length) {
      sections.push(`<section class="system-zone thermal-zone">
        <div class="section-label split-label"><span>03 / THERMISCH</span><strong>${this._thermalLoadLabel()}</strong></div>
        ${thermalSources.length ? `<div class="system-grid module-board thermal-board">${this._gridCells(thermalSources)}</div>${this._flowWire("thermal", 28)}` : ""}
        ${this._isConfiguredBuffer(buffer) ? `<div class="system-grid module-board buffer-board"><div class="system-cell full-span">${this._renderBuffer(buffer)}</div></div>` : ""}
        ${thermalLevels.length ? `${this._flowWire("thermal", 28)}<div class="distribution-box thermal-distribution"><span>THERMISCHE VERTEILUNG</span><strong>${this._thermalLoadLabel()}</strong></div>${this._renderBuildingStack(config, null, false, "thermal")}` : ""}
        ${roomSources.length ? `<div class="section-label room-label">DIREKTE RAUMWÄRME / SONSTIGE WÄRMESENKEN</div><div class="system-grid module-board thermal-board">${this._gridCells(roomSources)}</div>` : ""}
      </section>`);
    }

    return `<div class="system-note">GESAMTSYSTEM · ELEKTRISCHE UND THERMISCHE LASTEN JE STOCKWERK</div>${sections.join("") || this._empty("Noch kein Systemmodul konfiguriert.")}`;
  }
  _renderElectric() {
    const config = this._config;
    this._syncLayoutState(config);
    const topNodes = this._electricalNodes();
    const levels = this._overviewLevels(config, "electric");
    return `
      <div class="system-note">ELEKTRISCHES EINLINIENSCHEMA · VERTEILUNG = SUMME DER STOCKWERKSLASTEN</div>
      ${topNodes.length ? `<div class="system-grid module-board">${this._gridCells(topNodes)}</div>${this._flowWire("electric")}` : ""}
      ${levels.length ? `<div class="bus"><span>ELEKTRISCHE VERTEILUNG</span><strong>${this._housePowerLabel()}</strong></div>${this._renderBuildingStack(config, null, false, "electric")}` : this._empty("Noch keine elektrischen Bereiche konfiguriert.")}`;
  }
  _housePowerLabel() {
    const total = this._totalLevelValue("power", this._config);
    return total === null ? "KEIN MESSWERT" : this._formatPowerW(total);
  }

  _thermalLoadLabel() {
    const total = this._totalLevelValue("thermal_power", this._config);
    return total === null ? "KEIN MESSWERT" : this._formatPowerW(total);
  }
  _renderAreaNode(area) {
    const power = this._areaPower(area);
    const today = this._areaTodayEnergy(area);
    const level = this._levelById(area.level_id);
    return this._node({
      code: area.mode === "calculated" ? "C" : "M",
      name: area.name,
      main: this._formatPowerW(power),
      state: area.mode === "calculated" ? "CALCULATED" : area.power_entity ? "MEASURED" : "NO METER",
      status: power === null ? "unknown" : "active",
      custom: `<div class="mini-line"><span>HEUTE</span><strong>${this._formatEnergyKWh(today)}</strong></div><div class="mini-line"><span>LOGIK</span><strong title="${this._esc(this._areaFormula(area))}">${this._esc(this._areaFormula(area))}</strong></div>`,
      metaLeft: level?.name || "NO LEVEL",
      metaRight: area.mode === "calculated" ? "CALC" : "METER",
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
    const heating = (this._config.heating || []).filter((module) => this._isConfiguredHeating(module));
    const toBuffer = heating.filter((module) => module.target === "buffer");
    const toRoom = heating.filter((module) => module.target !== "buffer");
    const buffer = this._config.buffer || {};
    const levels = this._overviewLevels(this._config, "thermal");

    const bufferNodes = toBuffer.map((module) => this._renderHeatingNode(module, "thermal"));
    const roomNodes = toRoom.map((module) => this._renderHeatingNode(module, "thermal"));
    return `
      <div class="system-note">THERMISCHES ANLAGENFLIESSBILD · VERTEILUNG = SUMME DER THERMISCHEN STOCKWERKSLASTEN</div>
      ${bufferNodes.length ? `<div class="section-label">WÄRMEERZEUGER / PUFFER</div><div class="system-grid module-board thermal-board">${this._gridCells(bufferNodes)}</div>` : ""}
      ${bufferNodes.length && this._isConfiguredBuffer(buffer) ? this._flowWire("thermal", 28) : ""}
      ${this._isConfiguredBuffer(buffer) ? `<div class="system-grid module-board buffer-board"><div class="system-cell full-span">${this._renderBuffer(buffer)}</div></div>` : ""}
      ${levels.length ? `${this._flowWire("thermal", 28)}<div class="distribution-box thermal-distribution"><span>THERMISCHE VERTEILUNG</span><strong>${this._thermalLoadLabel()}</strong></div>${this._renderBuildingStack(this._config, null, false, "thermal")}` : ""}
      ${roomNodes.length ? `<div class="section-label room-label">DIREKTE RAUMWÄRME / SONSTIGE WÄRMESENKEN</div><div class="system-grid module-board thermal-board">${this._gridCells(roomNodes)}</div>` : ""}
      ${!bufferNodes.length && !roomNodes.length && !this._isConfiguredBuffer(buffer) && !levels.length ? this._empty("Noch kein thermisches Modul oder keine thermische Bereichslast konfiguriert.") : ""}`;
  }
  _renderHeatingNode(module, context = "electric") {
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
    if (module.power_entity) details.push(["EL. POWER", this._formatPowerW(this._powerW(module.power_entity))]);
    if (module.energy_entity) details.push(["EL. HEUTE", this._formatEnergyKWh(this._dailyEnergyKWh(module.energy_entity)), "daily-value"]);
    if (module.thermal_power_entity) details.push(["TH. POWER", this._formatPowerW(this._powerW(module.thermal_power_entity))]);
    if (module.thermal_energy_entity) details.push(["TH. HEUTE", this._formatEnergyKWh(this._dailyEnergyKWh(module.thermal_energy_entity)), "daily-value"]);

    const thermalMain = module.thermal_power_entity ? this._formatPowerW(this._powerW(module.thermal_power_entity)) : null;
    const electricMain = module.power_entity ? this._formatPowerW(this._powerW(module.power_entity)) : null;
    const main = context === "thermal" ? (thermalMain || details[0]?.[1] || "—") : (electricMain || thermalMain || details[0]?.[1] || "—");
    return this._node({
      code: typeCodes[module.type] || "HEAT",
      name: module.name || "Wärmeerzeuger",
      main,
      state: status.text,
      status: status.cls,
      custom: details.map(([key, value, cls]) => `<div class="mini-line ${cls || ""}"><span>${key}</span><strong>${this._esc(value)}</strong></div>`).join(""),
      metaLeft: module.target === "buffer" ? "→ BUFFER" : "→ ROOM",
      metaRight: context === "thermal" ? "THERMAL" : "ELECTRIC",
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
    this._syncLayoutState(this._config);
    const fixedLevel = this._cardConfig?.default_floor
      ? this._buildingLevels(this._config).find((level) => String(level.name || "").toLowerCase() === String(this._cardConfig.default_floor).toLowerCase())
      : null;
    return `
      <div class="system-note">GEBÄUDEPLAN · SEITLICHE STOCKWERK-REFERENZ · PARENT GROSS · CHILDREN KOMPAKT</div>
      ${this._renderBuildingStack(this._config, fixedLevel?.id || null, true, "electric")}`;
  }
  _renderLevelPlan(level, config = this._config, interactive = false, compactHeader = false) {
    const areas = (config?.areas || []).filter((area) => area.id !== "house" && area.level_id === level.id);
    const rows = this._levelRows(level, config);
    return `
      <section class="building-level ${interactive ? "editing" : ""}">
        <div class="level-head ${compactHeader ? "compact" : ""}"><span>LEVEL</span><strong>${this._esc(level.name)}</strong><em>${areas.length} BEREICHE</em></div>
        <div class="level-grid ${interactive ? "layout-grid" : "readonly"}" data-layout-grid ${interactive ? `data-level-id="${this._esc(level.id)}"` : ""} style="--rows:${rows}">
          ${areas.map((area) => this._renderAreaTile(area, config, interactive)).join("")}
          ${!areas.length ? `<div class="layout-empty">KEINE BEREICHE AUF DIESEM STOCKWERK</div>` : ""}
        </div>
      </section>`;
  }

  _renderOverviewFloorGroup(level, config = this._config, kind = "electric", isFirst = false, isLast = false) {
    const roots = this._visualRootAreas(level.id, config)
      .filter((area) => this._branchHasConfig(area, kind, config));
    if (!roots.length) return "";
    const rows = Math.max(2, ...roots.map((area) => {
      const layout = this._effectiveLayout(area, config);
      return Number(layout.y || 1) + Number(layout.h || 2) - 1;
    }));
    const load = kind === "thermal" ? this._levelThermalPower(level, config) : this._levelPower(level, config);
    const today = kind === "thermal" ? this._levelThermalTodayEnergy(level, config) : this._levelTodayEnergy(level, config);
    const edgeClass = `${isFirst ? " is-first-floor" : ""}${isLast ? " is-last-floor" : ""}`;
    return `
      <section class="overview-floor-group flow-floor-group flow-${kind}${edgeClass}" style="--flow-phase:${this._flowPhase(1.8)}">
        <div class="floor-flow-channel">
          <i class="flow-segment vertical floor-channel-rail"></i>
          <i class="flow-segment horizontal branch-segment"></i>
          <span class="floor-branch-load">${this._formatPowerW(load)}</span>
        </div>
        <aside class="floor-indicator"><strong>${this._esc(level.name)}</strong><small class="daily-value">HEUTE ${this._formatEnergyKWh(today)}</small></aside>
        <div class="floor-layout-body">
          <div class="floor-layout-meta"><span>${kind === "thermal" ? "THERMISCHE EBENE" : "ELEKTRISCHE EBENE"}</span><strong>${this._esc(level.name)}</strong><em>${roots.length} HAUPTBEREICH${roots.length === 1 ? "" : "E"}</em></div>
          <div class="level-grid readonly" style="--rows:${rows}">
            ${roots.map((area) => this._renderAreaGroup(area, config, false, kind)).join("")}
          </div>
        </div>
      </section>`;
  }
  _renderBuildingStack(config = this._config, fixedLevelId = null, includeHouse = true, kind = "electric") {
    const house = this._houseArea(config);
    const allLevels = this._overviewLevels(config, kind);
    const houseHtml = includeHouse && kind === "electric" && house && this._isConfiguredElectricalArea(house) ? this._renderHouseTile(house, config, false) : "";
    let levels = fixedLevelId ? allLevels.filter((level) => level.id === fixedLevelId) : allLevels;
    let selector = "";
    if (this._cardConfig && !fixedLevelId) {
      const requested = this._cardConfig.default_floor
        ? allLevels.find((level) => String(level.name || "").toLowerCase() === String(this._cardConfig.default_floor).toLowerCase())
        : null;
      const current = allLevels.find((level) => level.id === this._viewLevelId);
      const selected = requested || current || allLevels[0];
      if (this._cardConfig.floor_selector !== false && selected) {
        selector = this._levelSelector(config, selected.id, "set-view-level", kind);
        levels = [selected];
      } else if (requested) {
        levels = [requested];
      }
    }
    const floors = levels.map((level, index) => this._renderOverviewFloorGroup(level, config, kind, index === 0, index === levels.length - 1)).join("");
    const flowRoute = floors ? `<div class="distribution-manifold flow-${kind}" style="--flow-phase:${this._flowPhase(1.8)}"><i class="flow-segment vertical manifold-drop"></i><i class="flow-segment horizontal manifold-run flow-left"></i><i class="flow-segment vertical manifold-rail-drop"></i></div><div class="floor-stack flow-${kind}" style="--flow-phase:${this._flowPhase(1.8)}">${floors}</div>` : "";
    return `<div class="building-stack overview-building-stack distribution-flow-stack flow-${kind}">${houseHtml}${selector}${flowRoute || this._empty(kind === "thermal" ? "Noch keine thermischen Bereichslasten vorhanden." : "Noch keine elektrischen Bereiche vorhanden.")}</div>`;
  }
  _renderEditorFloorGroup(level, config = this._draft || this._config) {
    const areas = (config?.areas || []).filter((area) => area.id !== "house" && area.level_id === level.id);
    const roots = this._visualRootAreas(level.id, config);
    const rows = Math.max(3, this._levelRows(level, config));
    const docked = roots.filter((area) => this._layoutMode(area) === "docked").length;
    const free = roots.length - docked;
    return `
      <section class="editor-floor-group" data-floor-group="${this._esc(level.id)}">
        <aside class="floor-indicator"><strong>${this._esc(level.name)}</strong><span class="floor-load">${this._formatPowerW(this._levelPower(level, config))}</span><small>${areas.length} BEREICHE</small></aside>
        <div class="floor-layout-body">
          <div class="floor-layout-meta"><span>STOCKWERK</span><strong>${this._esc(level.name)}</strong><em>${docked} ROOT DOCKED · ${free} ROOT FREE</em></div>
          <div class="level-grid layout-grid magnetic-grid" data-layout-grid data-level-id="${this._esc(level.id)}" style="--rows:${rows}">
            ${roots.map((area) => this._renderAreaGroup(area, config, true, "electric")).join("")}
            ${!areas.length ? `<div class="layout-empty">BEREICH HINZUFÜGEN UND DIESEM STOCKWERK ZUWEISEN</div>` : ""}
          </div>
        </div>
      </section>`;
  }
  _renderHouseTile(house, config = this._config, interactive = false) {
    const selected = interactive && house.id === this._selectedAreaId;
    const tag = interactive ? "button" : "article";
    const attrs = interactive ? `type="button" data-action="select-area" data-area-id="${this._esc(house.id)}"` : "";
    const power = this._areaPower(house, config);
    const today = this._areaTodayEnergy(house, config);
    return `<${tag} class="area-tile house-tile ${house.mode === "calculated" ? "calculated" : "measured"} ${selected ? "selected" : ""}" ${attrs}>
      <div class="area-tile-head"><span>${house.mode === "calculated" ? "C" : "M"}</span><strong>${this._esc(house.name || "Haus")}</strong></div>
      <div class="house-values"><div><span>AKTUELL</span><strong>${this._formatPowerW(power)}</strong></div><div class="daily-value"><span>HEUTE</span><strong>${this._formatEnergyKWh(today)}</strong></div><div><span>LOGIK</span><strong>${this._esc(this._areaFormula(house, config))}</strong></div></div>
    </${tag}>`;
  }

  _renderAreaGroup(area, config = this._config, interactive = false, kind = "electric", depth = 0, nested = false) {
    const children = this._sameLevelChildren(area.id, area.level_id, config)
      .filter((child) => interactive || this._branchHasConfig(child, kind, config));
    const layout = this._effectiveLayout(area, config);
    const tileLayout = this._clampLayout(area.layout);
    const groupClass = children.length ? "has-children" : "leaf-group";
    const position = nested
      ? `style="--root-tile-height:${Math.max(42, Number(tileLayout.h || 1) * 42)}px"`
      : `style="grid-column:${Number(layout.x || 1)} / span ${Number(layout.w || 3)};grid-row:${Number(layout.y || 1)} / span ${Number(layout.h || 2)};--root-tile-height:${Math.max(42, Number(tileLayout.h || 1) * 42)}px"`;
    return `<div class="area-group ${nested ? "nested-area-group" : "root-area-group"} ${groupClass} depth-${Math.min(depth, 3)}" data-area-group="${this._esc(area.id)}" ${position}>
      ${this._renderAreaTile(area, config, interactive, kind, depth)}
      ${children.length ? `<div class="area-child-grid" data-child-drop-parent="${this._esc(area.id)}">${children.map((child, index) => `<div class="area-child-branch ${index === children.length - 1 ? "last-child-branch" : ""}" data-child-branch="${this._esc(child.id)}">${this._renderAreaGroup(child, config, interactive, kind, depth + 1, true)}</div>`).join("")}</div>` : ""}
    </div>`;
  }

  _renderAreaTile(area, config = this._config, interactive = false, kind = "electric", depth = 0) {
    const power = kind === "thermal" ? this._areaThermalPower(area, config) : this._areaPower(area, config);
    const today = kind === "thermal" ? this._areaThermalTodayEnergy(area, config) : this._areaTodayEnergy(area, config);
    const selected = interactive && area.id === this._selectedAreaId;
    const tag = interactive ? "button" : "article";
    const attrs = interactive ? `type="button" draggable="true" data-drag-area="${this._esc(area.id)}" data-action="select-area" data-area-id="${this._esc(area.id)}"` : "";
    const children = this._sameLevelChildren(area.id, area.level_id, config);
    const parent = area.parent_id && area.parent_id !== "house" ? this._areaById(area.parent_id, config) : null;
    const hierarchyClass = children.length ? " hierarchy-parent" : parent ? ` hierarchy-child hierarchy-depth-${Math.min(depth, 3)}` : " hierarchy-root";
    const relation = children.length
      ? `<div class="area-hierarchy-meta"><span>PARENT</span><strong>${children.length} UNTERBEREICH${children.length === 1 ? "" : "E"}</strong></div>`
      : parent ? `<div class="area-parent-ref">↳ ${this._esc(parent.name)}</div>` : "";
    const formulaKind = kind === "thermal" ? "thermal_power" : "power";
    return `<${tag} class="area-tile ${kind === "thermal" ? "thermal-area" : "electric-area"} ${area.mode === "calculated" ? "calculated" : "measured"} layout-${this._layoutMode(area)}${hierarchyClass} ${selected ? "selected" : ""}" ${attrs}>
      <div class="area-tile-head"><span>${area.mode === "calculated" ? "C" : "M"}</span><strong>${this._esc(area.name)}</strong></div>
      ${relation}
      <div class="area-tile-power">${this._formatPowerW(power)}</div>
      <div class="area-tile-energy daily-value"><span>HEUTE</span><strong>${this._formatEnergyKWh(today)}</strong></div>
      <div class="area-tile-formula">${this._esc(this._areaFormula(area, config, formulaKind))}</div>
    </${tag}>`;
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
              ${this._field("Thermische Leistung", `<select data-array="heating" data-index="${index}" data-field="thermal_power_entity">${this._entityOptions("power", module.thermal_power_entity)}</select>`)}
              ${this._field("Thermische Energie / kWh", `<select data-array="heating" data-index="${index}" data-field="thermal_energy_entity">${this._entityOptions("energy", module.thermal_energy_entity)}</select>`)}
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
        <div class="hint">Reihenfolge der Auswahl entspricht der Anzeige T01 … Txx.</div>
      </section>`;
  }

  _configAreasSection(d) {
    this._syncLayoutState(d);
    const selected = this._areaById(this._selectedAreaId, d) || this._houseArea(d) || d.areas?.[0];
    const house = this._houseArea(d);
    const levels = this._buildingLevels(d);
    return `
      <section class="config-card wide layout-config-card">
        <div class="config-head"><span>06 / BUILDING</span><strong>MAGNETISCHER GEBÄUDEPLAN</strong><button data-action="add-area">+ BEREICH</button></div>
        <div class="root-note">ANGEDOCKT = AUTOMATISCH ZENTRIERT UND LÜCKENLOS. DRAG & DROP IM VERBUND ÄNDERT DIE REIHENFOLGE. DEUTLICH AUSSERHALB ABLEGEN = FREI. NAHE AM VERBUND ABLEGEN = WIEDER ANDOCKEN.</div>
        <div class="layout-editor">
          <div class="layout-stage">
            ${house ? this._renderHouseTile(house, d, true) : ""}
            <div class="building-stack editor-building-stack">
              ${levels.length ? levels.map((item) => this._renderEditorFloorGroup(item, d)).join("") : `<div class="layout-empty standalone">NOCH KEINE BEREICHE EINEM STOCKWERK ZUGEORDNET</div>`}
            </div>
          </div>
          <aside class="layout-inspector">${selected ? this._renderAreaInspector(selected, d) : this._empty("Bereich auswählen.")}</aside>
        </div>
        <div class="layout-savebar"><span>${this._saveNotice ? this._esc(this._saveNotice) : "ÄNDERUNGEN AM GEBÄUDEPLAN WERDEN ERST MIT SPEICHERN ÜBERNOMMEN."}</span><button class="primary" data-action="save-config" ${this._saving ? "disabled" : ""}>${this._saving ? "SPEICHERT …" : "GEBÄUDEPLAN SPEICHERN"}</button></div>
      </section>`;
  }

  _termKey(kind) {
    return {
      power: "power_terms",
      energy: "energy_terms",
      thermal_power: "thermal_power_terms",
      thermal_energy: "thermal_energy_terms",
    }[kind] || "power_terms";
  }

  _renderMeasureCalculation(area, kind, d) {
    const terms = this._calculationTerms(area, kind);
    const titleMap = {
      power: "AKTUELLE ELEKTRISCHE LEISTUNG",
      energy: "ELEKTRISCHE ENERGIE HEUTE",
      thermal_power: "AKTUELLE THERMISCHE LEISTUNG",
      thermal_energy: "THERMISCHE ENERGIE HEUTE",
    };
    const value = kind === "energy" ? this._areaTodayEnergy(area, d)
      : kind === "thermal_power" ? this._areaThermalPower(area, d)
      : kind === "thermal_energy" ? this._areaThermalTodayEnergy(area, d)
      : this._areaPower(area, d);
    const formatted = kind.includes("energy") ? this._formatEnergyKWh(value) : this._formatPowerW(value);
    return `<div class="inspector-section measure-calculation ${kind.startsWith("thermal") ? "thermal-calculation" : ""}">
      <div class="inspector-label">${titleMap[kind] || "MESSWERT"} BERECHNEN</div>
      ${terms.map((term, index) => `<div class="calc-row measure"><select data-area-id="${this._esc(area.id)}" data-calc-kind="${kind}" data-calc-index="${index}" data-calc-field="op"><option value="+" ${term.op !== "-" ? "selected" : ""}>+</option><option value="-" ${term.op === "-" ? "selected" : ""}>−</option></select><select data-area-id="${this._esc(area.id)}" data-calc-kind="${kind}" data-calc-index="${index}" data-calc-field="source">${this._measureSourceOptions(kind, area.id, term, d)}</select><button class="danger" data-action="remove-measure-term" data-area-id="${this._esc(area.id)}" data-kind="${kind}" data-index="${index}">×</button></div>`).join("")}
      <button class="small-action" data-action="add-measure-term" data-area-id="${this._esc(area.id)}" data-kind="${kind}">+ MESSWERT</button>
      <div class="measure-preview"><span>ERGEBNIS</span><strong>${formatted}</strong><small>${this._esc(this._areaFormula(area, d, kind))}</small></div>
    </div>`;
  }
  _renderHierarchyEditor(area, d) {
    const isHouse = area.id === "house";
    const children = this._childrenOf(area.id, d);
    const parentField = isHouse ? "" : this._field("Übergeordneter Bereich", `<select data-area-id="${this._esc(area.id)}" data-area-field="parent_id"><option value="">— kein Parent —</option>${this._areaOptionsForParent(area, d)}</select>`);
    return `<div class="inspector-section hierarchy-section">
      <div class="inspector-label">HIERARCHIE / PARENT & CHILD</div>
      ${parentField}
      <div class="hierarchy-subhead"><span>UNTERBEREICHE</span><strong>${children.length}</strong></div>
      <div class="child-list">${children.map((child) => `<button type="button" data-action="select-area" data-area-id="${this._esc(child.id)}"><b>${child.mode === "calculated" ? "C" : "M"}</b><span><strong>${this._esc(child.name)}</strong><small>↳ ${this._esc(area.name || "Parent")}</small></span><em>${this._isConfiguredArea(child, d) ? "KONFIGURIERT" : "OFFEN"}</em></button>`).join("") || `<div class="child-empty">KEINE UNTERBEREICHE</div>`}</div>
      ${children.length ? `<div class="child-open"><span>UNTERBEREICH ÖFFNEN</span><div><select data-child-open-select="${this._esc(area.id)}">${this._directChildOptions(area.id, d)}</select><button type="button" data-action="open-child" data-area-id="${this._esc(area.id)}">ÖFFNEN</button></div></div>` : ""}
      <button class="small-action" type="button" data-action="add-child" data-area-id="${this._esc(area.id)}">+ UNTERBEREICH</button>
      <div class="child-assign-label">BESTEHENDEN BEREICH ALS UNTERBEREICH ZUORDNEN</div>
      <div class="child-assign"><select data-child-parent-select="${this._esc(area.id)}">${this._areaOptionsForChildAssignment(area.id, d)}</select><button type="button" data-action="assign-child" data-area-id="${this._esc(area.id)}">ZUORDNEN</button></div>
    </div>`;
  }

  _renderAreaInspector(area, d) {
    const isHouse = area.id === "house";
    const layout = this._effectiveLayout(area, d);
    const levelOptions = this._floorSelectOptions(area, d);
    const calculation = area.mode === "calculated"
      ? `${this._renderMeasureCalculation(area, "power", d)}${this._renderMeasureCalculation(area, "energy", d)}${this._renderMeasureCalculation(area, "thermal_power", d)}${this._renderMeasureCalculation(area, "thermal_energy", d)}`
      : `<div class="inspector-section measure-section"><div class="inspector-label">ELEKTRISCHE MESSWERTE</div>${this._field("Aktuelle Leistung", `<select data-area-id="${this._esc(area.id)}" data-area-field="power_entity">${this._entityOptions("power", area.power_entity)}</select>`)}${this._field("Energiezähler Gesamtstand", `<select data-area-id="${this._esc(area.id)}" data-area-field="energy_entity">${this._entityOptions("energy", area.energy_entity)}</select>`)}</div><div class="inspector-section measure-section thermal-calculation"><div class="inspector-label">THERMISCHE MESSWERTE</div>${this._field("Thermische Leistung", `<select data-area-id="${this._esc(area.id)}" data-area-field="thermal_power_entity">${this._entityOptions("power", area.thermal_power_entity)}</select>`)}${this._field("Thermischer Energiezähler Gesamtstand", `<select data-area-id="${this._esc(area.id)}" data-area-field="thermal_energy_entity">${this._entityOptions("energy", area.thermal_energy_entity)}</select>`)}</div>`;
    return `
      <div class="inspector-head"><span>${isHouse ? "ROOT / HOUSE" : area.mode === "calculated" ? "C / CALCULATED" : "M / MEASURED"}</span><button class="danger" data-action="remove-area" data-area-id="${this._esc(area.id)}" ${isHouse || (d.areas || []).length <= 1 ? "disabled" : ""}>REMOVE</button></div>
      ${this._field("Bereichsname", `<input data-area-id="${this._esc(area.id)}" data-area-field="name" value="${this._esc(area.name)}">`)}
      ${!isHouse ? (() => { const hierarchyParent = area.parent_id && area.parent_id !== "house" ? this._areaById(area.parent_id, d) : null; return hierarchyParent ? `<div class="root-note child-floor-note">STOCKWERK WIRD VOM PARENT <strong>${this._esc(hierarchyParent.name)}</strong> ÜBERNOMMEN · ${this._esc(this._levelById(hierarchyParent.level_id, d)?.name || "—")}</div>` : this._field("Stockwerk", `<select data-area-id="${this._esc(area.id)}" data-area-field="level_id">${levelOptions}</select><div class="custom-floor-add"><input data-custom-floor-name="${this._esc(area.id)}" placeholder="Eigenes Stockwerk, z. B. Galerie"><button type="button" data-action="assign-custom-floor" data-area-id="${this._esc(area.id)}">HINZUFÜGEN</button></div>`); })() : `<div class="root-note">HAUS IST STOCKWERKÜBERGREIFEND UND IMMER ÜBER DIE VOLLE BREITE ANGEORDNET.</div>`}
      ${this._renderHierarchyEditor(area, d)}
      ${this._field("Datentyp", `<select data-area-id="${this._esc(area.id)}" data-area-field="mode"><option value="measured" ${area.mode !== "calculated" ? "selected" : ""}>Gemessen</option><option value="calculated" ${area.mode === "calculated" ? "selected" : ""}>Berechnet</option></select>`)}
      ${calculation}
      ${!isHouse ? `<div class="inspector-section"><div class="inspector-label">LAYOUT / ${this._layoutMode(area).toUpperCase()}</div><div class="layout-mode-status"><span>${this._layoutMode(area) === "docked" ? "MAGNETISCH ANGEDOCKT" : "FREI POSITIONIERT"}</span><strong>${this._layoutMode(area) === "docked" ? `REIHENFOLGE ${Number(area.dock_order || 0) + 1}` : `X ${layout.x} · Y ${layout.y}`}</strong></div><div class="layout-position compact-size">
        ${["w", "h"].map((key) => `<label><span>${key === "w" ? "BREITE" : "HÖHE"}</span><select data-area-id="${this._esc(area.id)}" data-layout-field="${key}">${Array.from({ length: key === "w" ? 6 : 4 }, (_, index) => index + 1).map((value) => `<option value="${value}" ${Number(layout[key] || 1) === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>`).join("")}
      </div><button class="small-action" type="button" data-action="toggle-layout-mode" data-area-id="${this._esc(area.id)}">${this._layoutMode(area) === "docked" ? "KACHEL FREI LÖSEN" : "KACHEL ANDOCKEN"}</button></div>` : ""}`;
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
      if (this._tab === "config") {
        this._draft = this._clone(this._config);
        this._syncLayoutState(this._draft);
      }
      this._render();
      return;
    }

    if (action === "set-view-level") {
      this._viewLevelId = button.dataset.levelId;
      this._render();
      return;
    }

    if (!this._draft) this._draft = this._clone(this._config);

    if (action === "assign-custom-floor") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      const input = this.shadowRoot.querySelector(`[data-custom-floor-name="${CSS.escape(button.dataset.areaId)}"]`);
      const name = String(input?.value || "").trim();
      if (area && name) {
        const floor = this._ensureFloor(name, this._draft);
        if (floor) {
          this._moveBranchToLevel(area, floor.id, this._draft);
          area.dock_order = this._visualRootAreas(floor.id, this._draft).filter((item) => item.id !== area.id).length;
          this._normalizeDockOrder(floor.id, this._draft);
          this._layoutLevelId = floor.id;
        }
      }
      this._render();
      return;
    }
    if (action === "toggle-layout-mode") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      if (area && area.id !== "house") {
        if (this._layoutMode(area) === "docked") {
          const effective = this._effectiveLayout(area, this._draft);
          area.layout = { ...effective };
          area.layout_mode = "free";
          this._normalizeDockOrder(area.level_id, this._draft);
        } else {
          area.layout_mode = "docked";
          area.dock_order = this._dockedAreas(area.level_id, this._draft, area.id).length;
          this._normalizeDockOrder(area.level_id, this._draft);
        }
      }
      this._render();
      return;
    }

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
      this._draft.heating.push({ id: this._id("heat"), type: "heatpump", name: "Wärmepumpe", target: "buffer", status_entity: "", power_entity: "", energy_entity: "", thermal_power_entity: "", thermal_energy_entity: "", supply_entity: "", return_entity: "", temperature_entity: "" });
      this._render();
      return;
    }
    if (action === "add-area") {
      const selected = this._areaById(this._selectedAreaId, this._draft);
      const selectedLevel = selected && selected.id !== "house" ? this._levelById(selected.level_id, this._draft) : null;
      const defaultLevel = selectedLevel || this._ensureFloor("EG", this._draft) || this._draft.levels?.[0];
      const levelId = defaultLevel?.id;
      const layout = { x: 1, y: 1, w: 3, h: 2 };
      const area = { id: this._id("area"), name: "Neuer Bereich", level_id: levelId, parent_id: "house", mode: "measured", power_entity: "", energy_entity: "", thermal_power_entity: "", thermal_energy_entity: "", calculation_type: "difference", basis_area_id: "", source_area_ids: [], terms: [], power_terms: [], energy_terms: [], thermal_power_terms: [], thermal_energy_terms: [], layout, layout_mode: "docked", dock_order: this._visualRootAreas(levelId, this._draft).length };
      this._draft.areas.push(area);
      this._layoutLevelId = levelId;
      this._selectedAreaId = area.id;
      this._render();
      return;
    }
    if (action === "add-level") {
      const level = { id: this._id("level"), name: "Neue Ebene", order: this._draft.levels.length };
      this._draft.levels.push(level);
      this._layoutLevelId = level.id;
      this._selectedAreaId = null;
      this._render();
      return;
    }
    if (action === "set-layout-level") {
      this._layoutLevelId = button.dataset.levelId;
      this._selectedAreaId = this._draft.areas.find((area) => area.level_id === this._layoutLevelId)?.id || null;
      this._render();
      return;
    }
    if (action === "select-area") {
      this._selectedAreaId = button.dataset.areaId;
      this._render();
      return;
    }
    if (action === "move-level") {
      const levels = this._sortedLevels(this._draft);
      const index = levels.findIndex((level) => level.id === button.dataset.levelId);
      const next = index + Number(button.dataset.direction || 0);
      if (index >= 0 && next >= 0 && next < levels.length) {
        [levels[index].order, levels[next].order] = [levels[next].order, levels[index].order];
        this._draft.levels = levels.sort((a, b) => Number(a.order) - Number(b.order));
      }
      this._render();
      return;
    }
    if (action === "remove-level") {
      if (this._draft.levels.length <= 1) return;
      const levelId = button.dataset.levelId;
      const fallback = this._draft.levels.find((level) => level.id !== levelId);
      this._draft.areas.forEach((area) => { if (area.level_id === levelId) area.level_id = fallback.id; });
      this._draft.levels = this._draft.levels.filter((level) => level.id !== levelId);
      this._layoutLevelId = fallback.id;
      this._syncLayoutState(this._draft);
      this._render();
      return;
    }
    if (action === "open-child") {
      const select = this.shadowRoot.querySelector(`[data-child-open-select="${CSS.escape(button.dataset.areaId)}"]`);
      const child = this._areaById(select?.value, this._draft);
      if (child) this._selectedAreaId = child.id;
      this._render();
      return;
    }
    if (action === "add-child") {
      const parent = this._areaById(button.dataset.areaId, this._draft);
      if (!parent) return;
      const level = parent.id === "house" ? (this._ensureFloor("EG", this._draft) || this._draft.levels?.[0]) : this._levelById(parent.level_id, this._draft);
      const levelId = level?.id || this._draft.levels?.[0]?.id;
      const area = { id: this._id("area"), name: "Neuer Unterbereich", level_id: levelId, parent_id: parent.id, mode: "measured", power_entity: "", energy_entity: "", thermal_power_entity: "", thermal_energy_entity: "", calculation_type: "difference", basis_area_id: "", source_area_ids: [], terms: [], power_terms: [], energy_terms: [], thermal_power_terms: [], thermal_energy_terms: [], layout: { x: 1, y: 1, w: 2, h: 1 }, layout_mode: "docked", dock_order: this._sameLevelChildren(parent.id, levelId, this._draft).length };
      this._draft.areas.push(area);
      this._selectedAreaId = area.id;
      this._layoutLevelId = levelId;
      this._saveNotice = "";
      this._render();
      return;
    }
    if (action === "assign-child") {
      const parent = this._areaById(button.dataset.areaId, this._draft);
      const select = this.shadowRoot.querySelector(`[data-child-parent-select="${CSS.escape(button.dataset.areaId)}"]`);
      const child = this._areaById(select?.value, this._draft);
      if (parent && child && child.id !== parent.id && !this._isHierarchyDescendant(parent.id, child.id, this._draft)) {
        child.parent_id = parent.id;
        if (parent.id !== "house") this._moveBranchToLevel(child, parent.level_id, this._draft);
        child.layout_mode = "docked";
        child.dock_order = this._sameLevelChildren(parent.id, child.level_id, this._draft).filter((item) => item.id !== child.id).length;
        this._normalizeDockOrder(child.level_id, this._draft);
        this._saveNotice = "";
      }
      this._render();
      return;
    }
    if (action === "add-measure-term") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      const key = this._termKey(button.dataset.kind);
      if (area) {
        if (!Array.isArray(area[key])) area[key] = [];
        area[key].push({ op: "+", source_type: "area", source_id: "" });
        this._saveNotice = "";
      }
      this._render();
      return;
    }
    if (action === "remove-measure-term") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      const key = this._termKey(button.dataset.kind);
      if (area && Array.isArray(area[key])) area[key].splice(Number(button.dataset.index), 1);
      this._saveNotice = "";
      this._render();
      return;
    }
    if (action === "add-source") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      if (area) area.source_area_ids.push("");
      this._render();
      return;
    }
    if (action === "remove-source") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      if (area) area.source_area_ids.splice(Number(button.dataset.index), 1);
      this._render();
      return;
    }
    if (action === "add-term") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      if (area) area.terms.push({ op: "+", area_id: "" });
      this._render();
      return;
    }
    if (action === "remove-term") {
      const area = this._areaById(button.dataset.areaId, this._draft);
      if (area) area.terms.splice(Number(button.dataset.index), 1);
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
      const areaId = button.dataset.areaId;
      const area = this._areaById(areaId, this._draft);
      if (!area || area.id === "house" || this._draft.areas.length <= 1) return;
      for (const candidate of this._draft.areas) {
        if (candidate.parent_id === areaId) candidate.parent_id = area.parent_id || "house";
        if (candidate.basis_area_id === areaId) candidate.basis_area_id = "";
        candidate.source_area_ids = (candidate.source_area_ids || []).filter((id) => id !== areaId);
        candidate.terms = (candidate.terms || []).filter((term) => term.area_id !== areaId);
        candidate.power_terms = (candidate.power_terms || []).filter((term) => !(term.source_type === "area" && term.source_id === areaId));
        candidate.energy_terms = (candidate.energy_terms || []).filter((term) => !(term.source_type === "area" && term.source_id === areaId));
        candidate.thermal_power_terms = (candidate.thermal_power_terms || []).filter((term) => !(term.source_type === "area" && term.source_id === areaId));
        candidate.thermal_energy_terms = (candidate.thermal_energy_terms || []).filter((term) => !(term.source_type === "area" && term.source_id === areaId));
      }
      this._draft.areas = this._draft.areas.filter((candidate) => candidate.id !== areaId);
      this._selectedAreaId = this._draft.areas.find((candidate) => candidate.level_id === this._layoutLevelId)?.id || this._draft.areas[0]?.id || null;
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
    this._saveNotice = "";

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
      this._draft[group][index][field] = target.type === "checkbox" ? target.checked : target.value;
      return;
    }

    if (target.dataset.levelId && target.dataset.levelField) {
      const level = this._levelById(target.dataset.levelId, this._draft);
      if (level) level[target.dataset.levelField] = target.value;
      this._render();
      return;
    }

    if (target.dataset.areaId) {
      const area = this._areaById(target.dataset.areaId, this._draft);
      if (!area) return;
      if (target.dataset.layoutField) {
        const desired = { ...area.layout, [target.dataset.layoutField]: Number(target.value) };
        area.layout = this._layoutMode(area) === "free" ? this._findFreeLayout(area, desired, this._draft) : this._clampLayout(desired);
        this._render();
        return;
      }
      if (target.dataset.calcIndex !== undefined) {
        const key = this._termKey(target.dataset.calcKind);
        const term = area[key]?.[Number(target.dataset.calcIndex)];
        if (!term) return;
        if (target.dataset.calcField === "op") term.op = target.value === "-" ? "-" : "+";
        if (target.dataset.calcField === "source") Object.assign(term, this._parseMeasureSource(target.value));
        this._saveNotice = "";
        this._render();
        if (target.dataset.calcKind?.includes("energy") && target.dataset.calcField === "source") this._refreshDailyEnergy(this._draft);
        return;
      }
      if (target.dataset.areaSourceIndex !== undefined) {
        area.source_area_ids[Number(target.dataset.areaSourceIndex)] = target.value;
        this._render();
        return;
      }
      if (target.dataset.termIndex !== undefined) {
        const term = area.terms[Number(target.dataset.termIndex)];
        if (term) term[target.dataset.termField] = target.value;
        this._render();
        return;
      }
      if (target.dataset.areaField) {
        let nextValue = target.value;
        if (target.dataset.areaField === "level_id" && area.id !== "house" && nextValue.startsWith("__floor__:")) {
          const floorName = nextValue.slice("__floor__:".length);
          const floor = this._ensureFloor(floorName, this._draft);
          nextValue = floor?.id || area.level_id;
        }
        if (target.dataset.areaField === "parent_id" && nextValue && this._isHierarchyDescendant(nextValue, area.id, this._draft)) return;
        area[target.dataset.areaField] = nextValue;
        if (target.dataset.areaField === "parent_id" && nextValue && nextValue !== "house") {
          const parent = this._areaById(nextValue, this._draft);
          if (parent) {
            this._moveBranchToLevel(area, parent.level_id, this._draft);
            area.layout_mode = "docked";
            area.dock_order = this._sameLevelChildren(parent.id, parent.level_id, this._draft).filter((item) => item.id !== area.id).length;
            this._layoutLevelId = parent.level_id;
            this._normalizeDockOrder(parent.level_id, this._draft);
          }
        }
        if (target.dataset.areaField === "mode" && nextValue === "calculated") {
          if (!Array.isArray(area.power_terms)) area.power_terms = [];
          if (!Array.isArray(area.energy_terms)) area.energy_terms = [];
          if (!Array.isArray(area.thermal_power_terms)) area.thermal_power_terms = [];
          if (!Array.isArray(area.thermal_energy_terms)) area.thermal_energy_terms = [];
        }
        this._saveNotice = "";
        if (target.dataset.areaField === "level_id" && area.id !== "house") {
          this._moveBranchToLevel(area, nextValue, this._draft);
          this._layoutLevelId = nextValue;
          area.layout_mode = "docked";
          if (this._isVisualRoot(area, this._draft)) area.dock_order = this._visualRootAreas(nextValue, this._draft).filter((item) => item.id !== area.id).length;
          this._normalizeDockOrder(nextValue, this._draft);
        }
        if (["mode", "calculation_type", "level_id", "name", "basis_area_id", "parent_id"].includes(target.dataset.areaField)) this._render();
      }
    }
  }

  _onDragStart(event) {
    const tile = event.target.closest("[data-drag-area]");
    if (!tile) return;
    this._dragAreaId = tile.dataset.dragArea;
    const area = this._areaById(this._dragAreaId, this._draft);
    this._dragOrigin = area ? { level_id: area.level_id, layout_mode: this._layoutMode(area), dock_order: area.dock_order } : null;
    event.dataTransfer?.setData("text/plain", this._dragAreaId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  _onDragOver(event) {
    if (event.target.closest("[data-layout-grid]") || event.target.closest("[data-child-drop-parent]")) event.preventDefault();
  }

  _onDrop(event) {
    if (!this._draft) return;
    const childContainer = event.target.closest("[data-child-drop-parent]");
    const grid = event.target.closest("[data-layout-grid]");
    if (!childContainer && !grid) return;
    event.preventDefault();
    const areaId = event.dataTransfer?.getData("text/plain") || this._dragAreaId;
    const area = this._areaById(areaId, this._draft);
    if (!area || area.id === "house") return;
    const oldLevelId = area.level_id;

    if (childContainer) {
      const parent = this._areaById(childContainer.dataset.childDropParent, this._draft);
      if (parent && parent.id !== area.id && !this._isHierarchyDescendant(parent.id, area.id, this._draft)) {
        area.parent_id = parent.id;
        this._moveBranchToLevel(area, parent.level_id, this._draft);
        area.layout_mode = "docked";
        const siblings = this._sameLevelChildren(parent.id, parent.level_id, this._draft).filter((item) => item.id !== area.id);
        const groups = [...childContainer.querySelectorAll(":scope > [data-area-group]")].filter((item) => item.dataset.areaGroup !== area.id);
        let insertion = siblings.length;
        for (let index = 0; index < groups.length; index += 1) {
          const rect = groups[index].getBoundingClientRect();
          if (event.clientY < rect.top + rect.height / 2 || (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2)) {
            insertion = index;
            break;
          }
        }
        siblings.splice(insertion, 0, area);
        siblings.forEach((item, index) => { item.dock_order = index; });
        this._normalizeDockOrder(parent.level_id, this._draft);
      }
    } else if (grid) {
      const rect = grid.getBoundingClientRect();
      const column = Math.max(1, Math.min(12, Math.floor(((event.clientX - rect.left) / rect.width) * 12) + 1));
      const rows = Math.max(2, Number(getComputedStyle(grid).getPropertyValue("--rows")) || this._levelRows(this._levelById(grid.dataset.levelId, this._draft), this._draft));
      const row = Math.max(1, Math.min(rows + 4, Math.floor(((event.clientY - rect.top) / Math.max(rect.height, 1)) * rows) + 1));
      const levelId = grid.dataset.levelId;
      if (this._shouldDock(levelId, column, row, this._draft, area.id)) {
        this._dockAt(area, levelId, column, row, this._draft);
      } else if (this._isVisualRoot(area, this._draft)) {
        const size = this._clampLayout(area.layout);
        area.level_id = levelId;
        area.layout_mode = "free";
        area.layout = this._findFreeLayout(area, {
          ...size,
          x: Math.max(1, column - Math.floor(size.w / 2)),
          y: Math.max(1, row - Math.floor(size.h / 2)),
        }, this._draft);
        this._normalizeDockOrder(levelId, this._draft);
      }
    }
    if (oldLevelId && oldLevelId !== area.level_id) this._normalizeDockOrder(oldLevelId, this._draft);
    this._layoutLevelId = area.level_id;
    this._selectedAreaId = area.id;
    this._dragAreaId = null;
    this._dragOrigin = null;
    this._render();
  }

  async _saveConfig() {
    if (!this._hass || this._saving) return;
    this._saving = true;
    this._saveNotice = "";
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "energy_system_dashboard/save_config",
        config: this._draft,
      });
      this._config = result.config;
      this._draft = this._clone(result.config);
      this._syncLayoutState(this._draft);
      this._saveNotice = "GESPEICHERT";
      await this._refreshDailyEnergy();
      this._saving = false;
      this._render();
    } catch (error) {
      this._saving = false;
      this._renderError(`Konfiguration konnte nicht gespeichert werden: ${error?.message || error}`);
      return;
    }
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
        .node-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:0; align-items:stretch; }
        .system-grid { max-width:1500px; margin:0 auto; display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:0; border-left:1px solid var(--line); border-top:1px solid var(--line); }
        .system-cell { min-width:0; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
        .system-cell.full-span { grid-column:1 / -1; }
        .system-cell > .node, .system-cell > .buffer, .system-cell > .empty { width:100%; height:100%; border:0; box-shadow:none; margin:0; }
        .module-board .empty { grid-column:1 / -1; }
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
        .flow-electric { --flow-color:var(--active); --flow-base:rgba(226,183,89,.34); }
        .flow-thermal { --flow-color:var(--thermal); --flow-base:rgba(93,159,198,.40); }
        .wire.vertical { width:2px; height:36px; margin:0 auto; position:relative; overflow:hidden; background:var(--flow-base,var(--line)); }
        .wire.active::after { content:""; position:absolute; inset:0; background:repeating-linear-gradient(to bottom,transparent 0 7px,var(--flow-color,var(--active)) 7px 13px,transparent 13px 22px); background-size:100% 44px; animation:flow-pattern-v 1.8s linear infinite; animation-delay:var(--flow-phase,0s); }
        @keyframes flow-pattern-v { from { background-position:0 0; } to { background-position:0 44px; } }
        @keyframes flow-pattern-h { from { background-position:0 0; } to { background-position:44px 0; } }
        @keyframes flow-pattern-h-left { from { background-position:44px 0; } to { background-position:0 0; } }
        .bus { max-width:1500px; margin:0 auto; height:46px; border-top:2px solid var(--line-strong); border-bottom:2px solid var(--line-strong); display:flex; align-items:center; justify-content:center; gap:18px; background:rgba(255,255,255,.018); font:700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; }
        .bus strong { color:var(--active); font-size:14px; }
        .thermal-grid { max-width:1500px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; }
        .thermal-source-bank { width:100%; }
        .section-label { max-width:1500px; margin:0 auto 10px; }
        .room-label { margin-top:30px; }
        .heating-nodes { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
        .buffer-board { border-color:var(--thermal); }
        .buffer-board .system-cell { border-color:var(--thermal); }
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

        .building-stack { max-width:1500px; margin:0 auto; display:flex; flex-direction:column; gap:0; }
        .editor-floor-stack { margin-top:12px; display:flex; flex-direction:column; gap:0; border-top:1px solid var(--line-strong); }
        .editor-floor-group { display:grid; grid-template-columns:58px minmax(0,1fr); min-width:0; border:1px solid var(--line-strong); border-top:0; background:var(--panel); }
        .overview-floor-group { display:grid; grid-template-columns:150px 62px minmax(0,1fr); min-width:0; border:1px solid var(--line); background:var(--panel); position:relative; }
        .overview-floor-group + .overview-floor-group { border-top:0; }
        .floor-flow-channel { min-width:0; position:relative; background:#0b0e11; border-right:1px solid var(--line); overflow:visible; }
        .floor-flow-channel .floor-channel-rail { left:18px; top:-1px; bottom:-1px; z-index:4; }
        .flow-floor-group.is-last-floor .floor-channel-rail { bottom:50%; }
        .floor-flow-channel .branch-segment { position:absolute; left:18px; right:-1px; top:50%; transform:translateY(-50%); z-index:4; }
        .floor-branch-load { position:absolute; right:10px; top:50%; transform:translateY(-50%); min-width:72px; padding:6px 8px; border:1px solid var(--line-strong); background:#0d1013; color:var(--active); text-align:right; font:800 10px/1 ui-monospace,monospace; letter-spacing:.02em; z-index:3; }
        .flow-thermal .floor-branch-load { color:var(--thermal); }
        .floor-indicator { min-width:0; border-right:1px solid var(--line-strong); background:#0d1013; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:10px 4px; position:relative; overflow:hidden; }
        .floor-indicator strong { writing-mode:vertical-rl; transform:rotate(180deg); color:var(--text); font:800 13px/1 ui-monospace, monospace; letter-spacing:.12em; white-space:nowrap; }
        .floor-indicator span { min-width:26px; min-height:26px; display:grid; place-items:center; border:1px solid var(--line); color:var(--active); font:800 9px/1 ui-monospace, monospace; }
        .floor-indicator .floor-load { min-width:0; min-height:0; border:0; color:var(--active); font-size:9px; white-space:nowrap; }
        .floor-indicator small { color:var(--muted); font:700 7px/1.15 ui-monospace,monospace; text-align:center; }
        .flow-thermal .floor-indicator .floor-load { color:var(--thermal); }
        .floor-layout-body { min-width:0; }
        .floor-layout-meta { min-height:38px; display:grid; grid-template-columns:90px 1fr auto; align-items:center; gap:12px; padding:0 12px; border-bottom:1px solid var(--line); background:rgba(255,255,255,.015); }
        .floor-layout-meta span, .floor-layout-meta em { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; font-style:normal; }
        .floor-layout-meta strong { font-size:11px; letter-spacing:.06em; }
        .view-level-toolbar { max-width:1500px; margin:12px auto 0; display:flex; align-items:center; gap:14px; min-height:42px; padding:6px 10px; border:1px solid var(--line); border-bottom:0; background:rgba(255,255,255,.015); }
        .view-level-toolbar > span { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; }
        .view-level-tabs { display:flex; gap:0; flex-wrap:wrap; }
        .view-level-tab { appearance:none; border:1px solid var(--line); margin-left:-1px; background:#101316; color:var(--muted); min-height:30px; padding:0 12px; font:700 9px/1 ui-monospace, monospace; letter-spacing:.06em; }
        .view-level-tab:first-child { margin-left:0; }
        .view-level-tab.active { color:var(--text); border-color:var(--line-strong); position:relative; z-index:1; background:rgba(255,255,255,.05); }
        .building-level { border:1px solid var(--line); background:var(--panel); min-width:0; }
        .level-head { min-height:42px; display:grid; grid-template-columns:90px 1fr auto; gap:12px; align-items:center; padding:0 14px; border-bottom:1px solid var(--line); }
        .level-head span, .level-head em { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; font-style:normal; }
        .level-head strong { font-size:12px; letter-spacing:.06em; }
        .level-grid { position:relative; display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); grid-template-rows:repeat(var(--rows),42px); gap:0; padding:0; min-height:calc(var(--rows) * 42px); background-image:linear-gradient(to right,rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.05) 1px,transparent 1px); background-size:calc(100% / 12) 100%,100% 42px; overflow:hidden; }
        .level-grid.layout-grid { grid-template-rows:repeat(var(--rows),48px); min-height:calc(var(--rows) * 48px); background-size:calc(100% / 12) 100%,100% 48px; }
        .area-group { min-width:0; min-height:0; display:flex; flex-direction:column; align-self:stretch; position:relative; z-index:1; overflow:visible; box-sizing:border-box; }
        .root-area-group { margin:0; }
        .nested-area-group { width:100%; min-height:auto; overflow:visible; }
        .root-area-group > .area-tile { flex:0 0 var(--root-tile-height,84px); min-height:var(--root-tile-height,84px); box-sizing:border-box; }
        .nested-area-group > .area-tile { flex:0 0 auto; min-height:58px; box-sizing:border-box; }
        .area-child-grid { position:relative; display:flex; flex-direction:column; gap:8px; padding:12px 12px 12px 32px; border:1px solid var(--line-strong); border-top:0; background:#0d1013; min-height:0; }
        .area-child-branch { position:relative; min-width:0; }
        .area-child-branch::before { content:""; position:absolute; left:-20px; top:-12px; width:20px; height:calc(50% + 12px); border-left:1px solid var(--line-strong); border-bottom:1px solid var(--line-strong); pointer-events:none; z-index:0; }
        .area-child-branch:not(:last-child)::after { content:""; position:absolute; left:-20px; top:50%; bottom:-8px; width:1px; background:var(--line-strong); pointer-events:none; z-index:0; }
        .nested-area-group > .area-child-grid { margin-top:0; padding:10px 10px 10px 28px; border-color:var(--line); }
        .nested-area-group > .area-child-grid .area-child-branch::before { left:-17px; width:17px; border-color:var(--line); }
        .nested-area-group > .area-child-grid .area-child-branch:not(:last-child)::after { left:-17px; background:var(--line); }
        .area-tile { appearance:none; border:1px solid var(--line-strong); background:#15191d; color:var(--text); min-width:0; padding:10px 12px; display:flex; flex-direction:column; text-align:left; overflow:hidden; position:relative; z-index:1; margin:0; }
        .root-area-group.has-children > .area-tile { border-bottom-color:var(--line-strong); }
        .nested-area-group > .area-tile { border:1px solid var(--line); }
        .house-tile { width:100%; min-height:96px; margin:0; border-color:var(--line-strong); display:block; }
        button.house-tile { cursor:pointer; }
        .house-values { display:grid; grid-template-columns:1fr 1fr 2fr; gap:0; margin-top:10px; border-top:1px solid var(--line); }
        .house-values > div { min-width:0; padding:10px 12px 2px 0; display:flex; flex-direction:column; gap:6px; }
        .house-values > div + div { padding-left:14px; border-left:1px solid var(--line); }
        .house-values span { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.08em; }
        .house-values strong { font:650 18px/1.15 ui-monospace, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .house-values > div:last-child strong { font-size:10px; line-height:1.35; color:var(--muted); }
        button.area-tile { cursor:grab; font:inherit; }
        button.area-tile:active { cursor:grabbing; }
        .area-tile.calculated { border-style:dashed; }
        .area-tile.selected { outline:2px solid var(--active); outline-offset:1px; }
        .area-tile-head { display:grid; grid-template-columns:22px 1fr; gap:8px; align-items:center; min-width:0; }
        .area-tile-head span { color:var(--active); font:800 10px/1 ui-monospace, monospace; }
        .area-tile.calculated .area-tile-head span { color:var(--thermal); }
        .area-tile-head strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; letter-spacing:.04em; }
        .area-tile-power { margin-top:auto; padding-top:8px; font:650 22px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:-.04em; }
        .area-tile-energy { display:flex; justify-content:space-between; gap:8px; margin-top:8px; padding-top:7px; border-top:1px dotted var(--line); font:650 9px/1 ui-monospace, monospace; }
        .area-tile-energy span { color:var(--muted); }
        .area-tile-formula { color:var(--muted); margin-top:7px; font:600 8px/1.25 ui-monospace, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .area-tile.hierarchy-parent { background:#181e23; box-shadow:inset 3px 0 0 rgba(105,190,255,.32); }
        .area-tile.hierarchy-parent .area-tile-head strong { font-size:12px; letter-spacing:.055em; }
        .area-tile.hierarchy-parent .area-tile-power { font-size:22px; }
        .area-tile.hierarchy-parent .area-tile-head { padding-right:92px; }
        .area-hierarchy-meta { position:absolute; top:10px; right:12px; display:flex; align-items:center; gap:6px; margin:0; padding:0; border:0; background:transparent; }
        .area-hierarchy-meta span { color:var(--muted); font:700 7px/1 ui-monospace,monospace; letter-spacing:.08em; }
        .area-hierarchy-meta strong { color:var(--active); font:750 7px/1 ui-monospace,monospace; letter-spacing:.04em; white-space:nowrap; }
        .area-tile.hierarchy-child { margin:0; background:#0f1316; border-color:var(--line); box-shadow:inset 2px 0 0 rgba(105,190,255,.22); z-index:2; min-height:58px; padding:7px 9px; }
        .area-tile.hierarchy-child.calculated { box-shadow:inset 2px 0 0 rgba(88,166,255,.42); }
        .area-tile.thermal-area { box-shadow:inset 3px 0 0 rgba(93,159,198,.34); }
        .area-tile.thermal-area .area-tile-head span, .area-tile.thermal-area .area-tile-power { color:var(--thermal); }
        .thermal-calculation { box-shadow:inset 3px 0 0 rgba(93,159,198,.26); }
        .area-tile.hierarchy-child .area-tile-head strong { font-size:10px; }
        .area-tile.hierarchy-child .area-tile-power { font-size:17px; padding-top:5px; }
        .area-tile.hierarchy-child .area-tile-energy { margin-top:5px; padding-top:5px; font-size:8px; }
        .area-tile.hierarchy-child .area-tile-formula { margin-top:5px; font-size:7px; }
        .area-parent-ref { color:var(--muted); margin-top:5px; font:650 8px/1 ui-monospace,monospace; letter-spacing:.04em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .area-tile.hierarchy-depth-2 { margin:0; box-shadow:inset 2px 0 0 rgba(105,190,255,.14); }
        .area-tile.hierarchy-depth-3 { margin:0; box-shadow:inset 2px 0 0 rgba(105,190,255,.10); }
        .layout-empty { grid-column:1 / -1; grid-row:1 / span 2; display:flex; align-items:center; justify-content:center; color:var(--muted); font:650 10px/1 ui-monospace, monospace; letter-spacing:.08em; }
        .layout-empty.standalone { min-height:120px; border:1px dashed var(--line); }
        .layout-config-card { overflow:hidden; }
        .level-toolbar { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:10px 0; border-bottom:0; background:rgba(255,255,255,.015); }
        .level-tabs { display:flex; gap:0; flex-wrap:wrap; }
        .level-tab, .level-tools button, .small-action { appearance:none; border:1px solid var(--line); background:#101316; color:var(--muted); min-height:32px; padding:0 11px; font:700 9px/1 ui-monospace, monospace; letter-spacing:.06em; }
        .level-tab + .level-tab { margin-left:-1px; }
        .level-tab.active { color:var(--text); border-color:var(--line-strong); background:rgba(255,255,255,.05); }
        .level-tab.add, .small-action { color:var(--active); }
        .level-tools { display:flex; gap:6px; align-items:center; }
        .level-tools input { width:150px; min-height:32px; border:1px solid var(--line); background:#101316; color:var(--text); padding:0 8px; font-size:11px; }
        .layout-editor { display:grid; grid-template-columns:minmax(0,2fr) minmax(330px,1fr); min-height:680px; }
        .layout-stage { min-width:0; padding:12px; border-right:1px solid var(--line); }
        .root-note { color:var(--muted); padding:12px 14px; border-bottom:1px solid var(--line); font:650 9px/1.5 ui-monospace, monospace; letter-spacing:.06em; }
        .layout-help { color:var(--muted); margin:0 0 10px; font:650 9px/1.4 ui-monospace, monospace; letter-spacing:.08em; }
        .layout-inspector { min-width:0; background:rgba(10,12,14,.45); }
        .inspector-head { min-height:44px; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:6px 12px; border-bottom:1px solid var(--line); }
        .inspector-head span, .inspector-label { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; }
        .inspector-section { padding:12px 14px; border-bottom:1px solid var(--line); }
        .inspector-label { margin-bottom:10px; }
        .calc-row { display:grid; grid-template-columns:1fr 34px; gap:6px; margin-bottom:6px; }
        .calc-row.custom, .calc-row.measure { grid-template-columns:56px minmax(0,1fr) 34px; }
        .calc-row select { min-width:0; min-height:36px; border:1px solid var(--line); background:#101316; color:var(--text); padding:0 8px; font-size:10px; }
        .small-action { width:100%; margin-top:4px; }
        .calc-preview { display:grid; grid-template-columns:1fr auto; gap:8px 12px; padding:14px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:rgba(255,255,255,.018); }
        .calc-preview span { color:var(--muted); font:700 9px/1 ui-monospace, monospace; letter-spacing:.1em; }
        .calc-preview strong { font:700 18px/1 ui-monospace, monospace; }
        .calc-preview em, .calc-preview small { grid-column:1 / -1; color:var(--muted); font:600 9px/1.4 ui-monospace, monospace; font-style:normal; overflow-wrap:anywhere; }
        .measure-preview { margin-top:8px; padding:10px; border:1px solid var(--line); display:grid; grid-template-columns:1fr auto; gap:7px 12px; background:rgba(255,255,255,.015); }
        .measure-preview span { color:var(--muted); font:700 9px/1 ui-monospace,monospace; letter-spacing:.08em; }
        .measure-preview strong { font:700 16px/1 ui-monospace,monospace; }
        .measure-preview small { grid-column:1 / -1; color:var(--muted); font:600 8px/1.4 ui-monospace,monospace; overflow-wrap:anywhere; }
        .hierarchy-section .field { padding:0 0 10px; border-bottom:0; }
        .hierarchy-subhead { min-height:28px; display:flex; align-items:center; justify-content:space-between; gap:8px; margin:2px 0 6px; color:var(--muted); font:700 8px/1 ui-monospace,monospace; letter-spacing:.1em; }
        .hierarchy-subhead strong { min-width:24px; min-height:24px; display:grid; place-items:center; border:1px solid var(--line); color:var(--active); font-size:9px; }
        .child-list { display:flex; flex-direction:column; gap:5px; margin-bottom:7px; }
        .child-list button { min-height:44px; border:1px solid var(--line); border-left:3px solid rgba(105,190,255,.28); background:#101316; color:var(--text); display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; gap:8px; padding:5px 9px; text-align:left; }
        .child-list button b { width:22px; height:22px; display:grid; place-items:center; border:1px solid var(--line); color:var(--active); font:800 9px/1 ui-monospace,monospace; }
        .child-list button span { min-width:0; display:flex; flex-direction:column; gap:4px; }
        .child-list button span strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:700 10px/1 ui-monospace,monospace; }
        .child-list button span small { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 8px/1 ui-monospace,monospace; }
        .child-list button em { color:var(--muted); font:700 8px/1 ui-monospace,monospace; font-style:normal; }
        .child-empty { color:var(--muted); border:1px dashed var(--line); padding:10px; font:650 9px/1 ui-monospace,monospace; text-align:center; }
        .child-open { margin:8px 0 4px; padding:8px; border:1px solid var(--line); background:rgba(255,255,255,.012); }
        .child-open > span, .child-assign-label { display:block; color:var(--muted); margin-bottom:6px; font:700 8px/1.2 ui-monospace,monospace; letter-spacing:.08em; }
        .child-open > div, .child-assign { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; }
        .child-open select, .child-open button, .child-assign select, .child-assign button { min-height:34px; border:1px solid var(--line); background:#101316; color:var(--text); padding:0 8px; font-size:10px; }
        .child-open button, .child-assign button { color:var(--active); font:700 9px/1 ui-monospace,monospace; letter-spacing:.06em; }
        .child-assign-label { margin-top:10px; }
        .layout-savebar { min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 14px; border-top:1px solid var(--line-strong); background:#0d1013; }
        .layout-savebar span { color:var(--muted); font:700 9px/1.4 ui-monospace,monospace; letter-spacing:.06em; }
        .layout-position { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; }
        .layout-position label { display:flex; flex-direction:column; gap:6px; }
        .layout-position label span { color:var(--muted); font:700 9px/1 ui-monospace, monospace; }
        .layout-position select { min-height:34px; border:1px solid var(--line); background:#101316; color:var(--text); padding:0 6px; }
        .system-zone { margin-top:14px; border:1px solid var(--line); background:rgba(255,255,255,.008); }
        .system-zone .module-board { border-left:0; border-right:0; }
        .split-label { display:flex; justify-content:space-between; align-items:center; min-height:42px; padding:0 12px; border-bottom:1px solid var(--line); }
        .split-label span { color:var(--muted); font:700 9px/1 ui-monospace,monospace; letter-spacing:.1em; }
        .split-label strong { font:700 12px/1 ui-monospace,monospace; }
        .conversion-band { margin:16px 0 0; min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 14px; border:1px solid var(--line-strong); border-left:3px solid var(--thermal); background:rgba(88,166,255,.045); }
        .conversion-band span { color:var(--muted); font:700 9px/1 ui-monospace,monospace; letter-spacing:.1em; }
        .conversion-band strong { color:var(--thermal); font:700 11px/1 ui-monospace,monospace; }
        .conversion-board { margin-top:0; }
        .building-zone .overview-building-stack { max-width:none; }
        .building-zone .overview-floor-group { border-left:0; border-right:0; }
        .building-zone .overview-floor-group + .overview-floor-group { border-top:0; }
        .overview-building-stack .house-tile { border-bottom:0; }
        .overview-floor-group { border-color:var(--line); }
        .distribution-flow-stack { position:relative; }
        .distribution-manifold { height:48px; position:relative; overflow:visible; background:#0b0e11; border:0; }
        .flow-segment { display:block; position:absolute; pointer-events:none; z-index:4; background-color:var(--flow-base,var(--line-strong)); overflow:hidden; }
        .flow-segment::after { content:""; position:absolute; inset:0; animation-duration:1.8s; animation-timing-function:linear; animation-iteration-count:infinite; animation-delay:var(--flow-phase,0s); }
        .flow-segment.vertical { width:2px; }
        .flow-segment.horizontal { height:2px; }
        .flow-segment.vertical::after { background:repeating-linear-gradient(to bottom,transparent 0 7px,var(--flow-color,var(--active)) 7px 13px,transparent 13px 22px); background-size:100% 44px; animation-name:flow-pattern-v; }
        .flow-segment.horizontal::after { background:repeating-linear-gradient(to right,transparent 0 7px,var(--flow-color,var(--active)) 7px 13px,transparent 13px 22px); background-size:44px 100%; animation-name:flow-pattern-h; }
        .flow-segment.horizontal.flow-left::after { animation-name:flow-pattern-h-left; }
        .manifold-drop { left:calc(50% - 1px); top:-1px; height:26px; }
        .manifold-run { left:19px; right:calc(50% - 1px); top:24px; }
        .manifold-rail-drop { left:19px; top:24px; bottom:-1px; }
        .floor-stack { position:relative; border-top:0; }
        .magnetic-grid { transition:min-height .18s ease; }
        .area-tile.layout-docked { border-style:solid; }
        .area-tile.layout-free { outline:1px dotted rgba(255,255,255,.18); outline-offset:-4px; }
        .custom-floor-add { display:grid; grid-template-columns:1fr auto; gap:6px; margin-top:7px; }
        .custom-floor-add input, .custom-floor-add button { min-height:34px; border:1px solid var(--line); background:#101316; color:var(--text); padding:0 8px; }
        .custom-floor-add button { color:var(--active); font:700 9px/1 ui-monospace,monospace; letter-spacing:.06em; cursor:pointer; }
        .layout-mode-status { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:9px; padding:9px 10px; border:1px solid var(--line); background:rgba(255,255,255,.015); }
        .layout-mode-status span { color:var(--muted); font:700 9px/1 ui-monospace,monospace; }
        .layout-mode-status strong { font:700 9px/1 ui-monospace,monospace; }
        .layout-position.compact-size { grid-template-columns:repeat(2,1fr); }
        .readonly-card { display:block; overflow:hidden; background:var(--ha-card-background,var(--card-background-color,#111417)); color:var(--primary-text-color,#eef2f4); }
        .readonly-card .card-content { padding:0 12px 14px; }
        .card-head { min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 16px; border-bottom:1px solid var(--line); }
        .card-head > div { display:flex; flex-direction:column; gap:5px; }
        .card-head span { color:var(--muted); font:700 8px/1 ui-monospace,monospace; letter-spacing:.12em; }
        .card-head strong { font-size:16px; letter-spacing:.04em; }
        .card-head em { display:flex; align-items:center; gap:7px; color:var(--muted); font:700 9px/1 ui-monospace,monospace; font-style:normal; }
        .card-head em i { width:7px; height:7px; border-radius:50%; background:var(--good); }
        .card-error { display:flex; flex-direction:column; gap:8px; padding:18px; }
        .card-error strong { color:var(--danger); }
        .card-error span { color:var(--secondary-text-color,var(--muted)); font-size:12px; }
        .readonly-card.hide-floor-selector .view-level-toolbar { display:none; }
        .readonly-card.hide-daily .daily-value { display:none !important; }
        .readonly-card.hide-status .status { visibility:hidden; }
        .readonly-card.display-compact .system-note, .readonly-card.display-compact .node-meta, .readonly-card.display-compact .area-tile-formula, .readonly-card.display-compact .floor-layout-meta span { display:none; }
        .readonly-card.display-compact .node { min-height:148px; }
        .readonly-card.display-compact .node-main { font-size:25px; }
        .readonly-card.display-compact .module-board { margin-top:8px; }
        .readonly-card.display-compact .system-zone { margin-top:8px; }
        .readonly-card.display-compact .buffer-row small { display:none; }
        .readonly-card.display-compact .level-grid.readonly { grid-template-rows:repeat(var(--rows),36px); background-size:calc(100% / 12) 100%,100% 36px; }
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
          .level-toolbar { align-items:stretch; flex-direction:column; }
          .level-tools { flex-wrap:wrap; }
          .layout-editor { grid-template-columns:1fr; }
          .layout-stage { border-right:0; border-bottom:1px solid var(--line); }
          .editor-floor-group { grid-template-columns:42px minmax(0,1fr); }
          .floor-indicator strong { font-size:10px; }
          .floor-layout-meta { grid-template-columns:1fr auto; }
          .floor-layout-meta span { display:none; }
          .level-grid.layout-grid { grid-template-rows:repeat(var(--rows),38px); min-height:calc(var(--rows) * 38px); background-size:calc(100% / 12) 100%,100% 38px; }
          .system-cell { grid-column:1 / -1 !important; }
          .house-values { grid-template-columns:1fr; }
          .house-values > div + div { border-left:0; border-top:1px solid var(--line); padding-left:0; }
        }
      </style>`;
  }
}

if (!customElements.get("energy-system-dashboard-panel")) {
  customElements.define("energy-system-dashboard-panel", EnergySystemDashboardPanel);
}
