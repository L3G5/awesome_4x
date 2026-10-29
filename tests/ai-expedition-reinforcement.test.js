import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGame, command, endTurn, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { getPublicRaces } from '../src/victory.js';
import { SHIPS, TECHS } from '../src/content.js';

const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const faction = (state, id = 'veyr') => state.factions.find(value => value.id === id);
const world = (state, id) => state.systems.find(value => value.id === id);
const fleet = (state, id) => state.fleets.find(value => value.id === id);
const temporary = mkdtempSync(join(tmpdir(), 'asterion-expedition-fixtures-'));
after(() => { delete globalThis.__expeditionFixtureAudit; rmSync(temporary, { recursive: true, force: true }); });

// Expose exact private functions only in a test module; imports point to the
// real current engine. No function bodies or production exports are changed.
const aiUrl = new URL('../src/ai.js', import.meta.url);
const aiSource = readFileSync(aiUrl, 'utf8').replace(/from '(\.\/[^']+)'/g, (_, specifier) => `from '${new URL(specifier, aiUrl).href}'`);
writeFileSync(join(temporary, 'queries.mjs'), aiSource + '\nexport { advanceIntervention, interventionCandidate, reinforceIntervention, threatsToColonies, route };');
const queries = await import(pathToFileURL(join(temporary, 'queries.mjs')));

// Reconstruct the two exact diagnostic boundaries from the committed original
// UI command trace and archived engine, instead of duplicating whole saves.
// Passive callbacks run only in a temporary copy of that historical graph.
async function historicalCheckpoints() {
  const root = new URL('../docs/watch-playtest/replay/', import.meta.url);
  const pin = JSON.parse(readFileSync(new URL('source-pin.json', root)));
  for (const [name, expected] of Object.entries(pin.files)) assert.equal(hash(readFileSync(new URL(`engine/${name}`, root))), expected);
  cpSync(fileURLToPath(new URL('engine/', root)), join(temporary, 'engine'), { recursive: true });
  const aiFile = join(temporary, 'engine/src/ai.js');
  let source = readFileSync(aiFile, 'utf8');
  assert.equal(hash(source), 'dd0c1e77ee56def0b96c9b4299c4406f7cb761059c1d850238951e6e891edcff');
  const entry = 'export function runAI(state, faction) {';
  const act = 'const act = action => command(state, { ...action, factionId: id });';
  assert.equal(source.split(entry).length, 2); assert.equal(source.split(act).length, 2);
  source = source.replace(entry, entry + '\n  globalThis.__expeditionFixtureAudit?.("entry", state, faction);')
    .replace(act, 'const act = action => { globalThis.__expeditionFixtureAudit?.("before", state, faction); const result = command(state, { ...action, factionId: id }); globalThis.__expeditionFixtureAudit?.("after", state, faction); return result; };');
  writeFileSync(aiFile, source);
  const original = await import(pathToFileURL(join(temporary, 'engine/src/game.js')));
  const snapshots = new Map(); let serial = 0;
  globalThis.__expeditionFixtureAudit = (point, state, actor) => {
    if (state.turn < 51 || state.turn > 59 || !['veyr', 'choir'].includes(actor.id)) return;
    const id = serial++;
    if ([41, 99].includes(id)) { assert.equal(point, 'before'); snapshots.set(id, clone(state)); }
  };
  const state = original.createGame('ASTERION-WATCH-14');
  const commands = JSON.parse(readFileSync(new URL('commands.json', root)));
  assert.equal(commands.length, 265);
  for (const { action } of commands) {
    assert.ok((action.type === 'endTurn' ? original.endTurn(state) : original.command(state, action)).ok);
    assert.ok(original.validateSave(state));
  }
  delete globalThis.__expeditionFixtureAudit;
  assert.equal(JSON.stringify(state), JSON.stringify(JSON.parse(readFileSync(new URL('../checkpoints/cycle60.json', root)))));
  assert.equal(hash(JSON.stringify(state)), 'd9cdd751b9a6af62aca35ed7fc631d4967679339e13a230add40ff8d58f0fda9');
  assert.equal(hash(JSON.stringify(snapshots.get(41))), '01e827a1ffe1d16995ff5276e627b81d5c6f654a7cf4df924c942f5d5b38509b');
  assert.equal(hash(JSON.stringify(snapshots.get(99))), '02eab9abb221bc6296155da581fca7d241afeb3b9b802e846221c91ab853e3d1');
  return snapshots;
}
const historical = await historicalCheckpoints();

