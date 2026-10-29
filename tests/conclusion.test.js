import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, validateSave } from '../src/game.js';
import { getCampaignConclusion } from '../src/conclusion.js';
import { getCombatReport } from '../src/reports.js';
import { getDiscoveryView } from '../src/discoveries.js';
import { FACTIONS } from '../src/content.js';

const clone = value => JSON.parse(JSON.stringify(value));
const player = state => state.factions.find(faction => faction.id === 'player');
const world = (state, id) => state.systems.find(system => system.id === id);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function actual(relativePath, expectedHash) {
  const raw = readFileSync(new URL(relativePath, import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), expectedHash, 'use the unchanged actual UI export');
  const state = JSON.parse(raw);
  assert.equal(validateSave(state), true);
  return state;
}
const watch = () => actual('../docs/watch-playtest/checkpoints/cycle60.json', '56f15cb50cfaeebbe323af3ad65f7036d3f3d25bc9b5ceea896eb6ab9b2098ec');
const iron = () => actual('../docs/military-playtest/replay/actual-exports/cycle57.json', 'fe3858c69ca3b49d9213b80a995127207f7b851c0e5bdea4858579fe33597397');
function finished(seed = 'CONCLUSION') {
  const state = createGame(seed);
  Object.assign(state, { winner: 'player', victoryType: 'Legacy', turn: 120 });
  return state;
}
function assertSafeMoments(state, view) {
  assert.ok(view.moments.length <= 6);
  assert.equal(new Set(view.moments.map(moment => moment.category)).size, view.moments.length);
  for (const moment of view.moments) {
    const entry = state.log.find(entry => entry.id === moment.id);
    assert.ok(entry);
    for (const key of ['id', 'turn', 'type', 'text']) assert.equal(moment[key], entry[key]);
    for (const link of moment.links) {
      if (link.kind === 'report') assert.ok(getCombatReport(state, link.reportId));
      else {
        const system = world(state, link.systemId);
        assert.ok(system && (system.owner === 'player' || system.exploredBy.includes('player') || system.knownBy.includes('player')));
        if (link.kind === 'discovery') assert.ok(getDiscoveryView(state, system.id));
        else assert.equal(link.kind, 'world');
      }
    }
  }
}

test('a conclusion requires a recorded winner and an existing player', () => {
  const state = createGame('STILL-PLAYING');
  assert.equal(getCampaignConclusion(state), null);
  assert.equal(getCampaignConclusion(null), null);
  assert.equal(getCampaignConclusion(undefined), null);
  state.winner = 'player'; state.victoryType = 'Legacy';
  assert.ok(getCampaignConclusion(state));
  state.factions = state.factions.filter(faction => faction.id !== 'player');
  assert.equal(getCampaignConclusion(state), null);
});

test('the actual WATCH cycle 60 export retains its result, own holdings and recorded network', () => {
  const state = watch(), before = JSON.stringify(state), view = getCampaignConclusion(state);
  assert.deepEqual(view.outcome, {
    winnerId: 'player', winnerName: 'The Concord', winnerShortName: 'Concord', winnerColor: '#68d9cd',
    victoryType: 'Transcendence', turn: 60, seed: 'ASTERION-WATCH-14', playerWon: true,
  });
  assert.deepEqual(view.holdings, {
    worlds: 5, population: 43, ships: 17, militaryShips: 16, technologies: 11, legacy: 698,
    resources: { credits: 897, minerals: 387, science: 0, orders: 13 },
  });
  assert.deepEqual(view.conquest, { controlled: 1, target: 4, worlds: [{ id: 's0', name: 'Solace' }] });
  assert.deepEqual(view.network, {
    beacons: 4, requiredBeacons: 3, hasProtocol: true, hasRecordedAlignment: true,
    progress: 10, target: 10, cost: 60, active: true,
    sites: [{ id: 's20', name: 'Sundrift' }, { id: 's0', name: 'Solace' }, { id: 's28', name: 'Haven' }],
  });
  assert.deepEqual(view.history, {
    scope: 'retained', logCount: 149, logLimit: 160, reportCount: 4, reportLimit: 50,
    earliestLogTurn: 1, latestLogTurn: 60, earliestReportTurn: 55, latestReportTurn: 57,
  });
  assert.deepEqual(view.moments.map(moment => moment.id), [145, 144, 137, 136, 125, 51]);
  assertSafeMoments(state, view);
  assert.equal(JSON.stringify(state), before);
});

