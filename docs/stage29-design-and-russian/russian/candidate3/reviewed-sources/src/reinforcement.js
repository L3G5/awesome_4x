import { SHIPS } from './content.js';
import { getBuildOptions, getSystemYield } from './game.js';
import { mergeDiscoveryHeritage } from './discoveries.js';

const copy = value => structuredClone(value);
const ownedFleet = (state, fleetId, factionId) => state.fleets.find(fleet => fleet.id === fleetId && fleet.owner === factionId);
const globalReason = (state, faction) => state.winner ? 'This campaign has ended. Start a new galaxy to continue.'
  : faction.eliminated ? 'This empire is no longer active.'
    : faction.orders < 1 ? 'No orders remaining. End the turn to receive a new mandate.' : '';

// Optional save fields are normalized only in these detached display records.
function formation(fleet) {
  return {
    id: fleet.id, name: fleet.name, type: fleet.type, systemId: fleet.systemId,
    ships: fleet.ships, hp: fleet.hp, maxHp: fleet.ships * SHIPS[fleet.type].hp,
    movesLeft: fleet.movesLeft, route: fleet.route ? copy(fleet.route) : null,
    hold: fleet.hold === true, defenseLead: fleet.defenseLead === true,
    heritage: copy(fleet.heritage || []),
  };
}

/**
 * Explain the existing merge command without executing it or changing state.
 * Structural legality excludes only global campaign/order guards. Thus a
 * disabled action can still explain the formation it would create.
 * The selected fleet survives; the partner's separate route/hold are discarded.
 * No foreign, remote or wrong-class partner details enter the returned view.
 */
export function getMergePreview(state, fleetId, targetFleetId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const fleet = ownedFleet(state, fleetId, factionId);
  if (!faction || !fleet) return null;
  const other = state.fleets.find(candidate => candidate.id === targetFleetId && candidate.id !== fleet.id
    && candidate.owner === factionId && candidate.type === fleet.type && candidate.systemId === fleet.systemId);
  const structuralReason = !other ? 'Select two of your same-type fleets in the same system.'
    : fleet.type === 'colony' ? 'Colony Arks operate independently.'
      : fleet.ships + other.ships > 12 ? 'A task force can contain at most 12 ships.' : '';
  const reason = globalReason(state, faction) || structuralReason;
  let result = null;
  if (!structuralReason) {
    const survivor = copy(fleet);
    mergeDiscoveryHeritage(survivor, other);
    if (other.defenseLead === true) survivor.defenseLead = true;
    survivor.ships += other.ships;
    survivor.hp += other.hp;
    survivor.movesLeft = Math.min(survivor.movesLeft, other.movesLeft);
    result = formation(survivor);
  }
  return {
    fleetId, targetFleetId, systemId: fleet.systemId,
    structurallyLegal: !structuralReason, structuralReason,
    enabled: !reason, reason, orderCost: 1,
    command: { type: 'merge', fleetId, targetFleetId, factionId },
    selected: formation(fleet), partner: other ? formation(other) : null, result,
    discarded: { route: result && other.route ? copy(other.route) : null, hold: Boolean(result && other.hold === true) },
  };
}

/** Owned, same-class, local partners; over-cap choices retain their reasons. */
export function getMergeOptions(state, fleetId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const fleet = ownedFleet(state, fleetId, factionId);
  if (!faction || !fleet) return null;
  return state.fleets.filter(other => other.id !== fleet.id && other.owner === factionId
    && other.type === fleet.type && other.systemId === fleet.systemId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(other => getMergePreview(state, fleetId, other.id, factionId));
}

/**
 * A current ordinary one-ship quote at this military fleet's own shipyard.
 * The build command contains no fleet ID: completion creates an independent
 * new formation, with no inherited name, course, Hold, lead or heritage.
 * Existing formation size/movement has no bearing on commissioning a ship.
 */
export function getReinforcementPreview(state, fleetId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const fleet = ownedFleet(state, fleetId, factionId);
  if (!faction || !fleet || (SHIPS[fleet.type]?.attack || 0) < 4) return null;
  const system = state.systems.find(candidate => candidate.id === fleet.systemId && candidate.owner === factionId);
  if (!system || !system.buildings.includes('shipyard')) return null;
  const option = getBuildOptions(state, system.id, factionId).find(item => item.kind === 'ship' && item.id === fleet.type);
  const production = getSystemYield(state, system).production;
  const reason = globalReason(state, faction) || option.reason;
  return {
    fleetId, systemId: system.id, systemName: system.name,
    itemId: option.id, name: option.name, cost: { ...option.cost }, orderCost: 1,
    work: option.work, production, cyclesAtCurrentRate: Math.max(1, Math.ceil(option.work / production)),
    upkeep: option.upkeep, independent: true, enabled: !reason, reason,
    command: { type: 'build', systemId: system.id, itemId: option.id, factionId },
  };
}
