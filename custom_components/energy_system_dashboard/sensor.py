"""Calculated sensor entities for Energy System Dashboard."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfEnergy, UnitOfPower
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .calculation import CalculationManager, calculation_unique_id
from .const import DATA_MANAGER, DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up calculated sensors for the config entry."""
    manager: CalculationManager = hass.data[DOMAIN][DATA_MANAGER]
    entities: dict[str, EnergySystemCalculationSensor] = {}

    @callback
    def reconcile_entities() -> None:
        exposed = {
            str(calculation.get("id")): calculation
            for calculation in manager.exposed_calculations()
            if calculation.get("id")
        }
        new_entities: list[EnergySystemCalculationSensor] = []
        for calculation_id in exposed:
            if calculation_id not in entities:
                entity = EnergySystemCalculationSensor(manager, calculation_id)
                entities[calculation_id] = entity
                new_entities.append(entity)
        if new_entities:
            async_add_entities(new_entities)

        for calculation_id in list(entities):
            if calculation_id in exposed:
                continue
            entity = entities.pop(calculation_id)
            hass.async_create_task(entity.async_remove())

        for entity in entities.values():
            if entity.hass is not None:
                entity.async_write_ha_state()

    entry.async_on_unload(manager.async_add_config_listener(reconcile_entities))
    reconcile_entities()


class EnergySystemCalculationSensor(SensorEntity):
    """Home Assistant sensor backed by one dashboard calculation."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:calculator-variant-outline"

    def __init__(self, manager: CalculationManager, calculation_id: str) -> None:
        self._manager = manager
        self._calculation_id = calculation_id
        self._attr_unique_id = calculation_unique_id(calculation_id)

    @property
    def name(self) -> str:
        """Return the calculation name."""
        calculation = self._manager.calculation(self._calculation_id)
        return str(calculation.get("name") or self._calculation_id) if calculation else self._calculation_id

    @property
    def native_value(self) -> float | None:
        """Return the calculated value."""
        value = self._manager.value(self._calculation_id)
        return round(value, 6) if value is not None else None

    @property
    def available(self) -> bool:
        """Return availability."""
        return self._manager.calculation(self._calculation_id) is not None and self.native_value is not None

    @property
    def device_class(self) -> SensorDeviceClass:
        """Return the correct device class."""
        return SensorDeviceClass.ENERGY if self._kind in {"energy", "thermal_energy"} else SensorDeviceClass.POWER

    @property
    def native_unit_of_measurement(self) -> str:
        """Return normalized native units."""
        return UnitOfEnergy.KILO_WATT_HOUR if self._kind in {"energy", "thermal_energy"} else UnitOfPower.WATT

    @property
    def state_class(self) -> SensorStateClass:
        """Return the state class for statistics."""
        return SensorStateClass.TOTAL if self._kind in {"energy", "thermal_energy"} else SensorStateClass.MEASUREMENT

    @property
    def last_reset(self) -> datetime | None:
        """Return local day start for daily energy calculations."""
        if self._kind not in {"energy", "thermal_energy"}:
            return None
        return dt_util.start_of_local_day()

    @property
    def suggested_display_precision(self) -> int:
        """Return a useful default precision."""
        return 3 if self._kind in {"energy", "thermal_energy"} else 0

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return stable diagnostic metadata."""
        return {
            "calculation_id": self._calculation_id,
            "calculation_kind": self._kind,
        }

    @property
    def _kind(self) -> str:
        calculation = self._manager.calculation(self._calculation_id)
        return str(calculation.get("kind") or "power") if calculation else "power"

    async def async_added_to_hass(self) -> None:
        """Subscribe to calculated value changes."""
        self.async_on_remove(self._manager.async_add_value_listener(self._async_value_changed))
        self._manager.async_notify_snapshot()

    @callback
    def _async_value_changed(self) -> None:
        """Write a new state after the calculation changes."""
        self.async_write_ha_state()
