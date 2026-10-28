import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getFleetReadiness, getReadyFleets, getNeighbors, getColonyRepairForecast, validateSave } from '../src/game.js';
import { captureFleetReadiness, reconcileFleetReadiness } from '../src/fleet-readiness.js';
import { SHIPS } from '../src/content.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const own = (state, type = 'frigate') => state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === type);
const act = (state, action) => { const result = command(state, action); assert.ok(result.ok, result.message); return result; };
const withoutHolds = state => { const copy = structuredClone(state); for (const fleet of copy.fleets) delete fleet.hold; return copy; };
function contacts(state, first = 'player', second = 'veyr') {
  for (const [a, b] of [[first, second], [second, first]]) if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
}
function war(state, first = 'player', second = 'veyr') {
  contacts(state, first, second);
  for (const [a, b] of [[first, second], [second, first]]) Object.assign(faction(state, a).relations[b], { status: 'war', trade: false });
}
function quiet(state) { for (const f of state.factions.filter(f => f.id !== 'player')) f.orders = 0; }

test('hold and resume are metadata-only commands, including with no orders or movement', () => {
  const state = createGame('advisory-hold'), fleet = own(state);
  fleet.movesLeft = 0; faction(state).orders = 0;
  const before = structuredClone(state);
  act(state, { type: 'hold', fleetId: fleet.id });
  const expected = structuredClone(before); own(expected).hold = true;
  assert.deepEqual(state, expected);
  assert.equal(getFleetReadiness(state, fleet.id).held, true);
  assert.equal(getFleetReadiness(state, fleet.id).ready, false);
  act(state, { type: 'hold', fleetId: fleet.id });
  assert.deepEqual(state, expected, 'repeated acknowledgement changes nothing');
  act(state, { type: 'resume', fleetId: fleet.id });
  assert.deepEqual(state, before);
});

test('one pure readiness predicate excludes held, spent and unaffordable movement without hiding fleets', () => {
  const state = createGame('ready-cycling'), fleet = own(state), before = structuredClone(state);
  assert.deepEqual(getReadyFleets(state).map(f => f.id), state.fleets.filter(f => f.owner === 'player').map(f => f.id));
  assert.deepEqual(state, before);
  act(state, { type: 'hold', fleetId: fleet.id });
  assert.ok(!getReadyFleets(state).includes(fleet));
  const scout = own(state, 'scout'); scout.movesLeft = .5;
  assert.equal(getFleetReadiness(state, scout.id).ready, false, 'fractional legacy movement cannot pay for a jump');
  for (const f of state.fleets.filter(f => f.owner === 'player')) act(state, { type: 'hold', fleetId: f.id });
  assert.deepEqual(getReadyFleets(state), []);
  act(state, { type: 'resume', fleetId: fleet.id });
  faction(state).orders = 0;
  assert.equal(getFleetReadiness(state, fleet.id).ready, false);
  faction(state).orders = 1; state.winner = 'player';
  assert.equal(getFleetReadiness(state, fleet.id).ready, false);
});

test('foreign readiness stays observer-neutral regardless of hidden orders, location, hold or movement', () => {
  const state = createGame('private-hold'), foreign = state.fleets.find(f => f.owner === 'khar');
  const before = getFleetReadiness(state, foreign.id);
  assert.deepEqual(before, getFleetReadiness(state, 'missing-fleet'));
  foreign.hold = true; foreign.movesLeft = 0; foreign.systemId = 's40'; faction(state, 'khar').orders = 0;
  assert.deepEqual(getFleetReadiness(state, foreign.id), before);
  assert.ok(getReadyFleets(state).every(f => f.owner === 'player'));
});

test('v1 saves accept absent/boolean holds and preserve them exactly through JSON reload', () => {
  const state = createGame('hold-save'), fleet = own(state);
  assert.ok(validateSave(state));
  act(state, { type: 'hold', fleetId: fleet.id });
  const copy = JSON.parse(JSON.stringify(state));
  assert.ok(validateSave(copy)); assert.deepEqual(copy, state);
  assert.deepEqual(getFleetReadiness(copy, fleet.id), getFleetReadiness(state, fleet.id));
  for (const value of [null, 1, 'hold', [], {}]) { own(copy).hold = value; assert.equal(validateSave(copy), false); }
  own(copy).hold = false; assert.ok(validateSave(copy));
});

