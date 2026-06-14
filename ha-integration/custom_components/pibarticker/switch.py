"""PiBarTicker display power switch."""
from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([PiBarTickerDisplaySwitch(entry, data["url"], data["session"])])


class PiBarTickerDisplaySwitch(SwitchEntity):
    _attr_has_entity_name = True
    _attr_name = "Display"
    _attr_icon = "mdi:monitor"

    def __init__(self, entry: ConfigEntry, url: str, session) -> None:
        self._url = url.rstrip("/")
        self._session = session
        self._attr_unique_id = f"{entry.entry_id}_display"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "PiBarTicker",
            "manufacturer": "PiBarTicker",
            "model": "Sports Ticker Display",
        }
        self._attr_is_on = True

    async def async_update(self) -> None:
        try:
            async with self._session.get(
                f"{self._url}/api/v1/display/power",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self._attr_is_on = bool(data.get("on", True))
        except Exception as exc:  # noqa: BLE001
            _LOGGER.debug("PiBarTicker display poll failed: %s", exc)

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_power(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_power(False)

    async def _set_power(self, on: bool) -> None:
        try:
            async with self._session.post(
                f"{self._url}/api/v1/display/power",
                json={"on": on},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    self._attr_is_on = on
                    self.async_write_ha_state()
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("PiBarTicker display set failed: %s", exc)
