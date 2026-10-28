import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getEmpireStats, getSystemYield, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { hasSensors, getVisibleFleets } from '../src/intelligence.js';
import { SHIPS } from '../src/content.js';

const system = (state, id) => state.systems.find(s => s.id === id);
const empire = (state, id = 'khar') => state.factions.find(f => f.id === id);

function fixture(lanes, chartedIds) {
  const state = createGame('TACTICAL-AUDIT');
  state.turn = 10;
  state.lanes = lanes;
  state.fleets = state.fleets.filter(f => !['khar', 'player'].includes(f.owner));
  const faction = empire(state);
  faction.credits = 0; faction.minerals = 0; faction.science = 0; faction.orders = 12;
  faction.contacts = ['player']; empire(state, 'player').contacts = ['khar'];
  faction.relations.player.status = 'war'; faction.relations.player.treatyTurn = state.turn;
  empire(state, 'player').relations.khar.status = 'war'; empire(state, 'player').relations.khar.treatyTurn = state.turn;
  for (const location of state.systems) {
    location.knownBy = location.knownBy.filter(id => id !== 'khar');
    location.exploredBy = location.exploredBy.filter(id => id !== 'khar');
    location.anomaly = null;
    if (chartedIds.includes(location.id)) location.knownBy.push('khar');
  }
  system(state, 's2').exploredBy.push('khar');
  return state;
}

function colony(state, id, owner = 'khar', population = 2) {
  const location = system(state, id);
  location.owner = owner; location.population = population; location.buildings = []; location.queue = null;
  if (!location.knownBy.includes(owner)) location.knownBy.push(owner);
  if (!location.exploredBy.includes(owner)) location.exploredBy.push(owner);
  return location;
}

function ship(state, owner, systemId, ships = 1, type = 'frigate') {
  const fleet = { id: `f${state.nextFleetId++}`, name: `${owner} test ${state.nextFleetId}`, owner, systemId, type, ships, hp: SHIPS[type].hp * ships, movesLeft: SHIPS[type].moves };
  state.fleets.push(fleet);
  const location = system(state, systemId);
  if (!location.knownBy.includes(owner)) location.knownBy.push(owner);
  if (!location.exploredBy.includes(owner)) location.exploredBy.push(owner);
  return fleet;
}

function nextAITurn(state) {
  state.turn++;
  empire(state).orders = getEmpireStats(state, 'khar').maxOrders;
  for (const fleet of state.fleets.filter(f => f.owner === 'khar')) fleet.movesLeft = SHIPS[fleet.type].moves;
  runAI(state, empire(state));
}

test('a favorable final colony never sends a force through an observed overwhelming blockade', () => {
  const state = fixture([['s2', 's4'], ['s4', 's5']], ['s2', 's4', 's5']);
  const force = ship(state, 'khar', 's2', 4);
  const blockade = ship(state, 'player', 's4', 8);
  ship(state, 'khar', 's4', 1, 'scout');
  colony(state, 's5', 'player', 1);
  assert.ok(hasSensors(state, 'khar', 's4'), 'the blockade is genuinely observed by a scout');
  runAI(state, empire(state));
  assert.equal(force.systemId, 's2');
  assert.equal(force.ships, 4);
  assert.equal(blockade.ships, 8);
  assert.ok(!state.log.some(entry => entry.type === 'combat'), 'no suicidal intermediate engagement');
});

test('reinforcement routing takes a safe detour around an observed intermediate blockade', () => {
  const state = fixture([['s2', 's4'], ['s4', 's6'], ['s2', 's7'], ['s7', 's8'], ['s8', 's6'], ['s6', 's5']], ['s2', 's4', 's5', 's6', 's7', 's8']);
  const force = ship(state, 'khar', 's2', 2);
  const reserve = ship(state, 'khar', 's2', 4, 'cruiser');
  reserve.movesLeft = 0; // The capital already has a sufficient defensive reserve.
  colony(state, 's5'); colony(state, 's6');
  ship(state, 'player', 's5', 9); // Live sensors from the occupied colony.
  ship(state, 'player', 's4', 8);
  ship(state, 'khar', 's4', 1, 'scout');
  runAI(state, empire(state));
  assert.equal(empire(state).strategy.rallyId, 's6');
  assert.equal(force.systemId, 's7', 'safe alternate route, not the blocked shortest route');
  assert.equal(force.ships, 2);
});

