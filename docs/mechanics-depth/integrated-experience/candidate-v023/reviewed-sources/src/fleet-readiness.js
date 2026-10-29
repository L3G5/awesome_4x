import { getVisibleFleets } from './intelligence.js';

const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const hostile = (faction, owner) => owner && faction.relations[owner]?.status === 'war';

/** Advisory attention only: this never changes legal actions or movement. */
export function getFleetReadiness(state, fleetId, factionId = 'player') {
  const fleet = state.fleets.find(candidate => candidate.id === fleetId && candidate.owner === factionId);
  const faction = factionOf(state, factionId);
  if (!fleet || !faction) return { held: false, ready: false, reason: 'Select one of your own fleets.', movesLeft: 0 };
  const held = fleet.hold === true;
  const reason = state.winner ? 'This campaign has ended.'
    : faction.eliminated ? 'This empire is no longer active.'
    : held ? 'Holding position until resumed or local events require attention.'
    : fleet.movesLeft < 1 ? 'This fleet has used its movement this cycle.'
    : faction.orders < 1 ? 'No orders remain this cycle.' : '';
  return { held, ready: !reason, reason, movesLeft: fleet.movesLeft };
}

/** Own ready fleets, in their stable campaign order; held fleets stay in rosters. */
export function getReadyFleets(state, factionId = 'player') {
  return state.fleets.filter(fleet => fleet.owner === factionId && getFleetReadiness(state, fleet.id, factionId).ready);
}

function localThreats(state, fleet) {
  const faction = factionOf(state, fleet.owner);
  const system = state.systems.find(candidate => candidate.id === fleet.systemId);
  return {
    hostileFleetIds: new Set(getVisibleFleets(state, fleet.owner, fleet.systemId).filter(other => hostile(faction, other.owner)).map(other => other.id)),
    hostileOwner: hostile(faction, system.owner) ? system.owner : null,
  };
}

/** Transient observations around an action, never persisted in a save. */
export function captureFleetReadiness(state) {
  return new Map(state.fleets.filter(fleet => fleet.hold === true).map(fleet => [fleet.id, { systemId: fleet.systemId, ...localThreats(state, fleet) }]));
}

/** Only a changed, locally observed situation wakes an acknowledged garrison. */
export function reconcileFleetReadiness(state, before) {
  for (const fleet of state.fleets) {
    if (fleet.hold !== true || !before.has(fleet.id)) continue;
    const previous = before.get(fleet.id);
    if (fleet.systemId !== previous.systemId) { delete fleet.hold; continue; }
    const current = localThreats(state, fleet);
    if (current.hostileOwner && current.hostileOwner !== previous.hostileOwner
      || [...current.hostileFleetIds].some(id => !previous.hostileFleetIds.has(id))) delete fleet.hold;
  }
}

export function validateFleetReadiness(state) {
  return state.fleets.every(fleet => fleet.hold === undefined || typeof fleet.hold === 'boolean');
}
