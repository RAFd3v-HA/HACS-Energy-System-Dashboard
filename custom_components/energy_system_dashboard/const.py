"""Constants for Energy System Dashboard."""

from typing import Final

DOMAIN: Final = "energy_system_dashboard"
PANEL_URL: Final = "energy-system"
PANEL_TITLE: Final = "Energiesystem"
PANEL_ICON: Final = "mdi:transmission-tower"
PANEL_ELEMENT: Final = "energy-system-dashboard-panel-v078"
STATIC_URL: Final = "/energy_system_dashboard"
STORAGE_KEY: Final = f"{DOMAIN}.config"
STORAGE_VERSION: Final = 1
DATA_STORE: Final = "store"
DATA_MANAGER: Final = "calculation_manager"
DATA_PANEL_REGISTERED: Final = "panel_registered"
