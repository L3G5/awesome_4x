import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getNeighbors, getRoutePreview, getSystemYield, getConstructionProject, getEmpireStats, validateSave } from '../src/game.js';
import { getKnownStarlanes, getStarlaneOptions, knownTravelDistance } from '../src/starlanes.js';
import { graphDistances } from '../src/galaxy-generation.js';
import { getInvestmentForecast } from '../src/ai.js';
import { STARLANE_PROJECT, SHIPS } from '../src/content.js';
import { legacyCampaign } from './legacy-campaign-fixture.js';

// Controlled ownership/technology establishes the decision; all construction,
// cancellation, capture, completion and travel below use ordinary commands.
function fixture(seed = 'starlane-laws') {
  const state = createGame(seed), player = state.factions[0], lane = state.ancientLanes[0];
  const [a, b] = lane.endpoints.map(id => state.systems.find(system => system.id === id));
  a.owner = 'player'; a.population = 4; a.buildings = ['mine', 'shipyard']; a.queue = null;
  for (const world of state.systems) {
    if (!world.knownBy.includes('player')) world.knownBy.push('player');
    if (!world.exploredBy.includes('player')) world.exploredBy.push('player');
  }
  player.techs = ['logistics']; player.credits = 500; player.minerals = 500; player.orders = 6;
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  scout.systemId = a.id;
  return { state, player, lane, a, b, scout };
}
const restore = ({ state, lane, a }, factionId = 'player') => command(state, { type: 'restoreLane', factionId, systemId: a.id, laneId: lane.id });
const unchangedFailure = (state, action) => { const before = JSON.stringify(state); assert.equal(command(state, action).ok, false); assert.equal(JSON.stringify(state), before); };

test('two dormant shortcuts remain useful in either order and preserve capital separation', () => {
  for (let index = 0; index < 64; index++) {
    const state = createGame(index ? `stage30-map-${index}` : 'ASTERION');
    assert.equal(state.ancientLanes.length, 2); assert.equal(validateSave(state), true);
    for (const lane of state.ancientLanes) {
      const [a, b] = lane.endpoints.map(id => state.systems.find(system => system.id === id));
      const other = state.ancientLanes.find(candidate => candidate !== lane);
      assert(!a.originalOwner && !b.originalOwner);
      assert(Math.hypot(a.x - b.x, a.y - b.y) <= 35);
      const before = graphDistances(state.lanes, a.id).get(b.id);
      assert(before >= 3 && before <= 6);
      assert(graphDistances([...state.lanes, other.endpoints], a.id).get(b.id) >= 3);
      assert(!getNeighbors(state, a.id).includes(b.id));
    }
    const opened = [...state.lanes, ...state.ancientLanes.map(lane => lane.endpoints)];
    for (let first = 0; first < 4; first++) for (let second = first + 1; second < 4; second++) assert(graphDistances(opened, `s${first}`).get(`s${second}`) >= 5);
  }
});

test('restoration pays an ordinary colony queue and blocks competing commissions', () => {
  const f = fixture(), { state, player, lane, a, b } = f;
  const buildings = [...a.buildings], before = { credits: player.credits, minerals: player.minerals, orders: player.orders };
  const option = getStarlaneOptions(state, a.id).find(candidate => candidate.id === lane.id);
  assert.equal(option.enabled, true); assert.equal(option.afterJumps, 1);
  assert.equal(option.beforeJumps, knownTravelDistance(state, 'player', a.id, b.id));
  assert.equal(option.turns, Math.ceil(48 / getSystemYield(state, a).production));
  assert.equal(restore(f).ok, true);
  assert.equal(player.credits, before.credits - 60); assert.equal(player.minerals, before.minerals - 70); assert.equal(player.orders, before.orders - 1);
  assert.deepEqual(a.queue, { itemId: 'starlane', kind: 'starlane', laneId: lane.id, progress: 0, work: 48, cost: { credits: 60, minerals: 70 } });
  assert.equal(getConstructionProject(a.queue).name, 'Starlane restoration'); assert.deepEqual(a.buildings, buildings);
  unchangedFailure(state, { type: 'build', systemId: a.id, itemId: 'lab' });
  b.owner = 'veyr'; b.population = 1; b.knownBy.push('veyr'); b.exploredBy.push('veyr'); a.knownBy.push('veyr');
  const rival = state.factions[1]; rival.techs = ['logistics']; rival.credits = 500; rival.minerals = 500;
  unchangedFailure(state, { type: 'restoreLane', factionId: 'veyr', systemId: b.id, laneId: lane.id });
  assert.match(getStarlaneOptions(state, b.id, 'veyr')[0].reason, /already underway/);
  assert.equal(validateSave(state), true);
});

