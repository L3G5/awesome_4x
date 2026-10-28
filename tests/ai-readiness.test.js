import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getBuildOptions, getEmpireStats, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { BUILDINGS, SHIPS } from '../src/content.js';
import { getVisibleFleets, hasSensors } from '../src/intelligence.js';

const empire = state => state.factions.find(faction => faction.id === 'veyr');
const world = (state, id) => state.systems.find(system => system.id === id);
const colonies = state => state.systems.filter(system => system.owner === 'veyr');

function fixture(count = 6) {
  const state = createGame('WARTIME-READINESS'), faction = empire(state);
  state.turn = 55; state.lanes = [];
  state.fleets = state.fleets.filter(fleet => fleet.owner !== faction.id);
  for (const system of state.systems) {
    system.anomaly = null;
    system.knownBy = system.knownBy.filter(id => id !== faction.id);
    system.exploredBy = system.exploredBy.filter(id => id !== faction.id);
  }
  for (const id of ['s1', 's4', 's5', 's6', 's7', 's8'].slice(0, count)) {
    const system = world(state, id);
    Object.assign(system, { owner: faction.id, population: 8, habitability: 90, richness: 3, science: 2, buildings: ['mine', 'shipyard', 'market'], queue: null, charter: null });
    system.knownBy.push(faction.id); system.exploredBy.push(faction.id);
  }
  Object.assign(faction, { credits: 179, minerals: 179, orders: 18, contacts: ['khar'], techs: ['logistics', 'physics', 'industry', 'computing', 'weapons', 'singularity'], research: null });
  faction.relations.khar.status = 'war'; faction.relations.khar.trust = -80; faction.relations.khar.treatyTurn = state.turn;
  state.factions.find(other => other.id === 'khar').relations.veyr.status = 'war';
  return state;
}

function queue(system, itemId, kind = 'ship') {
  const item = (kind === 'ship' ? SHIPS : BUILDINGS)[itemId];
  system.queue = { itemId, kind, progress: 0, work: item.work, cost: { ...item.cost } };
}

function ship(state, type = 'frigate', ships = 1, systemId = 's1', owner = 'veyr') {
  const fleet = { id: `f${state.nextFleetId++}`, owner, type, ships, systemId, hp: SHIPS[type].hp * ships, movesLeft: 0, name: 'Readiness force' };
  state.fleets.push(fleet);
  return fleet;
}

const queuedMilitary = state => colonies(state).filter(system => system.queue?.kind === 'ship' && SHIPS[system.queue.itemId].attack > 3);

test('a fleetless empire at known war rebuilds before its third-beacon savings despite losing all frontier sensors', () => {
  const state = fixture(), faction = empire(state);
  for (const system of colonies(state).filter(system => system.id !== 's1')) system.buildings = ['mine', 'lab', 'market'];
  queue(world(state, 's4'), 'beacon', 'building'); queue(world(state, 's5'), 'beacon', 'building');
  faction.credits = 5452;
  const before = { credits: faction.credits, minerals: faction.minerals, orders: faction.orders };
  assert.equal(getVisibleFleets(state, faction.id).length, 0);
  assert.equal(getBuildOptions(state, 's1', faction.id).find(option => option.id === 'frigate').enabled, true);
  runAI(state, faction);
  assert.equal(world(state, 's1').queue?.itemId, 'frigate');
  assert.equal(world(state, 's1').queue.progress, 0);
  assert.equal(faction.credits, before.credits - 25);
  assert.equal(faction.minerals, before.minerals - 35);
  assert.equal(faction.orders, before.orders - 1);
  assert.equal(world(state, 's4').queue.itemId, 'beacon');
  assert.equal(world(state, 's5').queue.itemId, 'beacon');
  assert.equal(validateSave(state), true);
});

test('peaceful empires retain beacon reserves and do not use the wartime exception', () => {
  const state = fixture(), faction = empire(state);
  faction.relations.khar.status = 'peace'; faction.contacts = [];
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 0);
  assert.equal(faction.credits, 179); assert.equal(faction.minerals, 179);
});

test('a retained war relation with a fallen opponent does not consume beacon savings on readiness', () => {
  const state = fixture(), faction = empire(state), fallen = state.factions.find(other => other.id === 'khar');
  fallen.eliminated = true;
  state.fleets = state.fleets.filter(fleet => fleet.owner !== fallen.id);
  for (const system of state.systems.filter(system => system.owner === fallen.id)) system.owner = null;
  assert.equal(faction.relations.khar.status, 'war', 'collapse can leave the old diplomatic relation in the save');
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 0);
  assert.equal(faction.credits, 179); assert.equal(faction.minerals, 179);
  assert.equal(validateSave(state), true);
});

test('readiness commissions at most two affordable hulls per AI turn even with six idle yards', () => {
  const state = fixture(), faction = empire(state);
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 2);
  assert.equal(faction.credits, 129); assert.equal(faction.minerals, 109);
  assert.equal(colonies(state).filter(system => !system.queue).length, 4);
});

