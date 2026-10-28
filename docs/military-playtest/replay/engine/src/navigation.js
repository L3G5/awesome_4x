import { hasSensors, getVisibleFleets } from './intelligence.js';
import { getDiscoveryView } from './discoveries.js';

const systemOf = (state, id) => state.systems.find(system => system.id === id);
const fleetOf = (state, id) => state.fleets.find(fleet => fleet.id === id);
const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const neighbors = (state, id) => state.lanes.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const accessible = (faction, system) => !system.owner || system.owner === faction.id || faction.relations[system.owner]?.status === 'war' || faction.relations[system.owner]?.trade;
const invalid = (reason, destinationId = null, path = []) => ({ ok: false, reason, destinationId, path: [...path], jumps: Math.max(0, path.length - 1), totalOrders: Math.max(0, path.length - 1), maxJumpsNow: 0, maxOrdersNow: 0, stopBefore: null, uncertainSystems: [] });

function validPath(state, fleet, route) {
  if (!route || typeof route !== 'object' || Array.isArray(route) || Object.keys(route).some(key => !['destinationId', 'path'].includes(key)) || !Array.isArray(route.path) || route.path.length < 2 || route.path.length > state.systems.length) return false;
  const path = route.path;
  return path[0] === fleet.systemId && path.at(-1) === route.destinationId && new Set(path).size === path.length && path.every((id, index) => systemOf(state, id)?.knownBy.includes(fleet.owner) && (index === 0 || neighbors(state, path[index - 1]).includes(id)));
}

/** Fleet observations may stop execution, but never participate in path choice. */
function describePath(state, fleet, destinationId, path) {
  const faction = factionOf(state, fleet.owner);
  let stopBefore = null, clearSteps = path.length - 1;
  for (let index = 1; index < path.length; index++) {
    const system = systemOf(state, path[index]);
    const reason = !accessible(faction, system) ? 'Borders are closed. Replot or restore access before continuing.'
      : getVisibleFleets(state, fleet.owner, system.id).some(other => faction.relations[other.owner]?.status === 'war') ? 'An observed hostile fleet blocks this route. Engage it deliberately or replot.' : '';
    if (reason) { stopBefore = { systemId: system.id, reason }; clearSteps = index - 1; break; }
  }
  const jumps = path.length - 1;
  const maxJumpsNow = Math.min(clearSteps, Math.floor(fleet.movesLeft), Math.floor(faction.orders));
  const reason = !jumps ? 'The fleet is already at this destination.'
    : clearSteps === 0 ? stopBefore.reason
    : fleet.movesLeft < 1 ? 'This fleet has used all its movement this turn.'
    : faction.orders < 1 ? 'No orders remaining. End the turn to receive a new mandate.' : '';
  return { ok: true, reason, destinationId, path: [...path], jumps, totalOrders: jumps, maxJumpsNow, maxOrdersNow: maxJumpsNow, stopBefore, uncertainSystems: path.slice(1).filter(id => !hasSensors(state, fleet.owner, id)) };
}

/** Pure deterministic shortest charted path, with publicly closed borders excluded. */
export function getRoutePreview(state, fleetId, destinationId) {
  const fleet = fleetOf(state, fleetId), destination = systemOf(state, destinationId);
  if (!fleet) return invalid('Select a fleet first.', destinationId);
  if (!destination?.knownBy.includes(fleet.owner)) return invalid('Choose a charted destination.', destinationId);
  const faction = factionOf(state, fleet.owner), pending = [[fleet.systemId]], visited = new Set([fleet.systemId]);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const path = pending[cursor], current = path.at(-1);
    if (current === destinationId) return describePath(state, fleet, destinationId, path);
    for (const next of neighbors(state, current)) {
      const system = systemOf(state, next);
      if (visited.has(next) || !system.knownBy.includes(fleet.owner) || !accessible(faction, system)) continue;
      visited.add(next); pending.push([...path, next]);
    }
  }
  return invalid('No accessible charted route reaches that destination.', destinationId);
}

/** Evaluate the saved route as drawn; never silently substitute a different path. */
export function getRouteStatus(state, fleetId) {
  const fleet = fleetOf(state, fleetId);
  if (!fleet) return invalid('Select a fleet first.');
  if (!fleet.route) return invalid('This fleet has no planned route.');
  if (!validPath(state, fleet, fleet.route)) return invalid('This route no longer matches the fleet position or charted lanes. Replot it.', fleet.route.destinationId, Array.isArray(fleet.route.path) ? fleet.route.path : []);
  return describePath(state, fleet, fleet.route.destinationId, fleet.route.path);
}