test('the actual IRON cycle 57 export reports final founding control and bounded retained history', () => {
  const state = iron(), view = getCampaignConclusion(state);
  assert.equal(view.outcome.victoryType, 'Domination');
  assert.equal(view.outcome.turn, 57); assert.equal(view.outcome.seed, 'IRON-COVENANT-10');
  assert.deepEqual(view.holdings, {
    worlds: 12, population: 104, ships: 15, militaryShips: 15, technologies: 11, legacy: 745,
    resources: { credits: 2892, minerals: 1005, science: 0, orders: 16 },
  });
  assert.equal(view.conquest.controlled, 4);
  assert.deepEqual(view.conquest.worlds.map(system => system.name), ['Solace', 'Veyr Prime', 'Kharos', 'Lumen']);
  assert.equal(view.network.progress, 0); assert.equal(view.network.beacons, 1);
  assert.deepEqual(view.history, {
    scope: 'retained', logCount: 160, logLimit: 160, reportCount: 24, reportLimit: 50,
    earliestLogTurn: 2, latestLogTurn: 57, earliestReportTurn: 20, latestReportTurn: 57,
  });
  assert.ok(state.nextLogId > view.history.logCount, 'retained count is not the issued-ID or lifetime count');
  assert.deepEqual(view.moments.map(moment => moment.id), [165, 163, 156, 154, 134, 131]);
  assert.equal(view.moments[0].category, 'sovereignty');
  assert.equal(view.moments[0].type, 'combat', 'classification does not rewrite the recorded type');
  assertSafeMoments(state, view);
});

test('a recorded loss names the canonical victor without revealing their private holdings', () => {
  const state = finished('CONCLUSION-LOSS');
  state.winner = 'veyr'; state.victoryType = 'Concord defeated';
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'player');
  for (const system of state.systems.filter(system => system.owner === 'player')) system.owner = 'veyr';
  player(state).eliminated = true; player(state).orders = 0;
  const rival = state.factions.find(faction => faction.id === 'veyr');
  rival.name = 'Untrusted mutable identity'; rival.credits = 987654321;
  const view = getCampaignConclusion(state);
  assert.equal(view.outcome.winnerName, FACTIONS.veyr.name);
  assert.equal(view.outcome.winnerColor, FACTIONS.veyr.color);
  assert.equal(view.outcome.playerWon, false);
  assert.equal(view.holdings.worlds, 0); assert.equal(view.holdings.population, 0);
  assert.equal(view.holdings.ships, 0); assert.equal(view.conquest.controlled, 0);
  assert.equal(view.holdings.resources.credits, player(state).credits);
  assert.equal(JSON.stringify(view).includes('987654321'), false);
  assert.equal(JSON.stringify(view).includes('Untrusted mutable identity'), false);
  assert.equal(player(state).contacts.includes('veyr'), false, 'a saved winner is still named when uncontacted');
});

test('legacy version 1 Transcendence retains its outcome without invented alignment or participants', () => {
  const state = watch();
  delete player(state).alignment;
  assert.equal(validateSave(state), true);
  const view = getCampaignConclusion(state);
  assert.equal(view.outcome.victoryType, 'Transcendence');
  assert.equal(view.outcome.playerWon, true);
  assert.equal(view.network.hasRecordedAlignment, false);
  assert.equal(view.network.progress, null); assert.equal(view.network.active, null);
  assert.deepEqual(view.network.sites, []);
  assert.equal(view.network.beacons, 4, 'current own buildings remain distinct from absent historical metadata');
});

test('saved zero progress and recorded participants are distinct from missing metadata or replacement candidates', () => {
  const state = watch(), own = player(state);
  own.alignment = { progress: 0, sites: ['s20', 's0', 's28'], active: false, started: true, reportedBeacons: ['s20', 's0', 's28'] };
  world(state, 's20').owner = 'veyr';
  const view = getCampaignConclusion(state);
  assert.equal(view.network.hasRecordedAlignment, true);
  assert.equal(view.network.progress, 0); assert.equal(view.network.active, false);
  assert.equal(view.network.beacons, 3);
  assert.deepEqual(view.network.sites.map(system => system.id), ['s0', 's28'], 'an owned spare is not invented as a saved participant');
  assert.equal(view.outcome.victoryType, 'Transcendence', 'the helper does not adjudicate the already recorded result again');
});

