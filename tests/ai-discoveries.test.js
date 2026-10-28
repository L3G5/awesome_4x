import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getInfrastructure, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { ANOMALIES, BUILDINGS, SHIPS, TECHS } from '../src/content.js';
import { advanceDiscoveries, getDiscoveryView, observeDiscovery } from '../src/discoveries.js';

const empire = state => state.factions.find(faction => faction.id === 'khar');
const world = (state, id = 's2') => state.systems.find(system => system.id === id);

function fixture(id = 'observatory') {
  const state = createGame(`AI-DISCOVERY-${id}`), faction = empire(state), system = world(state);
  state.turn = 20;
  state.lanes = [];
  state.fleets = [];
  for (const location of state.systems) {
    location.anomaly = null;
    location.knownBy = location.knownBy.filter(id => id !== faction.id);
    location.exploredBy = location.exploredBy.filter(id => id !== faction.id);
  }
  Object.assign(system, { population: 6, habitability: 90, richness: 3, science: 4, buildings: id === 'reef' ? ['mine', 'factory', 'market'] : ['mine', 'lab', 'market'], queue: null, charter: { type: id === 'reef' ? 'forge' : 'academy', level: 1 }, anomaly: { id, resolved: false } });
  system.knownBy.push(faction.id); system.exploredBy.push(faction.id);
  Object.assign(faction, { credits: 500, minerals: 500, orders: 18, science: 0, contacts: [], techs: ['logistics', 'physics', 'ecology', 'industry', 'computing', 'diplomacy'], research: { techId: 'singularity', progress: 0 } });
  observeDiscovery(state, system.id, faction.id);
  return state;
}

function ready(id = 'observatory') {
  const state = fixture(id), faction = empire(state);
  assert.equal(command(state, { type: 'anomaly', factionId: faction.id, systemId: 's2', choiceId: 'preserve' }).ok, true);
  for (let i = 0; i < 3; i++) { state.turn++; advanceDiscoveries(state); }
  Object.assign(faction, { credits: 500, minerals: 500, orders: 18 });
  assert.equal(getDiscoveryView(state, 's2', faction.id).phase, 'ready');
  return state;
}

function addFleet(state, type, systemId = 's2') {
  const fleet = { id: `f${state.nextFleetId++}`, owner: 'khar', systemId, name: 'Test expedition', type, ships: 1, hp: SHIPS[type].hp, movesLeft: 0 };
  state.fleets.push(fleet);
  return fleet;
}

test('AI preserves both viable owned discoveries and pays their opening costs', () => {
  for (const id of ['observatory', 'reef']) {
    const state = fixture(id), system = world(state), faction = empire(state);
    runAI(state, faction);
    assert.equal(system.anomaly.stage, 'maturing');
    assert.equal(system.anomaly.resolved, false);
    assert.equal(system.anomaly.history[0].choiceId, 'preserve');
    assert.deepEqual(system.anomaly.history[0].effects.paid, ANOMALIES[id].choices.find(choice => choice.preserve).cost);
    assert.equal(validateSave(state), true);
  }
});

test('AI waits for preservation research on a viable colony rather than exhausting it', () => {
  const state = fixture(), faction = empire(state);
  faction.techs = faction.techs.filter(id => !['physics', 'computing'].includes(id));
  faction.research = { techId: 'physics', progress: 0 };
  runAI(state, faction);
  assert.equal(getDiscoveryView(state, 's2', faction.id).phase, 'opening');
  assert.equal(world(state).anomaly.history, undefined);
});

test('AI builds missing maturation support and the preserved site actually matures', () => {
  const state = fixture(), system = world(state), faction = empire(state);
  system.buildings = ['mine', 'market']; system.charter = { type: 'extraction', level: 1 };
  runAI(state, faction);
  assert.equal(system.queue?.itemId, 'lab');
  assert.equal(system.anomaly.stage, 'maturing');
  for (const other of state.factions.filter(other => other.id !== faction.id && other.id !== 'player')) other.eliminated = true;
  for (let i = 0; i < 8 && system.anomaly.stage === 'maturing'; i++) endTurn(state);
  assert.equal(system.anomaly.progress, 3);
  assert.ok(['ready', 'resolved'].includes(system.anomaly.stage));
  assert.ok(system.buildings.includes('lab'));
  assert.equal(validateSave(state), true);
});

test('a local Ark preserves a viable settlement opportunity while a lone scout takes salvage', () => {
  for (const type of ['colony', 'scout']) {
    const state = fixture('reef'), faction = empire(state), system = world(state);
    system.owner = null; system.population = 0; system.buildings = []; system.charter = null;
    addFleet(state, type);
    runAI(state, faction);
    assert.equal(system.anomaly.history[0].choiceId, type === 'colony' ? 'preserve' : 'salvage');
    assert.equal(system.owner, type === 'colony' ? faction.id : null);
    if (type === 'colony') assert.ok(system.buildings.includes('mine') || system.queue?.itemId === 'mine');
  }
});

