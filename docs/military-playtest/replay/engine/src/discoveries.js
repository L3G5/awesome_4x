import { ANOMALIES, BUILDINGS, SHIPS, TECHS } from './content.js';
import { getInfrastructure, getCharterBonuses } from './development.js';
import { getVisibleFleets, hasSensors } from './intelligence.js';

const TARGET = 3;
const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const systemOf = (state, id) => state.systems.find(system => system.id === id);
const phaseOf = anomaly => anomaly.resolved ? 'resolved' : anomaly.stage || 'opening';
const copy = value => structuredClone(value);
const fail = message => ({ ok: false, message });
const local = (state, system, id) => system.exploredBy.includes(id) && hasSensors(state, id, system.id);
const canPay = (faction, cost) => Object.entries(cost || {}).every(([key, amount]) => faction[key] >= amount);
const blocked = (state, system, id) => getVisibleFleets(state, id, system.id).some(fleet => fleet.owner !== id && factionOf(state, id).relations[fleet.owner]?.status === 'war' && SHIPS[fleet.type]?.attack >= 4);

function snapshot(state, system) {
  const anomaly = system.anomaly;
  const siteId = anomaly.restoration?.buildingId || null;
  return { observedTurn: state.turn, phase: phaseOf(anomaly), progress: anomaly.progress || 0, siteId, siteState: !siteId ? null : system.buildings.includes(siteId) ? 'active' : system.queue?.itemId === siteId ? 'building' : 'planned' };
}

function record(state, factionId, systemId, text) {
  if (factionId !== 'player') return;
  state.log.unshift({ id: state.nextLogId++, turn: state.turn, type: 'discovery', text, systemId });
  state.log.length = Math.min(state.log.length, 160);
}

/** Replace two existing placements without advancing the galaxy RNG. */
export function placeDiscoveries(state) {
  const worlds = state.systems.filter(system => system.anomaly);
  if (worlds.length < 2) return;
  let seed = 2166136261;
  for (const character of String(state.seed)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  for (const id of ['observatory', 'reef']) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const [system] = worlds.splice(seed % worlds.length, 1);
    system.anomaly = { id, resolved: false };
  }
}

/** Knowledge changes only with a current expedition or colony, after survey. */
export function observeDiscovery(state, systemId, observerId) {
  const system = systemOf(state, systemId);
  if (!system?.anomaly || !factionOf(state, observerId) || !local(state, system, observerId)) return false;
  for (const entry of system.anomaly.history || []) if (!entry.knownBy.includes(observerId)) entry.knownBy.push(observerId);
  system.anomaly.observations ||= {};
  system.anomaly.observations[observerId] = snapshot(state, system);
  return true;
}

export function observeDiscoveries(state) {
  for (const system of state.systems.filter(system => system.anomaly)) for (const faction of state.factions) observeDiscovery(state, system.id, faction.id);
}

/** Pure observer projection. Never expose the mutable list of other observers. */
export function getDiscoveryView(state, systemId, observerId = 'player') {
  const system = systemOf(state, systemId);
  if (!system?.anomaly || !factionOf(state, observerId) || !system.exploredBy.includes(observerId)) return null;
  const anomaly = system.anomaly, definition = ANOMALIES[anomaly.id];
  const present = local(state, system, observerId);
  const observed = present ? snapshot(state, system) : anomaly.observations?.[observerId];
  // Original v1 saves retained the deciding empire, but neither the choice
  // nor an observation date. That actor remembers its own resolution only.
  const personalResolution = !observed && anomaly.resolved && anomaly.resolvedBy === observerId;
  const phase = observed?.phase || (personalResolution ? 'resolved' : 'unknown');
  const history = (anomaly.history || []).filter(entry => present || entry.knownBy.includes(observerId)).map(({ knownBy, ...entry }) => copy(entry));
  return {
    id: anomaly.id, name: definition.name, systemId,
    description: phase === 'ready' ? definition.matureDescription : definition.description,
    phase, progress: observed?.progress || 0, target: definition.multiStage ? TARGET : 1,
    observedTurn: observed?.observedTurn ?? null, stale: !present,
    canInteract: present && (!system.owner || system.owner === observerId),
    history, legacyOutcome: phase === 'resolved' && history.length === 0,
    site: observed?.siteId ? { id: observed.siteId, name: BUILDINGS[observed.siteId].name, state: observed.siteState } : null,
    continuation: definition.continuation || null,
  };
}

