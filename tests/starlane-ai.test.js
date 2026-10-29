import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getEmpireStats, getSystemYield, validateSave } from '../src/game.js';
import { getStarlanePlan, runAI } from '../src/ai.js';
import { SHIPS, TECHS } from '../src/content.js';

const world = (state, id) => state.systems.find(system => system.id === id);
const actor = state => state.factions.find(faction => faction.id === 'choir');
const clone = value => structuredClone(value);
function ship(state, owner, systemId, type, ships = 1) {
  const fleet = { id: `f${state.nextFleetId++}`, owner, systemId, type, ships, hp: SHIPS[type].hp * ships, movesLeft: 0, name: 'Controlled route fixture' };
  state.fleets.push(fleet); return fleet;
}

// Controlled geography and a mature paid colony establish the decision.
// Commissioning, work, hull release, movement and settlement use real commands.
function fixture({ queued = true } = {}) {
  const state = createGame('STARLANE-AI-ROUTES'); state.turn = 20; state.fleets = [];
  const faction = actor(state);
  for (const other of state.factions) {
    Object.assign(other, { credits: 0, minerals: 0, science: 0, orders: 0, contacts: [], research: null });
    for (const relation of Object.values(other.relations)) Object.assign(relation, { status: 'peace', trade: false, trust: 0, treatyTurn: state.turn });
  }
  Object.assign(faction, { credits: 1000, minerals: 1000, orders: 12, techs: Object.keys(TECHS).filter(id => !['singularity', 'terraforming'].includes(id)) });
  for (const system of state.systems) {
    Object.assign(system, { anomaly: null, queue: null, charter: null, buildings: [], knownBy: system.owner ? [system.owner] : [], exploredBy: system.owner ? [system.owner] : [] });
    if (!system.originalOwner) Object.assign(system, { owner: null, population: 0, habitability: 10 });
  }
  const path = ['s3', 's5', 's6', 's4', 's7', 's8', 's9', 's10', 's11', 's12', 's13'];
  state.lanes = path.slice(1).map((id, index) => [path[index], id]);
  state.ancientLanes = [{ id: 'l0', endpoints: ['s4', 's12'], openedTurn: null, openedBy: null }];
  for (const id of path) { world(state, id).knownBy = ['choir']; world(state, id).exploredBy = ['choir']; }
  const source = world(state, 's4'), home = world(state, 's3');
  Object.assign(home, { owner: 'choir', population: 12, growth: 0, habitability: 90, richness: 4, buildings: ['mine', 'shipyard', 'market', 'habitat'] });
  Object.assign(source, { owner: 'choir', population: 12, growth: 0, habitability: 90, richness: 4, buildings: ['factory', 'mine', 'shipyard', 'market', 'habitat'], charter: { type: 'forge', level: 2 } });
  world(state, 's13').habitability = 85;
  // Put the military defender first so no optional defense-order command
  // obscures the restoration's exact one-order payment.
  const navy = ship(state, 'choir', 's3', 'cruiser', 3), scout = ship(state, 'choir', 's3', 'scout');
  let ark = null;
  if (queued) assert.equal(command(state, { type: 'build', factionId: 'choir', systemId: home.id, itemId: 'colony' }).ok, true);
  else ark = ship(state, 'choir', 's3', 'colony');
  assert.equal(validateSave(state), true);
  return { state, faction, source, home, navy, scout, ark };
}

test('a pure plan values a paid Ark at its real launch time and survives reload', () => {
  const { state, home, source } = fixture(), before = clone(state);
  const plan = getStarlanePlan(state, 'choir');
  assert.deepEqual(state, before);
  assert.deepEqual(getStarlanePlan(JSON.parse(JSON.stringify(state)), 'choir'), plan);
  assert.equal(plan.systemId, source.id); assert.equal(plan.turns, 2);
  assert.deepEqual(plan.cost, { credits: 60, minerals: 70 });
  assert.equal(plan.totalJumpsSaved, 5);
  assert.deepEqual(plan.benefits.map(benefit => [benefit.fleetId, benefit.shipyardId, benefit.readyCycles, benefit.projectedSystemId]), [[null, home.id, 3, home.id]]);
  assert.deepEqual(plan.benefits[0].afterPath, ['s3', 's5', 's6', 's4', 's12', 's13']);
});

