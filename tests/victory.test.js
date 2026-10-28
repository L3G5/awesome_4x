import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getEmpireStats, getVictoryProgress, validateSave, hasSensors, getVisibleFleets } from '../src/game.js';
import { advanceAlignment, getAlignmentStatus, getPublicRaces, revealPublicBeacons, validateAlignmentState } from '../src/victory.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const world = (state, id) => state.systems.find(candidate => candidate.id === id);
const contact = (state, first = 'player', second = 'veyr') => {
  for (const [a, b] of [[first, second], [second, first]]) if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
};
const war = (state, first, second) => {
  for (const [a, b] of [[first, second], [second, first]]) Object.assign(faction(state, a).relations[b], { status: 'war', trade: false });
};
const nextCycle = state => { state.turn++; return advanceAlignment(state); };
const alignmentLogs = state => state.log.filter(entry => entry.type === 'alignment');

function readyEmpire(owner = 'player', count = 3) {
  const state = createGame('alignment-test');
  const empire = faction(state, owner);
  empire.techs = ['physics', 'logistics', 'industry', 'computing', 'singularity'];
  empire.credits = 1000;
  const sites = [empire.capitalId, 's4', 's5', 's6'].slice(0, count);
  for (const id of sites) {
    const system = world(state, id);
    system.owner = owner;
    system.population = 4;
    if (!system.buildings.includes('beacon')) system.buildings.push('beacon');
    if (!system.knownBy.includes(owner)) system.knownBy.push(owner);
    if (!system.exploredBy.includes(owner)) system.exploredBy.push(owner);
  }
  return state;
}

function quietRivals(state) {
  // Isolate end-turn payment and victory timing from rival policies.
  for (const empire of state.factions.filter(candidate => candidate.id !== 'player')) empire.eliminated = true;
}

test('alignment forecast is pure and owning three beacons alone cannot win', () => {
  const state = readyEmpire();
  faction(state).techs = faction(state).techs.filter(id => id !== 'singularity');
  const before = structuredClone(state);
  const status = getAlignmentStatus(state);
  assert.equal(status.beacons, 3);
  assert.equal(status.ready, false);
  assert.match(status.reason, /Protocol/);
  assert.deepEqual(state, before);
  assert.equal(command(state, { type: 'research', techId: 'ecology' }).ok, true);
  assert.equal(state.winner, null);
  advanceAlignment(state);
  assert.equal(faction(state).alignment.progress, 0);
  assert.equal(faction(state).credits, before.factions[0].credits);
});

test('each completed cycle charges exactly once and ordinary commands cannot advance alignment', () => {
  const state = readyEmpire();
  const start = faction(state).credits;
  assert.equal(advanceAlignment(state).advanced, true);
  assert.equal(faction(state).alignment.progress, 1);
  assert.equal(faction(state).credits, start - 60);
  const after = structuredClone(state);
  assert.equal(advanceAlignment(state).advanced, false);
  assert.deepEqual(state, after);
  assert.equal(command(state, { type: 'research', techId: 'ecology' }).ok, true);
  assert.equal(command(state, { type: 'research', techId: 'weapons' }).ok, true);
  assert.equal(faction(state).alignment.progress, 1);
  assert.equal(faction(state).credits, start - 60);
  nextCycle(state);
  assert.equal(faction(state).alignment.progress, 2);
  assert.equal(faction(state).credits, start - 120);
});

test('turn processing uses newly earned credits and a beacon completed that cycle', () => {
  const state = readyEmpire();
  quietRivals(state);
  const empire = faction(state), completing = world(state, 's5');
  for (const system of state.systems.filter(system => system.owner === 'player')) system.population = 10;
  completing.buildings = completing.buildings.filter(id => id !== 'beacon');
  completing.queue = { itemId: 'beacon', kind: 'building', progress: 139, work: 140, cost: { credits: 180, minerals: 180 } };
  empire.credits = 0;
  const income = getEmpireStats(state).creditIncome;
  assert.ok(income >= 60);
  assert.equal(getAlignmentStatus(state).ready, false);
  assert.equal(endTurn(state).ok, true);
  assert.ok(completing.buildings.includes('beacon'));
  assert.equal(empire.alignment.progress, 1);
  assert.equal(empire.credits, income - 60);
  assert.equal(getVictoryProgress(state).transcendence.alignment, 1);
});

