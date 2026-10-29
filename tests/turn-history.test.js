import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, validateSave, getVisibleFleets } from '../src/game.js';
import { getDiscoveryView, observeDiscovery } from '../src/discoveries.js';
import { getActiveDiplomacyOffers } from '../src/diplomacy.js';
import { TurnHistory, applyTurnCommand, applyTurnBoundary, persistTurnHistory } from '../src/turn-history.js';

const clone = value => structuredClone(value);
const faction = (state, id = 'player') => state.factions.find(item => item.id === id);
const world = (state, id = 's0') => state.systems.find(item => item.id === id);
const fleet = (state, owner = 'player', type = 'scout') => state.fleets.find(item => item.owner === owner && item.type === type);
const freshHistory = () => new TurnHistory(validateSave);
function fresh(seed = 'TURN-HISTORY') {
  const state = createGame(seed);
  Object.assign(faction(state), { credits: 500, minerals: 500, orders: 12, techs: ['logistics', 'industry'] });
  assert.equal(validateSave(state), true); return state;
}
function war(state, other = 'veyr') {
  for (const [from, to] of [['player', other], [other, 'player']]) {
    if (!faction(state, from).contacts.includes(to)) faction(state, from).contacts.push(to);
    Object.assign(faction(state, from).relations[to], { status: 'war', trade: false, treatyTurn: state.turn, warStartColonies: state.systems.filter(system => system.owner === from).length });
  }
}

// Expected outcomes use the real engine independently of the history helper.
// Complete comparisons include RNG, hidden knowledge, reports, escrow and IDs.
function roundTrip(before, action, context = {}) {
  assert.equal(validateSave(before), true);
  const untouched = clone(before), expected = clone(before), result = command(expected, action);
  assert.equal(result.ok, true, result.message);
  const history = freshHistory(), actual = applyTurnCommand(before, action, history, context);
  assert.deepEqual(actual.result, result); assert.deepEqual(actual.state, expected);
  assert.deepEqual(before, untouched, 'a committed candidate does not mutate its caller');
  assert.equal(validateSave(actual.state), true); assert.equal(history.size, 1);
  const undone = history.undo(actual.state);
  assert.deepEqual(undone.state, untouched); assert.deepEqual(undone.context, context);
  assert.equal(undone.message, result.message); assert.equal(history.size, 0);
  const repeated = applyTurnCommand(undone.state, action, history, context);
  assert.deepEqual(repeated, actual, 'the identical command after Undo reproduces its full result and state');
  assert.equal(history.size, 1);
  return { before: untouched, after: actual.state, result: actual.result, history };
}

test('paid construction and cancellation undo independently without multiplying refunds or orders', () => {
  const initial = fresh(), history = freshHistory();
  const built = applyTurnCommand(initial, { type: 'build', systemId: 's0', itemId: 'factory' }, history);
  assert.equal(built.result.ok, true); assert.equal(faction(built.state).credits, 465); assert.equal(faction(built.state).minerals, 455);
  assert.equal(faction(built.state).orders, 11); assert.equal(world(built.state).queue.itemId, 'factory');
  const cancelled = applyTurnCommand(built.state, { type: 'cancelBuild', systemId: 's0' }, history);
  assert.equal(cancelled.result.ok, true); assert.equal(faction(cancelled.state).credits, 500); assert.equal(faction(cancelled.state).minerals, 500);
  assert.equal(faction(cancelled.state).orders, 11, 'free cancellation does not refund the spent build order');
  assert.equal(history.size, 2);
  const queueRestored = history.undo(cancelled.state); assert.deepEqual(queueRestored.state, built.state);
  const repeatedCancel = applyTurnCommand(queueRestored.state, { type: 'cancelBuild', systemId: 's0' }, history);
  assert.deepEqual(repeatedCancel, cancelled);
  assert.deepEqual(history.undo(repeatedCancel.state).state, built.state);
  assert.deepEqual(history.undo(built.state).state, initial);
  assert.equal(history.undo(initial), null);

  const partial = fresh(); world(partial).queue = { kind: 'building', itemId: 'factory', work: 40, progress: 17, cost: { credits: 35, minerals: 45 } };
  const result = roundTrip(partial, { type: 'cancelBuild', systemId: 's0' });
  assert.equal(faction(result.after).credits, 520); assert.equal(faction(result.after).minerals, 525);
});

