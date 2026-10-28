import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { SHIPS, TECHS } from '../src/content.js';
import { hasSensors } from '../src/intelligence.js';

const empire = (state, id = 'veyr') => state.factions.find(faction => faction.id === id);
const world = (state, id) => state.systems.find(system => system.id === id);
const ownFleets = state => state.fleets.filter(fleet => fleet.owner === 'veyr');
const leads = state => ownFleets(state).filter(fleet => fleet.defenseLead);

function fixture(orders = 10, seed = 'DEFENSE-ASSIGNMENT') {
  const state = createGame(seed), faction = empire(state);
  state.turn = 40; state.fleets = []; state.lanes = [];
  for (const system of state.systems) { system.anomaly = null; system.queue = null; }
  for (const other of state.factions) {
    Object.assign(other, { credits: 0, minerals: 0, science: 0, orders: 0, contacts: [] });
    for (const relation of Object.values(other.relations)) Object.assign(relation, { status: 'peace', trade: false, trust: 0, treatyTurn: 0 });
  }
  faction.orders = orders; faction.techs = Object.keys(TECHS); faction.research = null;
  return { state, faction };
}

function fleet(state, systemId = 's1', type = 'frigate', ships = 1, hp = SHIPS[type].hp * ships, owner = 'veyr') {
  const result = { id: `f${state.nextFleetId++}`, owner, systemId, type, ships, hp, movesLeft: 0, name: 'Defense assignment test' };
  state.fleets.push(result);
  const system = world(state, systemId);
  if (!system.knownBy.includes(owner)) system.knownBy.push(owner);
  if (!system.exploredBy.includes(owner)) system.exploredBy.push(owner);
  return result;
}

function group(state, systemId = 's1', civilian = 'scout') {
  Object.assign(world(state, systemId), { owner: 'veyr', population: 6 });
  const first = fleet(state, systemId, civilian);
  const defender = fleet(state, systemId);
  return { first, defender };
}

function declareWar(state, otherId = 'khar') {
  for (const [first, second] of [['veyr', otherId], [otherId, 'veyr']]) {
    const faction = empire(state, first);
    faction.contacts.push(second);
    Object.assign(faction.relations[second], { status: 'war', trade: false, treatyTurn: state.turn, trust: -80 });
  }
}

test('one remaining order buys a lead without consuming resources, movement or RNG', () => {
  const { state, faction } = fixture(1), { defender } = group(state);
  const before = { fleets: structuredClone(state.fleets), rng: state.rng, resources: state.factions.map(({ credits, minerals, science, orders }) => ({ credits, minerals, science, orders })) };
  assert.equal(validateSave(state), true);
  runAI(state, faction);
  assert.deepEqual(leads(state).map(fleet => fleet.id), [defender.id]);
  assert.equal(faction.orders, 0);
  assert.equal(state.rng, before.rng);
  assert.deepEqual(state.fleets.map(({ defenseLead, ...fleet }) => fleet), before.fleets);
  assert.deepEqual(state.factions.map(({ credits, minerals, science, orders }, index) => ({ credits, minerals, science, orders: index === state.factions.indexOf(faction) ? orders + 1 : orders })), before.resources);
  assert.equal(validateSave(state), true);
});

test('zero remaining orders cannot assign, and naturally first military defenders need no payment', () => {
  const exhausted = fixture(0); group(exhausted.state);
  runAI(exhausted.state, exhausted.faction);
  assert.equal(leads(exhausted.state).length, 0);
  assert.equal(exhausted.faction.orders, 0);
  const natural = fixture(3);
  fleet(natural.state); fleet(natural.state, 's1', 'colony');
  runAI(natural.state, natural.faction);
  assert.equal(leads(natural.state).length, 0);
  assert.equal(natural.faction.orders, 3);
});

