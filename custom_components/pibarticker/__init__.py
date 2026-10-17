"""PiBarTicker Home Assistant integration."""
from __future__ import annotations

import json
import logging
import re

from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.helpers.network import NoURLAvailableError, get_url

from .const import CONF_DEVICES, CONF_SENSORS, CONF_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SWITCH, Platform.SENSOR]

# Entity types mirrored from a picked device (its sensors and binary sensors; buttons, switches, updates... are not display data).
# "image": only the Bambu Lab plugin's `cover_image` (the picture of the print that is running) is taken - see _tracked and _push_cover_image.
DEVICE_DOMAINS = {"sensor", "binary_sensor", "image", "climate"}  # climate: a picked thermostat / mini split device brings its climate entity too
COVER_IMAGE_KEY = "cover_image"
_MAX_COVER_BYTES = 5_000_000
# access_token: an image entity's rotating token for Home Assistant's image proxy - never sent to the display
_SKIP_ATTRS = {"friendly_name", "icon", "entity_picture", "access_token", "supported_features", "attribution", "device_class", "state_class", "unit_of_measurement"}


def _tracked(hass: HomeAssistant, entry: ConfigEntry) -> tuple[list[str], dict[str, dict]]:
    """Every entity to mirror: the single entities picked + all sensors of the devices picked, with their device info."""
    ids: list[str] = list(entry.options.get(CONF_SENSORS, []))
    meta: dict[str, dict] = {}
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)

    def _device_info(device_id):
        device = dev_reg.async_get(device_id) if device_id else None
        return {
            "device_id": device_id or "",
            "device_name": ((device.name_by_user or device.name) if device else "") or "",
            "device_model": (device.model if device else "") or "",
        }

    for device_id in entry.options.get(CONF_DEVICES, []):
        info = _device_info(device_id)
        for ent in er.async_entries_for_device(ent_reg, device_id):
            if ent.domain not in DEVICE_DOMAINS:
                continue
            key = _entity_key(ent)
            if ent.domain == "image" and key != COVER_IMAGE_KEY:
                continue  # the chamber camera still, the pick image... are not wanted
            meta[ent.entity_id] = {**info, "key": key, "from_device": True}
            if ent.entity_id not in ids:
                ids.append(ent.entity_id)
    # single picks still carry their device + key so the display can group them
    for entity_id in ids:
        if entity_id in meta:
            continue
        ent = ent_reg.async_get(entity_id)
        meta[entity_id] = {**_device_info(ent.device_id if ent else None), "key": _entity_key(ent) if ent else "", "from_device": False}
    return ids, meta


def _entity_key(ent) -> str:
    """The integration's own key for an entity: the Bambu tray sensors all share the translation key "tray", the slot is at the end of the unique id."""
    match = re.search(r"(tray_\d+|external_spool)$", ent.unique_id or "")
    return match.group(1) if match else (ent.translation_key or "")


def _clean_attrs(attrs: dict) -> dict:
    """Small JSON-safe copy of an entity's attributes (e.g. a Bambu AMS tray's colour / type / remaining)."""
    out: dict = {}
    for key, val in attrs.items():
        if key in _SKIP_ATTRS:
            continue
        if val is None or isinstance(val, (bool, int, float)):
            out[key] = val
        elif isinstance(val, str):
            out[key] = val[:200]
        elif isinstance(val, (list, dict)):
            try:
                if len(json.dumps(val)) < 2000:
                    out[key] = val
            except (TypeError, ValueError):
                pass
    return out


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "url": entry.data[CONF_URL],
        "session": async_get_clientsession(hass),
        "tracked_sensors": [],
        "meta": {},
    }
    tracked, meta = _tracked(hass, entry)
    hass.data[DOMAIN][entry.entry_id]["tracked_sensors"] = tracked
    hass.data[DOMAIN][entry.entry_id]["meta"] = meta

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
    sensors: list[str] = hass.data[DOMAIN][entry.entry_id]["tracked_sensors"]
    if sensors:
        _setup_sensor_bridge(hass, entry, sensors)

    # Periodic re-push — catches missed initial pushes (backend starting up) and
    # ensures fresh attribute data after HACS integration updates without user action.
    async def _periodic_push(now=None) -> None:
        for entity_id in hass.data[DOMAIN][entry.entry_id]["tracked_sensors"]:
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
        for key in ("current_temperature", "temperature", "hvac_mode", "hvac_action", "current_humidity", "fan_mode", "preset_mode", "target_temp_high", "target_temp_low"):
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
    meta = hass.data.get(DOMAIN, {}).get(entry.entry_id, {}).get("meta", {}).get(state.entity_id, {})
    if meta.get("from_device") and domain in DEVICE_DOMAINS:
        attrs.update(_clean_attrs(state.attributes))

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
                "device_id": meta.get("device_id", ""),
                "device_name": meta.get("device_name", ""),
                "device_model": meta.get("device_model", ""),
                "key": meta.get("key", ""),
            },
            timeout=aiohttp.ClientTimeout(total=5),
        )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.debug("PiBarTicker sensor push failed for %s: %s", state.entity_id, exc)
        return

    if domain == "image":
        await _push_cover_image(hass, entry, state)


async def _push_cover_image(hass: HomeAssistant, entry: ConfigEntry, state) -> None:
    """Fetch the picture an image entity shows (the print's cover) and send it to the display, once per change of the entity's state (its timestamp).

    Home Assistant serves entity pictures through /api/image_proxy with a token that sits in the entity's `entity_picture` attribute, so the
    picture is read from Home Assistant's own address with that token (no login needed)."""
    sent = hass.data.get(DOMAIN, {}).get(entry.entry_id, {}).setdefault("covers_sent", {})
    stamp = str(state.state)
    if stamp in ("unknown", "unavailable", "") or sent.get(state.entity_id) == stamp:
        return
    picture = state.attributes.get("entity_picture")
    if not picture:
        return
    if not str(picture).startswith("http"):
        try:
            base = get_url(hass, prefer_external=False)
        except NoURLAvailableError:
            try:
                base = get_url(hass)
            except NoURLAvailableError:
                _LOGGER.debug("PiBarTicker: no Home Assistant URL to read %s from", state.entity_id)
                return
        picture = base.rstrip("/") + str(picture)
    session = async_get_clientsession(hass)
    try:
        async with session.get(picture, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                return
            content_type = (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
            data = await resp.read()
        if not data or len(data) > _MAX_COVER_BYTES or not content_type.startswith("image/"):
            return
        url = entry.data[CONF_URL].rstrip("/")
        async with session.post(
            f"{url}/api/v1/ha/cover/{state.entity_id}",
            data=data,
            headers={"Content-Type": content_type},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as post:
            if post.status == 200:
                sent[state.entity_id] = stamp
    except Exception as exc:  # noqa: BLE001
        _LOGGER.debug("PiBarTicker cover image push failed for %s: %s", state.entity_id, exc)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    domain_data = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
    old_sensors = set(domain_data.get("tracked_sensors", []))
    new_sensors = set(_tracked(hass, entry)[0])
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
