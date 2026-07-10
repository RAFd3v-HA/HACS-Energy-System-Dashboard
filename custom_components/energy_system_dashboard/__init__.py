"""Energy System Dashboard integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .calculation import CalculationManager
from .const import (
    DATA_MANAGER,
    DATA_PANEL_REGISTERED,
    DATA_STORE,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    STATIC_URL,
    STORAGE_KEY,
    STORAGE_VERSION,
)

DEFAULT_LEVEL_ID = "level_0"

DEFAULT_CONFIG: dict[str, Any] = {
    "version": 13,
    "name": "ENERGY SYSTEM",
    "grid": {
        "enabled": False,
        "name": "Netz",
        "power_entity": "",
        "import_energy_entity": "",
        "export_energy_entity": "",
        "direction": "import_positive",
    },
    "generation": [],
    "calculations": [],
    "storage": [],
    "heating": [],
    "buffer": {
        "enabled": False,
        "name": "Pufferspeicher",
        "temperature_entities": [],
    },
    "levels": [
        {"id": DEFAULT_LEVEL_ID, "name": "Gebäude", "order": 0},
    ],
    "areas": [
        {
            "id": "house",
            "name": "Haus",
            "level_id": DEFAULT_LEVEL_ID,
            "parent_id": "",
            "mode": "measured",
            "power_entity": "",
            "energy_entity": "",
            "thermal_power_entity": "",
            "thermal_energy_entity": "",
            "power_source_type": "",
            "power_source_id": "",
            "energy_source_type": "",
            "energy_source_id": "",
            "thermal_power_source_type": "",
            "thermal_power_source_id": "",
            "thermal_energy_source_type": "",
            "thermal_energy_source_id": "",
            "calculation_type": "difference",
            "basis_area_id": "",
            "source_area_ids": [],
            "terms": [],
            "power_terms": [],
            "energy_terms": [],
            "thermal_power_terms": [],
            "thermal_energy_terms": [],
            "layout": {"x": 1, "y": 1, "w": 12, "h": 2},
            "layout_mode": "docked",
            "dock_order": 0,
        }
    ],
}


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the integration domain and websocket API."""
    hass.data.setdefault(DOMAIN, {})
    store: Store[dict[str, Any]] = Store(
        hass,
        STORAGE_VERSION,
        STORAGE_KEY,
        atomic_writes=True,
    )
    hass.data[DOMAIN][DATA_STORE] = store

    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_config)
    websocket_api.async_register_command(hass, websocket_subscribe_calculations)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the dashboard panel and calculation sensors."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    store: Store[dict[str, Any]] = domain_data[DATA_STORE]
    stored = await store.async_load()
    config = _normalize_config(stored or DEFAULT_CONFIG)

    manager = CalculationManager(hass)
    domain_data[DATA_MANAGER] = manager
    await manager.async_start(config)
    await hass.config_entries.async_forward_entry_setups(entry, ["sensor"])

    if not domain_data.get(DATA_PANEL_REGISTERED):
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(frontend_dir), False)]
        )

        async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path=PANEL_URL,
            config={
                "_panel_custom": {
                    "name": PANEL_ELEMENT,
                    "embed_iframe": False,
                    "trust_external": False,
                    "js_url": f"{STATIC_URL}/energy-system-dashboard-v074.js?v=0.7.4",
                }
            },
            require_admin=False,
        )
        domain_data[DATA_PANEL_REGISTERED] = True

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the dashboard panel and calculation platform."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["sensor"])
    domain_data = hass.data.get(DOMAIN, {})
    manager: CalculationManager | None = domain_data.get(DATA_MANAGER)
    if manager is not None:
        await manager.async_stop()
        domain_data.pop(DATA_MANAGER, None)
    if domain_data.get(DATA_PANEL_REGISTERED):
        async_remove_panel(hass, PANEL_URL)
        domain_data[DATA_PANEL_REGISTERED] = False
    return unload_ok


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_config"})
@websocket_api.async_response
async def websocket_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the persisted dashboard configuration."""
    manager: CalculationManager | None = hass.data[DOMAIN].get(DATA_MANAGER)
    if manager is not None and manager.config:
        connection.send_result(msg["id"], manager.config)
        return
    store: Store[dict[str, Any]] = hass.data[DOMAIN][DATA_STORE]
    data = await store.async_load()
    connection.send_result(msg["id"], _normalize_config(data or DEFAULT_CONFIG))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_config",
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def websocket_save_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist dashboard configuration."""
    config = _normalize_config(msg["config"])
    store: Store[dict[str, Any]] = hass.data[DOMAIN][DATA_STORE]
    await store.async_save(config)
    manager: CalculationManager | None = hass.data[DOMAIN].get(DATA_MANAGER)
    if manager is not None:
        await manager.async_apply_config(config)
    connection.send_result(msg["id"], {"saved": True, "config": config})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe_calculations"})
