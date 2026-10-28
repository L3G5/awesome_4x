/**
 * Strategic decisions use charted sovereignty, remembered surveys and live
 * sensors. Every action goes through the same command rules as the player.
 * Imports are only called during a turn, so game.js may safely import runAI.
 */
import { command, getNeighbors, getVisibleSystems, getEmpireStats, getBuildOptions, getResearchOptions, estimateCombat, fleetPower, getSystemYield, getInfrastructure, getDevelopmentOptions, CHARTERS, LAST_TURN } from './game.js';
import { hasSensors, getVisibleFleets } from './intelligence.js';
import { ANOMALIES, SHIPS, BUILDINGS, TECHS } from './content.js';
import { getDiplomaticIntent, getDiplomacyForecast } from './diplomacy.js';
import { ALIGNMENT_RULES, getPublicRaces, getAlignmentStatus } from './victory.js';
import { getDiscoveryView, getDiscoveryOptions } from './discoveries.js';

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
function route(state, faction, fleet, targetId, { peaceful = false, interventionOwner = null } = {}) {
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
      if (!enterable(faction, system) && system.owner !== interventionOwner) continue;
      const enemies = getVisibleFleets(state, faction.id, next).filter(other => war(faction, other.owner) || other.owner === interventionOwner);
      const opposition = enemies.reduce((total, f) => total + strength(state, f), 0);
      if (enemies.length && (peaceful || !military(fleet))) continue;
      if (opposition > 0 && power < opposition * 1.18) continue;
      // Retreat and reinforcement prefer friendly territory over uncertain
      // hostile systems, even if the hostile route is one jump shorter.
      const uncertainHostile = (war(faction, system.owner) || interventionOwner && system.owner === interventionOwner) && !hasSensors(state, faction.id, next);
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
    const beaconPriority = (here || nearby) && faction.alignment?.active && faction.alignment.sites.includes(colony.id) ? 60 : 0;
    return { colony, here, nearby, required, stationed, sourceId: here > 0 ? colony.id : approaches[0]?.systemId || null, urgency: (here ? 100 + here + colony.population * 2 : nearby ? 40 + nearby + Math.max(0, required - stationed) * .3 : 0) + beaconPriority };
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
  const intervention = raceIntervention(state, faction);
  if (intervention && war(faction, intervention.race.factionId)) return intervention.site;
  const hostiles = getVisibleSystems(state, faction.id).filter(system => war(faction, system.owner) || enemyStrength(state, faction, system.id) > 0);
  if (!hostiles.length) return null;
  const previous = hostiles.find(system => system.id === faction.strategy?.objectiveId);
  if (previous) return previous;
  const origins = state.systems.filter(s => s.owner === faction.id).map(s => knownDistances(state, faction, s.id));
  const distance = system => Math.min(...origins.map(distances => distances.get(system.id) ?? 100), 100);
  return hostiles.sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id))[0];
}

/** Public beacon broadcasts justify an achievable intervention, never omniscient targeting. */
function raceIntervention(state, faction, allowDeclaration = false) {
  const ownProgress = faction.alignment?.active ? faction.alignment.progress : -1;
  const candidates = [];
  for (const race of getPublicRaces(state, faction.id)) {
    if (race.factionId === faction.id || race.progress < 3 || race.progress <= ownProgress) continue;
    if (!war(faction, race.factionId) && (!allowDeclaration || !getDiplomacyForecast(state, faction.id, race.factionId).war.enabled)) continue;
    const participants = new Set(race.participatingSites);
    for (const beacon of race.sites.filter(site => participants.has(site.id))) {
      const site = systemOf(state, beacon.id);
      for (const fleet of ownFleets(state, faction).filter(fleet => military(fleet) && fleet.movesLeft > 0 && strength(state, fleet) >= 30)) {
        const observedGuard = getVisibleFleets(state, faction.id, site.id).filter(other => other.owner === race.factionId).reduce((total, other) => total + strength(state, other), 0);
        if (observedGuard * 1.18 > strength(state, fleet)) continue;
        const travel = route(state, faction, fleet, site.id, { interventionOwner: race.factionId });
        // Military routing currently commits one hop per AI cycle. Use that
        // conservative speed rather than promise an interception we cannot make.
        if (!travel || travel.path.length - 1 > race.target - race.progress) continue;
        candidates.push({ race, site, fleet, travel });
      }
    }
  }
  return candidates.sort((a, b) => b.race.progress - a.race.progress || a.travel.cost - b.travel.cost || a.site.id.localeCompare(b.site.id))[0] || null;
}

