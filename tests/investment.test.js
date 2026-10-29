import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getSystemYield, getEmpireStats, getBuildOptions, validateSave } from '../src/game.js';
import { getInfrastructure, getCharterBonuses } from '../src/development.js';
import { getColonyRepairForecast } from '../src/fleet-management.js';
import { BUILDINGS, SHIPS, TECHS } from '../src/content.js';
import { getInvestmentComparison } from '../src/investment.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const home = state => state.systems.find(system => system.id === 's0');
const clone = value => JSON.parse(JSON.stringify(value));
const building = (itemId, replaceBuildingId) => ({ kind: 'building', itemId, ...(replaceBuildingId ? { replaceBuildingId } : {}) });
const charter = charterType => ({ kind: 'charter', charterType });
const compare = (state, request) => getInvestmentComparison(state, 's0', request);
const row = (view, id) => view.throughput.find(item => item.id === id);

function fixture() {
  const state = createGame('INVESTMENT-COMPARISON');
  // A deliberately static test galaxy: fixed capped population, no research,
  // lanes or fleets. Completion still uses ordinary commands and endTurn.
  state.lanes = []; state.fleets = [];
  for (const empire of state.factions) Object.assign(empire, { credits: 5000, minerals: 5000, science: 0, orders: 18, techs: Object.keys(TECHS), research: null });
  Object.assign(home(state), { population: 8, habitability: 90, richness: 4, science: 4, growth: 0, defenseDamage: 0, buildings: ['shipyard', 'mine'], queue: null, anomaly: null });
  assert.ok(validateSave(state));
  return state;
}

function cycle(state) {
  // Suppress rival construction without bypassing player resolution phases.
  for (const empire of state.factions.filter(candidate => candidate.id !== 'player')) empire.orders = 0;
  assert.ok(endTurn(state).ok);
  assert.ok(validateSave(state));
}

function finish(state) {
  let cycles = 0;
  while (home(state).queue) { assert.ok(cycles++ < 20); cycle(state); }
  return cycles;
}

// Observe a real completed world through the engine's ordinary public output
// APIs. No hypothetical building/charter transformation is performed here.
function actualSnapshot(state, system = home(state), factionId = system.owner) {
  const output = getSystemYield(state, system), empire = getEmpireStats(state, factionId);
  const repair = getColonyRepairForecast(state, system.id);
  return {
    colony: {
      credits: output.credits, minerals: output.minerals, science: output.science,
      production: output.production, defense: output.defense,
      population: system.population, capacity: output.capacity,
      growthPotential: output.growth, growthPaused: system.population >= output.capacity,
    },
    infrastructure: getInfrastructure(state, system),
    empire: {
      creditIncome: empire.creditIncome, mineralIncome: empire.mineralIncome,
      scienceIncome: empire.scienceIncome, production: empire.production,
      maxOrders: empire.maxOrders, uncappedOrders: empire.uncappedOrders,
      orderLimit: empire.orderLimit, beacons: empire.beacons,
    },
    repair: { capacity: repair.capacity, blocked: repair.blocked },
    militaryDiscount: getCharterBonuses(system).militaryDiscount,
  };
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('Forge II separates its five-cycle construction from future one-cycle frigates and paid prices', () => {
  const state = fixture(), colony = home(state), empire = faction(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 1 };
  const view = compare(state, charter('forge'));
  assert.equal(view.comparable, true); assert.equal(view.project.commission.enabled, true);
  assert.deepEqual(view.construction, { production: 24, cyclesAtCurrentRate: 5, queueBusy: false });
  assert.equal(view.project.work, 100); assert.equal(view.project.level, 2);
  assert.deepEqual(view.project.cost, { credits: 300, minerals: 100 });
  assert.equal(view.before.colony.production, 24); assert.equal(view.after.colony.production, 30);
  assert.equal(row(view, 'frigate').before.cycles, 2); assert.equal(row(view, 'frigate').after.cycles, 1);
  assert.deepEqual(row(view, 'frigate').before.cost, { credits: 25, minerals: 32 });
  assert.deepEqual(row(view, 'frigate').after.cost, { credits: 25, minerals: 28 });
  assert.equal(row(view, 'cruiser').before.cost.minerals, 77); assert.equal(row(view, 'cruiser').after.cost.minerals, 68);
  assert.equal(view.before.repair.capacity, 10); assert.equal(view.after.repair.capacity, 12);
  assert.equal(view.delta.militaryDiscount, .1);
  const credits = empire.credits, minerals = empire.minerals, orders = empire.orders;
  assert.ok(command(state, view.project.command).ok);
  assert.equal(empire.credits, credits - 300); assert.equal(empire.minerals, minerals - 100); assert.equal(empire.orders, orders - 1);
  for (let elapsed = 1; elapsed <= 4; elapsed++) {
    cycle(state); assert.equal(colony.queue.progress, elapsed * 24); assert.equal(colony.charter.level, 1);
    assert.deepEqual(colony.queue.cost, { credits: 300, minerals: 100 });
  }
  cycle(state); assert.equal(colony.queue, null); assert.equal(colony.charter.level, 2);
  assert.deepEqual(actualSnapshot(state), view.after);
  const receiptMinerals = empire.minerals;
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok);
  assert.equal(receiptMinerals - empire.minerals, 28); assert.deepEqual(colony.queue.cost, row(view, 'frigate').after.cost);
  cycle(state); assert.equal(colony.queue, null);
  assert.equal(state.fleets.filter(fleet => fleet.owner === 'player' && fleet.type === 'frigate').length, 1);
});

