import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { SHIPS } from '../src/content.js';

const empire = (state, id = 'khar') => state.factions.find(faction => faction.id === id);
const world = (state, id) => state.systems.find(system => system.id === id);
const ship = (state, id) => state.fleets.find(fleet => fleet.id === id);

function addFleet(state, owner, systemId, ships = 4, type = 'frigate', movesLeft = 2) {
  const fleet = { id: `f${state.nextFleetId++}`, owner, systemId, type, ships, name: 'Expedition test fleet', hp: SHIPS[type].hp * ships, movesLeft };
  state.fleets.push(fleet);
  return fleet;
}

function fixture({ hops = 4, progress = 8, commandTech = true, transitColonies = false, leader = 'player' } = {}) {
  const state = createGame('BEACON-EXPEDITION');
  state.turn = 60; state.fleets = [];
  for (const faction of state.factions) {
    Object.assign(faction, { credits: 0, minerals: 0, science: 0, orders: 18, contacts: [], eliminated: !['player', 'khar'].includes(faction.id) });
    for (const relation of Object.values(faction.relations)) Object.assign(relation, { status: 'peace', trade: false, trust: 0, treatyTurn: 0 });
  }
  for (const system of state.systems) Object.assign(system, { owner: null, population: 0, buildings: [], charter: null, queue: null, anomaly: null, knownBy: [], exploredBy: [] });
  const colony = (id, owner, buildings = []) => Object.assign(world(state, id), { owner, population: 6, buildings, knownBy: ['player', 'khar', leader], exploredBy: [owner] });
  colony('s2', 'khar', ['mine']); colony('s0', 'player');
  for (const id of ['s5', 's6', 's7']) colony(id, leader, ['beacon']);
  const between = ['s4', 's8', 's9', 's10', 's11', 's12', 's13'].slice(0, hops - 1);
  const path = ['s2', ...between, 's5'];
  state.lanes = path.slice(1).map((id, index) => [path[index], id]);
  state.lanes.push(['s5', 's6'], ['s6', 's7']);
  for (const id of path) world(state, id).knownBy = [...new Set(['khar', 'player', leader])];
  if (transitColonies) for (const id of between) colony(id, leader);
  const faction = empire(state), rival = empire(state, leader);
  rival.eliminated = false;
  faction.contacts = [leader]; rival.contacts = ['khar'];
  for (const [first, second] of [[faction, rival], [rival, faction]]) Object.assign(first.relations[second.id], { trade: true, trust: 90 });
  rival.techs = ['logistics', 'physics', 'industry', 'computing', 'singularity']; rival.credits = 10000;
  rival.alignment = { active: true, progress, started: true, sites: ['s5', 's6', 's7'], reportedBeacons: ['s5', 's6', 's7'] };
  if (commandTech) faction.techs = ['logistics', 'diplomacy', 'command'];
  const fleet = addFleet(state, faction.id, 's2', 4, 'frigate', commandTech ? 2 : 1);
  assert.equal(validateSave(state), true);
  return { state, faction, rival, fleet, path };
}

test('Command permits four charted hops in two cycles at normal order and movement costs', () => {
  const { state, faction, fleet } = fixture();
  runAI(state, faction);
  assert.equal(faction.relations.player.status, 'war');
  assert.equal(fleet.systemId, 's8');
  assert.equal(fleet.movesLeft, 0);
  assert.equal(faction.orders, 15, 'one declaration and two ordinary moves');
  assert.deepEqual(faction.strategy.expedition, { fleetId: fleet.id, targetId: 'player', systemId: 's5' });
  assert.equal(validateSave(state), true);

  const ordinary = fixture({ commandTech: false });
  runAI(ordinary.state, ordinary.faction);
  assert.equal(ordinary.faction.relations.player.status, 'peace', 'a one-move fleet still cannot meet the deadline');
  assert.equal(ordinary.fleet.systemId, 's2');
});

test('ETA uses remaining movement and reserves the declaration order', () => {
  for (const shortage of ['movement', 'orders']) {
    const { state, faction, fleet } = fixture();
    if (shortage === 'movement') fleet.movesLeft = 1;
    else faction.orders = 2;
    runAI(state, faction);
    assert.equal(faction.relations.player.status, 'peace', shortage);
    assert.equal(faction.strategy.expedition, undefined);
  }
  const { state, faction, fleet } = fixture({ hops: 3 });
  fleet.movesLeft = 1;
  runAI(state, faction);
  assert.equal(faction.relations.player.status, 'war');
  assert.equal(fleet.systemId, 's4');
  assert.equal(fleet.movesLeft, 0);
  assert.equal(faction.orders, 16);
});

