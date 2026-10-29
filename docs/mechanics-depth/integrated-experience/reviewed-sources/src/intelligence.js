/**
 * Live fleet intelligence comes only from a colony or an expedition in the
 * exact system. Charting and surveying remember geography, not moving ships.
 * These queries deliberately apply the same rules to humans and AI empires.
 */
export function hasSensors(state, factionId, systemId) {
  const system = state.systems.find(candidate => candidate.id === systemId);
  return Boolean(system && (system.owner === factionId || state.fleets.some(fleet => fleet.owner === factionId && fleet.systemId === systemId)));
}

/** Own fleets are always known. The optional systemId narrows the result. */
export function getVisibleFleets(state, factionId, systemId) {
  const sensorSystems = new Set(state.systems.filter(system => system.owner === factionId).map(system => system.id));
  for (const fleet of state.fleets) if (fleet.owner === factionId) sensorSystems.add(fleet.systemId);
  return state.fleets.filter(fleet => (systemId === undefined || fleet.systemId === systemId) && (fleet.owner === factionId || sensorSystems.has(fleet.systemId)));
}
