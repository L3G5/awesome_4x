import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, fleetPower, getEmpireStats, getSplitPreview, getColonyRepairForecast, validateSave } from '../src/game.js';
import { SHIPS } from '../src/content.js';

const player = state => state.factions.find(faction => faction.id === 'player');
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const sum = (fleets, key) => fleets.reduce((total, fleet) => total + fleet[key], 0);

function fixture({ type = 'frigate', ships = 4, hp = ships * SHIPS[type].hp, movesLeft = 1 } = {}) {
  const state = createGame('fleet-management');
  const fleet = state.fleets.find(candidate => candidate.owner === 'player' && candidate.type === 'frigate');
  Object.assign(fleet, { type, ships, hp, movesLeft });
  state.fleets = [fleet];
  Object.assign(player(state), { credits: 1000, minerals: 1000, orders: 100 });
  // Keep independent colonies in the galaxy while isolating player logistics.
  for (const faction of state.factions.filter(candidate => candidate.id !== 'player')) faction.eliminated = true;
  assert.ok(validateSave(state));
  return { state, fleet, home: state.systems[0] };
}

function addFleet(state, values = {}) {
  const type = values.type || 'frigate', number = state.nextFleetId++;
  const fleet = { id: `f${number}`, name: `${SHIPS[type].name} ${number}`, owner: 'player', systemId: 's0', type, ships: 1, hp: SHIPS[type].hp, movesLeft: SHIPS[type].moves, ...values };
  state.fleets.push(fleet);
  return fleet;
}

test('splitting preserves ships, hull, upkeep, firepower and remaining movement for one order', () => {
  const { state, fleet } = fixture({ ships: 6, hp: 153.7, movesLeft: 0 });
  fleet.name = 'The watch at Solace';
  const before = structuredClone(state), oldStats = getEmpireStats(state), oldPower = fleetPower(state, fleet);
  const preview = getSplitPreview(state, fleet.id, 2);
  assert.equal(preview.enabled, true);
  assert.equal(preview.orderCost, 1);
  assert.deepEqual(state, before, 'preview is pure');
  const result = command(state, { type: 'split', fleetId: fleet.id, ships: 2 });
  assert.equal(result.ok, true);
  const detached = state.fleets.find(candidate => candidate.id === result.newFleetId);
  assert.equal(fleet.name, 'The watch at Solace');
  assert.equal(detached.name, `Vanguard ${before.nextFleetId}`);
  assert.deepEqual([fleet.ships, detached.ships], [4, 2]);
  assert.equal(fleet.hp, preview.parent.hp);
  assert.equal(detached.hp, preview.detached.hp);
  assert.equal(fleet.hp + detached.hp, 153.7);
  assert.deepEqual([fleet.movesLeft, detached.movesLeft], [0, 0]);
  assert.equal(player(state).orders, player(before).orders - 1);
  assert.equal(player(state).credits, player(before).credits);
  assert.equal(player(state).minerals, player(before).minerals);
  assert.equal(getEmpireStats(state).upkeep, oldStats.upkeep);
  assert.equal(fleetPower(state, fleet) + fleetPower(state, detached), oldPower);
  assert.equal(state.rng, before.rng);
  assert.ok(validateSave(state));
});

test('spent movement cannot be refreshed by splitting, movement commands, or remerging', () => {
  const { state, fleet } = fixture({ movesLeft: 0 });
  const result = command(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  const detached = state.fleets.find(candidate => candidate.id === result.newFleetId);
  const neighbor = state.lanes.find(lane => lane.includes('s0')).find(id => id !== 's0');
  for (const selected of [fleet, detached]) {
    const before = structuredClone(state);
    assert.equal(command(state, { type: 'move', fleetId: selected.id, targetId: neighbor }).ok, false);
    assert.deepEqual(state, before);
  }
  assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: detached.id }).ok);
  assert.equal(fleet.movesLeft, 0);
});

test('rival empires use the same split cost and conservation rules without touching player resources', () => {
  const state = createGame('rival-detachment');
  const faction = state.factions.find(candidate => candidate.id === 'khar');
  const fleet = state.fleets.find(candidate => candidate.owner === 'khar' && candidate.type === 'frigate');
  Object.assign(fleet, { ships: 3, hp: 55.1, movesLeft: 0 });
  const originalOrders = faction.orders, originalPlayer = structuredClone(player(state));
  const preview = getSplitPreview(state, fleet.id, 1, faction.id);
  assert.ok(preview.enabled);
  const result = command(state, { type: 'split', factionId: faction.id, fleetId: fleet.id, ships: 1 });
  assert.ok(result.ok);
  const detached = state.fleets.find(candidate => candidate.id === result.newFleetId);
  assert.equal(detached.owner, 'khar');
  assert.equal(fleet.hp + detached.hp, 55.1);
  assert.equal(fleet.ships + detached.ships, 3);
  assert.equal(detached.movesLeft, 0);
  assert.equal(faction.orders, originalOrders - 1);
  assert.deepEqual(player(state), originalPlayer);
  assert.ok(validateSave(state));
});

