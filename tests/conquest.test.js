import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { createGame, command, endTurn, getNeighbors, hasSensors, validateSave } from '../src/game.js';
import { getConquestView } from '../src/conquest.js';

const faction = (state, id = 'player') => state.factions.find(faction => faction.id === id);
const world = (state, id) => state.systems.find(system => system.id === id);
const viewEmpire = (view, id = 'player') => view.empires.find(empire => empire.factionId === id);
const clone = value => JSON.parse(JSON.stringify(value));
function contact(state, observer, other) {
  if (!faction(state, observer).contacts.includes(other)) faction(state, observer).contacts.push(other);
}
function survey(state, systemId, observer = 'player') {
  const system = world(state, systemId);
  if (!system.knownBy.includes(observer)) system.knownBy.push(observer);
  if (!system.exploredBy.includes(observer)) system.exploredBy.push(observer);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('the exact actual cycle55 export identifies all four worlds, Concord three and Lumen under Choir', () => {
  // Reuse the committed actual export; do not duplicate it or substitute a
  // synthetic checkpoint. This campaign was complete before this projection.
  const raw = readFileSync(new URL('../docs/military-playtest/replay/actual-exports/cycle55.json', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), 'f43cffaf6a72be7a2c422f0988ab6931acc0d895afd1df925aabbc8485053f8e');
  const state = JSON.parse(raw), before = JSON.stringify(state), view = getConquestView(state);
  assert.equal(validateSave(state), true);
  assert.deepEqual(view.worlds.map(system => system.name), ['Solace', 'Veyr Prime', 'Kharos', 'Lumen']);
  assert.equal(view.target, 4); assert.equal(view.knownCount, 4); assert.equal(view.unknownCount, 0); assert.equal(view.complete, true);
  assert.equal(viewEmpire(view).controlled, 3); assert.equal(viewEmpire(view).exact, true);
  assert.equal(view.worlds[3].sovereign.factionId, 'choir');
  assert.equal(view.worlds[1].founder.factionId, 'veyr');
  assert.equal(view.worlds[1].sovereign.factionId, 'player');
  assert.ok(view.empires.every(empire => empire.exact));
  assert.equal(state.winner, null, 'complete recognition does not mean victory');
  assert.equal(JSON.stringify(state), before);
});

test('charting and diplomatic contact do not identify an unsurveyed founding world', () => {
  const state = createGame('CONQUEST-KNOWLEDGE');
  for (const id of ['veyr', 'khar', 'choir']) contact(state, 'player', id);
  for (const system of state.systems) if (!system.knownBy.includes('player')) system.knownBy.push('player');
  const view = getConquestView(state);
  assert.deepEqual(view.worlds.map(system => system.id), ['s0']);
  assert.equal(view.knownCount, 1); assert.equal(view.unknownCount, 3); assert.equal(view.complete, false);
  assert.deepEqual(viewEmpire(view), { factionId: 'player', name: 'The Concord', shortName: 'Concord', color: '#68d9cd', controlled: 1, exact: true });
  for (const empire of view.empires.filter(empire => empire.factionId !== 'player')) {
    assert.equal(empire.controlled, 0); assert.equal(empire.exact, false);
  }
  for (const name of ['Veyr Prime', 'Kharos', 'Lumen']) assert.equal(JSON.stringify(view).includes(name), false);
});

test('ownership alone recognizes an unsurveyed world and keeps own control exact', () => {
  const state = createGame('OWNED-FOUNDING');
  Object.assign(world(state, 's1'), { owner: 'player', knownBy: [], exploredBy: [] });
  const view = getConquestView(state);
  assert.deepEqual(view.worlds.map(system => system.id), ['s0', 's1']);
  assert.equal(viewEmpire(view).controlled, 2); assert.equal(viewEmpire(view).exact, true);
  assert.deepEqual(view.worlds[1].founder, { status: 'unknown' });
  assert.equal(view.worlds[1].sovereign.factionId, 'player');
  assert.equal(view.unknownCount, 2);
});

test('uncontacted founders and sovereigns stay anonymous, distinct from genuinely unowned worlds', () => {
  const state = createGame('ANONYMOUS-FOUNDING');
  survey(state, 's1'); survey(state, 's2');
  world(state, 's1').owner = 'choir'; world(state, 's2').owner = null;
  const before = getConquestView(state);
  assert.deepEqual(before.worlds[1].founder, { status: 'unknown' });
  assert.deepEqual(before.worlds[1].sovereign, { status: 'unknown' });
  assert.deepEqual(before.worlds[2].sovereign, { status: 'unowned' });
  assert.deepEqual(before.empires.map(empire => empire.factionId), ['player']);
  for (const value of ['veyr', 'khar', 'choir', 'Veyr Consortium', 'The Luminous Choir']) assert.equal(JSON.stringify(before).includes(value), false);
  const anonymousSwap = clone(state);
  world(anonymousSwap, 's1').owner = 'khar'; world(anonymousSwap, 's1').originalOwner = 'choir';
  for (const empire of anonymousSwap.factions.filter(empire => empire.id !== 'player')) {
    empire.name = 'Another uncontacted government'; empire.shortName = 'Hidden'; empire.color = '#ffffff';
  }
  assert.deepEqual(getConquestView(anonymousSwap), before, 'unknown identities are not distinguishable through hidden IDs, names or colors');
  contact(state, 'player', 'choir');
  const after = getConquestView(state);
  assert.equal(after.worlds[1].sovereign.factionId, 'choir');
  assert.deepEqual(after.worlds[1].founder, { status: 'unknown' });
  assert.equal(viewEmpire(after, 'choir').controlled, 1); assert.equal(viewEmpire(after, 'choir').exact, false);
  assert.equal(after.unknownCount, before.unknownCount, 'contact does not recognize another world');
});

test('hidden ownership, founder status, names, positions, fleets and research cannot change the view', () => {
  const state = createGame('CONQUEST-FOG'); contact(state, 'player', 'veyr');
  const expected = getConquestView(state), changed = clone(state);
  for (const system of changed.systems.filter(system => system.owner !== 'player' && !system.exploredBy.includes('player'))) {
    system.owner = system.owner === 'veyr' ? 'khar' : 'veyr';
    system.originalOwner = system.originalOwner ? null : 'choir';
    system.name = 'Unseen changed world'; system.x += 1000; system.y -= 1000;
    system.buildings = ['beacon']; system.population = 12;
  }
  for (const force of changed.fleets.filter(force => force.owner !== 'player')) {
    force.type = 'cruiser'; force.ships = 12; force.hp = 1020; force.systemId = 's30';
  }
  for (const empire of changed.factions.filter(empire => empire.id !== 'player')) {
    empire.techs = ['weapons', 'shields']; empire.capitalId = 's30';
  }
  assert.deepEqual(getConquestView(changed), expected);
  // Stronger than a value perturbation: unrecognized founding status and
  // unrelated tactical arrays are never accessed, even to count placeholders.
  for (const system of state.systems.filter(system => system.owner !== 'player' && !system.exploredBy.includes('player'))) {
    for (const key of ['originalOwner', 'name', 'x', 'y']) Object.defineProperty(system, key, { get() { throw new Error(`Unobserved ${key} read`); } });
  }
  Object.defineProperty(state, 'fleets', { get() { throw new Error('Fleet intelligence read'); } });
  assert.deepEqual(getConquestView(state), expected);
});

test('projection snapshots are pure, independent copies with stable order', () => {
  const state = createGame('CONQUEST-PURITY');
  contact(state, 'player', 'veyr'); survey(state, 's1');
  const before = clone(state), view = getConquestView(freeze(state));
  view.worlds[0].name = 'Changed presentation'; view.worlds[0].founder.name = 'Changed founder';
  view.worlds[1].sovereign.color = '#ffffff'; view.empires[0].name = 'Changed government';
  view.worlds.pop(); view.empires.pop();
  assert.deepEqual(state, before);
  const reversed = clone(state); reversed.systems.reverse(); reversed.factions.reverse();
  assert.deepEqual(getConquestView(reversed), getConquestView(state));
  assert.equal(getConquestView(state, 'missing'), null); assert.equal(getConquestView(null), null);
});

test('all governments receive their own knowledge scope rather than the player observer scope', () => {
  const state = createGame('FOREIGN-OBSERVER');
  contact(state, 'veyr', 'player'); survey(state, 's0', 'veyr');
  const veyr = getConquestView(state, 'veyr'), player = getConquestView(state);
  assert.deepEqual(veyr.worlds.map(system => system.id), ['s0', 's1']);
  assert.equal(viewEmpire(veyr, 'veyr').controlled, 1); assert.equal(viewEmpire(veyr, 'veyr').exact, true);
  assert.equal(viewEmpire(veyr, 'player').controlled, 1); assert.equal(viewEmpire(veyr, 'player').exact, false);
  assert.deepEqual(player.worlds.map(system => system.id), ['s0']);
  assert.equal(viewEmpire(player, 'veyr'), undefined);
});

test('ordinary movement recognizes a surveyed founding world and uses its normal local contacts', () => {
  const state = createGame('CONQUEST-SURVEY');
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  const home = world(state, 's1'); home.owner = null;
  state.lanes.push([scout.systemId, home.id]);
  if (!home.knownBy.includes('player')) home.knownBy.push('player');
  assert.equal(getConquestView(state).knownCount, 1);
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: home.id }).ok, true);
  const view = getConquestView(state);
  assert.equal(view.knownCount, 2); assert.equal(view.unknownCount, 2);
  assert.deepEqual(view.worlds[1].sovereign, { status: 'unowned' });
  assert.equal(view.worlds[1].founder.factionId, 'veyr', 'the Veyr ships actually encountered here establish normal contact');
  assert.ok(faction(state).contacts.includes('veyr'));
  assert.equal(viewEmpire(view).controlled, 1);
  assert.equal(validateSave(state), true);
});

