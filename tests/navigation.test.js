import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, validateSave, getRoutePreview, getRouteStatus } from '../src/game.js';
import { advanceDiplomacy } from '../src/diplomacy.js';
import { SHIPS } from '../src/content.js';

const empire = (state, id = 'player') => state.factions.find(faction => faction.id === id);
const world = (state, id) => state.systems.find(system => system.id === id);
const fleetOf = (state, owner = 'player', type = 'scout') => state.fleets.find(fleet => fleet.owner === owner && fleet.type === type);
function fixture(type = 'scout') {
  const state = createGame('route-regression');
  state.lanes = [['s0', 's4'], ['s4', 's5'], ['s5', 's6'], ['s6', 's7'], ['s0', 's8']];
  for (const system of state.systems) {
    if (!system.knownBy.includes('player')) system.knownBy.push('player');
    if (['s4', 's5', 's6', 's7', 's8'].includes(system.id)) { system.anomaly = null; system.exploredBy = system.exploredBy.filter(id => id !== 'player'); }
  }
  empire(state).contacts = [];
  const fleet = fleetOf(state, 'player', type);
  return { state, fleet };
}
function plan(state, fleet, destinationId = 's7') {
  const result = command(state, { type: 'planRoute', fleetId: fleet.id, destinationId });
  assert.ok(result.ok, result.message);
  return fleet.route;
}
const advance = (state, fleet) => command(state, { type: 'continueRoute', fleetId: fleet.id });
function war(state, other = 'veyr') {
  empire(state).relations[other].status = 'war';
  empire(state, other).relations.player.status = 'war';
}

test('shortest charted routing has numeric deterministic ties and ignores hidden fleet/anomaly state', () => {
  const { state, fleet } = fixture();
  state.lanes = [['s0', 's10'], ['s10', 's7'], ['s0', 's4'], ['s4', 's7']];
  war(state);
  const before = structuredClone(state), preview = getRoutePreview(state, fleet.id, 's7');
  assert.deepEqual(state, before, 'preview is pure');
  assert.deepEqual(preview.path, ['s0', 's4', 's7']);
  assert.deepEqual(preview.uncertainSystems, ['s4', 's7']);
  const enemy = fleetOf(state, 'veyr', 'frigate'); enemy.systemId = 's4'; enemy.ships = 12; enemy.hp = 408;
  world(state, 's4').anomaly = { id: 'archive', resolved: false };
  state.lanes.reverse();
  assert.deepEqual(getRoutePreview(state, fleet.id, 's7'), preview, 'hidden opposition, hidden discoveries, and lane ordering cannot select a route');
  world(state, 's4').owner = 'choir';
  assert.deepEqual(getRoutePreview(state, fleet.id, 's7').path, ['s0', 's10', 's7'], 'public closed sovereignty permits a deterministic detour');
  world(state, 's10').knownBy = [];
  assert.equal(getRoutePreview(state, fleet.id, 's7').ok, false);
});

test('planning and clearing are free with exhausted budgets, and routes own their path arrays', () => {
  const { state, fleet } = fixture();
  empire(state).orders = 0; fleet.movesLeft = 0;
  const rng = state.rng, preview = getRoutePreview(state, fleet.id, 's7');
  assert.equal(preview.ok, true); assert.equal(preview.maxOrdersNow, 0);
  plan(state, fleet); preview.path.pop();
  assert.equal(fleet.route.path.length, 5);
  assert.equal(empire(state).orders, 0); assert.equal(fleet.movesLeft, 0); assert.equal(state.rng, rng);
  assert.ok(command(state, { type: 'clearRoute', fleetId: fleet.id }).ok);
  assert.equal(getRouteStatus(state, fleet.id).ok, false);
  plan(state, fleet);
  assert.ok(command(state, { type: 'planRoute', fleetId: fleet.id, destinationId: fleet.systemId }).ok);
  assert.equal(fleet.route, undefined);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'planRoute', fleetId: fleetOf(state, 'veyr').id, destinationId: 's7' }).ok, false);
  assert.deepEqual(state, before);
});

