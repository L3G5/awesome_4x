import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getSystemYield, getEmpireStats, getBuildOptions, getInfrastructure, getDevelopmentOptions, getCharterBonuses, getConstructionProject, validateSave } from '../src/game.js';
import { CHARTERS } from '../src/development.js';
import { BUILDINGS, SHIPS } from '../src/content.js';

const player = state => state.factions.find(f => f.id === 'player');
const home = state => state.systems.find(s => s.id === 's0');
function funded() {
  const state = createGame('development');
  player(state).credits = 5000; player(state).minerals = 5000;
  player(state).techs.push('logistics', 'industry', 'ecology', 'diplomacy', 'physics', 'shields', 'cruisers', 'singularity');
  return state;
}
function finish(state, colony = home(state)) {
  assert.ok(colony.queue);
  colony.queue.progress = colony.queue.work - 1;
  assert.ok(endTurn(state).ok);
  assert.equal(colony.queue, null);
}

test('population grants bounded infrastructure slots, and ships do not occupy one', () => {
  const state = funded(), colony = home(state);
  for (const [population, capacity] of [[1, 2], [3, 3], [5, 3], [6, 4], [8, 4], [9, 5], [20, 5]]) {
    colony.population = population;
    assert.equal(getInfrastructure(state, colony).capacity, capacity);
  }
  colony.population = 4; colony.buildings.push('lab');
  assert.deepEqual(getInfrastructure(state, colony), { used: 3, capacity: 3, available: 0, overCapacity: 0 });
  const options = getBuildOptions(state, colony.id);
  assert.equal(options.find(o => o.id === 'beacon').enabled, false, 'even beacons use infrastructure');
  assert.equal(options.find(o => o.id === 'market').enabled, false);
  assert.equal(options.find(o => o.id === 'frigate').enabled, true);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'build', systemId: colony.id, itemId: 'market' }).ok, false);
  assert.deepEqual(state, before);
  assert.ok(command(state, { type: 'build', systemId: colony.id, itemId: 'frigate' }).ok);
  finish(state);
  assert.equal(colony.buildings.length, 3);
});

test('replacement keeps old infrastructure and its charter until completion, and cancellation preserves both', () => {
  const state = funded(), colony = home(state);
  colony.buildings.push('lab'); colony.charter = { type: 'extraction', level: 1 };
  const initial = getSystemYield(state, colony).minerals;
  const result = command(state, { type: 'build', systemId: colony.id, itemId: 'market', replaceBuildingId: 'mine' });
  assert.ok(result.ok); assert.equal(colony.queue.replaceBuildingId, 'mine');
  assert.ok(colony.buildings.includes('mine')); assert.equal(getSystemYield(state, colony).minerals, initial);
  assert.ok(command(state, { type: 'cancelBuild', systemId: colony.id }).ok);
  assert.deepEqual(colony.charter, { type: 'extraction', level: 1 });
  assert.ok(colony.buildings.includes('mine'));
  assert.ok(command(state, { type: 'build', systemId: colony.id, itemId: 'market', replaceBuildingId: 'mine' }).ok);
  finish(state);
  assert.ok(!colony.buildings.includes('mine')); assert.ok(colony.buildings.includes('market'));
  assert.equal(colony.charter, undefined);
  assert.equal(colony.buildings.length, 3);
  assert.ok(validateSave(state));
});

test('invalid replacement requests are atomic and never destroy buildings immediately', () => {
  const state = funded();
  for (const action of [
    { itemId: 'market', replaceBuildingId: 'missing' },
    { itemId: 'market', replaceBuildingId: 'market' },
    { itemId: 'frigate', replaceBuildingId: 'mine' },
    { itemId: 'mine', replaceBuildingId: 'mine' },
  ]) {
    const before = structuredClone(state);
    assert.equal(command(state, { type: 'build', systemId: 's0', ...action }).ok, false);
    assert.deepEqual(state, before);
  }
});