test('colonization retains the last order before optional defense preparation', () => {
  const { state, faction } = fixture(1), { defender } = group(state);
  Object.assign(faction, { credits: 30, minerals: 20 });
  faction.techs = faction.techs.filter(id => id !== 'singularity');
  const ark = fleet(state, 's4', 'colony');
  assert.equal(world(state, 's4').owner, null);
  runAI(state, faction);
  assert.equal(world(state, 's4').owner, faction.id, 'the ordinary colonization retained the last order');
  assert.equal(state.fleets.some(fleet => fleet.id === ark.id), false);
  assert.equal(defender.defenseLead, undefined);
  assert.equal(faction.orders, 0);
  assert.equal(faction.credits, 0); assert.equal(faction.minerals, 0);
  assert.equal(validateSave(state), true);
});

test('earlier military combat and economic construction keep priority over the final assignment', () => {
  const military = fixture(1), { defender } = group(military.state);
  defender.movesLeft = 1;
  declareWar(military.state);
  const opponent = fleet(military.state, 's1', 'scout', 1, 18, 'khar');
  runAI(military.state, military.faction);
  assert.equal(military.state.fleets.some(fleet => fleet.id === opponent.id), false, 'the ready frigate attacked through the ordinary military phase');
  assert.equal(defender.movesLeft, 0);
  assert.equal(defender.defenseLead, undefined);
  assert.equal(military.faction.orders, 0);

  const economic = fixture(1), preparation = group(economic.state);
  Object.assign(economic.faction, { credits: 100, minerals: 100 });
  economic.faction.techs = economic.faction.techs.filter(id => id !== 'singularity');
  runAI(economic.state, economic.faction);
  assert.ok(world(economic.state, 's1').queue, 'an affordable existing construction priority used the order');
  assert.equal(preparation.defender.defenseLead, undefined);
  assert.equal(economic.faction.orders, 0);
  assert.equal(validateSave(economic.state), true);
});

test('assignment uses final co-location after an Ark is consumed, not a pre-turn candidate list', () => {
  const { state, faction } = fixture(3), ordinary = group(state);
  Object.assign(faction, { credits: 30, minerals: 20 });
  faction.techs = faction.techs.filter(id => id !== 'singularity');
  const ark = fleet(state, 's4', 'colony'), aloneAfterSettlement = fleet(state, 's4');
  runAI(state, faction);
  assert.equal(state.fleets.some(fleet => fleet.id === ark.id), false);
  assert.equal(aloneAfterSettlement.defenseLead, undefined);
  assert.deepEqual(leads(state).map(fleet => fleet.id), [ordinary.defender.id]);
  assert.equal(faction.orders, 1, 'one colony order followed by one assignment');
});

test('only one assignment is made, prioritizing a locally observed war threat above Ark protection', () => {
  const { state, faction } = fixture(), ordinary = group(state), ark = group(state, 's4', 'colony'), threatened = group(state, 's5');
  declareWar(state);
  fleet(state, 's5', 'frigate', 1, 34, 'khar');
  runAI(state, faction);
  assert.deepEqual(leads(state).map(fleet => fleet.id), [threatened.defender.id]);
  assert.equal(ordinary.defender.defenseLead, undefined); assert.equal(ark.defender.defenseLead, undefined);
  assert.equal(faction.orders, 9);
});

test('Ark protection outranks other mixed formations without a local war threat', () => {
  const { state, faction } = fixture(), ordinary = group(state), ark = group(state, 's4', 'colony');
  runAI(state, faction);
  assert.deepEqual(leads(state).map(fleet => fleet.id), [ark.defender.id]);
  assert.equal(ordinary.defender.defenseLead, undefined);
  assert.equal(faction.orders, 9);
});

test('observed hostile sovereignty is a local threat, but a peaceful visiting fleet is not', () => {
  for (const hostileColony of [false, true]) {
    const { state, faction } = fixture(), ark = group(state, 's4', 'colony'), occupied = group(state, 's5');
    if (hostileColony) {
      world(state, 's5').owner = 'khar';
      declareWar(state);
    } else fleet(state, 's5', 'cruiser', 12, 1020, 'khar');
    runAI(state, faction);
    assert.deepEqual(leads(state).map(fleet => fleet.id), [(hostileColony ? occupied : ark).defender.id]);
    assert.equal(faction.orders, 9);
    assert.equal(validateSave(state), true);
  }
});