test('free research, route and hold changes are undo steps; failed commands and literal no-ops are not', () => {
  const initial = fresh(); initial.lanes = [['s0', 's4'], ['s4', 's5']]; initial.ancientLanes = [];
  for (const id of ['s4', 's5']) { const system = world(initial, id); system.owner = null; system.population = 0; if (!system.knownBy.includes('player')) system.knownBy.push('player'); }
  const history = freshHistory(), scoutId = fleet(initial).id;
  let state = initial;
  for (const action of [{ type: 'research', techId: 'physics' }, { type: 'planRoute', fleetId: scoutId, destinationId: 's5' }, { type: 'hold', fleetId: scoutId }]) {
    const answer = applyTurnCommand(state, action, history); assert.equal(answer.result.ok, true); state = answer.state;
    assert.equal(faction(state).orders, faction(initial).orders);
  }
  assert.equal(history.size, 3);
  const acknowledgement = applyTurnCommand(state, { type: 'hold', fleetId: scoutId }, history);
  assert.equal(acknowledgement.result.ok, true); assert.deepEqual(acknowledgement.state, state); assert.equal(history.size, 3);
  const rejected = applyTurnCommand(state, { type: 'move', fleetId: scoutId, targetId: 's40' }, history);
  assert.equal(rejected.result.ok, false); assert.equal(rejected.state, state); assert.equal(history.size, 3);
  while (history.size) state = history.undo(state).state;
  assert.deepEqual(state, initial);
});

test('movement rolls back surveys, first contact, public Beacon charts and dormant signals together', () => {
  const state = fresh(), scout = fleet(state);
  state.lanes = [['s0', 's4'], ['s4', 's5']]; state.ancientLanes = [{ id: 'l0', endpoints: ['s4', 's8'], openedTurn: null, openedBy: null }];
  faction(state).contacts = [];
  Object.assign(world(state, 's4'), { owner: null, population: 0, buildings: [], queue: null, anomaly: { id: 'observatory', resolved: false }, knownBy: ['player'], exploredBy: [] });
  Object.assign(world(state, 's5'), { owner: 'veyr', population: 4, buildings: ['beacon'], queue: null, charter: null, knownBy: ['veyr'], exploredBy: ['veyr'], anomaly: null });
  world(state, 's8').knownBy = world(state, 's8').knownBy.filter(id => id !== 'player');
  world(state, 's8').exploredBy = world(state, 's8').exploredBy.filter(id => id !== 'player');
  const { after } = roundTrip(state, { type: 'move', fleetId: scout.id, targetId: 's4' }, { selectedSystemId: 's4', selectedFleetId: scout.id, page: 'galaxy' });
  assert.equal(fleet(after).systemId, 's4'); assert(world(after, 's4').exploredBy.includes('player'));
  assert(faction(after).contacts.includes('veyr')); assert(world(after, 's5').knownBy.includes('player'));
  assert(world(after, 's8').knownBy.includes('player')); assert(!world(after, 's8').exploredBy.includes('player'));
  assert.equal(getDiscoveryView(after, 's4').canInteract, true);
  assert.equal(getVisibleFleets(state, 'player', 's4').length, 0);
});

test('one continued two-jump course is one atomic undo step with its saved route restored', () => {
  const state = fresh(), scout = fleet(state);
  state.lanes = [['s0', 's4'], ['s4', 's5']]; state.ancientLanes = [];
  for (const id of ['s4', 's5']) Object.assign(world(state, id), { owner: null, population: 0, anomaly: null, knownBy: ['player'], exploredBy: [] });
  assert.equal(command(state, { type: 'planRoute', fleetId: scout.id, destinationId: 's5' }).ok, true);
  const route = clone(scout.route), travel = roundTrip(state, { type: 'continueRoute', fleetId: scout.id });
  assert.equal(fleet(travel.after).systemId, 's5'); assert.equal(faction(travel.after).orders, faction(state).orders - 2);
  assert.equal(fleet(travel.after).movesLeft, scout.movesLeft - 2); assert.equal(fleet(travel.after).route, undefined);
  const undone = travel.history.undo(travel.after); assert.deepEqual(fleet(undone.state).route, route);
});