test('severely damaged merged forces retain explicit ship counts and fractional legacy hull', () => {
  for (const hp of [.1, .2, 1.0000000000001, 12, 35.1, 125.6789012345]) {
    const { state, fleet } = fixture({ ships: 12, hp });
    for (const ships of [1, 5, 11]) {
      const preview = getSplitPreview(state, fleet.id, ships);
      assert.equal(preview.enabled, true);
      assert.equal(preview.parent.ships + preview.detached.ships, 12);
      assert.equal(preview.parent.hp + preview.detached.hp, hp);
      assert.ok(preview.parent.hp > 0 && preview.detached.hp > 0);
      near(preview.detached.hp / hp, ships / 12, 1e-14);
    }
    const result = command(state, { type: 'split', fleetId: fleet.id, ships: 5 });
    assert.ok(result.ok);
    assert.equal(sum(state.fleets, 'ships'), 12, 'administration never recomputes ceil(hp/maxHull)');
    assert.equal(sum(state.fleets, 'hp'), hp);
    assert.ok(validateSave(state));
  }
});

test('repeated odd-fraction split and merge cycles neither create nor erase hull', () => {
  for (const hp of [35.1, 153.7, 201.3, 287.9, .1]) {
    const { state, fleet } = fixture({ ships: 12, hp });
    player(state).orders = 1000;
    for (let cycle = 0; cycle < 60; cycle++) {
      const split = command(state, { type: 'split', fleetId: fleet.id, ships: cycle % 11 + 1 });
      assert.ok(split.ok);
      assert.equal(sum(state.fleets, 'hp'), hp);
      assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: split.newFleetId }).ok);
      assert.equal(fleet.hp, hp);
      assert.equal(fleet.ships, 12);
    }
  }
});

test('all ordinary hull counts have positive bounded exact allocations, including healthy capacity', () => {
  for (const type of ['scout', 'frigate', 'cruiser']) {
    for (let ships = 2; ships <= 12; ships++) {
      const { state, fleet } = fixture({ type, ships });
      for (const hp of [ships * SHIPS[type].hp, ships * SHIPS[type].hp - .1, .1, Number.MIN_VALUE * 2, 1e-300]) {
        fleet.hp = hp;
        for (let detached = 1; detached < ships; detached++) {
          const preview = getSplitPreview(state, fleet.id, detached);
          assert.ok(preview.enabled, `${type}/${ships}/${detached}/${hp}: ${preview.reason}`);
          assert.equal(preview.parent.hp + preview.detached.hp, hp);
          for (const part of [preview.parent, preview.detached]) assert.ok(part.hp > 0 && part.hp <= part.ships * SHIPS[type].hp);
        }
      }
    }
  }
});

test('invalid split counts, ownership, Ark operation and unrepresentable hull fail atomically', () => {
  for (const ships of [undefined, null, 0, -1, 4, 5, 1.5, NaN, Infinity, '1']) {
    const { state, fleet } = fixture(), before = structuredClone(state);
    assert.equal(command(state, { type: 'split', fleetId: fleet.id, ships }).ok, false);
    assert.deepEqual(state, before);
  }
  for (const change of [
    ({ fleet }) => { fleet.type = 'colony'; fleet.hp = 24; },
    ({ fleet }) => { fleet.ships = 1; fleet.hp = 34; },
    ({ fleet }) => { fleet.hp = Number.MIN_VALUE; },
    ({ state }) => { player(state).orders = 0; },
    ({ state }) => { state.winner = 'veyr'; },
    ({ fleet }) => { fleet.owner = 'veyr'; },
    ({ state }) => { player(state).eliminated = true; },
  ]) {
    const fixtureState = fixture(); change(fixtureState);
    const { state, fleet } = fixtureState, before = structuredClone(state);
    assert.equal(getSplitPreview(state, fleet.id).enabled, false);
    assert.equal(command(state, { type: 'split', fleetId: fleet.id, ships: 1 }).ok, false);
    assert.deepEqual(state, before);
  }
});