test('invalid or unavailable restoration is atomic at every ordinary boundary', () => {
  const cases = [
    f => { f.a.owner = null; },
    f => { f.player.techs = []; },
    f => { f.player.credits = 59; },
    f => { f.player.minerals = 69; },
    f => { f.player.orders = 0; },
    f => { command(f.state, { type: 'build', systemId: f.a.id, itemId: 'lab' }); },
    f => { f.a.exploredBy = []; f.b.exploredBy = []; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    unchangedFailure(f.state, { type: 'restoreLane', systemId: f.a.id, laneId: f.lane.id });
  }
  const f = fixture();
  for (const action of [{ type: 'restoreLane', systemId: f.a.id, laneId: 'constructor' }, { type: 'restoreLane', systemId: 's0', laneId: f.lane.id }, { type: 'restoreLane', laneId: f.lane.id }]) unchangedFailure(f.state, action);
});

test('ordinary completion opens one shared lane without replacing an existing course', () => {
  const f = fixture(), { state, lane, a, b, scout } = f;
  b.owner = 'player'; b.population = 1;
  const route = getRoutePreview(state, scout.id, b.id); assert.equal(route.ok, true); assert(route.jumps >= 3);
  assert.equal(command(state, { type: 'planRoute', fleetId: scout.id, destinationId: b.id }).ok, true);
  const savedCourse = structuredClone(scout.route), beforeBuildings = [...a.buildings];
  assert.equal(restore(f).ok, true);
  unchangedFailure(state, { type: 'move', fleetId: scout.id, targetId: b.id });
  let cycles = 0;
  while (a.queue) { assert.equal(endTurn(state).ok, true); assert.equal(validateSave(state), true); assert(++cycles <= 10); }
  assert.equal(lane.openedTurn, state.turn); assert.equal(lane.openedBy, 'player');
  assert.equal(state.lanes.filter(edge => edge.includes(a.id) && edge.includes(b.id)).length, 1);
  assert.deepEqual(a.buildings, beforeBuildings); assert.equal(scout.systemId, a.id); assert.deepEqual(scout.route, savedCourse);
  assert.equal(getRoutePreview(state, scout.id, b.id).jumps, 1);
  assert.equal(state.log.filter(entry => entry.type === 'starlane').length, 1);
  assert.equal(state.lastBriefing.entries.filter(entry => entry.type === 'starlane').length, 1);
  const before = { orders: state.factions[0].orders, moves: scout.movesLeft };
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: b.id }).ok, true);
  assert.equal(scout.systemId, b.id); assert.equal(scout.movesLeft, before.moves - 1); assert.equal(state.factions[0].orders, before.orders - 1);
  assert.equal(scout.route, undefined); assert.equal(validateSave(state), true);
});

