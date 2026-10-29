import { FACTIONS, BUILDINGS, TECHS, STARLANE_PROJECT } from './content.js';
import { getCharterBonuses } from './development.js';
import { graphDistances, seededRandom } from './galaxy-generation.js';

const systemOf = (state, id) => state.systems.find(system => system.id === id);
const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const sameEdge = (edge, endpoints) => edge.includes(endpoints[0]) && edge.includes(endpoints[1]);
const accessible = (faction, system) => !system.owner || system.owner === faction.id || faction.relations[system.owner]?.status === 'war' || faction.relations[system.owner]?.trade;
const production = system => 4 + system.population + system.buildings.reduce((total, id) => total + (BUILDINGS[id].production || 0), 0) + getCharterBonuses(system).production;
const opened = lane => lane.openedTurn !== null;

/** Optional shortcuts never join starting capitals or collapse their separation. */
export function generateAncientLanes(state) {
  const random = seededRandom(`${state.seed}:ancient-lanes:1`);
  const candidates = [], neutral = state.systems.filter(system => !system.originalOwner);
  for (let first = 0; first < neutral.length; first++) {
    const a = neutral[first], distances = graphDistances(state.lanes, a.id);
    for (const b of neutral.slice(first + 1)) {
      const jumps = distances.get(b.id);
      if (jumps >= 3 && jumps <= 6 && Math.hypot(a.x - b.x, a.y - b.y) <= 35) candidates.push([a.id, b.id]);
    }
  }
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  const preservesStarts = extra => state.factions.every((faction, index) => {
    const distances = graphDistances([...state.lanes, ...extra], faction.capitalId);
    return state.factions.slice(index + 1).every(other => distances.get(other.capitalId) >= 5);
  });
  for (const [index, first] of candidates.entries()) {
    if (!preservesStarts([first])) continue;
    for (const second of candidates.slice(index + 1)) {
      if (second.some(id => first.includes(id)) || !preservesStarts([first, second])) continue;
      // Each remains a real shortcut even if the other one opens first.
      if (graphDistances([...state.lanes, first], second[0]).get(second[1]) < 3 || graphDistances([...state.lanes, second], first[0]).get(first[1]) < 3) continue;
      return [first, second].map((endpoints, laneIndex) => ({ id: `l${laneIndex}`, endpoints, openedTurn: null, openedBy: null }));
    }
  }
  throw new Error('A galaxy needs two useful dormant starlanes.');
}

/** A survey detects a remote endpoint, but grants no survey or fleet sensors. */
export function getDormantSignalDestinations(state, systemId) {
  return (state.ancientLanes || []).filter(lane => lane.endpoints.includes(systemId)).map(lane => lane.endpoints.find(id => id !== systemId));
}

/** The same chart and public border information used by ordinary route planning. */
export function knownTravelDistance(state, factionId, originId, destinationId, extraEdge = null) {
  const faction = factionOf(state, factionId), origin = systemOf(state, originId), destination = systemOf(state, destinationId);
  if (!faction || !origin?.knownBy.includes(factionId) || !destination?.knownBy.includes(factionId) || !accessible(faction, destination)) return null;
  const lanes = extraEdge ? [...state.lanes, extraEdge] : state.lanes;
  const allowed = new Set(state.systems.filter(system => system.knownBy.includes(factionId) && (system.id === originId || accessible(faction, system))).map(system => system.id));
  return graphDistances(lanes.filter(edge => edge.every(id => allowed.has(id))), originId).get(destinationId) ?? null;
}

/** Only public project identity is exposed for a foreign builder. */
export function getKnownStarlanes(state, factionId = 'player') {
  return (state.ancientLanes || []).filter(lane => {
    const endpoints = lane.endpoints.map(id => systemOf(state, id));
    return endpoints.every(system => system?.knownBy.includes(factionId)) && endpoints.some(system => system.exploredBy.includes(factionId));
  }).map(lane => {
    const builder = state.systems.find(system => system.queue?.kind === 'starlane' && system.queue.laneId === lane.id);
    return { id: lane.id, endpoints: [...lane.endpoints], opened: opened(lane), openedTurn: lane.openedTurn,
      // An unknown restoring empire is not identified through distant telemetry.
      openedBy: lane.openedBy === factionId || factionOf(state, factionId)?.contacts.includes(lane.openedBy) ? lane.openedBy : null,
      project: builder ? { systemId: builder.id, owner: builder.owner === factionId || factionOf(state, factionId)?.contacts.includes(builder.owner) ? builder.owner : null,
        ...(builder.owner === factionId ? { turns: Math.ceil((builder.queue.work - builder.queue.progress) / production(builder)) } : {}) } : null };
  });
}

