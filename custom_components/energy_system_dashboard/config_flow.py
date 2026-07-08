"""Config flow for Energy System Dashboard."""

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class EnergySystemDashboardConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, object] | None = None
    ) -> FlowResult:
        """Create the single dashboard entry after user confirmation."""
        if user_input is not None:
            return self.async_create_entry(title="Energiesystem", data={})

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
