import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getSystemYield, getInfrastructure, validateSave } from '../src/game.js';
import { getDiscoveryOptions, observeDiscovery } from '../src/discoveries.js';
import { runAI } from '../src/ai.js';
import { TECHS } from '../src/content.js';

// Synthetic boundary fixtures, not historical campaign exports.
function fixture(id = 'pilgrims') {
  const state = createGame('discovery-effects');
  const faction = state.factions.find(candidate => candidate.id === 'player');
  const system = state.systems.find(candidate => candidate.id === faction.capitalId);
  system.anomaly = { id, resolved: false };
  return { state, faction, system };
}

const option = ({ state, system }, id) => getDiscoveryOptions(state, system.id).find(choice => choice.id === id);
const choose = ({ state, system }, choiceId) => command(state, { type: 'anomaly', systemId: system.id, choiceId });

test('refugee previews match uncapped arrival below, at and above growth capacity', () => {
  for (const population of [7, 8, 9]) {
    const scenario = fixture(), { state, faction, system } = scenario;
    system.population = population; system.growth = .7;
    const before = structuredClone(state), preview = option(scenario, 'welcome').effectsPreview.population;
    assert.deepEqual(state, before, 'reading a choice is pure');
    assert.equal(preview.capacity, 8);
    assert.equal(preview.before, population);
    assert.equal(preview.after, population + 1);
    assert.equal(preview.amount, 1);
    assert.equal(preview.overCapacity, population >= 8);
    assert.equal(preview.systemId, system.id);
    assert.equal(preview.systemName, system.name);
    assert.equal(choose(scenario, 'welcome').ok, true);
    assert.equal(system.population, preview.after);
    assert.equal(system.anomaly.history[0].effects.population.amount, preview.amount);
    assert.equal(faction.credits, before.factions[0].credits - 20);
    assert.equal(faction.orders, before.factions[0].orders - 1);
    assert.equal(validateSave(state), true);
    if (population === 8) {
      assert.equal(getInfrastructure(state, system).capacity, 5);
      assert.equal(getSystemYield(state, system).production, getSystemYield(before, before.systems[0]).production + 1);
    }
    const reload = JSON.parse(JSON.stringify(state));
    endTurn(state); endTurn(reload);
    assert.deepEqual(state, reload);
    assert.equal(system.population, preview.after);
    assert.equal(system.growth, 0);
    assert.equal(validateSave(state), true);
  }
});

test('refugee growth capacity follows the shared colony yield including Habitation Domes', () => {
  const scenario = fixture(), { state, system } = scenario;
  system.buildings.push('habitat'); system.population = 12;
  const preview = option(scenario, 'welcome').effectsPreview.population;
  assert.equal(preview.capacity, getSystemYield(state, system).capacity);
  assert.equal(preview.capacity, 12);
  assert.equal(preview.after, 13);
  assert.equal(preview.overCapacity, true);
  assert.equal(choose(scenario, 'welcome').ok, true);
  assert.equal(system.population, 13);
});

function withoutCapital() {
  const scenario = fixture(), { state, system } = scenario;
  system.owner = null; system.population = 0; system.buildings = []; system.growth = 0;
  // The remaining Ark keeps this no-colony empire alive. The local scout can
  // investigate; neither civilian has remaining movement this cycle.
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'player' || fleet.type !== 'frigate');
  for (const fleet of state.fleets.filter(candidate => candidate.owner === 'player')) {
    fleet.movesLeft = 0;
    if (fleet.type === 'colony') fleet.systemId = 's1';
  }
  return scenario;
}

test('an unavailable capital previews zero without changing legal choice or fee', () => {
  const scenario = withoutCapital(), { state, faction, system } = scenario;
  const choice = option(scenario, 'welcome');
  assert.equal(validateSave(state), true);
  assert.equal(choice.enabled, true);
  assert.deepEqual(choice.effectsPreview.population, { amount: 0, systemId: null, systemName: null, before: null, after: null, capacity: null, overCapacity: false });
  const credits = faction.credits, orders = faction.orders;
  assert.equal(choose(scenario, 'welcome').ok, true);
  assert.equal(faction.credits, credits - 20);
  assert.equal(faction.orders, orders - 1);
  assert.equal(system.anomaly.history[0].effects.population.amount, 0);
  assert.equal(validateSave(state), true);
});

