import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, endTurn, getEmpireStats, getInfrastructure, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { SHIPS } from '../src/content.js';
import { hasSensors, getVisibleFleets } from '../src/intelligence.js';

const empire = state => state.factions.find(faction => faction.id === 'khar');
const system = (state, id) => state.systems.find(location => location.id === id);

function developmentFixture() {
  const state = createGame('DEVELOPMENT-AUDIT');
  state.turn = 20;
  state.lanes = [['s2', 's4'], ['s4', 's5'], ['s5', 's6'], ['s6', 's7']];
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'khar');
  const faction = empire(state);
  faction.credits = 0; faction.minerals = 0; faction.science = 0; faction.orders = 18;
  faction.contacts = [];
  for (const location of state.systems) {
    location.anomaly = null;
    location.knownBy = location.knownBy.filter(id => id !== faction.id);
    location.exploredBy = location.exploredBy.filter(id => id !== faction.id);
  }
  colony(state, 's2');
  return state;
}

function colony(state, id, values = {}) {
  const location = system(state, id);
  Object.assign(location, { owner: 'khar', population: 6, habitability: 90, richness: 4, science: 3, buildings: [], queue: null, charter: null }, values);
  if (!location.knownBy.includes('khar')) location.knownBy.push('khar');
  if (!location.exploredBy.includes('khar')) location.exploredBy.push('khar');
  return location;
}

function ship(state, owner, systemId, ships = 1, type = 'frigate') {
  const fleet = { id: `f${state.nextFleetId++}`, name: `${owner} task force`, owner, systemId, type, ships, hp: SHIPS[type].hp * ships, movesLeft: 0 };
  state.fleets.push(fleet);
  return fleet;
}

function networkResearch(faction) {
  faction.techs = ['logistics', 'industry', 'physics', 'computing', 'singularity'];
}

test('three-beacon funding survives tempting ordinary projects and counts queued sites', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction);
  colony(state, 's2', { buildings: ['mine', 'shipyard', 'factory', 'market'] });
  colony(state, 's4', { buildings: ['mine', 'lab', 'market', 'habitat'] });
  colony(state, 's5', { buildings: ['mine', 'lab', 'market', 'habitat'] });
  faction.credits = 179; faction.minerals = 179;
  runAI(state, faction);
  assert.equal(faction.credits, 179);
  assert.equal(faction.minerals, 179);
  assert.ok(state.systems.filter(location => location.owner === 'khar').every(location => !location.queue), 'cheap ships and infrastructure do not consume the reserved partial budget');

  faction.orders = 18; faction.credits = 360; faction.minerals = 360;
  runAI(state, faction);
  const queued = state.systems.filter(location => location.owner === 'khar' && location.queue?.itemId === 'beacon');
  assert.equal(queued.length, 2);
  assert.equal(faction.credits, 0); assert.equal(faction.minerals, 0);
  assert.equal(system(state, 's2').queue.itemId, 'beacon', 'the productive defended capital is selected first');
  assert.ok(queued.every(location => location.queue.replaceBuildingId && location.queue.replaceBuildingId !== 'beacon'));

  faction.orders = 18; faction.credits = 180; faction.minerals = 180;
  runAI(state, faction);
  assert.equal(state.systems.filter(location => location.owner === 'khar' && location.queue?.itemId === 'beacon').length, 3);
  assert.equal(faction.credits, 0); assert.equal(faction.minerals, 0);
  assert.ok(validateSave(state));
});

test('a fourth beacon is not commissioned when three are already queued or complete', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction);
  colony(state, 's2', { buildings: ['beacon', 'mine'] });
  colony(state, 's4', { buildings: ['beacon', 'lab'] });
  colony(state, 's5', { queue: { kind: 'building', itemId: 'beacon', progress: 1, work: 140, cost: { credits: 180, minerals: 180 } } });
  colony(state, 's6');
  faction.credits = 800; faction.minerals = 800;
  runAI(state, faction);
  assert.notEqual(system(state, 's6').queue?.itemId, 'beacon');
  assert.equal(state.systems.filter(location => location.owner === 'khar' && (location.buildings.includes('beacon') || location.queue?.itemId === 'beacon')).length, 3);
});

test('an observed emergency can use beacon savings at normal defense costs', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction); faction.techs.push('shields');
  faction.credits = 100; faction.minerals = 100;
  faction.relations.player.status = 'war'; faction.relations.player.treatyTurn = state.turn;
  ship(state, 'player', 's2', 8);
  runAI(state, faction);
  assert.equal(system(state, 's2').queue?.itemId, 'bastion');
  assert.equal(faction.credits, 55); assert.equal(faction.minerals, 40);
  assert.equal(system(state, 's2').buildings.includes('bastion'), false, 'defense still requires ordinary construction time');
});

