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
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
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
    "version": 9,
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
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the dashboard panel."""
    domain_data = hass.data.setdefault(DOMAIN, {})

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
                    "js_url": f"{STATIC_URL}/energy-system-dashboard.js?v=0.3.3",
                }
            },
            require_admin=False,
        )
        domain_data[DATA_PANEL_REGISTERED] = True

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the dashboard panel."""
    if hass.data.get(DOMAIN, {}).get(DATA_PANEL_REGISTERED):
        async_remove_panel(hass, PANEL_URL)
        hass.data[DOMAIN][DATA_PANEL_REGISTERED] = False
    return True


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_config"})
@websocket_api.async_response
async def websocket_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the persisted dashboard configuration."""
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
    connection.send_result(msg["id"], {"saved": True, "config": config})


def _safe_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _normalize_measure_terms(raw_terms: Any) -> list[dict[str, str]]:
    """Normalize calculation terms that reference an area value or HA entity."""
    if not isinstance(raw_terms, list):
        return []
    result: list[dict[str, str]] = []
    for raw_term in raw_terms:
        if not isinstance(raw_term, dict):
            continue
        source_type = str(raw_term.get("source_type") or "area")
        if source_type not in {"area", "entity"}:
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
    normalized["version"] = 9

    for key in ("generation", "storage", "heating", "areas", "levels"):
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
        ):
            module[key] = str(module.get(key) or "")
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
            "thermal_power_entity",
            "thermal_energy_entity",
        ):
            module[key] = str(module.get(key) or "")
        heating.append(module)
    normalized["heating"] = heating

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