test('transcendence needs ten qualifying full turns and then rejects more turns', () => {
  const state = readyEmpire();
  quietRivals(state);
  for (let progress = 1; progress <= 10; progress++) {
    assert.equal(endTurn(state).ok, true);
    assert.equal(faction(state).alignment.progress, progress);
    assert.equal(state.winner, progress < 10 ? null : 'player');
  }
  assert.equal(state.victoryType, 'Transcendence');
  const finished = structuredClone(state);
  assert.equal(endTurn(state).ok, false);
  assert.equal(advanceAlignment(state).advanced, false);
  assert.deepEqual(state, finished);
});

test('only hostile warships blockade a participating beacon', () => {
  const state = readyEmpire();
  const visitor = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'scout');
  visitor.systemId = 's0';
  war(state, 'player', 'veyr');
  assert.equal(getAlignmentStatus(state).ready, true, 'an armed scout is not a military blockade');
  visitor.type = 'colony';
  assert.equal(getAlignmentStatus(state).ready, true);
  visitor.type = 'frigate';
  assert.equal(getAlignmentStatus(state).ready, false);
  assert.match(getAlignmentStatus(state).reason, /Hostile warships.*Solace/);
  faction(state).relations.veyr.status = 'peace';
  assert.equal(getAlignmentStatus(state).ready, true, 'a peaceful visitor does not blockade');
  visitor.owner = 'player';
  assert.equal(getAlignmentStatus(state).ready, true, 'own warships do not blockade');
});

test('blockade pauses payment, regresses progress, and recovery resumes the race', () => {
  const state = readyEmpire();
  advanceAlignment(state);
  nextCycle(state);
  const start = faction(state).credits;
  const hostile = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  hostile.systemId = 's4';
  war(state, 'player', 'veyr');
  nextCycle(state);
  assert.equal(faction(state).alignment.progress, 1);
  assert.equal(faction(state).credits, start);
  assert.equal(faction(state).alignment.active, false);
  assert.match(alignmentLogs(state)[0].text, /interrupted.*Hostile warships/);
  hostile.systemId = 's1';
  nextCycle(state);
  assert.equal(faction(state).alignment.progress, 2);
  assert.equal(faction(state).credits, start - 60);
  assert.match(alignmentLogs(state)[0].text, /resumes/);
});

test('insufficient funding decays to zero without charging or repeated pause notices', () => {
  const state = readyEmpire();
  advanceAlignment(state);
  nextCycle(state);
  faction(state).credits = 59;
  for (let i = 0; i < 4; i++) nextCycle(state);
  assert.equal(faction(state).credits, 59);
  assert.equal(faction(state).alignment.progress, 0);
  assert.equal(alignmentLogs(state).filter(entry => entry.text.includes('interrupted')).length, 1);
  faction(state).credits = 60;
  nextCycle(state);
  assert.equal(faction(state).credits, 0);
  assert.equal(faction(state).alignment.progress, 1);
});