test('native resources and staging give developed colonies different charters', () => {
  const state = developmentFixture(), faction = empire(state);
  faction.techs = ['logistics', 'industry', 'ecology', 'diplomacy'];
  faction.credits = 1800; faction.minerals = 1000;
  colony(state, 's2', { buildings: ['factory', 'shipyard', 'mine'], population: 9 });
  colony(state, 's4', { buildings: ['mine'], richness: 5, science: 1 });
  colony(state, 's5', { buildings: ['lab'], richness: 1, science: 4 });
  colony(state, 's6', { buildings: ['forum'], population: 9, richness: 2, science: 2 });
  ship(state, 'khar', 's2', 10, 'cruiser');
  ship(state, 'khar', 's2', 1, 'scout');
  runAI(state, faction);
  const assigned = ['s2', 's4', 's5', 's6'].map(id => system(state, id).queue);
  assert.deepEqual(assigned.map(queue => queue?.kind), ['charter', 'charter', 'charter', 'charter']);
  assert.deepEqual(assigned.map(queue => queue.charterType), ['forge', 'extraction', 'academy', 'civic']);
  assert.equal(faction.credits, 1320); assert.equal(faction.minerals, 760);
  assert.ok(validateSave(state));
});

test('replacement creates beacon space without dismantling a charter or the last shipyard', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction);
  const home = colony(state, 's2', { buildings: ['factory', 'shipyard', 'mine', 'habitat'], charter: { type: 'forge', level: 1 } });
  colony(state, 's4', { buildings: ['beacon', 'mine'] });
  colony(state, 's5', { buildings: ['beacon', 'lab'] });
  faction.credits = 180; faction.minerals = 180;
  assert.equal(getInfrastructure(state, home).available, 0);
  runAI(state, faction);
  assert.equal(home.queue?.itemId, 'beacon');
  assert.equal(home.queue.replaceBuildingId, 'habitat');
  assert.deepEqual(home.charter, { type: 'forge', level: 1 });
  assert.ok(home.buildings.includes('factory') && home.buildings.includes('shipyard') && home.buildings.includes('habitat'), 'replacement is deferred until completion');
});

test('an active alignment keeps its next funding payment through ordinary purchases', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction);
  for (const id of ['s2', 's4', 's5']) colony(state, id, { buildings: ['beacon'], population: 9 });
  faction.alignment = { active: true, progress: 4, sites: ['s2', 's4', 's5'], started: true, reportedBeacons: ['s2', 's4', 's5'] };
  faction.credits = 80; faction.minerals = 500;
  runAI(state, faction);
  assert.ok(faction.credits >= 60, 'ordinary construction preserves the next 60-credit payment');
  const paid = state.systems.filter(location => location.owner === 'khar').reduce((total, location) => total + (location.queue?.cost.credits || 0), 0);
  assert.ok(paid <= 20, 'ordinary projects use only funds above the protected payment');
  assert.equal(faction.credits, 80 - paid);
  assert.ok(validateSave(state));
});

test('income recovery escapes automatic alignment charges without grants or dismantling beacons', () => {
  const state = createGame('reserve-trap');
  state.lanes = [];
  const faction = empire(state);
  faction.techs.push('singularity'); faction.credits = 60; faction.minerals = 1000;
  for (const id of ['s2', 's4', 's5']) colony(state, id, { population: 5, habitability: 0, buildings: ['mine', 'shipyard', 'beacon'] });
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'khar');
  ship(state, 'khar', 's2', 8);
  ship(state, 'khar', 's2', 1, 'scout');
  faction.alignment = { active: true, progress: 1, sites: ['s2', 's4', 's5'], started: true, reportedBeacons: ['s2', 's4', 's5'] };
  assert.equal(getEmpireStats(state, 'khar').creditIncome, 22);
  let lowestBalance = faction.credits;
  while (state.turn < 100 && !state.winner && getEmpireStats(state, 'khar').creditIncome < 60) {
    endTurn(state);
    lowestBalance = Math.min(lowestBalance, faction.credits);
    assert.ok(validateSave(state));
    assert.ok(['s2', 's4', 's5'].every(id => system(state, id).buildings.includes('beacon')));
  }
  assert.ok(lowestBalance < 60, 'temporary payment savings are spent on normal revenue projects');
  assert.ok(getEmpireStats(state, 'khar').creditIncome >= 60 || state.winner === 'khar', 'housing, markets and civic support eventually sustain alignment');
  assert.ok(['s2', 's4', 's5'].some(id => system(state, id).buildings.includes('habitat')), 'population capacity is expanded when markets alone cannot meet the bill');
  while (state.turn < 115 && !state.winner) endTurn(state);
  assert.equal(state.winner, 'khar');
  assert.equal(state.victoryType, 'Transcendence');
});

