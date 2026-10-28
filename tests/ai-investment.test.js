import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, getEmpireStats, getBuildOptions, getDevelopmentOptions, validateSave } from '../src/game.js';
import { getInvestmentForecast, runAI } from '../src/ai.js';
import { BUILDINGS, SHIPS, TECHS } from '../src/content.js';

const empire = state => state.factions.find(faction => faction.id === 'khar');
const world = (state, id = 's2') => state.systems.find(system => system.id === id);
const colonyIds = ['s2', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'];

function fixture(count = 1) {
  const state = createGame('MARGINAL-INVESTMENT');
  state.turn = 20; state.lanes = []; state.fleets = [];
  const faction = empire(state);
  Object.assign(faction, { credits: 4000, minerals: 2000, science: 0, orders: 18, contacts: [], research: null, techs: ['logistics', 'ecology', 'industry', 'diplomacy', 'physics', 'computing', 'weapons', 'cruisers'] });
  for (const system of state.systems) {
    system.anomaly = null;
    system.knownBy = system.knownBy.filter(id => id !== faction.id);
    system.exploredBy = system.exploredBy.filter(id => id !== faction.id);
  }
  for (const id of colonyIds.slice(0, count)) Object.assign(world(state, id), { owner: faction.id, population: 12, habitability: 90, richness: 4, science: 4, buildings: ['mine'], charter: null, queue: null, knownBy: [faction.id], exploredBy: [faction.id] });
  for (const [type, ships] of [['cruiser', count + 1], ['scout', 1]]) state.fleets.push({ id: `f${state.nextFleetId++}`, owner: faction.id, systemId: 's2', name: 'Investment fixture', type, ships, hp: SHIPS[type].hp * ships, movesLeft: 0 });
  return state;
}

function forecast(state, id, project, replacement = null) {
  const option = ['academy', 'civic', 'extraction', 'forge'].includes(project)
    ? getDevelopmentOptions(state, id, 'khar').find(option => option.charterType === project)
    : getBuildOptions(state, id, 'khar', replacement).find(option => option.id === project);
  return getInvestmentForecast(state, 'khar', id, option);
}

function academy(state, id = 's2') {
  Object.assign(world(state, id), { buildings: ['mine', 'lab', 'habitat'], charter: { type: 'academy', level: 1 } });
}

function publicRace(state, progress = 8) {
  const rival = state.factions.find(faction => faction.id === 'veyr');
  const sites = ['s1', 's20', 's21'];
  for (const id of sites) Object.assign(world(state, id), { owner: rival.id, population: 9, buildings: ['beacon'] });
  rival.techs = Object.keys(TECHS);
  rival.alignment = { progress, active: true, started: true, sites, reportedBeacons: [...sites] };
  empire(state).contacts.push(rival.id);
}

test('a rich capped empire declines Civic II and surplus Forums without changing player rules', () => {
  const state = fixture(9), faction = empire(state), home = world(state);
  state.turn = 60; faction.techs.push('command');
  Object.assign(home, { buildings: ['mine', 'forum', 'market', 'lab', 'habitat'], charter: { type: 'civic', level: 1 } });
  assert.equal(getEmpireStats(state, faction.id).maxOrders, 18);
  for (const [id, item] of [['s2', 'civic'], ['s4', 'forum']]) {
    const plan = forecast(state, id, item);
    assert.equal(plan.output.orders, 0);
    assert.equal(plan.creditNeed, 0);
    assert.equal(plan.worthwhile, false);
  }
  const playerChoice = structuredClone(state);
  assert.equal(command(playerChoice, { type: 'develop', factionId: faction.id, systemId: home.id, charterType: 'civic' }).ok, true, 'the investment remains legal when explicitly chosen');
  runAI(state, faction);
  assert.notEqual(home.queue?.charterType, 'civic');
  assert.ok(validateSave(state));
});

test('uncapped order gains remain valuable but already-paid Forums can fill the cap first', () => {
  const state = fixture(9), faction = empire(state);
  faction.techs.push('command'); world(state).buildings.push('forum');
  assert.equal(getEmpireStats(state, faction.id).maxOrders, 17);
  assert.equal(forecast(state, 's2', 'civic').worthwhile, true);
  world(state, 's4').queue = { itemId: 'forum', kind: 'building', progress: 39, work: BUILDINGS.forum.work, cost: { ...BUILDINGS.forum.cost } };
  const plan = forecast(state, 's2', 'civic');
  assert.equal(plan.output.orders, 0);
  assert.equal(plan.worthwhile, false);
});

test('replacing a Forum above the cap loses no effective order until the real buffer is exhausted', () => {
  const state = fixture(9); empire(state).techs.push('command');
  for (const id of ['s2', 's4', 's5']) world(state, id).buildings.push('forum');
  assert.equal(getEmpireStats(state, 'khar').uncappedOrders, 19);
  assert.equal(forecast(state, 's2', 'lab', 'forum').output.orders, 0);
  world(state, 's5').buildings = ['mine'];
  assert.ok(forecast(state, 's2', 'lab', 'forum').output.orders < 0);
});

test('commissioned Command research can fill the order cap before a Civic upgrade finishes', () => {
  const state = fixture(9), faction = empire(state);
  for (const id of ['s2', 's4', 's5']) world(state, id).buildings.push('forum');
  assert.equal(getEmpireStats(state, faction.id).maxOrders, 17);
  assert.equal(forecast(state, 's2', 'civic').worthwhile, true);
  faction.research = { techId: 'command', progress: 499 };
  const plan = forecast(state, 's2', 'civic');
  assert.equal(plan.output.orders, 0);
  assert.equal(plan.worthwhile, false);
});

test('late Academy science is rejected when research completes before construction', () => {
  const state = fixture(); academy(state);
  const faction = empire(state);
  faction.techs = Object.keys(TECHS).filter(id => id !== 'terraforming');
  faction.research = { techId: 'terraforming', progress: 550 };
  world(state).buildings.push('beacon');
  const plan = forecast(state, 's2', 'academy');
  assert.equal(plan.remainingResearch, 50);
  assert.equal(plan.output.science, 0);
  assert.equal(plan.worthwhile, false);
  runAI(state, faction);
  assert.notEqual(world(state).queue?.charterType, 'academy');
});

test('a mature native science specialization still pays for Academy II while research remains', () => {
  const state = fixture(); academy(state);
  const plan = forecast(state, 's2', 'academy');
  assert.ok(plan.output.science > 0);
  assert.equal(plan.worthwhile, true);
  runAI(state, empire(state));
  assert.equal(world(state).queue?.charterType, 'academy');
  assert.equal(world(state).queue.charterLevel, 2);
  assert.deepEqual(world(state).queue.cost, { credits: 300, minerals: 100 });
});

test('no remaining research means no new laboratory or Academy project', () => {
  const state = fixture(3), faction = empire(state);
  faction.techs = Object.keys(TECHS); faction.science = 900;
  Object.assign(world(state), { buildings: ['beacon', 'factory', 'shipyard', 'mine', 'habitat'], charter: { type: 'forge', level: 2 } });
  Object.assign(world(state, 's4'), { buildings: ['beacon', 'mine', 'factory', 'habitat'], charter: { type: 'extraction', level: 2 } });
  world(state, 's5').buildings.push('beacon');
  assert.equal(forecast(state, 's5', 'lab').output.science, 0);
  assert.equal(forecast(state, 's5', 'lab').worthwhile, false);
  runAI(state, faction);
  assert.ok(state.systems.every(system => system.queue?.itemId !== 'lab' && system.queue?.charterType !== 'academy'));
  assert.ok(validateSave(state));
});

test('banked science and research already invested are each deducted exactly once', () => {
  const state = fixture(); academy(state);
  const faction = empire(state);
  faction.techs = Object.keys(TECHS).filter(id => !['command', 'terraforming'].includes(id));
  faction.research = { techId: 'command', progress: 100 }; faction.science = 200;
  assert.equal(forecast(state, 's2', 'academy').remainingResearch, 800);
});

test('paid research construction counts toward demand before commissioning another upgrade', () => {
  const state = fixture(2); academy(state);
  const faction = empire(state);
  faction.techs = Object.keys(TECHS).filter(id => id !== 'terraforming');
  faction.research = { techId: 'terraforming', progress: 260 };
  const before = forecast(state, 's2', 'academy');
  world(state, 's4').queue = { kind: 'building', itemId: 'lab', work: 30, progress: 29, cost: { ...BUILDINGS.lab.cost } };
  const after = forecast(state, 's2', 'academy');
  assert.ok(before.output.science > 0);
  assert.equal(after.output.science, 0);
});

test('an imminent contacted alignment and the campaign limit shorten optional payback', () => {
  const state = fixture(); academy(state);
  assert.equal(forecast(state, 's2', 'academy').worthwhile, true);
  publicRace(state);
  const plan = forecast(state, 's2', 'academy');
  assert.equal(plan.horizon, 4);
  assert.equal(plan.productiveCycles, 0);
  assert.equal(plan.worthwhile, false);
  runAI(state, empire(state));
  assert.notEqual(world(state).queue?.charterType, 'academy');
  empire(state).contacts = []; state.turn = 119;
  assert.equal(forecast(state, 's2', 'academy').horizon, 1);
});

test('surplus income projects are declined, but a genuine crew deficit still gets a market', () => {
  const state = fixture(), faction = empire(state), home = world(state);
  Object.assign(home, { population: 9, buildings: ['mine', 'factory', 'shipyard'], charter: { type: 'extraction', level: 2 } });
  state.fleets[0].type = 'frigate'; state.fleets[0].ships = 12; state.fleets[0].hp = 12 * SHIPS.frigate.hp;
  assert.equal(getEmpireStats(state, faction.id).creditIncome, -4);
  assert.equal(forecast(state, home.id, 'market').creditNeed, 0);
  assert.equal(forecast(state, home.id, 'market').worthwhile, false);
  const funded = structuredClone(state); runAI(funded, empire(funded));
  assert.notEqual(world(funded).queue?.itemId, 'market');
  faction.credits = 30;
  assert.equal(forecast(state, home.id, 'market').worthwhile, true);
  runAI(state, faction);
  assert.equal(home.queue?.itemId, 'market');
  assert.equal(faction.credits, 5);
});

test('replacement forecasts charge the lost native production and minerals', () => {
  const state = fixture(); world(state).buildings.push('factory');
  const emptySlot = forecast(state, 's2', 'lab');
  const replacesMine = forecast(state, 's2', 'lab', 'mine');
  const replacesFactory = forecast(state, 's2', 'lab', 'factory');
  assert.ok(replacesMine.output.minerals < 0);
  assert.ok(replacesFactory.output.production < 0);
  assert.ok(replacesMine.benefit < emptySlot.benefit);
  assert.ok(replacesFactory.benefit < emptySlot.benefit);
});

test('a rich empire still funds recurring income that enables a credible new crew', () => {
  const state = fixture(), faction = empire(state), home = world(state);
  Object.assign(home, { population: 3, buildings: ['mine', 'shipyard'], charter: { type: 'extraction', level: 2 } });
  Object.assign(state.fleets[0], { type: 'frigate', ships: 1, hp: SHIPS.frigate.hp });
  assert.equal(getEmpireStats(state, faction.id).creditIncome, 6, 'the next cruiser needs 4 upkeep plus the existing 4-credit income floor');
  const plan = forecast(state, home.id, 'market');
  assert.equal(plan.incomeShortfall, 2);
  assert.equal(plan.worthwhile, true);
  runAI(state, faction);
  assert.equal(home.queue?.itemId, 'market');
  assert.equal(faction.credits, 3975);
  const following = structuredClone(state);
  Object.assign(world(following, 's4'), { owner: 'khar', population: 6, buildings: ['mine'], knownBy: ['khar'], exploredBy: ['khar'] });
  assert.equal(forecast(following, 's4', 'market').creditNeed, 0, 'the already-funded port and colony income cover the bounded crew plan');
});

test('investment forecasts are pure and ignore unseen rival research, wealth, queues and fleets', () => {
  const state = fixture(); academy(state);
  const before = structuredClone(state), plan = forecast(state, 's2', 'academy');
  assert.deepEqual(state, before);
  const hidden = structuredClone(state), rival = hidden.factions.find(faction => faction.id === 'veyr');
  rival.credits = 100000; rival.science = 100000; rival.techs = Object.keys(TECHS);
  rival.research = null;
  world(hidden, 's1').queue = { kind: 'building', itemId: 'beacon', progress: 139, work: 140, cost: { ...BUILDINGS.beacon.cost } };
  hidden.fleets.push({ id: `f${hidden.nextFleetId++}`, owner: 'veyr', systemId: 's1', name: 'Hidden armada', type: 'cruiser', ships: 100, hp: 8500, movesLeft: 0 });
  assert.deepEqual(forecast(hidden, 's2', 'academy'), plan);
  runAI(state, empire(state)); runAI(hidden, empire(hidden));
  assert.deepEqual(world(hidden).queue, world(state).queue);
  assert.equal(empire(hidden).credits, empire(state).credits);
  assert.equal(empire(hidden).minerals, empire(state).minerals);
});

test('a paid queue remains intact when its science becomes obsolete', () => {
  const state = fixture(); academy(state);
  assert.equal(command(state, { type: 'develop', factionId: 'khar', systemId: 's2', charterType: 'academy' }).ok, true);
  const paid = structuredClone(world(state).queue);
  empire(state).techs = Object.keys(TECHS); empire(state).research = null;
  runAI(state, empire(state));
  assert.deepEqual(world(state).queue, paid);
});