test('invalid commands leave holds and every other campaign field unchanged', () => {
  const state = createGame('hold-atomic'), fleet = own(state);
  act(state, { type: 'hold', fleetId: fleet.id });
  const foreign = state.fleets.find(f => f.owner !== 'player');
  const unknown = state.systems.find(system => !system.knownBy.includes('player')).id;
  for (const action of [
    { type: 'hold', fleetId: foreign.id }, { type: 'resume', fleetId: foreign.id },
    { type: 'hold' }, { type: 'resume', fleetId: 'missing' },
    { type: 'move', fleetId: fleet.id, targetId: unknown },
    { type: 'attack', fleetId: fleet.id }, { type: 'continueRoute', fleetId: fleet.id },
    { type: 'planRoute', fleetId: fleet.id, destinationId: unknown },
    { type: 'split', fleetId: fleet.id, ships: 1 },
  ]) { const before = structuredClone(state); assert.equal(command(state, action).ok, false, JSON.stringify(action)); assert.deepEqual(state, before); }
  fleet.movesLeft = 0;
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: fleet.id, targetId: getNeighbors(state, fleet.systemId)[0] }).ok, false);
  assert.deepEqual(state, before);
  fleet.movesLeft = 1; faction(state).orders = 0;
  const noOrders = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: fleet.id, targetId: getNeighbors(state, fleet.systemId)[0] }).ok, false);
  assert.deepEqual(state, noOrders);
});

test('holding preserves routes; successful planning/movement resumes and clearing a route does not', () => {
  const state = createGame('held-route'), fleet = own(state, 'scout'), target = getNeighbors(state, fleet.systemId)[0];
  act(state, { type: 'planRoute', fleetId: fleet.id, destinationId: target });
  const route = structuredClone(fleet.route);
  act(state, { type: 'hold', fleetId: fleet.id }); assert.deepEqual(fleet.route, route);
  act(state, { type: 'clearRoute', fleetId: fleet.id }); assert.equal(fleet.hold, true);
  act(state, { type: 'planRoute', fleetId: fleet.id, destinationId: fleet.systemId }); assert.equal(fleet.hold, true);
  act(state, { type: 'planRoute', fleetId: fleet.id, destinationId: target }); assert.equal(fleet.hold, undefined);
  act(state, { type: 'hold', fleetId: fleet.id });
  const orders = faction(state).orders, moves = fleet.movesLeft;
  act(state, { type: 'continueRoute', fleetId: fleet.id });
  assert.equal(fleet.hold, undefined); assert.equal(fleet.systemId, target);
  assert.equal(faction(state).orders, orders - 1); assert.equal(fleet.movesLeft, moves - 1);
  act(state, { type: 'hold', fleetId: fleet.id });
  act(state, { type: 'move', fleetId: fleet.id, targetId: 's0' });
  assert.equal(fleet.hold, undefined);
});

test('a spent civilian interception resumes attention even though the ship withdraws to its origin', () => {
  const state = createGame('held-interception'), fleet = own(state, 'scout'), target = getNeighbors(state, fleet.systemId)[0];
  war(state);
  const enemy = state.fleets.find(f => f.owner === 'veyr' && f.type === 'frigate'); enemy.systemId = target;
  act(state, { type: 'hold', fleetId: fleet.id });
  const moves = fleet.movesLeft, orders = faction(state).orders;
  const result = act(state, { type: 'move', fleetId: fleet.id, targetId: target });
  assert.equal(result.outcome, 'intercepted'); assert.equal(fleet.systemId, 's0'); assert.equal(fleet.hold, undefined);
  assert.equal(fleet.movesLeft, moves - 1); assert.equal(faction(state).orders, orders - 1);
});