test('participating sites remain stable through blockades and replace only lost worlds', () => {
  const state = readyEmpire('player', 4);
  faction(state).alignment = { progress: 2, sites: ['s4', 's5', 's6'], active: true, started: true, reportedBeacons: ['s0', 's4', 's5', 's6'] };
  const hostile = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  hostile.systemId = 's4';
  war(state, 'player', 'veyr');
  assert.deepEqual(getAlignmentStatus(state).sites, ['s4', 's5', 's6']);
  assert.equal(getAlignmentStatus(state).ready, false, 'an unblocked spare does not replace a blockaded participant');
  world(state, 's4').owner = 'veyr';
  assert.deepEqual(getAlignmentStatus(state).sites, ['s5', 's6', 's0']);
  assert.equal(getAlignmentStatus(state).ready, true, 'a spare replaces a captured participant');
  world(state, 's5').owner = 'veyr';
  const credits = faction(state).credits;
  advanceAlignment(state);
  assert.equal(faction(state).alignment.progress, 1);
  assert.equal(faction(state).credits, credits);
  assert.equal(validateAlignmentState(state), true);
});

test('public broadcasts chart contacted beacon worlds without surveying or granting sensors', () => {
  const state = readyEmpire('veyr');
  const sites = getAlignmentStatus(state, 'veyr').sites;
  faction(state).contacts = faction(state).contacts.filter(id => id !== 'veyr');
  for (const id of sites) {
    world(state, id).knownBy = world(state, id).knownBy.filter(id => id !== 'player');
    world(state, id).exploredBy = world(state, id).exploredBy.filter(id => id !== 'player');
  }
  const otherKnowledge = state.systems.filter(system => !sites.includes(system.id)).map(system => [...system.knownBy]);
  revealPublicBeacons(state);
  assert.ok(sites.every(id => !world(state, id).knownBy.includes('player')));
  assert.ok(!getPublicRaces(state).some(race => race.factionId === 'veyr'));
  contact(state);
  revealPublicBeacons(state);
  assert.ok(sites.every(id => world(state, id).knownBy.includes('player')));
  assert.ok(sites.every(id => !world(state, id).exploredBy.includes('player')));
  assert.ok(sites.every(id => !hasSensors(state, 'player', id)));
  assert.deepEqual(state.systems.filter(system => !sites.includes(system.id)).map(system => system.knownBy), otherKnowledge);
  assert.ok(alignmentLogs(state).every(entry => sites.includes(entry.systemId)));
  const announced = structuredClone(state);
  revealPublicBeacons(state);
  assert.deepEqual(state, announced, 'broadcast charting and announcements are idempotent');
});

test('first contact charts existing beacon broadcasts through the normal movement command', () => {
  const state = readyEmpire('veyr');
  const sites = getAlignmentStatus(state, 'veyr').sites;
  faction(state).contacts = faction(state).contacts.filter(id => id !== 'veyr');
  faction(state, 'veyr').contacts = faction(state, 'veyr').contacts.filter(id => id !== 'player');
  for (const id of sites) {
    world(state, id).knownBy = world(state, id).knownBy.filter(id => id !== 'player');
    world(state, id).exploredBy = world(state, id).exploredBy.filter(id => id !== 'player');
  }
  const meeting = world(state, 's10');
  meeting.owner = null;
  if (!meeting.knownBy.includes('player')) meeting.knownBy.push('player');
  if (!state.lanes.some(([a, b]) => a === 's0' && b === meeting.id || b === 's0' && a === meeting.id)) state.lanes.push(['s0', meeting.id]);
  state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'scout').systemId = meeting.id;
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: meeting.id }).ok, true);
  assert.ok(faction(state).contacts.includes('veyr'));
  assert.ok(sites.every(id => world(state, id).knownBy.includes('player')));
  assert.ok(sites.every(id => !world(state, id).exploredBy.includes('player')));
  assert.ok(getPublicRaces(state).some(race => race.factionId === 'veyr' && race.beacons === 3));
  assert.ok(getVisibleFleets(state, 'player').every(fleet => fleet.owner === 'player' || fleet.systemId === meeting.id));
});

