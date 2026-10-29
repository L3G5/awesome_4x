import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, command, endTurn, getEmpireStats, validateSave } from '../src/game.js';
import { getAlignmentStatus, advanceAlignment } from '../src/victory.js';
import { getAlignmentOutlook } from '../src/alignment-outlook.js';
import { SHIPS } from '../src/content.js';

const copy = value => JSON.parse(JSON.stringify(value));
const player = state => state.factions.find(faction => faction.id === 'player');
const world = (state, id) => state.systems.find(system => system.id === id);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const watchBytes = readFileSync(new URL('../docs/watch-playtest/checkpoints/cycle51.json', import.meta.url));
assert.equal(hash(watchBytes), '0d92ec11ee00ee474d99c852ba222f25588c019b18e1ac04d5aac2794d127698');
const watch = () => JSON.parse(watchBytes);
const act = (state, action) => { const result = command(state, action); assert.ok(result.ok, result.message); return result; };
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

/** Synthetic fixed-network fixture; ordinary endTurn remains the resolver. */
function fixedNetwork(credits = 100) {
  const state = createGame('CURRENT-ALIGNMENT-BUDGET');
  const own = player(state), sites = ['s0', 's4', 's5'];
  Object.assign(own, { credits, techs: ['logistics', 'industry', 'physics', 'computing', 'singularity'], research: null });
  for (const id of sites) Object.assign(world(state, id), {
    owner: 'player', population: 4, growth: 0, buildings: ['beacon'], queue: null,
    knownBy: ['player'], exploredBy: ['player'], anomaly: null,
  });
  own.alignment = { progress: 1, active: true, started: true, sites, reportedBeacons: [...sites] };
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'player');
  // As in the resolver tests, suppress rival decisions to isolate funding.
  // This is synthetic setup, not a claim that these empires collapsed in play.
  for (const faction of state.factions.filter(faction => faction.id !== 'player')) faction.eliminated = true;
  assert.ok(validateSave(state)); assert.equal(getEmpireStats(state).creditIncome, 33);
  return state;
}

function cruiserUpkeep(state) {
  const fleet = { id: `f${state.nextFleetId++}`, owner: 'player', systemId: 's0', type: 'cruiser', ships: 12, hp: SHIPS.cruiser.hp * 12, movesLeft: 1, name: 'Synthetic upkeep formation' };
  state.fleets.push(fleet); assert.ok(validateSave(state)); return fleet;
}

test('WATCH51 funding example uses 50 +75 -60 without changing the instantaneous status or resolver', () => {
  // Only treasury differs from the exact recorded input. This is a diagnostic
  // fork, not a replacement of the actual human campaign checkpoint.
  const state = watch(); player(state).credits = 50;
  const untouched = copy(state), before = getAlignmentStatus(state);
  assert.equal(before.ready, false); assert.match(before.reason, /60 credits/);
  assert.deepEqual(getAlignmentOutlook(state), {
    treasury: 50, creditIncome: 75, upkeep: 25, creditsAfterIncome: 125,
    cost: 60, fundingCovered: true, shortfall: 0,
    networkReady: true, networkReason: '', ready: true, reason: '', creditsAfterAlignment: 65,
  });
  assert.deepEqual(getAlignmentStatus(state), before); assert.deepEqual(state, untouched);
  assert.deepEqual(endTurn(state), endTurn(untouched)); assert.deepEqual(state, untouched);
  assert.equal(player(state).credits, 65); assert.equal(player(state).alignment.progress, 2);
  assert.ok(validateSave(state)); assert.equal(hash(watchBytes), '0d92ec11ee00ee474d99c852ba222f25588c019b18e1ac04d5aac2794d127698');
});

test('an after-income deficit distinguishes funding from an otherwise ready network and charges nothing', () => {
  const state = fixedNetwork(0), outlook = getAlignmentOutlook(state);
  assert.equal(outlook.networkReady, true); assert.equal(outlook.networkReason, '');
  assert.equal(outlook.creditIncome, 33); assert.equal(outlook.creditsAfterIncome, 33);
  assert.equal(outlook.shortfall, 27); assert.equal(outlook.fundingCovered, false);
  assert.equal(outlook.ready, false); assert.match(outlook.reason, /60 credits/);
  assert.equal(outlook.creditsAfterAlignment, null);
  assert.ok(endTurn(state).ok); assert.equal(player(state).credits, 33);
  assert.equal(player(state).alignment.progress, 0); assert.equal(player(state).alignment.active, false);
  assert.ok(validateSave(state));
});