function defendAlignment(state, faction, fleet, act) {
  if (!faction.alignment?.active) return false;
  const sites = getAlignmentStatus(state, faction.id).sites.map(id => systemOf(state, id));
  if (!sites.length) return false;
  const choices = sites.map(site => ({ site, travel: route(state, faction, fleet, site.id, { peaceful: true }), stationed: friendlyStrength(state, faction, site.id, fleet.id) }))
    .filter(item => item.travel).sort((a, b) => a.stationed - b.stationed || a.travel.cost - b.travel.cost || a.site.id.localeCompare(b.site.id));
  const destination = choices[0];
  if (!destination) return false;
  if (destination.site.id === fleet.systemId) return true;
  return act({ type: 'move', fleetId: fleet.id, targetId: destination.travel.path[1] }).ok;
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

function militaryTurn(state, faction, act, ordinaryAct = act) {
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
      (opposition > 0 ? act : ordinaryAct)({ type: 'repair', fleetId: fleet.id });
    }
  }
  const threats = threatsToColonies(state, faction);
  const objective = selectObjective(state, faction, threats);
  const raceTarget = raceIntervention(state, faction);
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
    if (!threats.length && faction.alignment?.active && !raceTarget && defendAlignment(state, faction, fleet, act)) continue;
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

function discoveryHorizon(state, faction) {
  // Only public commitments shorten the planning horizon. A rival's hidden
  // research, treasury or discovery history cannot influence this estimate.
  const races = getPublicRaces(state, faction.id).filter(race => race.active && race.progress > 0);
  const stats = getEmpireStats(state, faction.id), colonies = state.systems.filter(system => system.owner === faction.id);
  const path = ['logistics', 'physics', 'computing', 'industry', 'singularity'];
  const research = Math.max(0, path.reduce((total, id) => total + (faction.techs.includes(id) ? 0 : TECHS[id].cost), 0) - (path.includes(faction.research?.techId) ? faction.research.progress : 0) - faction.science);
  const construction = colonies.filter(system => !system.buildings.includes('beacon')).map(system => Math.ceil(BUILDINGS.beacon.work / getSystemYield(state, system).production)).sort((a, b) => a - b);
  const missingHosts = Math.max(0, ALIGNMENT_RULES.sites - colonies.length);
  const constructionCycles = stats.beacons >= ALIGNMENT_RULES.sites ? 0 : Math.max(construction[Math.min(2 - stats.beacons, construction.length - 1)] || 0, missingHosts ? Math.ceil(BUILDINGS.beacon.work / 6) : 0);
  const networkCycles = Math.ceil(research / Math.max(1, stats.scienceIncome)) + constructionCycles + missingHosts * 6 + ALIGNMENT_RULES.target;
  return Math.max(0, Math.min(45, LAST_TURN - state.turn, networkCycles, ...races.map(race => race.target - race.progress + 6)));
}

function discoveryWeights(state, faction, role) {
  const stats = getEmpireStats(state, faction.id);
  const remainingResearch = Math.max(0, Object.values(TECHS).filter(tech => !faction.techs.includes(tech.id)).reduce((total, tech) => total + tech.cost, 0) - (faction.research?.progress || 0) - faction.science);
  return {
    credits: stats.creditIncome < (faction.alignment?.active ? ALIGNMENT_RULES.cost : 10) ? 1.3 : .6,
    minerals: stats.mineralIncome < stats.colonies * 6 ? 1.2 : .75,
    science: (faction.research ? 1.1 : .65) * (faction.id === 'choir' ? 1.25 : 1) * Math.min(1, remainingResearch / Math.max(1, stats.scienceIncome * discoveryHorizon(state, faction))),
    production: role === 'forge' ? 1.3 : .9,
  };
}