function add(state, owner, systemId, ships = 1, type = 'frigate', movesLeft = 2) {
  const result = { id: `f${state.nextFleetId++}`, owner, systemId, ships, type, hp: ships * SHIPS[type].hp, movesLeft, name: 'Synthetic expedition formation' };
  state.fleets.push(result); return result;
}
function fixture({ hops = 4, orders = 3, progress = 7 } = {}) {
  const state = createGame('LOCAL-EXPEDITION-REINFORCEMENT'); state.turn = 50; state.fleets = [];
  for (const actor of state.factions) {
    Object.assign(actor, { credits: 0, minerals: 0, science: 0, orders: 0, research: null, techs: Object.keys(TECHS), contacts: [] });
    for (const relation of Object.values(actor.relations)) Object.assign(relation, { status: 'peace', trade: false, trust: 0, treatyTurn: state.turn });
  }
  const actor = faction(state), leader = faction(state, 'player'); actor.orders = orders;
  actor.contacts = ['player']; leader.contacts = ['veyr']; actor.relations.player.status = leader.relations.veyr.status = 'war';
  leader.credits = 1000; leader.alignment = { progress, active: true, started: true, sites: ['s0', 's7', 's8'], reportedBeacons: ['s0', 's7', 's8'] };
  for (const system of state.systems) { system.anomaly = null; system.queue = null; }
  for (const id of ['s0', 's7', 's8']) Object.assign(world(state, id), { owner: 'player', population: 8, buildings: ['beacon'], knownBy: ['player', 'veyr'], exploredBy: ['player'] });
  const path = ['s1', ...['s4', 's5', 's6', 's9'].slice(0, hops - 1), 's0'];
  for (const id of path) if (!world(state, id).knownBy.includes('veyr')) world(state, id).knownBy.push('veyr');
  state.lanes = path.slice(1).map((id, index) => [path[index], id]);
  const selected = add(state, 'veyr', 's1', 2), mate = add(state, 'veyr', 's1');
  actor.strategy = { mode: 'advance', rallyId: 's1', objectiveId: 's0', turn: state.turn, expedition: { fleetId: selected.id, targetId: 'player', systemId: 's0' } };
  assert.ok(validateSave(state)); return { state, actor, leader, selected, mate, path };
}
function candidate(state, selected, target = 's0') {
  const actor = faction(state, selected.owner), race = getPublicRaces(state, actor.id).find(value => value.factionId === 'player');
  return queries.interventionCandidate(state, actor, race, world(state, target), selected);
}
function advance(state, selected, target = 's0', afterAction = null) {
  const actor = faction(state, selected.owner), expedition = candidate(state, selected, target), actions = [];
  assert.ok(expedition);
  const result = queries.advanceIntervention(state, actor, expedition, action => {
    actions.push(clone(action)); const answer = command(state, { ...action, factionId: actor.id });
    assert.ok(answer.ok); assert.ok(validateSave(state)); afterAction?.(action, answer); return answer;
  });
  return { result, actions };
}