test('mine replacement removes both its own income and Extraction, and creates one beacon', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('lab', 'factory'); colony.charter = { type: 'extraction', level: 2 };
  const view = compare(state, building('beacon', 'mine'));
  assert.equal(view.comparable, true); assert.equal(view.before.colony.minerals, 23); assert.equal(view.after.colony.minerals, 6);
  assert.equal(view.delta.colony.minerals, -17); assert.equal(view.delta.empire.mineralIncome, -17);
  assert.equal(view.before.infrastructure.used, 4); assert.equal(view.after.infrastructure.used, 4);
  assert.deepEqual(view.removed, { building: { id: 'mine', name: BUILDINGS.mine.name }, charter: { type: 'extraction', level: 2, name: 'Extraction Charter' } });
  assert.equal(view.after.empire.beacons, 1);
  assert.equal(row(view, 'beacon').before.available, false); assert.match(row(view, 'beacon').before.reason, /slots/);
  assert.equal(row(view, 'beacon').after.cycles, null); assert.equal(row(view, 'beacon').after.reason, 'Already built');
  assert.ok(command(state, view.project.command).ok);
  assert.equal(getSystemYield(state, colony).minerals, 23, 'old investment remains until completion');
  assert.equal(finish(state), view.construction.cyclesAtCurrentRate);
  assert.equal(colony.charter, undefined); assert.deepEqual(actualSnapshot(state), view.after);
});

test('switching charters accounts for the lost specialization, without adding infrastructure', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('lab'); colony.charter = { type: 'extraction', level: 2 };
  const view = compare(state, charter('academy'));
  assert.equal(view.project.level, 1); assert.equal(view.project.work, 60);
  assert.deepEqual(view.project.cost, { credits: 120, minerals: 60 });
  assert.equal(view.delta.colony.minerals, -12); assert.equal(view.delta.colony.science, 6);
  assert.equal(view.delta.infrastructure.used, 0); assert.equal(view.removed.charter.type, 'extraction');
  assert.ok(command(state, view.project.command).ok); finish(state);
  assert.deepEqual(colony.charter, { type: 'academy', level: 1 }); assert.deepEqual(actualSnapshot(state), view.after);
});

