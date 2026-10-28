import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, getNeighbors, validateSave } from '../src/game.js';
import { SHIPS } from '../src/content.js';
import { getDefenseOrder, getEngagementPreview } from '../src/combat-preview.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const fleet = (state, owner = 'player', type = 'frigate') => state.fleets.find(candidate => candidate.owner === owner && candidate.type === type);
const system = (state, id) => state.systems.find(candidate => candidate.id === id);
function war(state, first = 'player', second = 'veyr') {
  for (const [a, b] of [[first, second], [second, first]]) {
    Object.assign(faction(state, a).relations[b], { status: 'war', trade: false, treatyTurn: state.turn });
    if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
  }
}

function sequenceFixture() {
  const state = createGame('formation-sequence');
  const attacker = fleet(state), first = fleet(state, 'veyr'), second = fleet(state, 'veyr', 'colony');
  war(state);
  for (const id of ['player', 'veyr']) faction(state, id).techs.push('shields');
  for (const force of [attacker, first]) { force.ships = 4; force.hp = SHIPS.frigate.hp * 4; }
  first.systemId = second.systemId = attacker.systemId;
  // Deliberately put a higher-ID formation before the Ark. The preview must
  // follow engine order rather than ID, name, hull, role, or power sorting.
  state.fleets = [...state.fleets.filter(force => ![first.id, second.id].includes(force.id)), first, second];
  assert.ok(validateSave(state));
  return { state, attacker, first, second };
}

test('visible target order matches actual reports, including continuation after a contested four-round exchange', () => {
  const { state, attacker, first, second } = sequenceFixture();
  const preview = getEngagementPreview(state, attacker.id, attacker.systemId);
  assert.equal(preview.context, 'current-system');
  assert.equal(preview.observed, true);
  assert.deepEqual(preview.opponents.map(force => force.id), [first.id, second.id]);
  const before = structuredClone(state), orders = faction(state).orders, moves = attacker.movesLeft;
  const result = command(state, { type: 'attack', fleetId: attacker.id });
  assert.ok(result.ok, result.message);
  assert.deepEqual(result.combatReports.map(report => report.participants[1].fleetId), preview.opponents.map(force => force.id));
  assert.equal(result.combatReports[0].outcome, 'contested');
  assert.ok(result.combatReports[0].participants.every(participant => participant.shipsAfter > 0));
  assert.equal(result.combatReports[1].participants[0].hullBefore, result.combatReports[0].participants[0].hullAfter);
  assert.equal(result.combatReports[1].outcome, 'defender-destroyed');
  assert.equal(faction(state).orders, orders - 1);
  assert.equal(attacker.movesLeft, moves - 1);
  const control = command(before, { type: 'attack', fleetId: attacker.id });
  assert.deepEqual(result, control);
  assert.deepEqual(state, before, 'viewing the sequence changes neither simulation nor RNG');
  assert.ok(validateSave(state));
});

test('an attacker destroyed in the first exchange never reaches later visible targets', () => {
  const { state, attacker, first, second } = sequenceFixture();
  attacker.ships = 1; attacker.hp = 1;
  const preview = getEngagementPreview(state, attacker.id, attacker.systemId);
  const untouchedSecond = structuredClone(second);
  const result = command(state, { type: 'attack', fleetId: attacker.id });
  assert.ok(result.ok);
  assert.equal(result.combatReports.length, 1);
  assert.equal(result.combatReports[0].outcome, 'attacker-destroyed');
  assert.equal(result.combatReports[0].participants[1].fleetId, preview.opponents[0].id);
  assert.equal(preview.opponents[1].id, second.id);
  assert.deepEqual(second, untouchedSecond, 'listed later opponents are conditional, not guaranteed participants');
  assert.ok(state.fleets.includes(first));
  assert.ok(validateSave(state));
});

test('arrival scope names only the selected attacker and the sensor-visible enemy sequence', () => {
  const { state, attacker, first, second } = sequenceFixture();
  const targetId = getNeighbors(state, attacker.systemId)[0], target = system(state, targetId);
  const observer = fleet(state, 'player', 'scout');
  observer.systemId = first.systemId = second.systemId = targetId;
  const neutral = fleet(state, 'khar'); neutral.systemId = targetId;
  const preview = getEngagementPreview(state, attacker.id, targetId);
  assert.equal(preview.context, 'arrival');
  assert.equal(preview.selected.id, attacker.id);
  assert.deepEqual(preview.otherFriendly.map(force => force.id), [observer.id]);
  assert.deepEqual(preview.opponents.map(force => force.id), [first.id, second.id]);
  const result = command(state, { type: 'move', fleetId: attacker.id, targetId });
  assert.ok(result.ok, result.message);
  assert.deepEqual(result.combatReports.map(report => report.participants[1].fleetId), preview.opponents.map(force => force.id));
  assert.ok(result.combatReports.every(report => report.participants[0].fleetId === attacker.id));
  assert.equal(observer.hp, SHIPS.scout.hp, 'an own formation already present does not join the selected attack');
  assert.equal(neutral.hp, SHIPS.frigate.hp);
  assert.equal(preview.systemName, target.name);
  assert.ok(validateSave(state));
});