test('runAI commissions, pays, completes normally, and its paid Ark uses the ordinary new edge', () => {
  const { state, faction, source } = fixture();
  const before = { credits: faction.credits, minerals: faction.minerals, orders: faction.orders, rng: state.rng };
  runAI(state, faction);
  assert.deepEqual(source.queue, { itemId: 'starlane', kind: 'starlane', laneId: 'l0', progress: 0, work: 48, cost: { credits: 60, minerals: 70 } });
  assert.equal(faction.credits, before.credits - 60); assert.equal(faction.minerals, before.minerals - 70);
  assert.equal(faction.orders, before.orders - 1); assert.equal(state.rng, before.rng);
  assert.equal(getSystemYield(state, source).production, 36);
  endTurn(state); assert.equal(source.queue.progress, 36); assert.equal(state.ancientLanes[0].openedTurn, null);
  endTurn(state); assert.equal(source.queue, null); assert.equal(state.ancientLanes[0].openedTurn, 22);
  assert.equal(state.lanes.filter(edge => edge.includes('s4') && edge.includes('s12')).length, 1);
  let previous = null, crossed = false;
  for (let cycle = 0; cycle < 10 && world(state, 's13').owner !== 'choir'; cycle++) {
    endTurn(state);
    const ark = state.fleets.find(fleet => fleet.owner === 'choir' && fleet.type === 'colony');
    if (previous === 's4' && ark?.systemId === 's12') crossed = true;
    previous = ark?.systemId || null;
    assert.equal(validateSave(state), true);
  }
  assert.equal(crossed, true); assert.equal(world(state, 's13').owner, 'choir');
});

test('construction delay removes a benefit after an existing Ark passes the useful junction', () => {
  const { state, source, ark } = fixture({ queued: false });
  ark.systemId = 's6'; source.population = 4; source.buildings = ['mine', 'shipyard']; source.charter = null;
  assert.equal(Math.ceil(48 / getSystemYield(state, source).production), 6);
  assert.equal(getStarlanePlan(state, 'choir'), null);
  source.population = 12; source.buildings.push('factory'); source.charter = { type: 'forge', level: 2 };
  assert.ok(getStarlanePlan(state, 'choir'));
  ark.systemId = 's13'; assert.equal(getStarlanePlan(state, 'choir'), null, 'an already arrived Ark has no travel investment');
});

test('possible population growth cannot hide an earlier paid-hull departure past the junction', () => {
  const { state, faction, source, home } = fixture();
  assert.equal(command(state, { type: 'cancelBuild', factionId: 'choir', systemId: home.id }).ok, true);
  const yard = world(state, 's7');
  Object.assign(yard, { owner: 'choir', population: 3, habitability: 90, buildings: ['shipyard'] });
  assert.equal(command(state, { type: 'build', factionId: 'choir', systemId: yard.id, itemId: 'colony' }).ok, true);
  source.population = 4; source.buildings = ['mine', 'shipyard']; source.charter = null;
  assert.equal(Math.ceil(yard.queue.work / getSystemYield(state, yard).production), 6);
  assert.equal(getStarlanePlan(state, faction.id), null, 'growth may launch the Ark at cycle five, before a six-cycle lane');
  source.population = 12; source.buildings.push('factory'); source.charter = { type: 'forge', level: 2 };
  const plan = getStarlanePlan(state, faction.id);
  assert.ok(plan); assert.equal(plan.benefits[0].readyCycles, 6); assert.equal(plan.benefits[0].projectedSystemId, yard.id);
});

test('retained over-capacity population releases a paid Ark before a late lane can help', () => {
  const { state, faction, source, home } = fixture();
  assert.equal(command(state, { type: 'cancelBuild', factionId: faction.id, systemId: home.id }).ok, true);
  const yard = world(state, 's7');
  Object.assign(yard, { owner: faction.id, population: 8, habitability: 10, buildings: ['shipyard'] });
  assert.equal(command(state, { type: 'build', factionId: faction.id, systemId: yard.id, itemId: 'colony' }).ok, true);
  source.population = 6; source.buildings = ['mine', 'shipyard']; source.charter = null;
  assert.equal(validateSave(state), true, 'refugees or removed housing may leave population above capacity');
  assert.equal(getSystemYield(state, yard).capacity, 5); assert.equal(getSystemYield(state, yard).production, 12);
  assert.equal(Math.ceil(48 / getSystemYield(state, source).production), 5);
  assert.equal(getStarlanePlan(state, faction.id), null, 'the Ark launches after four ticks and passes the useful junction before the fifth-tick restoration');
  const fast = clone(state), fastSource = world(fast, source.id);
  fastSource.population = 12; fastSource.buildings.push('factory'); fastSource.charter = { type: 'forge', level: 2 };
  assert.ok(getStarlanePlan(fast, faction.id), 'the same over-capacity Ark still justifies a lane that finishes early enough');
  for (let tick = 1; tick <= 4; tick++) {
    endTurn(state); assert.equal(yard.population, 8, 'ordinary construction retains the existing population');
    if (tick < 4) assert.equal(yard.queue.progress, tick * 12);
    assert.equal(validateSave(state), true);
  }
  const ark = state.fleets.find(fleet => fleet.owner === faction.id && fleet.type === 'colony' && fleet.systemId === yard.id);
  assert.ok(ark); assert.equal(yard.queue, null);
  endTurn(state); assert.equal(ark.systemId, 's8', 'the actual ordinary Ark departure precedes the hypothetical late opening');
});