test('a paid unknown interception is undoable even though the civilian never changes systems', () => {
  const state = fresh(), scout = fleet(state); war(state);
  state.lanes = [['s0', 's4']]; state.ancientLanes = [];
  Object.assign(world(state, 's4'), { owner: null, population: 0, anomaly: null, knownBy: ['player'], exploredBy: [] });
  fleet(state, 'veyr', 'frigate').systemId = 's4';
  const intercepted = roundTrip(state, { type: 'move', fleetId: scout.id, targetId: 's4' });
  assert.equal(intercepted.result.outcome, 'intercepted'); assert.equal(fleet(intercepted.after).systemId, scout.systemId);
  assert.equal(faction(intercepted.after).orders, faction(state).orders - 1);
  assert.equal(fleet(intercepted.after).movesLeft, scout.movesLeft - 1);
  assert.equal(world(intercepted.after, 's4').exploredBy.includes('player'), false);
});

test('colonization rollback restores its consumed Ark and the entire neutral world without free founding', () => {
  const state = fresh(), ark = fleet(state, 'player', 'colony'), system = world(state, 's4');
  Object.assign(system, { owner: null, population: 0, habitability: 80, buildings: [], queue: null, anomaly: null, knownBy: ['player'], exploredBy: ['player'] });
  ark.systemId = system.id;
  const founded = roundTrip(state, { type: 'colonize', fleetId: ark.id }, { selectedSystemId: system.id, selectedFleetId: ark.id });
  assert.equal(world(founded.after, system.id).owner, 'player'); assert.equal(world(founded.after, system.id).population, 1);
  assert.equal(founded.after.fleets.some(item => item.id === ark.id), false);
  assert.equal(faction(founded.after).credits, 470); assert.equal(faction(founded.after).minerals, 480);
  assert.equal(faction(founded.after).orders, 11);
});

test('combat rollback restores casualties, battle rounds, logs, counters and RNG without a reroll', () => {
  const state = fresh(); war(state);
  const attacker = fleet(state, 'player', 'frigate'), defender = fleet(state, 'veyr', 'frigate');
  Object.assign(attacker, { ships: 4, hp: 136 }); Object.assign(defender, { systemId: attacker.systemId, ships: 3, hp: 102 });
  const battle = roundTrip(state, { type: 'attack', fleetId: attacker.id });
  assert.notEqual(battle.after.rng, state.rng); assert.ok(battle.result.combatReports.length);
  assert.ok(battle.result.combatReports[0].rounds.length); assert.ok(battle.after.nextCombatReportId > state.nextCombatReportId);
  assert.notDeepEqual(battle.after.fleets, state.fleets);
});

test('a destroyed selected fleet and both simultaneous losses can be restored exactly', () => {
  const state = fresh(); war(state);
  const attacker = fleet(state, 'player', 'frigate'), defender = fleet(state, 'veyr', 'frigate');
  attacker.hp = 1; defender.systemId = attacker.systemId; defender.hp = 1;
  const battle = roundTrip(state, { type: 'attack', fleetId: attacker.id }, { selectedSystemId: attacker.systemId, selectedFleetId: attacker.id });
  assert.equal(battle.after.fleets.some(item => item.id === attacker.id), false);
  assert.equal(battle.after.fleets.some(item => item.id === defender.id), false);
});