test('public race queries never inspect hidden fleets, money, or denial reasons', () => {
  const state = readyEmpire('veyr');
  contact(state);
  advanceAlignment(state);
  const before = structuredClone(state);
  const races = getPublicRaces(state);
  assert.deepEqual(state, before);
  const hostile = state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'frigate');
  war(state, 'veyr', 'khar');
  hostile.systemId = 's1';
  faction(state, 'veyr').credits = 0;
  assert.equal(getAlignmentStatus(state, 'veyr').ready, false);
  assert.deepEqual(getPublicRaces(state), races, 'public active is the last completed-cycle signal, not live readiness');
  const row = races.find(race => race.factionId === 'veyr');
  assert.ok(!('ready' in row) && !('reason' in row) && !('credits' in row));
  assert.deepEqual(Object.keys(row.sites[0]).sort(), ['id', 'name', 'owner', 'x', 'y']);
  Object.defineProperty(state, 'fleets', { get() { throw new Error('Public race query read fleet intelligence'); } });
  assert.deepEqual(getPublicRaces(state), races);
});

test('foreign interruption announcements give no hidden blockade details', () => {
  const state = readyEmpire('veyr');
  contact(state);
  advanceAlignment(state);
  const hostile = state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'frigate');
  hostile.name = 'Hidden task force';
  hostile.systemId = 's1';
  war(state, 'veyr', 'khar');
  nextCycle(state);
  const notice = alignmentLogs(state).find(entry => entry.text.includes('interrupted'));
  assert.ok(notice);
  assert.doesNotMatch(notice.text, /warships|blockade|Hidden task force|Khar|credits/i);
  assert.ok(getPublicRaces(state).find(race => race.factionId === 'veyr').sites.some(site => site.id === notice.systemId));
});

test('alignment saves resume deterministically, including an already paid cycle', () => {
  const state = readyEmpire();
  advanceAlignment(state);
  nextCycle(state);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateAlignmentState(restored), true);
  assert.equal(validateSave(restored), true);
  const paid = restored.factions[0].credits;
  assert.equal(advanceAlignment(restored).advanced, false);
  assert.equal(restored.factions[0].credits, paid);
  nextCycle(state);
  nextCycle(restored);
  assert.deepEqual(restored, state);
  endTurn(state);
  endTurn(restored);
  assert.deepEqual(restored, state);
});

test('optional alignment metadata preserves old saves and strictly validates present fields', () => {
  const old = createGame('old-alignment-save');
  assert.equal(validateAlignmentState(old), true);
  assert.equal(validateSave(old), true);
  const state = readyEmpire();
  advanceAlignment(state);
  for (const invalid of [null, [], { ...faction(state).alignment, progress: -1 }, { ...faction(state).alignment, progress: 11 }, { ...faction(state).alignment, progress: 1.5 }, { ...faction(state).alignment, sites: ['s0', 's0'] }, { ...faction(state).alignment, sites: ['s99'] }, { ...faction(state).alignment, sites: ['s0', 's4', 's5', 's6'] }, { ...faction(state).alignment, reportedBeacons: ['s0', 's0'] }, { ...faction(state).alignment, active: 'yes' }, { ...faction(state).alignment, started: false }, { ...faction(state).alignment, progress: 0 }]) {
    const copy = structuredClone(state);
    faction(copy).alignment = invalid;
    assert.equal(validateAlignmentState(copy), false);
    assert.equal(validateSave(copy), false);
  }
  for (const stamp of [-1, state.turn + 1, 1.5, '1']) {
    const copy = structuredClone(state);
    copy.alignmentUpdatedTurn = stamp;
    assert.equal(validateAlignmentState(copy), false);
    assert.equal(validateSave(copy), false);
  }
});

test('already won legacy saves remain concluded without retroactive charges', () => {
  const state = createGame('old-winner');
  state.winner = 'player';
  state.victoryType = 'Transcendence';
  assert.equal(validateSave(state), true);
  const before = structuredClone(state);
  assert.equal(advanceAlignment(state).advanced, false);
  assert.equal(endTurn(state).ok, false);
  assert.deepEqual(state, before);
});
