import { SHIPS } from './content.js';

const military = fleet => (SHIPS[fleet?.type]?.attack || 0) >= 4;
const groupKey = fleet => `${fleet.owner}:${fleet.systemId}`;

/**
 * Promote a lead within its own government's existing slots in this orbit.
 * Other governments keep their interleaved positions; unmarked order is
 * unchanged. The returned array is new, but contains the original fleets.
 */
export function orderDefenders(fleets) {
  const ordered = [...fleets], groups = new Map();
  fleets.forEach((fleet, index) => {
    const key = groupKey(fleet);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  for (const indices of groups.values()) {
    const leadIndex = indices.findIndex(index => fleets[index].defenseLead === true);
    if (leadIndex <= 0) continue;
    const members = indices.map(index => fleets[index]);
    const [lead] = members.splice(leadIndex, 1);
    members.unshift(lead);
    indices.forEach((index, offset) => { ordered[index] = members[offset]; });
  }
  return ordered;
}

/** Pure, ownership-scoped options shared by UI and the ordinary command. */
export function getDefenseLeadPreview(state, fleetId, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const fleet = state.fleets.find(candidate => candidate.id === fleetId && candidate.owner === factionId);
  if (!faction || !fleet || !military(fleet)) return null;
  const lead = fleet.defenseLead === true;
  const currentLeadId = state.fleets.find(other => other.owner === factionId && other.systemId === fleet.systemId && other.defenseLead === true)?.id || null;
  const common = state.winner ? 'This campaign has ended. Start a new galaxy to continue.'
    : faction.eliminated ? 'This empire is no longer active.' : '';
  const option = orders => {
    const reason = common || (faction.orders < orders ? 'No orders remaining. End the turn to receive a new mandate.' : '');
    return { enabled: !reason, reason, orders };
  };
  return { lead, currentLeadId, assign: option(lead ? 0 : 1), clear: option(lead ? 1 : 0) };
}

/** Optional v1 metadata; false is harmless even on civilian formations. */
export function validateDefenseState(state) {
  const occupied = new Set();
  for (const fleet of state.fleets) {
    if (fleet.defenseLead !== undefined && typeof fleet.defenseLead !== 'boolean') return false;
    if (fleet.defenseLead !== true) continue;
    const key = groupKey(fleet);
    if (!military(fleet) || occupied.has(key)) return false;
    occupied.add(key);
  }
  return true;
}