test('the original keeps its route and both descendants retain independent historical records', () => {
  const { state, fleet, home } = fixture();
  const neighbor = state.lanes.find(lane => lane.includes('s0')).find(id => id !== 's0');
  state.systems.find(system => system.id === neighbor).knownBy.push('player');
  assert.ok(command(state, { type: 'planRoute', fleetId: fleet.id, destinationId: neighbor }).ok);
  const route = structuredClone(fleet.route);
  fleet.heritage = [{ id: 's0:forge:ship', name: 'Last Light of Solace', systemId: home.id, discoveryId: 'forge', choiceId: 'ship', turn: 1, factionId: 'player', fleetId: 'f900' }];
  const originalHeritage = fleet.heritage;
  const split = command(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  const detached = state.fleets.find(candidate => candidate.id === split.newFleetId);
  assert.deepEqual(fleet.route, route);
  assert.equal(detached.route, undefined);
  assert.deepEqual(detached.heritage, originalHeritage);
  assert.deepEqual(fleet.heritage, originalHeritage);
  assert.notEqual(fleet.heritage, originalHeritage);
  assert.notEqual(fleet.heritage, detached.heritage);
  assert.notEqual(fleet.heritage[0], detached.heritage[0]);
  assert.ok(validateSave(state));
  const loaded = JSON.parse(JSON.stringify(state));
  assert.ok(validateSave(loaded));
  assert.deepEqual(getSplitPreview(loaded, fleet.id), getSplitPreview(state, fleet.id));
  assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: detached.id }).ok);
  assert.deepEqual(fleet.heritage, originalHeritage);
  assert.deepEqual(fleet.route, route);
});

test('fleet identifiers remain unique in legacy saves and the save fleet limit is respected', () => {
  const { state, fleet } = fixture();
  state.nextFleetId = Number(fleet.id.slice(1));
  assert.ok(validateSave(state));
  const result = command(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  assert.ok(result.ok);
  assert.notEqual(result.newFleetId, fleet.id);
  assert.ok(validateSave(state));
  while (state.fleets.length < 1000) addFleet(state);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'split', fleetId: fleet.id, ships: 1 }).ok, false);
  assert.deepEqual(state, before);
});

test('a colony shares its repair pool by missing hull, excluding healthy and visiting forces', () => {
  const { state, fleet } = fixture({ ships: 1, hp: 10 });
  const cruiser = addFleet(state, { type: 'cruiser', hp: 37 });
  const healthy = addFleet(state, { type: 'scout', hp: 18 });
  const visitor = addFleet(state, { owner: 'veyr', hp: 2 });
  const before = structuredClone(state), forecast = getColonyRepairForecast(state, 's0');
  assert.deepEqual(state, before);
  assert.equal(forecast.capacity, 8);
  assert.equal(forecast.totalMissingHull, 72);
  assert.equal(forecast.blocked, false);
  near(forecast.fleets.find(row => row.fleetId === fleet.id).repair, 8 / 3);
  near(forecast.fleets.find(row => row.fleetId === cruiser.id).repair, 16 / 3);
  assert.equal(forecast.fleets.find(row => row.fleetId === healthy.id).repair, 0);
  assert.equal(forecast.fleets.some(row => row.fleetId === visitor.id), false);
  near(forecast.totalRepair, 8);
  assert.ok(forecast.totalRepair <= forecast.capacity);
  state.fleets.reverse();
  assert.deepEqual(getColonyRepairForecast(state, 's0'), forecast, 'array order cannot change remainder allocation');
});

test('one-fleet repair rate and both Forge levels preserve their existing colony bonuses', () => {
  const { state, fleet, home } = fixture({ hp: 10 });
  for (const [shipyard, level, expected] of [[false, 0, 4], [true, 0, 8], [false, 1, 6], [true, 1, 10], [false, 2, 8], [true, 2, 12]]) {
    home.buildings = [...(shipyard ? ['shipyard'] : []), ...(level ? ['factory'] : [])];
    home.charter = level ? { type: 'forge', level } : undefined;
    const forecast = getColonyRepairForecast(state, home.id);
    assert.equal(forecast.capacity, expected);
    assert.equal(forecast.totalRepair, expected);
    assert.equal(forecast.fleets[0].hpAfter, fleet.hp + expected);
  }
});

