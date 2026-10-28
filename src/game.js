import { FACTIONS, PLANET_TYPES, SYSTEM_NAMES, TECHS, BUILDINGS, SHIPS, ANOMALIES } from './content.js';
import { hasSensors, getVisibleFleets } from './intelligence.js';
import { runAI } from './ai.js';
import { executeDiplomacy, advanceDiplomacy, validateDiplomacyState } from './diplomacy.js';
import { captureParticipant, finishParticipant, appendCombatReport, finalizeBriefing, summarizeCombatReports, validateReportState } from './reports.js';
import { CHARTERS, getInfrastructure, getCharterBonuses, getDevelopmentOptions, getConstructionProject, getConstructionCost, validateDevelopmentSystem } from './development.js';
import { getAlignmentStatus, advanceAlignment, revealPublicBeacons, validateAlignmentState } from './victory.js';
import { getRoutePreview, continuePlannedRoute, updateRouteAfterMove, reconcileRoutes, validateNavigationState } from './navigation.js';
import { placeDiscoveries, observeDiscovery, observeDiscoveries, getDiscoveryBuildReason, recordDiscoveryConstruction, executeDiscovery, mergeDiscoveryHeritage, advanceDiscoveries, validateDiscoveryState } from './discoveries.js';
import { recordSovereigntyTransfer, validatePublicAffairsState } from './public-affairs.js';
export { hasSensors, getVisibleFleets } from './intelligence.js';
export { getCombatReport } from './reports.js';
export { CHARTERS, getInfrastructure, getCharterBonuses, getDevelopmentOptions, getConstructionProject } from './development.js';
export { getRoutePreview, getRouteStatus } from './navigation.js';
export { getPublicRelationships, getPublicDispatches, getKnownTransfers } from './public-affairs.js';

