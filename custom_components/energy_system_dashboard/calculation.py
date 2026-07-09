"""Calculation runtime for Energy System Dashboard."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
import logging
from typing import Any

from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.statistics import statistics_during_period
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

POWER_KINDS = {"power", "thermal_power"}
ENERGY_KINDS = {"energy", "thermal_energy"}
KIND_SOURCE_FIELDS: dict[str, tuple[str, str]] = {
    "power": ("power_source_type", "power_source_id"),
    "energy": ("energy_source_type", "energy_source_id"),
    "thermal_power": ("thermal_power_source_type", "thermal_power_source_id"),
    "thermal_energy": ("thermal_energy_source_type", "thermal_energy_source_id"),
}
KIND_LEGACY_ENTITY_FIELDS: dict[str, str] = {
    "power": "power_entity",
    "energy": "energy_entity",
    "thermal_power": "thermal_power_entity",
    "thermal_energy": "thermal_energy_entity",
}
KIND_LEGACY_TERM_FIELDS: dict[str, str] = {
    "power": "power_terms",
    "energy": "energy_terms",
    "thermal_power": "thermal_power_terms",
    "thermal_energy": "thermal_energy_terms",
}


def calculation_unique_id(calculation_id: str) -> str:
    """Return the stable unique id for a calculation entity."""
    return f"{DOMAIN}_calculation_{calculation_id}"


class CalculationManager:
    """Evaluate dashboard calculations and keep entity sensors updated."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.config: dict[str, Any] = {}
        self.values: dict[str, float | None] = {}
        self._daily_energy: dict[str, float | None] = {}
        self._state_unsub: Callable[[], None] | None = None
        self._interval_unsub: Callable[[], None] | None = None
        self._value_listeners: set[Callable[[], None]] = set()
        self._config_listeners: set[Callable[[], None]] = set()

    async def async_start(self, config: dict[str, Any]) -> None:
        """Start the manager."""
        await self.async_apply_config(config)
        if self._interval_unsub is None:
            self._interval_unsub = async_track_time_interval(
                self.hass,
                self._async_interval_refresh,
                timedelta(minutes=1),
            )

    async def async_stop(self) -> None:
        """Stop runtime listeners."""
        if self._state_unsub is not None:
            self._state_unsub()
            self._state_unsub = None
        if self._interval_unsub is not None:
            self._interval_unsub()
            self._interval_unsub = None
        self._value_listeners.clear()
        self._config_listeners.clear()

    async def async_apply_config(self, config: dict[str, Any]) -> None:
        """Apply a normalized configuration and immediately recalculate."""
        self.config = config
        self._rebuild_state_listener()
        await self.async_refresh_daily_energy()
        self._recalculate()
        self._notify_config_listeners()
        self._notify_value_listeners()

    @callback
    def async_add_value_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Subscribe to calculated value changes."""
        self._value_listeners.add(listener)

        @callback
        def remove_listener() -> None:
            self._value_listeners.discard(listener)

        return remove_listener

    @callback
    def async_add_config_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Subscribe to calculation configuration changes."""
        self._config_listeners.add(listener)

        @callback
        def remove_listener() -> None:
            self._config_listeners.discard(listener)

        return remove_listener

    @callback
    def _notify_value_listeners(self) -> None:
        for listener in tuple(self._value_listeners):
            listener()

    @callback
    def async_notify_snapshot(self) -> None:
        """Publish the latest calculation snapshot to subscribers."""
        self._notify_value_listeners()

    @callback
    def _notify_config_listeners(self) -> None:
        for listener in tuple(self._config_listeners):
            listener()

    def calculation(self, calculation_id: str) -> dict[str, Any] | None:
        """Return a calculation by id."""
        return next(
            (
                calculation
                for calculation in self.config.get("calculations", [])
                if calculation.get("id") == calculation_id
            ),
            None,
        )

    def exposed_calculations(self) -> list[dict[str, Any]]:
        """Return calculations that should be Home Assistant entities."""
        return [
            calculation
            for calculation in self.config.get("calculations", [])
            if calculation.get("expose_entity")
        ]

    def value(self, calculation_id: str) -> float | None:
        """Return a current calculation value."""
        return self.values.get(calculation_id)

    def entity_id(self, calculation_id: str) -> str | None:
        """Resolve the registered sensor entity id, if the sensor exists."""
        registry = er.async_get(self.hass)
        return registry.async_get_entity_id(
            "sensor",
            DOMAIN,
            calculation_unique_id(calculation_id),
        )

    def snapshot(self) -> dict[str, Any]:
        """Return values for the frontend subscription."""
        result: dict[str, Any] = {}
        for calculation in self.config.get("calculations", []):
            calculation_id = str(calculation.get("id") or "")
            if not calculation_id:
                continue
            result[calculation_id] = {
                "id": calculation_id,
                "name": calculation.get("name") or calculation_id,
                "kind": calculation.get("kind") or "power",
                "value": self.values.get(calculation_id),
                "expose_entity": bool(calculation.get("expose_entity")),
                "entity_id": self.entity_id(calculation_id),
            }
        return {"values": result}

    @callback
    def _rebuild_state_listener(self) -> None:
        if self._state_unsub is not None:
            self._state_unsub()
            self._state_unsub = None
        entity_ids = sorted(self._referenced_entity_ids())
        if entity_ids:
            self._state_unsub = async_track_state_change_event(
                self.hass,
                entity_ids,
                self._async_state_changed,
            )

    @callback
    def _async_state_changed(self, event: Event[EventStateChangedData]) -> None:
        """Recalculate synchronous inputs immediately after a state change."""
        self._recalculate()

    async def _async_interval_refresh(self, _now: Any) -> None:
        """Refresh recorder-backed day values every minute."""
        await self.async_refresh_daily_energy()
        self._recalculate()

    def _referenced_entity_ids(self) -> set[str]:
        entity_ids: set[str] = set()
        for calculation in self.config.get("calculations", []):
            for term in calculation.get("terms", []):
                if term.get("source_type") == "entity" and term.get("source_id"):
                    entity_ids.add(str(term["source_id"]))
        for area in self.config.get("areas", []):
            for kind, (type_field, id_field) in KIND_SOURCE_FIELDS.items():
                if area.get(type_field) == "entity" and area.get(id_field):
                    entity_ids.add(str(area[id_field]))
                legacy_field = KIND_LEGACY_ENTITY_FIELDS[kind]
                if area.get(legacy_field):
                    entity_ids.add(str(area[legacy_field]))
        return entity_ids

    def _energy_entity_ids(self) -> set[str]:
        entity_ids: set[str] = set()
        for calculation in self.config.get("calculations", []):
            if calculation.get("kind") not in ENERGY_KINDS:
                continue
            for term in calculation.get("terms", []):
                if term.get("source_type") == "entity" and term.get("source_id"):
                    entity_ids.add(str(term["source_id"]))
        for area in self.config.get("areas", []):
            for kind in ENERGY_KINDS:
                type_field, id_field = KIND_SOURCE_FIELDS[kind]
                if area.get(type_field) == "entity" and area.get(id_field):
                    entity_ids.add(str(area[id_field]))
                legacy_field = KIND_LEGACY_ENTITY_FIELDS[kind]
                if area.get(legacy_field):
                    entity_ids.add(str(area[legacy_field]))
        return entity_ids

    async def async_refresh_daily_energy(self) -> None:
        """Load current local-day energy changes from recorder statistics."""
        entity_ids = self._energy_entity_ids()
        if not entity_ids:
            self._daily_energy = {}
            return
        start_time = dt_util.as_utc(dt_util.start_of_local_day())
        end_time = dt_util.utcnow()
        try:
            result = await get_instance(self.hass).async_add_executor_job(
                statistics_during_period,
                self.hass,
                start_time,
                end_time,
                entity_ids,
                "day",
                {"energy": "kWh"},
                {"change"},
            )
        except Exception:  # noqa: BLE001 - recorder failures must not break the integration
            _LOGGER.exception("Could not load daily energy statistics")
            return

        daily: dict[str, float | None] = {}
        for entity_id in entity_ids:
            rows = result.get(entity_id, []) if isinstance(result, dict) else []
            changes: list[float] = []
            for row in rows:
                try:
                    change = float(row.get("change"))
                except (TypeError, ValueError, AttributeError):
                    continue
                changes.append(change)
            daily[entity_id] = sum(changes) if changes else self._daily_entity_fallback(entity_id)
        self._daily_energy = daily

    def _daily_entity_fallback(self, entity_id: str) -> float | None:
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        label = f"{entity_id} {state.attributes.get('friendly_name', '')}".lower()
        if not any(token in label for token in ("today", "daily", "heute", "tag")):
            return None
        return self._energy_state_kwh(entity_id)

    def _numeric_state(self, entity_id: str) -> float | None:
        state = self.hass.states.get(entity_id)
        if state is None or state.state.lower() in {"unknown", "unavailable", "none", ""}:
            return None
        try:
            return float(state.state)
        except (TypeError, ValueError):
            return None

    def _unit(self, entity_id: str) -> str:
        state = self.hass.states.get(entity_id)
        return str(state.attributes.get("unit_of_measurement") or "").strip().lower() if state else ""

    def _power_w(self, entity_id: str) -> float | None:
        value = self._numeric_state(entity_id)
        if value is None:
            return None
        unit = self._unit(entity_id)
        if unit == "mw":
            return value * 1_000_000
        if unit == "kw":
            return value * 1_000
        if unit == "gw":
            return value * 1_000_000_000
        return value

    def _energy_state_kwh(self, entity_id: str) -> float | None:
        value = self._numeric_state(entity_id)
        if value is None:
            return None
        unit = self._unit(entity_id)
        factors = {
            "wh": 1 / 1_000,
            "kwh": 1,
            "mwh": 1_000,
            "gwh": 1_000_000,
            "j": 1 / 3_600_000,
            "kj": 1 / 3_600,
            "mj": 1 / 3.6,
            "gj": 277.7777777778,
        }
        factor = factors.get(unit)
        return value * factor if factor is not None else None

    def _entity_value(self, entity_id: str, kind: str) -> float | None:
        if kind in ENERGY_KINDS:
            if entity_id in self._daily_energy:
                return self._daily_energy[entity_id]
            return self._daily_entity_fallback(entity_id)
        return self._power_w(entity_id)

    def _area_by_id(self, area_id: str) -> dict[str, Any] | None:
        return next(
            (area for area in self.config.get("areas", []) if area.get("id") == area_id),
            None,
        )

    def _source_value(
        self,
        source_type: str,
        source_id: str,
        kind: str,
        stack: set[str],
    ) -> float | None:
        if not source_id:
            return None
        if source_type == "entity":
            return self._entity_value(source_id, kind)
        if source_type == "calculation":
            return self._calculation_value(source_id, stack)
        if source_type == "area":
            return self._area_value(source_id, kind, stack)
        return None

    def _area_value(self, area_id: str, kind: str, stack: set[str]) -> float | None:
        node_key = f"area:{area_id}:{kind}"
        if node_key in stack:
            return None
        area = self._area_by_id(area_id)
        if area is None:
            return None
        stack = set(stack)
        stack.add(node_key)
        type_field, id_field = KIND_SOURCE_FIELDS[kind]
        source_type = str(area.get(type_field) or "")
        source_id = str(area.get(id_field) or "")
        if source_type in {"entity", "calculation"} and source_id:
            return self._source_value(source_type, source_id, kind, stack)

        # Backwards compatibility for pre-0.4 area calculations.
        if area.get("mode") == "calculated":
            terms = area.get(KIND_LEGACY_TERM_FIELDS[kind], [])
            if terms:
                total = 0.0
                for term in terms:
                    value = self._source_value(
                        str(term.get("source_type") or "area"),
                        str(term.get("source_id") or ""),
                        kind,
                        stack,
                    )
                    if value is None:
                        return None
                    total += -value if term.get("op") == "-" else value
                return total

        legacy_entity = str(area.get(KIND_LEGACY_ENTITY_FIELDS[kind]) or "")
        return self._entity_value(legacy_entity, kind) if legacy_entity else None

    def _calculation_value(self, calculation_id: str, stack: set[str]) -> float | None:
        node_key = f"calculation:{calculation_id}"
        if node_key in stack:
            return None
        calculation = self.calculation(calculation_id)
        if calculation is None:
            return None
        kind = str(calculation.get("kind") or "power")
        terms = calculation.get("terms", [])
        if not terms:
            return None
        stack = set(stack)
        stack.add(node_key)
        total = 0.0
        for term in terms:
            value = self._source_value(
                str(term.get("source_type") or "entity"),
                str(term.get("source_id") or ""),
                kind,
                stack,
            )
            if value is None:
                return None
            total += -value if term.get("op") == "-" else value
        return total

    @callback
    def _recalculate(self) -> None:
        previous = dict(self.values)
        self.values = {
            str(calculation.get("id")): self._calculation_value(
                str(calculation.get("id")), set()
            )
            for calculation in self.config.get("calculations", [])
            if calculation.get("id")
        }
        if self.values != previous:
            self._notify_value_listeners()