test('the selected expedition crosses hostile transit colonies and holds its beacon without invading', () => {
  const { state, faction, rival, fleet } = fixture({ transitColonies: true });
  endTurn(state);
  assert.equal(fleet.systemId, 's8');
  assert.equal(rival.alignment.progress, 9);
  endTurn(state);
  assert.equal(fleet.systemId, 's5');
  assert.equal(state.winner, null);
  assert.equal(rival.alignment.progress, 8, 'arrival interrupts the otherwise winning cycle');
  assert.equal(faction.strategy.expedition.fleetId, fleet.id);
  assert.equal(fleet.hp, 4 * SHIPS.frigate.hp);
  for (const id of ['s4', 's8', 's9', 's5']) {
    assert.equal(world(state, id).owner, 'player');
    assert.equal(world(state, id).defenseDamage, 0);
  }
  endTurn(state);
  assert.equal(rival.alignment.progress, 7);
  assert.equal(world(state, 's5').owner, 'player');
  assert.equal(fleet.hp, 4 * SHIPS.frigate.hp);
});

test('a selected feasible expedition persists when another fleet later becomes closer', () => {
  const { state, faction, fleet } = fixture({ hops: 5, progress: 5, transitColonies: true });
  endTurn(state);
  assert.equal(fleet.systemId, 's8');
  const latecomer = addFleet(state, 'khar', 's10', 4);
  endTurn(state);
  assert.equal(faction.strategy.expedition.fleetId, fleet.id);
  assert.equal(fleet.systemId, 's10');
  assert.equal(world(state, 's8').owner, 'player', 'the committed fleet did not revert to invading its transit colony');
  assert.notEqual(faction.strategy.expedition.fleetId, latecomer.id);
});

test('merging cannot consume the selected expedition or reduce its current movement', () => {
  const { state, faction, fleet } = fixture();
  const resting = addFleet(state, 'khar', 's2', 1, 'frigate', 0);
  runAI(state, faction);
  assert.equal(fleet.systemId, 's8');
  assert.equal(fleet.ships, 4);
  assert.equal(ship(state, resting.id).systemId, 's2');
  assert.equal(faction.strategy.expedition.fleetId, fleet.id);
});

test('hidden fleet changes cannot alter departure, chosen target or the clear observed prefix', () => {
  const original = fixture({ hops: 5, progress: 5 });
  addFleet(original.state, 'player', 's5', 1, 'frigate', 0);
  const changed = structuredClone(original.state);
  const hidden = changed.fleets.find(fleet => fleet.owner === 'player');
  Object.assign(hidden, { ships: 12, hp: SHIPS.cruiser.hp * 12, type: 'cruiser' });
  runAI(original.state, original.faction); runAI(changed, empire(changed));
  assert.deepEqual(empire(changed), original.faction);
  assert.deepEqual(changed.fleets.filter(fleet => fleet.owner === 'khar'), original.state.fleets.filter(fleet => fleet.owner === 'khar'));
  assert.equal(original.fleet.systemId, 's8');
});

test('a newly encountered battle stops further expedition movement that cycle', () => {
  const { state, faction, fleet } = fixture();
  addFleet(state, 'player', 's4', 1, 'frigate', 0);
  runAI(state, faction);
  assert.equal(fleet.systemId, 's4');
  assert.equal(fleet.movesLeft, 1);
  assert.ok(fleet.hp < 4 * SHIPS.frigate.hp);
  assert.ok(state.combatReports.length > 0);
  assert.equal(faction.orders, 16);
  assert.equal(validateSave(state), true);
});

test('an expedition destroyed on contact cannot continue or retain a live mission', () => {
  const { state, faction, fleet } = fixture();
  addFleet(state, 'player', 's4', 12, 'cruiser', 0);
  runAI(state, faction);
  assert.equal(ship(state, fleet.id), undefined);
  assert.equal(faction.strategy.expedition, undefined);
  assert.equal(world(state, 's8').exploredBy.includes('khar'), false);
  assert.equal(validateSave(state), true);
});

