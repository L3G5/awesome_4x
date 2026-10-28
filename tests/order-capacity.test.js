import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getEmpireStats, getDevelopmentOptions, getBuildOptions, getOrderCapacity, getOrderChange, validateSave } from '../src/game.js';

function fixture(count = 8, extraForums = 0) {
  const state = createGame('order-capacity');
  const worlds = [state.systems[0], ...state.systems.slice(4, 4 + count - 1)];
  for (const [index, system] of worlds.entries()) {
    Object.assign(system, { owner: 'player', population: 8, buildings: index === 0 ? ['forum', 'lab'] : index <= extraForums ? ['forum'] : [], queue: null });
    if (!system.knownBy.includes('player')) system.knownBy.push('player');
    if (!system.exploredBy.includes('player')) system.exploredBy.push('player');
  }
  state.systems[0].charter = { type: 'civic', level: 1 };
  Object.assign(state.factions[0], { credits: 2000, minerals: 2000, orders: 18, techs: ['logistics', 'industry', 'diplomacy', 'command'] });
  for (const faction of state.factions.slice(1)) faction.orders = 0;
  return state;
}

test('a civic upgrade forecasts and replenishes its actual uncapped mandate gain', () => {
  const state = fixture(2);
  const option = getDevelopmentOptions(state, 's0').find(option => option.charterType === 'civic');
  assert.deepEqual(option.orderEffect, { current: 12, projected: 13, nominal: 1, change: 1, limit: 18 });
  assert.equal(command(state, { type: 'develop', systemId: 's0', charterType: 'civic' }).ok, true);
  state.systems[0].queue.progress = state.systems[0].queue.work - 1;
  endTurn(state);
  assert.equal(state.factions[0].orders, 13);
  assert.equal(getEmpireStats(state).maxOrders, option.orderEffect.projected);
  assert.equal(validateSave(state), true);
});

test('a legal civic upgrade at the cap retains its credit benefit but grants no usable order', () => {
  const state = fixture();
  const option = getDevelopmentOptions(state, 's0').find(option => option.charterType === 'civic');
  assert.equal(option.enabled, true);
  assert.equal(option.delta.credits, 6);
  assert.deepEqual(option.orderEffect, { current: 18, projected: 18, nominal: 1, change: 0, limit: 18 });
  assert.equal(command(state, { type: 'develop', systemId: 's0', charterType: 'civic' }).ok, true);
  state.systems[0].queue.progress = state.systems[0].queue.work - 1;
  endTurn(state);
  assert.equal(state.factions[0].orders, 18);
  assert.equal(getEmpireStats(state).uncappedOrders, 19);
  assert.equal(validateSave(state), true);
});

test('removing a Forum and its Civic II charter accounts for capacity above the cap', () => {
  for (const [extraForums, expected] of [[0, 16], [2, 18]]) {
    const state = fixture(8, extraForums);
    state.systems[0].charter.level = 2;
    const before = getOrderCapacity(state);
    assert.equal(before.uncapped, 19 + extraForums);
    const option = getBuildOptions(state, 's0', 'player', 'forum').find(option => option.id === 'mine');
    assert.deepEqual(option.orderEffect, { current: 18, projected: expected, nominal: -3, change: expected - 18, limit: 18 });
    assert.equal(command(state, { type: 'build', systemId: 's0', itemId: 'mine', replaceBuildingId: 'forum' }).ok, true);
    assert.equal(getEmpireStats(state).maxOrders, 18, 'the old charter remains active during construction');
    state.systems[0].queue.progress = state.systems[0].queue.work - 1;
    endTurn(state);
    assert.equal(state.factions[0].orders, expected);
    assert.equal(state.systems[0].charter, undefined);
    assert.equal(validateSave(state), true);
  }
});

test('switching from Civic II can consume excess capacity without reducing the current mandate', () => {
  const state = fixture(8, 2);
  state.systems[0].charter.level = 2;
  const option = getDevelopmentOptions(state, 's0').find(option => option.charterType === 'academy');
  assert.deepEqual(option.orderEffect, { current: 18, projected: 18, nominal: -2, change: 0, limit: 18 });
  assert.equal(command(state, { type: 'develop', systemId: 's0', charterType: 'academy' }).ok, true);
  state.systems[0].queue.progress = state.systems[0].queue.work - 1;
  endTurn(state);
  assert.equal(state.factions[0].orders, 18);
  assert.equal(getEmpireStats(state).uncappedOrders, 19);
});

test('order forecasts use the selected empire and remain pure', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.equal(getOrderChange(state, 'veyr', 1).current, 5);
  assert.equal(getOrderChange(state, 'veyr', 1).projected, 6);
  assert.equal(getOrderChange(state, 'player', 1).change, 0);
  assert.equal(JSON.stringify(state), before);
});