test('a player capture that ends the campaign can still be undone with the cancelled queue restored', () => {
  const state = fresh();
  for (const id of ['s1', 's2']) { world(state, id).owner = 'player'; world(state, id).knownBy.push('player'); world(state, id).exploredBy.push('player'); }
  const target = world(state, 's3');
  Object.assign(target, { population: 1, buildings: [], queue: { kind: 'building', itemId: 'market', progress: 8, work: 24, cost: { credits: 25, minerals: 20 } } });
  target.knownBy.push('player'); target.exploredBy.push('player');
  for (const item of state.fleets.filter(item => item.owner === 'choir')) item.systemId = 's20';
  war(state, 'choir');
  const attacker = fleet(state, 'player', 'frigate'); Object.assign(attacker, { systemId: target.id, ships: 12, hp: 408 });
  const capture = roundTrip(state, { type: 'attack', fleetId: attacker.id });
  assert.equal(capture.after.winner, 'player'); assert.equal(capture.after.victoryType, 'Domination');
  assert.equal(world(capture.after, target.id).queue, null);
  const failedBoundary = applyTurnBoundary(capture.after, capture.history);
  assert.equal(failedBoundary.result.ok, false); assert.equal(failedBoundary.state, capture.after); assert.equal(capture.history.size, 1);
  assert.deepEqual(capture.history.undo(capture.after).state, state);
});

test('discovery rollback restores unique ship heritage, reward entitlement and IDs without duplication', () => {
  for (const [id, choice] of [['forge', 'ship'], ['observatory', 'preserve']]) {
    const state = fresh(), system = world(state, 's4');
    Object.assign(system, { owner: null, population: 0, buildings: [], queue: null, anomaly: { id, resolved: false }, knownBy: ['player'], exploredBy: ['player'] });
    fleet(state).systemId = system.id; faction(state).techs.push('physics'); observeDiscovery(state, system.id, 'player');
    const discovery = roundTrip(state, { type: 'anomaly', systemId: system.id, choiceId: choice });
    if (id === 'forge') {
      assert.equal(discovery.after.nextFleetId, state.nextFleetId + 1);
      assert.equal(discovery.after.fleets.filter(item => item.heritage?.some(entry => entry.systemId === system.id)).length, 1);
    } else { assert.equal(world(discovery.after, system.id).anomaly.stage, 'maturing'); assert.equal(faction(discovery.after).credits, faction(state).credits - 40); }
  }
});

test('answering funded peace and trade offers rewinds escrow, refunds, treaties and withdrawals exactly', () => {
  for (const kind of ['peace', 'trade']) for (const response of ['accept', 'decline']) {
    const state = fresh(); state.turn = 20;
    if (kind === 'peace') { war(state); for (const [from, to] of [['player', 'veyr'], ['veyr', 'player']]) faction(state, from).relations[to].treatyTurn = 1; }
    else { faction(state).contacts.push('veyr'); faction(state, 'veyr').contacts.push('player'); }
    const proposerCredits = faction(state, 'veyr').credits;
    assert.equal(command(state, { type: 'diplomacy', factionId: 'veyr', targetId: 'player', stance: kind }).ok, true);
    const offer = getActiveDiplomacyOffers(state).find(item => item.kind === kind);
    assert.ok(offer); assert.equal(faction(state, 'veyr').credits, proposerCredits - (kind === 'peace' ? 60 : 30));
    if (kind === 'peace') { fleet(state, 'player', 'frigate').systemId = 's1'; fleet(state, 'veyr', 'frigate').systemId = 's0'; }
    const answer = roundTrip(state, { type: 'diplomacy', stance: `${response}${kind === 'peace' ? 'Peace' : 'Trade'}`, offerId: offer.id });
    assert.equal(answer.after.diplomacyOffers.find(item => item.id === offer.id).status, response === 'accept' ? 'accepted' : 'declined');
    assert.equal(faction(answer.after).credits - faction(state).credits, kind === 'peace' && response === 'accept' ? 60 : 0);
    assert.equal(faction(answer.after, 'veyr').credits, response === 'decline' ? proposerCredits : faction(state, 'veyr').credits);
    if (kind === 'peace' && response === 'accept') assert.equal(fleet(answer.after, 'veyr', 'frigate').systemId, 's1');
  }
});