test('split retains the original garrison and merge retains only the survivor own advisory state', () => {
  const state = createGame('hold-formation'), fleet = own(state);
  fleet.ships = 3; fleet.hp = 81.2; faction(state).orders = 10;
  act(state, { type: 'hold', fleetId: fleet.id });
  const result = act(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  const detached = state.fleets.find(f => f.id === result.newFleetId);
  assert.equal(fleet.hold, true); assert.equal(detached.hold, undefined);
  assert.equal(getFleetReadiness(state, detached.id).ready, true);
  act(state, { type: 'merge', fleetId: fleet.id, targetFleetId: detached.id }); assert.equal(fleet.hold, true);
  const next = act(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  const active = state.fleets.find(f => f.id === next.newFleetId);
  act(state, { type: 'merge', fleetId: active.id, targetFleetId: fleet.id }); assert.equal(active.hold, undefined);
  assert.ok(validateSave(state));
});

test('repair and pure forecasts preserve a garrison without changing repair eligibility', () => {
  const state = createGame('held-maintenance'), fleet = own(state); fleet.hp = 10;
  const forecast = getColonyRepairForecast(state, fleet.systemId);
  act(state, { type: 'hold', fleetId: fleet.id });
  assert.deepEqual(getColonyRepairForecast(state, fleet.systemId), forecast);
  const before = structuredClone(state); getFleetReadiness(state, fleet.id); getReadyFleets(state);
  assert.deepEqual(state, before);
  act(state, { type: 'repair', fleetId: fleet.id }); assert.equal(fleet.hold, true); assert.equal(fleet.hp, SHIPS.frigate.hp);
});

test('actual combat wakes participating fleets but holding never changes rolls, casualties or other state', () => {
  const state = createGame('hold-combat'), fleet = own(state), enemy = state.fleets.find(f => f.owner === 'veyr' && f.type === 'frigate');
  fleet.ships = 8; fleet.hp = 8 * SHIPS.frigate.hp; enemy.systemId = fleet.systemId; war(state);
  act(state, { type: 'hold', fleetId: fleet.id }); act(state, { type: 'hold', fleetId: enemy.id, factionId: 'veyr' });
  const ordinary = withoutHolds(state), action = { type: 'attack', fleetId: fleet.id };
  assert.deepEqual(command(state, action), command(ordinary, action));
  assert.equal(fleet.hold, undefined); assert.equal(enemy.hold, undefined);
  assert.deepEqual(state, ordinary);
});

test('a new local hostile colony owner wakes once; acknowledging unchanged hostility is respected', () => {
  const state = createGame('local-declaration'), fleet = own(state, 'scout');
  fleet.systemId = 's1'; state.fleets = [fleet]; contacts(state);
  act(state, { type: 'hold', fleetId: fleet.id });
  act(state, { type: 'diplomacy', targetId: 'veyr', stance: 'war' });
  assert.equal(fleet.hold, undefined, 'hostile colony ownership alone is an observed local change');
  act(state, { type: 'hold', fleetId: fleet.id });
  act(state, { type: 'research', techId: 'logistics' });
  assert.equal(fleet.hold, true, 'an unrelated command must not repeat the same warning');
  const before = captureFleetReadiness(state); reconcileFleetReadiness(state, before); reconcileFleetReadiness(state, before);
  assert.equal(fleet.hold, true);
});

test('a hostile ship completed locally wakes a held fleet through end-turn reconciliation', () => {
  const state = createGame('local-launch'), fleet = own(state, 'scout');
  fleet.systemId = 's1'; state.fleets = [fleet]; war(state); quiet(state);
  const colony = state.systems.find(s => s.id === 's1');
  colony.queue = { itemId: 'frigate', kind: 'ship', progress: SHIPS.frigate.work - 1, work: SHIPS.frigate.work, cost: { ...SHIPS.frigate.cost } };
  act(state, { type: 'hold', fleetId: fleet.id });
  assert.ok(validateSave(state)); assert.ok(endTurn(state).ok);
  assert.ok(state.fleets.some(f => f.owner === 'veyr' && f.systemId === 's1'));
  assert.equal(fleet.hold, undefined);
  act(state, { type: 'hold', fleetId: fleet.id });
  act(state, { type: 'research', techId: 'logistics' });
  assert.equal(fleet.hold, true, 'a newly acknowledged local fleet is not perpetually new');
});

test('forced treaty withdrawal resumes a held fleet while retaining ordinary relocation and movement rules', () => {
  const state = createGame('held-withdrawal'), fleet = own(state, 'scout');
  fleet.systemId = 's1'; state.fleets = [fleet]; contacts(state); quiet(state);
  for (const [a, b] of [['player', 'veyr'], ['veyr', 'player']]) Object.assign(faction(state, a).relations[b], { trade: true, tradeEndsAt: 2 });
  act(state, { type: 'hold', fleetId: fleet.id });
  const ordinary = withoutHolds(state);
  assert.deepEqual(endTurn(state), endTurn(ordinary));
  assert.equal(fleet.systemId, 's0'); assert.equal(fleet.hold, undefined);
  assert.deepEqual(state, ordinary);
});

test('hidden or merely adjacent hostile fleets do not affect garrison attention', () => {
  const state = createGame('hold-hidden'), fleet = own(state); war(state);
  act(state, { type: 'hold', fleetId: fleet.id });
  const other = structuredClone(state), enemy = other.fleets.find(f => f.owner === 'veyr' && f.type === 'frigate');
  const originalObservation = captureFleetReadiness(other);
  enemy.systemId = getNeighbors(other, 's0')[0]; enemy.ships = 12; enemy.hp = 12 * SHIPS.frigate.hp;
  other.fleets.push({ ...structuredClone(enemy), id: `f${other.nextFleetId++}` });
  reconcileFleetReadiness(other, originalObservation);
  for (const sample of [state, other]) { const baseline = captureFleetReadiness(sample); reconcileFleetReadiness(sample, baseline); act(sample, { type: 'research', techId: 'logistics' }); }
  assert.equal(fleet.hold, true); assert.equal(own(other).hold, true);
  assert.deepEqual(getFleetReadiness(state, fleet.id), getFleetReadiness(other, fleet.id));
});

test('held ordinary campaigns reload exactly and retain the same simulation as unheld campaigns', () => {
  const state = createGame('hold-campaign'), fleet = own(state); act(state, { type: 'hold', fleetId: fleet.id });
  let reloaded = JSON.parse(JSON.stringify(state)); const ordinary = withoutHolds(state);
  for (let index = 0; index < 8; index++) {
    assert.deepEqual(endTurn(state), endTurn(reloaded)); endTurn(ordinary);
    assert.deepEqual(state, reloaded); assert.deepEqual(withoutHolds(state), ordinary);
    assert.equal(fleet.hold, true); assert.ok(validateSave(state));
    reloaded = JSON.parse(JSON.stringify(reloaded));
  }
});