test('Habitat removal keeps above-capacity citizens and slots while growth pauses', () => {
  const state = fixture(), colony = home(state);
  colony.population = 12; colony.buildings.push('habitat');
  const view = compare(state, building('market', 'habitat'));
  assert.equal(view.before.colony.capacity, 12); assert.equal(view.after.colony.capacity, 8);
  assert.equal(view.after.colony.population, 12); assert.equal(view.delta.colony.population, 0);
  assert.equal(view.before.infrastructure.capacity, 5); assert.equal(view.after.infrastructure.capacity, 5);
  assert.equal(view.after.colony.growthPaused, true); assert.ok(view.after.colony.growthPotential > 0, 'potential is not actual growth');
  assert.ok(command(state, view.project.command).ok); finish(state);
  assert.deepEqual(actualSnapshot(state), view.after); assert.equal(colony.growth, 0);
  cycle(state); assert.equal(colony.population, 12); assert.equal(colony.growth, 0);
  const addition = compare(state, building('habitat'));
  assert.equal(addition.after.infrastructure.capacity, addition.before.infrastructure.capacity, 'capacity is not an immediate population grant');
  assert.equal(addition.after.colony.population, 12);
});

test('Forum and Civic losses show effective capped orders separately from the uncapped mandate', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('forum'); colony.charter = { type: 'civic', level: 2 };
  for (const system of state.systems.slice(4, 12)) Object.assign(system, { owner: 'player', population: 8, buildings: ['forum'], exploredBy: ['player'], knownBy: ['player'] });
  let view = compare(state, building('market', 'forum'));
  assert.equal(view.before.empire.maxOrders, 18); assert.equal(view.after.empire.maxOrders, 18);
  assert.equal(view.delta.empire.maxOrders, 0); assert.equal(view.delta.empire.uncappedOrders, -3);
  assert.equal(view.delta.colony.credits, -8, '+7 port replaces +3 Forum and +12 Civic');
  for (const system of state.systems.slice(4, 8)) system.buildings = [];
  view = compare(state, building('market', 'forum'));
  assert.equal(view.before.empire.uncappedOrders, 24); assert.equal(view.after.empire.uncappedOrders, 21);
  for (const system of state.systems.slice(8, 12)) system.buildings = [];
  view = compare(state, building('market', 'forum'));
  assert.equal(view.before.empire.uncappedOrders, 20); assert.equal(view.after.empire.uncappedOrders, 17);
  assert.equal(view.delta.empire.maxOrders, -1);
  assert.ok(command(state, view.project.command).ok); finish(state);
  assert.equal(faction(state).orders, 17); assert.equal(getEmpireStats(state).maxOrders, 17);
});

test('shipyard loss and other structural blockers never advertise usable downstream cycle counts', () => {
  const state = fixture(), colony = home(state);
  let view = compare(state, building('factory', 'shipyard'));
  assert.deepEqual(view.throughput.map(item => item.id), ['scout', 'colony', 'frigate', 'cruiser', 'beacon']);
  for (const item of view.throughput.filter(item => item.kind === 'ship')) {
    assert.equal(item.before.available, true); assert.equal(item.after.available, false);
    assert.equal(item.after.cycles, null); assert.equal(item.after.reason, 'Requires an Orbital Shipyard');
  }
  assert.equal(view.before.repair.capacity, 8); assert.equal(view.after.repair.capacity, 4);
  assert.equal(row(view, 'beacon').after.available, true);
  colony.buildings.push('lab'); colony.population = 4;
  view = compare(state, building('factory', 'mine'));
  assert.equal(row(view, 'beacon').after.available, false); assert.equal(row(view, 'beacon').after.cycles, null);
  faction(state).techs = faction(state).techs.filter(id => !['cruisers', 'singularity'].includes(id));
  colony.population = 8;
  view = compare(state, building('factory', 'mine'));
  assert.equal(row(view, 'cruiser'), undefined, 'locked ship classes are not comparison rows');
  assert.equal(row(view, 'beacon').before.available, false); assert.match(row(view, 'beacon').before.reason, /Protocol/);
  assert.equal(row(view, 'beacon').before.cycles, null);
});

