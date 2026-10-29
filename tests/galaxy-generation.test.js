import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, getNeighbors, getVisibleFleets, validateSave } from '../src/game.js';
import { generateGalaxyLayout, describeGalaxyLayout, graphDistances, MAP_VERSION } from '../src/galaxy-generation.js';
import { legacyCampaign } from './legacy-campaign-fixture.js';

const seeds = ['ASTERION', ...Array.from({ length: 63 }, (_, index) => `stage30-map-${index + 1}`)];

test('new galaxies bound every empire’s travel and staging space across fixed seeds', () => {
  for (const seed of seeds) {
    const layout = generateGalaxyLayout(seed), metrics = describeGalaxyLayout(layout);
    assert.equal(layout.fallback, false, seed);
    assert.equal(layout.positions.length, 42);
    assert.equal(metrics.connected, true);
    assert(metrics.edges >= 52 && metrics.edges <= 64);
    assert(metrics.capitalDistances.every(jumps => jumps >= 5 && jumps <= 13));
    assert(metrics.homeDegrees.every(degree => degree >= 2 && degree <= 4));
    assert(metrics.maxDegree <= 6); assert(metrics.diameter <= 18);
    assert.equal(new Set(layout.lanes.map(edge => edge.join(':'))).size, layout.lanes.length);
    for (let a = 0; a < layout.positions.length; a++) for (let b = a + 1; b < layout.positions.length; b++) {
      assert(Math.hypot(layout.positions[a].x - layout.positions[b].x, layout.positions[a].y - layout.positions[b].y) >= 6.3);
    }
  }
});

test('each start has two informed resource choices, an immediate colony and a recovery route', () => {
  for (const seed of seeds) {
    const state = createGame(seed), totals = [];
    assert.equal(state.mapVersion, MAP_VERSION); assert.equal(validateSave(state), true);
    for (const faction of state.factions) {
      const prospects = state.systems.filter(system => !system.owner && system.exploredBy.includes(faction.id));
      assert.equal(prospects.length, 2);
      assert(prospects.every(system => getNeighbors(state, faction.capitalId).includes(system.id)));
      assert(prospects.some(system => system.habitability >= 60));
      assert(prospects.every(system => system.habitability >= 30 && !system.anomaly));
      assert((prospects[0].richness - prospects[1].richness) * (prospects[0].science - prospects[1].science) < 0);
      totals.push(prospects.reduce((sum, system) => sum + system.richness + system.science, 0));
      const distance = graphDistances(state.lanes, faction.capitalId);
      assert(state.systems.some(system => !system.owner && !prospects.includes(system) && system.habitability >= 50 && distance.get(system.id) <= 3));
    }
    assert(Math.max(...totals) - Math.min(...totals) <= 4);
  }
});

test('all four first Arks can settle a surveyed adjacent world with the ordinary paid actions', () => {
  for (const seed of seeds.slice(0, 12)) for (const id of ['player', 'veyr', 'khar', 'choir']) {
    const state = createGame(seed), faction = state.factions.find(owner => owner.id === id);
    const ark = state.fleets.find(fleet => fleet.owner === id && fleet.type === 'colony');
    const world = state.systems.find(system => !system.owner && system.habitability >= 60 && system.exploredBy.includes(id));
    const before = { credits: faction.credits, minerals: faction.minerals, orders: faction.orders };
    assert.equal(command(state, { type: 'move', factionId: id, fleetId: ark.id, targetId: world.id }).ok, true);
    assert.equal(command(state, { type: 'colonize', factionId: id, fleetId: ark.id }).ok, true);
    assert.equal(world.owner, id); assert.equal(world.population, 1);
    assert.equal(faction.credits, before.credits - 30); assert.equal(faction.minerals, before.minerals - 20);
    assert.equal(faction.orders, before.orders - 2); assert.equal(validateSave(state), true);
  }
});

test('starting survey knowledge does not grant fleet sensors or discovery resolutions', () => {
  const state = createGame('initial-survey-boundary');
  const world = state.systems.find(system => !system.owner && system.exploredBy.includes('player'));
  const enemy = state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'frigate');
  enemy.systemId = world.id;
  assert.equal(getVisibleFleets(state, 'player', world.id).includes(enemy), false);
  assert.equal(state.factions[0].contacts.includes('khar'), false);
  assert(state.systems.filter(system => system.anomaly).every(system => !system.anomaly.resolved));
});

test('different seeds vary actual neighbors, routes and discovery locations', () => {
  const neighborhoods = new Set(), sites = new Set(), travel = new Set(), discoveryWorlds = new Set();
  for (const seed of seeds) {
    const state = createGame(seed);
    neighborhoods.add(getNeighbors(state, 's0').join(','));
    const anomalies = state.systems.filter(system => system.anomaly);
    sites.add(anomalies.map(system => system.id).join(','));
    anomalies.forEach(system => discoveryWorlds.add(system.id));
    travel.add(['s1', 's2', 's3'].map(id => graphDistances(state.lanes, 's0').get(id)).join(','));
    assert.equal(anomalies.length, 10);
    for (const type of ['archive', 'pilgrims', 'forge', 'garden', 'echo', 'wreck']) {
      const count = anomalies.filter(system => system.anomaly.id === type).length;
      assert(count >= 1 && count <= 2);
    }
    for (const type of ['observatory', 'reef']) assert.equal(anomalies.filter(system => system.anomaly.id === type).length, 1);
  }
  assert(neighborhoods.size >= 48); assert(sites.size >= 48); assert(travel.size >= 32);
  assert.equal(discoveryWorlds.size, 38);
});

test('seed and generator version reproduce without depending on earlier calls', () => {
  for (const seed of ['', 'ASTERION', 'Млечный путь', '__proto__', 'constructor']) {
    const first = createGame(seed);
    createGame('intervening-generation');
    assert.deepEqual(createGame(seed), first); assert.equal(validateSave(first), true);
  }
  const invalid = createGame('wrong-map-version'); invalid.mapVersion = 999;
  assert.equal(validateSave(invalid), false);
});

test('loading a legacy map leaves its positions, knowledge, lanes and RNG intact', () => {
  const legacy = legacyCampaign('formation-sequence'), text = JSON.stringify(legacy);
  assert.equal(legacy.mapVersion, undefined); assert.equal(validateSave(legacy), true);
  const restored = JSON.parse(text);
  assert.equal(validateSave(restored), true); assert.equal(JSON.stringify(restored), text);
  const scout = legacy.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  const action = { type: 'move', fleetId: scout.id, targetId: getNeighbors(legacy, scout.systemId)[0] };
  assert.deepEqual(command(legacy, action), command(restored, action));
  assert.deepEqual(restored, legacy);
});