test('both exact WATCH local forks absorb one frigate and preserve their ordinary departure and ETA', () => {
  for (const [id, selectedId, mateId, target, steps, count, ordersAfter] of [
    [41, 'f53', 'f59', 's28', ['s5', 's10'], 3, 14],
    [99, 'f56', 'f59', 's28', ['s15'], 4, 15],
  ]) {
    const state = clone(historical.get(id)), expected = clone(state), actor = faction(state), selected = fleet(state, selectedId);
    const before = candidate(state, selected, target), initial = { moves: selected.movesLeft, rng: state.rng, credits: actor.credits, minerals: actor.minerals };
    assert.equal(queries.threatsToColonies(state, actor).length, 0);
    const result = advance(state, selected, target);
    const actions = [{ type: 'merge', fleetId: selectedId, targetFleetId: mateId }, ...steps.map(targetId => ({ type: 'move', fleetId: selectedId, targetId }))];
    assert.deepEqual(result.actions, actions);
    assert.deepEqual(result.result, { handled: true, active: true });
    assert.ok(command(expected, { ...actions[0], factionId: 'veyr' }).ok);
    const afterMerge = candidate(expected, fleet(expected, selectedId), target);
    assert.equal(afterMerge.arrivalCycles, before.arrivalCycles); assert.deepEqual(afterMerge.travel, before.travel);
    assert.equal(fleet(expected, selectedId).movesLeft, initial.moves);
    for (const action of actions.slice(1)) assert.ok(command(expected, { ...action, factionId: 'veyr' }).ok);
    assert.deepEqual(state, expected); assert.equal(selected.ships, count); assert.equal(selected.systemId, steps.at(-1));
    assert.equal(selected.movesLeft, 0); assert.equal(actor.orders, ordersAfter); assert.equal(fleet(state, mateId), undefined);
    assert.equal(actor.credits, initial.credits); assert.equal(actor.minerals, initial.minerals); assert.equal(state.rng, initial.rng);
    const loaded = clone(state); assert.deepEqual(endTurn(state), endTurn(loaded)); assert.deepEqual(state, loaded); assert.ok(validateSave(state));
  }
});

test('full runAI integrates one paid absorption without changing the selected mission or current jump budget', () => {
  const { state, actor, selected, mate, path } = fixture();
  const credits = actor.credits, minerals = actor.minerals, rng = state.rng;
  runAI(state, actor);
  assert.equal(selected.ships, 3); assert.equal(selected.hp, 102); assert.equal(fleet(state, mate.id), undefined);
  assert.equal(selected.systemId, path[2]); assert.equal(selected.movesLeft, 0); assert.equal(actor.orders, 0);
  assert.deepEqual(actor.strategy.expedition, { fleetId: selected.id, targetId: 'player', systemId: 's0' });
  assert.equal(actor.credits, credits); assert.equal(actor.minerals, minerals); assert.equal(state.rng, rng); assert.ok(validateSave(state));
});

test('spare orders preserve all current jumps, including a one-hop arrival', () => {
  for (const [hops, orders, merges, moves] of [[4, 2, 0, 2], [4, 3, 1, 2], [1, 1, 0, 1], [1, 2, 1, 1]]) {
    const { state, selected } = fixture({ hops, orders });
    const result = advance(state, selected);
    assert.equal(result.actions.filter(action => action.type === 'merge').length, merges);
    assert.equal(result.actions.filter(action => action.type === 'move').length, moves);
    assert.equal(faction(state).orders, orders - merges - moves);
  }
});

test('low movement, capacity, wrong ownership/class/location and civilians never become expedition mates', () => {
  for (const alter of [
    ({ mate }) => { mate.movesLeft = 1; },
    ({ selected, mate }) => { selected.ships = 12; selected.hp = 408; mate.ships = 1; },
    ({ mate }) => { mate.owner = 'choir'; },
    ({ mate }) => { mate.type = 'cruiser'; mate.hp = 85; },
    ({ mate }) => { mate.type = 'scout'; mate.hp = 18; },
    ({ mate }) => { mate.type = 'colony'; mate.hp = 24; mate.movesLeft = 1; },
    ({ mate }) => { mate.systemId = 's2'; },
  ]) {
    const scenario = fixture({ orders: 6 }); alter(scenario); assert.ok(validateSave(scenario.state));
    const beforeMate = clone(scenario.mate), result = advance(scenario.state, scenario.selected);
    assert.equal(result.actions.some(action => action.type === 'merge'), false); assert.deepEqual(scenario.mate, beforeMate);
    assert.equal(scenario.selected.systemId, scenario.path[2]);
  }
});