test('removing a Forge support removes production, repair and military discounts together', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 2 };
  const view = compare(state, building('market', 'factory'));
  assert.equal(view.before.colony.production, 30); assert.equal(view.after.colony.production, 12);
  assert.equal(view.delta.repair.capacity, -4); assert.equal(view.delta.militaryDiscount, -.2);
  assert.equal(row(view, 'frigate').before.cost.minerals, 28); assert.equal(row(view, 'frigate').after.cost.minerals, 35);
  assert.equal(row(view, 'cruiser').before.cycles, 3); assert.equal(row(view, 'cruiser').after.cycles, 6);
  assert.deepEqual(row(view, 'colony').before.cost, SHIPS.colony.cost); assert.deepEqual(row(view, 'colony').after.cost, SHIPS.colony.cost);
  assert.ok(command(state, view.project.command).ok); finish(state); assert.deepEqual(actualSnapshot(state), view.after);
});

test('funds, orders, busy queues and ended campaigns block commissioning but preserve structural comparison', () => {
  const base = fixture(); home(base).buildings.push('factory'); home(base).charter = { type: 'forge', level: 1 };
  for (const alter of [
    state => { faction(state).credits = 0; faction(state).minerals = 0; },
    state => { faction(state).orders = 0; },
    state => { assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok); },
    state => { state.winner = 'player'; state.victoryType = 'Legacy'; },
    state => { faction(state).eliminated = true; },
  ]) {
    const state = clone(base); alter(state);
    const unchanged = JSON.stringify(state), view = compare(state, charter('forge'));
    assert.equal(view.comparable, true); assert.ok(view.after); assert.equal(view.project.commission.enabled, false);
    assert.deepEqual(view.before, compare(base, charter('forge')).before);
    assert.deepEqual(view.after, compare(base, charter('forge')).after);
    const result = command(state, view.project.command);
    assert.equal(result.ok, false); assert.equal(result.message, view.project.commission.reason);
    assert.equal(JSON.stringify(state), unchanged);
  }
  const state = clone(base); faction(state).orders = 0; faction(state).credits = 0;
  const view = compare(state, charter('forge'));
  assert.match(view.project.commission.reason, /End the turn/);
  assert.equal(view.comparable, true);
});

test('temporary gates cannot mask structural prerequisites or manufacture a completed snapshot', () => {
  for (const [request, alter, pattern] of [
    [charter('forge'), state => { home(state).buildings = ['mine']; }, /Manufactory/],
    [charter('extraction'), state => { home(state).population = 3; }, /population 4/],
    [charter('extraction'), state => { faction(state).techs = []; }, /Logistics/],
    [charter('extraction'), state => { home(state).charter = { type: 'extraction', level: 2 }; }, /already at level II/],
    [building('factory'), state => { faction(state).techs = []; }, /Industry/],
    [building('mine'), () => {}, /Already built/],
    [building('lab', 'market'), () => {}, /existing building/],
    [building('lab'), state => { home(state).population = 2; }, /slots/],
    [building('ancient_observatory'), () => {}, /different discovery world/],
  ]) {
    const state = fixture(); alter(state);
    home(state).queue = { kind: 'ship', itemId: 'scout', progress: 0, work: 20, cost: { credits: 20, minerals: 20 } };
    faction(state).credits = 0; faction(state).minerals = 0; faction(state).orders = 0;
    const unchanged = JSON.stringify(state), view = compare(state, request);
    assert.equal(view.comparable, false); assert.match(view.reason, pattern);
    assert.equal(view.after, null); assert.equal(view.delta, null); assert.ok(view.throughput.every(item => item.after === null));
    assert.match(view.project.commission.reason, /No orders remaining/);
    assert.equal(JSON.stringify(state), unchanged);
  }
});

