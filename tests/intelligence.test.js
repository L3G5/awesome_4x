import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getNeighbors, getVisibleSystems, getEmpireStats, estimateCombat, validateSave } from '../src/game.js';
import { hasSensors, getVisibleFleets } from '../src/intelligence.js';
import { SHIPS } from '../src/content.js';

const faction = (state, id = 'player') => state.factions.find(f => f.id === id);
const fleet = (state, owner, type) => state.fleets.find(f => f.owner === owner && f.type === type);
const system = (state, id) => state.systems.find(s => s.id === id);
function war(state, a, b) {
  faction(state, a).relations[b].status = 'war';
  faction(state, b).relations[a].status = 'war';
  faction(state, a).relations[b].treatyTurn = state.turn;
  faction(state, b).relations[a].treatyTurn = state.turn;
}
function interceptionFixture(type = 'scout') {
  const state = createGame('sensor-interception');
  const civilian = fleet(state, 'player', type);
  const target = system(state, getNeighbors(state, civilian.systemId)[0]);
  const enemy = fleet(state, 'veyr', 'frigate');
  enemy.systemId = target.id;
  enemy.ships = 2; enemy.hp = SHIPS.frigate.hp * 2;
  war(state, 'player', 'veyr');
  return { state, civilian, target, enemy };
}

test('sensors require presence, not old charts or surveys, and the rule applies to every faction', () => {
  const state = createGame();
  const remote = system(state, 's20');
  remote.knownBy = ['player', 'veyr']; remote.exploredBy = ['player', 'veyr'];
  const enemy = fleet(state, 'khar', 'frigate'); enemy.systemId = remote.id;
  assert.equal(hasSensors(state, 'player', remote.id), false);
  assert.equal(hasSensors(state, 'veyr', remote.id), false);
  assert.equal(getVisibleFleets(state, 'player', remote.id).length, 0);
  assert.equal(getVisibleFleets(state, 'veyr', remote.id).length, 0);
  const own = fleet(state, 'player', 'scout'); own.systemId = remote.id;
  assert.equal(hasSensors(state, 'player', remote.id), true);
  assert.deepEqual(getVisibleFleets(state, 'player', remote.id).map(f => f.id).sort(), [own.id, enemy.id].sort());
  assert.equal(getVisibleFleets(state, 'veyr', remote.id).length, 0);
  own.systemId = 's0';
  assert.equal(getVisibleFleets(state, 'player', remote.id).length, 0, 'moving away loses live surveillance');
  remote.owner = 'veyr';
  assert.equal(hasSensors(state, 'veyr', remote.id), true, 'a colony provides sensors without a fleet');
  assert.ok(getVisibleFleets(state, 'veyr', remote.id).some(f => f.id === enemy.id));
  assert.ok(getVisibleSystems(state, 'player').some(s => s.id === remote.id && s.owner === 'veyr'), 'charted sovereignty remains public');
  assert.ok(remote.exploredBy.includes('player'), 'survey memories persist');
  assert.equal(hasSensors(state, 'player', 'missing'), false);
});

test('moving an unseen enemy cannot change the public fleet list or combat estimate', () => {
  const state = createGame();
  const own = fleet(state, 'player', 'frigate'), enemy = fleet(state, 'veyr', 'frigate');
  const target = system(state, 's20'); target.knownBy.push('player'); target.exploredBy.push('player'); target.owner = 'veyr'; target.population = 4;
  war(state, 'player', 'veyr'); enemy.systemId = target.id;
  const beforeFleets = structuredClone(getVisibleFleets(state, 'player'));
  const beforeEstimate = estimateCombat(state, own.id, target.id);
  assert.deepEqual(beforeEstimate, { attack: 12, defense: null, garrison: null, odds: 'Unscouted', unknown: true });
  enemy.systemId = 's21'; enemy.ships = 8; enemy.hp = 272;
  target.population = 8; target.buildings.push('bastion');
  assert.deepEqual(getVisibleFleets(state, 'player'), beforeFleets);
  assert.deepEqual(estimateCombat(state, own.id, target.id), beforeEstimate, 'hidden fleet movement and colony upgrades remain unknown');
  own.systemId = target.id; enemy.systemId = target.id;
  const observed = estimateCombat(state, own.id, target.id);
  assert.equal(observed.unknown, false);
  assert.equal(observed.defense, 96);
  assert.equal(observed.garrison, 66);
});