test('known overwhelming guards, closed borders and truces remain binding', () => {
  for (const obstacle of ['guard', 'border', 'truce']) {
    const { state, faction, fleet } = fixture();
    if (obstacle === 'guard') {
      addFleet(state, 'khar', 's5', 1, 'scout', 0);
      addFleet(state, 'player', 's5', 12, 'cruiser', 0);
    } else if (obstacle === 'border') Object.assign(world(state, 's8'), { owner: 'veyr', population: 6 });
    else faction.relations.player.truceUntil = state.turn + 3;
    runAI(state, faction);
    assert.equal(faction.relations.player.status, 'peace', obstacle);
    assert.equal(fleet.systemId, 's2', obstacle);
    assert.equal(faction.strategy.expedition, undefined, obstacle);
  }
});

test('a stale mission is reconsidered when access or the existing race threshold changes', () => {
  for (const change of ['closed border', 'progress']) {
    const { state, faction, rival } = fixture({ hops: 5, progress: 5 });
    endTurn(state);
    assert.ok(faction.strategy.expedition);
    if (change === 'closed border') Object.assign(world(state, 's9'), { owner: 'veyr', population: 6 });
    else { rival.alignment.progress = 2; rival.alignment.active = false; }
    assert.equal(validateSave(state), true);
    runAI(state, faction);
    assert.equal(faction.strategy.expedition, undefined, change);
  }
});

test('player destruction of an assigned fleet leaves an immediately valid reloadable save', () => {
  const { state, faction, fleet } = fixture();
  const defender = addFleet(state, 'player', 's12', 10, 'cruiser', 1);
  state.lanes.push(['s12', 's8']); world(state, 's12').knownBy.push('player');
  endTurn(state);
  assert.equal(fleet.systemId, 's8');
  assert.equal(command(state, { type: 'move', fleetId: defender.id, targetId: 's8' }).ok, true);
  assert.equal(ship(state, fleet.id), undefined);
  assert.equal(faction.strategy.expedition.fleetId, fleet.id);
  assert.equal(validateSave(state), true);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(reloaded), true);
  endTurn(reloaded);
  assert.equal(empire(reloaded).strategy.expedition, undefined);
  assert.equal(validateSave(reloaded), true);
});

test('player capture of an expedition target remains valid before the next AI replan', () => {
  const { state, faction, fleet } = fixture({ leader: 'veyr' });
  const player = empire(state, 'player');
  player.contacts.push('veyr'); empire(state, 'veyr').contacts.push('player');
  for (const [first, second] of [['player', 'veyr'], ['veyr', 'player']]) Object.assign(empire(state, first).relations[second], { status: 'war', treatyTurn: 60 });
  const invader = addFleet(state, 'player', 's5', 10, 'cruiser', 1);
  runAI(state, faction);
  assert.equal(fleet.systemId, 's8');
  assert.equal(command(state, { type: 'attack', fleetId: invader.id }).ok, true);
  assert.equal(world(state, 's5').owner, 'player');
  assert.equal(faction.strategy.expedition.systemId, 's5');
  assert.equal(validateSave(state), true);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(reloaded), true);
  endTurn(reloaded);
  assert.notEqual(empire(reloaded).strategy.expedition?.systemId, 's5');
  assert.equal(validateSave(reloaded), true);
});

test('a serialized expedition produces exactly the same next full cycle', () => {
  const { state } = fixture({ hops: 5, progress: 5, transitColonies: true });
  endTurn(state);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(reloaded), true);
  endTurn(state); endTurn(reloaded);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), reloaded);
  assert.equal(validateSave(reloaded), true);
});

test('optional expedition metadata rejects malformed or foreign fleet assignments', () => {
  const { state, faction } = fixture();
  endTurn(state);
  assert.equal(validateSave(state), true);
  const foreign = addFleet(state, 'player', 's0', 1, 'scout', 0);
  const cases = [null, [], {}, { ...faction.strategy.expedition, fleetId: foreign.id }, { ...faction.strategy.expedition, fleetId: 'f-1' }, { ...faction.strategy.expedition, fleetId: 'f999999' }, { ...faction.strategy.expedition, targetId: faction.id }, { ...faction.strategy.expedition, systemId: 's41' }, { ...faction.strategy.expedition, secret: 1 }];
  for (const value of cases) {
    const copy = structuredClone(state); empire(copy).strategy.expedition = value;
    assert.equal(validateSave(copy), false, JSON.stringify(value));
  }
  delete faction.strategy.expedition;
  assert.equal(validateSave(state), true, 'old saves without metadata remain valid');
});
