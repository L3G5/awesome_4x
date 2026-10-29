import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, command, endTurn, getNeighbors, validateSave } from '../src/game.js';
import { SHIPS, TECHS } from '../src/content.js';
import { getMergeOptions, getMergePreview, getReinforcementPreview } from '../src/reinforcement.js';

const clone = value => JSON.parse(JSON.stringify(value));
const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const fleet = (state, id) => state.fleets.find(candidate => candidate.id === id);
const home = state => state.systems.find(system => system.id === 's0');
const snapshot = value => ({
  id: value.id, name: value.name, type: value.type, systemId: value.systemId,
  ships: value.ships, hp: value.hp, maxHp: value.ships * SHIPS[value.type].hp,
  movesLeft: value.movesLeft, route: value.route ? clone(value.route) : null,
  hold: value.hold === true, defenseLead: value.defenseLead === true, heritage: clone(value.heritage || []),
});
function addFleet(state, options = {}) {
  const type = options.type || 'frigate', ships = options.ships || 1;
  const value = { id: `f${state.nextFleetId++}`, owner: 'player', systemId: 's0', name: 'Synthetic formation', type, ships, hp: SHIPS[type].hp * ships, movesLeft: SHIPS[type].moves, ...options };
  state.fleets.push(value); return value;
}
function fixture() {
  const state = createGame('REINFORCEMENT-PROJECTION');
  for (const empire of state.factions) Object.assign(empire, { techs: Object.keys(TECHS), research: null, credits: 5000, minerals: 5000, orders: 18 });
  state.fleets = [];
  Object.assign(home(state), { population: 8, habitability: 90, growth: 0, buildings: ['shipyard', 'factory', 'mine'], charter: { type: 'forge', level: 2 }, queue: null, anomaly: null });
  const selected = addFleet(state, { name: 'Selected formation', ships: 2 });
  const partner = addFleet(state, { name: 'Partner formation', ships: 3 });
  assert.ok(validateSave(state));
  return { state, selected, partner };
}
function quietCycle(state) {
  for (const empire of state.factions.filter(candidate => candidate.id !== 'player')) empire.orders = 0;
  assert.ok(endTurn(state).ok); assert.ok(validateSave(state));
}
function route(state, value, neighborIndex = 0) {
  const destinationId = getNeighbors(state, value.systemId)[neighborIndex];
  assert.ok(destinationId);
  const target = state.systems.find(system => system.id === destinationId);
  if (!target.knownBy.includes(value.owner)) target.knownBy.push(value.owner);
  value.route = { destinationId, path: [value.systemId, destinationId] };
}
function heritage(state, id, fleetId) {
  return { id, name: `Historic ${id}`, systemId: 's0', discoveryId: 'forge', choiceId: 'ship', turn: state.turn, factionId: 'player', fleetId };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('actual WATCH40 merge and reinforcement exactly match ordinary commands and the next complete turn', () => {
  const raw = readFileSync(new URL('../docs/watch-playtest/checkpoints/cycle40.json', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'bc336a1f56fa49d494914eb249756af9dc3f41a4f260c279064ab8e62393f715');
  const state = JSON.parse(raw), baseline = clone(state), start = clone(faction(state));
  assert.ok(validateSave(state));
  const merge = getMergePreview(state, 'f47', 'f49');
  assert.deepEqual(getMergeOptions(state, 'f47').map(option => option.targetFleetId), ['f49']);
  assert.equal(merge.enabled, true); assert.equal(merge.orderCost, 1);
  assert.equal(merge.result.id, 'f47'); assert.equal(merge.result.ships, 2);
  assert.equal(merge.result.hp, 68); assert.equal(merge.result.movesLeft, 1); assert.equal(merge.result.hold, true);
  assert.deepEqual(command(state, merge.command), command(baseline, { type: 'merge', fleetId: 'f47', targetFleetId: 'f49' }));
  assert.deepEqual(snapshot(fleet(state, 'f47')), merge.result); assert.equal(fleet(state, 'f49'), undefined);
  assert.deepEqual(state, baseline);
  const build = getReinforcementPreview(state, 'f47');
  assert.equal(build.enabled, true); assert.equal(build.independent, true);
  assert.deepEqual(build.cost, { credits: 25, minerals: 28 }); assert.equal(build.orderCost, 1);
  assert.equal(build.work, 26); assert.equal(build.production, 30); assert.equal(build.cyclesAtCurrentRate, 1);
  assert.equal('fleetId' in build.command, false);
  assert.deepEqual(command(state, build.command), command(baseline, { type: 'build', systemId: 's0', itemId: 'frigate' }));
  assert.equal(start.credits - faction(state).credits, 25); assert.equal(start.minerals - faction(state).minerals, 28);
  assert.equal(start.orders - faction(state).orders, 2); assert.deepEqual(state, baseline);
  const loaded = clone(state);
  assert.deepEqual(endTurn(state), endTurn(baseline)); assert.deepEqual(endTurn(loaded), { ok: true, message: `Turn ${loaded.turn}: a new mandate begins.` });
  assert.deepEqual(state, baseline); assert.deepEqual(state, loaded); assert.ok(validateSave(state));
});

test('merge predicts exact damaged hull, minimum movement, survivor identity and both histories', () => {
  const { state, selected, partner } = fixture();
  selected.name = 'Remembered flagship'; selected.hp = .01; selected.movesLeft = 2; selected.hold = true;
  partner.hp = .06; partner.movesLeft = 0; partner.hold = true; partner.defenseLead = true;
  route(state, selected); route(state, partner, 1);
  const shared = heritage(state, 'shared-origin', selected.id), extra = heritage(state, 'other-origin', partner.id);
  selected.heritage = [shared]; partner.heritage = [{ ...shared, name: 'Partner copy of history' }, extra];
  assert.ok(validateSave(state));
  const original = clone(state), view = getMergePreview(state, selected.id, partner.id);
  assert.equal(view.result.ships, 5); assert.equal(view.result.hp, .01 + .06); assert.equal(view.result.maxHp, 170);
  assert.equal(view.result.movesLeft, 0); assert.equal(view.result.name, 'Remembered flagship');
  assert.deepEqual(view.result.route, selected.route); assert.equal(view.result.hold, true); assert.equal(view.result.defenseLead, true);
  assert.deepEqual(view.discarded, { route: partner.route, hold: true });
  assert.equal(view.result.heritage.length, 2); assert.equal(view.result.heritage[0].name, 'Partner copy of history');
  assert.deepEqual(state, original);
  const upkeepBefore = state.fleets.filter(value => value.owner === 'player').reduce((sum, value) => sum + value.ships * SHIPS[value.type].upkeep, 0);
  assert.ok(command(state, view.command).ok); assert.deepEqual(snapshot(selected), view.result);
  assert.equal(state.fleets.filter(value => value.owner === 'player').reduce((sum, value) => sum + value.ships * SHIPS[value.type].upkeep, 0), upkeepBefore);
  assert.ok(validateSave(state));
});

test('the partner does not transfer its Hold or route, and projection defaults do not write save fields', () => {
  const { state, selected, partner } = fixture();
  partner.hold = true; route(state, partner); selected.defenseLead = true;
  const view = getMergePreview(state, selected.id, partner.id);
  assert.equal(view.result.hold, false); assert.equal(view.result.route, null); assert.equal(view.result.defenseLead, true);
  assert.deepEqual(view.discarded, { route: partner.route, hold: true });
  assert.ok(command(state, view.command).ok);
  assert.equal(Object.hasOwn(selected, 'hold'), false); assert.equal(Object.hasOwn(selected, 'route'), false);
  assert.equal(Object.hasOwn(selected, 'heritage'), false, 'empty display history is not a persisted empty array');
  assert.deepEqual(snapshot(selected), view.result);
});

test('stable options retain over-cap partners without concealing a legal alternative at zero orders', () => {
  const { state, selected, partner } = fixture();
  selected.ships = 9; selected.hp = 306; partner.ships = 4; partner.hp = 136;
  const legal = addFleet(state, { ships: 2, name: 'Legal second partner' });
  addFleet(state, { type: 'scout' }); addFleet(state, { systemId: 's1' }); addFleet(state, { owner: 'khar' });
  faction(state).orders = 0;
  const options = getMergeOptions(state, selected.id);
  assert.deepEqual(options.map(option => option.targetFleetId), [partner.id, legal.id].sort());
  assert.equal(options.find(option => option.targetFleetId === partner.id).structurallyLegal, false);
  assert.match(options.find(option => option.targetFleetId === partner.id).structuralReason, /12 ships/);
  assert.equal(options.find(option => option.targetFleetId === partner.id).result, null);
  const valid = options.find(option => option.targetFleetId === legal.id);
  assert.equal(valid.structurallyLegal, true); assert.equal(valid.enabled, false); assert.equal(valid.result.ships, 11);
  assert.match(valid.reason, /No orders/);
  state.fleets.reverse(); assert.deepEqual(getMergeOptions(state, selected.id), options, 'source array order cannot reorder choices');
  faction(state).orders = 2; const untouched = clone(state);
  assert.equal(command(state, { type: 'merge', fleetId: selected.id, targetFleetId: partner.id }).ok, false); assert.deepEqual(state, untouched);
  assert.ok(command(state, valid.command).ok); assert.equal(selected.ships, 11); assert.ok(fleet(state, partner.id));
});

test('invalid merge pairs expose no target details and match ordinary atomic refusal', () => {
  const { state, selected, partner } = fixture();
  const remote = addFleet(state, { systemId: 's1' }), foreign = addFleet(state, { owner: 'khar', name: 'Secret opponent' }), scout = addFleet(state, { type: 'scout' });
  for (const id of ['missing', selected.id, remote.id, foreign.id, scout.id]) {
    const saved = clone(state), view = getMergePreview(state, selected.id, id);
    assert.equal(view.enabled, false); assert.equal(view.structurallyLegal, false); assert.equal(view.partner, null); assert.equal(view.result, null);
    assert.equal(JSON.stringify(view).includes('Secret opponent'), false);
    const result = command(state, view.command); assert.equal(result.ok, false); assert.equal(result.message, view.reason); assert.deepEqual(state, saved);
  }
  for (const id of ['missing', foreign.id]) {
    assert.equal(getMergePreview(state, id, partner.id), null); assert.equal(getMergeOptions(state, id), null); assert.equal(getReinforcementPreview(state, id), null);
  }
  selected.type = partner.type = 'colony'; selected.ships = partner.ships = 1; selected.hp = partner.hp = 24;
  const ark = getMergePreview(state, selected.id, partner.id);
  assert.match(ark.reason, /Arks operate independently/); assert.equal(ark.result, null);
  assert.equal(command(state, ark.command).message, ark.reason);
  selected.type = partner.type = 'scout'; selected.hp = partner.hp = 18;
  const scouts = getMergePreview(state, selected.id, partner.id);
  assert.equal(scouts.enabled, true); assert.ok(command(state, scouts.command).ok); assert.deepEqual(snapshot(selected), scouts.result);
});

test('campaign guards have ordinary precedence but leave structurally legal merge explanations intact', () => {
  for (const alter of [
    state => { faction(state).orders = 0; },
    state => { faction(state).eliminated = true; faction(state).orders = 0; },
    state => { state.winner = 'player'; faction(state).eliminated = true; faction(state).orders = 0; },
  ]) {
    const { state, selected, partner } = fixture(); alter(state);
    for (const view of [getMergePreview(state, selected.id, partner.id), getReinforcementPreview(state, selected.id)]) {
      const before = clone(state);
      assert.equal(view.enabled, false); const result = command(state, view.command);
      assert.equal(result.ok, false); assert.equal(view.reason, result.message); assert.deepEqual(state, before);
      if (view.result) { assert.equal(view.structurallyLegal, true); assert.equal(view.result.maxHp, 170); }
    }
  }
});

test('a full or movement-spent military formation may commission an independent ship only at its own yard', () => {
  const { state, selected } = fixture(); selected.ships = 12; selected.hp = 408; selected.movesLeft = 0; selected.hold = true;
  let view = getReinforcementPreview(state, selected.id);
  assert.equal(view.enabled, true); assert.equal(view.independent, true); assert.ok(command(state, view.command).ok);
  home(state).queue = null;
  for (const type of ['scout', 'colony']) { selected.type = type; assert.equal(getReinforcementPreview(state, selected.id), null); }
  selected.type = 'frigate';
  home(state).buildings = ['mine']; assert.equal(getReinforcementPreview(state, selected.id), null);
  home(state).buildings.push('shipyard'); home(state).owner = 'veyr'; assert.equal(getReinforcementPreview(state, selected.id), null);
  home(state).owner = null; assert.equal(getReinforcementPreview(state, selected.id), null);
});

test('reinforcement quotes use current Forge discounts and ordinary temporary/technology gates', () => {
  const { state, selected } = fixture();
  for (const [level, frigateCost, cruiserCost] of [[0, 35, 85], [1, 32, 77], [2, 28, 68]]) {
    if (level) home(state).charter = { type: 'forge', level }; else delete home(state).charter;
    for (const [type, cost] of [['frigate', frigateCost], ['cruiser', cruiserCost]]) {
      selected.type = type;
      const view = getReinforcementPreview(state, selected.id), trial = clone(state), old = clone(faction(trial));
      assert.equal(view.cost.minerals, cost); assert.equal(view.cost.credits, SHIPS[type].cost.credits);
      assert.equal(view.upkeep, SHIPS[type].upkeep); assert.ok(command(trial, view.command).ok);
      assert.equal(old.minerals - faction(trial).minerals, cost); assert.equal(old.credits - faction(trial).credits, SHIPS[type].cost.credits);
      assert.equal(old.orders - faction(trial).orders, 1); assert.deepEqual(home(trial).queue.cost, view.cost);
    }
  }
  for (const alter of [
    trial => { faction(trial).minerals = 0; },
    trial => { faction(trial).credits = 0; },
    trial => { faction(trial).orders = 0; },
    trial => { faction(trial).techs = faction(trial).techs.filter(id => id !== 'cruisers'); },
    trial => { assert.ok(command(trial, { type: 'build', systemId: 's0', itemId: 'scout' }).ok); },
  ]) {
    const trial = clone(state); alter(trial); const before = clone(trial), view = getReinforcementPreview(trial, selected.id);
    assert.equal(view.enabled, false); const result = command(trial, view.command);
    assert.equal(result.ok, false); assert.equal(result.message, view.reason); assert.deepEqual(trial, before);
  }
});

test('completion is independent of the selected fleet and inherits no course, hold, lead or heritage', () => {
  const { state, selected } = fixture();
  selected.ships = 12; selected.hp = 408; selected.hold = true; selected.defenseLead = true;
  selected.heritage = [heritage(state, 'ancient-escort', selected.id)]; route(state, selected);
  const view = getReinforcementPreview(state, selected.id), baseline = clone(state), priorIds = state.fleets.map(value => value.id);
  assert.ok(command(state, view.command).ok);
  assert.ok(command(baseline, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok);
  assert.deepEqual(home(state).queue, { itemId: 'frigate', kind: 'ship', progress: 0, work: 26, cost: { credits: 25, minerals: 28 } });
  const move = { type: 'move', fleetId: selected.id, targetId: selected.route.destinationId };
  assert.ok(command(state, move).ok); assert.ok(command(baseline, move).ok);
  quietCycle(state); quietCycle(baseline); assert.deepEqual(state, baseline);
  const built = state.fleets.filter(value => value.owner === 'player' && !priorIds.includes(value.id));
  assert.equal(built.length, 1); assert.equal(built[0].systemId, 's0'); assert.equal(built[0].type, 'frigate');
  assert.equal(built[0].ships, 1); assert.equal(built[0].hp, 34); assert.notEqual(built[0].id, selected.id); assert.notEqual(built[0].name, selected.name);
  for (const key of ['route', 'hold', 'defenseLead', 'heritage']) assert.equal(Object.hasOwn(built[0], key), false);
  assert.equal(home(state).queue, null); assert.ok(validateSave(state));
});

test('busy-queue inspection never reprices or refunds an older paid receipt', () => {
  const { state, selected } = fixture(); home(state).charter = { type: 'forge', level: 1 };
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'cruiser' }).ok);
  quietCycle(state); const before = clone(state), receipt = clone(home(state).queue);
  assert.deepEqual(receipt.cost, { credits: 65, minerals: 77 });
  const view = getReinforcementPreview(state, selected.id);
  assert.equal(view.enabled, false); assert.equal(view.reason, 'Construction already in progress');
  assert.deepEqual(view.cost, { credits: 25, minerals: 32 }); assert.deepEqual(state, before);
  assert.equal(command(state, view.command).ok, false); assert.deepEqual(state, before);
  assert.deepEqual(command(state, { type: 'cancelBuild', systemId: 's0' }), command(before, { type: 'cancelBuild', systemId: 's0' }));
  assert.deepEqual(state, before);
});

