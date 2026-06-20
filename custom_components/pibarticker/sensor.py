"""PiBarTicker mirrored sensor entities — shows configured entities on the device page."""
from __future__ import annotations

import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from .const import CONF_SENSORS, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    entity_ids: list[str] = entry.options.get(CONF_SENSORS, [])
    async_add_entities(
        [PiBarTickerMirroredSensor(hass, entry, eid) for eid in entity_ids],
        update_before_add=False,
    )


class PiBarTickerMirroredSensor(SensorEntity):
    _attr_should_poll = False
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, source_entity_id: str
    ) -> None:
        self._source_id = source_entity_id
        self._attr_unique_id = f"{entry.entry_id}_{source_entity_id}"
        # Link to the existing PiBarTicker device without redefining it
        self._attr_device_info = {"identifiers": {(DOMAIN, entry.entry_id)}}

        state = hass.states.get(source_entity_id)
        if state:
            self._attr_name = (
                state.attributes.get("friendly_name")
                or source_entity_id.split(".")[-1].replace("_", " ").title()
            )
            self._attr_native_value = state.state
            self._attr_native_unit_of_measurement = state.attributes.get(
                "unit_of_measurement"
            )
            self._attr_device_class = state.attributes.get("device_class")
        else:
            self._attr_name = (
                source_entity_id.split(".")[-1].replace("_", " ").title()
            )
            self._attr_native_value = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_track_state_change_event(
                self.hass, [self._source_id], self._handle_state_change
            )
        )
        state = self.hass.states.get(self._source_id)
        if state:
            self._sync(state)
            self.async_write_ha_state()

    @callback
    def _handle_state_change(self, event) -> None:
        new_state = event.data.get("new_state")
        if new_state is not None:
            self._sync(new_state)
            self.async_write_ha_state()

    def _sync(self, state) -> None:
        self._attr_native_value = state.state
        self._attr_native_unit_of_measurement = state.attributes.get(
            "unit_of_measurement"
        )
        self._attr_device_class = state.attributes.get("device_class")
