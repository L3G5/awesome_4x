/**
 * Strategic decisions use charted sovereignty, remembered surveys and live
 * sensors. Every action goes through the same command rules as the player.
 * Imports are only called during a turn, so game.js may safely import runAI.
 */
import { command, getNeighbors, getVisibleSystems, getEmpireStats, getBuildOptions, getResearchOptions, estimateCombat, fleetPower, getSystemYield } from './game.js';
import { hasSensors, getVisibleFleets } from './intelligence.js';
import { ANOMALIES, SHIPS } from './content.js';
import { getDiplomaticIntent } from './diplomacy.js';

const factionOf = (state, id) => state.factions.find(f => f.id === id);
const systemOf = (state, id) => state.systems.find(s => s.id === id);
const fleetOf = (state, id) => state.fleets.find(f => f.id === id);
const war = (faction, otherId) => otherId && faction.relations[otherId]?.status === 'war';
const military = fleet => SHIPS[fleet.type].attack > 3;
const ownFleets = (state, faction) => state.fleets.filter(f => f.owner === faction.id);
const canPay = (faction, cost = {}) => Object.entries(cost).every(([key, amount]) => faction[key] >= amount);
const enterable = (faction, system) => !system.owner || system.owner === faction.id || war(faction, system.owner) || faction.relations[system.owner]?.trade;
const surveyed = (system, faction) => system.exploredBy.includes(faction.id);

// Damaged forces need a larger margin than their nominal number of guns.
function strength(state, fleet) {
  return fleetPower(state, fleet) * (.45 + .55 * fleet.hp / (SHIPS[fleet.type].hp * fleet.ships));
}

function observedEnemies(state, faction, systemId) {
  return getVisibleFleets(state, faction.id, systemId).filter(f => war(faction, f.owner));
}

function enemyStrength(state, faction, systemId) {
  return observedEnemies(state, faction, systemId).reduce((total, f) => total + strength(state, f), 0);
}

function friendlyStrength(state, faction, systemId, exceptId = null) {
  return ownFleets(state, faction).filter(f => f.systemId === systemId && f.id !== exceptId && military(f)).reduce((total, f) => total + strength(state, f), 0);
}

/** A topological distance query, not a query of uncharted geography. */
function knownDistances(state, faction, from) {
  const known = new Set(getVisibleSystems(state, faction.id).map(s => s.id));
  const distances = new Map([[from, 0]]), queue = [from];
  for (let i = 0; i < queue.length; i++) for (const next of getNeighbors(state, queue[i])) {
    if (!known.has(next) || distances.has(next) || !enterable(faction, systemOf(state, next))) continue;
    distances.set(next, distances.get(queue[i]) + 1); queue.push(next);
  }
  return distances;
}

/**
 * Dijkstra routing evaluates every intermediate system. An attractive final
 * colony cannot justify walking a small task force through a known blockade.
 * Unknown fleets stay unknown: hostile sovereignty adds a risk premium, not
 * an inspection of the hidden fleet array.
 */
function route(state, faction, fleet, targetId, { peaceful = false } = {}) {
  if (fleet.systemId === targetId) return { path: [targetId], cost: 0 };
  const known = new Set(getVisibleSystems(state, faction.id).map(s => s.id));
  if (!known.has(targetId)) return null;
  const costs = new Map([[fleet.systemId, 0]]), previous = new Map(), open = new Set([fleet.systemId]);
  const power = strength(state, fleet);
  while (open.size) {
    const current = [...open].sort((a, b) => costs.get(a) - costs.get(b) || a.localeCompare(b))[0];
    open.delete(current);
    if (current === targetId) {
      const path = [current];
      while (previous.has(path[0])) path.unshift(previous.get(path[0]));
      return { path, cost: costs.get(current) };
    }
    for (const next of getNeighbors(state, current)) {
      if (!known.has(next)) continue;
      const system = systemOf(state, next);
      if (!enterable(faction, system)) continue;
      const enemies = observedEnemies(state, faction, next);
      const opposition = enemies.reduce((total, f) => total + strength(state, f), 0);
      if (enemies.length && (peaceful || !military(fleet))) continue;
      if (opposition > 0 && power < opposition * 1.18) continue;
      // Retreat and reinforcement prefer friendly territory over uncertain
      // hostile systems, even if the hostile route is one jump shorter.
      const uncertainHostile = war(faction, system.owner) && !hasSensors(state, faction.id, next);
      const risk = opposition > 0 ? opposition / Math.max(1, power) * 3 : 0;
      const cost = costs.get(current) + 1 + risk + (uncertainHostile ? peaceful ? 8 : 2.5 : 0);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); open.add(next);
    }
  }
  return null;
}