export const SAVE_VERSION = 1;
export const LAST_TURN = 120;
const ids = Object.keys(FACTIONS);
const round = value => Math.round(value * 10) / 10;
const fail = message => ({ ok: false, message });
const success = message => ({ ok: true, message });
const factionOf = (state, id = 'player') => state.factions.find(f => f.id === id);
const systemOf = (state, id) => state.systems.find(s => s.id === id);
const fleetOf = (state, id) => state.fleets.find(f => f.id === id);
const has = (faction, tech) => faction.techs.includes(tech);
const canPay = (faction, cost = {}) => Object.entries(cost).every(([resource, amount]) => faction[resource] >= amount);
const pay = (faction, cost = {}) => { for (const [key, value] of Object.entries(cost)) faction[key] -= value; };

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function random(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function record(state, text, type = 'info', audience = null, metadata = {}) {
  if (audience && audience !== 'player') return;
  state.log.unshift({ id: state.nextLogId++, turn: state.turn, type, text, ...metadata });
  if (state.log.length > 160) state.log.length = 160;
}

export function getNeighbors(state, systemId) {
  return state.lanes.flatMap(([a, b]) => a === systemId ? [b] : b === systemId ? [a] : []);
}

function meet(state, firstId, secondId) {
  if (!firstId || !secondId || firstId === secondId) return;
  const a = factionOf(state, firstId), b = factionOf(state, secondId);
  if (!a.contacts.includes(secondId)) {
    a.contacts.push(secondId);
    b.contacts.push(firstId);
    if ([firstId, secondId].includes('player')) record(state, `First contact: ${firstId === 'player' ? b.name : a.name}. A diplomatic channel is open.`, 'diplomacy', null, { targetId: firstId === 'player' ? secondId : firstId });
    revealPublicBeacons(state);
  }
}

function chart(state, systemId, factionId) {
  const system = systemOf(state, systemId);
  if (!system.knownBy.includes(factionId)) system.knownBy.push(factionId);
  if (system.owner) meet(state, factionId, system.owner);
}

function survey(state, systemId, factionId) {
  const system = systemOf(state, systemId);
  chart(state, systemId, factionId);
  if (!system.exploredBy.includes(factionId)) {
    system.exploredBy.push(factionId);
    if (system.anomaly && !system.anomaly.resolved) record(state, `${system.name}: ${ANOMALIES[system.anomaly.id].name} detected. An expedition can investigate.`, 'discovery', factionId, { systemId });
    if (factionId === 'player' && state.turn > 1) record(state, `Survey complete at ${system.name}: ${PLANET_TYPES[system.type].name} world, ${system.habitability}% habitability.`, 'survey', null, { systemId });
  }
  for (const neighbor of getNeighbors(state, systemId)) chart(state, neighbor, factionId);
  for (const fleet of getVisibleFleets(state, factionId, systemId)) meet(state, factionId, fleet.owner);
  observeDiscovery(state, systemId, factionId);
}

export function getVisibleSystems(state, factionId = 'player') {
  return state.systems.filter(s => s.knownBy.includes(factionId));
}

function makeFleet(state, owner, systemId, type, ships = 1) {
  const template = SHIPS[type];
  const fleet = { id: `f${state.nextFleetId++}`, name: `${template.name} ${state.nextFleetId - 1}`, owner, systemId, type, ships, hp: template.hp * ships, movesLeft: template.moves + (has(factionOf(state, owner), 'command') && template.attack > 3 ? 1 : 0) };
  state.fleets.push(fleet);
  return fleet;
}

export function createGame(seed = 'ASTERION') {
  const state = { version: SAVE_VERSION, seed: String(seed), rng: hashSeed(seed), turn: 1, nextFleetId: 1, nextLogId: 1, nextCombatReportId: 1, systems: [], lanes: [], factions: [], fleets: [], log: [], combatReports: [], lastBriefing: null, winner: null, victoryType: null };
  for (const [index, id] of ids.entries()) {
    const template = FACTIONS[id];
    state.factions.push({ ...template, credits: 140, minerals: 110, science: 0, research: null, techs: [], orders: 0, contacts: [], capitalId: `s${index}`, eliminated: false, relations: Object.fromEntries(ids.filter(other => other !== id).map(other => [other, { status: 'peace', trust: id === 'khar' || other === 'khar' ? -10 : 10, trade: false, treatyTurn: 0 }])) });
  }
  const planetTypes = Object.keys(PLANET_TYPES);
  for (let index = 0; index < SYSTEM_NAMES.length; index++) {
    const home = index < 4;
    let x, y;
    if (home) {
      const angle = Math.PI * .25 + index * Math.PI / 2;
      x = Math.cos(angle) * 41;
      y = Math.sin(angle) * 41;
    } else {
      const angle = (index - 4) * 2.3999632297 + (random(state) - .5) * .24;
      const radius = 7 + Math.sqrt((index - 3) / 38) * 43;
      x = Math.cos(angle) * radius + (random(state) - .5) * 3;
      y = Math.sin(angle) * radius + (random(state) - .5) * 3;
    }
    const type = home ? 'terran' : planetTypes[Math.floor(random(state) * planetTypes.length)];
    const habitability = home ? 90 : { terran: 85, ocean: 75, arid: 60, ice: 40, volcanic: 25, barren: 15 }[type] + Math.floor(random(state) * 11) - 5;
    const anomalyKeys = Object.keys(ANOMALIES).filter(id => !ANOMALIES[id].multiStage);
    state.systems.push({ id: `s${index}`, name: SYSTEM_NAMES[index], x: round(x), y: round(y), type, habitability, richness: home ? 3 : 1 + Math.floor(random(state) * 5), science: home ? 2 : 1 + Math.floor(random(state) * 4), owner: home ? ids[index] : null, originalOwner: home ? ids[index] : null, population: home ? 4 : 0, growth: 0, buildings: home ? ['mine', 'shipyard'] : [], queue: null, defenseDamage: 0, anomaly: !home && index % 4 === 0 ? { id: anomalyKeys[Math.floor(random(state) * anomalyKeys.length)], resolved: false } : null, knownBy: [], exploredBy: [] });
  }
  // Prim's spanning tree guarantees every seeded map is connected. Short extra
  // lanes add alternate routes without erasing strategic chokepoints.
  const reached = new Set(['s0']);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const connect = (a, b) => { if (!state.lanes.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) state.lanes.push([a, b]); };
  while (reached.size < state.systems.length) {
    let best = null;
    for (const a of state.systems.filter(s => reached.has(s.id))) for (const b of state.systems.filter(s => !reached.has(s.id))) {
      const d = distance(a, b);
      if (!best || d < best.distance) best = { a, b, distance: d };
    }
    connect(best.a.id, best.b.id); reached.add(best.b.id);
  }
  for (const system of state.systems) {
    const nearest = [...state.systems].filter(s => s !== system).sort((a, b) => distance(system, a) - distance(system, b));
    for (const neighbor of nearest.slice(0, 2)) connect(system.id, neighbor.id);
  }
  placeDiscoveries(state);
  for (const faction of state.factions) {
    const neighbor = getNeighbors(state, faction.capitalId).map(id => systemOf(state, id)).find(s => !s.owner);
    if (neighbor) { neighbor.type = 'terran'; neighbor.habitability = Math.max(75, neighbor.habitability); }
    makeFleet(state, faction.id, faction.capitalId, 'scout');
    makeFleet(state, faction.id, faction.capitalId, 'colony');
    makeFleet(state, faction.id, faction.capitalId, 'frigate');
    survey(state, faction.capitalId, faction.id);
    faction.orders = getEmpireStats(state, faction.id).maxOrders;
  }
  record(state, 'The gates have been silent for centuries. Today, the Concord returns to the stars.', 'story');
  record(state, 'First mandate: send your Pathfinder through a starlane, then bring a Colony Ark to a habitable world.', 'objective');
  return state;
}

export function getSystemYield(state, system) {
  const faction = factionOf(state, system.owner);
  if (!faction) return { credits: 0, minerals: 0, science: 0, production: 0, growth: 0, capacity: 0, defense: 0 };
  const built = system.buildings.map(id => BUILDINGS[id]);
  const sum = key => built.reduce((total, building) => total + (building[key] || 0), 0);
  const charter = getCharterBonuses(system);
  return {
    credits: 3 + system.population * 2 + sum('credits') + charter.credits,
    minerals: system.richness + Math.floor(system.population / 3) + sum('minerals') + charter.minerals,
    science: system.science + Math.floor(system.population / 2) + sum('science') + (has(faction, 'physics') ? 2 : 0) + (has(faction, 'computing') && system.buildings.includes('lab') ? 4 : 0) + charter.science,
    production: 4 + system.population + sum('production') + charter.production,
    growth: Math.max(.08, system.habitability / 240) * (system.buildings.includes('habitat') ? 1.4 : 1) * (has(faction, 'terraforming') ? 1.5 : 1),
    capacity: 5 + Math.floor(system.habitability / 25) + (system.buildings.includes('habitat') ? 4 : 0),
    defense: Math.max(0, 12 + system.population * 3 + sum('defense') + (system.originalOwner ? 15 : 0) - system.defenseDamage),
  };
}

export function getEmpireStats(state, factionId = 'player') {
  const faction = factionOf(state, factionId);
  const colonies = state.systems.filter(s => s.owner === factionId);
  const fleets = state.fleets.filter(f => f.owner === factionId);
  const yields = colonies.map(s => getSystemYield(state, s));
  const sum = key => yields.reduce((total, output) => total + output[key], 0);
  const upkeep = fleets.reduce((total, f) => total + SHIPS[f.type].upkeep * f.ships, 0);
  const tradeIncome = Object.values(faction.relations).filter(r => r.trade).length * (has(faction, 'diplomacy') ? 10 : 6);
  const creditIncome = Math.floor(sum('credits') * (factionId === 'veyr' ? 1.25 : 1)) + tradeIncome - upkeep;
  const maxOrders = Math.min(18, 4 + colonies.length + (factionId === 'player' ? 1 : 0) + (has(faction, 'logistics') ? 1 : 0) + (has(faction, 'command') ? 2 : 0) + colonies.filter(s => s.buildings.includes('forum')).length + colonies.reduce((sum, system) => sum + getCharterBonuses(system).orders, 0));
  const population = colonies.reduce((total, s) => total + s.population, 0);
  const military = fleets.reduce((total, f) => total + fleetPower(state, f), 0);
  const beacons = colonies.filter(s => s.buildings.includes('beacon')).length;
  return { credits: faction.credits, minerals: faction.minerals, science: faction.science, creditIncome, mineralIncome: sum('minerals'), scienceIncome: Math.floor(sum('science') * (factionId === 'choir' ? 1.25 : 1)), production: sum('production'), upkeep, colonies: colonies.length, population, ships: fleets.reduce((n, f) => n + f.ships, 0), military: round(military), orders: faction.orders, maxOrders, score: colonies.length * 20 + population * 2 + faction.techs.length * 12 + beacons * 80 + Math.floor(military / 4), beacons, explored: state.systems.filter(s => s.exploredBy.includes(factionId)).length };
}

export function getResearchOptions(state, factionId = 'player') {
  const faction = factionOf(state, factionId);
  return Object.values(TECHS).map(tech => {
    const missing = tech.requires.filter(id => !has(faction, id));
    const completed = has(faction, tech.id);
    const active = faction.research?.techId === tech.id;
    const reason = completed ? 'Already discovered' : missing.length ? `Requires ${missing.map(id => TECHS[id].name).join(' and ')}` : active ? 'Research in progress' : '';
    return { ...tech, completed, active, enabled: !reason, reason };
  });
}

export function getBuildOptions(state, systemId, factionId = 'player', replaceBuildingId = null) {
  const system = systemOf(state, systemId), faction = factionOf(state, factionId);
  return [...Object.values(BUILDINGS).map(item => ({ ...item, kind: 'building' })), ...Object.values(SHIPS).map(item => ({ ...item, kind: 'ship' }))].map(item => {
    const cost = getConstructionCost(system, item, item.kind);
    let reason = '';
    if (!system || system.owner !== factionId) reason = 'Requires an owned colony';
    else if (system.queue) reason = 'Construction already in progress';
    else if (item.kind === 'building' && system.buildings.includes(item.id)) reason = 'Already built';
    else if (replaceBuildingId !== null && (item.kind !== 'building' || !system.buildings.includes(replaceBuildingId) || replaceBuildingId === item.id)) reason = 'Choose an existing building to replace with new infrastructure';
    else if (item.kind === 'building' && getInfrastructure(state, system).available === 0 && replaceBuildingId === null) reason = 'Infrastructure slots are full. Choose a building to replace';
    else if (item.requires.some(id => !has(faction, id))) reason = `Requires ${item.requires.filter(id => !has(faction, id)).map(id => TECHS[id].name).join(' and ')}`;
    else if (item.kind === 'ship' && !system.buildings.includes('shipyard')) reason = 'Requires an Orbital Shipyard';
    else if (getDiscoveryBuildReason(state, system, item.id, factionId)) reason = getDiscoveryBuildReason(state, system, item.id, factionId);
    else if (!canPay(faction, cost)) reason = 'Insufficient credits or minerals';
    else if (faction.orders < 1) reason = 'No orders remaining';
    return { ...item, cost, replaceBuildingId: item.kind === 'building' ? replaceBuildingId : null, enabled: !reason, reason, turns: system?.owner ? Math.ceil(item.work / getSystemYield(state, system).production) : 0 };
  });
}

export function getVictoryProgress(state, factionId = 'player') {
  const faction = factionOf(state, factionId), stats = getEmpireStats(state, factionId);
  const alignment = getAlignmentStatus(state, factionId);
  return { transcendence: { current: stats.beacons, target: 3, unlocked: has(faction, 'singularity'), alignment: alignment.progress, alignmentTarget: alignment.target, cost: alignment.cost, ready: alignment.ready, reason: alignment.reason, sites: alignment.sites }, domination: { current: state.systems.filter(s => s.originalOwner && s.owner === factionId).length, target: 4 }, legacy: { score: stats.score, turn: state.turn, finalTurn: LAST_TURN } };
}

export function fleetPower(state, fleet) {
  const faction = factionOf(state, fleet.owner);
  return SHIPS[fleet.type].attack * fleet.ships * (has(faction, 'weapons') ? 1.25 : 1) * (fleet.owner === 'khar' ? 1.15 : 1);
}

export function estimateCombat(state, fleetId, targetId) {
  const fleet = fleetOf(state, fleetId), target = systemOf(state, targetId);
  if (!fleet || !target) return null;
  const attack = fleetPower(state, fleet);
  if (!hasSensors(state, fleet.owner, targetId)) return { attack: round(attack), defense: null, garrison: null, odds: 'Unscouted', unknown: true };
  const enemies = getVisibleFleets(state, fleet.owner, targetId).filter(f => atWar(state, fleet.owner, f.owner));
  const defense = enemies.reduce((n, f) => n + fleetPower(state, f), 0);
  const garrison = target.owner && atWar(state, fleet.owner, target.owner) ? getSystemYield(state, target).defense : 0;
  return { attack: round(attack), defense: round(defense), garrison, odds: attack > defense * 1.5 + garrison * .45 ? 'Favorable' : attack > defense * .8 + garrison * .25 ? 'Contested' : 'Dangerous', unknown: false };
}

/** A pure forecast for bombarding the hostile colony this fleet occupies. */
export function estimateInvasion(state, fleetId) {
  const fleet = fleetOf(state, fleetId);
  if (!fleet || SHIPS[fleet.type].attack < 4 || !hasSensors(state, fleet.owner, fleet.systemId)) return null;
  const system = systemOf(state, fleet.systemId);
  if (!system?.owner || !atWar(state, fleet.owner, system.owner) || getVisibleFleets(state, fleet.owner, system.id).some(other => atWar(state, fleet.owner, other.owner))) return null;
  const defense = getSystemYield(state, system).defense;
  const power = fleetPower(state, fleet);
  const damageMin = Math.round(power * .9), damageMax = Math.round(power * (.9 + (4294967295 / 4294967296) * .2));
  const shielded = has(factionOf(state, fleet.owner), 'shields');
  const hullAfter = Math.max(0, round(fleet.hp - Math.max(4, defense * .28) * (shielded ? .8 : 1)));
  const retaliation = round(fleet.hp - hullAfter);
  return { systemId: system.id, defense, damageMin, damageMax, retaliation, shielded, capturePossible: hullAfter > 0 && damageMax >= defense, captureGuaranteed: hullAfter > 0 && damageMin >= defense };
}

function atWar(state, a, b) { return a !== b && factionOf(state, a).relations[b]?.status === 'war'; }

function damage(state, fleet, amount) {
  const shield = has(factionOf(state, fleet.owner), 'shields') ? .8 : 1;
  fleet.hp = Math.max(0, round(fleet.hp - amount * shield));
  fleet.ships = Math.ceil(fleet.hp / SHIPS[fleet.type].hp);
  if (!fleet.ships) state.fleets = state.fleets.filter(f => f.id !== fleet.id);
}

function decommissionShip(state, fleet) {
  // Administrative removal is not combat damage. Shields cannot protect a
  // ship from unpaid upkeep, and removing one ship must remove exactly one.
  fleet.ships--;
  if (fleet.ships <= 0) state.fleets = state.fleets.filter(f => f.id !== fleet.id);
  else fleet.hp = Math.min(fleet.hp, fleet.ships * SHIPS[fleet.type].hp);
}

function battle(state, attacker, defender) {
  const aStart = captureParticipant(attacker, 'attacker'), dStart = captureParticipant(defender, 'defender');
  for (let roundIndex = 0; roundIndex < 4 && attacker.hp > 0 && defender.hp > 0; roundIndex++) {
    const aHit = fleetPower(state, attacker) * (.85 + random(state) * .3);
    const dHit = fleetPower(state, defender) * (.85 + random(state) * .3);
    damage(state, attacker, dHit); damage(state, defender, aHit);
    if (aHit === 0 && dHit === 0) break;
  }
  if (attacker.owner === 'player' || defender.owner === 'player') {
    const participants = [finishParticipant(aStart, attacker), finishParticipant(dStart, defender)];
    const outcome = attacker.hp <= 0 && defender.hp <= 0 ? 'mutual-destruction' : attacker.hp <= 0 ? 'attacker-destroyed' : defender.hp <= 0 ? 'defender-destroyed' : 'contested';
    const casualties = participants.map(p => `${FACTIONS[p.owner].shortName} lost ${p.shipsBefore - p.shipsAfter} ship${p.shipsBefore - p.shipsAfter === 1 ? '' : 's'} and ${round(p.hullBefore - p.hullAfter)} hull`).join('; ');
    const ending = outcome === 'mutual-destruction' ? 'Both fleets destroyed.' : outcome === 'attacker-destroyed' ? 'Attacking fleet destroyed.' : outcome === 'defender-destroyed' ? 'Attacking fleet survives; defending fleet destroyed.' : 'Both fleets survive in orbit.';
    const summary = `Battle at ${systemOf(state, attacker.systemId).name}: ${casualties}. ${ending}`;
    const report = appendCombatReport(state, { kind: 'fleet', systemId: attacker.systemId, participants, outcome, summary });
    record(state, summary, 'combat', null, { systemId: attacker.systemId, reportId: report.id });
    return report;
  }
  return null;
}

function applyResearch(state, faction) {
  if (!faction.research) return;
  const tech = TECHS[faction.research.techId];
  const progress = Math.min(faction.science, tech.cost - faction.research.progress);
  faction.science -= progress;
  faction.research.progress += progress;
  if (faction.research.progress >= tech.cost) {
    faction.techs.push(tech.id); faction.research = null;
    record(state, `Research complete: ${tech.name}. ${tech.description}`, 'research', faction.id, { techId: tech.id });
  }
}

function canEnter(state, factionId, target) {
  return !target.owner || target.owner === factionId || atWar(state, factionId, target.owner) || factionOf(state, factionId).relations[target.owner].trade;
}

/** Every player mutation is validated before spending resources or orders. */
export function command(state, action) {
  if (!action || typeof action.type !== 'string') return fail('Invalid command.');
  if (state.winner) return fail('This campaign has ended. Start a new galaxy to continue.');
  const factionId = action.factionId || 'player';
  const faction = factionOf(state, factionId);
  if (!faction || faction.eliminated) return fail('This empire is no longer active.');
  if (action.type === 'endTurn') return factionId === 'player' ? endTurn(state) : fail('Only the player can advance the turn.');
  const freeActions = ['research', 'cancelBuild', 'planRoute', 'clearRoute', 'continueRoute'];
  if (!freeActions.includes(action.type) && faction.orders < 1) return fail('No orders remaining. End the turn to receive a new mandate.');
  const fleet = action.fleetId ? fleetOf(state, action.fleetId) : null;
  const system = action.systemId ? systemOf(state, action.systemId) : fleet ? systemOf(state, fleet.systemId) : null;
  if (action.fleetId && (!fleet || fleet.owner !== factionId)) return fail('Select one of your own fleets.');
  if (action.systemId && !system) return fail('Unknown system.');
  let result;
  switch (action.type) {
    case 'planRoute': {
      if (!fleet) return fail('Select a fleet first.');
      const preview = getRoutePreview(state, fleet.id, action.destinationId);
      if (!preview.ok) return fail(preview.reason);
      if (preview.jumps) fleet.route = { destinationId: preview.destinationId, path: [...preview.path] };
      else delete fleet.route;
      result = success(preview.jumps ? `Route plotted: ${preview.jumps} jump${preview.jumps === 1 ? '' : 's'} to ${systemOf(state, preview.destinationId).name}. Continue when ready.` : 'The fleet is already at this destination. Route cleared.');
      break;
    }
    case 'clearRoute': {
      if (!fleet) return fail('Select a fleet first.');
      delete fleet.route;
      result = success('Route cleared.');
      break;
    }
    case 'continueRoute': {
      if (!fleet) return fail('Select a fleet first.');
      result = continuePlannedRoute(state, fleet.id, move => command(state, move));
      if (!result.ok) return result;
      break;
    }
    case 'move': {
      if (!fleet) return fail('Select a fleet first.');
      const target = systemOf(state, action.targetId);
      if (!target || !getNeighbors(state, fleet.systemId).includes(target.id)) return fail('Fleets must follow a connected starlane, one jump at a time.');
      if (!target.knownBy.includes(factionId)) return fail('That starlane has not been charted.');
      if (fleet.movesLeft < 1) return fail('This fleet has used all its movement this turn.');
      if (!canEnter(state, factionId, target)) return fail('Borders are closed. Sign a trade treaty or declare war to enter.');
      const enemies = state.fleets.filter(f => f.systemId === target.id && atWar(state, factionId, f.owner));
      if (enemies.length && SHIPS[fleet.type].attack < 4) {
        if (hasSensors(state, factionId, target.id)) return fail('Civilian vessels cannot enter hostile fleet positions.');
        // An unknown interception is a spent expedition, not a free query of
        // the hidden game state. The vessel withdraws before surveying.
        fleet.movesLeft--; faction.orders--;
        for (const enemy of enemies) meet(state, factionId, enemy.owner);
        const observedShips = enemies.reduce((total, enemy) => total + enemy.ships, 0);
        const message = `${fleet.name} encountered ${observedShips} hostile ship${observedShips === 1 ? '' : 's'} at ${target.name} and withdrew to ${systemOf(state, fleet.systemId).name}. One order and one jump were spent; no survey was conducted.`;
        record(state, message, 'interception', factionId, { systemId: target.id });
        result = { ...success(message), outcome: 'intercepted' };
        break;
      }
      observeDiscovery(state, fleet.systemId, factionId);
      const originId = fleet.systemId;
      fleet.systemId = target.id; fleet.movesLeft--; faction.orders--;
      updateRouteAfterMove(fleet, originId, target.id);
      survey(state, target.id, factionId);
      const combatReports = [];
      for (const enemy of enemies) { if (fleet.hp > 0) { const report = battle(state, fleet, enemy); if (report) combatReports.push(report); } }
      result = combatReports.length ? { ...success(summarizeCombatReports(combatReports)), combatReports } : success(`${fleet.name} ${fleet.hp > 0 ? `arrived at ${target.name}.` : 'was lost in battle.'}`);
      if (enemies.length) result.combatOccurred = true;
      break;
    }
    case 'colonize': {
      if (!fleet || fleet.type !== 'colony') return fail('A Colony Ark is required.');
      if (system.owner) return fail('This world already belongs to an empire.');
      const minimum = has(faction, 'terraforming') ? 0 : has(faction, 'ecology') ? 30 : 50;
      if (system.habitability < minimum) return fail(`Habitability must be at least ${minimum}%. Research Adaptive Biospheres or Worldshaping.`);
      if (getVisibleFleets(state, factionId, system.id).some(f => atWar(state, factionId, f.owner))) return fail('Clear hostile fleets before founding a colony.');
      if (!canPay(faction, { credits: 30, minerals: 20 })) return fail('Founding a colony costs 30 credits and 20 minerals.');
      pay(faction, { credits: 30, minerals: 20 }); faction.orders--;
      system.owner = factionId; system.population = 1; system.growth = 0; system.defenseDamage = 0;
      state.fleets = state.fleets.filter(f => f.id !== fleet.id);
      survey(state, system.id, factionId);
      record(state, `A new beginning: ${system.name} joins ${FACTIONS[factionId].shortName}.`, 'colony', factionId, { systemId: system.id });
      result = success(`Colony founded at ${system.name}.`); break;
    }
    case 'build': {
      if (!system) return fail('Select a colony.');
      const option = getBuildOptions(state, system.id, factionId, action.replaceBuildingId ?? null).find(item => item.id === action.itemId);
      if (!option) return fail('Unknown construction project.');
      if (!option.enabled) return fail(option.reason);
      pay(faction, option.cost); faction.orders--;
      system.queue = { itemId: option.id, kind: option.kind, progress: 0, work: option.work, cost: { ...option.cost } };
      if (option.replaceBuildingId) system.queue.replaceBuildingId = option.replaceBuildingId;
      recordDiscoveryConstruction(state, system.id, factionId, option.id);
      result = success(`${option.name} commissioned at ${system.name}.`); break;
    }
    case 'develop': {
      if (!system) return fail('Select a colony.');
      const option = getDevelopmentOptions(state, system.id, factionId).find(charter => charter.charterType === action.charterType);
      if (!option) return fail('Unknown colonial charter.');
      if (!option.enabled) return fail(option.reason);
      pay(faction, option.cost); faction.orders--;
      system.queue = { itemId: option.charterType, kind: 'charter', charterType: option.charterType, charterLevel: option.level, progress: 0, work: option.work, cost: { ...option.cost } };
      result = success(`${option.name} commissioned at ${system.name}.`); break;
    }
    case 'cancelBuild': {
      if (!system || system.owner !== factionId || !system.queue) return fail('No owned construction project to cancel.');
      // Unspent work is refunded. Cancelling cannot generate resources.
      const fraction = 1 - system.queue.progress / system.queue.work;
      for (const [resource, amount] of Object.entries(system.queue.cost)) faction[resource] += Math.floor(amount * fraction);
      system.queue = null;
      result = success('Project cancelled. Unspent materials returned.'); break;
    }
    case 'research': {
      const option = getResearchOptions(state, factionId).find(tech => tech.id === action.techId);
      if (!option || !option.enabled) return fail(option?.reason || 'Unknown technology.');
      if (faction.research) faction.science += faction.research.progress;
      faction.research = { techId: option.id, progress: 0 };
      applyResearch(state, faction);
      result = success(`Research directed toward ${option.name}.`); break;
    }
    case 'anomaly': {
      result = executeDiscovery(state, { ...action, factionId, systemId: system?.id }, {
        makeFleet: (ownerId, systemId, type) => makeFleet(state, ownerId, systemId, type),
        chart: (systemId, ownerId) => chart(state, systemId, ownerId),
        applyResearch: owner => applyResearch(state, owner),
        build: buildAction => command(state, buildAction),
      });
      if (!result.ok) return result;
      break;
    }
    case 'diplomacy': {
      result = executeDiplomacy(state, { ...action, factionId });
      if (!result.ok) return result;
      break;
    }
    case 'attack': {
      if (!fleet || SHIPS[fleet.type].attack < 4) return fail('A military fleet is required.');
      if (fleet.movesLeft < 1) return fail('This fleet has used all its movement this turn.');
      const enemies = getVisibleFleets(state, factionId, fleet.systemId).filter(f => atWar(state, factionId, f.owner));
      if (!enemies.length && (!system.owner || !atWar(state, factionId, system.owner))) return fail('No hostile target in this system.');
      faction.orders--; fleet.movesLeft--;
      if (enemies.length) {
        const combatReports = [];
        for (const enemy of enemies) if (fleet.hp > 0) { const report = battle(state, fleet, enemy); if (report) combatReports.push(report); }
        result = { ...success(combatReports.length ? summarizeCombatReports(combatReports) : 'Fleet engagement resolved.'), combatReports }; break;
      }
      const before = captureParticipant(fleet, 'attacker'), ownerBefore = system.owner;
      const defense = getSystemYield(state, system).defense;
      const attack = fleetPower(state, fleet) * (.9 + random(state) * .2);
      system.defenseDamage += Math.round(attack);
      damage(state, fleet, Math.max(4, defense * .28));
      const defenseAfter = getSystemYield(state, system).defense;
      const captured = defenseAfter <= 0 && fleet.hp > 0;
      if (captured) {
        const observersBefore = [...system.knownBy];
        system.owner = factionId; system.population = Math.max(1, system.population - 1); system.defenseDamage = 0; system.queue = null;
        // A charted sovereign identifies its government, just as on initial
        // charting. This opens contact only, never surveys or local sensors.
        for (const observerId of observersBefore) meet(state, observerId, factionId);
        survey(state, system.id, factionId);
        recordSovereigntyTransfer(state, { systemId: system.id, fromId: ownerBefore, toId: factionId, observerIds: observersBefore });
      }
      const participant = finishParticipant(before, fleet);
      const invasion = { ownerBefore, ownerAfter: system.owner, defenseBefore: defense, defenseAfter, damage: round(defense - defenseAfter), damageRoll: Math.round(attack), retaliation: round(before.hullBefore - fleet.hp), captured };
      const outcome = captured ? 'captured' : fleet.hp <= 0 ? 'repelled' : 'bombardment';
      const summary = `Invasion of ${system.name}: ${invasion.damage} defense damage; ${defenseAfter} defenses remain. ${FACTIONS[factionId].shortName} lost ${before.shipsBefore - fleet.ships} ship${before.shipsBefore - fleet.ships === 1 ? '' : 's'} and ${invasion.retaliation} hull to retaliation. ${captured ? `${system.name} captured; invading fleet survives.` : fleet.hp <= 0 ? 'Invading fleet destroyed; colony holds.' : 'Invading fleet survives; colony holds.'}`;
      const report = appendCombatReport(state, { kind: 'invasion', systemId: system.id, participants: [participant], outcome, summary, invasion });
      if (report) record(state, summary, 'combat', null, { systemId: system.id, reportId: report.id });
      result = { ...success(summary), combatReports: report ? [report] : [] };
      break;
    }
    case 'merge': {
      const other = fleetOf(state, action.targetFleetId);
      if (!fleet || !other || other.id === fleet.id || other.owner !== factionId || other.type !== fleet.type || other.systemId !== fleet.systemId) return fail('Select two of your same-type fleets in the same system.');
      if (fleet.type === 'colony') return fail('Colony Arks operate independently.');
      if (fleet.ships + other.ships > 12) return fail('A task force can contain at most 12 ships.');
      mergeDiscoveryHeritage(fleet, other);
      fleet.ships += other.ships; fleet.hp += other.hp; fleet.movesLeft = Math.min(fleet.movesLeft, other.movesLeft);
      state.fleets = state.fleets.filter(f => f.id !== other.id); faction.orders--;
      result = success('Fleets combined into one task force.'); break;
    }
    case 'repair': {
      if (!fleet || system.owner !== factionId) return fail('Repair at a friendly colony.');
      if (fleet.hp >= fleet.ships * SHIPS[fleet.type].hp) return fail('This fleet is already fully repaired.');
      if (!canPay(faction, { minerals: 10 })) return fail('Emergency repairs cost 10 minerals.');
      pay(faction, { minerals: 10 }); faction.orders--;
      fleet.hp = Math.min(fleet.ships * SHIPS[fleet.type].hp, fleet.hp + 24);
      result = success('Emergency repairs completed.'); break;
    }
    default: return fail('Unknown command.');
  }
  reconcileRoutes(state);
  observeDiscoveries(state);
  checkVictory(state);
  return result;
}

export function availableActions(state, context = {}) {
  const factionId = context.factionId || 'player';
  return { build: context.systemId ? getBuildOptions(state, context.systemId, factionId, context.replaceBuildingId ?? null) : [], development: context.systemId ? getDevelopmentOptions(state, context.systemId, factionId) : [], research: getResearchOptions(state, factionId), neighbors: context.fleetId && fleetOf(state, context.fleetId) ? getNeighbors(state, fleetOf(state, context.fleetId).systemId) : [] };
}

function checkVictory(state) {
  if (state.winner) return;
  const qualifiers = [];
  // A shared resolution phase can finish several alignments. Rank all of its
  // qualifiers after eliminations, never by their position in factions[].
  const compareFinish = (first, second) => getEmpireStats(state, second.id).score - getEmpireStats(state, first.id).score
    || hashSeed(`${state.seed}:victory:${state.turn}:${second.id}`) - hashSeed(`${state.seed}:victory:${state.turn}:${first.id}`)
    || first.id.localeCompare(second.id);
  for (const faction of state.factions) {
    const colonies = state.systems.filter(s => s.owner === faction.id);
    const arks = state.fleets.some(f => f.owner === faction.id && f.type === 'colony');
    if (!colonies.length && !arks && !faction.eliminated) {
      faction.eliminated = true;
      state.fleets = state.fleets.filter(f => f.owner !== faction.id);
      for (const other of state.factions.filter(f => f.id !== faction.id)) { other.relations[faction.id].trade = false; other.relations[faction.id].tradeEndsAt = 0; faction.relations[other.id].trade = false; faction.relations[other.id].tradeEndsAt = 0; }
      if (faction.id === 'player' || factionOf(state, 'player').contacts.includes(faction.id)) record(state, `${faction.name} has collapsed.`, 'war', null, { targetId: faction.id });
    }
    if (colonies.length && !colonies.some(s => s.id === faction.capitalId)) faction.capitalId = colonies[0].id;
    const beacons = colonies.filter(s => s.buildings.includes('beacon')).length;
    const capitals = colonies.filter(s => s.originalOwner).length;
    const transcendent = has(faction, 'singularity') && beacons >= 3 && (faction.alignment?.progress || 0) >= 10;
    if (transcendent || capitals === 4) qualifiers.push({ faction, victoryType: transcendent ? 'Transcendence' : 'Domination' });
  }
  if (qualifiers.length) {
    qualifiers.sort((first, second) => compareFinish(first.faction, second.faction));
    state.winner = qualifiers[0].faction.id;
    state.victoryType = qualifiers[0].victoryType;
  }
  if (!state.winner && state.turn >= LAST_TURN) {
    const candidates = state.factions.filter(f => !f.eliminated).sort(compareFinish);
    if (candidates.length) { state.winner = candidates[0].id; state.victoryType = 'Legacy'; }
  }
  if (factionOf(state, 'player').eliminated && !state.winner) {
    state.winner = [...state.factions].filter(f => !f.eliminated).sort(compareFinish)[0]?.id || 'none';
    state.victoryType = 'Concord defeated';
  }
  if (state.winner) record(state, `${FACTIONS[state.winner]?.name || 'The galaxy'} achieves ${state.victoryType.toLowerCase()}. The chronicle of this age is complete.`, 'victory');
}

export function endTurn(state) {
  if (state.winner) return fail('This campaign has ended.');
  const firstLogId = state.nextLogId, firstReportId = state.nextCombatReportId || 1;
  for (const faction of state.factions.filter(f => f.id !== 'player')) runAI(state, faction);
  if (state.winner) { finalizeBriefing(state, firstLogId, firstReportId); return success('Campaign concluded.'); }
  state.turn++;
  advanceDiplomacy(state);
  reconcileRoutes(state);
  for (const faction of state.factions.filter(f => !f.eliminated)) {
    const stats = getEmpireStats(state, faction.id);
    faction.credits = Math.max(0, faction.credits + stats.creditIncome);
    faction.minerals += stats.mineralIncome;
    faction.science += stats.scienceIncome;
    if (stats.creditIncome < 0 && faction.credits === 0) {
      const fleet = state.fleets.filter(f => f.owner === faction.id).sort((a, b) => SHIPS[b.type].upkeep - SHIPS[a.type].upkeep)[0];
      if (fleet) { decommissionShip(state, fleet); record(state, 'Treasury exhausted: one ship was decommissioned to pay its crew. Build Exchange Ports or reduce fleet upkeep.', 'warning', faction.id); }
    }
    applyResearch(state, faction);
  }
  for (const system of state.systems.filter(s => s.owner)) {
    const output = getSystemYield(state, system);
    if (system.population < output.capacity) {
      system.growth = round(system.growth + output.growth);
      if (system.growth >= 1) { system.population++; system.growth = round(system.growth - 1); }
    } else system.growth = 0;
    if (system.queue) {
      system.queue.progress += output.production;
      if (system.queue.progress >= system.queue.work) {
        const item = getConstructionProject(system.queue);
        if (system.queue.kind === 'ship') makeFleet(state, system.owner, system.id, item.id);
        else if (system.queue.kind === 'charter') system.charter = { type: system.queue.charterType, level: system.queue.charterLevel };
        else {
          if (system.queue.replaceBuildingId) {
            system.buildings = system.buildings.filter(id => id !== system.queue.replaceBuildingId);
            if (system.charter && CHARTERS[system.charter.type].support === system.queue.replaceBuildingId) delete system.charter;
          }
          system.buildings.push(item.id);
        }
        record(state, `${system.name} completed ${item.name}.`, 'construction', system.owner, { systemId: system.id, ...(system.queue.kind === 'charter' ? {} : { itemId: item.id }) });
        system.queue = null;
      }
    }
    if (!getVisibleFleets(state, system.owner, system.id).some(f => atWar(state, system.owner, f.owner))) system.defenseDamage = Math.max(0, system.defenseDamage - 5);
  }
  advanceDiscoveries(state);
  for (const fleet of state.fleets) {
    const system = systemOf(state, fleet.systemId), faction = factionOf(state, fleet.owner);
    fleet.movesLeft = SHIPS[fleet.type].moves + (has(faction, 'command') && SHIPS[fleet.type].attack > 3 ? 1 : 0);
    if (system.owner === fleet.owner && !getVisibleFleets(state, fleet.owner, system.id).some(f => atWar(state, fleet.owner, f.owner))) fleet.hp = Math.min(fleet.ships * SHIPS[fleet.type].hp, fleet.hp + (system.buildings.includes('shipyard') ? 8 : 4) + getCharterBonuses(system).repair);
  }
  for (const faction of state.factions) faction.orders = faction.eliminated ? 0 : getEmpireStats(state, faction.id).maxOrders;
  advanceAlignment(state);
  checkVictory(state);
  finalizeBriefing(state, firstLogId, firstReportId);
  return success(`Turn ${state.turn}: a new mandate begins.`);
}

/** Validate imported browser saves before the renderer or simulation uses them. */
export function validateSave(value) {
  try { return isValidSave(value); } catch { return false; }
}

function isValidSave(value) {
  if (!value || value.version !== SAVE_VERSION || !Number.isInteger(value.turn) || value.turn < 1 || !Array.isArray(value.systems) || value.systems.length !== 42 || !Array.isArray(value.factions) || value.factions.length !== 4 || !Array.isArray(value.fleets) || !Array.isArray(value.lanes) || !Array.isArray(value.log)) return false;
  const text = item => typeof item === 'string' && item.length < 2000;
  const member = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
  if (!text(value.seed) || value.fleets.length > 1000 || value.log.length > 160) return false;
  const systemIds = new Set(value.systems.map(s => s.id));
  if (systemIds.size !== 42 || [...systemIds].some(id => !/^s([0-9]|[1-3][0-9]|4[01])$/.test(id)) || ids.some(id => !value.factions.some(f => f.id === id))) return false;
  if (!Number.isInteger(value.rng) || value.rng < 0 || value.rng > 4294967295 || !Number.isInteger(value.nextFleetId) || value.nextFleetId < 1 || !Number.isInteger(value.nextLogId) || value.nextLogId < 1) return false;
  if (value.winner !== null && !ids.includes(value.winner)) return false;
  for (const faction of value.factions) {
    if (!text(faction.name) || !text(faction.color) || !/^#[0-9a-f]{6}$/i.test(faction.color) || typeof faction.eliminated !== 'boolean' || !['credits', 'minerals', 'science', 'orders'].every(key => Number.isFinite(faction[key]) && faction[key] >= 0) || !Array.isArray(faction.techs) || faction.techs.some(id => !member(TECHS, id)) || new Set(faction.techs).size !== faction.techs.length || !Array.isArray(faction.contacts) || faction.contacts.some(id => !ids.includes(id)) || !systemIds.has(faction.capitalId) || !faction.relations) return false;
    if (faction.research && (!member(TECHS, faction.research.techId) || !Number.isFinite(faction.research.progress) || faction.research.progress < 0 || faction.research.progress >= TECHS[faction.research.techId].cost)) return false;
    if (faction.strategy !== undefined && (!faction.strategy || !['defend', 'assemble', 'advance', 'develop'].includes(faction.strategy.mode) || (faction.strategy.rallyId !== null && !systemIds.has(faction.strategy.rallyId)) || (faction.strategy.objectiveId !== null && !systemIds.has(faction.strategy.objectiveId)) || !Number.isInteger(faction.strategy.turn) || faction.strategy.turn < 1 || faction.strategy.turn > value.turn)) return false;
    for (const other of ids.filter(id => id !== faction.id)) { const r = faction.relations[other]; if (!r || !['peace', 'war'].includes(r.status) || !Number.isFinite(r.trust) || typeof r.trade !== 'boolean' || !Number.isFinite(r.treatyTurn)) return false; }
  }
  for (const system of value.systems) {
    if (!text(system.name) || !member(PLANET_TYPES, system.type) || !['x', 'y', 'habitability', 'richness', 'science', 'population', 'growth', 'defenseDamage'].every(key => Number.isFinite(system[key])) || system.habitability < 0 || system.habitability > 100 || system.population < 0 || system.growth < 0 || (system.owner !== null && !ids.includes(system.owner)) || (system.originalOwner !== null && !ids.includes(system.originalOwner)) || !Array.isArray(system.buildings) || system.buildings.some(id => !member(BUILDINGS, id)) || new Set(system.buildings).size !== system.buildings.length || !Array.isArray(system.knownBy) || !Array.isArray(system.exploredBy) || [...system.knownBy, ...system.exploredBy].some(id => !ids.includes(id))) return false;
    if (system.anomaly && (!member(ANOMALIES, system.anomaly.id) || typeof system.anomaly.resolved !== 'boolean')) return false;
    if (!validateDevelopmentSystem(system)) return false;
  }
  if (new Set(value.fleets.map(f => f.id)).size !== value.fleets.length) return false;
  for (const fleet of value.fleets) if (!/^f[1-9][0-9]*$/.test(fleet.id) || !member(SHIPS, fleet.type) || !ids.includes(fleet.owner) || !systemIds.has(fleet.systemId) || !Number.isInteger(fleet.ships) || fleet.ships < 1 || fleet.ships > 12 || !Number.isFinite(fleet.hp) || fleet.hp <= 0 || fleet.hp > SHIPS[fleet.type].hp * fleet.ships || !Number.isFinite(fleet.movesLeft) || fleet.movesLeft < 0 || !text(fleet.name)) return false;
  if (value.lanes.some(lane => !Array.isArray(lane) || lane.length !== 2 || !systemIds.has(lane[0]) || !systemIds.has(lane[1]) || lane[0] === lane[1])) return false;
  if (value.log.some(entry => !Number.isInteger(entry.id) || !Number.isInteger(entry.turn) || !text(entry.type) || !text(entry.text))) return false;
  if (!validateDiplomacyState(value)) return false;
  if (!validateReportState(value)) return false;
  if (!validateAlignmentState(value)) return false;
  if (!validateNavigationState(value)) return false;
  if (!validateDiscoveryState(value)) return false;
  if (!validatePublicAffairsState(value)) return false;
  return true;
}