test('legacy over-capacity worlds and already-paid projects survive population loss and save restoration', () => {
  const state = funded(), colony = home(state);
  colony.buildings = Object.keys(BUILDINGS).filter(id => id !== 'market');
  colony.population = 1;
  colony.charter = { type: 'forge', level: 2 };
  colony.queue = { itemId: 'market', kind: 'building', progress: 0, work: BUILDINGS.market.work, cost: { ...BUILDINGS.market.cost } };
  assert.ok(validateSave(state), 'old ordinary queued projects need no new slot metadata');
  const restored = JSON.parse(JSON.stringify(state));
  finish(restored);
  assert.equal(home(restored).buildings.length, Object.keys(BUILDINGS).length);
  assert.equal(home(restored).charter.level, 2);
  assert.ok(getInfrastructure(restored, home(restored)).overCapacity > 0);
  assert.ok(validateSave(restored));
  const oldCount = home(restored).buildings.length;
  home(restored).buildings = home(restored).buildings.filter(id => id !== 'lab');
  assert.ok(command(restored, { type: 'build', systemId: 's0', itemId: 'lab', replaceBuildingId: 'market' }).ok);
  finish(restored);
  assert.equal(home(restored).buildings.length, oldCount - 1, 'legacy replacement neither expands nor trims the existing footprint');
});

test('charter prerequisites, costs and orders are enforced atomically while full slots do not block development', () => {
  const state = funded(), colony = home(state);
  colony.buildings.push('lab');
  const option = getDevelopmentOptions(state, 's0').find(o => o.charterType === 'extraction');
  assert.equal(option.enabled, true); assert.equal(option.level, 1);
  assert.deepEqual(option.cost, { credits: 120, minerals: 60 }); assert.equal(option.work, 60);
  const beforePreview = structuredClone(state);
  getDevelopmentOptions(state, 's0'); getBuildOptions(state, 's0');
  assert.deepEqual(state, beforePreview, 'previews are pure');
  for (const alter of [
    copy => { home(copy).population = 3; },
    copy => { player(copy).techs = []; },
    copy => { home(copy).buildings = ['shipyard']; },
    copy => { player(copy).credits = 119; },
    copy => { player(copy).minerals = 59; },
    copy => { player(copy).orders = 0; },
  ]) {
    const copy = structuredClone(state); alter(copy); const unchanged = structuredClone(copy);
    assert.equal(command(copy, { type: 'develop', systemId: 's0', charterType: 'extraction' }).ok, false);
    assert.deepEqual(copy, unchanged);
  }
  const credits = player(state).credits, minerals = player(state).minerals, orders = player(state).orders;
  assert.ok(command(state, { type: 'develop', systemId: 's0', charterType: 'extraction' }).ok);
  assert.equal(player(state).credits, credits - 120); assert.equal(player(state).minerals, minerals - 60); assert.equal(player(state).orders, orders - 1);
  assert.equal(colony.charter, undefined); assert.equal(colony.queue.kind, 'charter');
  assert.equal(getConstructionProject(colony.queue).name, 'Extraction Charter I');
  assert.ok(validateSave(state));
  finish(state);
  assert.deepEqual(colony.charter, { type: 'extraction', level: 1 }); assert.equal(colony.buildings.length, 3);
});