test('a hidden civilian interception spends exactly one order and move and leaves only a fixed report', () => {
  for (const type of ['scout', 'colony']) {
    const { state, civilian, target, enemy } = interceptionFixture(type);
    const origin = civilian.systemId, orders = faction(state).orders, moves = civilian.movesLeft;
    const beforeMap = state.systems.map(s => ({ id: s.id, known: [...s.knownBy], explored: [...s.exploredBy] }));
    const beforeStocks = { credits: faction(state).credits, minerals: faction(state).minerals, science: faction(state).science };
    const result = command(state, { type: 'move', fleetId: civilian.id, targetId: target.id });
    assert.equal(result.ok, true); assert.equal(result.outcome, 'intercepted');
    assert.equal(civilian.systemId, origin);
    assert.equal(faction(state).orders, orders - 1);
    assert.equal(civilian.movesLeft, moves - 1);
    assert.equal(hasSensors(state, 'player', target.id), false);
    assert.equal(getVisibleFleets(state, 'player', target.id).length, 0);
    assert.deepEqual(state.systems.map(s => ({ id: s.id, known: [...s.knownBy], explored: [...s.exploredBy] })), beforeMap);
    assert.deepEqual({ credits: faction(state).credits, minerals: faction(state).minerals, science: faction(state).science }, beforeStocks);
    assert.ok(faction(state).contacts.includes('veyr'));
    const report = state.log.find(entry => entry.type === 'interception');
    assert.ok(report.text.includes('2 hostile ships'));
    const reportText = report.text;
    enemy.systemId = 's21'; enemy.ships = 1; enemy.hp = 34;
    assert.equal(report.text, reportText, 'historical report does not track later hidden state');
    assert.equal(estimateCombat(state, civilian.id, target.id).unknown, true);
  }
});

test('a known blockade rejects civilian movement without spending or mutating state', () => {
  const { state, civilian, target } = interceptionFixture();
  fleet(state, 'player', 'frigate').systemId = target.id;
  assert.equal(hasSensors(state, 'player', target.id), true);
  const before = structuredClone(state);
  const result = command(state, { type: 'move', fleetId: civilian.id, targetId: target.id });
  assert.equal(result.ok, false);
  assert.match(result.message, /Civilian vessels/);
  assert.deepEqual(state, before);
});

test('unsurveyed empty systems still admit civilians and warships can enter hidden opposition', () => {
  const { state, civilian, target, enemy } = interceptionFixture();
  enemy.systemId = 's21';
  assert.ok(command(state, { type: 'move', fleetId: civilian.id, targetId: target.id }).ok);
  assert.equal(civilian.systemId, target.id);
  assert.ok(target.exploredBy.includes('player'));
  const battle = interceptionFixture();
  const own = fleet(battle.state, 'player', 'frigate'); own.ships = 5; own.hp = 170;
  const result = command(battle.state, { type: 'move', fleetId: own.id, targetId: battle.target.id });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, undefined);
  assert.equal(own.systemId, battle.target.id);
  assert.ok(battle.target.exploredBy.includes('player'));
  assert.ok(battle.state.log.some(entry => entry.type === 'combat'));
});

function isolatedAI() {
  const state = createGame('sensor-ai');
  const khar = faction(state, 'khar');
  state.lanes = [['s2', 's4'], ['s4', 's5']];
  for (const s of state.systems) s.knownBy = s.knownBy.filter(id => id !== 'khar');
  for (const id of ['s2', 's4', 's5']) system(state, id).knownBy.push('khar');
  state.fleets = state.fleets.filter(f => f.owner !== 'khar' || f.type === 'frigate');
  khar.credits = 0; khar.minerals = 0;
  war(state, 'player', 'khar');
  return state;
}