function accessReason(state, system, factionId) {
  const faction = factionOf(state, factionId);
  if (state.winner) return 'This campaign has ended.';
  if (!faction || faction.eliminated) return 'This empire is no longer active.';
  if (!system || !system.exploredBy.includes(factionId)) return 'Survey this system first.';
  // Presence precedes live anomaly inspection so remote commands cannot probe
  // whether a formerly surveyed site was resolved by another empire.
  if (!local(state, system, factionId)) return 'An expedition must be present to investigate.';
  if (system.owner && system.owner !== factionId) return 'Only the sovereign empire may investigate this site.';
  if (blocked(state, system, factionId)) return 'Clear hostile warships before investigating.';
  if (faction.orders < 1) return 'No orders remaining.';
  return '';
}

/** Extra gate for ordinary building options; all normal build rules still apply. */
export function getDiscoveryBuildReason(state, system, itemId, factionId = 'player') {
  const building = BUILDINGS[itemId];
  if (!building?.discovery) return '';
  if (!system || system.owner !== factionId) return 'Requires an owned colony';
  if (system.anomaly?.id !== building.discovery) return 'This ancient site belongs to a different discovery world';
  if (system.anomaly.restoration?.buildingId === itemId) return '';
  if (!system.anomaly.resolved && phaseOf(system.anomaly) === 'ready') return blocked(state, system, factionId) ? 'Clear hostile warships before investigating.' : '';
  return 'Complete this world’s discovery research before restoring its ancient site';
}

function restorationReason(state, system, faction, building, replacement) {
  if (system.owner !== faction.id) return 'Requires an owned colony';
  if (system.queue) return 'Construction already in progress';
  if (system.buildings.includes(building.id)) return 'Already built';
  if (replacement !== null && (!system.buildings.includes(replacement) || replacement === building.id)) return 'Choose an existing building to replace with new infrastructure';
  if (getInfrastructure(state, system).available === 0 && replacement === null) return 'Infrastructure slots are full. Choose a building to replace';
  if (building.requires.some(id => !faction.techs.includes(id))) return `Requires ${building.requires.filter(id => !faction.techs.includes(id)).map(id => TECHS[id].name).join(' and ')}`;
  if (!canPay(faction, building.cost)) return 'Insufficient credits or minerals';
  return getDiscoveryBuildReason(state, system, building.id, faction.id);
}

/** The same action schema is used by player UI and AI. Remote options stay stale. */
export function getDiscoveryOptions(state, systemId, factionId = 'player', replaceBuildingId = null) {
  const system = systemOf(state, systemId), faction = factionOf(state, factionId);
  const view = getDiscoveryView(state, systemId, factionId);
  if (!view || !['opening', 'ready'].includes(view.phase)) return [];
  const definition = ANOMALIES[view.id];
  const choices = view.phase === 'ready' ? definition.finalChoices || [] : definition.choices;
  const common = accessReason(state, system, factionId);
  return choices.map(choice => {
    const building = BUILDINGS[choice.buildingId];
    const requires = building?.requires || choice.requires || [];
    const cost = building?.cost || choice.cost || {};
    let reason = common;
    if (!reason && requires.some(id => !faction.techs.includes(id))) reason = `Requires ${requires.filter(id => !faction.techs.includes(id)).map(id => TECHS[id].name).join(' and ')}`;
    if (!reason && building) reason = restorationReason(state, system, faction, building, replaceBuildingId);
    if (!reason && !canPay(faction, cost)) reason = 'Insufficient credits or minerals';
    const production = view.canInteract ? 4 + system.population + system.buildings.reduce((total, id) => total + (BUILDINGS[id].production || 0), 0) + getCharterBonuses(system).production : 0;
    return { ...copy(choice), cost: { ...cost }, gain: { ...choice.gain }, requires: [...requires], orders: 1, enabled: !reason, reason, stageId: view.phase, kind: building ? 'restore' : choice.preserve ? 'preserve' : 'resolve', ...(building ? { work: building.work, turns: view.canInteract ? Math.ceil(building.work / Math.max(1, production)) : null, replaceBuildingId } : {}), continuation: choice.preserve ? definition.continuation : null };
  });
}