test('charter promotion needs population eight and industry, and switching preserves the old bonus until completion', () => {
  const state = funded(), colony = home(state);
  colony.buildings.push('lab'); colony.charter = { type: 'extraction', level: 1 };
  assert.equal(getDevelopmentOptions(state, 's0').find(o => o.id === 'extraction').enabled, false);
  colony.population = 8;
  player(state).techs = player(state).techs.filter(id => id !== 'industry');
  assert.equal(getDevelopmentOptions(state, 's0').find(o => o.id === 'extraction').enabled, false);
  player(state).techs.push('industry');
  const upgrade = getDevelopmentOptions(state, 's0').find(o => o.id === 'extraction');
  assert.equal(upgrade.level, 2); assert.equal(upgrade.promoting, true);
  assert.deepEqual(upgrade.cost, { credits: 300, minerals: 100 }); assert.equal(upgrade.work, 100);
  assert.ok(command(state, { type: 'develop', systemId: 's0', charterType: 'extraction' }).ok);
  assert.equal(colony.charter.level, 1); finish(state); assert.equal(colony.charter.level, 2);
  assert.equal(getDevelopmentOptions(state, 's0').find(o => o.id === 'extraction').enabled, false);
  const change = getDevelopmentOptions(state, 's0').find(o => o.id === 'academy');
  assert.equal(change.switching, true); assert.equal(change.level, 1);
  assert.equal(change.delta.minerals, -(2 + colony.richness) * 2);
  assert.equal(change.delta.science, 2 + colony.science);
  const mineralOutput = getSystemYield(state, colony).minerals;
  assert.ok(command(state, { type: 'develop', systemId: 's0', charterType: 'academy' }).ok);
  assert.equal(getSystemYield(state, colony).minerals, mineralOutput);
  finish(state);
  assert.deepEqual(colony.charter, { type: 'academy', level: 1 });
  assert.equal(getSystemYield(state, colony).minerals, mineralOutput - (2 + colony.richness) * 2);
});

test('each charter produces its stated native-world and population-dependent bonuses and civic orders', () => {
  const state = funded(), colony = home(state);
  colony.population = 8; colony.buildings = ['mine', 'lab', 'factory', 'forum', 'shipyard'];
  const original = getSystemYield(state, colony), orderCount = getEmpireStats(state).maxOrders;
  for (const type of Object.keys(CHARTERS)) {
    colony.charter = { type, level: 2 };
    const bonus = getCharterBonuses(colony), output = getSystemYield(state, colony);
    for (const key of ['credits', 'minerals', 'science', 'production']) assert.equal(output[key], original[key] + bonus[key]);
    assert.equal(getEmpireStats(state).maxOrders, orderCount + bonus.orders);
    if (type === 'extraction') assert.equal(bonus.minerals, 2 * (2 + colony.richness));
    if (type === 'academy') assert.equal(bonus.science, 2 * (2 + colony.science));
    if (type === 'forge') { assert.equal(bonus.production, 12); assert.equal(bonus.militaryDiscount, .2); assert.equal(bonus.repair, 4); }
    if (type === 'civic') { assert.equal(bonus.orders, 2); assert.equal(bonus.credits, 12); }
  }
  const expectedIncome = getEmpireStats(state).creditIncome, oldCredits = player(state).credits;
  endTurn(state);
  assert.equal(player(state).credits, oldCredits + expectedIncome);
  assert.equal(player(state).orders, getEmpireStats(state).maxOrders);
});

test('forge military discounts round up, apply only to minerals, and cancellation refunds the paid price', () => {
  const state = funded(), colony = home(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 1 };
  let options = getBuildOptions(state, 's0');
  assert.deepEqual(options.find(o => o.id === 'frigate').cost, { credits: 25, minerals: 32 });
  assert.deepEqual(options.find(o => o.id === 'cruiser').cost, { credits: 65, minerals: 77 });
  assert.deepEqual(options.find(o => o.id === 'colony').cost, SHIPS.colony.cost);
  assert.deepEqual(options.find(o => o.id === 'scout').cost, SHIPS.scout.cost);
  assert.deepEqual(options.find(o => o.id === 'beacon').cost, BUILDINGS.beacon.cost);
  colony.charter.level = 2;
  options = getBuildOptions(state, 's0');
  assert.equal(options.find(o => o.id === 'frigate').cost.minerals, 28);
  const original = player(state).minerals;
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok);
  assert.equal(colony.queue.cost.minerals, 28);
  colony.queue.progress = colony.queue.work / 2;
  assert.ok(command(state, { type: 'cancelBuild', systemId: 's0' }).ok);
  assert.equal(player(state).minerals, original - 14);
  assert.deepEqual(colony.charter, { type: 'forge', level: 2 });
});

