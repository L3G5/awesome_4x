import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getNeighbors, validateSave } from '../src/game.js';
import { advanceDiplomacy } from '../src/diplomacy.js';
import { hasSensors } from '../src/intelligence.js';
import { getPublicRelationships, getPublicDispatches, getKnownTransfers, recordSovereigntyTransfer, validatePublicAffairsState, PUBLIC_AFFAIRS_LIMITS } from '../src/public-affairs.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const contact = (state, first, second) => {
  for (const [a, b] of [[first, second], [second, first]]) if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
};
const act = (state, action) => {
  const result = command(state, action);
  assert.equal(result.ok, true, result.message);
  return result;
};
const diplomatic = (state, stance, extra = {}) => act(state, { type: 'diplomacy', factionId: 'khar', targetId: 'veyr', stance, ...extra });
function war(state, first = 'khar', second = 'veyr', since = 1) {
  contact(state, first, second);
  for (const [a, b] of [[first, second], [second, first]]) Object.assign(faction(state, a).relations[b], { status: 'war', trade: false, treatyTurn: since, truceUntil: 0 });
}
function captureFixture({ charted = true, participant = false } = {}) {
  const state = createGame('public-sovereignty');
  const system = state.systems.find(candidate => candidate.id === 's4');
  Object.assign(system, { owner: 'veyr', population: 1, buildings: [], defenseDamage: 0, queue: null });
  system.knownBy = ['veyr', participant ? 'player' : 'khar', ...(charted ? ['player'] : [])].filter((id, index, all) => all.indexOf(id) === index);
  system.exploredBy = ['veyr'];
  contact(state, 'player', 'veyr');
  const attackerId = participant ? 'player' : 'khar';
  war(state, attackerId, 'veyr');
  const fleet = state.fleets.find(candidate => candidate.owner === attackerId && candidate.type === 'frigate');
  Object.assign(fleet, { systemId: system.id, ships: 3, hp: 102, movesLeft: 1 });
  return { state, system, fleet };
}

test('current foreign relationships obey zero, one and two contact boundaries without writing history', () => {
  const state = createGame('public-relationships');
  state.turn = 12;
  war(state, 'khar', 'veyr', 10);
  const before = structuredClone(state);
  assert.deepEqual(getPublicRelationships(state), []);
  assert.deepEqual(state, before);
  contact(state, 'player', 'veyr');
  const anonymous = getPublicRelationships(state);
  assert.equal(anonymous.length, 1);
  assert.equal(anonymous[0].status, 'war');
  assert.equal(anonymous[0].sinceTurn, 10);
  assert.equal(anonymous[0].key, null);
  assert.deepEqual(anonymous[0].participants.map(person => person.id), ['veyr', null]);
  assert.doesNotMatch(JSON.stringify(anonymous), /khar|Khar|choir|Choir/);
  contact(state, 'player', 'khar');
  const named = getPublicRelationships(state);
  assert.equal(named.length, 1);
  assert.equal(named[0].key, 'khar:veyr');
  assert.deepEqual(new Set(named[0].participants.map(person => person.id)), new Set(['khar', 'veyr']));
  assert.deepEqual(getPublicDispatches(state), []);
  assert.equal(state.publicAffairs, undefined);
});

test('real first contact reveals the current war without fabricating an earlier broadcast', () => {
  const state = createGame('public-first-contact');
  state.turn = 21;
  war(state, 'khar', 'veyr', 20);
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  const neighbor = state.systems.find(system => system.id === getNeighbors(state, scout.systemId)[0]);
  const contactedWorld = state.systems.find(system => system.id === getNeighbors(state, neighbor.id).find(id => id !== scout.systemId));
  Object.assign(contactedWorld, { owner: 'veyr', population: 1, buildings: [], queue: null });
  assert.deepEqual(getPublicRelationships(state), []);
  act(state, { type: 'move', fleetId: scout.id, targetId: neighbor.id });
  assert(faction(state).contacts.includes('veyr'));
  assert(getPublicRelationships(state).some(row => row.status === 'war' && row.sinceTurn === 20));
  assert.deepEqual(getPublicDispatches(state), []);
  assert(state.log.some(entry => entry.text.startsWith('First contact: Veyr')));
  assert.equal(validateSave(state), true);
});