test('AI does not target a hidden hostile fleet merely because the system is charted', () => {
  const a = isolatedAI(), b = structuredClone(a);
  fleet(a, 'player', 'frigate').systemId = 's4';
  fleet(b, 'player', 'frigate').systemId = 's5';
  const knownA = getVisibleFleets(a, 'khar').map(f => f.id);
  assert.deepEqual(getVisibleFleets(b, 'khar').map(f => f.id), knownA);
  endTurn(a); endTurn(b);
  const kharA = a.fleets.filter(f => f.owner === 'khar');
  const kharB = b.fleets.filter(f => f.owner === 'khar');
  assert.deepEqual(kharA, kharB, 'moving an unseen opponent does not alter AI movement');
  assert.equal(kharA[0].systemId, 's2', 'the AI does not pursue the hidden neutral-system fleet');
});

test('AI scouts discover hidden blockades by spending an expedition, not by reading remote fleets', () => {
  const state = isolatedAI(), khar = faction(state, 'khar');
  const scout = fleet(state, 'khar', 'frigate'); scout.type = 'scout'; scout.hp = 18; scout.movesLeft = 2;
  const enemy = fleet(state, 'player', 'frigate'); enemy.systemId = 's4';
  assert.equal(hasSensors(state, 'khar', 's4'), false);
  const oldContacts = [...khar.contacts];
  endTurn(state);
  assert.equal(scout.systemId, 's2');
  assert.equal(system(state, 's4').exploredBy.includes('khar'), false);
  assert.ok(!oldContacts.includes('player') && khar.contacts.includes('player'), 'the attempted expedition made contact');
  assert.equal(hasSensors(state, 'khar', 's4'), false);
});

test('bankruptcy decommissions exactly one ship regardless of shield technology', () => {
  for (const shields of [false, true]) {
    const state = createGame('bankrupt-shields');
    const player = faction(state);
    player.credits = 0;
    if (shields) player.techs.push('shields');
    const home = system(state, 's0'); home.population = 1;
    const costly = fleet(state, 'player', 'frigate');
    costly.type = 'cruiser'; costly.ships = 3; costly.hp = 255;
    assert.ok(getEmpireStats(state).creditIncome < 0);
    endTurn(state);
    assert.equal(costly.ships, 2);
    assert.equal(costly.hp, 170);
    assert.ok(validateSave(state));
    assert.ok(state.log.some(entry => entry.type === 'warning' && entry.text.includes('one ship was decommissioned')));
  }
  const lone = createGame('last-ship');
  faction(lone).credits = 0; faction(lone).techs.push('shields');
  system(lone, 's0').owner = null; system(lone, 's0').population = 0;
  const cruiser = fleet(lone, 'player', 'frigate'); cruiser.type = 'cruiser'; cruiser.hp = 85;
  endTurn(lone);
  assert.ok(!lone.fleets.some(f => f.id === cruiser.id), 'a last shielded hull is actually removed');
});

test('optional AI strategy metadata validates references and remains compatible with older saves', () => {
  const state = createGame();
  assert.ok(validateSave(state));
  const ai = faction(state, 'khar');
  ai.strategy = { mode: 'assemble', rallyId: 's2', objectiveId: null, turn: state.turn };
  assert.ok(validateSave(state));
  for (const strategy of [null, { ...ai.strategy, mode: 'teleport' }, { ...ai.strategy, rallyId: 'missing' }, { ...ai.strategy, objectiveId: {} }, { ...ai.strategy, turn: state.turn + 1 }]) {
    const corrupt = structuredClone(state); faction(corrupt, 'khar').strategy = strategy;
    assert.equal(validateSave(corrupt), false);
  }
});