function publicRace(state, progress = 8, sites = ['s13', 's20', 's21']) {
  const leader = state.factions.find(faction => faction.id === 'player');
  leader.techs = Object.keys(TECHS); leader.alignment = { progress, active: true, started: true, sites, reportedBeacons: [...sites] };
  actor(state).contacts.push('player'); leader.contacts.push('choir');
  for (const id of sites) Object.assign(world(state, id), { owner: 'player', population: 8, buildings: ['beacon'] });
  return leader;
}

test('the final cycle and an active public alignment stop a shortcut that cannot repay in time', () => {
  const final = fixture(); final.state.turn = 118; assert.equal(getStarlanePlan(final.state, 'choir'), null);
  const race = fixture(); publicRace(race.state, 8, ['s0', 's20', 's21']); assert.equal(getStarlanePlan(race.state, 'choir'), null);
  race.state.factions[0].alignment.progress = 1;
  assert.ok(getStarlanePlan(race.state, 'choir'), 'the same public race at an earlier stage leaves time for the paid job');
  assert.equal(getStarlanePlan(race.state, 'missing'), null);
});

test('an owned network ready to resume shortens the horizon before its next public update', () => {
  const { state, faction, home, source } = fixture();
  faction.techs.push('singularity');
  home.buildings = [...home.buildings.filter(id => id !== 'habitat'), 'beacon'];
  source.buildings = [...source.buildings.filter(id => id !== 'habitat'), 'beacon'];
  Object.assign(world(state, 's20'), { owner: 'choir', population: 8, buildings: ['beacon'], knownBy: ['choir'], exploredBy: ['choir'] });
  faction.alignment = { progress: 8, active: false, started: true, sites: ['s3', 's4', 's20'], reportedBeacons: ['s3', 's4', 's20'] };
  assert.ok(getEmpireStats(state, faction.id).creditIncome >= 60);
  assert.equal(getStarlanePlan(state, faction.id), null);
  faction.alignment.progress = 0; assert.ok(getStarlanePlan(state, faction.id));
});

test('working capital, colonization, Beacon reserves and future crews remain funded', () => {
  for (const change of [
    ({ faction }) => { faction.credits = 104; },
    ({ faction }) => { faction.minerals = 89; },
    ({ faction }) => { faction.techs.push('singularity'); faction.credits = 269; faction.minerals = 270; },
    ({ state }) => { for (let index = 0; index < 3; index++) ship(state, 'choir', 's3', 'cruiser', 12); },
    ({ state }) => {
      while (getEmpireStats(state, 'choir').creditIncome > 4) ship(state, 'choir', 's3', 'scout');
      assert.equal(getEmpireStats(state, 'choir').creditIncome, 4, 'today is solvent, but the paid queued Ark still needs a future crew');
    },
  ]) {
    const scenario = fixture(); change(scenario); assert.equal(validateSave(scenario.state), true);
    assert.equal(getStarlanePlan(scenario.state, 'choir'), null);
  }
  const funded = fixture(); funded.faction.techs.push('singularity'); funded.faction.credits = 270; funded.faction.minerals = 270;
  assert.ok(getStarlanePlan(funded.state, 'choir'));
});

test('immediate observed threats and essential shipyard construction precede optional restoration', () => {
  const threatened = fixture();
  threatened.faction.relations.player.status = threatened.state.factions[0].relations.choir.status = 'war';
  ship(threatened.state, 'player', 's3', 'frigate');
  assert.equal(getStarlanePlan(threatened.state, 'choir'), null, 'even a covered current home threat keeps restoration discretionary');
  const essential = fixture(); essential.source.buildings = essential.source.buildings.filter(id => id !== 'shipyard');
  assert.ok(getStarlanePlan(essential.state, 'choir'), 'the route would otherwise qualify');
  runAI(essential.state, essential.faction);
  assert.equal(essential.source.queue?.itemId, 'shipyard');
  assert.equal(essential.state.systems.some(system => system.queue?.kind === 'starlane'), false);
});