test('a received declaration masks unknown identities and remains frozen after later contact and reload', () => {
  const state = createGame('public-announcement');
  contact(state, 'khar', 'veyr');
  contact(state, 'player', 'veyr');
  diplomatic(state, 'war', { reason: 'Secret fleet f999 will strike s31 with 27 cruisers.' });
  const [received] = getPublicDispatches(state);
  assert.equal(received.kind, 'war');
  assert.equal(received.targetId, 'veyr');
  assert.equal(received.participants[0].id, null);
  assert.equal(received.text, 'Uncontacted civilization declared war on Veyr Consortium.');
  assert.doesNotMatch(JSON.stringify(received), /khar|Khar|s31|f999|cruiser|Secret/);
  const entry = state.log.find(entry => entry.publicAffairId === received.id);
  assert.equal(entry.type, 'war');
  assert.equal(entry.targetId, 'veyr');
  assert.equal(entry.text, received.text);
  assert.throws(() => { received.text = 'changed'; }, TypeError);
  assert.throws(() => { state.publicAffairs.observers.player.dispatches[0].participants[0].id = 'khar'; }, TypeError);
  contact(state, 'player', 'khar');
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(restored), true);
  assert.deepEqual(getPublicDispatches(restored), [received]);
  assert(getPublicRelationships(restored)[0].participants.some(person => person.id === 'khar'));
});

test('public commitments exclude gifts, negotiation escrow, withdrawal counts and private reasons', () => {
  const state = createGame('public-treaties');
  faction(state, 'khar').credits = 500;
  for (const other of ['khar', 'veyr', 'choir']) contact(state, 'player', other);
  contact(state, 'khar', 'veyr');
  diplomatic(state, 'gift');
  assert.deepEqual(getPublicDispatches(state), []);
  diplomatic(state, 'trade');
  diplomatic(state, 'endTrade');
  assert.deepEqual(getPublicDispatches(state).map(entry => entry.kind), ['trade-notice', 'trade']);
  assert.equal(getPublicDispatches(state)[0].untilTurn, 4);
  state.turn = 4;
  advanceDiplomacy(state);
  const once = structuredClone(getPublicDispatches(state));
  advanceDiplomacy(state);
  assert.deepEqual(getPublicDispatches(state), once);
  assert.equal(once[0].kind, 'trade-ended');
  assert.doesNotMatch(JSON.stringify(once), /credits|minerals|fleet|withdrew|grievance|trust/i);

  state.turn = 20;
  war(state);
  faction(state, 'khar').orders = 5;
  diplomatic(state, 'peace');
  const peace = getPublicDispatches(state)[0];
  assert.equal(peace.kind, 'peace');
  assert.equal(peace.untilTurn, 25);
  assert.equal(getPublicRelationships(state).find(row => row.key === 'khar:veyr').status, 'truce');

  war(state, 'khar', 'player');
  const thirdPartyBefore = getPublicDispatches(state, 'choir');
  act(state, { type: 'diplomacy', factionId: 'khar', targetId: 'player', stance: 'peace' });
  assert.deepEqual(getPublicDispatches(state, 'choir'), thirdPartyBefore, 'pending peace negotiations remain private');
  assert.equal(validateSave(state), true);
});

test('player diplomatic actions retain one bilateral log without duplicate public dispatches', () => {
  const state = createGame('public-no-duplicates');
  contact(state, 'player', 'veyr');
  contact(state, 'choir', 'veyr');
  const firstId = state.nextLogId;
  act(state, { type: 'diplomacy', targetId: 'veyr', stance: 'war' });
  assert.equal(state.log.filter(entry => entry.id >= firstId).length, 1);
  assert.equal(state.log[0].publicAffairId, undefined);
  assert.deepEqual(getPublicDispatches(state), []);
  assert.equal(getPublicDispatches(state, 'choir').length, 1);
  assert.equal(validateSave(state), true);
});

test('charted foreign capture opens sovereign contact without survey, neighbor charts or fleet sensors', () => {
  const { state, system, fleet } = captureFixture();
  const knownBefore = state.systems.filter(world => world.knownBy.includes('player')).map(world => world.id);
  const exploredBefore = state.systems.filter(world => world.exploredBy.includes('player')).map(world => world.id);
  assert.equal(hasSensors(state, 'player', system.id), false);
  assert.equal(faction(state).contacts.includes('khar'), false);
  act(state, { type: 'attack', factionId: 'khar', fleetId: fleet.id });
  assert.equal(system.owner, 'khar');
  assert(faction(state).contacts.includes('khar'));
  assert.equal(hasSensors(state, 'player', system.id), false);
  assert.deepEqual(state.systems.filter(world => world.knownBy.includes('player')).map(world => world.id), knownBefore);
  assert.deepEqual(state.systems.filter(world => world.exploredBy.includes('player')).map(world => world.id), exploredBefore);
  const [transfer] = getKnownTransfers(state), [dispatch] = getPublicDispatches(state);
  assert.equal(transfer.systemId, system.id);
  assert.equal(transfer.from.id, 'veyr');
  assert.equal(transfer.to.id, 'khar');
  assert.equal(dispatch.kind, 'sovereignty');
  assert.equal(dispatch.id, transfer.id);
  assert.equal(dispatch.targetId, 'khar');
  assert.doesNotMatch(JSON.stringify(dispatch), /hull|ships|fleet|damage|defense|"f[0-9]+"/i);
  assert.equal(state.combatReports.length, 0);
  assert.equal(validateSave(state), true);
});