test('wartime task forces rally, merge and relieve a blockade they cannot defeat individually', () => {
  const state = fixture([['s2', 's4'], ['s4', 's5'], ['s5', 's6']], ['s2', 's4', 's5', 's6']);
  colony(state, 's4'); colony(state, 's5'); colony(state, 's6');
  ship(state, 'khar', 's2', 2); ship(state, 'khar', 's4', 2); ship(state, 'khar', 's5', 2);
  const enemy = ship(state, 'player', 's6', 5);
  assert.ok(hasSensors(state, 'khar', 's6'), 'own blockaded colony provides real sensors');
  runAI(state, empire(state));
  assert.equal(empire(state).strategy.rallyId, 's5');
  assert.ok(state.fleets.some(f => f.owner === 'khar' && f.systemId === 's5' && f.ships >= 4));
  nextAITurn(state);
  assert.ok(state.fleets.some(f => f.owner === 'khar' && f.systemId === 's5' && f.ships === 6), 'reinforcements combine during active war');
  nextAITurn(state);
  assert.ok(state.fleets.some(f => f.owner === 'khar' && f.systemId === 's6'), 'assembled task force advances to relieve the colony');
  assert.ok(enemy.hp < SHIPS.frigate.hp * 5, 'the stronger assembled force engages rather than waiting indefinitely');
});

test('an observed threat to a colony takes priority over an easy unrelated conquest', () => {
  const state = fixture([['s2', 's4'], ['s4', 's5'], ['s2', 's7']], ['s2', 's4', 's5', 's7']);
  colony(state, 's4'); colony(state, 's5');
  colony(state, 's7', 'player', 1);
  const force = ship(state, 'khar', 's2', 4);
  ship(state, 'player', 's5', 2);
  runAI(state, empire(state));
  assert.equal(empire(state).strategy.objectiveId, 's5');
  assert.equal(empire(state).strategy.mode, 'defend');
  assert.equal(force.systemId, 's4', 'the fleet reinforces the invaded flank');
  assert.equal(system(state, 's7').owner, 'player');
});

test('several inadequate border garrisons can concentrate even when every origin is threatened', () => {
  const state = fixture([['s2', 's4'], ['s4', 's5'], ['s2', 's6'], ['s4', 's6'], ['s5', 's6']], ['s2', 's4', 's5', 's6']);
  colony(state, 's4'); colony(state, 's5'); colony(state, 's6');
  ship(state, 'khar', 's2', 2); ship(state, 'khar', 's4', 2); ship(state, 'khar', 's5', 2);
  ship(state, 'player', 's6', 5);
  runAI(state, empire(state));
  assert.ok(state.fleets.some(f => f.owner === 'khar' && f.ships >= 4), 'weak border garrisons reinforce one defensible position');
  assert.equal(state.fleets.filter(f => f.owner === 'khar').reduce((total, f) => total + f.ships, 0), 6, 'concentration avoids piecemeal combat');
});

test('an outmatched fleet retreats from shared orbit to an observed safe friendly system', () => {
  const state = fixture([['s2', 's4'], ['s4', 's5']], ['s2', 's4', 's5']);
  colony(state, 's4');
  const force = ship(state, 'khar', 's4', 2);
  const enemy = ship(state, 'player', 's4', 9);
  runAI(state, empire(state));
  assert.equal(force.systemId, 's2');
  assert.equal(force.hp, SHIPS.frigate.hp * 2);
  assert.equal(enemy.hp, SHIPS.frigate.hp * 9);
  assert.ok(!state.log.some(entry => entry.type === 'combat'));
});

