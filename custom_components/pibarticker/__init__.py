"""PiBarTicker Home Assistant integration."""
from __future__ import annotations

import logging

from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval

from .const import CONF_SENSORS, CONF_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SWITCH, Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "url": entry.data[CONF_URL],
        "session": async_get_clientsession(hass),
        "tracked_sensors": list(entry.options.get(CONF_SENSORS, [])),
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the notify service
    async def handle_notify(call):
        message = call.data.get("message", "")
        level = call.data.get("level", "info")
        ttl = int(call.data.get("ttl", 30))
        key = str(call.data.get("key", "")).strip()
        url = entry.data[CONF_URL].rstrip("/")
        session = async_get_clientsession(hass)
        payload = {"message": message, "level": level, "ttl": ttl}
        if key:
            payload["key"] = key
        try:
            await session.post(
                f"{url}/api/v1/alerts",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5),
            )
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("PiBarTicker notify failed: %s", exc)

    async def handle_clear_alert(call):
        key = str(call.data.get("key", "")).strip()
        if not key:
            return
        url = entry.data[CONF_URL].rstrip("/")
        session = async_get_clientsession(hass)
        try:
            await session.delete(
                f"{url}/api/v1/alerts/{key}",
                timeout=aiohttp.ClientTimeout(total=5),
            )
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("PiBarTicker clear_alert failed: %s", exc)

    hass.services.async_register(DOMAIN, "notify", handle_notify)
    hass.services.async_register(DOMAIN, "clear_alert", handle_clear_alert)

    # Watch configured sensor entities and push their state to the display
    sensors: list[str] = entry.options.get(CONF_SENSORS, [])
    if sensors:
        _setup_sensor_bridge(hass, entry, sensors)

    # Periodic re-push — catches missed initial pushes (backend starting up) and
    # ensures fresh attribute data after HACS integration updates without user action.
    async def _periodic_push(now=None) -> None:
        for entity_id in entry.options.get(CONF_SENSORS, []):
            state = hass.states.get(entity_id)
            if state:
                await _push_sensor(hass, entry, state)

    entry.async_on_unload(
        async_track_time_interval(hass, _periodic_push, timedelta(minutes=5))
    )

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
    domain = state.entity_id.split(".")[0]

    # Capture display-relevant attributes per entity type
    attrs: dict = {}
    if domain == "climate":
        for key in ("current_temperature", "temperature", "hvac_mode", "hvac_action"):
            val = state.attributes.get(key)
            if val is not None:
                attrs[key] = val
    elif domain == "light":
        brightness = state.attributes.get("brightness")
        if brightness is not None:
            attrs["brightness"] = brightness
    elif domain == "weather":
        for key in (
            "temperature", "apparent_temperature", "dew_point", "temperature_unit",
            "humidity", "cloud_coverage", "pressure", "pressure_unit",
            "wind_bearing", "wind_speed", "wind_speed_unit", "wind_gust_speed",
            "visibility", "visibility_unit", "precipitation_unit", "ozone",
            "attribution", "forecast",
        ):
            val = state.attributes.get(key)
            if val is not None:
                attrs[key] = val
    elif domain == "sensor":
        forecast = state.attributes.get("forecast")
        if forecast is not None:
            attrs["forecast"] = forecast

    try:
        await session.post(
            f"{url}/api/v1/ha/sensors",
            json={
                "entity_id": state.entity_id,
                "state": state.state,
                "unit": unit,
                "friendly_name": friendly,
                "domain": domain,
                "attributes": attrs,
            },
            timeout=aiohttp.ClientTimeout(total=5),
        )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.debug("PiBarTicker sensor push failed for %s: %s", state.entity_id, exc)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    domain_data = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
    old_sensors = set(domain_data.get("tracked_sensors", []))
    new_sensors = set(entry.options.get(CONF_SENSORS, []))
    removed = old_sensors - new_sensors

    if removed:
        url = entry.data[CONF_URL].rstrip("/")
        session = async_get_clientsession(hass)
        for entity_id in removed:
            try:
                await session.delete(
                    f"{url}/api/v1/ha/sensors/{entity_id}",
                    timeout=aiohttp.ClientTimeout(total=5),
                )
                _LOGGER.debug("PiBarTicker: removed entity %s from display", entity_id)
            except Exception as exc:  # noqa: BLE001
                _LOGGER.debug("PiBarTicker sensor delete failed for %s: %s", entity_id, exc)

    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.services.async_remove(DOMAIN, "notify")
    hass.services.async_remove(DOMAIN, "clear_alert")
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