test('Continue makes ordinary surveys up to movement allowance and returns actual costs', () => {
  const { state, fleet } = fixture(); plan(state, fleet);
  const orders = empire(state).orders;
  assert.equal(getRouteStatus(state, fleet.id).maxJumpsNow, 2);
  const result = advance(state, fleet);
  assert.deepEqual({ ok: result.ok, outcome: result.outcome, jumps: result.jumpsCompleted, orders: result.ordersSpent, moves: result.movesSpent, reports: result.combatReports }, { ok: true, outcome: 'moves-exhausted', jumps: 2, orders: 2, moves: 2, reports: [] });
  assert.equal(empire(state).orders, orders - 2); assert.equal(fleet.systemId, 's5');
  assert.deepEqual(fleet.route, { destinationId: 's7', path: ['s5', 's6', 's7'] });
  assert.ok(world(state, 's4').exploredBy.includes('player')); assert.ok(world(state, 's5').exploredBy.includes('player'));
  const before = structuredClone(state);
  assert.equal(advance(state, fleet).ok, false); assert.deepEqual(state, before);
});

test('Continue respects empire orders independently of fleet moves and clears a completed route', () => {
  const { state, fleet } = fixture(); plan(state, fleet, 's5'); empire(state).orders = 1;
  const first = advance(state, fleet);
  assert.equal(first.outcome, 'orders-exhausted'); assert.equal(first.jumpsCompleted, 1); assert.equal(fleet.movesLeft, 1);
  empire(state).orders = 1;
  const last = advance(state, fleet);
  assert.equal(last.outcome, 'arrived'); assert.equal(last.ordersSpent, 1); assert.equal(fleet.systemId, 's5'); assert.equal(fleet.route, undefined);
});

test('observed hostile first steps reject atomically for civilians and warships while planning remains valid', () => {
  for (const type of ['scout', 'frigate']) {
    const { state, fleet } = fixture(type); war(state);
    fleetOf(state, 'veyr', 'frigate').systemId = 's4';
    fleetOf(state, 'player', 'colony').systemId = 's4';
    const preview = getRoutePreview(state, fleet.id, 's7');
    assert.equal(preview.ok, true); assert.equal(preview.maxJumpsNow, 0); assert.equal(preview.stopBefore.systemId, 's4');
    plan(state, fleet);
    const before = structuredClone(state), result = advance(state, fleet);
    assert.equal(result.ok, false); assert.equal(result.ordersSpent, 0); assert.equal(result.jumpsCompleted, 0);
    assert.match(result.message, /observed hostile/i); assert.deepEqual(state, before);
  }
});

test('a visible future blockade caps cost and returns successful partial movement', () => {
  const { state, fleet } = fixture(); war(state); empire(state).contacts.push('veyr');
  fleetOf(state, 'veyr', 'frigate').systemId = 's5'; fleetOf(state, 'player', 'colony').systemId = 's5';
  plan(state, fleet);
  const status = getRouteStatus(state, fleet.id);
  assert.equal(status.ok, true); assert.equal(status.maxJumpsNow, 1); assert.equal(status.stopBefore.systemId, 's5');
  const result = advance(state, fleet);
  assert.equal(result.ok, true); assert.equal(result.outcome, 'blocked'); assert.equal(result.ordersSpent, 1); assert.equal(fleet.systemId, 's4');
  assert.deepEqual(fleet.route.path, ['s4', 's5', 's6', 's7']);
});

test('a newly closed border leaves the saved route visible but requires explicit replot to detour', () => {
  const { state, fleet } = fixture(); plan(state, fleet);
  world(state, 's4').owner = 'veyr'; state.lanes.push(['s8', 's7']);
  const before = structuredClone(state), status = getRouteStatus(state, fleet.id);
  assert.equal(status.ok, true); assert.equal(status.maxJumpsNow, 0); assert.deepEqual(status.path, ['s0', 's4', 's5', 's6', 's7']);
  assert.equal(advance(state, fleet).ok, false); assert.deepEqual(state, before); assert.ok(validateSave(state));
  plan(state, fleet); assert.deepEqual(fleet.route.path, ['s0', 's8', 's7']);
});

test('hidden interception spends one attempted jump and keeps the original route without survey or sensor oracle', () => {
  const { state, fleet } = fixture(); war(state); plan(state, fleet);
  const prior = structuredClone(getRouteStatus(state, fleet.id));
  fleetOf(state, 'veyr', 'frigate').systemId = 's4';
  assert.deepEqual(getRouteStatus(state, fleet.id), prior);
  const result = advance(state, fleet);
  assert.equal(result.ok, true); assert.equal(result.outcome, 'intercepted'); assert.equal(result.ordersSpent, 1); assert.equal(result.movesSpent, 1); assert.equal(result.jumpsCompleted, 0);
  assert.equal(fleet.systemId, 's0'); assert.deepEqual(fleet.route.path, ['s0', 's4', 's5', 's6', 's7']);
  assert.equal(world(state, 's4').exploredBy.includes('player'), false);
  assert.equal(getRouteStatus(state, fleet.id).stopBefore, null, 'interception is historical contact, not persistent live sensors');
});