test('hidden foreign fleet changes leave economic choices and paid costs identical', () => {
  const original = developmentFixture(), faction = empire(original);
  faction.techs = ['logistics', 'industry', 'physics', 'shields'];
  faction.credits = 350; faction.minerals = 250;
  colony(original, 's4', { buildings: ['mine'], richness: 5 });
  system(original, 's5').knownBy.push('khar');
  system(original, 's6').knownBy.push('khar');
  ship(original, 'player', 's5', 1);
  const changed = structuredClone(original);
  const foreign = changed.fleets.find(fleet => fleet.owner === 'player');
  foreign.systemId = 's6'; foreign.ships = 12; foreign.hp = SHIPS[foreign.type].hp * 12;
  assert.equal(hasSensors(original, 'khar', 's5'), false);
  assert.deepEqual(getVisibleFleets(original, 'khar'), getVisibleFleets(changed, 'khar'));
  runAI(original, faction); runAI(changed, empire(changed));
  const snapshot = state => ({ faction: empire(state), colonies: state.systems.filter(location => location.owner === 'khar'), fleets: state.fleets.filter(fleet => fleet.owner === 'khar'), rng: state.rng });
  assert.deepEqual(snapshot(original), snapshot(changed));
  assert.ok(getEmpireStats(original, 'khar').creditIncome >= 0);
});

function publicRaceFixture(progress = 8) {
  const state = developmentFixture(), faction = empire(state);
  faction.contacts = ['player'];
  const rival = state.factions.find(candidate => candidate.id === 'player');
  rival.contacts = ['khar'];
  for (const id of ['s5', 's6', 's7']) {
    const location = colony(state, id, { owner: 'player', buildings: ['beacon'] });
    location.exploredBy = location.exploredBy.filter(owner => owner !== 'khar');
  }
  system(state, 's4').knownBy.push('khar');
  rival.alignment = { active: true, progress, sites: ['s5', 's6', 's7'], started: true, reportedBeacons: ['s5', 's6', 's7'] };
  const force = ship(state, 'khar', 's2', 4); force.movesLeft = 1;
  return { state, faction, rival, force };
}

test('an achievable public alignment prompts intervention through charted lanes', () => {
  const { state, faction, force } = publicRaceFixture();
  runAI(state, faction);
  assert.equal(faction.relations.player.status, 'war');
  assert.equal(faction.strategy.objectiveId, 's5');
  assert.equal(force.systemId, 's4');
});

test('public race responses respect travel time, truces and observed overwhelming defenders', () => {
  for (const obstacle of ['too late', 'truce', 'defended']) {
    const { state, faction } = publicRaceFixture(obstacle === 'too late' ? 9 : 8);
    if (obstacle === 'truce') faction.relations.player.truceUntil = state.turn + 3;
    if (obstacle === 'defended') {
      ship(state, 'khar', 's5', 1, 'scout');
      ship(state, 'player', 's5', 12, 'cruiser');
    }
    runAI(state, faction);
    assert.equal(faction.relations.player.status, 'peace', obstacle);
  }
});

test('a public beacon reveals its location without revealing its hidden defensive fleet to the AI', () => {
  const original = publicRaceFixture().state;
  ship(original, 'player', 's6', 1);
  const changed = structuredClone(original);
  const hidden = changed.fleets.find(fleet => fleet.owner === 'player');
  hidden.systemId = 's5'; hidden.ships = 12; hidden.hp = SHIPS[hidden.type].hp * hidden.ships;
  assert.equal(hasSensors(original, 'khar', 's5'), false);
  runAI(original, empire(original)); runAI(changed, empire(changed));
  assert.deepEqual(empire(original), empire(changed));
  assert.deepEqual(original.fleets.filter(fleet => fleet.owner === 'khar'), changed.fleets.filter(fleet => fleet.owner === 'khar'));
});

test('an aligning empire stations an available force at its participating beacon', () => {
  const state = developmentFixture(), faction = empire(state);
  networkResearch(faction);
  for (const id of ['s4', 's5', 's6']) colony(state, id, { buildings: ['beacon'] });
  faction.alignment = { active: true, progress: 5, sites: ['s4', 's5', 's6'], started: true, reportedBeacons: ['s4', 's5', 's6'] };
  const force = ship(state, 'khar', 's2', 4); force.movesLeft = 1;
  runAI(state, faction);
  assert.equal(force.systemId, 's4', 'force protects a participating site instead of idling at the distant capital');
});
