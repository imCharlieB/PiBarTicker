"""PiBarTicker Home Assistant integration."""
from __future__ import annotations

import asyncio
import logging

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_state_change_event

from .const import CONF_SENSORS, CONF_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SWITCH]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "url": entry.data[CONF_URL],
        "session": async_get_clientsession(hass),
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the notify service
    async def handle_notify(call):
        message = call.data.get("message", "")
        level = call.data.get("level", "info")
        ttl = int(call.data.get("ttl", 30))
        url = entry.data[CONF_URL].rstrip("/")
        session = async_get_clientsession(hass)
        try:
            await session.post(
                f"{url}/api/v1/alerts",
                json={"message": message, "level": level, "ttl": ttl},
                timeout=aiohttp.ClientTimeout(total=5),
            )
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("PiBarTicker notify failed: %s", exc)

    hass.services.async_register(DOMAIN, "notify", handle_notify)

    # Watch configured sensor entities and push their state to the display
    sensors: list[str] = entry.options.get(CONF_SENSORS, [])
    if sensors:
        _setup_sensor_bridge(hass, entry, sensors)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


def _setup_sensor_bridge(
    hass: HomeAssistant, entry: ConfigEntry, entity_ids: list[str]
) -> None:
    """Subscribe to state changes for selected entities and push to PiBarTicker."""

    @callback
    def _state_changed(event) -> None:
        new_state = event.data.get("new_state")
        if new_state is None:
            return
        hass.async_create_task(_push_sensor(hass, entry, new_state))

    unsub = async_track_state_change_event(hass, entity_ids, _state_changed)
    entry.async_on_unload(unsub)

    # Push current values immediately on setup
    for entity_id in entity_ids:
        state = hass.states.get(entity_id)
        if state:
            hass.async_create_task(_push_sensor(hass, entry, state))


async def _push_sensor(hass: HomeAssistant, entry: ConfigEntry, state) -> None:
    url = entry.data[CONF_URL].rstrip("/")
    session = async_get_clientsession(hass)
    friendly = state.attributes.get("friendly_name", "")
    unit = state.attributes.get("unit_of_measurement", "")
    try:
        await session.post(
            f"{url}/api/v1/ha/sensors",
            json={
                "entity_id": state.entity_id,
                "state": state.state,
                "unit": unit,
                "friendly_name": friendly,
            },
            timeout=aiohttp.ClientTimeout(total=5),
        )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.debug("PiBarTicker sensor push failed for %s: %s", state.entity_id, exc)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.services.async_remove(DOMAIN, "notify")
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
