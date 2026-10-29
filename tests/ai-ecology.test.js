import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getEmpireStats, validateSave } from '../src/game.js';
import { getEarlyEcologyPlan, runAI } from '../src/ai.js';
import { SHIPS } from '../src/content.js';

const empire = state => state.factions.find(faction => faction.id === 'choir');
const world = (state, id) => state.systems.find(system => system.id === id);

function frontier(state, id, habitability, surveyed = true) {
  const system = world(state, id);
  Object.assign(system, { owner: null, population: 0, habitability });
  if (!system.knownBy.includes('choir')) system.knownBy.push('choir');
  if (surveyed && !system.exploredBy.includes('choir')) system.exploredBy.push('choir');
  return system;
}

function fixture({ queued = false } = {}) {
  const state = createGame('ECOLOGY-OPPORTUNITY');
  state.turn = 8;
  state.lanes = [['s3', 's4']];
  for (const system of state.systems) {
    system.anomaly = null;
    system.knownBy = system.knownBy.filter(id => id !== 'choir');
    system.exploredBy = system.exploredBy.filter(id => id !== 'choir');
  }
  const faction = empire(state), home = world(state, 's3');
  Object.assign(faction, { credits: 75, minerals: 75, science: 0, techs: ['physics'], research: null, contacts: [] });
  Object.assign(home, { population: 6, habitability: 90, buildings: ['mine', 'shipyard', 'lab'], queue: null, knownBy: ['choir'], exploredBy: ['choir'] });
  faction.orders = getEmpireStats(state, 'choir').maxOrders;
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'choir' || fleet.type === 'scout' || !queued && fleet.type === 'colony');
  for (const fleet of state.fleets.filter(fleet => fleet.owner === 'choir')) if (fleet.type === 'scout') fleet.movesLeft = 0;
  frontier(state, 's4', 40);
  if (queued) assert.equal(command(state, { type: 'build', factionId: 'choir', systemId: 's3', itemId: 'colony' }).ok, true);
  assert.equal(validateSave(state), true);
  return state;
}

function farOrdinaryWorld(state) {
  state.lanes.push(['s3', 's5'], ['s5', 's6'], ['s6', 's7']);
  frontier(state, 's5', 10, false);
  frontier(state, 's6', 10, false);
  frontier(state, 's7', 85);
}

function chosenResearch(state) {
  empire(state).orders = 0; // Isolate the ordinary, free research assignment.
  runAI(state, empire(state));
  return empire(state).research?.techId;
}

test('a paid Ark and a surveyed harsh frontier produce a normally funded settlement after Ecology', () => {
  const state = fixture({ queued: true }), faction = empire(state);
  assert.equal(faction.credits, 30, 'the Ark already cost its ordinary 45 credits');
  assert.equal(faction.minerals, 20, 'the Ark already cost its ordinary 55 minerals');
  assert.equal(faction.orders, 4, 'commissioning used one ordinary order');
  const before = structuredClone(state), plan = getEarlyEcologyPlan(state, 'choir');
  assert.deepEqual(state, before, 'the opportunity query is read-only, including RNG and budgets');
  assert.equal(plan.systemId, 's4');
  assert.equal(plan.shipyardId, 's3');
  assert.equal(plan.researchCycles, 4);
  assert.equal(plan.readyCycles, 4);
  assert.equal(plan.ordinaryAlternative, null);
  runAI(state, faction);
  assert.deepEqual(faction.research, { techId: 'ecology', progress: 0 });
  assert.equal(faction.credits, 30);
  assert.equal(faction.minerals, 20);
  assert.equal(faction.orders, 4, 'research selection does not grant or consume orders');
  let scienceProduced = 0;
  for (let cycle = 0; cycle < 4; cycle++) {
    scienceProduced += getEmpireStats(state, 'choir').scienceIncome;
    endTurn(state);
    assert.equal(validateSave(state), true);
  }
  assert.ok(faction.techs.includes('ecology'));
  assert.equal(scienceProduced - faction.science, 60, 'Ecology consumes its full normal science cost');
  assert.equal(world(state, 's3').queue, null, 'the Ark required four production cycles');
  const ark = state.fleets.find(fleet => fleet.owner === 'choir' && fleet.type === 'colony');
  assert.ok(ark);
  const credits = faction.credits, minerals = faction.minerals, rng = state.rng;
  faction.orders = 2;
  runAI(state, faction);
  assert.equal(world(state, 's4').owner, 'choir');
  assert.equal(faction.credits, credits - 30);
  assert.equal(faction.minerals, minerals - 20);
  assert.equal(faction.orders, 0, 'one jump and founding use two normal orders');
  assert.equal(state.fleets.some(fleet => fleet.id === ark.id), false, 'founding consumes the Ark');
  assert.equal(state.rng, rng, 'the research and peaceful settlement add no random draw');
  assert.equal(validateSave(state), true);
});