test('a treasury above 60 can still fall short after current upkeep, without subtracting upkeep twice', () => {
  const state = fixedNetwork(70); cruiserUpkeep(state);
  assert.equal(getAlignmentStatus(state).ready, true);
  const outlook = getAlignmentOutlook(state);
  assert.equal(outlook.upkeep, 48); assert.equal(outlook.creditIncome, -15);
  assert.equal(outlook.creditsAfterIncome, 55); assert.equal(outlook.shortfall, 5);
  assert.equal(outlook.ready, false); assert.equal(outlook.creditsAfterAlignment, null);
  assert.ok(endTurn(state).ok); assert.equal(player(state).credits, 55);
  assert.equal(player(state).alignment.progress, 0); assert.ok(validateSave(state));
});

test('an exhausted treasury clamps to zero without projecting an alignment charge or attrition command', () => {
  const state = fixedNetwork(10), fleet = cruiserUpkeep(state), original = copy(state);
  const outlook = getAlignmentOutlook(state);
  assert.equal(outlook.creditIncome, -15); assert.equal(outlook.creditsAfterIncome, 0);
  assert.equal(outlook.shortfall, 60); assert.equal(outlook.creditsAfterAlignment, null);
  assert.deepEqual(state, original); assert.equal(fleet.ships, 12);
  assert.ok(endTurn(state).ok); assert.equal(player(state).credits, 0);
  assert.equal(fleet.ships, 11, 'the real resolver, not the projection, handles unpaid upkeep');
  assert.equal(player(state).alignment.progress, 0); assert.ok(validateSave(state));
});

test('current blockade, missing Protocol and missing sites prevent projected payment despite ample credits', () => {
  for (const [name, alter, reason] of [
    ['blockade', state => {
      const rival = state.factions.find(faction => faction.id === 'veyr');
      player(state).relations.veyr.status = rival.relations.player.status = 'war';
      const guard = state.fleets.find(fleet => fleet.owner === 'veyr');
      Object.assign(guard, { systemId: 's0', type: 'frigate', ships: 1, hp: 34 });
    }, /Hostile warships.*Solace/],
    ['Protocol', state => { player(state).techs = player(state).techs.filter(id => id !== 'singularity'); }, /Protocol/],
    ['sites', state => { world(state, 's5').buildings = []; }, /three owned worlds \(2\/3\)/],
  ]) {
    const state = fixedNetwork(); alter(state); assert.ok(validateSave(state), name);
    const outlook = getAlignmentOutlook(state);
    assert.equal(outlook.fundingCovered, true, name); assert.equal(outlook.shortfall, 0, name);
    assert.equal(outlook.networkReady, false, name); assert.match(outlook.networkReason, reason, name);
    assert.equal(outlook.ready, false, name); assert.match(outlook.reason, reason, name);
    assert.equal(outlook.creditsAfterAlignment, null, name);
    assert.ok(endTurn(state).ok); assert.equal(player(state).credits, outlook.creditsAfterIncome, name);
    assert.equal(player(state).alignment.progress, 0, name); assert.ok(validateSave(state), name);
  }
});

test('structural refusal keeps its exact reason even when funding also falls short', () => {
  const state = fixedNetwork(0); player(state).techs = [];
  const outlook = getAlignmentOutlook(state);
  assert.equal(outlook.fundingCovered, false); assert.equal(outlook.shortfall, 27);
  assert.equal(outlook.networkReady, false); assert.match(outlook.networkReason, /Protocol/);
  assert.equal(outlook.reason, outlook.networkReason); assert.equal(outlook.creditsAfterAlignment, null);
});

test('the real resolver still charges once, and ordinary commands do not turn the outlook into payment', () => {
  const state = fixedNetwork(), original = copy(state), outlook = getAlignmentOutlook(state);
  assert.equal(outlook.creditsAfterAlignment, 73);
  assert.equal(advanceAlignment(state).advanced, true);
  assert.equal(player(state).credits, 40, 'the instantaneous resolver does not add forecast income');
  assert.equal(player(state).alignment.progress, 2);
  getAlignmentOutlook(state); const resolved = copy(state);
  assert.equal(advanceAlignment(state).advanced, false); assert.deepEqual(state, resolved);
  act(original, { type: 'research', techId: 'ecology' });
  assert.equal(player(original).credits, 100); assert.equal(player(original).alignment.progress, 1);
  assert.equal(getAlignmentOutlook(original).creditsAfterAlignment, 73);
});