test('unknown-world capture sends no ownership event and establishes no observer contact', () => {
  const { state, system, fleet } = captureFixture({ charted: false });
  const observerBefore = structuredClone(faction(state));
  const knownBefore = state.systems.filter(world => world.knownBy.includes('player')).map(world => world.id);
  act(state, { type: 'attack', factionId: 'khar', fleetId: fleet.id });
  assert.equal(system.owner, 'khar');
  assert.deepEqual(faction(state), observerBefore);
  assert.deepEqual(state.systems.filter(world => world.knownBy.includes('player')).map(world => world.id), knownBefore);
  assert.deepEqual(getKnownTransfers(state), []);
  assert.deepEqual(getPublicDispatches(state), []);
  assert.equal(validateSave(state), true);
});

test('a new beacon chart during capture contact does not reveal the preceding unknown ownership transfer', () => {
  const { state, system, fleet } = captureFixture({ charted: false });
  contact(state, 'player', 'khar');
  system.buildings.push('beacon');
  system.knownBy.push('choir');
  assert.equal(system.knownBy.includes('player'), false);
  act(state, { type: 'attack', factionId: 'khar', fleetId: fleet.id });
  assert.equal(system.knownBy.includes('player'), true, 'ordinary new contact runs beacon broadcasts');
  assert.equal(system.exploredBy.includes('player'), false);
  assert.equal(hasSensors(state, 'player', system.id), false);
  assert.deepEqual(getKnownTransfers(state), []);
  assert.deepEqual(getPublicDispatches(state), []);
  assert.equal(validateSave(state), true);
});

test('player captures retain dated map transfers without duplicating their combat report', () => {
  const { state, system, fleet } = captureFixture({ participant: true });
  const firstLogId = state.nextLogId;
  const result = act(state, { type: 'attack', fleetId: fleet.id });
  assert.equal(result.combatReports.length, 1);
  assert.equal(getKnownTransfers(state)[0].to.id, 'player');
  assert.deepEqual(getPublicDispatches(state), []);
  assert.equal(state.log.filter(entry => entry.id >= firstLogId && entry.systemId === system.id && ['combat', 'sovereignty'].includes(entry.type)).length, 1);
  assert.equal(validateSave(state), true);
});

test('public models are invariant to hidden fleets, budgets, private relations and strategy', () => {
  const state = createGame('public-noninterference');
  contact(state, 'khar', 'veyr');
  contact(state, 'player', 'veyr');
  diplomatic(state, 'war');
  const changed = structuredClone(state);
  for (const fleet of changed.fleets.filter(fleet => fleet.owner !== 'player')) {
    fleet.systemId = 's41'; fleet.ships = 12; fleet.hp = 12; fleet.movesLeft = 0;
  }
  for (const empire of changed.factions.filter(empire => empire.id !== 'player')) {
    empire.credits = 99999; empire.minerals = 99999;
    empire.strategy = { mode: 'advance', rallyId: 's0', objectiveId: 's31', turn: changed.turn };
    for (const relation of Object.values(empire.relations)) { relation.trust = -90; relation.grievance = 99; relation.warStartColonies = 40; }
  }
  changed.factions.reverse();
  assert.deepEqual(getPublicRelationships(changed), getPublicRelationships(state));
  assert.deepEqual(getPublicDispatches(changed), getPublicDispatches(state));
  assert.deepEqual(getKnownTransfers(changed), getKnownTransfers(state));
});

test('collapse announces only our own government or a contacted civilization', () => {
  for (const [eliminatedId, contacted, announced] of [['veyr', false, false], ['veyr', true, true], ['player', false, true]]) {
    const state = createGame('public-collapse');
    if (contacted) contact(state, 'player', eliminatedId);
    for (const system of state.systems.filter(system => system.owner === eliminatedId)) { system.owner = null; system.population = 0; }
    state.fleets = state.fleets.filter(fleet => fleet.owner !== eliminatedId);
    act(state, { type: 'research', techId: 'logistics' });
    assert.equal(faction(state, eliminatedId).eliminated, true);
    assert.equal(state.log.some(entry => entry.text === `${faction(state, eliminatedId).name} has collapsed.`), announced);
    assert.equal(validateSave(state), true);
  }
});