test('JSON reload preserves the complete stack and rejects stale current state or invalid earlier snapshots', () => {
  const initial = fresh(), history = freshHistory(), context = { selectedSystemId: 's0', selectedFleetId: fleet(initial).id, page: 'galaxy', workspaceScroll: 30 };
  const one = applyTurnCommand(initial, { type: 'research', techId: 'physics' }, history, context);
  const two = applyTurnCommand(one.state, { type: 'hold', fleetId: fleet(initial).id }, history, context);
  const serialized = history.serialize(two.state), loaded = freshHistory(), current = JSON.parse(JSON.stringify(two.state));
  assert.equal(loaded.restore(serialized, current), true); assert.equal(loaded.size, 2);
  const firstUndo = loaded.undo(current); assert.deepEqual(firstUndo.state, one.state); assert.deepEqual(firstUndo.context, context);
  assert.deepEqual(loaded.undo(firstUndo.state).state, initial);
  for (const mutate of [
    record => { record.version = 99; },
    record => { record.entries[0].snapshot = '{'; },
    record => { const state = JSON.parse(record.entries[0].snapshot); state.turn++; record.entries[0].snapshot = JSON.stringify(state); },
    record => { const state = JSON.parse(record.entries[0].snapshot); state.seed += '-other'; record.entries[0].snapshot = JSON.stringify(state); },
    record => { const state = JSON.parse(record.entries[0].snapshot); faction(state).credits = -1; record.entries[0].snapshot = JSON.stringify(state); },
    record => { record.entries[0].message = { invalid: true }; },
  ]) {
    const record = JSON.parse(serialized); mutate(record); const rejected = freshHistory();
    assert.equal(rejected.restore(JSON.stringify(record), current), false); assert.equal(rejected.size, 0); assert.equal(rejected.undo(current), null);
  }
  const stale = clone(current); faction(stale).credits++;
  assert.equal(freshHistory().restore(serialized, stale), false, 'same seed and cycle cannot attach history to different funds');
  const beforeStaleUndo = clone(stale); assert.equal(history.undo(stale), null); assert.deepEqual(stale, beforeStaleUndo);
  assert.equal(freshHistory().restore('{', current), false);
});

test('forty changed free acknowledgements remain individually undoable without a hidden history cap', () => {
  const initial = fresh(), history = freshHistory(), id = fleet(initial).id;
  let state = initial;
  for (let index = 0; index < 40; index++) state = applyTurnCommand(state, { type: index % 2 ? 'resume' : 'hold', fleetId: id }, history).state;
  assert.equal(history.size, 40);
  const restored = freshHistory(); assert.equal(restored.restore(history.serialize(state), state), true);
  for (let index = 0; index < 40; index++) state = restored.undo(state).state;
  assert.deepEqual(state, initial); assert.equal(restored.size, 0);
});

test('ordinary End Cycle is atomic and clears the completed cycle history', () => {
  const initial = fresh(), history = freshHistory();
  const prior = applyTurnCommand(initial, { type: 'hold', fleetId: fleet(initial).id }, history).state;
  const expected = clone(prior), expectedResult = endTurn(expected);
  const boundary = applyTurnBoundary(prior, history);
  assert.deepEqual(boundary.result, expectedResult); assert.deepEqual(boundary.state, expected);
  assert.equal(boundary.state.turn, prior.turn + 1); assert.equal(history.size, 0); assert.equal(history.undo(boundary.state), null);
  assert.equal(fleet(prior).hold, true); assert.equal(prior.turn, initial.turn); assert.equal(validateSave(boundary.state), true);
});

test('an AI domination during End Cycle clears history even though the turn number never increments', () => {
  const state = fresh(), veyr = faction(state, 'veyr');
  for (const id of ['s2', 's3']) { world(state, id).owner = 'veyr'; world(state, id).knownBy.push('veyr'); world(state, id).exploredBy.push('veyr'); }
  Object.assign(world(state), { population: 1, buildings: [], queue: null });
  for (const item of state.fleets.filter(item => item.owner === 'player')) item.systemId = 's10';
  war(state); veyr.orders = 12;
  Object.assign(fleet(state, 'veyr', 'frigate'), { systemId: 's0', ships: 12, hp: 408 });
  assert.equal(validateSave(state), true);
  const history = freshHistory(), held = applyTurnCommand(state, { type: 'hold', fleetId: fleet(state).id }, history).state;
  const boundary = applyTurnBoundary(held, history);
  assert.equal(boundary.result.ok, true); assert.equal(boundary.state.winner, 'veyr'); assert.equal(boundary.state.victoryType, 'Domination');
  assert.equal(boundary.state.turn, held.turn); assert.equal(history.size, 0); assert.equal(history.undo(boundary.state), null);
  assert.equal(held.winner, null, 'AI resolution commits a candidate and preserves the caller');
  assert.equal(validateSave(boundary.state), true);
});