test('another empire pays normal movement and still needs border access on a restored lane', () => {
  const f = fixture(), { state, lane, a, b } = f;
  assert.equal(restore(f).ok, true);
  while (a.queue) endTurn(state);
  const rival = state.factions[1], fleet = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'scout');
  fleet.systemId = b.id; fleet.movesLeft = 2; rival.orders = 4;
  a.knownBy.push('veyr'); b.knownBy.push('veyr');
  unchangedFailure(state, { type: 'move', factionId: 'veyr', fleetId: fleet.id, targetId: a.id });
  rival.contacts = [...new Set([...rival.contacts, 'player'])]; state.factions[0].contacts = [...new Set([...state.factions[0].contacts, 'veyr'])];
  rival.relations.player.trade = true; state.factions[0].relations.veyr.trade = true;
  const before = { orders: rival.orders, moves: fleet.movesLeft };
  assert.equal(command(state, { type: 'move', factionId: 'veyr', fleetId: fleet.id, targetId: a.id }).ok, true);
  assert.equal(fleet.systemId, a.id); assert.equal(rival.orders, before.orders - 1); assert.equal(fleet.movesLeft, before.moves - 1);
  unchangedFailure(state, { type: 'restoreLane', systemId: a.id, laneId: lane.id });
});

test('cancellation refunds only unspent resources and releases the shared project', () => {
  const f = fixture(), { state, player, lane, a, b } = f;
  assert.equal(restore(f).ok, true); endTurn(state);
  const remaining = 1 - a.queue.progress / a.queue.work, before = { credits: player.credits, minerals: player.minerals, orders: player.orders };
  assert.equal(command(state, { type: 'cancelBuild', systemId: a.id }).ok, true);
  assert.equal(player.credits, before.credits + Math.floor(60 * remaining)); assert.equal(player.minerals, before.minerals + Math.floor(70 * remaining)); assert.equal(player.orders, before.orders);
  assert.equal(lane.openedTurn, null); assert(!getNeighbors(state, a.id).includes(b.id));
  assert.equal(getStarlaneOptions(state, a.id)[0].enabled, true);
  assert.equal(restore(f).ok, true); assert.equal(validateSave(state), true);
});

test('a normal invasion cancels the prior owner’s restoration and releases the lane', () => {
  const f = fixture(), { state, lane, a, b } = f;
  assert.equal(restore(f).ok, true);
  f.scout.systemId = 's0';
  const attacker = state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'frigate'), khar = state.factions[2];
  attacker.systemId = a.id; attacker.ships = 12; attacker.hp = SHIPS.frigate.hp * attacker.ships; khar.orders = 5;
  for (const id of ['player', 'khar']) { if (!a.knownBy.includes(id)) a.knownBy.push(id); if (!a.exploredBy.includes(id)) a.exploredBy.push(id); }
  khar.contacts.push('player'); state.factions[0].contacts.push('khar');
  assert.equal(command(state, { type: 'diplomacy', factionId: 'khar', targetId: 'player', stance: 'war' }).ok, true);
  const invasion = command(state, { type: 'attack', factionId: 'khar', fleetId: attacker.id });
  assert.equal(invasion.ok, true); assert.equal(a.owner, 'khar'); assert.equal(a.queue, null);
  assert.equal(lane.openedTurn, null); assert(!getNeighbors(state, a.id).includes(b.id));
  khar.techs.push('logistics'); khar.credits = 500; khar.minerals = 500;
  assert.equal(command(state, { type: 'restoreLane', factionId: 'khar', systemId: a.id, laneId: lane.id }).ok, true);
  assert.equal(validateSave(state), true);
});

test('survey signals reveal a charted endpoint but not its resources, fleets or private work', () => {
  const f = fixture(), { state, lane, a, b, scout } = f;
  b.knownBy = []; b.exploredBy = []; a.exploredBy = [];
  const neighborId = getNeighbors(state, a.id).find(id => state.systems.find(system => system.id === id).owner !== 'khar');
  scout.systemId = neighborId;
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: a.id }).ok, true);
  assert(b.knownBy.includes('player')); assert(!b.exploredBy.includes('player'));
  assert.equal(getKnownStarlanes(state).some(candidate => candidate.id === lane.id), true);
  const snapshot = JSON.stringify(state), views = [getKnownStarlanes(state), getStarlaneOptions(state, a.id)];
  assert.equal(JSON.stringify(state), snapshot);
  const hidden = structuredClone(state), remote = hidden.systems.find(system => system.id === b.id);
  remote.richness = 5; remote.science = 4; remote.population = 11; remote.buildings = ['lab', 'factory'];
  remote.queue = { kind: 'building', itemId: 'beacon', work: 140, progress: 89, cost: { credits: 120, minerals: 120 } };
  hidden.factions[2].credits += 900; hidden.factions[2].techs.push('computing');
  hidden.fleets.find(fleet => fleet.owner === 'khar').systemId = b.id;
  assert.deepEqual([getKnownStarlanes(hidden), getStarlaneOptions(hidden, a.id)], views);
});