function canAssault(state, faction, fleet, target) {
  const estimate = estimateCombat(state, fleet.id, target.id);
  if (!estimate) return false;
  const power = strength(state, fleet);
  if (estimate.unknown) {
    // A fixed planning allowance, deliberately independent of hidden ships,
    // population or buildings. The task force will reassess on arrival.
    return !war(faction, target.owner) || power >= 30;
  }
  const opposition = enemyStrength(state, faction, target.id);
  if (opposition > 0) return power >= opposition * 1.18;
  return !estimate.garrison || power >= estimate.garrison * .38 && fleet.hp >= Math.max(18, estimate.garrison * .5);
}

function threatsToColonies(state, faction) {
  const known = new Set(getVisibleSystems(state, faction.id).map(s => s.id));
  return state.systems.filter(s => s.owner === faction.id).map(colony => {
    const here = enemyStrength(state, faction, colony.id);
    const approaches = getNeighbors(state, colony.id).filter(id => known.has(id)).map(id => ({ systemId: id, power: enemyStrength(state, faction, id) })).filter(item => item.power > 0).sort((a, b) => b.power - a.power);
    const nearby = approaches.reduce((total, item) => total + item.power, 0);
    const required = (here + nearby) * 1.18;
    const stationed = friendlyStrength(state, faction, colony.id);
    return { colony, here, nearby, required, stationed, sourceId: here > 0 ? colony.id : approaches[0]?.systemId || null, urgency: here ? 100 + here + colony.population * 2 : nearby ? 40 + nearby + Math.max(0, required - stationed) * .3 : 0 };
  }).filter(threat => threat.urgency > 0).sort((a, b) => b.urgency - a.urgency || a.colony.id.localeCompare(b.colony.id));
}

function selectRally(state, faction, objective, threats) {
  const safeColonies = state.systems.filter(s => s.owner === faction.id && enemyStrength(state, faction, s.id) === 0);
  if (!safeColonies.length) return null;
  const priorityThreat = threats.find(threat => threat.sourceId === objective?.id);
  if (priorityThreat && !priorityThreat.here) return priorityThreat.colony;
  const distances = objective ? knownDistances(state, faction, objective.id) : new Map();
  const candidates = safeColonies.map(colony => ({
    colony,
    score: objective ? (distances.get(colony.id) ?? 100) * 12 - Math.min(10, getSystemYield(state, colony).defense / 10) - (colony.buildings.includes('shipyard') ? 3 : 0) : colony.id === faction.capitalId ? -100 : 0,
  })).sort((a, b) => a.score - b.score || a.colony.id.localeCompare(b.colony.id));
  const previous = candidates.find(item => item.colony.id === faction.strategy?.rallyId);
  // A small tie margin avoids moving the staging point between equivalent
  // colonies whenever an individual reinforcement arrives.
  return previous && previous.score <= candidates[0].score + 3 ? previous.colony : candidates[0].colony;
}

function selectObjective(state, faction, threats) {
  if (threats.length) return systemOf(state, threats[0].sourceId);
  const hostiles = getVisibleSystems(state, faction.id).filter(system => war(faction, system.owner) || enemyStrength(state, faction, system.id) > 0);
  if (!hostiles.length) return null;
  const previous = hostiles.find(system => system.id === faction.strategy?.objectiveId);
  if (previous) return previous;
  const origins = state.systems.filter(s => s.owner === faction.id).map(s => knownDistances(state, faction, s.id));
  const distance = system => Math.min(...origins.map(distances => distances.get(system.id) ?? 100), 100);
  return hostiles.sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id))[0];
}

function mergeForces(state, faction, act) {
  for (const fleet of ownFleets(state, faction).filter(military)) {
    if (!fleetOf(state, fleet.id)) continue;
    while (faction.orders > 1) {
      const mate = ownFleets(state, faction).find(other => other.id !== fleet.id && other.type === fleet.type && other.systemId === fleet.systemId && other.ships + fleet.ships <= 12);
      if (!mate || !act({ type: 'merge', fleetId: fleet.id, targetFleetId: mate.id }).ok) break;
    }
  }
}