test('only concrete paid jobs count; a potential future Ark or uncharted world cannot justify restoration', () => {
  const noArk = fixture(); noArk.home.queue = null;
  assert.equal(getStarlanePlan(noArk.state, 'choir'), null);
  for (const field of ['knownBy', 'exploredBy']) {
    const scenario = fixture(); world(scenario.state, 's13')[field] = [];
    assert.equal(getStarlanePlan(scenario.state, 'choir'), null);
  }
  const closed = fixture(); world(closed.state, 's12').owner = 'player';
  assert.equal(getStarlanePlan(closed.state, 'choir'), null);
  closed.faction.relations.player.trade = true; closed.faction.relations.player.tradeEndsAt = closed.state.turn + 4;
  assert.equal(getStarlanePlan(closed.state, 'choir'), null);
});

test('a visible hostile reverses a useful job when the shared edge exposes an undefended colony', () => {
  const { state, faction, scout } = fixture();
  state.lanes.push(['s14', 's12']); world(state, 's14').knownBy = ['choir'];
  faction.contacts.push('player'); state.factions[0].contacts.push('choir');
  faction.relations.player.status = state.factions[0].relations.choir.status = 'war';
  ship(state, 'player', 's14', 'frigate', 2);
  assert.ok(getStarlanePlan(state, 'choir'), 'the remote hostile is initially unseen');
  scout.systemId = 's14';
  assert.equal(getStarlanePlan(state, 'choir'), null, 'a visible branch fleet gains a two-hop approach to the undefended builder');
  scout.systemId = 's3';
  assert.ok(getStarlanePlan(state, 'choir'), 'loss of sensors restores the same public planning boundary');
});

test('ordinary military missions count; selected expeditions project their actual two-jump phases', () => {
  const { state, faction, source, navy } = fixture();
  const leader = publicRace(state, 2); faction.relations.player.status = state.factions[0].relations.choir.status = 'war';
  source.population = 8; source.buildings = ['mine', 'shipyard', 'market']; source.charter = null;
  navy.movesLeft = 2;
  const ordinary = getStarlanePlan(state, 'choir');
  assert.ok(ordinary); assert.equal(ordinary.turns, 4);
  assert.deepEqual(ordinary.benefits.map(benefit => [benefit.fleetId, benefit.projectedSystemId, benefit.jumpsSaved]), [[navy.id, 's4', 5]]);
  leader.alignment.progress = 3; navy.movesLeft = 0;
  assert.equal(getStarlanePlan(state, 'choir'), null, 'next phase selects a fast expedition even before it has saved expedition metadata');
  faction.strategy = { mode: 'advance', objectiveId: 's13', rallyId: 's4', turn: state.turn, expedition: { fleetId: navy.id, targetId: 'player', systemId: 's13' } };
  assert.equal(getStarlanePlan(state, 'choir'), null, 'the faster selected expedition has passed the useful junction before work completes');
});

test('unseen foreign fleets, charts, research, treasury and unrelated work do not change the plan or own AI actions', () => {
  const { state } = fixture(), hidden = clone(state), rival = hidden.factions[0];
  const before = getStarlanePlan(state, 'choir');
  Object.assign(rival, { credits: 9000, minerals: 9000, techs: Object.keys(TECHS), research: null });
  for (const system of hidden.systems) if (!system.knownBy.includes('player')) system.knownBy.push('player');
  ship(hidden, 'player', 's40', 'cruiser', 12);
  world(hidden, 's0').queue = { itemId: 'factory', kind: 'building', progress: 30, work: 40, cost: { credits: 35, minerals: 45 } };
  assert.deepEqual(getStarlanePlan(hidden, 'choir'), before);
  runAI(state, actor(state)); runAI(hidden, actor(hidden));
  assert.deepEqual(actor(state), actor(hidden));
  const owned = value => value.systems.filter(system => system.owner === 'choir').map(system => ({ ...system, knownBy: system.knownBy.filter(id => id === 'choir'), exploredBy: system.exploredBy.filter(id => id === 'choir') }));
  assert.deepEqual(owned(state), owned(hidden), 'foreign chart membership was changed deliberately; owned economic effects remain identical');
  assert.deepEqual(state.fleets.filter(fleet => fleet.owner === 'choir'), hidden.fleets.filter(fleet => fleet.owner === 'choir'));
  assert.equal(validateSave(state), true); assert.equal(validateSave(hidden), true);
});