const resourceValue = (resources, weights) => Object.entries(weights).reduce((total, [id, weight]) => total + (resources?.[id] || 0) * weight, 0);

/** A paid site must repay its cost, forgone portable reward and displaced output. */
function restorationPlan(state, faction, system, buildingId, role, mature = false) {
  if (system.owner !== faction.id || system.buildings.includes(buildingId)) return null;
  const item = BUILDINGS[buildingId], weights = discoveryWeights(state, faction, role);
  const replacements = getInfrastructure(state, system).available ? [null] : replacementCandidates(state, faction, system, buildingId, role);
  const yieldOf = id => ({ ...BUILDINGS[id], science: (BUILDINGS[id]?.science || 0) + (id === 'lab' && faction.techs.includes('computing') ? 4 : 0) });
  const matchingRole = item.science && role === 'academy' || item.minerals && ['forge', 'extraction'].includes(role);
  return replacements.map(replaceBuildingId => {
    const options = mature ? getDiscoveryOptions(state, system.id, faction.id, replaceBuildingId) : getBuildOptions(state, system.id, faction.id, replaceBuildingId);
    const option = options.find(option => mature ? option.buildingId === buildingId : option.id === buildingId);
    if (!option) return null;
    const productiveCycles = Math.max(0, discoveryHorizon(state, faction) - Math.ceil(item.work / Math.max(1, getSystemYield(state, system).production)));
    const output = resourceValue(yieldOf(buildingId), weights) * (matchingRole ? 1.25 : 1) - resourceValue(yieldOf(replaceBuildingId), weights);
    const value = output * productiveCycles - resourceValue(option.cost, weights) - item.work * .2;
    return { option, replaceBuildingId, value };
  }).filter(Boolean).sort((a, b) => b.value - a.value || String(a.replaceBuildingId).localeCompare(String(b.replaceBuildingId)))[0] || null;
}

function canMatureDiscovery(state, faction, system, definition, role) {
  if (discoveryHorizon(state, faction) < 8) return false;
  if (!system.owner) {
    const minimum = faction.techs.includes('terraforming') ? 0 : faction.techs.includes('ecology') ? 30 : 50;
    return system.habitability >= minimum && ownFleets(state, faction).some(fleet => fleet.systemId === system.id && fleet.type === 'colony');
  }
  if (system.owner !== faction.id) return false;
  return system.buildings.includes(definition.support) || system.queue?.itemId === definition.support || getInfrastructure(state, system).available > 0 || replacementCandidates(state, faction, system, definition.support, role).length > 0;
}

function discoverySettlementPriority(state, faction, system) {
  const view = getDiscoveryView(state, system.id, faction.id);
  if (!view || !ANOMALIES[view.id].multiStage || !['opening', 'maturing', 'ready'].includes(view.phase)) return 0;
  // A remembered opportunity remains a planning lead, not proof that nobody
  // has touched the remote site since its last survey.
  return view.phase === 'opening' ? .7 : 1.4;
}

function promisingSettlementDiscovery(state, faction, system) {
  const minimum = faction.techs.includes('terraforming') ? 0 : faction.techs.includes('ecology') ? 30 : 50;
  if (system.owner || system.habitability < minimum || discoveryHorizon(state, faction) < 12) return false;
  const arks = ownFleets(state, faction).filter(fleet => fleet.type === 'colony');
  if (arks.some(fleet => { const travel = route(state, faction, fleet, system.id, { peaceful: true }); return travel && travel.path.length <= 4; })) return true;
  // A shipyard within three charted jumps can plausibly send another Ark.
  // Distant, inaccessible sites still offer their immediate expedition reward.
  return state.systems.filter(colony => colony.owner === faction.id && colony.buildings.includes('shipyard')).some(colony => (knownDistances(state, faction, colony.id).get(system.id) ?? Infinity) <= 3);
}