function retreat(state, faction, fleet, act) {
  const candidates = getNeighbors(state, fleet.systemId).map(id => systemOf(state, id)).filter(system => system.knownBy.includes(faction.id) && enterable(faction, system) && !observedEnemies(state, faction, system.id).length);
  candidates.sort((a, b) => (b.owner === faction.id ? 20 : !b.owner ? 5 : -5) - (a.owner === faction.id ? 20 : !a.owner ? 5 : -5) || (a.id === faction.strategy?.rallyId ? -1 : b.id === faction.strategy?.rallyId ? 1 : a.id.localeCompare(b.id)));
  for (const destination of candidates) {
    if (fleet.movesLeft < 1 || faction.orders < 1) break;
    const result = act({ type: 'move', fleetId: fleet.id, targetId: destination.id });
    if (result.ok) return true;
  }
  return false;
}

function militaryTurn(state, faction, act) {
  mergeForces(state, faction, act);
  const handled = new Set();
  // Rescue damaged or outmatched forces before assigning new offensives.
  for (const fleet of ownFleets(state, faction).filter(military)) {
    if (faction.orders < 1 || !fleetOf(state, fleet.id)) break;
    const system = systemOf(state, fleet.systemId), opposition = enemyStrength(state, faction, system.id);
    if (opposition > strength(state, fleet) / 1.18 && opposition > 0) {
      retreat(state, faction, fleet, act);
      handled.add(fleet.id); // Do not spend an order on a hopeless attack.
    } else if (system.owner === faction.id && fleet.hp < SHIPS[fleet.type].hp * fleet.ships * .7 && faction.minerals >= 10 && faction.orders > 1) {
      act({ type: 'repair', fleetId: fleet.id });
    }
  }
  const threats = threatsToColonies(state, faction);
  const objective = selectObjective(state, faction, threats);
  const rally = selectRally(state, faction, objective, threats);
  const assaultReady = objective && ownFleets(state, faction).some(fleet => military(fleet) && canAssault(state, faction, fleet, objective) && route(state, faction, fleet, objective.id));
  faction.strategy = { mode: threats.length ? 'defend' : objective ? assaultReady ? 'advance' : 'assemble' : 'develop', rallyId: rally?.id || null, objectiveId: objective?.id || null, turn: state.turn };
  const distances = rally ? knownDistances(state, faction, rally.id) : new Map();
  const fleets = ownFleets(state, faction).filter(military).sort((a, b) => strength(state, b) - strength(state, a) || (distances.get(b.systemId) ?? 100) - (distances.get(a.systemId) ?? 100));
  for (const fleet of fleets) {
    if (!fleetOf(state, fleet.id) || handled.has(fleet.id) || fleet.movesLeft < 1 || faction.orders < 1 || state.winner) continue;
    const system = systemOf(state, fleet.systemId);
    const localEnemies = observedEnemies(state, faction, system.id);
    if (localEnemies.length || war(faction, system.owner)) {
      if (canAssault(state, faction, fleet, system)) act({ type: 'attack', fleetId: fleet.id });
      continue;
    }
    const localThreat = threats.find(threat => threat.colony.id === system.id);
    // Keep a defense that can actually hold. Several inadequate garrisons
    // must still be allowed to concentrate instead of freezing on each flank.
    const reserveNeeded = localThreat && system.id !== rally?.id && friendlyStrength(state, faction, system.id) >= localThreat.required && friendlyStrength(state, faction, system.id, fleet.id) < localThreat.required;
    if (reserveNeeded) continue;
    if (objective && canAssault(state, faction, fleet, objective)) {
      const advance = route(state, faction, fleet, objective.id);
      if (advance?.path.length > 1) {
        act({ type: 'move', fleetId: fleet.id, targetId: advance.path[1] });
        continue;
      }
    }
    // Concentration remains active during war. Smaller forces move to a safe
    // frontier colony and combine before attempting an observed blockade.
    if (rally && fleet.systemId !== rally.id) {
      const reinforce = route(state, faction, fleet, rally.id, { peaceful: true });
      if (reinforce?.path.length > 1) act({ type: 'move', fleetId: fleet.id, targetId: reinforce.path[1] });
    }
  }
  mergeForces(state, faction, act);
  return threatsToColonies(state, faction);
}