const resourceText = values => Object.entries(values).filter(([, amount]) => amount > 0).map(([key, amount]) => `${amount} ${key}`).join(' and ');
function outcomeText(effects, extra = '') {
  const parts = [];
  if (resourceText(effects.paid)) parts.push(`Paid ${resourceText(effects.paid)}.`);
  if (resourceText(effects.gained)) parts.push(`Gained ${resourceText(effects.gained)}.`);
  if (effects.habitability !== undefined) parts.push(`Habitability increased by ${effects.habitability} points.`);
  if (effects.population) parts.push(effects.population.amount ? `Added ${effects.population.amount} population at ${effects.population.systemName}.` : 'No settled capital could receive the refugees.');
  if (effects.charted !== undefined) parts.push(`Charted ${effects.charted} new systems.`);
  if (effects.fleet) parts.push(`Recovered ${effects.fleet.name}, a ${SHIPS[effects.fleet.type].role.toLowerCase()}.`);
  if (effects.construction) parts.push(`Commissioned ${BUILDINGS[effects.construction.buildingId].name} (${effects.construction.work} work). Restoration remains available if construction is cancelled or the site is later replaced.`);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

function appendHistory(state, system, factionId, choice, stageId, effects, extra) {
  const anomaly = system.anomaly, definition = ANOMALIES[anomaly.id];
  anomaly.history ||= [];
  const entry = { id: `${system.id}:${anomaly.history.length + 1}`, stageId, choiceId: choice.id, turn: state.turn, factionId, title: definition.name, choiceLabel: choice.label, outcomeText: outcomeText(effects, extra), effects: copy(effects), knownBy: [factionId] };
  anomaly.history.push(entry);
  record(state, factionId, system.id, `${definition.name}: ${choice.label}. ${entry.outcomeText}`);
  for (const faction of state.factions) observeDiscovery(state, system.id, faction.id);
  return entry;
}

/** Called only after normal build validation, payment and queue creation. */
export function recordDiscoveryConstruction(state, systemId, factionId, itemId) {
  const system = systemOf(state, systemId), item = BUILDINGS[itemId];
  if (!item?.discovery || system?.owner !== factionId || system.anomaly?.id !== item.discovery || system.anomaly.restoration || phaseOf(system.anomaly) !== 'ready' || system.queue?.itemId !== itemId || system.queue.kind !== 'building') return false;
  const anomaly = system.anomaly;
  anomaly.restoration = { buildingId: itemId, turn: state.turn, factionId };
  anomaly.resolved = true; anomaly.resolvedBy = factionId; anomaly.stage = 'resolved';
  const choice = ANOMALIES[anomaly.id].finalChoices.find(option => option.buildingId === itemId);
  appendHistory(state, system, factionId, choice, 'ready', { paid: { ...system.queue.cost }, gained: {}, construction: { buildingId: itemId, work: system.queue.work, replaceBuildingId: system.queue.replaceBuildingId || null } });
  return true;
}

/** Engine callbacks retain ordinary construction, fleet and research behavior. */
export function executeDiscovery(state, action, hooks) {
  const factionId = action.factionId || 'player', system = systemOf(state, action.systemId), faction = factionOf(state, factionId);
  const denied = accessReason(state, system, factionId);
  if (denied) return fail(denied);
  if (!system.anomaly || system.anomaly.resolved) return fail('No unresolved anomaly here.');
  const choice = getDiscoveryOptions(state, system.id, factionId, action.replaceBuildingId ?? null).find(option => option.id === action.choiceId);
  if (!choice) return fail(phaseOf(system.anomaly) === 'maturing' ? 'This discovery is still maturing.' : 'Choose an expedition outcome.');
  if (!choice.enabled) return fail(choice.reason);
  if (choice.kind === 'restore') return hooks.build({ type: 'build', factionId, systemId: system.id, itemId: choice.buildingId, ...(action.replaceBuildingId !== undefined ? { replaceBuildingId: action.replaceBuildingId } : {}) });
  const effects = { paid: { ...choice.cost }, gained: { ...choice.gain } };
  for (const [key, amount] of Object.entries(effects.paid)) faction[key] -= amount;
  for (const [key, amount] of Object.entries(effects.gained)) faction[key] += amount;
  faction.orders--;
  if (choice.population) {
    const capital = systemOf(state, faction.capitalId);
    const amount = capital?.owner === factionId ? choice.population : 0;
    if (amount) capital.population += amount;
    effects.population = { systemId: capital?.id || faction.capitalId, systemName: capital?.name || 'the former capital', amount };
  }
  if (choice.habitability) {
    const before = system.habitability;
    system.habitability = Math.min(100, before + choice.habitability);
    effects.habitability = system.habitability - before;
  }
  if (choice.ship) {
    const fleet = hooks.makeFleet(factionId, system.id, choice.ship);
    fleet.name = `Last Light of ${system.name}`;
    fleet.heritage = [{ id: `${system.id}:${system.anomaly.id}:${choice.id}`, name: fleet.name, systemId: system.id, discoveryId: system.anomaly.id, choiceId: choice.id, turn: state.turn, factionId, fleetId: fleet.id }];
    effects.fleet = { id: fleet.id, name: fleet.name, type: fleet.type };
  }
  if (choice.reveal) {
    const before = new Set(state.systems.filter(candidate => candidate.knownBy.includes(factionId)).map(candidate => candidate.id));
    let frontier = [system.id];
    for (let depth = 0; depth < choice.reveal; depth++) {
      frontier = [...new Set(frontier.flatMap(id => state.lanes.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : [])))];
      for (const id of frontier) hooks.chart(id, factionId);
    }
    effects.charted = state.systems.filter(candidate => candidate.knownBy.includes(factionId) && !before.has(candidate.id)).length;
  }
  const anomaly = system.anomaly;
  if (choice.preserve) { anomaly.stage = 'maturing'; anomaly.progress = 0; anomaly.startedTurn = state.turn; }
  else { anomaly.resolved = true; anomaly.resolvedBy = factionId; anomaly.stage = 'resolved'; }
  hooks.applyResearch(faction);
  appendHistory(state, system, factionId, choice, choice.stageId, effects, choice.preserve ? 'Preservation begun. Three qualifying colony cycles will open a further decision; the opportunity remains with this world.' : '');
  return { ok: true, message: choice.preserve ? 'Discovery preserved. Its colony research can now mature.' : 'Expedition resolved.' };
}