test('empty and legacy optional histories remain empty instead of reconstructing missing events', () => {
  const state = finished('CONCLUSION-NO-HISTORY');
  state.log = []; delete state.combatReports; delete state.nextCombatReportId; delete state.lastBriefing;
  const view = getCampaignConclusion(state);
  assert.deepEqual(view.moments, []);
  assert.deepEqual(view.history, {
    scope: 'retained', logCount: 0, logLimit: 160, reportCount: 0, reportLimit: 50,
    earliestLogTurn: null, latestLogTurn: null, earliestReportTurn: null, latestReportTurn: null,
  });
  assert.equal(view.outcome.victoryType, 'Legacy');
});

test('pruned histories use only retained ranges and preserve category diversity despite repeated hull completions', () => {
  const state = finished('CONCLUSION-SELECTION');
  state.log = [
    { id: 900, turn: 100, type: 'war', text: 'The last retained declaration.' },
    { id: 899, turn: 100, type: 'diplomacy', text: 'An earlier same-cycle treaty.' },
    { id: 898, turn: 99, type: 'combat', text: 'A retained battle; its report was pruned.', reportId: 400, systemId: 's0' },
    { id: 897, turn: 98, type: 'discovery', text: 'Stillwater detected. An expedition can investigate.', systemId: 's0' },
    { id: 896, turn: 97, type: 'research', text: 'The last retained technology.' },
    { id: 895, turn: 96, type: 'colony', text: 'The last retained settlement.', systemId: 's0' },
    { id: 894, turn: 95, type: 'discovery', text: 'We restored a patient reef.', systemId: 's0' },
    { id: 893, turn: 94, type: 'construction', text: 'A research enclave was completed.', itemId: 'lab', systemId: 's0' },
    ...Array.from({ length: 152 }, (_, index) => ({ id: 901 + index, turn: 101, type: 'construction', text: 'Another frigate was completed.', itemId: 'frigate', systemId: 's0' })),
  ];
  state.combatReports = []; state.nextLogId = 5000;
  const view = getCampaignConclusion(state);
  assert.deepEqual(view.moments.map(moment => moment.id), [900, 898, 896, 895, 894, 893]);
  assert.equal(view.history.logCount, 160); assert.equal(view.history.earliestLogTurn, 94);
  assert.equal(view.history.latestLogTurn, 101);
  assert.equal(view.moments[1].links.some(link => link.kind === 'report'), false);
  const reversed = clone(state); reversed.log.reverse();
  assert.deepEqual(getCampaignConclusion(reversed), view, 'retained-event ordering uses turn and ID, not incidental array order');
  assertSafeMoments(state, view);
});

test('stale references preserve actual text and only offer retained reports or accessible system links', () => {
  const state = watch();
  const hidden = state.systems.find(system => system.owner !== 'player');
  // WATCH charted the whole galaxy; this synthetic derivative removes the
  // observer's knowledge only to exercise stale inaccessible references.
  hidden.knownBy = hidden.knownBy.filter(id => id !== 'player');
  hidden.exploredBy = hidden.exploredBy.filter(id => id !== 'player');
  state.log = [
    { id: 300, turn: 60, type: 'combat', text: 'A retained account of a forgotten report.', reportId: 9999, systemId: 's0' },
    { id: 299, turn: 59, type: 'discovery', text: 'The retained text is all that remains.', systemId: 'missing-system' },
    { id: 298, turn: 58, type: 'research', text: 'A historical technology note.', systemId: hidden.id },
    { id: 297, turn: 57, type: 'construction', text: 'An old completion without an accessible world.', systemId: hidden.id },
  ];
  const view = getCampaignConclusion(state);
  assert.deepEqual(view.moments[0].links, [{ kind: 'world', systemId: 's0' }]);
  assert.deepEqual(view.moments.slice(1).map(moment => moment.links), [[], [], []]);
  assert.equal(view.moments[1].text, state.log[1].text);
  assert.equal(JSON.stringify(view).includes(hidden.name), false);
  state.log = [{ id: 300, turn: 60, type: 'combat', text: 'Report-only retained reference.', reportId: 4 }];
  assert.deepEqual(getCampaignConclusion(state).moments[0].links, [{ kind: 'report', reportId: 4 }, { kind: 'world', systemId: 's28' }]);
});