function anomalyTurn(state, faction, act) {
  const locations = new Set(ownFleets(state, faction).map(f => f.systemId));
  for (const system of state.systems.filter(s => locations.has(s.id) || s.owner === faction.id)) {
    if (faction.orders <= 1 || state.winner) break;
    if (!surveyed(system, faction) || !system.anomaly || system.anomaly.resolved || system.owner && system.owner !== faction.id || observedEnemies(state, faction, system.id).length) continue;
    const choices = ANOMALIES[system.anomaly.id].choices.filter(choice => canPay(faction, choice.cost));
    const value = choice => (choice.gain?.minerals || 0) * (faction.minerals < 80 ? 1.4 : .65) + (choice.gain?.science || 0) * (faction.research ? 1.1 : .65) + (choice.gain?.credits || 0) * (faction.credits < 70 ? 1.3 : .35) + (choice.ship ? 60 : 0) + (choice.population ? 30 : 0) + (choice.habitability && !system.owner && system.habitability < 50 ? 45 : 0) + (choice.reveal ? 25 : 0);
    choices.sort((a, b) => value(b) - value(a));
    if (choices[0]) act({ type: 'anomaly', systemId: system.id, choiceId: choices[0].id });
  }
}

function civilianTurn(state, faction, act) {
  const minimum = faction.techs.includes('terraforming') ? 0 : faction.techs.includes('ecology') ? 30 : 50;
  const reserved = new Set();
  const fleets = ownFleets(state, faction).filter(f => !military(f)).sort((a, b) => a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'colony' ? -1 : 1);
  for (const fleet of fleets) {
    if (!fleetOf(state, fleet.id) || faction.orders < 1 || state.winner) continue;
    let system = systemOf(state, fleet.systemId);
    if (observedEnemies(state, faction, system.id).length) { retreat(state, faction, fleet, act); continue; }
    if (fleet.type === 'colony') {
      if (!system.owner && system.habitability >= minimum) { act({ type: 'colonize', fleetId: fleet.id }); continue; }
      if (fleet.movesLeft < 1) continue;
      const candidates = getVisibleSystems(state, faction.id).filter(s => !s.owner && surveyed(s, faction) && s.habitability >= minimum && !reserved.has(s.id) && !observedEnemies(state, faction, s.id).length && !ownFleets(state, faction).some(f => f.type === 'colony' && f.id !== fleet.id && f.systemId === s.id));
      const destinations = candidates.map(target => ({ target, route: route(state, faction, fleet, target.id, { peaceful: true }) })).filter(item => item.route).sort((a, b) => a.route.cost - b.route.cost || (b.target.habitability + b.target.richness * 5) - (a.target.habitability + a.target.richness * 5));
      const destination = destinations[0];
      if (!destination) continue;
      reserved.add(destination.target.id);
      const result = act({ type: 'move', fleetId: fleet.id, targetId: destination.route.path[1] });
      if (!result.ok || result.outcome === 'intercepted' || !fleetOf(state, fleet.id)) continue;
      system = systemOf(state, fleet.systemId);
      if (!system.owner && system.habitability >= minimum && faction.orders > 0) act({ type: 'colonize', fleetId: fleet.id });
    } else {
      for (let move = 0; move < 2 && fleet.movesLeft > 0 && faction.orders > 1; move++) {
        const destinations = getVisibleSystems(state, faction.id).filter(s => !surveyed(s, faction) && !observedEnemies(state, faction, s.id).length).map(target => route(state, faction, fleet, target.id, { peaceful: true })).filter(Boolean).sort((a, b) => a.cost - b.cost);
        if (!destinations[0] || destinations[0].path.length < 2) break;
        const result = act({ type: 'move', fleetId: fleet.id, targetId: destinations[0].path[1] });
        if (!result.ok || result.outcome === 'intercepted' || !fleetOf(state, fleet.id)) break;
      }
    }
  }
}