test('foreign restoration publishes only the project identity, never its progress or production', () => {
  const f = fixture(), { state, a, b, lane } = f;
  state.factions[0].contacts.push('veyr'); state.factions[1].contacts.push('player');
  a.owner = 'veyr'; state.factions[1].techs = ['logistics']; state.factions[1].credits = 500; state.factions[1].minerals = 500;
  a.knownBy.push('veyr'); a.exploredBy.push('veyr'); b.knownBy.push('veyr');
  assert.equal(restore(f, 'veyr').ok, true);
  const view = getKnownStarlanes(state).find(candidate => candidate.id === lane.id);
  const foreignOption = getStarlaneOptions(state, a.id);
  assert.equal(foreignOption[0].turns, null);
  assert.deepEqual(view.project, { systemId: a.id, owner: 'veyr' });
  a.queue.progress = 35; a.population = 9; a.buildings.push('factory');
  assert.deepEqual(getKnownStarlanes(state).find(candidate => candidate.id === lane.id), view);
  assert.deepEqual(getStarlaneOptions(state, a.id), foreignOption);
  state.factions[0].contacts = [];
  assert.equal(getKnownStarlanes(state).find(candidate => candidate.id === lane.id).project.owner, null);
});

test('reload preserves queue, next cycle and opening; malformed links and queues are rejected', () => {
  const f = fixture(); assert.equal(restore(f).ok, true); endTurn(f.state);
  const restored = JSON.parse(JSON.stringify(f.state)); assert.equal(validateSave(restored), true);
  endTurn(f.state); endTurn(restored); assert.deepEqual(restored, f.state);
  const malformed = [
    state => { state.ancientLanes[0].endpoints[0] = 's0'; },
    state => { state.ancientLanes[0].endpoints[1] = state.ancientLanes[0].endpoints[0]; },
    state => { state.ancientLanes[0].openedTurn = 1; },
    state => { state.lanes.push([...state.ancientLanes[0].endpoints]); },
    state => { state.ancientLanes.push(structuredClone(state.ancientLanes[0])); },
    state => { state.systems.find(system => system.queue?.kind === 'starlane').queue.cost.credits = 1000; },
    state => { state.systems.find(system => system.queue?.kind === 'starlane').queue.laneId = 'constructor'; },
    state => { state.systems.find(system => system.queue?.kind === 'starlane').queue.work = 1; },
    state => { const source = state.systems.find(system => system.queue?.kind === 'starlane'); state.systems.find(system => system.id === state.ancientLanes[0].endpoints.find(id => id !== source.id)).queue = structuredClone(source.queue); },
    state => { delete state.ancientLanes; },
  ];
  for (const mutate of malformed) { const bad = structuredClone(f.state); mutate(bad); assert.equal(validateSave(bad), false); }
  const legacy = legacyCampaign('formation-sequence'), text = JSON.stringify(legacy);
  assert.deepEqual(getKnownStarlanes(legacy), []); assert.equal(validateSave(legacy), true); assert.equal(JSON.stringify(legacy), text);
  assert.equal(STARLANE_PROJECT.work, 48); assert(getEmpireStats(f.state).production > 0);
});


test('economic forecasts treat a restoration queue as occupied work, not infrastructure', () => {
  const f = fixture(); assert.equal(restore(f).ok, true);
  const option = { id: 'lab', kind: 'building', cost: { credits: 30, minerals: 30 }, work: 30 };
  const before = JSON.stringify(f.state);
  const forecast = getInvestmentForecast(f.state, 'player', 's0', option);
  assert.equal(typeof forecast.worthwhile, 'boolean');
  assert.equal(JSON.stringify(f.state), before);
});