/** Fleet heritage is historical provenance, not a claim that a hull survived. */
export function mergeDiscoveryHeritage(fleet, other) {
  if (!fleet.heritage?.length && !other.heritage?.length) return;
  fleet.heritage = [...new Map([...(fleet.heritage || []), ...(other.heritage || [])].map(entry => [entry.id, copy(entry)])).values()];
}

export function advanceDiscoveries(state) {
  if (state.winner || state.discoveriesUpdatedTurn === state.turn) return { advanced: false, matured: [] };
  const matured = [];
  for (const system of state.systems) {
    const anomaly = system.anomaly;
    if (!anomaly || anomaly.resolved || phaseOf(anomaly) !== 'maturing') continue;
    const definition = ANOMALIES[anomaly.id], owner = factionOf(state, system.owner);
    if (!owner || owner.eliminated || !system.buildings.includes(definition.support) || blocked(state, system, owner.id)) continue;
    anomaly.progress = Math.min(TARGET, (anomaly.progress || 0) + 1);
    if (anomaly.progress === TARGET) {
      anomaly.stage = 'ready'; matured.push(system.id);
      record(state, owner.id, system.id, `${definition.name} at ${system.name} has matured. Choose a lasting site or its final portable reward.`);
    }
  }
  state.discoveriesUpdatedTurn = state.turn;
  observeDiscoveries(state);
  return { advanced: true, matured };
}