test('charter cancellation refunds only unused work and never removes the currently operating charter', () => {
  const state = funded(), colony = home(state);
  colony.buildings.push('lab'); colony.charter = { type: 'extraction', level: 1 };
  const credits = player(state).credits, minerals = player(state).minerals;
  command(state, { type: 'develop', systemId: 's0', charterType: 'academy' });
  colony.queue.progress = 30;
  command(state, { type: 'cancelBuild', systemId: 's0' });
  assert.equal(player(state).credits, credits - 60); assert.equal(player(state).minerals, minerals - 30);
  assert.deepEqual(colony.charter, { type: 'extraction', level: 1 });
});

test('forge orbital repairs occur only at an unblocked owned colony', () => {
  for (const blocked of [false, true]) {
    const state = funded(), colony = home(state);
    colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 2 };
    const own = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate'); own.hp = 10;
    if (blocked) {
      const foreign = state.fleets.find(f => f.owner === 'veyr' && f.type === 'colony'); foreign.systemId = colony.id;
      factionWar(state, 'player', 'veyr'); faction(state, 'veyr').orders = 0;
    }
    endTurn(state);
    assert.equal(own.hp, blocked ? 10 : 22, 'shipyard 8 + forge II 4 repair, unless blocked');
  }
});

function faction(state, id) { return state.factions.find(f => f.id === id); }
function factionWar(state, first, second) { for (const [a, b] of [[first, second], [second, first]]) faction(state, a).relations[b].status = 'war'; }

test('capture preserves completed charters and their support while cancelling the former owner’s queued change', () => {
  const state = funded(), target = state.systems.find(s => s.id === 's1');
  target.charter = { type: 'extraction', level: 2 };
  target.population = 8;
  target.queue = { kind: 'building', itemId: 'market', replaceBuildingId: 'mine', progress: 1, work: 24, cost: { credits: 25, minerals: 20 } };
  const attacker = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  attacker.systemId = target.id; attacker.ships = 12; attacker.hp = 408;
  for (const enemy of state.fleets.filter(f => f.owner === 'veyr')) enemy.systemId = 's20';
  factionWar(state, 'player', 'veyr');
  assert.ok(command(state, { type: 'attack', fleetId: attacker.id }).ok);
  assert.equal(target.owner, 'player'); assert.equal(target.queue, null);
  assert.deepEqual(target.charter, { type: 'extraction', level: 2 }); assert.ok(target.buildings.includes('mine'));
  assert.equal(getCharterBonuses(target).minerals, 2 * (2 + target.richness));
  assert.ok(validateSave(state));
});

test('new development save fields validate strictly without rejecting old ordinary queues or charter-free saves', () => {
  const state = funded(), colony = home(state);
  assert.ok(validateSave(state));
  command(state, { type: 'develop', systemId: 's0', charterType: 'extraction' });
  assert.ok(validateSave(JSON.parse(JSON.stringify(state))));
  for (const alter of [
    copy => { home(copy).queue.charterType = '__proto__'; },
    copy => { home(copy).queue.charterLevel = 3; },
    copy => { home(copy).queue.charterLevel = 2; },
    copy => { home(copy).queue.itemId = 'academy'; },
    copy => { home(copy).queue.replaceBuildingId = 'mine'; },
    copy => { home(copy).queue.cost.minerals = -1; },
    copy => { home(copy).queue.cost = []; },
    copy => { home(copy).charter = { type: 'extraction', level: 9 }; },
    copy => { home(copy).charter = { type: 'academy', level: 1 }; },
  ]) { const copy = structuredClone(state); alter(copy); assert.equal(validateSave(copy), false); }
  colony.queue = null; colony.charter = { type: 'extraction', level: 1 };
  assert.ok(validateSave(state));
  colony.population = 1;
  assert.ok(validateSave(state), 'population loss does not invalidate completed development');
});