test('an interception after one successful jump reports both spent moves but only one completed jump', () => {
  const { state, fleet } = fixture(); war(state); plan(state, fleet);
  fleetOf(state, 'veyr', 'frigate').systemId = 's5';
  const result = advance(state, fleet);
  assert.equal(result.outcome, 'intercepted'); assert.equal(result.jumpsCompleted, 1); assert.equal(result.ordersSpent, 2); assert.equal(result.movesSpent, 2);
  assert.equal(fleet.systemId, 's4'); assert.deepEqual(fleet.route.path, ['s4', 's5', 's6', 's7']);
  assert.equal(world(state, 's5').exploredBy.includes('player'), false);
});

test('hidden battles stop the route immediately and return all reports and actual survival', () => {
  for (const survives of [true, false]) {
    const { state, fleet } = fixture('frigate'); war(state); fleet.movesLeft = 3;
    fleet.ships = survives ? 12 : 1; fleet.hp = fleet.ships * SHIPS.frigate.hp;
    const enemy = fleetOf(state, 'veyr', 'frigate'); enemy.systemId = 's4'; enemy.ships = survives ? 1 : 12; enemy.hp = enemy.ships * SHIPS.frigate.hp;
    if (survives) { const other = fleetOf(state, 'veyr', 'scout'); other.systemId = 's4'; }
    plan(state, fleet);
    const result = advance(state, fleet);
    assert.equal(result.outcome, survives ? 'combat' : 'destroyed'); assert.equal(result.ordersSpent, 1); assert.equal(result.movesSpent, 1); assert.equal(result.jumpsCompleted, 1);
    assert.equal(result.combatReports.length, survives ? 2 : 1);
    assert.equal(state.fleets.includes(fleet), survives);
    if (survives) assert.deepEqual(fleet.route.path, ['s4', 's5', 's6', 's7']);
    assert.ok(validateSave(state));
  }
});

test('explicit rival routes also stop after combat without leaking AI-only battle reports to the player', () => {
  const { state } = fixture();
  const fleet = fleetOf(state, 'veyr', 'frigate'), enemy = fleetOf(state, 'khar', 'frigate');
  fleet.systemId = 's4'; fleet.movesLeft = 3; fleet.ships = 12; fleet.hp = 408; enemy.systemId = 's5';
  for (const system of state.systems) if (!system.knownBy.includes('veyr')) system.knownBy.push('veyr');
  empire(state, 'veyr').relations.khar.status = 'war'; empire(state, 'khar').relations.veyr.status = 'war';
  assert.ok(command(state, { type: 'planRoute', factionId: 'veyr', fleetId: fleet.id, destinationId: 's7' }).ok);
  const result = command(state, { type: 'continueRoute', factionId: 'veyr', fleetId: fleet.id });
  assert.equal(result.outcome, 'combat'); assert.equal(result.jumpsCompleted, 1); assert.equal(fleet.systemId, 's5');
  assert.deepEqual(result.combatReports, []); assert.deepEqual(state.combatReports, []); assert.equal(state.log.some(entry => entry.type === 'combat'), false);
});

test('first contact stops on neighboring public sovereignty even after a routine survey', () => {
  const { state, fleet } = fixture(); world(state, 's5').owner = 'veyr'; empire(state).relations.veyr.trade = true; empire(state, 'veyr').relations.player.trade = true;
  plan(state, fleet);
  const result = advance(state, fleet);
  assert.equal(result.outcome, 'first-contact'); assert.equal(result.jumpsCompleted, 1); assert.equal(fleet.systemId, 's4'); assert.ok(empire(state).contacts.includes('veyr'));
});

test('new unresolved anomalies stop navigation, while remembered unresolved sites do not', () => {
  for (const remembered of [false, true]) {
    const { state, fleet } = fixture();
    const anomaly = state.systems.find(system => system.anomaly)?.anomaly;
    world(state, 's4').anomaly = structuredClone(anomaly);
    assert.ok(anomaly);
    if (remembered) world(state, 's4').exploredBy.push('player');
    plan(state, fleet);
    const result = advance(state, fleet);
    assert.equal(result.outcome, remembered ? 'moves-exhausted' : 'discovery');
    assert.equal(result.jumpsCompleted, remembered ? 2 : 1);
  }
});