export function getStarlaneOptions(state, systemId, factionId = 'player') {
  const system = systemOf(state, systemId), faction = factionOf(state, factionId);
  if (!system || !faction) return [];
  return getKnownStarlanes(state, factionId).filter(lane => lane.endpoints.includes(systemId)).map(lane => {
    const destinationId = lane.endpoints.find(id => id !== systemId), destination = systemOf(state, destinationId);
    const borderOpen = accessible(faction, destination);
    const beforeJumps = knownTravelDistance(state, factionId, systemId, destinationId);
    let reason = '';
    if (lane.opened) reason = 'This starlane is already restored';
    else if (system.owner !== factionId) reason = 'Requires an owned colony';
    else if (lane.project) reason = `Restoration is already underway at ${systemOf(state, lane.project.systemId).name}`;
    else if (system.queue) reason = 'Construction already in progress';
    else if (!faction.techs.includes('logistics')) reason = `Requires ${TECHS.logistics.name}`;
    else if (faction.credits < STARLANE_PROJECT.cost.credits || faction.minerals < STARLANE_PROJECT.cost.minerals) reason = 'Insufficient credits or minerals';
    else if (faction.orders < 1) reason = 'No orders remaining';
    return { ...lane, ...STARLANE_PROJECT, id: lane.id, systemId, destinationId, cost: { ...STARLANE_PROJECT.cost },
      turns: system.owner === factionId ? Math.ceil(STARLANE_PROJECT.work / production(system)) : null, beforeJumps, afterJumps: borderOpen ? 1 : null,
      savings: borderOpen && beforeJumps !== null ? Math.max(0, beforeJumps - 1) : null,
      borderOpen, enabled: !reason, reason };
  });
}

/** One permanent ordinary edge; fleet positions, orders and saved courses stay put. */
export function completeStarlane(state, system) {
  const lane = state.ancientLanes.find(candidate => candidate.id === system.queue.laneId);
  lane.openedTurn = state.turn;
  lane.openedBy = system.owner;
  state.lanes.push([...lane.endpoints]);
  return lane;
}

export function validateStarlaneState(state) {
  const queues = state.systems.filter(system => system.queue?.kind === 'starlane');
  if (state.ancientLanes === undefined) return queues.length === 0;
  if (!Array.isArray(state.ancientLanes) || state.ancientLanes.length > 2) return false;
  const ids = new Set(), pairs = new Set();
  for (const lane of state.ancientLanes) {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane) || Object.keys(lane).some(key => !['id', 'endpoints', 'openedTurn', 'openedBy'].includes(key)) || !/^l[01]$/.test(lane.id) || ids.has(lane.id)) return false;
    ids.add(lane.id);
    if (!Array.isArray(lane.endpoints) || lane.endpoints.length !== 2 || lane.endpoints[0] === lane.endpoints[1] || lane.endpoints.some(id => !systemOf(state, id) || /^s[0-3]$/.test(id))) return false;
    const pair = [...lane.endpoints].sort().join(':');
    if (pairs.has(pair)) return false;
    pairs.add(pair);
    const matches = state.lanes.filter(edge => sameEdge(edge, lane.endpoints));
    if (lane.openedTurn === null ? lane.openedBy !== null || matches.length !== 0 : !Number.isInteger(lane.openedTurn) || lane.openedTurn < 1 || lane.openedTurn > state.turn || !Object.hasOwn(FACTIONS, lane.openedBy) || matches.length !== 1) return false;
    const builders = queues.filter(system => system.queue.laneId === lane.id);
    if (builders.length > 1 || builders.some(system => opened(lane) || !system.owner || !lane.endpoints.includes(system.id))) return false;
  }
  return queues.every(system => ids.has(system.queue.laneId));
}
