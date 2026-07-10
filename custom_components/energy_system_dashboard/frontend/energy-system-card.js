const PANEL_MODULE_URL = "/energy_system_dashboard/energy-system-dashboard.js?v=0.5.9";
const VALID_VIEWS = ["system", "electrical", "thermal", "building"];
const VALID_DISPLAYS = ["full", "compact"];

class EnergySystemCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._panel = null;
    this._loading = null;
  }

  static getStubConfig() {
    return {
      view: "system",
      display: "full",
      floor_selector: true,
      show_daily_energy: true,
      show_status: true,
      expand_children: false,
    };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: "view",
          required: true,
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "system", label: "Gesamtsystem" },
                { value: "electrical", label: "Elektrisch" },
                { value: "thermal", label: "Thermisch" },
                { value: "building", label: "Gebäude" },
              ],
            },
          },
        },
        {
          name: "display",
          required: true,
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "full", label: "Vollständig" },
                { value: "compact", label: "Kompakt" },
              ],
            },
          },
        },
        { name: "title", selector: { text: {} } },
        { name: "floor_selector", selector: { boolean: {} } },
        { name: "default_floor", selector: { text: {} } },
        { name: "show_daily_energy", selector: { boolean: {} } },
        { name: "show_status", selector: { boolean: {} } },
        { name: "expand_children", selector: { boolean: {} } },
      ],
      computeLabel: (schema) => ({
        view: "Ansicht",
        display: "Darstellung",
        title: "Eigener Titel",
        floor_selector: "Stockwerksauswahl anzeigen",
        default_floor: "Standard-Stockwerk",
        show_daily_energy: "Energie heute anzeigen",
        show_status: "Statuswerte anzeigen",
        expand_children: "Unterbereiche standardmäßig aufklappen",
      }[schema.name]),
      computeHelper: (schema) => ({
        view: "Wählt die read-only Ansicht der zentral konfigurierten Energy-System-Topologie.",
        display: "Full zeigt alle Details; Compact reduziert nur die optische Dichte.",
        title: "Optional. Leer = Name aus der Energy-System-Konfiguration.",
        floor_selector: "Erlaubt das Umschalten des Stockwerks direkt in der Karte. Die Konfiguration wird nicht verändert.",
        default_floor: "Optional. Muss exakt einem konfigurierten Stockwerksnamen entsprechen, z. B. EG oder Galerie.",
        show_daily_energy: "Blendet die aus Recorder-Statistiken berechnete Energie des aktuellen Tages ein oder aus.",
        show_status: "Blendet Statuskennzeichnungen wie HEATING, IMPORT oder IDLE ein oder aus.",
        expand_children: "true zeigt alle Parent/Child-Details direkt; false startet platzsparend eingeklappt. Ein Klick auf einen Parent klappt lokal auf.",
      }[schema.name]),
      assertConfig: (config) => {
        if (config.view !== undefined && !VALID_VIEWS.includes(config.view)) {
          throw new Error(`Ungültige Ansicht "${config.view}". Erlaubt: ${VALID_VIEWS.join(", ")}.`);
        }
        if (config.display !== undefined && !VALID_DISPLAYS.includes(config.display)) {
          throw new Error(`Ungültige Darstellung "${config.display}". Erlaubt: ${VALID_DISPLAYS.join(", ")}.`);
        }
      },
    };
  }

  setConfig(config) {
    const next = {
      view: config?.view || "system",
      display: config?.display || "full",
      title: config?.title || "",
      floor_selector: config?.floor_selector !== false,
      default_floor: config?.default_floor || "",
      show_daily_energy: config?.show_daily_energy !== false,
      show_status: config?.show_status !== false,
      expand_children: config?.expand_children === true,
    };
    if (!VALID_VIEWS.includes(next.view)) {
      throw new Error(`Ungültige Ansicht "${next.view}". Erlaubt: ${VALID_VIEWS.join(", ")}.`);
    }
    if (!VALID_DISPLAYS.includes(next.display)) {
      throw new Error(`Ungültige Darstellung "${next.display}". Erlaubt: ${VALID_DISPLAYS.join(", ")}.`);
    }
    this._config = next;
    this._syncPanel();
  }

  set hass(value) {
    this._hass = value;
    this._syncPanel();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._syncPanel();
  }

  disconnectedCallback() {
    this._panel?.remove();
    this._panel = null;
  }

  getCardSize() {
    if (this._config?.display === "compact") return 8;
    if (this._config?.view === "building") return 8;
    return 12;
  }

  getGridOptions() {
    return {
      columns: "full",
      min_columns: 6,
    };
  }

  async _ensurePanelClass() {
    if (customElements.get("energy-system-dashboard-panel")) return;
    if (!this._loading) this._loading = import(PANEL_MODULE_URL);
    await this._loading;
  }

  async _syncPanel() {
    if (!this.isConnected || !this._config || !this._hass) return;
    try {
      await this._ensurePanelClass();
      if (!this._panel) {
        this._panel = document.createElement("energy-system-dashboard-panel");
        this._panel.style.display = "block";
        this._panel.style.width = "100%";
        this.shadowRoot.replaceChildren(this._panel);
      }
      this._panel.cardConfig = this._config;
      this._panel.hass = this._hass;
    } catch (error) {
      const box = document.createElement("ha-card");
      box.innerHTML = `<div style="padding:16px"><strong>Energy System Card konnte nicht geladen werden.</strong><br><small>${String(error?.message || error)}</small></div>`;
      this.shadowRoot.replaceChildren(box);
    }
  }
}

if (!customElements.get("energy-system-card")) {
  customElements.define("energy-system-card", EnergySystemCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "energy-system-card")) {
  window.customCards.push({
    type: "energy-system-card",
    name: "Energy System",
    preview: false,
    description: "Read-only Ansicht des modularen Energy System Dashboard.",
  });
}
