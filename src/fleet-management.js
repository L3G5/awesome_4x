import { SHIPS } from './content.js';
import { getCharterBonuses } from './development.js';
import { getVisibleFleets } from './intelligence.js';

const MAX_FLEETS = 1000;
const floatBits = new DataView(new ArrayBuffer(8));

// Adjacent positive IEEE-754 values let us bound rounding without rounding
// legacy hull values to tenths, which could erase or create surviving hull.
function adjacentFloat(value, up) {
  floatBits.setFloat64(0, value);
  floatBits.setBigUint64(0, floatBits.getBigUint64(0) + (up ? 1n : -1n));
  return floatBits.getFloat64(0);
}

function divideHull(hp, ships, detachedShips, maximumHull) {
  const parentCapacity = (ships - detachedShips) * maximumHull;
  const detachedCapacity = detachedShips * maximumHull;
  const low = Math.max(Number.MIN_VALUE, hp - parentCapacity);
  const high = Math.min(adjacentFloat(hp, false), detachedCapacity);
  if (low > high) return null;
  const ideal = Math.max(low, Math.min(high, hp * (detachedShips / ships)));
  // Usually the proportional value already recombines exactly. If its last
  // binary digit rounds the sum up/down, a neighboring allocation avoids even
  // an ulp of healing or attrition through repeated split/merge operations.
  for (const detached of [ideal, adjacentFloat(ideal, false), adjacentFloat(ideal, true)]) {
    if (detached < low || detached > high) continue;
    const parent = hp - detached;
    if (parent > 0 && parent <= parentCapacity && detached > 0 && detached <= detachedCapacity && parent + detached === hp) return { parent, detached };
  }
  return null;
}

/** Pure preview; all split validation is shared with the ordinary command. */
export function getSplitPreview(state, fleetId, ships = 1, factionId = 'player') {
  const fleet = state.fleets.find(candidate => candidate.id === fleetId);
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const result = {
    enabled: false, reason: '', orderCost: 1, fleetId, systemId: fleet?.systemId ?? null,
    parent: null, detached: null, originalHasRoute: Boolean(fleet?.route),
    nextFleetNumber: null,
  };
  const fail = reason => ({ ...result, reason });
  if (!fleet || fleet.owner !== factionId) return fail('Select one of your own fleets.');
  if (!faction || faction.eliminated) return fail('This empire is no longer active.');
  if (fleet.type === 'colony') return fail('Colony Arks operate independently.');
  if (fleet.ships < 2) return fail('A fleet needs at least two ships to detach a force.');
  if (!Number.isInteger(ships) || ships < 1 || ships >= fleet.ships) return fail('Detach a whole number of ships, leaving at least one in the original fleet.');
  const hull = divideHull(fleet.hp, fleet.ships, ships, SHIPS[fleet.type].hp);
  if (!hull) return fail('This fleet has too little representable hull to divide into two surviving forces.');
  result.parent = { ships: fleet.ships - ships, hp: hull.parent, movesLeft: fleet.movesLeft, hasRoute: Boolean(fleet.route) };
  result.detached = { ships, hp: hull.detached, movesLeft: fleet.movesLeft, hasRoute: false };
  if (state.winner) return fail('This campaign has ended. Start a new galaxy to continue.');
  if (faction.orders < 1) return fail('No orders remaining. End the turn to receive a new mandate.');
  if (state.fleets.length >= MAX_FLEETS) return fail('The campaign has reached its fleet capacity. Merge a task force before detaching another.');
  // Valid older saves need not have a counter above every surviving ID. Use
  // the next free canonical identifier without changing the previewed state.
  const used = new Set(state.fleets.map(candidate => candidate.id));
  let next = state.nextFleetId;
  if (!Number.isSafeInteger(next) || next < 1) return fail('This save has no available fleet identifier.');
  while (next < Number.MAX_SAFE_INTEGER && used.has(`f${next}`)) next++;
  if (next >= Number.MAX_SAFE_INTEGER) return fail('This save has no available fleet identifier.');
  result.nextFleetNumber = next;
  return { ...result, enabled: true };
}

/**
 * One passive-repair budget per owned, unblocked colony. Missing hull, rather
 * than fleet count, determines each share. No repair flags or save fields.
 * Rows are sorted by stable fleet ID, so reload/array order cannot alter the
 * floating-point remainder. `repair` is the actual representable HP gain.
 */
export function getColonyRepairForecast(state, systemId) {
  const system = state.systems.find(candidate => candidate.id === systemId);
  const faction = state.factions.find(candidate => candidate.id === system?.owner);
  const empty = { systemId, capacity: 0, blocked: false, totalMissingHull: 0, totalRepair: 0, fleets: [] };
  if (!system || !faction) return empty;
  const capacity = (system.buildings.includes('shipyard') ? 8 : 4) + getCharterBonuses(system).repair;
  const blocked = getVisibleFleets(state, faction.id, systemId).some(fleet => faction.relations[fleet.owner]?.status === 'war');
  const fleets = state.fleets.filter(fleet => fleet.owner === faction.id && fleet.systemId === systemId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(fleet => ({ fleetId: fleet.id, hp: fleet.hp, maxHp: fleet.ships * SHIPS[fleet.type].hp, missingHull: Math.max(0, fleet.ships * SHIPS[fleet.type].hp - fleet.hp), repair: 0, hpAfter: fleet.hp }));
  const totalMissingHull = fleets.reduce((sum, fleet) => sum + fleet.missingHull, 0);
  const result = { systemId, capacity, blocked, totalMissingHull, totalRepair: 0, fleets };
  if (blocked || !totalMissingHull) return result;
  const budget = Math.min(capacity, totalMissingHull);
  const damaged = fleets.filter(fleet => fleet.missingHull > 0);
  for (let index = 0; index < damaged.length; index++) {
    const fleet = damaged[index];
    const remaining = Math.max(0, budget - result.totalRepair);
    const share = Math.min(remaining, index === damaged.length - 1 ? remaining : budget * (fleet.missingHull / totalMissingHull));
    let hpAfter = Math.min(fleet.maxHp, fleet.hp + share);
    let repair = hpAfter - fleet.hp;
    // Round toward the original hull only when addition would exceed the
    // remaining pool. Never grant a minimum repair per fleet: that would make
    // tiny detachments manufacture recovery through rounding.
    while (hpAfter > fleet.hp && (repair > remaining || result.totalRepair + repair > budget)) {
      hpAfter = Math.max(fleet.hp, adjacentFloat(hpAfter, false));
      repair = hpAfter - fleet.hp;
    }
    fleet.hpAfter = hpAfter;
    fleet.repair = repair;
    result.totalRepair += repair;
  }
  return result;
}