test('an unavailable refugee recipient exposes no foreign population or capacity', () => {
  const scenario = fixture(), { state, faction, system } = scenario;
  faction.capitalId = 's1';
  const before = option(scenario, 'welcome').effectsPreview;
  const foreign = state.systems.find(candidate => candidate.id === 's1');
  foreign.population = 27; foreign.habitability = 10; foreign.buildings.push('habitat');
  assert.deepEqual(option(scenario, 'welcome').effectsPreview, before);
  assert.equal(before.population.systemId, null);
  assert.equal(before.population.amount, 0);
  assert.equal(system.owner, 'player');
});

test('Garden previews actual habitability at the cap and agrees with command history', () => {
  for (const habitability of [75, 95, 100]) {
    const scenario = fixture('garden'), { state, system, faction } = scenario;
    system.habitability = habitability;
    const before = structuredClone(state), choice = option(scenario, 'preserve');
    assert.deepEqual(state, before);
    assert.equal(choice.enabled, true);
    assert.deepEqual(choice.effectsPreview.habitability, { before: habitability, after: 100, amount: 100 - habitability });
    assert.equal(choose(scenario, 'preserve').ok, true);
    assert.equal(system.habitability, choice.effectsPreview.habitability.after);
    assert.equal(system.anomaly.history[0].effects.habitability, choice.effectsPreview.habitability.amount);
    assert.equal(faction.science, 20);
    assert.equal(faction.orders, before.factions[0].orders - 1);
    assert.equal(validateSave(state), true);
  }
});

test('remembered discovery options reveal no later remote effect data', () => {
  for (const id of ['garden', 'pilgrims']) {
    const scenario = fixture(id), { state, system } = scenario;
    observeDiscovery(state, system.id, 'player');
    system.owner = 'veyr';
    for (const fleet of state.fleets.filter(candidate => candidate.owner === 'player')) fleet.systemId = 's4';
    const before = getDiscoveryOptions(state, system.id);
    assert.ok(before.length);
    assert.ok(before.every(choice => choice.effectsPreview === null && !choice.enabled));
    system.population = 19; system.habitability = 100; system.buildings.push('habitat');
    assert.deepEqual(getDiscoveryOptions(state, system.id), before);
  }
});

test('effect previews add no hidden chart targets and preserve atomic cost and order gates', () => {
  const echo = fixture('echo'), before = structuredClone(echo.state);
  assert.deepEqual(option(echo, 'reach').effectsPreview, {});
  assert.deepEqual(echo.state, before);
  for (const field of ['credits', 'orders']) {
    const scenario = fixture(); scenario.faction[field] = 0;
    const snapshot = structuredClone(scenario.state);
    assert.equal(option(scenario, 'welcome').enabled, false);
    assert.equal(choose(scenario, 'welcome').ok, false);
    assert.deepEqual(scenario.state, snapshot);
  }
});

test('AI does not value nonexistent refugee population when its Ark survives the capital', () => {
  const scenario = withoutCapital(), { state, faction, system } = scenario;
  faction.techs = Object.keys(TECHS); faction.credits = 1000; faction.minerals = 1000;
  runAI(state, faction);
  assert.equal(system.anomaly.history[0].choiceId, 'supplies');
  assert.deepEqual(system.anomaly.history[0].effects.gained, { science: 25, credits: 15 });
  assert.equal(validateSave(state), true);
});

test('AI retains the existing refugee preference at a full owned capital', () => {
  const scenario = fixture(), { state, faction, system } = scenario;
  system.population = 8;
  faction.techs = Object.keys(TECHS); faction.credits = 1000; faction.minerals = 1000;
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'player' || fleet.type !== 'frigate');
  for (const fleet of state.fleets.filter(candidate => candidate.owner === 'player')) {
    fleet.movesLeft = 0;
    if (fleet.type === 'colony') fleet.systemId = 's1';
  }
  runAI(state, faction);
  assert.equal(system.anomaly.history[0].choiceId, 'welcome');
  assert.equal(system.population, 9);
  assert.equal(validateSave(state), true);
});