/** Strict optional v1 fields; historical references can outlive fleets/owners. */
export function validateDiscoveryState(state) {
  try {
    if (!state || !Array.isArray(state.systems) || !Array.isArray(state.factions) || !Array.isArray(state.fleets) || !Number.isSafeInteger(state.turn) || state.turn < 1) return false;
    const ids = new Set(state.factions.map(faction => faction.id)), worlds = new Set(state.systems.map(system => system.id));
    const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
    const turn = value => integer(value, state.turn) && value >= 1;
    const text = value => typeof value === 'string' && value.length <= 2000;
    const unique = (values, members, max) => Array.isArray(values) && values.length <= max && new Set(values).size === values.length && values.every(value => members.has(value));
    const resources = values => values && typeof values === 'object' && !Array.isArray(values) && Object.entries(values).every(([key, value]) => ['credits', 'minerals', 'science'].includes(key) && Number.isFinite(value) && value >= 0);
    if (state.discoveriesUpdatedTurn !== undefined && !integer(state.discoveriesUpdatedTurn, state.turn)) return false;
    for (const system of state.systems) {
      const anomaly = system.anomaly;
      for (const buildingId of system.buildings) if (BUILDINGS[buildingId]?.discovery && anomaly?.restoration?.buildingId !== buildingId) return false;
      if (BUILDINGS[system.queue?.itemId]?.discovery && anomaly?.restoration?.buildingId !== system.queue.itemId) return false;
      if (!anomaly) continue;
      const definition = ANOMALIES[anomaly.id];
      if (!definition) return false;
      if (anomaly.resolvedBy !== undefined && !ids.has(anomaly.resolvedBy)) return false;
      if (anomaly.stage !== undefined && (!['maturing', 'ready', 'resolved'].includes(anomaly.stage) || (anomaly.stage === 'resolved') !== anomaly.resolved || anomaly.stage !== 'resolved' && !definition.multiStage)) return false;
      if (anomaly.progress !== undefined && !integer(anomaly.progress, TARGET)) return false;
      if (anomaly.stage === 'maturing' && (!integer(anomaly.progress, 2) || !turn(anomaly.startedTurn)) || anomaly.stage === 'ready' && anomaly.progress !== TARGET) return false;
      if (anomaly.startedTurn !== undefined && !turn(anomaly.startedTurn)) return false;
      if (anomaly.restoration !== undefined) {
        const entitlement = anomaly.restoration;
        if (!entitlement || !definition.multiStage || entitlement.buildingId !== definition.siteId || !anomaly.resolved || !turn(entitlement.turn) || !ids.has(entitlement.factionId)) return false;
      }
      if (anomaly.history !== undefined) {
        if (!Array.isArray(anomaly.history) || anomaly.history.length > (definition.multiStage ? 2 : 1)) return false;
        const stages = new Set(), historyIds = new Set();
        for (const entry of anomaly.history) {
          const options = entry.stageId === 'opening' ? definition.choices : entry.stageId === 'ready' ? definition.finalChoices || [] : [];
          const effects = entry.effects;
          if (!text(entry.id) || historyIds.has(entry.id) || stages.has(entry.stageId) || !options.some(choice => choice.id === entry.choiceId) || !turn(entry.turn) || !ids.has(entry.factionId) || ![entry.title, entry.choiceLabel, entry.outcomeText].every(text) || !unique(entry.knownBy, ids, ids.size) || !entry.knownBy.includes(entry.factionId) || !effects || !resources(effects.paid) || !resources(effects.gained)) return false;
          if (Object.keys(effects).some(key => !['paid', 'gained', 'habitability', 'population', 'charted', 'fleet', 'construction'].includes(key))) return false;
          if (effects.habitability !== undefined && (!Number.isFinite(effects.habitability) || effects.habitability < 0 || effects.habitability > 100)) return false;
          if (effects.charted !== undefined && !integer(effects.charted, worlds.size)) return false;
          if (effects.population !== undefined && (!effects.population || !worlds.has(effects.population.systemId) || !text(effects.population.systemName) || !integer(effects.population.amount, 100))) return false;
          if (effects.fleet !== undefined && (!effects.fleet || !/^f[1-9]\d*$/.test(effects.fleet.id) || !text(effects.fleet.name) || !Object.hasOwn(SHIPS, effects.fleet.type))) return false;
          if (effects.construction !== undefined && (!effects.construction || effects.construction.buildingId !== definition.siteId || !Number.isFinite(effects.construction.work) || effects.construction.work <= 0 || effects.construction.replaceBuildingId !== null && !Object.hasOwn(BUILDINGS, effects.construction.replaceBuildingId))) return false;
          historyIds.add(entry.id); stages.add(entry.stageId);
        }
      }
      if (anomaly.observations !== undefined) {
        if (!anomaly.observations || typeof anomaly.observations !== 'object' || Array.isArray(anomaly.observations)) return false;
        for (const [id, observation] of Object.entries(anomaly.observations)) {
          if (!ids.has(id) || !observation || !turn(observation.observedTurn) || !['opening', 'maturing', 'ready', 'resolved'].includes(observation.phase) || !integer(observation.progress, TARGET)) return false;
          if (observation.siteId === null ? observation.siteState !== null : observation.siteId !== definition.siteId || !['planned', 'building', 'active'].includes(observation.siteState)) return false;
        }
      }
    }
    for (const fleet of state.fleets) if (fleet.heritage !== undefined) {
      if (!Array.isArray(fleet.heritage) || fleet.heritage.length > state.systems.length || new Set(fleet.heritage.map(entry => entry.id)).size !== fleet.heritage.length) return false;
      for (const entry of fleet.heritage) if (!text(entry.id) || !text(entry.name) || !worlds.has(entry.systemId) || !ANOMALIES[entry.discoveryId]?.choices.some(choice => choice.id === entry.choiceId && choice.ship) || !turn(entry.turn) || !ids.has(entry.factionId) || !/^f[1-9]\d*$/.test(entry.fleetId)) return false;
    }
    return true;
  } catch { return false; }
}