test('a scout leaves a nearby viable site intact while its empire researches preservation', () => {
  const state = fixture(), faction = empire(state), home = world(state), target = world(state, 's4');
  home.anomaly = null; home.buildings = ['mine', 'shipyard', 'market']; home.charter = { type: 'extraction', level: 1 };
  Object.assign(target, { owner: null, population: 0, habitability: 80, buildings: [], queue: null, knownBy: [faction.id], exploredBy: [faction.id], anomaly: { id: 'observatory', resolved: false } });
  faction.techs = faction.techs.filter(id => !['physics', 'computing'].includes(id));
  faction.research = { techId: 'physics', progress: 0 };
  state.lanes = [[home.id, target.id]];
  addFleet(state, 'scout', target.id);
  runAI(state, faction);
  assert.equal(getDiscoveryView(state, target.id, faction.id).phase, 'opening');
  assert.equal(target.anomaly.history, undefined);
});

test('an Ark modestly prefers a remembered discovery over an equally distant ordinary world', () => {
  const state = fixture('reef'), faction = empire(state), home = world(state), target = world(state, 's4'), ordinary = world(state, 's5');
  home.anomaly = null;
  for (const system of [target, ordinary]) Object.assign(system, { owner: null, population: 0, habitability: 80, buildings: [], queue: null, knownBy: [faction.id], exploredBy: [faction.id], anomaly: null });
  target.richness = 2; ordinary.richness = 5;
  target.anomaly = { id: 'reef', resolved: false };
  const scout = addFleet(state, 'scout', target.id);
  observeDiscovery(state, target.id, faction.id);
  scout.systemId = home.id;
  state.lanes = [[home.id, target.id], [home.id, ordinary.id]];
  addFleet(state, 'colony').movesLeft = 1;
  runAI(state, faction);
  assert.equal(target.owner, faction.id);
  assert.equal(ordinary.owner, null);
  assert.equal(target.anomaly.stage, 'maturing');
});

test('mature sites restore for complementary long-term output at exact ordinary prices', () => {
  for (const [id, buildingId] of [['observatory', 'ancient_observatory'], ['reef', 'lattice_works']]) {
    const state = ready(id), faction = empire(state), system = world(state);
    const before = { credits: faction.credits, minerals: faction.minerals, orders: faction.orders };
    runAI(state, faction);
    assert.equal(system.queue?.itemId, buildingId);
    assert.equal(system.queue.kind, 'building');
    assert.equal(system.queue.work, 60);
    assert.equal(system.queue.progress, 0);
    assert.equal(faction.credits, before.credits - 80);
    assert.equal(faction.minerals, before.minerals - 40);
    assert.equal(faction.orders, before.orders - 1);
    assert.equal(system.anomaly.history[1].choiceId, 'restore');
    assert.equal(validateSave(state), true);
  }
});

test('late discoveries prefer the final portable reward to a site that cannot repay itself', () => {
  for (const id of ['observatory', 'reef']) {
    const state = ready(id), faction = empire(state), system = world(state);
    state.turn = 116;
    runAI(state, faction);
    assert.equal(system.anomaly.history[1].choiceId, 'harvest');
    assert.equal(system.anomaly.restoration, undefined);
    assert.notEqual(system.queue?.itemId, ANOMALIES[id].siteId);
  }
});

test('an empire with no research remaining does not restore an observatory for unusable science', () => {
  const state = ready(), faction = empire(state);
  faction.techs = Object.keys(TECHS); faction.research = null;
  runAI(state, faction);
  assert.equal(world(state).anomaly.history[1].choiceId, 'harvest');
  assert.notEqual(world(state).queue?.itemId, 'ancient_observatory');
});

test('a full colony replaces expendable infrastructure without losing its charter, beacon or last shipyard', () => {
  const state = ready(), faction = empire(state), system = world(state);
  system.population = 9;
  system.buildings = ['lab', 'beacon', 'shipyard', 'bastion', 'market'];
  faction.techs.push('shields');
  assert.equal(getInfrastructure(state, system).available, 0);
  runAI(state, faction);
  assert.equal(system.queue?.itemId, 'ancient_observatory');
  assert.equal(system.queue.replaceBuildingId, 'bastion');
  assert.deepEqual(system.charter, { type: 'academy', level: 1 });
  assert.deepEqual(system.buildings, ['lab', 'beacon', 'shipyard', 'bastion', 'market'], 'replacement waits for paid construction to complete');
});

test('a mature site with only protected slots takes harvest instead of destroying its colony role', () => {
  const state = ready(), faction = empire(state), system = world(state);
  system.population = 5;
  system.buildings = ['lab', 'beacon', 'shipyard'];
  assert.equal(getInfrastructure(state, system).available, 0);
  runAI(state, faction);
  assert.equal(system.anomaly.history[1].choiceId, 'harvest');
  assert.deepEqual(system.buildings, ['lab', 'beacon', 'shipyard']);
  assert.notEqual(system.queue?.itemId, 'ancient_observatory');
});

