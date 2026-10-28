import { SHIPS } from './content.js';
import { getVisibleFleets, hasSensors } from './intelligence.js';

// Presentation snapshots contain only current formation facts. They never
// retain fleet references, plans, research, or historical participation claims.
const formation = fleet => ({
  id: fleet.id,
  name: fleet.name,
  owner: fleet.owner,
  type: fleet.type,
  ships: fleet.ships,
  hp: fleet.hp,
  maxHp: fleet.ships * SHIPS[fleet.type].hp,
});

/** Own current formations in engine order, including civilian defenders. */
export function getDefenseOrder(state, systemId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const system = state.systems.find(candidate => candidate.id === systemId);
  if (!faction || !system?.knownBy.includes(factionId)) return [];
  return state.fleets
    .filter(fleet => fleet.owner === factionId && fleet.systemId === systemId)
    .map(formation);
}

/**
 * Current command scope, not a casualty forecast or permission to attack.
 * Opponents keep the ordinary command's target order. Later exchanges occur
 * only while the attacker survives; an earlier defender may also survive.
 * Unknown opposition is null, distinct from an observed empty target list.
 */
export function getEngagementPreview(state, fleetId, targetId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const fleet = state.fleets.find(candidate => candidate.id === fleetId && candidate.owner === factionId);
  const target = state.systems.find(candidate => candidate.id === targetId);
  if (!faction || !fleet || SHIPS[fleet.type]?.attack < 4 || !target?.knownBy.includes(factionId)) return null;
  const sameSystem = fleet.systemId === target.id;
  const adjacent = state.lanes.some(([first, second]) =>
    first === fleet.systemId && second === target.id || second === fleet.systemId && first === target.id);
  if (!sameSystem && !adjacent) return null;
  const observed = hasSensors(state, factionId, target.id);
  return {
    systemId: target.id,
    systemName: target.name,
    context: sameSystem ? 'current-system' : 'arrival',
    selected: formation(fleet),
    observed,
    opponents: observed
      ? getVisibleFleets(state, factionId, target.id)
        .filter(other => other.owner !== factionId && faction.relations[other.owner]?.status === 'war')
        .map(formation)
      : null,
    otherFriendly: getDefenseOrder(state, target.id, factionId).filter(other => other.id !== fleet.id),
    hostileColony: Boolean(target.owner && target.owner !== factionId && faction.relations[target.owner]?.status === 'war'),
  };
}