/** Called only after a successful physical jump, never after an interception. */
export function updateRouteAfterMove(fleet, originId, targetId) {
  if (!fleet.route) return;
  if (fleet.route.path[0] === originId && fleet.route.path[1] === targetId) {
    fleet.route.path.shift();
    if (fleet.route.path.length < 2) delete fleet.route;
  } else delete fleet.route;
}

/** Administrative relocation invalidates an old origin; closed borders do not. */
export function reconcileRoutes(state) {
  for (const fleet of state.fleets) if (fleet.route && !validPath(state, fleet, fleet.route)) delete fleet.route;
}

export function validateNavigationState(state) {
  return state.fleets.every(fleet => fleet.route === undefined || validPath(state, fleet, fleet.route));
}

/**
 * Execute ordinary movement through an injected command callback. The callback
 * is the sole authority for spending, survey, contact, interception and combat.
 * No movement takes place during planning or end-turn route reconciliation.
 */
export function continuePlannedRoute(state, fleetId, executeMove) {
  const fleet = fleetOf(state, fleetId), status = getRouteStatus(state, fleetId);
  const reports = [], result = (ok, outcome, message, jumpsCompleted, ordersSpent, movesSpent) => ({ ok, outcome, message, jumpsCompleted, ordersSpent, movesSpent, combatReports: reports });
  if (!status.ok || !status.maxJumpsNow) return result(false, 'blocked', status.reason, 0, 0, 0);
  const faction = factionOf(state, fleet.owner), initialOrders = faction.orders, initialMoves = fleet.movesLeft;
  let jumpsCompleted = 0;
  const finish = (outcome, message) => result(true, outcome, message, jumpsCompleted, initialOrders - faction.orders, initialMoves - fleet.movesLeft);
  // The initial disclosed ceiling remains binding even if later events grant
  // orders or movement. Each step is checked again against current observations.
  for (let step = 0; step < status.maxJumpsNow; step++) {
    const current = getRouteStatus(state, fleetId);
    if (!current.ok || !current.maxJumpsNow) return finish('blocked', `Route paused after ${jumpsCompleted} jump${jumpsCompleted === 1 ? '' : 's'}. ${current.reason}`);
    const target = systemOf(state, current.path[1]), originId = fleet.systemId;
    const hadSurvey = target.exploredBy.includes(fleet.owner), contacts = new Set(faction.contacts);
    const move = executeMove({ type: 'move', factionId: fleet.owner, fleetId, targetId: target.id });
    if (!move.ok) return jumpsCompleted ? finish('blocked', `Route paused. ${move.message}`) : result(false, 'blocked', move.message, 0, 0, 0);
    reports.push(...(move.combatReports || []));
    if (fleet.systemId !== originId) jumpsCompleted++;
    if (move.outcome === 'intercepted') return finish('intercepted', move.message);
    if (!fleetOf(state, fleetId)) return finish('destroyed', move.message);
    if (move.combatOccurred || move.combatReports?.length) return finish('combat', move.message);
    if (state.winner) return finish('campaign-ended', 'Campaign concluded. Route movement has stopped.');
    if (faction.contacts.some(id => !contacts.has(id))) return finish('first-contact', `Route paused at ${target.name}: first contact opened a diplomatic channel.`);
    const discovery = !hadSurvey ? getDiscoveryView(state, target.id, fleet.owner) : null;
    if (discovery && (discovery.phase !== 'resolved' || discovery.site)) return finish('discovery', `Route paused at ${target.name}: ${discovery.name} is newly surveyed${discovery.site ? `, including its ${discovery.site.name}` : ''}.`);
    if (!fleet.route) return finish('arrived', `${fleet.name} reached ${target.name} in ${jumpsCompleted} jump${jumpsCompleted === 1 ? '' : 's'}.`);
  }
  const current = getRouteStatus(state, fleetId);
  if (current.stopBefore?.systemId === current.path[1]) return finish('blocked', `Route paused after ${jumpsCompleted} jump${jumpsCompleted === 1 ? '' : 's'}. ${current.stopBefore.reason}`);
  return finish(fleet.movesLeft < 1 ? 'moves-exhausted' : faction.orders < 1 ? 'orders-exhausted' : 'paused', `Route paused after ${jumpsCompleted} jump${jumpsCompleted === 1 ? '' : 's'}. ${current.reason || 'Continue the remaining route when ready.'}`);
}