test('a queued Ark can favor a shorter harsh route only when research is ready before launch', () => {
  const ready = fixture({ queued: true });
  farOrdinaryWorld(ready);
  const plan = getEarlyEcologyPlan(ready, 'choir');
  assert.equal(plan.systemId, 's4');
  assert.deepEqual(plan.ordinaryAlternative, { systemId: 's7', jumps: 3 });
  assert.equal(chosenResearch(ready), 'ecology');

  const delayed = fixture({ queued: true });
  farOrdinaryWorld(delayed);
  world(delayed, 's3').buildings = ['mine', 'shipyard'];
  assert.equal(getEarlyEcologyPlan(delayed, 'choir'), null);
  assert.equal(chosenResearch(delayed), 'logistics', 'the Ark can depart for its ordinary world before Ecology would finish');
});

test('an equally reachable ordinary world preserves the faction research order', () => {
  const state = fixture({ queued: true });
  state.lanes.push(['s3', 's5']);
  frontier(state, 's5', 75);
  assert.equal(getEarlyEcologyPlan(state, 'choir'), null);
  assert.equal(chosenResearch(state), 'logistics');
});

test('growth that launches an Ark before Ecology completes preserves its ordinary expansion plan', () => {
  const state = fixture({ queued: true });
  farOrdinaryWorld(state);
  const home = world(state, 's3');
  home.population = 4; home.growth = .8; home.queue.progress = 13;
  empire(state).science = 20;
  const forced = structuredClone(state);
  assert.equal(command(forced, { type: 'research', factionId: 'choir', techId: 'ecology' }).ok, true);
  for (let cycle = 0; cycle < 3; cycle++) endTurn(forced);
  assert.ok(forced.fleets.some(fleet => fleet.owner === 'choir' && fleet.type === 'colony'));
  assert.deepEqual(empire(forced).research, { techId: 'ecology', progress: 59 }, 'the Ark really launches before the required research finishes');
  assert.equal(getEarlyEcologyPlan(state, 'choir'), null);
  assert.equal(chosenResearch(state), 'logistics');
});

test('uncharted, unsurveyed, too harsh, and distant worlds cannot redirect research', () => {
  const cases = [
    state => { world(state, 's4').knownBy = []; },
    state => { world(state, 's4').exploredBy = []; },
    state => { world(state, 's4').habitability = 29; },
    state => {
      state.lanes = [['s3', 's5'], ['s5', 's6'], ['s6', 's7'], ['s7', 's4']];
      for (const id of ['s5', 's6', 's7']) frontier(state, id, 10, false);
    },
  ];
  for (const change of cases) {
    const state = fixture({ queued: true });
    change(state);
    assert.equal(getEarlyEcologyPlan(state, 'choir'), null);
    assert.equal(chosenResearch(state), 'logistics');
  }
});

test('closed or soon-closing foreign transit is not an achievable settlement plan', () => {
  for (const tradeEndsAt of [null, 10]) {
    const state = fixture({ queued: true }), faction = empire(state);
    state.lanes = [['s3', 's5'], ['s5', 's4']];
    const transit = frontier(state, 's5', 85, false);
    transit.owner = 'veyr'; transit.population = 1;
    faction.relations.veyr.trade = tradeEndsAt !== null;
    faction.relations.veyr.tradeEndsAt = tradeEndsAt || 0;
    assert.equal(getEarlyEcologyPlan(state, 'choir'), null);
    assert.equal(chosenResearch(state), 'logistics');
  }
});