test('normal turn briefings retain foreign public declarations without earlier-action duplicates', () => {
  const state = createGame('public-cycle-briefing');
  state.turn = 30;
  for (const other of ['khar', 'veyr']) contact(state, 'player', other);
  contact(state, 'khar', 'veyr');
  // Khar has enough ordinary force and a public shared frontier to act on its grievance.
  const neighborId = getNeighbors(state, 's2')[0];
  const border = state.systems.find(system => system.id === neighborId);
  Object.assign(border, { owner: 'veyr', population: 1, buildings: [], queue: null });
  if (!border.knownBy.includes('khar')) border.knownBy.push('khar');
  faction(state, 'khar').relations.veyr.grievance = 30;
  const fleet = state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'frigate');
  fleet.ships = 4; fleet.hp = 136;
  endTurn(state);
  const declaration = state.lastBriefing.entries.find(entry => entry.publicAffairId && entry.type === 'war');
  assert(declaration, 'a real rival declaration belongs to the latest briefing');
  assert.match(declaration.text, /Khar Dominion declared war on Veyr Consortium/);
  assert.equal(declaration.turn, 30);
  assert.equal(state.lastBriefing.turn, 31);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(restored), true);
  assert.deepEqual(restored.lastBriefing, state.lastBriefing);
});

test('bounded ledgers preserve historical transfers and old log references across save reloads', () => {
  const state = createGame('public-retention');
  for (const other of ['khar', 'veyr']) contact(state, 'player', other);
  contact(state, 'khar', 'veyr');
  faction(state, 'khar').credits = 10000;
  faction(state, 'khar').relations.veyr.trust = 20;
  faction(state, 'veyr').relations.khar.trust = 20;
  for (let i = 0; i < 24; i++) {
    faction(state, 'khar').orders = 5;
    diplomatic(state, 'trade');
    diplomatic(state, 'endTrade');
    state.turn += 3;
    advanceDiplomacy(state);
  }
  assert.equal(getPublicDispatches(state).length, PUBLIC_AFFAIRS_LIMITS.dispatches);
  assert(state.log.some(entry => entry.publicAffairId && entry.publicAffairId < getPublicDispatches(state).at(-1).id));
  const system = state.systems.find(system => system.id === 's4');
  if (!system.knownBy.includes('player')) system.knownBy.push('player');
  for (let i = 0; i < 35; i++) {
    state.turn++;
    const [fromId, toId] = i % 2 ? ['khar', 'veyr'] : ['veyr', 'khar'];
    system.owner = toId;
    recordSovereigntyTransfer(state, { systemId: system.id, fromId, toId, observerIds: ['player'] });
  }
  assert.equal(getKnownTransfers(state, 'player', Infinity).length, PUBLIC_AFFAIRS_LIMITS.transfers);
  assert.equal(getKnownTransfers(state).length, 5);
  const historical = getKnownTransfers(state, 'player', Infinity).at(-1);
  assert.notEqual(historical.from.id, historical.to.id);
  assert.equal(validateSave(state), true);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(restored), true);
  assert.deepEqual(getPublicDispatches(restored), getPublicDispatches(state));
  assert.deepEqual(getKnownTransfers(restored, 'player', Infinity), getKnownTransfers(state, 'player', Infinity));
});

test('legacy saves remain valid and malformed public records fail strict import validation', () => {
  const legacy = createGame('public-save-validation');
  assert.equal(validateSave(legacy), true);
  assert.equal(validatePublicAffairsState(legacy), true);
  assert.deepEqual(getPublicDispatches(legacy), []);
  assert.deepEqual(getKnownTransfers(legacy), []);
  const state = structuredClone(legacy);
  contact(state, 'khar', 'veyr');
  contact(state, 'player', 'veyr');
  diplomatic(state, 'war');
  const mutations = [
    copy => { copy.publicAffairs.version = 2; },
    copy => { copy.publicAffairs.observers.enemy = copy.publicAffairs.observers.player; },
    copy => { copy.publicAffairs.observers.player.nextId = 1; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].turn = copy.turn + 1; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].privateFleet = 'f9'; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].participants[0].id = 'khar'; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].participants[0].name = 'Khar Dominion'; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].targetId = 'khar'; },
    copy => { copy.publicAffairs.observers.player.dispatches[0].text += ' Three cruisers approach.'; },
    copy => { copy.publicAffairs.observers.player.dispatches.push(copy.publicAffairs.observers.player.dispatches[0]); },
    copy => { copy.log.find(entry => entry.publicAffairId).publicAffairId = copy.publicAffairs.observers.player.nextId; },
    copy => { delete copy.publicAffairs; },
  ];
  for (const mutation of mutations) {
    const invalid = structuredClone(state);
    mutation(invalid);
    assert.equal(validateSave(invalid), false, mutation.toString());
  }
});