test('last-step completion returns a budget until the ordinary turn wins, then every completed outlook is null', () => {
  const state = fixedNetwork(); player(state).alignment.progress = 9;
  assert.equal(getAlignmentOutlook(state).creditsAfterAlignment, 73);
  assert.ok(endTurn(state).ok); assert.equal(state.winner, 'player');
  assert.equal(state.victoryType, 'Transcendence'); assert.equal(player(state).credits, 73);
  const finished = copy(state); assert.equal(getAlignmentOutlook(state), null); assert.deepEqual(state, finished);
  for (const winner of ['player', 'veyr', 'khar', 'choir']) {
    const other = copy(finished); other.winner = winner;
    assert.equal(getAlignmentOutlook(other), null);
  }
});

test('missing or eliminated players have no outlook; an unstarted or paused alignment still has a budget', () => {
  const state = fixedNetwork(); delete player(state).alignment;
  assert.equal(getAlignmentOutlook(state).ready, true);
  player(state).alignment = { progress: 0, active: false, started: false, sites: [], reportedBeacons: [] };
  assert.equal(getAlignmentOutlook(state).ready, true);
  player(state).eliminated = true; assert.equal(getAlignmentOutlook(state), null);
  assert.equal(getAlignmentOutlook({ ...state, factions: state.factions.filter(faction => faction.id !== 'player') }), null);
  assert.equal(getAlignmentOutlook(null), null);
});

test('projection accepts deeply frozen input, returns detached values and preserves exact JSON continuation', () => {
  const state = watch(), original = copy(state), frozen = freeze(copy(state));
  const view = getAlignmentOutlook(frozen);
  assert.deepEqual(view, getAlignmentOutlook(copy(state)));
  for (const value of Object.values(view)) assert.ok(value === null || typeof value !== 'object');
  view.treasury = -1; view.reason = 'Caller annotation';
  assert.deepEqual(frozen, original); assert.deepEqual(state, original);
  getAlignmentOutlook(state); const reload = copy(state);
  assert.deepEqual(endTurn(state), endTurn(reload)); assert.deepEqual(state, reload); assert.ok(validateSave(state));
});

test('hidden foreign economy, research, fleets and queues cannot change the player-only current outlook', () => {
  const state = fixedNetwork(), changed = copy(state);
  assert.equal(getAlignmentOutlook(state).ready, true);
  for (const faction of changed.factions.filter(faction => faction.id !== 'player')) {
    Object.assign(faction, { credits: 99999, minerals: 99999, science: 99999, research: { techId: 'physics', progress: 1 } });
    faction.techs = faction.techs.filter(id => id !== 'physics');
  }
  for (const fleet of changed.fleets.filter(fleet => fleet.owner !== 'player')) {
    Object.assign(fleet, { type: 'cruiser', ships: 12, hp: 1020 });
  }
  for (const system of changed.systems.filter(system => system.owner && system.owner !== 'player')) {
    system.queue = { kind: 'ship', itemId: 'frigate', progress: 0, work: 26, cost: { credits: 25, minerals: 35 } };
  }
  assert.ok(validateSave(changed)); assert.deepEqual(getAlignmentOutlook(changed), getAlignmentOutlook(state));
  assert.equal(Object.hasOwn(getAlignmentOutlook(changed), 'factions'), false);
});

test('an already-noticed trade expiry demonstrates why current-conditions income is not a promised next treasury', () => {
  // A normal-command diagnostic branch from the unmodified WATCH51 export;
  // it is not claimed to be the subsequent recorded human campaign.
  const state = watch(); act(state, { type: 'diplomacy', targetId: 'choir', stance: 'endTrade' });
  assert.equal(player(state).relations.choir.tradeEndsAt, 54);
  assert.ok(endTurn(state).ok); assert.ok(endTurn(state).ok); assert.equal(state.turn, 53);
  const outlook = getAlignmentOutlook(state), untouched = copy(state);
  assert.equal(outlook.treasury, 984); assert.equal(outlook.creditIncome, 75);
  assert.equal(outlook.creditsAfterAlignment, 999); assert.equal(player(state).relations.choir.trade, true);
  assert.deepEqual(endTurn(state), endTurn(untouched)); assert.deepEqual(state, untouched);
  assert.equal(player(state).relations.choir.trade, false); assert.equal(getEmpireStats(state).creditIncome, 65);
  assert.equal(player(state).credits, 989); assert.equal(player(state).alignment.progress, 4);
  assert.equal(outlook.creditsAfterAlignment - player(state).credits, 10);
  assert.ok(validateSave(state));
});