test('remembered charts never reveal opposition, even when hidden fleets and defenses change', () => {
  const state = createGame('formation-fog'), attacker = fleet(state), targetId = getNeighbors(state, attacker.systemId)[0];
  const target = system(state, targetId); war(state);
  target.owner = 'veyr'; target.population = 1;
  if (!target.exploredBy.includes('player')) target.exploredBy.push('player');
  const original = getEngagementPreview(state, attacker.id, targetId);
  assert.equal(original.observed, false); assert.equal(original.opponents, null); assert.equal(original.hostileColony, true);
  const changed = structuredClone(state), hidden = fleet(changed, 'veyr');
  hidden.systemId = targetId; hidden.ships = 12; hidden.hp = SHIPS.frigate.hp * 12;
  hidden.name = 'A hidden formation'; hidden.hold = true;
  faction(changed, 'veyr').techs.push('weapons');
  system(changed, targetId).population = 7; system(changed, targetId).buildings.push('bastion');
  assert.deepEqual(getEngagementPreview(changed, attacker.id, targetId), original);
  assert.deepEqual(getDefenseOrder(changed, targetId), []);
  assert.ok(validateSave(state)); assert.ok(validateSave(changed));
});

test('a live empty observation is distinct from unknown opposition and disappears when sensors leave', () => {
  const state = createGame('formation-observation'), attacker = fleet(state), targetId = getNeighbors(state, attacker.systemId)[0];
  const observer = fleet(state, 'player', 'scout'); observer.systemId = targetId;
  const observed = getEngagementPreview(state, attacker.id, targetId);
  assert.equal(observed.observed, true); assert.deepEqual(observed.opponents, []);
  observer.systemId = attacker.systemId;
  const unknown = getEngagementPreview(state, attacker.id, targetId);
  assert.equal(unknown.observed, false); assert.equal(unknown.opponents, null);
});

test('foreign, civilian, missing, unknown and nonadjacent selections have one neutral result', () => {
  const state = createGame('formation-scope'), own = fleet(state), foreign = fleet(state, 'veyr');
  const remote = state.systems.find(world => world.id !== own.systemId && !getNeighbors(state, own.systemId).includes(world.id));
  if (!remote.knownBy.includes('player')) remote.knownBy.push('player');
  for (const [id, targetId, observer] of [
    [foreign.id, own.systemId, 'player'], [own.id, own.systemId, 'veyr'],
    [fleet(state, 'player', 'scout').id, own.systemId, 'player'],
    [fleet(state, 'player', 'colony').id, own.systemId, 'player'],
    ['missing', own.systemId, 'player'], [own.id, 'missing', 'player'],
    [own.id, own.systemId, 'missing'], [own.id, remote.id, 'player'],
  ]) assert.equal(getEngagementPreview(state, id, targetId, observer), null);
  const unknown = system(state, getNeighbors(state, own.systemId)[0]); unknown.knownBy = unknown.knownBy.filter(id => id !== 'player');
  assert.equal(getEngagementPreview(state, own.id, unknown.id), null);
  assert.deepEqual(getDefenseOrder(state, unknown.id), []);
  const before = getEngagementPreview(state, foreign.id, own.systemId);
  foreign.hp = 1; foreign.systemId = unknown.id; foreign.name = 'Private';
  assert.equal(getEngagementPreview(state, foreign.id, own.systemId), before);
});

test('defense order includes civilians and remains independent of Hold, readiness and display sorting', () => {
  const state = createGame('formation-defense');
  const own = state.fleets.filter(force => force.owner === 'player');
  own[0].hold = true; own[1].movesLeft = 0; faction(state).orders = 0;
  state.fleets = [own[2], own[1], own[0], ...state.fleets.filter(force => force.owner !== 'player')];
  const order = getDefenseOrder(state, own[0].systemId);
  assert.deepEqual(order.map(force => force.id), [own[2].id, own[1].id, own[0].id]);
  assert.deepEqual(order.map(force => force.type), ['frigate', 'colony', 'scout']);
  assert.equal(order.reduce((sum, force) => sum + force.ships, 0), 3);
  assert.deepEqual(getDefenseOrder(state, 'missing'), []);
  assert.deepEqual(getDefenseOrder(state, own[0].systemId, 'missing'), []);
});

test('preview and defense snapshots are pure, copied and contain no orders, plans, heritage or research', () => {
  const { state, attacker } = sequenceFixture();
  attacker.hold = true;
  const before = structuredClone(state), preview = getEngagementPreview(state, attacker.id, attacker.systemId), defense = getDefenseOrder(state, attacker.systemId);
  assert.deepEqual(state, before);
  const keys = ['hp', 'id', 'maxHp', 'name', 'owner', 'ships', 'type'];
  for (const item of [preview.selected, ...preview.opponents, ...preview.otherFriendly, ...defense]) assert.deepEqual(Object.keys(item).sort(), keys);
  preview.selected.hp = 0; preview.opponents[0].name = 'Changed'; preview.otherFriendly[0].ships = 99; defense[0].type = 'cruiser';
  preview.opponents.reverse(); defense.reverse();
  assert.deepEqual(state, before);
});