class Storage {
  constructor(entries = [], quota = Infinity) { this.values = new Map(entries); this.quota = quota; this.calls = []; }
  getItem(key) { return this.values.get(key) ?? null; }
  removeItem(key) { this.calls.push(['remove', key]); if (this.failRemove) throw Error('remove blocked'); this.values.delete(key); }
  setItem(key, value) {
    this.calls.push(['set', key]);
    if (key === 'save' && this.failSave || key === 'history' && this.failHistory) throw Error('write blocked');
    const next = new Map(this.values); next.set(key, String(value));
    if ([...next.values()].reduce((total, item) => total + item.length, 0) > this.quota) throw Error('quota exceeded');
    this.values = next;
  }
}

test('storage quota first releases old history, saves the latest campaign and preserves in-memory Undo', () => {
  const initial = fresh(), history = freshHistory();
  const changed = applyTurnCommand(initial, { type: 'hold', fleetId: fleet(initial).id }, history).state;
  const savedText = JSON.stringify(changed), quota = savedText.length + Math.floor(history.serialize(changed).length / 2);
  const storage = new Storage([['save', JSON.stringify(initial)], ['history', 'x'.repeat(quota - JSON.stringify(initial).length)]], quota);
  assert.deepEqual(persistTurnHistory(storage, 'save', 'history', changed, history), { saved: true, historySaved: false });
  assert.equal(storage.getItem('save'), savedText); assert.equal(storage.getItem('history'), null);
  assert.deepEqual(storage.calls.slice(0, 2), [['remove', 'history'], ['set', 'save']]);
  assert.equal(history.size, 1); assert.deepEqual(history.undo(changed).state, initial);
});

test('partial storage failures cannot attach stale history to the newly saved checkpoint', () => {
  const initial = fresh(), history = freshHistory();
  const one = applyTurnCommand(initial, { type: 'hold', fleetId: fleet(initial).id }, history).state;
  const oldHistory = history.serialize(one), two = applyTurnCommand(one, { type: 'research', techId: 'physics' }, history).state;
  const stale = new Storage([['save', JSON.stringify(one)], ['history', oldHistory]]); stale.failRemove = true; stale.failHistory = true;
  assert.deepEqual(persistTurnHistory(stale, 'save', 'history', two, history), { saved: true, historySaved: false });
  assert.deepEqual(JSON.parse(stale.getItem('save')), two); assert.equal(history.size, 2);
  assert.equal(freshHistory().restore(stale.getItem('history'), JSON.parse(stale.getItem('save'))), false);
  const unavailable = new Storage([['save', JSON.stringify(one)], ['history', oldHistory]]); unavailable.failSave = true;
  assert.deepEqual(persistTurnHistory(unavailable, 'save', 'history', two, history), { saved: false, historySaved: false });
  assert.deepEqual(JSON.parse(unavailable.getItem('save')), one); assert.equal(history.size, 2);
  const durable = new Storage(); assert.deepEqual(persistTurnHistory(durable, 'save', 'history', two, history), { saved: true, historySaved: true });
  const loaded = freshHistory(); assert.equal(loaded.restore(durable.getItem('history'), JSON.parse(durable.getItem('save'))), true);
  assert.deepEqual(loaded.undo(two).state, one); history.clear();
  assert.deepEqual(persistTurnHistory(durable, 'save', 'history', initial, history), { saved: true, historySaved: true });
  assert.equal(durable.getItem('history'), null, 'a cleared cycle/new-game/import stack leaves no stale persisted history');
});