test('previews are detached and pure on frozen state, with exact post-command and reload continuation', () => {
  const { state, selected, partner } = fixture(); route(state, selected); route(state, partner, 1);
  selected.heritage = [heritage(state, 'a', selected.id)]; partner.heritage = [heritage(state, 'b', partner.id)];
  const saved = JSON.stringify(state), frozen = freeze(clone(state)), baseline = clone(state);
  const merge = getMergePreview(frozen, selected.id, partner.id), build = getReinforcementPreview(frozen, selected.id);
  merge.selected.route.path.push('hidden'); merge.partner.heritage[0].name = 'Changed'; merge.result.heritage[0].name = 'Changed';
  merge.result.route.path[1] = 'hidden'; merge.discarded.route.path[1] = 'hidden'; merge.command.fleetId = 'missing'; build.cost.minerals = 0;
  assert.equal(JSON.stringify(frozen), saved); assert.equal(JSON.stringify(state), saved);
  getMergeOptions(state, selected.id); getReinforcementPreview(state, selected.id);
  assert.deepEqual(command(state, { type: 'merge', fleetId: selected.id, targetFleetId: partner.id }), command(baseline, { type: 'merge', fleetId: selected.id, targetFleetId: partner.id }));
  assert.deepEqual(state, baseline);
  const loaded = clone(state); quietCycle(state); quietCycle(baseline); quietCycle(loaded);
  assert.deepEqual(state, baseline); assert.deepEqual(state, loaded);
});