function buildAt(state, faction, system, priorities, act) {
  if (faction.orders < 1 || system.queue || system.owner !== faction.id) return false;
  const options = getBuildOptions(state, system.id, faction.id);
  const itemId = priorities.find(id => options.some(option => option.id === id && option.enabled));
  return itemId ? act({ type: 'build', systemId: system.id, itemId }).ok : false;
}

function emergencyConstruction(state, faction, threats, act) {
  for (const { colony, required, stationed } of threats) {
    if (faction.orders < 2 || state.winner) break;
    if (stationed >= required) continue;
    const priorities = ['bastion'];
    if (!colony.buildings.includes('shipyard')) priorities.push('shipyard');
    priorities.push(faction.techs.includes('cruisers') ? 'cruiser' : 'frigate');
    buildAt(state, faction, colony, priorities, act);
  }
}

function economicTurn(state, faction, act) {
  const colonies = state.systems.filter(system => system.owner === faction.id);
  const minimum = faction.techs.includes('terraforming') ? 0 : faction.techs.includes('ecology') ? 30 : 50;
  const expansion = getVisibleSystems(state, faction.id).some(system => !system.owner && surveyed(system, faction) && system.habitability >= minimum);
  const atAnyWar = Object.values(faction.relations).some(relation => relation.status === 'war');
  for (const system of colonies.filter(s => !s.queue)) {
    if (faction.orders < 1 || state.winner) break;
    const stats = getEmpireStats(state, faction.id), fleets = ownFleets(state, faction);
    const settling = fleets.filter(f => f.type === 'colony').length + colonies.filter(s => s.queue?.itemId === 'colony').length;
    const queuedMilitary = colonies.reduce((power, s) => power + (s.queue?.kind === 'ship' ? SHIPS[s.queue.itemId]?.attack || 0 : 0), 0);
    const desiredMilitary = (faction.id === 'khar' ? 26 : 12) * colonies.length + (atAnyWar ? 50 : 0);
    const priorities = [];
    if (faction.techs.includes('singularity') && stats.beacons < 3 && faction.minerals > 220) priorities.push('beacon');
    if (faction.credits < 60 || stats.creditIncome < 4) priorities.push('market');
    if (stats.mineralIncome < colonies.length * 6) priorities.push('mine');
    if (expansion && settling < Math.min(2, Math.ceil(colonies.length / 3)) && faction.minerals > 70 && faction.credits > 65) priorities.push('colony');
    if (!fleets.some(f => f.type === 'scout') && !colonies.some(s => s.queue?.itemId === 'scout')) priorities.push('scout');
    if (stats.military + queuedMilitary < desiredMilitary) priorities.push(faction.techs.includes('cruisers') ? 'cruiser' : 'frigate');
    priorities.push('factory', 'lab', 'market', 'mine', 'forum', 'habitat');
    if (colonies.length > 2 && !system.buildings.includes('shipyard') && system.richness >= 3) priorities.push('shipyard');
    if (atAnyWar) priorities.push('bastion');
    buildAt(state, faction, system, priorities, act);
  }
}

export function runAI(state, faction) {
  if (!faction || faction.eliminated || state.winner) return;
  const id = faction.id;
  const act = action => command(state, { ...action, factionId: id });
  if (!faction.research) {
    const priorities = id === 'khar' ? ['weapons', 'logistics', 'shields', 'cruisers', 'industry', 'physics', 'ecology', 'computing', 'singularity', 'diplomacy', 'command', 'terraforming'] : id === 'choir' ? ['physics', 'logistics', 'computing', 'industry', 'singularity', 'ecology', 'weapons', 'diplomacy', 'shields', 'command', 'cruisers', 'terraforming'] : ['logistics', 'ecology', 'diplomacy', 'industry', 'physics', 'computing', 'weapons', 'singularity', 'command', 'shields', 'cruisers', 'terraforming'];
    const options = getResearchOptions(state, id);
    const techId = priorities.find(tech => options.some(option => option.id === tech && option.enabled));
    if (techId) act({ type: 'research', techId });
  }
  for (const proposal of getDiplomaticIntent(state, id)) {
    if (faction.orders < 2) break;
    act(proposal);
  }
  const threats = militaryTurn(state, faction, act);
  emergencyConstruction(state, faction, threats, act);
  civilianTurn(state, faction, act);
  anomalyTurn(state, faction, act);
  economicTurn(state, faction, act);
}