test('missing Ark, unfunded founding, and late development preserve the base priority', () => {
  const cases = [
    state => { state.fleets = state.fleets.filter(fleet => fleet.owner !== 'choir' || fleet.type !== 'colony'); },
    state => { empire(state).credits = 29; },
    state => { empire(state).minerals = 19; },
    state => { state.turn = 31; },
  ];
  for (const change of cases) {
    const state = fixture();
    change(state);
    assert.equal(getEarlyEcologyPlan(state, 'choir'), null);
    assert.equal(chosenResearch(state), 'logistics');
  }
});

test('first technology, an active project, and wartime defense retain their priorities', () => {
  const opening = fixture();
  empire(opening).techs = [];
  assert.equal(chosenResearch(opening), 'physics', 'the Choir retains its foundational research identity');

  const ongoing = fixture();
  empire(ongoing).research = { techId: 'logistics', progress: 20 };
  assert.equal(chosenResearch(ongoing), 'logistics');
  assert.equal(empire(ongoing).research.progress, 20, 'ongoing research is never switched or refunded');

  const wartime = fixture(), faction = empire(wartime);
  faction.relations.player.status = 'war';
  wartime.fleets.push({ id: `f${wartime.nextFleetId++}`, name: 'Observed threat', owner: 'player', systemId: 's3', type: 'frigate', ships: 4, hp: SHIPS.frigate.hp * 4, movesLeft: 1 });
  assert.equal(getEarlyEcologyPlan(wartime, 'choir'), null);
  assert.equal(chosenResearch(wartime), 'logistics');
});

test('an observed wartime threat preserves Khar weapons research over a qualifying expansion', () => {
  const state = createGame('ECOLOGY-KHAR-DEFENSE'), faction = state.factions.find(other => other.id === 'khar');
  state.turn = 8;
  state.lanes = [['s2', 's4']];
  faction.techs = ['logistics']; faction.research = null; faction.science = 0;
  for (const system of state.systems) {
    system.knownBy = system.knownBy.filter(id => id !== 'khar');
    system.exploredBy = system.exploredBy.filter(id => id !== 'khar');
  }
  const home = world(state, 's2'), target = world(state, 's4');
  Object.assign(home, { population: 6, buildings: ['mine', 'shipyard', 'lab'], knownBy: ['khar'], exploredBy: ['khar'] });
  Object.assign(target, { habitability: 40, knownBy: ['khar'], exploredBy: ['khar'] });
  assert.equal(getEarlyEcologyPlan(state, 'khar').systemId, 's4');
  faction.relations.player.status = 'war';
  state.fleets.push({ id: `f${state.nextFleetId++}`, name: 'Observed threat', owner: 'player', systemId: 's2', type: 'frigate', ships: 4, hp: SHIPS.frigate.hp * 4, movesLeft: 1 });
  assert.equal(getEarlyEcologyPlan(state, 'khar'), null);
  faction.orders = 0;
  runAI(state, faction);
  assert.equal(faction.research.techId, 'weapons');
});

test('unseen planets and foreign fleets do not affect the opportunity or selected research', () => {
  const original = fixture({ queued: true }), changed = structuredClone(original);
  for (const state of [original, changed]) frontier(state, 's5', 20, false);
  world(changed, 's5').habitability = 95;
  world(changed, 's5').richness = 5;
  world(changed, 's5').science = 4;
  const hidden = changed.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate');
  Object.assign(hidden, { systemId: 's4', ships: 12, hp: SHIPS.frigate.hp * 12 });
  assert.deepEqual(getEarlyEcologyPlan(original, 'choir'), getEarlyEcologyPlan(changed, 'choir'));
  assert.equal(chosenResearch(original), 'ecology');
  assert.equal(chosenResearch(changed), 'ecology');
  assert.equal(original.rng, changed.rng);

  const guarded = fixture({ queued: true });
  frontier(guarded, 's5', 20, false);
  for (const id of ['s5', 's6']) for (const property of ['habitability', 'richness', 'science', 'buildings', 'population']) {
    Object.defineProperty(world(guarded, id), property, { get() { throw new Error(`Unobserved ${id}.${property}`); } });
  }
  assert.equal(getEarlyEcologyPlan(guarded, 'choir').systemId, 's4', 'unknown and unsurveyed native values are never inspected');
});