test('hidden rival metadata and distant fleets do not alter owned options or reveal foreign partners', () => {
  const { state, selected, partner } = fixture();
  const expected = { merge: getMergeOptions(state, selected.id), build: getReinforcementPreview(state, selected.id) };
  const foreign = addFleet(state, { owner: 'khar', systemId: 's0', name: 'Unrevealed opponent' });
  for (const key of ['name', 'ships', 'hp', 'route', 'heritage']) Object.defineProperty(foreign, key, { get() { throw new Error(`Must not inspect foreign ${key}`); } });
  for (const empire of state.factions.filter(value => value.id !== 'player')) { empire.techs = []; empire.credits = 0; empire.minerals = 999999; }
  const hidden = state.systems.find(system => system.id === 's40'); hidden.x += 100; hidden.y -= 100; hidden.name = 'Private world';
  assert.deepEqual({ merge: getMergeOptions(state, selected.id), build: getReinforcementPreview(state, selected.id) }, expected);
  const denied = getMergePreview(state, selected.id, foreign.id);
  assert.equal(denied.partner, null); assert.equal(denied.result, null); assert.equal(denied.structurallyLegal, false);
  assert.equal(getMergePreview(state, foreign.id, partner.id), null);
});

test('an explicit non-player observer sees only its own formations and pays identical ordinary costs', () => {
  const { state, selected, partner } = fixture();
  selected.owner = partner.owner = 'khar'; selected.systemId = partner.systemId = 's2';
  const beforePlayer = clone(faction(state)), beforeKhar = clone(faction(state, 'khar'));
  assert.equal(getMergePreview(state, selected.id, partner.id), null); assert.equal(getReinforcementPreview(state, selected.id), null);
  const merge = getMergePreview(state, selected.id, partner.id, 'khar'); assert.ok(merge.enabled); assert.ok(command(state, merge.command).ok);
  const build = getReinforcementPreview(state, selected.id, 'khar'); assert.ok(build.enabled); assert.ok(command(state, build.command).ok);
  assert.equal(faction(state, 'khar').orders, beforeKhar.orders - 2);
  assert.equal(faction(state, 'khar').credits, beforeKhar.credits - build.cost.credits);
  assert.equal(faction(state, 'khar').minerals, beforeKhar.minerals - build.cost.minerals);
  assert.deepEqual(faction(state), beforePlayer); assert.ok(validateSave(state));
});