test('only one deterministic mate is absorbed per departure; another local mate is not swept up', () => {
  const first = fixture({ orders: 8 });
  const larger = add(first.state, 'veyr', 's1', 2); const tie = add(first.state, 'veyr', 's1', 2);
  const second = clone(first.state); second.fleets.reverse();
  const one = advance(first.state, first.selected), two = advance(second, fleet(second, first.selected.id));
  assert.deepEqual(one.actions, two.actions); assert.deepEqual(one.actions[0], { type: 'merge', fleetId: first.selected.id, targetFleetId: larger.id });
  assert.equal(one.actions.filter(action => action.type === 'merge').length, 1);
  assert.ok(fleet(first.state, first.mate.id)); assert.ok(fleet(first.state, tie.id)); assert.equal(first.selected.ships, 4);
});

test('a covered observed home threat still prevents absorption without changing expedition movement', () => {
  const { state, actor, selected, mate, path } = fixture({ orders: 6 });
  Object.assign(world(state, 's9'), { owner: 'veyr', population: 6, buildings: [], knownBy: ['veyr'], exploredBy: ['veyr'] });
  add(state, 'veyr', 's9', 12, 'cruiser'); add(state, 'player', 's9');
  const threats = queries.threatsToColonies(state, actor); assert.equal(threats.length, 1); assert.ok(threats[0].stationed > threats[0].required);
  const result = advance(state, selected);
  assert.equal(result.actions.some(action => action.type === 'merge'), false); assert.ok(fleet(state, mate.id)); assert.equal(selected.systemId, path[2]);
});

test('a newly observed threat at an intermediate boundary skips only the new absorption', () => {
  const { state, selected, mate, path } = fixture({ orders: 6 }); mate.systemId = path[1];
  Object.assign(world(state, 's9'), { owner: 'veyr', population: 6, buildings: [], knownBy: ['player', 'veyr'], exploredBy: ['veyr'] });
  world(state, 's10').knownBy = ['player']; state.lanes.push(['s10', 's9']);
  const hostile = add(state, 'player', 's10'); faction(state, 'player').orders = 1;
  assert.equal(queries.threatsToColonies(state, faction(state)).length, 0);
  const expected = clone(state), enemyMove = { type: 'move', factionId: 'player', fleetId: hostile.id, targetId: 's9' };
  let injected = false;
  const result = advance(state, selected, 's0', action => {
    if (!injected && action.type === 'move') {
      // A synthetic ordinary enemy arrival between boundaries exercises the
      // fresh-information guard; this is not a claim about WATCH turn order.
      injected = true; assert.ok(command(state, enemyMove).ok);
      assert.equal(queries.threatsToColonies(state, faction(state)).length, 1);
    }
  });
  assert.deepEqual(result.actions, [path[1], path[2]].map(targetId => ({ type: 'move', fleetId: selected.id, targetId })));
  assert.ok(command(expected, { ...result.actions[0], factionId: 'veyr' }).ok); assert.ok(command(expected, enemyMove).ok);
  assert.ok(command(expected, { ...result.actions[1], factionId: 'veyr' }).ok); assert.deepEqual(state, expected); assert.ok(fleet(state, mate.id));
});

function longerRoute() {
  const scenario = fixture({ hops: 2, orders: 3, progress: 9 }), { state, actor, selected, mate, leader } = scenario;
  state.lanes = [['s1', 's4'], ['s4', 's0'], ['s1', 's5'], ['s5', 's6'], ['s6', 's0']];
  Object.assign(world(state, 's4'), { owner: 'player', population: 8, buildings: [], knownBy: ['player', 'veyr'], exploredBy: ['player'] });
  for (const id of ['s5', 's6']) Object.assign(world(state, id), { owner: null, population: 0, buildings: [], knownBy: ['veyr'], exploredBy: ['veyr'] });
  leader.techs = ['singularity']; mate.ships = 2; mate.hp = 68;
  add(state, 'veyr', 's6', 1, 'scout'); const guard = add(state, 'player', 's6', 2); guard.hp = 48;
  assert.equal(queries.threatsToColonies(state, actor).length, 0); assert.ok(validateSave(state));
  return scenario;
}