test('a paid old queue retains its exact receipt, progress and refund after unrelated inspection', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 1 };
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'cruiser' }).ok);
  cycle(state); assert.equal(colony.queue.progress, 24); assert.equal(colony.queue.cost.minerals, 77);
  const untouched = clone(state), saved = JSON.stringify(state);
  const view = compare(state, charter('forge'));
  assert.equal(view.construction.queueBusy, true); assert.equal(view.construction.cyclesAtCurrentRate, 5);
  assert.equal(view.project.commission.reason, 'Construction already in progress');
  assert.equal(row(view, 'cruiser').after.cost.minerals, 68);
  assert.equal(JSON.stringify(state), saved);
  const beforeCredits = faction(state).credits, beforeMinerals = faction(state).minerals;
  assert.ok(command(state, { type: 'cancelBuild', systemId: 's0' }).ok);
  assert.ok(command(untouched, { type: 'cancelBuild', systemId: 's0' }).ok);
  assert.equal(faction(state).credits - beforeCredits, Math.floor(65 * (1 - 24 / 65)));
  assert.equal(faction(state).minerals - beforeMinerals, Math.floor(77 * (1 - 24 / 65)));
  assert.deepEqual(state, untouched);
});

test('nominal repair capacity remains distinct from current observed blockade and missing hull', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 1 };
  faction(state).relations.khar.status = 'war'; faction(state, 'khar').relations.player.status = 'war';
  state.fleets.push({ id: `f${state.nextFleetId++}`, owner: 'khar', systemId: 's0', type: 'frigate', name: 'Observed blockade', ships: 1, hp: 34, movesLeft: 1 });
  const view = compare(state, charter('forge'));
  assert.deepEqual(view.before.repair, { capacity: 10, blocked: true });
  assert.deepEqual(view.after.repair, { capacity: 12, blocked: true });
  assert.equal(getColonyRepairForecast(state, 's0').totalRepair, 0);
  state.fleets[0].systemId = 's2';
  assert.deepEqual(compare(state, charter('forge')).after.repair, { capacity: 12, blocked: false });
});

test('local defense and research bonuses use present conditions, including empire faction rounding', () => {
  const state = fixture(), colony = home(state);
  colony.defenseDamage = 70;
  let view = compare(state, building('bastion'));
  assert.equal(view.before.colony.defense, 0); assert.equal(view.after.colony.defense, 11);
  assert.equal(view.delta.colony.defense, 11, 'existing damage matters more than nominal +30');
  view = compare(state, building('lab'));
  assert.equal(view.delta.colony.science, 9, 'Computing adds four to the Enclave itself');
  const choirHome = state.systems.find(system => system.id === 's3');
  Object.assign(choirHome, { population: 8, buildings: ['mine'], science: 3 });
  view = getInvestmentComparison(state, 's3', building('lab'), 'choir');
  assert.equal(view.delta.colony.science, 9);
  const before = view.before.empire.scienceIncome;
  assert.ok(command(state, view.project.command).ok);
  // Finish only through the normal whole-turn queue path. Choir has no other
  // worlds, so the floor can be checked directly against actual collection.
  while (choirHome.queue) cycle(state);
  assert.equal(getEmpireStats(state, 'choir').scienceIncome - before, view.delta.empire.scienceIncome);
  assert.equal(view.after.empire.scienceIncome, Math.floor(view.after.colony.science * 1.25));
});

test('ordinary replacement credits old output through completion, then new output next cycle', () => {
  const state = fixture(), colony = home(state), empire = faction(state);
  colony.charter = { type: 'extraction', level: 1 };
  const view = compare(state, building('market', 'mine'));
  assert.equal(view.construction.cyclesAtCurrentRate, 2);
  assert.ok(command(state, view.project.command).ok);
  const credits = empire.credits, minerals = empire.minerals;
  cycle(state); cycle(state);
  assert.equal(colony.queue, null); assert.deepEqual(actualSnapshot(state), view.after);
  assert.equal(empire.credits - credits, 2 * view.before.empire.creditIncome);
  assert.equal(empire.minerals - minerals, 2 * view.before.empire.mineralIncome);
  const completedCredits = empire.credits, completedMinerals = empire.minerals;
  cycle(state);
  assert.equal(empire.credits - completedCredits, view.after.empire.creditIncome);
  assert.equal(empire.minerals - completedMinerals, view.after.empire.mineralIncome);
});