test('discovery links require the observer-safe discovery view, while charting alone permits only a world link', () => {
  const state = finished('CONCLUSION-DISCOVERY-LINK');
  const site = state.systems.find(system => system.anomaly && system.owner !== 'player');
  assert.ok(site);
  site.knownBy = [...new Set([...site.knownBy, 'player'])]; site.exploredBy = site.exploredBy.filter(id => id !== 'player');
  state.log = [{ id: 100, turn: 20, type: 'discovery', text: 'A retained expedition note.', systemId: site.id }];
  assert.equal(getDiscoveryView(state, site.id), null);
  assert.deepEqual(getCampaignConclusion(state).moments[0].links, [{ kind: 'world', systemId: site.id }]);
  site.exploredBy.push('player');
  assert.ok(getDiscoveryView(state, site.id));
  assert.deepEqual(getCampaignConclusion(state).moments[0].links, [{ kind: 'discovery', systemId: site.id }, { kind: 'world', systemId: site.id }]);
  delete site.anomaly;
  assert.deepEqual(getCampaignConclusion(state).moments[0].links, [{ kind: 'world', systemId: site.id }]);
});

test('frozen saves can be projected repeatedly and every returned nested value is an independent copy', () => {
  const state = freeze(watch()), before = clone(state), view = getCampaignConclusion(state), expected = clone(view);
  view.outcome.winnerName = 'Changed display'; view.holdings.resources.credits = -10;
  view.conquest.worlds[0].name = 'Changed founding world'; view.network.sites[0].name = 'Changed beacon';
  view.network.sites.push({ id: 'fake', name: 'Fake' }); view.history.logCount = 0;
  view.moments[0].links[0].reportId = -10; view.moments[0].text = 'Changed historical display'; view.moments.pop();
  assert.deepEqual(state, before);
  assert.deepEqual(getCampaignConclusion(state), expected);
  const reversed = clone(state); reversed.factions.reverse(); reversed.systems.reverse(); reversed.fleets.reverse(); reversed.log.reverse(); reversed.combatReports.reverse();
  assert.deepEqual(getCampaignConclusion(reversed), expected);
});

test('hidden rival economies, research, worlds and forces neither change nor supply the completed view', () => {
  const state = finished('CONCLUSION-FOG'), expected = getCampaignConclusion(state), changed = clone(state);
  for (const faction of changed.factions.filter(faction => faction.id !== 'player')) {
    Object.assign(faction, { name: 'Hidden government', shortName: 'Hidden', credits: 987654321, minerals: 987654321, science: 987654321, techs: ['weapons', 'shields'], capitalId: 's40', research: null });
  }
  for (const system of changed.systems.filter(system => system.owner !== 'player' && !system.exploredBy.includes('player'))) {
    Object.assign(system, { owner: 'choir', originalOwner: 'veyr', name: 'Secret world', population: 100, buildings: ['beacon'], x: 99999, y: 99999 });
  }
  for (const fleet of changed.fleets.filter(fleet => fleet.owner !== 'player')) Object.assign(fleet, { type: 'cruiser', ships: 99, hp: 8415, systemId: 's0' });
  assert.deepEqual(getCampaignConclusion(changed), expected);
  const unreadable = (object, keys) => { for (const key of keys) Object.defineProperty(object, key, { get() { throw new Error(`Private ${key} read`); } }); };
  for (const faction of state.factions.filter(faction => faction.id !== 'player')) unreadable(faction, ['name', 'shortName', 'credits', 'minerals', 'science', 'techs', 'research', 'alignment']);
  for (const system of state.systems.filter(system => system.owner !== 'player' && !system.exploredBy.includes('player'))) unreadable(system, ['name', 'originalOwner', 'population', 'buildings', 'x', 'y']);
  for (const fleet of state.fleets.filter(fleet => fleet.owner !== 'player')) unreadable(fleet, ['type', 'ships', 'hp', 'systemId']);
  assert.deepEqual(getCampaignConclusion(state), expected, 'private fields are not read even to decide which ending to display');
});