test('newly surveyed multi-stage discoveries and restored sites pause routes through the observer-safe view', () => {
  const discoveries = [
    { id: 'observatory', resolved: false },
    { id: 'reef', resolved: false, stage: 'maturing', progress: 1, startedTurn: 1 },
    { id: 'observatory', resolved: false, stage: 'ready', progress: 3, startedTurn: 1 },
    { id: 'observatory', resolved: true, stage: 'resolved', resolvedBy: 'veyr', restoration: { buildingId: 'ancient_observatory', turn: 1, factionId: 'veyr' } },
  ];
  for (const anomaly of discoveries) {
    const { state, fleet } = fixture(); world(state, 's4').anomaly = structuredClone(anomaly);
    if (anomaly.restoration) world(state, 's4').buildings.push('ancient_observatory');
    plan(state, fleet);
    const preview = getRouteStatus(state, fleet.id);
    assert.equal(preview.maxJumpsNow, 2, 'a hidden site never changes the disclosed route ceiling');
    const result = advance(state, fleet);
    assert.equal(result.outcome, 'discovery'); assert.equal(result.jumpsCompleted, 1); assert.equal(fleet.systemId, 's4');
    assert.ok(validateSave(state));
  }
});

test('direct moves advance a matching route, clear a deviation, and leave failed movement untouched', () => {
  const { state, fleet } = fixture(); plan(state, fleet);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: fleet.id, targetId: 's7' }).ok, false); assert.deepEqual(state, before);
  assert.ok(command(state, { type: 'move', fleetId: fleet.id, targetId: 's4' }).ok);
  assert.deepEqual(fleet.route.path, ['s4', 's5', 's6', 's7']);
  assert.ok(command(state, { type: 'move', fleetId: fleet.id, targetId: 's0' }).ok);
  assert.equal(fleet.route, undefined);
});

test('merging preserves only the selected surviving fleet route', () => {
  const { state, fleet } = fixture('frigate'); plan(state, fleet);
  const other = { ...fleet, id: `f${state.nextFleetId++}`, route: { destinationId: 's8', path: ['s0', 's8'] } }; state.fleets.push(other);
  assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: other.id }).ok);
  assert.deepEqual(fleet.route.path, ['s0', 's4', 's5', 's6', 's7']); assert.equal(state.fleets.includes(other), false); assert.ok(validateSave(state));
});

test('administrative treaty withdrawal clears routes even when diplomacy advances outside game commands', () => {
  const { state, fleet } = fixture();
  world(state, 's4').owner = 'veyr'; fleet.systemId = 's4';
  empire(state).relations.veyr.trade = true; empire(state, 'veyr').relations.player.trade = true;
  plan(state, fleet);
  for (const relation of [empire(state).relations.veyr, empire(state, 'veyr').relations.player]) relation.tradeEndsAt = state.turn;
  advanceDiplomacy(state);
  assert.equal(fleet.systemId, 's0'); assert.equal(fleet.route, undefined); assert.equal(fleet.movesLeft, 0); assert.ok(validateSave(state));
});

test('routes persist through twenty deterministic reload cycles without automatic movement or order spending', () => {
  const { state, fleet } = fixture(); plan(state, fleet);
  let loaded = JSON.parse(JSON.stringify(state));
  for (let cycle = 0; cycle < 20; cycle++) {
    endTurn(state); endTurn(loaded); loaded = JSON.parse(JSON.stringify(loaded));
    assert.deepEqual(loaded, JSON.parse(JSON.stringify(state))); assert.ok(validateSave(loaded));
    assert.equal(fleet.systemId, 's0'); assert.deepEqual(fleet.route.path, ['s0', 's4', 's5', 's6', 's7']);
    assert.equal(fleet.movesLeft, SHIPS.scout.moves);
  }
});

test('version-one saves accept optional valid routes but reject malformed, stale, looping and disconnected paths', () => {
  const { state, fleet } = fixture(); assert.ok(validateSave(state)); plan(state, fleet); assert.ok(validateSave(state));
  const invalidRoutes = [null, [], {}, { destinationId: 's7', path: ['s0', 's7'] }, { destinationId: 's7', path: ['s4', 's5', 's6', 's7'] }, { destinationId: 's0', path: ['s0', 's4', 's0'] }, { destinationId: 's6', path: ['s0', 's4', 's5', 's6', 's7'] }, { destinationId: 's4', path: ['s0', 's4'], automatic: true }, { destinationId: 'missing', path: ['s0', 'missing'] }, { destinationId: 's0', path: ['s0'] }];
  for (const route of invalidRoutes) { const broken = structuredClone(state); fleetOf(broken).route = route; assert.equal(validateSave(broken), false, JSON.stringify(route)); }
  const uncharted = structuredClone(state); world(uncharted, 's5').knownBy = []; assert.equal(validateSave(uncharted), false);
});