test('queued military and existing cruisers count toward the bounded minimum', () => {
  for (const force of ['queued', 'cruisers']) {
    const state = fixture(), faction = empire(state);
    if (force === 'queued') for (const system of colonies(state).slice(1)) queue(system, 'frigate');
    else ship(state, 'cruiser', 2);
    runAI(state, faction);
    assert.equal(world(state, 's1').queue, null);
    assert.equal(faction.credits, 179); assert.equal(faction.minerals, 179);
    assert.equal(queuedMilitary(state).length, force === 'queued' ? 5 : 0);
  }
});

test('the last minimum hull restores normal beacon reserves instead of creating an endless military exception', () => {
  const state = fixture(), faction = empire(state);
  ship(state, 'frigate', 4);
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 1);
  faction.orders = 18;
  const credits = faction.credits, minerals = faction.minerals;
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 1);
  assert.equal(faction.credits, credits); assert.equal(faction.minerals, minerals);
});

test('once minimum readiness exists a normally funded beacon takes priority over additional hulls', () => {
  const state = fixture(), faction = empire(state);
  ship(state, 'frigate', 5);
  faction.credits = 180; faction.minerals = 180;
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 0);
  assert.equal(colonies(state).filter(system => system.queue?.itemId === 'beacon').length, 1);
  assert.equal(faction.credits, 0); assert.equal(faction.minerals, 0);
});

test('an affordable rear yard is preferred over a more productive known wartime border yard', () => {
  const state = fixture(), faction = empire(state);
  for (const system of colonies(state).filter(system => !['s1', 's4'].includes(system.id))) system.buildings = ['mine', 'lab', 'market'];
  world(state, 's4').population = 12; world(state, 's4').buildings.push('factory');
  world(state, 's2').knownBy.push(faction.id);
  state.lanes = [['s4', 's2']];
  faction.credits = 25; faction.minerals = 35;
  runAI(state, faction);
  assert.equal(world(state, 's1').queue?.itemId, 'frigate');
  assert.equal(world(state, 's4').queue, null);
});

test('readiness preserves the next alignment payment at the exact normal ship-price boundary', () => {
  for (const credits of [84, 85]) {
    const state = fixture(3), faction = empire(state);
    for (const system of colonies(state)) system.buildings.push('beacon');
    ship(state, 'scout');
    faction.alignment = { active: true, progress: 3, sites: ['s1', 's4', 's5'], started: true, reportedBeacons: ['s1', 's4', 's5'] };
    faction.credits = credits;
    runAI(state, faction);
    assert.equal(queuedMilitary(state).length, credits === 85 ? 1 : 0);
    assert.ok(faction.credits >= 60);
    if (credits === 85) assert.equal(faction.credits, 60);
  }
});

test('future upkeep of queued civilian ships cannot make a readiness hull break sustainable alignment', () => {
  const state = fixture(3), faction = empire(state);
  for (const system of colonies(state)) {
    system.population = 7; system.buildings = ['mine', 'shipyard', 'beacon'];
  }
  ship(state, 'scout');
  queue(world(state, 's4'), 'colony'); queue(world(state, 's5'), 'colony');
  faction.alignment = { active: true, progress: 3, sites: ['s1', 's4', 's5'], started: true, reportedBeacons: ['s1', 's4', 's5'] };
  assert.equal(getEmpireStats(state, faction.id).creditIncome, 62);
  runAI(state, faction);
  assert.equal(queuedMilitary(state).length, 0);
});

test('loss of every shipyard permits one paid replacement yard without dismantling charter support', () => {
  const state = fixture(), faction = empire(state);
  for (const system of colonies(state)) {
    system.buildings = ['mine', 'market', 'lab', 'habitat'];
    system.charter = { type: 'academy', level: 1 };
  }
  runAI(state, faction);
  const yards = colonies(state).filter(system => system.queue?.itemId === 'shipyard');
  assert.equal(yards.length, 1);
  assert.equal(yards[0].queue.replaceBuildingId, 'habitat');
  assert.ok(yards[0].buildings.includes('lab'));
  assert.equal(yards[0].charter.type, 'academy');
  assert.deepEqual(yards[0].queue.cost, BUILDINGS.shipyard.cost);
  faction.orders = 18;
  runAI(state, faction);
  assert.equal(colonies(state).filter(system => system.queue?.itemId === 'shipyard').length, 1);
});

test('unseen hostile fleet size and movement do not change rebuilding decisions', () => {
  const original = fixture(), faction = empire(original);
  world(original, 's20').knownBy.push(faction.id); world(original, 's21').knownBy.push(faction.id);
  const hidden = ship(original, 'frigate', 1, 's20', 'khar');
  const changed = structuredClone(original), other = changed.fleets.find(fleet => fleet.id === hidden.id);
  other.type = 'cruiser'; other.ships = 12; other.hp = SHIPS.cruiser.hp * 12; other.systemId = 's21';
  assert.equal(hasSensors(original, faction.id, 's20'), false);
  assert.deepEqual(getVisibleFleets(original, faction.id), getVisibleFleets(changed, faction.id));
  runAI(original, faction); runAI(changed, empire(changed));
  assert.deepEqual(empire(changed), faction);
  assert.deepEqual(colonies(changed), colonies(original));
  assert.equal(changed.rng, original.rng);
});
