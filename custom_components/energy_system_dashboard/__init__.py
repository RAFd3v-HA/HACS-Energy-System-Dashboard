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

DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "name": "ENERGY SYSTEM",
    "grid": {
        "enabled": False,
        "name": "Netz",
        "power_entity": "",
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
    "areas": [
        {
            "id": "house",
            "name": "Haus",
            "parent_id": None,
            "power_entity": "",
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
                    "js_url": f"{STATIC_URL}/energy-system-dashboard.js?v=0.1.1",
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
    connection.send_result(msg["id"], data or DEFAULT_CONFIG)


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


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    """Normalize stored config and break invalid area parent cycles."""
    normalized = dict(DEFAULT_CONFIG)
    normalized.update(config)
    normalized["version"] = 1

    for key in ("generation", "storage", "heating", "areas"):
        if not isinstance(normalized.get(key), list):
            normalized[key] = []

    if not isinstance(normalized.get("grid"), dict):
        normalized["grid"] = dict(DEFAULT_CONFIG["grid"])
    if not isinstance(normalized.get("buffer"), dict):
        normalized["buffer"] = dict(DEFAULT_CONFIG["buffer"])

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
        area["id"] = area_id
        area["name"] = str(area.get("name") or f"Bereich {index + 1}")
        area["power_entity"] = str(area.get("power_entity") or "")
        area["parent_id"] = area.get("parent_id") or None
        areas.append(area)

    valid_ids = {area["id"] for area in areas}
    by_id = {area["id"]: area for area in areas}
    for area in areas:
        if area["parent_id"] not in valid_ids or area["parent_id"] == area["id"]:
            area["parent_id"] = None
            continue

        seen = {area["id"]}
        parent_id = area["parent_id"]
        while parent_id is not None:
            if parent_id in seen:
                area["parent_id"] = None
                break
            seen.add(parent_id)
            parent_id = by_id.get(parent_id, {}).get("parent_id")

    normalized["areas"] = areas or [dict(DEFAULT_CONFIG["areas"][0])]
    return normalized