@websocket_api.async_response
async def websocket_subscribe_calculations(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Subscribe a frontend client to calculated values."""
    manager: CalculationManager = hass.data[DOMAIN][DATA_MANAGER]

    @callback
    def send_snapshot() -> None:
        connection.send_event(msg["id"], manager.snapshot())

    connection.subscriptions[msg["id"]] = manager.async_add_value_listener(send_snapshot)
    connection.send_result(msg["id"])
    send_snapshot()


def _safe_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _normalize_measure_terms(raw_terms: Any) -> list[dict[str, str]]:
    """Normalize calculation terms that reference an area, calculation, or HA entity."""
    if not isinstance(raw_terms, list):
        return []
    result: list[dict[str, str]] = []
    for raw_term in raw_terms:
        if not isinstance(raw_term, dict):
            continue
        source_type = str(raw_term.get("source_type") or "area")
        if source_type not in {"area", "entity", "calculation"}:
            source_type = "area"
        source_id = str(raw_term.get("source_id") or raw_term.get("area_id") or "")
        if not source_id:
            continue
        result.append(
            {
                "op": "-" if str(raw_term.get("op")) == "-" else "+",
                "source_type": source_type,
                "source_id": source_id,
            }
        )
    return result


def _legacy_measure_terms(
    calculation_type: str,
    basis_area_id: str,
    source_area_ids: list[str],
    terms: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Migrate the pre-0.3.1 area calculation editor to explicit measure terms."""
    if calculation_type == "difference":
        result: list[dict[str, str]] = []
        if basis_area_id:
            result.append({"op": "+", "source_type": "area", "source_id": basis_area_id})
        result.extend(
            {"op": "-", "source_type": "area", "source_id": area_id}
            for area_id in source_area_ids
            if area_id
        )
        return result
    if calculation_type == "sum":
        return [
            {"op": "+", "source_type": "area", "source_id": area_id}
            for area_id in source_area_ids
            if area_id
        ]
    return [
        {
            "op": "-" if str(term.get("op")) == "-" else "+",
            "source_type": "area",
            "source_id": str(term.get("area_id") or ""),
        }
        for term in terms
        if term.get("area_id")
    ]


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    """Normalize stored config and reject invalid calculation cycles."""
    normalized = dict(DEFAULT_CONFIG)
    normalized.update(config if isinstance(config, dict) else {})
    normalized["version"] = 13

    for key in ("generation", "storage", "heating", "calculations", "areas", "levels"):
        if not isinstance(normalized.get(key), list):
            normalized[key] = []

    raw_grid = normalized.get("grid")
    normalized["grid"] = {
        **DEFAULT_CONFIG["grid"],
        **(raw_grid if isinstance(raw_grid, dict) else {}),
    }
    raw_buffer = normalized.get("buffer")
    normalized["buffer"] = {
        **DEFAULT_CONFIG["buffer"],
        **(raw_buffer if isinstance(raw_buffer, dict) else {}),
    }

    for key in ("power_entity", "import_energy_entity", "export_energy_entity"):
        normalized["grid"][key] = str(normalized["grid"].get(key) or "")

    generation: list[dict[str, Any]] = []
    for index, raw_module in enumerate(normalized["generation"]):
        if not isinstance(raw_module, dict):
            continue
        module = dict(raw_module)
        module["id"] = str(module.get("id") or f"gen_{index}")
        module["type"] = str(module.get("type") or "solar")
        module["name"] = str(module.get("name") or f"Erzeuger {index + 1}")
        module["power_entity"] = str(module.get("power_entity") or "")
        module["energy_entity"] = str(module.get("energy_entity") or "")
        module["reduction_entity"] = str(module.get("reduction_entity") or "")
        module["reduction_active_states"] = str(module.get("reduction_active_states") or "on,true,1,active,reduced,begrenzt")
        generation.append(module)
    normalized["generation"] = generation

    storage: list[dict[str, Any]] = []
    for index, raw_module in enumerate(normalized["storage"]):
        if not isinstance(raw_module, dict):
            continue
        module = dict(raw_module)
        module["id"] = str(module.get("id") or f"bat_{index}")
        module["type"] = str(module.get("type") or "battery")
        module["name"] = str(module.get("name") or f"Batterie {index + 1}")
        for key in (
            "power_entity",
            "soc_entity",
            "charge_energy_entity",
            "discharge_energy_entity",
            "capacity_entity",
        ):
            module[key] = str(module.get(key) or "")
        try:
            module["capacity_kwh"] = max(0.0, float(module.get("capacity_kwh") or 0))
        except (TypeError, ValueError):
            module["capacity_kwh"] = 0.0
        storage.append(module)
    normalized["storage"] = storage

    heating: list[dict[str, Any]] = []
    for index, raw_module in enumerate(normalized["heating"]):
        if not isinstance(raw_module, dict):
            continue
        module = dict(raw_module)
        module["id"] = str(module.get("id") or f"heat_{index}")
        module["type"] = str(module.get("type") or "heatpump")
        module["name"] = str(module.get("name") or f"Wärmeerzeuger {index + 1}")
        module["target"] = str(module.get("target") or "buffer")
        for key in (
            "status_entity",
            "power_entity",
            "energy_entity",
            "supply_entity",
            "return_entity",
            "temperature_entity",
            "target_temperature_entity",
            "thermal_power_entity",
            "thermal_energy_entity",
        ):
            module[key] = str(module.get(key) or "")
        module["status_mode"] = "entity" if str(module.get("status_mode") or ("entity" if module.get("status_entity") else "power")) == "entity" else "power"
        try:
            module["heating_power_threshold_w"] = max(0.0, float(module.get("heating_power_threshold_w", 100)))
        except (TypeError, ValueError):
            module["heating_power_threshold_w"] = 100.0
        module["heating_states"] = str(module.get("heating_states") or "heating,active,on,1,ein")
        heating.append(module)
    normalized["heating"] = heating

    calculations: list[dict[str, Any]] = []
    used_calculation_ids: set[str] = set()
    valid_calculation_kinds = {"power", "energy", "thermal_power", "thermal_energy"}
    for index, raw_calculation in enumerate(normalized["calculations"]):
        if not isinstance(raw_calculation, dict):
            continue
        calculation = dict(raw_calculation)
        calculation_id = str(calculation.get("id") or f"calc_{index}")
        base_id = calculation_id
        suffix = 1
        while calculation_id in used_calculation_ids:
            suffix += 1
            calculation_id = f"{base_id}_{suffix}"
        used_calculation_ids.add(calculation_id)
        kind = str(calculation.get("kind") or "power")
        if kind not in valid_calculation_kinds:
            kind = "power"
        calculations.append(
            {
                "id": calculation_id,
                "name": str(calculation.get("name") or f"Berechneter Messwert {index + 1}"),
                "kind": kind,
                "terms": _normalize_measure_terms(calculation.get("terms")),
                "expose_entity": bool(calculation.get("expose_entity", False)),
            }
        )
    normalized["calculations"] = calculations

    # Levels / building floors. Existing V0.1 configs are migrated to one level.
    levels: list[dict[str, Any]] = []
    used_level_ids: set[str] = set()
    for index, raw_level in enumerate(normalized["levels"]):
        if not isinstance(raw_level, dict):
            continue
        level = dict(raw_level)
        level_id = str(level.get("id") or f"level_{index}")
        base_id = level_id
        suffix = 1
        while level_id in used_level_ids:
            suffix += 1
            level_id = f"{base_id}_{suffix}"
        used_level_ids.add(level_id)
        levels.append(
            {
                "id": level_id,
                "name": str(level.get("name") or f"Ebene {index + 1}"),
                "order": _safe_int(level.get("order"), index, -100, 100),
            }
        )
    if not levels:
        levels = [dict(DEFAULT_CONFIG["levels"][0])]
    levels.sort(key=lambda item: (item["order"], item["name"]))
    for index, level in enumerate(levels):
        level["order"] = index
    normalized["levels"] = levels
    valid_level_ids = {level["id"] for level in levels}
    default_level_id = levels[0]["id"]

    if not normalized["areas"]:
        normalized["areas"] = [dict(DEFAULT_CONFIG["areas"][0])]

    areas: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw_area in enumerate(normalized["areas"]):
        if not isinstance(raw_area, dict):
            continue
        area = dict(raw_area)
        area_id = str(area.get("id") or f"area_{index}")
        base_id = area_id
        suffix = 1
        while area_id in used_ids:
            suffix += 1
            area_id = f"{base_id}_{suffix}"
        used_ids.add(area_id)

        raw_layout = area.get("layout") if isinstance(area.get("layout"), dict) else {}
        is_house = area_id == "house"
        width = 12 if is_house else _safe_int(raw_layout.get("w"), 3, 1, 6)
        height = 2 if is_house else _safe_int(raw_layout.get("h"), 2, 1, 4)
        x = 1 if is_house else _safe_int(raw_layout.get("x"), 1 + ((index * 3) % 10), 1, 12)
        y = 1 if is_house else _safe_int(raw_layout.get("y"), 1 + ((index // 4) * 2), 1, 100)
        x = min(x, 13 - width)

        mode = str(area.get("mode") or "measured")
        if mode not in {"measured", "calculated"}:
            mode = "measured"
        calculation_type = str(area.get("calculation_type") or "difference")
        if calculation_type not in {"difference", "sum", "custom"}:
            calculation_type = "difference"

        source_area_ids = area.get("source_area_ids")
        if not isinstance(source_area_ids, list):
            source_area_ids = []
        terms = area.get("terms")
        if not isinstance(terms, list):
            terms = []
        legacy_terms = [
            {
                "op": "-" if str(term.get("op")) == "-" else "+",
                "area_id": str(term.get("area_id") or ""),
            }
            for term in terms
            if isinstance(term, dict) and term.get("area_id")
        ]
        basis_area_id = str(area.get("basis_area_id") or "")
        normalized_sources = [str(item) for item in source_area_ids if item]
        power_terms = _normalize_measure_terms(area.get("power_terms"))
        energy_terms = _normalize_measure_terms(area.get("energy_terms"))
        thermal_power_terms = _normalize_measure_terms(area.get("thermal_power_terms"))
        thermal_energy_terms = _normalize_measure_terms(area.get("thermal_energy_terms"))
        if mode == "calculated" and not power_terms and not energy_terms and not thermal_power_terms and not thermal_energy_terms:
            migrated_terms = _legacy_measure_terms(
                calculation_type, basis_area_id, normalized_sources, legacy_terms
            )
            power_terms = [dict(term) for term in migrated_terms]
            energy_terms = [dict(term) for term in migrated_terms]

        layout_mode = str(area.get("layout_mode") or "docked")
        if layout_mode not in {"docked", "free"}:
            layout_mode = "docked"

        source_values: dict[str, str] = {}
        for kind_name in ("power", "energy", "thermal_power", "thermal_energy"):
            type_field = f"{kind_name}_source_type"
            id_field = f"{kind_name}_source_id"
            source_type = str(area.get(type_field) or "")
            source_id = str(area.get(id_field) or "")
            if source_type not in {"entity", "calculation"} or not source_id:
                source_type = ""
                source_id = ""
            source_values[type_field] = source_type
            source_values[id_field] = source_id

        areas.append(
            {
                "id": area_id,
                "name": str(area.get("name") or f"Bereich {index + 1}"),
                "level_id": str(area.get("level_id") or default_level_id),
                "parent_id": "" if is_house else str(area.get("parent_id") or "house"),
                "mode": mode,
                "power_entity": str(area.get("power_entity") or ""),
                "energy_entity": str(area.get("energy_entity") or ""),
                "thermal_power_entity": str(area.get("thermal_power_entity") or ""),
                "thermal_energy_entity": str(area.get("thermal_energy_entity") or ""),
                "supply_temperature_entity": str(area.get("supply_temperature_entity") or ""),
                "return_temperature_entity": str(area.get("return_temperature_entity") or ""),
                "climate_mode": "climate" if str(area.get("climate_mode") or "") == "climate" else ("entities" if str(area.get("climate_mode") or "") == "entities" else ""),
                "climate_entity": str(area.get("climate_entity") or ""),
                "current_temperature_entity": str(area.get("current_temperature_entity") or ""),
                "current_temperature_entities": [str(entity_id) for entity_id in (area.get("current_temperature_entities") or []) if str(entity_id)],
                "target_temperature_entity": str(area.get("target_temperature_entity") or ""),
                **source_values,
                "calculation_type": calculation_type,
                "basis_area_id": basis_area_id,
                "source_area_ids": normalized_sources,
                "terms": legacy_terms,
                "power_terms": power_terms,
                "energy_terms": energy_terms,
                "thermal_power_terms": thermal_power_terms,
                "thermal_energy_terms": thermal_energy_terms,
                "layout": {"x": x, "y": y, "w": width, "h": height},
                "layout_mode": "docked" if is_house else layout_mode,
                "dock_order": _safe_int(area.get("dock_order"), y * 100 + x, 0, 10000),
            }
        )

    if not any(area["id"] == "house" for area in areas):
        house = dict(DEFAULT_CONFIG["areas"][0])
        house["level_id"] = default_level_id
        areas.insert(0, house)
    else:
        house = next(area for area in areas if area["id"] == "house")
        house["layout"] = {"x": 1, "y": 1, "w": 12, "h": 2}
        house["layout_mode"] = "docked"
        house["dock_order"] = 0

    valid_ids = {area["id"] for area in areas}
    for area in areas:
        if area["level_id"] not in valid_level_ids:
            area["level_id"] = default_level_id
        if area["id"] == "house":
            area["parent_id"] = ""
        elif area["parent_id"] not in valid_ids or area["parent_id"] == area["id"]:
            area["parent_id"] = "house" if "house" in valid_ids else ""
        if area["basis_area_id"] not in valid_ids or area["basis_area_id"] == area["id"]:
            area["basis_area_id"] = ""
        area["source_area_ids"] = [
            item
            for item in area["source_area_ids"]
            if item in valid_ids and item != area["id"]
        ]
        area["terms"] = [
            term
            for term in area["terms"]
            if term["area_id"] in valid_ids and term["area_id"] != area["id"]
        ]
        for key in ("power_terms", "energy_terms", "thermal_power_terms", "thermal_energy_terms"):
            area[key] = [
                term
                for term in area[key]
                if term["source_type"] == "entity"
                or (term["source_id"] in valid_ids and term["source_id"] != area["id"])
            ]


    # Move pre-0.4 area calculations into the central calculation model.
    kind_term_fields = {
        "power": "power_terms",
        "energy": "energy_terms",
        "thermal_power": "thermal_power_terms",
        "thermal_energy": "thermal_energy_terms",
    }
    kind_entity_fields = {
        "power": "power_entity",
        "energy": "energy_entity",
        "thermal_power": "thermal_power_entity",
        "thermal_energy": "thermal_energy_entity",
    }
    kind_labels = {
        "power": "Elektrische Leistung",
        "energy": "Energie heute",
        "thermal_power": "Thermische Leistung",
        "thermal_energy": "Thermische Energie heute",
    }
    calculations_by_id = {item["id"]: item for item in calculations}
    for area in areas:
        for kind_name, term_field in kind_term_fields.items():
            type_field = f"{kind_name}_source_type"
            id_field = f"{kind_name}_source_id"
            if area.get(type_field) and area.get(id_field):
                continue
            legacy_terms_for_kind = area.get(term_field, [])
            if area.get("mode") == "calculated" and legacy_terms_for_kind:
                calculation_id = f"area_{area['id']}_{kind_name}"
                if calculation_id not in calculations_by_id:
                    calculation = {
                        "id": calculation_id,
                        "name": f"{area['name']} · {kind_labels[kind_name]}",
                        "kind": kind_name,
                        "terms": [dict(term) for term in legacy_terms_for_kind],
                        "expose_entity": False,
                    }
                    calculations.append(calculation)
                    calculations_by_id[calculation_id] = calculation
                area[type_field] = "calculation"
                area[id_field] = calculation_id
                continue
            legacy_entity = str(area.get(kind_entity_fields[kind_name]) or "")
            if legacy_entity:
                area[type_field] = "entity"
                area[id_field] = legacy_entity

    valid_calculation_ids = {item["id"] for item in calculations}
    for calculation in calculations:
        calculation["terms"] = [
            term
            for term in calculation.get("terms", [])
            if (
                term["source_type"] == "entity"
                or (term["source_type"] == "area" and term["source_id"] in valid_ids)
                or (
                    term["source_type"] == "calculation"
                    and term["source_id"] in valid_calculation_ids
                    and term["source_id"] != calculation["id"]
                )
            )
        ]

    for area in areas:
        for kind_name in kind_term_fields:
            type_field = f"{kind_name}_source_type"
            id_field = f"{kind_name}_source_id"
            source_type = area.get(type_field)
            source_id = area.get(id_field)
            if source_type == "calculation" and source_id not in valid_calculation_ids:
                area[type_field] = ""
                area[id_field] = ""
            elif source_type not in {"entity", "calculation"}:
                area[type_field] = ""
                area[id_field] = ""

    normalized["calculations"] = calculations

    # Parent/child hierarchy is independent from calculation dependencies.
    # Break malformed imported parent cycles by attaching the affected node to house.
    hierarchy_by_id = {area["id"]: area for area in areas}

    def has_parent_cycle(start_id: str) -> bool:
        seen: set[str] = set()
        current_id = start_id
        while current_id and current_id in hierarchy_by_id:
            if current_id in seen:
                return True
            seen.add(current_id)
            current_id = hierarchy_by_id[current_id].get("parent_id", "")
        return False

    for area in areas:
        if area["id"] != "house" and has_parent_cycle(area["id"]):
            area["parent_id"] = "house" if "house" in valid_ids else ""

    # A child belongs visually to its parent and therefore always inherits
    # the parent's floor. This prevents a configured child from being rendered
    # as a second root tile on another floor.
    for _ in range(len(areas)):
        changed = False
        for area in areas:
            parent_id = area.get("parent_id", "")
            if area["id"] == "house" or not parent_id or parent_id == "house":
                continue
            parent = hierarchy_by_id.get(parent_id)
            if parent and area.get("level_id") != parent.get("level_id"):
                area["level_id"] = parent["level_id"]
                changed = True
        if not changed:
            break

    # Keep docked areas in a stable order without mixing root areas and
    # nested children. Root areas are positioned on the floor grid; children
    # are ordered only inside their direct parent group.
    for level in levels:
        level_id = level["id"]

        def is_visual_root(item: dict[str, Any]) -> bool:
            parent_id = item.get("parent_id", "")
            if not parent_id or parent_id == "house":
                return True
            parent = hierarchy_by_id.get(parent_id)
            return parent is None or parent.get("level_id") != level_id

        roots = [
            area for area in areas
            if area["id"] != "house"
            and area["level_id"] == level_id
            and area["layout_mode"] == "docked"
            and is_visual_root(area)
        ]
        roots.sort(
            key=lambda item: (
                item.get("dock_order", 10000),
                item["layout"]["y"],
                item["layout"]["x"],
                item["name"],
            )
        )
        for dock_order, area in enumerate(roots):
            area["dock_order"] = dock_order

        for parent in [item for item in areas if item["id"] != "house" and item["level_id"] == level_id]:
            children = [
                area for area in areas
                if area["parent_id"] == parent["id"]
                and area["level_id"] == level_id
                and area["layout_mode"] == "docked"
            ]
            children.sort(
                key=lambda item: (
                    item.get("dock_order", 10000),
                    item["layout"]["y"],
                    item["layout"]["x"],
                    item["name"],
                )
            )
            for dock_order, area in enumerate(children):
                area["dock_order"] = dock_order

    by_id = {area["id"]: area for area in areas}

    def dependencies(area: dict[str, Any]) -> set[str]:
        if area["mode"] != "calculated":
            return set()
        return {
            term["source_id"]
            for key in ("power_terms", "energy_terms", "thermal_power_terms", "thermal_energy_terms")
            for term in area.get(key, [])
            if term.get("source_type") == "area" and term.get("source_id")
        }

    def has_cycle(start_id: str) -> bool:
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(area_id: str) -> bool:
            if area_id in visiting:
                return True
            if area_id in visited:
                return False
            visiting.add(area_id)
            for dependency in dependencies(by_id[area_id]):
                if dependency in by_id and visit(dependency):
                    return True
            visiting.remove(area_id)
            visited.add(area_id)
            return False

        return visit(start_id)

    # A malformed imported config should never be able to recurse forever in the panel.
    for area in areas:
        if has_cycle(area["id"]):
            area["basis_area_id"] = ""
            area["source_area_ids"] = []
            area["terms"] = []
            area["power_terms"] = []
            area["energy_terms"] = []
            area["thermal_power_terms"] = []
            area["thermal_energy_terms"] = []

    normalized["areas"] = areas or [dict(DEFAULT_CONFIG["areas"][0])]
    return normalized