test('stage-specific restoration prices preserve the next beacon budget, including replacement', () => {
  for (const replacement of [false, true]) {
    const state = ready(), faction = empire(state), system = world(state);
    faction.techs.push('singularity'); faction.research = null;
    system.population = 9;
    system.buildings = replacement ? ['lab', 'beacon', 'shipyard', 'bastion', 'market'] : ['lab', 'beacon', 'market'];
    faction.credits = 259; faction.minerals = 220;
    runAI(state, faction);
    assert.equal(system.anomaly.stage, 'ready', 'a useful site waits instead of consuming committed beacon funding');
    assert.notEqual(system.queue?.itemId, 'ancient_observatory');
    assert.ok(faction.credits >= 180 && faction.minerals >= 180);
    // Clear any ordinary cheap project, then fund the exact restoration margin.
    if (system.queue) command(state, { type: 'cancelBuild', factionId: faction.id, systemId: system.id });
    faction.credits = 260; faction.minerals = 220; faction.orders = 18;
    runAI(state, faction);
    assert.equal(system.queue?.itemId, 'ancient_observatory');
    assert.equal(system.queue.replaceBuildingId || null, replacement ? 'bastion' : null);
    assert.equal(faction.credits, 180); assert.equal(faction.minerals, 180);
  }
});

test('cancelled restoration rebuilds through normal paid construction without reopening salvage', () => {
  const state = ready('reef'), faction = empire(state), system = world(state);
  runAI(state, faction);
  assert.equal(system.queue?.itemId, 'lattice_works');
  assert.equal(command(state, { type: 'cancelBuild', factionId: faction.id, systemId: system.id }).ok, true);
  const history = structuredClone(system.anomaly.history), credits = faction.credits, minerals = faction.minerals;
  runAI(state, faction);
  assert.equal(system.queue?.itemId, 'lattice_works');
  assert.equal(faction.credits, credits - BUILDINGS.lattice_works.cost.credits);
  assert.equal(faction.minerals, minerals - BUILDINGS.lattice_works.cost.minerals);
  assert.deepEqual(system.anomaly.history, history);
  assert.equal(system.anomaly.resolved, true);
});

test('a captured restoration entitlement is rebuilt by the new owner at normal cost', () => {
  const state = ready('reef'), faction = empire(state), system = world(state);
  addFleet(state, 'colony'); // Keep the empire alive while its sole colony changes hands.
  system.owner = 'player';
  system.knownBy.push('player'); system.exploredBy.push('player');
  const player = state.factions.find(other => other.id === 'player');
  Object.assign(player, { credits: 500, minerals: 500, orders: 18, techs: ['logistics', 'industry'] });
  assert.equal(command(state, { type: 'anomaly', systemId: system.id, choiceId: 'restore' }).ok, true);
  assert.equal(command(state, { type: 'cancelBuild', systemId: system.id }).ok, true);
  system.owner = faction.id;
  const before = { credits: faction.credits, minerals: faction.minerals };
  runAI(state, faction);
  assert.equal(system.queue?.itemId, 'lattice_works');
  assert.equal(faction.credits, before.credits - 80); assert.equal(faction.minerals, before.minerals - 40);
  assert.equal(system.anomaly.restoration.factionId, 'player');
  assert.equal(system.anomaly.history.length, 2);
  assert.equal(system.anomaly.history[1].factionId, 'player');
});

test('unseen remote maturation and history never alter AI orders, purchases or treasury', () => {
  const state = fixture(), faction = empire(state), remote = world(state, 's4');
  Object.assign(remote, { owner: 'player', population: 6, buildings: ['mine', 'market'], queue: null, anomaly: { id: 'reef', resolved: false }, knownBy: ['player', faction.id], exploredBy: ['player', faction.id] });
  Object.assign(state.factions.find(other => other.id === 'player'), { credits: 500, minerals: 500, orders: 18, techs: ['ecology', 'logistics', 'industry'] });
  const expedition = addFleet(state, 'scout', remote.id);
  observeDiscovery(state, remote.id, faction.id);
  expedition.systemId = 's2';
  const other = structuredClone(state);
  assert.equal(command(other, { type: 'anomaly', systemId: remote.id, choiceId: 'preserve' }).ok, true);
  for (let i = 0; i < 3; i++) {
    state.turn++; other.turn++;
    advanceDiscoveries(state); advanceDiscoveries(other);
  }
  assert.equal(command(other, { type: 'anomaly', systemId: remote.id, choiceId: 'restore' }).ok, true);
  assert.equal(validateSave(state), true); assert.equal(validateSave(other), true);
  assert.deepEqual(getDiscoveryView(other, remote.id, faction.id), getDiscoveryView(state, remote.id, faction.id));
  runAI(state, faction); runAI(other, empire(other));
  assert.deepEqual(empire(other), faction);
  assert.deepEqual(other.fleets, state.fleets);
  assert.deepEqual(other.systems.filter(system => system.id !== remote.id), state.systems.filter(system => system.id !== remote.id));
  assert.equal(other.rng, state.rng);
});