test('ordinary capture and recapture preserve the fixed founding identity across capital relocation', () => {
  const state = createGame('FOUNDING-RECAPTURE');
  const player = faction(state), veyr = faction(state, 'veyr'), home = world(state, 's1'), refuge = world(state, 's4');
  Object.assign(refuge, { owner: 'veyr', population: 4, buildings: ['mine'], queue: null });
  survey(state, refuge.id, 'veyr');
  survey(state, refuge.id, 'player');
  for (const [first, second] of [['player', 'veyr'], ['veyr', 'player']]) {
    contact(state, first, second);
    Object.assign(faction(state, first).relations[second], { status: 'war', trade: false, treatyTurn: state.turn });
  }
  const attacker = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate');
  Object.assign(attacker, { systemId: home.id, type: 'cruiser', ships: 12, hp: 1020, movesLeft: 2 });
  for (const force of state.fleets.filter(fleet => fleet.owner === 'veyr')) force.systemId = refuge.id;
  survey(state, home.id);
  assert.equal(command(state, { type: 'attack', fleetId: attacker.id }).ok, true);
  assert.equal(home.owner, 'player'); assert.equal(veyr.capitalId, refuge.id);
  let view = getConquestView(state);
  assert.equal(viewEmpire(view).controlled, 2);
  assert.equal(view.worlds.find(system => system.id === home.id).founder.factionId, 'veyr');
  assert.equal(view.worlds.some(system => system.id === refuge.id), false);

  const escapeId = getNeighbors(state, home.id).find(id => !world(state, id).owner || world(state, id).owner === 'player');
  assert.ok(escapeId);
  assert.equal(command(state, { type: 'move', fleetId: attacker.id, targetId: escapeId }).ok, true);
  const retaker = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  Object.assign(retaker, { systemId: home.id, type: 'cruiser', ships: 12, hp: 1020, movesLeft: 1 });
  assert.equal(command(state, { type: 'attack', factionId: 'veyr', fleetId: retaker.id }).ok, true);
  assert.equal(home.owner, 'veyr'); assert.equal(veyr.capitalId, refuge.id, 'the administrative capital need not move back');
  assert.equal(hasSensors(state, 'player', home.id), false, 'sovereignty remains known after local sensors leave');
  view = getConquestView(state);
  assert.equal(viewEmpire(view).controlled, 1); assert.equal(viewEmpire(view, 'veyr').controlled, 1);
  assert.equal(view.worlds.find(system => system.id === home.id).founder.factionId, 'veyr');
  assert.equal(view.worlds.some(system => system.id === refuge.id), false);
  assert.equal(player.capitalId, 's0');
  assert.equal(validateSave(state), true);
  const restored = clone(state);
  assert.deepEqual(getConquestView(restored), view);
  const before = clone(state); getConquestView(state); getConquestView(state, 'veyr');
  assert.deepEqual(state, before);
  endTurn(state); endTurn(restored);
  assert.deepEqual(clone(state), restored, 'viewing and reloading leave the complete next cycle identical');
});