test('existing lead survives better reinforcements and routine damage without repeated assignment costs', () => {
  const { state, faction } = fixture(), { defender } = group(state);
  defender.defenseLead = true; defender.hp = 1;
  const reinforcement = fleet(state, 's1', 'cruiser');
  runAI(state, faction);
  assert.deepEqual(leads(state).map(fleet => fleet.id), [defender.id]);
  assert.equal(reinforcement.defenseLead, undefined);
  assert.equal(faction.orders, 10);
  assert.equal(validateSave(state), true);
});

test('candidate hull outranks nominal firepower, then strength and stable fleet ID break ties', () => {
  const damaged = fixture(1); fleet(damaged.state, 's1', 'scout');
  fleet(damaged.state, 's1', 'frigate', 12, .1);
  const cruiser = fleet(damaged.state, 's1', 'cruiser');
  runAI(damaged.state, damaged.faction);
  assert.deepEqual(leads(damaged.state).map(fleet => fleet.id), [cruiser.id]);

  const tiedHull = fixture(1); fleet(tiedHull.state, 's1', 'scout');
  fleet(tiedHull.state, 's1', 'cruiser');
  const stronger = fleet(tiedHull.state, 's1', 'frigate', 7, 85);
  runAI(tiedHull.state, tiedHull.faction);
  assert.deepEqual(leads(tiedHull.state).map(fleet => fleet.id), [stronger.id]);

  const tiedStrength = fixture(1); fleet(tiedStrength.state, 's1', 'scout');
  const one = fleet(tiedStrength.state, 's1', 'frigate', 7, 85), two = fleet(tiedStrength.state, 's1', 'frigate', 7, 85);
  const expected = [one, two].sort((a, b) => a.id.localeCompare(b.id))[0];
  tiedStrength.state.fleets = [tiedStrength.state.fleets[0], two, one];
  runAI(tiedStrength.state, tiedStrength.faction);
  assert.deepEqual(leads(tiedStrength.state).map(fleet => fleet.id), [expected.id]);
});

test('hidden rival fleets cannot change which local formation receives the remaining order', () => {
  const { state, faction } = fixture(); group(state); group(state, 's4', 'colony');
  declareWar(state);
  const hidden = fleet(state, 's9', 'frigate', 1, 34, 'khar');
  assert.equal(hasSensors(state, faction.id, hidden.systemId), false);
  const perturbed = structuredClone(state), changed = perturbed.fleets.find(fleet => fleet.id === hidden.id);
  Object.assign(changed, { type: 'cruiser', ships: 12, hp: 1020, systemId: 's10', name: 'Unseen reinforcement', defenseLead: true });
  assert.equal(hasSensors(perturbed, faction.id, changed.systemId), false);
  runAI(state, faction); runAI(perturbed, empire(perturbed));
  assert.deepEqual(ownFleets(state), ownFleets(perturbed));
  assert.deepEqual(faction, empire(perturbed));
  assert.equal(state.rng, perturbed.rng);
  assert.equal(validateSave(perturbed), true);
});

test('identical seeds and JSON reloads preserve the exact assignment and next AI result', () => {
  for (const seed of ['DEFENSE-REPEAT-A', 'DEFENSE-REPEAT-B', 'DEFENSE-REPEAT-C']) {
    const { state, faction } = fixture(10, seed); group(state); group(state, 's4', 'colony');
    const replay = JSON.parse(JSON.stringify(state));
    runAI(state, faction); runAI(replay, empire(replay));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), replay);
    const reloaded = JSON.parse(JSON.stringify(state));
    runAI(state, faction); runAI(reloaded, empire(reloaded));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), reloaded);
    assert.equal(validateSave(reloaded), true);
  }
});