test('all existing hostile-presence blockade rules still stop passive recovery', () => {
  for (const type of ['scout', 'colony', 'frigate', 'cruiser']) {
    const { state, home } = fixture({ hp: 10 });
    addFleet(state, { owner: 'veyr', type, hp: SHIPS[type].hp });
    player(state).relations.veyr.status = 'war';
    const forecast = getColonyRepairForecast(state, home.id);
    assert.equal(forecast.capacity, 8);
    assert.equal(forecast.blocked, true);
    assert.equal(forecast.totalRepair, 0);
    assert.ok(forecast.fleets.every(row => row.hpAfter === row.hp));
  }
});

test('a blockaded colony performs no passive repair while paid emergency work remains available', () => {
  const { state, fleet } = fixture({ hp: 10 });
  addFleet(state, { owner: 'veyr', type: 'scout', hp: 18 });
  player(state).relations.veyr.status = 'war';
  assert.ok(command(state, { type: 'repair', fleetId: fleet.id }).ok);
  assert.equal(fleet.hp, 34);
  endTurn(state);
  assert.equal(fleet.hp, 34);
  assert.equal(getColonyRepairForecast(state, 's0').blocked, true);
});

test('proportional splitting and remerging cannot multiply one colony’s recovery', () => {
  for (const hp of [20, 35.1, 136 - .1, .1]) {
    const { state, fleet } = fixture({ hp });
    const baseline = structuredClone(state), originalForecast = getColonyRepairForecast(state, 's0');
    while (fleet.ships > 1) assert.ok(command(state, { type: 'split', fleetId: fleet.id, ships: 1 }).ok);
    const splitForecast = getColonyRepairForecast(state, 's0');
    near(splitForecast.totalRepair, originalForecast.totalRepair);
    assert.ok(splitForecast.totalRepair <= 8);
    endTurn(state); endTurn(baseline);
    for (const other of [...state.fleets].filter(candidate => candidate.id !== fleet.id)) assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: other.id }).ok);
    near(fleet.hp, baseline.fleets[0].hp);
    assert.equal(fleet.ships, baseline.fleets[0].ships);
    assert.ok(validateSave(state));
  }
});

test('repair applies forecasted allocations, caps almost-full hulls, and survives exact reload replay', () => {
  const { state, fleet } = fixture({ ships: 2, hp: 67.95 });
  addFleet(state, { hp: 33.9999999999 });
  addFleet(state, { type: 'cruiser', hp: 84.7 });
  const forecast = getColonyRepairForecast(state, 's0');
  assert.ok(forecast.totalRepair <= forecast.capacity);
  near(forecast.totalRepair, forecast.totalMissingHull);
  assert.ok(forecast.fleets.every(row => row.hpAfter === row.maxHp));
  const loaded = JSON.parse(JSON.stringify(state));
  endTurn(state); endTurn(loaded);
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(state)));
  for (const row of forecast.fleets) assert.equal(state.fleets.find(candidate => candidate.id === row.fleetId).hp, row.hpAfter);
  assert.equal(fleet.hp, 68);
  assert.ok(validateSave(state));
});

test('different colonies supply independent repair capacity without foreign or unowned recovery', () => {
  const { state, fleet } = fixture({ ships: 2, hp: 20 });
  const split = command(state, { type: 'split', fleetId: fleet.id, ships: 1 });
  const other = state.fleets.find(candidate => candidate.id === split.newFleetId);
  const colony = state.systems[4];
  Object.assign(colony, { owner: 'player', buildings: [], population: 3 });
  other.systemId = colony.id;
  assert.equal(getColonyRepairForecast(state, 's0').totalRepair, 8);
  assert.equal(getColonyRepairForecast(state, colony.id).totalRepair, 4);
  colony.owner = null;
  assert.equal(getColonyRepairForecast(state, colony.id).totalRepair, 0);
  colony.owner = 'veyr';
  assert.equal(getColonyRepairForecast(state, colony.id).fleets.length, 0);
  assert.equal(getColonyRepairForecast(state, 'not-a-system').totalRepair, 0);
});

test('paid emergency repair still provides only 24 hull for each ordinary paid order', () => {
  const { state, fleet } = fixture({ hp: 20 });
  const before = structuredClone(state);
  assert.ok(command(state, { type: 'repair', fleetId: fleet.id }).ok);
  assert.equal(fleet.hp, 44);
  assert.equal(player(state).minerals, player(before).minerals - 10);
  assert.equal(player(state).orders, player(before).orders - 1);
  assert.equal(getColonyRepairForecast(state, 's0').totalRepair, 8);
});