test('the independent weighted-route counterexample rejects a slower merged candidate before payment', () => {
  for (const progress of [9, 7]) {
    const { state, actor, selected, mate, leader } = longerRoute(); leader.alignment.progress = progress;
    const before = candidate(state, selected); assert.equal(before.arrivalCycles, 1); assert.deepEqual(before.travel.path, ['s1', 's4', 's0']);
    const hypothetical = clone(state); assert.ok(command(hypothetical, { type: 'merge', factionId: actor.id, fleetId: selected.id, targetFleetId: mate.id }).ok);
    const changed = candidate(hypothetical, fleet(hypothetical, selected.id));
    assert.equal(changed?.arrivalCycles ?? null, progress === 9 ? null : 2);
    assert.deepEqual(queries.route(hypothetical, faction(hypothetical), fleet(hypothetical, selected.id), 's0', { interventionOwner: 'player' }).path, ['s1', 's5', 's6', 's0']);
    const saved = clone(state), actions = [];
    assert.equal(queries.reinforceIntervention(state, actor, before, action => { actions.push(action); return command(state, { ...action, factionId: actor.id }); }), false);
    assert.deepEqual(actions, []); assert.deepEqual(state, saved);
    const result = advance(state, selected); assert.equal(result.actions.some(action => action.type === 'merge'), false);
    assert.equal(selected.systemId, 's0'); assert.equal(actor.orders, 1); assert.ok(fleet(state, mate.id));
  }
});

test('a qualifying intermediate reinforcement can join, but contact/combat still stops the same cycle', () => {
  const clear = fixture({ orders: 4 }); clear.mate.systemId = clear.path[1];
  const clearResult = advance(clear.state, clear.selected);
  assert.deepEqual(clearResult.actions.map(action => action.type), ['move', 'merge', 'move']); assert.equal(clear.selected.ships, 3);
  const battle = fixture({ orders: 6 }); battle.mate.systemId = battle.path[2];
  add(battle.state, 'player', battle.path[1]);
  const result = advance(battle.state, battle.selected);
  assert.deepEqual(result.actions.map(action => action.type), ['move']); assert.equal(battle.selected.systemId, battle.path[1]);
  assert.ok(fleet(battle.state, battle.mate.id)); assert.equal(battle.selected.movesLeft, 1); assert.ok(battle.state.combatReports.length);
});

test('arrival and invalidated missions do not opportunistically assemble extra forces', () => {
  const arrived = fixture({ hops: 1, orders: 5 }); arrived.selected.systemId = 's0'; arrived.mate.systemId = 's0';
  const blocked = advance(arrived.state, arrived.selected); assert.deepEqual(blocked.actions, []); assert.equal(blocked.result.active, true);
  for (const invalidate of [
    scenario => { scenario.leader.alignment.progress = 2; },
    scenario => { scenario.actor.relations.player.status = 'peace'; },
    scenario => { world(scenario.state, 's0').buildings = []; },
  ]) {
    const scenario = fixture(), chosen = candidate(scenario.state, scenario.selected); invalidate(scenario);
    const before = clone(scenario.state), actions = [];
    const result = queries.advanceIntervention(scenario.state, scenario.actor, chosen, action => { actions.push(action); return command(scenario.state, { ...action, factionId: 'veyr' }); });
    assert.deepEqual(actions, []); assert.equal(result.active, false); assert.deepEqual(scenario.state, before);
  }
});

test('hidden foreign forces and research cannot alter local absorption, target or clear movement', () => {
  const { state, selected } = fixture({ orders: 3 }); add(state, 'player', 's0', 1);
  const changed = clone(state), unseen = changed.fleets.find(value => value.owner === 'player');
  Object.assign(unseen, { ships: 12, hp: 1020, type: 'cruiser' });
  faction(changed, 'player').techs = faction(changed, 'player').techs.filter(id => id !== 'physics');
  faction(changed, 'player').research = { techId: 'physics', progress: 1 };
  const first = advance(state, selected), second = advance(changed, fleet(changed, selected.id));
  assert.deepEqual(first, second); assert.deepEqual(faction(state), faction(changed));
  assert.deepEqual(state.fleets.filter(value => value.owner === 'veyr'), changed.fleets.filter(value => value.owner === 'veyr'));
});