function anomalyTurn(state, faction, act) {
  const colonies = state.systems.filter(system => system.owner === faction.id), roles = colonyRoles(state, faction, colonies);
  const locations = new Set(ownFleets(state, faction).map(f => f.systemId));
  for (const system of state.systems.filter(s => locations.has(s.id) || s.owner === faction.id)) {
    if (faction.orders <= 1 || state.winner) break;
    const view = getDiscoveryView(state, system.id, faction.id);
    if (!view?.canInteract || observedEnemies(state, faction, system.id).length) continue;
    const definition = ANOMALIES[view.id], role = roles.get(system.id);
    if (view.phase === 'resolved') {
      // The right to restore survives cancellation and conquest. Rebuilding
      // pays normal construction costs and never repeats a discovery reward.
      if (view.site?.state === 'planned') {
        const plan = restorationPlan(state, faction, system, view.site.id, role);
        if (plan?.value > 0 && plan.option.enabled && canSpend(state, faction, plan.option.cost)) {
          act({ type: 'build', systemId: system.id, itemId: view.site.id, ...(plan.replaceBuildingId ? { replaceBuildingId: plan.replaceBuildingId } : {}) });
        }
      }
      continue;
    }
    if (view.phase === 'maturing') {
      if (!system.buildings.includes(definition.support)) buildAt(state, faction, system, [definition.support], act, { role, replace: true });
      continue;
    }
    const choices = getDiscoveryOptions(state, system.id, faction.id);
    if (view.phase === 'opening' && definition.multiStage && canMatureDiscovery(state, faction, system, definition, role)) {
      const preservation = choices.find(choice => choice.kind === 'preserve');
      // Keep an achievable long-term opportunity while saving or researching
      // its prerequisite; a temporary funding shortage is not a salvage order.
      if (preservation?.enabled && canSpend(state, faction, preservation.cost) && act({ type: 'anomaly', systemId: system.id, choiceId: preservation.id }).ok && system.owner === faction.id && !system.buildings.includes(definition.support)) {
        buildAt(state, faction, system, [definition.support], act, { role, replace: true });
      }
      continue;
    }
    if (view.phase === 'opening' && definition.multiStage && promisingSettlementDiscovery(state, faction, system)) continue;
    if (view.phase === 'ready') {
      const plan = restorationPlan(state, faction, system, definition.siteId, role, true);
      const reward = choices.find(choice => choice.kind === 'resolve');
      if (plan && plan.value > resourceValue(reward?.gain, discoveryWeights(state, faction, role))) {
        if (plan.option.enabled && canSpend(state, faction, plan.option.cost)) act({ type: 'anomaly', systemId: system.id, choiceId: plan.option.id, ...(plan.replaceBuildingId ? { replaceBuildingId: plan.replaceBuildingId } : {}) });
        continue;
      }
    }
    const value = choice => (choice.gain?.minerals || 0) * (faction.minerals < 80 ? 1.4 : .65) + (choice.gain?.science || 0) * (faction.research ? 1.1 : .65) + (choice.gain?.credits || 0) * (faction.credits < 70 ? 1.3 : .35) + (choice.ship ? 60 : 0) + (choice.population ? 30 : 0) + (choice.habitability && !system.owner && system.habitability < 50 ? 45 : 0) + (choice.reveal ? 25 : 0);
    const immediate = choices.filter(choice => choice.kind === 'resolve' && choice.enabled && canSpend(state, faction, choice.cost)).sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
    if (immediate[0]) act({ type: 'anomaly', systemId: system.id, choiceId: immediate[0].id });
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
      const destinations = candidates.map(target => ({ target, route: route(state, faction, fleet, target.id, { peaceful: true }) })).filter(item => item.route).sort((a, b) => (a.route.cost - discoverySettlementPriority(state, faction, a.target)) - (b.route.cost - discoverySettlementPriority(state, faction, b.target)) || (b.target.habitability + b.target.richness * 5) - (a.target.habitability + a.target.richness * 5));
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

/** Savings are a commitment, including when the treasury has not reached it yet. */
function resourceReserve(state, faction) {
  const colonies = state.systems.filter(system => system.owner === faction.id);
  const committed = colonies.filter(system => system.buildings.includes('beacon') || system.queue?.itemId === 'beacon').length;
  const nextBeacon = faction.techs.includes('singularity') && committed < 3;
  const aligning = faction.alignment?.active || colonies.filter(system => system.buildings.includes('beacon')).length >= 3;
  return {
    credits: (nextBeacon ? BUILDINGS.beacon.cost.credits : 0) + (aligning ? ALIGNMENT_RULES.cost : 0),
    minerals: nextBeacon ? BUILDINGS.beacon.cost.minerals : 0,
  };
}

function needsAlignmentIncome(state, faction) {
  return faction.techs.includes('singularity') && getEmpireStats(state, faction.id).beacons >= ALIGNMENT_RULES.sites && getEmpireStats(state, faction.id).creditIncome < ALIGNMENT_RULES.cost;
}

function canSpend(state, faction, cost = {}) {
  const reserve = resourceReserve(state, faction);
  return canPay(faction, cost) && ['credits', 'minerals'].every(key => !(cost[key] > 0) || faction[key] - cost[key] >= reserve[key]);
}

function actionCost(state, faction, action) {
  if (action.type === 'build') return getBuildOptions(state, action.systemId, faction.id, action.replaceBuildingId).find(option => option.id === action.itemId)?.cost;
  if (action.type === 'develop') return getDevelopmentOptions(state, action.systemId, faction.id).find(option => option.charterType === action.charterType)?.cost;
  if (action.type === 'colonize') return { credits: 30, minerals: 20 };
  if (action.type === 'repair') return { minerals: 10 };
  if (action.type === 'anomaly') return getDiscoveryOptions(state, action.systemId, faction.id, action.replaceBuildingId).find(choice => choice.id === action.choiceId)?.cost;
  if (action.type === 'diplomacy') {
    const cost = getDiplomacyForecast(state, faction.id, action.targetId).actions[action.stance]?.cost;
    return { credits: cost?.credits || 0 };
  }
  return {};
}

/** Replace low-value infrastructure without dismantling an established role. */
function replacementCandidates(state, faction, system, itemId, role, emergency = false, incomeRecovery = false) {
  const protectedIds = new Set(['beacon', CHARTERS[system.charter?.type]?.support, CHARTERS[role]?.support]);
  const discovery = getDiscoveryView(state, system.id, faction.id);
  if (discovery?.phase === 'maturing') protectedIds.add(ANOMALIES[discovery.id].support);
  const colonies = state.systems.filter(colony => colony.owner === faction.id);
  if (system.buildings.includes('shipyard') && (colonies.filter(colony => colony.buildings.includes('shipyard')).length <= 1 || role === 'forge' || system.id === faction.strategy?.rallyId)) protectedIds.add('shipyard');
  const stats = getEmpireStats(state, faction.id);
  const nativeCapacity = 5 + Math.floor(system.habitability / 25);
  if (incomeRecovery && system.population >= nativeCapacity - 1) protectedIds.add('habitat');
  const retainedValue = { mine: stats.mineralIncome < colonies.length * 6 ? 90 : 35, lab: 50, market: stats.creditIncome < (faction.alignment?.active ? 70 : 12) ? 90 : 25, shipyard: 40, factory: 55, forum: stats.maxOrders < 15 ? 45 : 20, habitat: system.population >= getSystemYield(state, system).capacity - 1 ? 65 : 10, bastion: observedEnemies(state, faction, system.id).length ? 100 : 15 };
  const value = id => retainedValue[id] || 30;
  return system.buildings.filter(id => !protectedIds.has(id) && id !== itemId)
    .filter(id => emergency || (id !== 'mine' || stats.mineralIncome - 5 >= Math.max(3, colonies.length * 3)) && (id !== 'market' || stats.creditIncome - 7 >= (faction.alignment?.active ? 60 : 3) || incomeRecovery && itemId === 'habitat' && system.population >= nativeCapacity - 1))
    .sort((a, b) => value(a) - value(b) || a.localeCompare(b));
}

function buildAt(state, faction, system, priorities, act, { role = null, emergency = false, replace = false, incomeRecovery = false } = {}) {
  if (faction.orders < 1 || system.queue || system.owner !== faction.id) return false;
  for (const itemId of priorities) {
    let option = getBuildOptions(state, system.id, faction.id).find(item => item.id === itemId);
    let replaceBuildingId;
    if (option?.kind === 'building' && !system.buildings.includes(itemId) && !getInfrastructure(state, system).available && replace) {
      for (const candidate of replacementCandidates(state, faction, system, itemId, role, emergency, incomeRecovery)) {
        const replacement = getBuildOptions(state, system.id, faction.id, candidate).find(item => item.id === itemId);
        if (replacement?.enabled) { option = replacement; replaceBuildingId = candidate; break; }
      }
    }
    const revenueException = incomeRecovery && ['market', 'forum', 'habitat'].includes(itemId) && needsAlignmentIncome(state, faction);
    if (!option?.enabled || !emergency && !revenueException && itemId !== 'beacon' && !canSpend(state, faction, option.cost)) continue;
    if (act({ type: 'build', systemId: system.id, itemId, ...(replaceBuildingId ? { replaceBuildingId } : {}) }).ok) return true;
  }
  return false;
}

function emergencyConstruction(state, faction, threats, act) {
  for (const { colony, required, stationed } of threats) {
    if (faction.orders < 2 || state.winner) break;
    if (stationed >= required) continue;
    const priorities = ['bastion'];
    if (!colony.buildings.includes('shipyard')) priorities.push('shipyard');
    priorities.push(faction.techs.includes('cruisers') ? 'cruiser' : 'frigate');
    buildAt(state, faction, colony, priorities, act, { emergency: true, replace: true });
  }
}

/** Roles use owned survey data and charted borders; hidden fleets never influence them. */
function colonyRoles(state, faction, colonies) {
  const roles = new Map(colonies.filter(system => system.charter).map(system => [system.id, system.charter.type]));
  const available = () => colonies.filter(system => !roles.has(system.id));
  const choose = (role, score) => {
    const candidate = available().sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
    if (candidate) roles.set(candidate.id, role);
  };
  const frontier = system => getNeighbors(state, system.id).map(id => systemOf(state, id)).filter(other => other.knownBy.includes(faction.id) && other.owner && other.owner !== faction.id).length;
  if (colonies.length >= 3 && ![...roles.values()].includes('forge')) choose('forge', system => getSystemYield(state, system).production + (system.buildings.includes('shipyard') ? 8 : 0) + frontier(system) * 3 + (system.id === faction.strategy?.rallyId ? 4 : 0));
  if (available().length && ![...roles.values()].includes('extraction')) choose('extraction', system => system.richness * 5 - system.science + (system.buildings.includes('mine') ? 2 : 0));
  if (available().length && ![...roles.values()].includes('academy')) choose('academy', system => system.science * 5 - system.richness + (system.buildings.includes('lab') ? 2 : 0));
  if (colonies.length >= 4 && available().length && ![...roles.values()].includes('civic')) choose('civic', system => system.population * 2 + system.habitability / 20 + (system.buildings.includes('forum') ? 3 : 0));
  for (const system of available()) {
    const roleCounts = role => [...roles.values()].filter(value => value === role).length;
    const candidates = [
      ['extraction', system.richness * 2.4 - roleCounts('extraction') * 3],
      ['academy', system.science * 2.8 + (faction.id === 'choir' ? 3 : 0) - roleCounts('academy') * 3],
      ['civic', system.population + (faction.id === 'veyr' ? 2 : 0) - roleCounts('civic') * 4],
    ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    roles.set(system.id, candidates[0][0]);
  }
  return roles;
}

function beaconConstruction(state, faction, colonies, roles, act) {
  if (!faction.techs.includes('singularity')) return;
  const committed = () => colonies.filter(system => system.buildings.includes('beacon') || system.queue?.itemId === 'beacon').length;
  const score = system => {
    const output = getSystemYield(state, system);
    const approaches = getNeighbors(state, system.id).map(id => systemOf(state, id));
    const hostileBorder = approaches.filter(other => other.knownBy.includes(faction.id) && war(faction, other.owner)).length;
    return output.production * 5 + Math.min(output.defense, 90) * .2 + friendlyStrength(state, faction, system.id) * .1 - hostileBorder * 18;
  };
  const hosts = colonies.filter(system => !system.queue && !system.buildings.includes('beacon') && enemyStrength(state, faction, system.id) === 0).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  for (const host of hosts) {
    const funding = { ...BUILDINGS.beacon.cost, credits: BUILDINGS.beacon.cost.credits + (faction.alignment?.active ? ALIGNMENT_RULES.cost : 0) };
    if (committed() >= 3 || faction.orders < 1 || !canPay(faction, funding)) break;
    buildAt(state, faction, host, ['beacon'], act, { role: roles.get(host.id), replace: true });
  }
}

/**
 * Automatic alignment can repeatedly spend the last 60 credits before an
 * empire saves for a permanent income fix. Revenue projects may use that
 * payment, at normal prices, to escape the loop. Housing can temporarily
 * replace a market, then new population opens room to restore the market.
 */
function recoverAlignmentIncome(state, faction, system, role, act) {
  const options = { role, replace: true, incomeRecovery: true };
  if (buildAt(state, faction, system, ['market'], act, options)) return;
  if (!system.charter || system.charter.type === 'civic') {
    const civic = getDevelopmentOptions(state, system.id, faction.id).find(option => option.charterType === 'civic');
    if (civic?.enabled && canPay(faction, civic.cost) && act({ type: 'develop', systemId: system.id, charterType: 'civic' }).ok) return;
  }
  if (system.population >= getSystemYield(state, system).capacity - 1 && !system.buildings.includes('habitat')) {
    if (buildAt(state, faction, system, ['habitat'], act, options)) return;
  }
  buildAt(state, faction, system, ['forum'], act, options);
}

function economicTurn(state, faction, act) {
  const colonies = state.systems.filter(system => system.owner === faction.id);
  const roles = colonyRoles(state, faction, colonies);
  beaconConstruction(state, faction, colonies, roles, act);
  const minimum = faction.techs.includes('terraforming') ? 0 : faction.techs.includes('ecology') ? 30 : 50;
  const expansion = getVisibleSystems(state, faction.id).some(system => !system.owner && surveyed(system, faction) && system.habitability >= minimum);
  const atAnyWar = Object.values(faction.relations).some(relation => relation.status === 'war');
  for (const system of colonies.filter(s => !s.queue).sort((a, b) => getSystemYield(state, b).production - getSystemYield(state, a).production || a.id.localeCompare(b.id))) {
    if (faction.orders < 1 || state.winner) break;
    const stats = getEmpireStats(state, faction.id), fleets = ownFleets(state, faction);
    const role = roles.get(system.id), support = CHARTERS[role].support;
    if (needsAlignmentIncome(state, faction)) {
      recoverAlignmentIncome(state, faction, system, role, act);
      continue;
    }
    const settling = fleets.filter(f => f.type === 'colony').length + colonies.filter(s => s.queue?.itemId === 'colony').length;
    const queuedMilitary = colonies.reduce((power, s) => power + (s.queue?.kind === 'ship' ? SHIPS[s.queue.itemId]?.attack || 0 : 0), 0);
    const desiredMilitary = (faction.id === 'khar' ? 26 : 12) * colonies.length + (atAnyWar ? 50 : 0) + (faction.alignment?.active ? 36 : 0);
    const priorities = [];
    const incomeFloor = faction.alignment?.active || stats.beacons >= 3 ? 65 : 4;
    const hull = faction.techs.includes('cruisers') ? 'cruiser' : 'frigate';
    const needsMilitary = stats.military + queuedMilitary < desiredMilitary && stats.creditIncome >= SHIPS[hull].upkeep + incomeFloor;
    if (stats.creditIncome < incomeFloor) priorities.push('market');
    if (stats.mineralIncome < colonies.length * 4 && (role === 'extraction' || !getInfrastructure(state, system).used)) priorities.push('mine');
    if (role === 'forge' && !system.buildings.includes('shipyard')) priorities.push('shipyard');
    if (atAnyWar && needsMilitary) priorities.push(hull);
    if (expansion && settling < Math.min(2, Math.ceil(colonies.length / 3)) && faction.minerals > 70 && faction.credits > 65) priorities.push('colony');
    if (!fleets.some(f => f.type === 'scout') && !colonies.some(s => s.queue?.itemId === 'scout')) priorities.push('scout');
    // New hulls need both construction funding and an affordable future crew.
    if (needsMilitary) priorities.push(hull);
    if (buildAt(state, faction, system, priorities, act, { role, replace: true })) continue;

    if (system.buildings.includes(support)) {
      const development = getDevelopmentOptions(state, system.id, faction.id).find(option => option.charterType === role);
      // Level II is a mature investment; cash-poor empires still need working capital.
      if (development?.enabled && canSpend(state, faction, development.cost) && faction.credits - development.cost.credits >= Math.max(resourceReserve(state, faction).credits, development.level === 2 ? 100 : 45) && stats.creditIncome >= 0 && stats.mineralIncome >= colonies.length * 3) {
        if (act({ type: 'develop', systemId: system.id, charterType: role }).ok) continue;
      }
    }
    const specialization = [support];
    if (role === 'forge') specialization.push('shipyard');
    if (system.population >= getSystemYield(state, system).capacity - 1) specialization.push('habitat');
    // Fill spare capacity with role-specific complements. Never cycle through
    // all buildings or repeatedly replace one discretionary complement with another.
    const complements = role === 'extraction' ? ['market', 'factory'] : role === 'academy' ? ['market', 'habitat'] : role === 'forge' ? ['mine', 'bastion'] : ['market', 'lab'];
    if (buildAt(state, faction, system, specialization, act, { role, replace: !system.buildings.includes(support) })) continue;
    buildAt(state, faction, system, complements, act, { role });
  }
}

export function runAI(state, faction) {
  if (!faction || faction.eliminated || state.winner) return;
  const id = faction.id;
  const act = action => command(state, { ...action, factionId: id });
  const ordinaryAct = action => canSpend(state, faction, actionCost(state, faction, action)) ? act(action) : { ok: false, message: 'Resources committed to the ancient network.' };
  if (!faction.research) {
    const priorities = id === 'khar' ? ['weapons', 'logistics', 'shields', 'cruisers', 'industry', 'physics', 'ecology', 'computing', 'singularity', 'diplomacy', 'command', 'terraforming'] : id === 'choir' ? ['physics', 'logistics', 'computing', 'industry', 'singularity', 'ecology', 'weapons', 'diplomacy', 'shields', 'command', 'cruisers', 'terraforming'] : ['logistics', 'ecology', 'diplomacy', 'industry', 'physics', 'computing', 'weapons', 'singularity', 'command', 'shields', 'cruisers', 'terraforming'];
    if (needsAlignmentIncome(state, faction)) priorities.unshift('ecology', 'logistics', 'diplomacy', 'industry');
    const options = getResearchOptions(state, id);
    const techId = priorities.find(tech => options.some(option => option.id === tech && option.enabled));
    if (techId) act({ type: 'research', techId });
  }
  const intervention = threatsToColonies(state, faction).length ? null : raceIntervention(state, faction, true);
  if (intervention && !war(faction, intervention.race.factionId)) {
    act({ type: 'diplomacy', targetId: intervention.race.factionId, stance: 'war', reason: `An expedition can reach ${intervention.site.name} before its public Asterion alignment completes.` });
  }
  for (const proposal of getDiplomaticIntent(state, id)) {
    if (faction.orders < 2) break;
    if (proposal.stance === 'peace' && intervention?.race.factionId === proposal.targetId) continue;
    ordinaryAct(proposal);
  }
  const threats = militaryTurn(state, faction, act, ordinaryAct);
  emergencyConstruction(state, faction, threats, act);
  civilianTurn(state, faction, ordinaryAct);
  anomalyTurn(state, faction, ordinaryAct);
  economicTurn(state, faction, act);
}