test('five ships do not override the strength assessment against a much larger enemy', () => {
  const state = fixture([['s2', 's4']], ['s2', 's4']);
  colony(state, 's4');
  const force = ship(state, 'khar', 's2', 5);
  ship(state, 'player', 's4', 12, 'cruiser');
  runAI(state, empire(state));
  assert.equal(force.systemId, 's2');
  assert.equal(force.ships, 5);
  assert.equal(empire(state).strategy.mode, 'defend');
});

test('moving and strengthening invisible foreign fleets does not change AI decisions', () => {
  const original = fixture([['s2', 's4'], ['s4', 's5'], ['s5', 's6']], ['s2', 's4', 's5', 's6']);
  ship(original, 'khar', 's2', 4);
  colony(original, 's5', 'player', 1); colony(original, 's6', 'player', 1);
  ship(original, 'player', 's6', 1);
  const other = structuredClone(original);
  const hidden = other.fleets.find(f => f.owner === 'player');
  hidden.systemId = 's5'; hidden.ships = 12; hidden.hp = SHIPS.frigate.hp * hidden.ships;
  system(other, 's5').buildings = ['bastion']; system(other, 's5').population = 12;
  assert.equal(hasSensors(original, 'khar', 's5'), false);
  assert.equal(hasSensors(other, 'khar', 's5'), false);
  assert.deepEqual(getVisibleFleets(original, 'khar'), getVisibleFleets(other, 'khar'));
  runAI(original, empire(original)); runAI(other, empire(other));
  assert.deepEqual(ownSnapshot(original), ownSnapshot(other), 'hidden live ships, buildings and population have no influence');
});

function ownSnapshot(state) {
  return { faction: empire(state), fleets: state.fleets.filter(f => f.owner === 'khar'), colonies: state.systems.filter(s => s.owner === 'khar'), rng: state.rng };
}

test('threatened colony construction prioritizes defense and pays normal costs', () => {
  const state = fixture([['s2', 's4']], ['s2', 's4']);
  colony(state, 's4');
  const faction = empire(state); faction.techs.push('shields'); faction.credits = 100; faction.minerals = 100;
  ship(state, 'player', 's4', 8);
  const before = getSystemYield(state, system(state, 's4')).defense;
  runAI(state, faction);
  assert.equal(system(state, 's4').queue?.itemId, 'bastion');
  assert.ok(faction.credits <= 55 && faction.minerals <= 40, 'normal construction costs are spent');
  assert.equal(getSystemYield(state, system(state, 's4')).defense, before, 'queued construction gives no instant bonus');
});

test('an intercepted scout spends one attempt and never probes the same hidden destination twice in a turn', () => {
  const state = fixture([['s2', 's4']], ['s2', 's4']);
  const scout = ship(state, 'khar', 's2', 1, 'scout');
  ship(state, 'player', 's4', 3);
  assert.equal(hasSensors(state, 'khar', 's4'), false);
  const beforeOrders = empire(state).orders;
  runAI(state, empire(state));
  assert.equal(scout.systemId, 's2');
  assert.equal(scout.movesLeft, 1);
  assert.equal(empire(state).orders, beforeOrders - 1);
  assert.equal(system(state, 's4').exploredBy.includes('khar'), false);
});

test('a full AI turn preserves save validity and the shared resource/order constraints', () => {
  for (const seed of ['ASTERION', 'strategy-2', 'strategy-3']) {
    const state = createGame(seed), faction = empire(state);
    const budget = faction.orders;
    runAI(state, faction);
    assert.ok(validateSave(state));
    assert.ok(faction.orders <= budget && faction.orders >= 0);
    assert.ok(faction.credits >= 0 && faction.minerals >= 0);
    assert.ok(faction.research || faction.techs.length, 'research is directed');
    assert.ok(state.fleets.some(f => f.owner === 'khar' && f.systemId !== faction.capitalId), 'the exploration loop remains active');
  }
});