test('growth before completion can change the eventual colony, without making the static projection a date guarantee', () => {
  const state = fixture(), colony = home(state);
  colony.population = 7; colony.growth = .9; colony.buildings.push('habitat');
  const view = compare(state, building('market', 'habitat'));
  assert.equal(view.before.colony.production, 11); assert.equal(view.after.colony.population, 7);
  assert.equal(view.after.colony.capacity, 8); assert.equal(view.after.colony.growthPaused, false);
  assert.ok(command(state, view.project.command).ok);
  cycle(state);
  assert.equal(colony.population, 8); assert.equal(colony.queue.progress, 11, 'birth does not retroactively increase this cycle production');
  cycle(state); assert.equal(colony.population, 9); assert.equal(colony.queue.progress, 23);
  cycle(state); assert.equal(colony.queue, null); assert.equal(colony.population, 10);
  assert.equal(getSystemYield(state, colony).capacity, 8); assert.equal(view.after.colony.population, 7, 'preview remains a fixed-population snapshot');
  cycle(state); assert.equal(colony.population, 10); assert.equal(colony.growth, 0);
});

test('inspection is pure on frozen inputs, returns detached values and survives JSON reload exactly', () => {
  const state = fixture(), colony = home(state);
  colony.buildings.push('factory'); colony.charter = { type: 'forge', level: 1 };
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok);
  const saved = JSON.stringify(state), baseline = clone(state), frozen = freeze(clone(state));
  const view = compare(frozen, charter('forge'));
  assert.deepEqual(view, compare(clone(state), charter('forge')));
  view.project.cost.minerals = 0; view.project.command.systemId = 's3'; view.before.colony.population = 999;
  view.after.infrastructure.capacity = 999; view.removed.charter.level = 99; row(view, 'frigate').before.cost.minerals = 0;
  assert.equal(JSON.stringify(frozen), saved); assert.equal(JSON.stringify(state), saved);
  cycle(state); cycle(baseline); assert.deepEqual(state, baseline, 'inspection cannot alter RNG, logs, resources, queues or the next complete turn');
  const loaded = clone(state); cycle(state); cycle(loaded); assert.deepEqual(state, loaded);
});

test('foreign/missing previews are denied and hidden rival changes cannot alter an owned comparison', () => {
  const state = fixture();
  for (const [systemId, request, factionId] of [
    ['s1', building('lab'), 'player'], ['missing', building('lab'), 'player'],
    ['s0', building('lab'), 'missing'], ['s0', building('missing'), 'player'],
    ['s0', { kind: 'ship', itemId: 'frigate' }, 'player'], ['s0', null, 'player'],
  ]) assert.equal(getInvestmentComparison(state, systemId, request, factionId), null);
  const expected = compare(state, building('lab')), changed = clone(state);
  for (const empire of changed.factions.filter(candidate => candidate.id !== 'player')) {
    empire.credits = 1; empire.minerals = 999999; empire.science = 123; empire.techs = [];
    empire.name = 'Secret rival name'; empire.research = { techId: 'physics', progress: 30 };
  }
  for (const system of changed.systems.filter(candidate => candidate.owner !== 'player')) {
    system.name = 'Unobserved world'; system.x += 100; system.y -= 100;
    system.buildings = ['mine', 'lab', 'factory']; system.population = 12; system.charter = null;
  }
  changed.fleets.push({ id: `f${changed.nextFleetId++}`, owner: 'khar', systemId: 's2', type: 'cruiser', name: 'Unseen force', ships: 12, hp: 1020, movesLeft: 2 });
  assert.deepEqual(compare(changed, building('lab')), expected);
  assert.equal(JSON.stringify(expected).includes('Unseen'), false);
});
