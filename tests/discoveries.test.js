import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getBuildOptions, getSystemYield, validateSave } from '../src/game.js';
import { ANOMALIES, BUILDINGS } from '../src/content.js';
import { advanceDiscoveries, getDiscoveryView, getDiscoveryOptions, observeDiscovery, observeDiscoveries, mergeDiscoveryHeritage, validateDiscoveryState } from '../src/discoveries.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const world = (state, id = 's4') => state.systems.find(candidate => candidate.id === id);
const choose = (state, choiceId, extra = {}) => command(state, { type: 'anomaly', systemId: 's4', choiceId, ...extra });
const nextCycle = state => { state.turn++; return advanceDiscoveries(state); };
const quiet = state => { for (const empire of state.factions.filter(candidate => candidate.id !== 'player')) empire.eliminated = true; };
const atWar = (state, a = 'player', b = 'veyr') => { faction(state, a).relations[b].status = 'war'; faction(state, b).relations[a].status = 'war'; };

function fixture(id = 'observatory', owned = true) {
  const state = createGame(`discovery-${id}`), system = world(state), empire = faction(state);
  system.anomaly = { id, resolved: false };
  system.owner = owned ? 'player' : null;
  system.population = owned ? 6 : 0;
  system.buildings = owned ? ['mine', 'lab'] : [];
  system.queue = null;
  if (!system.knownBy.includes('player')) system.knownBy.push('player');
  if (!system.exploredBy.includes('player')) system.exploredBy.push('player');
  if (!owned) state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout').systemId = system.id;
  Object.assign(empire, { credits: 2000, minerals: 2000, orders: 100, techs: ['physics', 'ecology', 'logistics', 'industry', 'computing'] });
  observeDiscovery(state, system.id, 'player');
  return state;
}

function ready(id = 'observatory') {
  const state = fixture(id);
  assert.equal(choose(state, 'preserve').ok, true);
  for (let i = 0; i < 3; i++) nextCycle(state);
  assert.equal(world(state).anomaly.stage, 'ready');
  return state;
}

function finishQueue(state) {
  quiet(state);
  for (let i = 0; world(state).queue && i < 30; i++) endTurn(state);
  assert.equal(world(state).queue, null);
}

test('seeded galaxies contain one of each new discovery without increasing anomaly density', () => {
  for (const seed of ['ASTERION', 'discovery-a', 'discovery-b', 'discovery-c']) {
    const state = createGame(seed), anomalies = state.systems.filter(system => system.anomaly);
    assert.equal(anomalies.length, 10);
    assert.equal(anomalies.filter(system => system.anomaly.id === 'observatory').length, 1);
    assert.equal(anomalies.filter(system => system.anomaly.id === 'reef').length, 1);
    assert.equal(anomalies.filter(system => !ANOMALIES[system.anomaly.id].multiStage).length, 8);
    assert.deepEqual(createGame(seed), state);
    assert.equal(validateSave(state), true);
  }
});

test('all original anomaly commands preserve choice IDs and record actual outcomes once', () => {
  for (const [id, choiceId] of [['archive', 'study'], ['pilgrims', 'supplies'], ['forge', 'ore'], ['garden', 'harvest'], ['echo', 'listen'], ['wreck', 'reactor']]) {
    const state = fixture(id);
    const result = choose(state, choiceId);
    assert.equal(result.ok, true, result.message);
    const entry = world(state).anomaly.history[0];
    assert.equal(entry.choiceId, choiceId);
    assert.equal(entry.turn, state.turn);
    assert.equal(entry.factionId, 'player');
    assert.ok(entry.outcomeText.length > 0);
    assert.deepEqual(entry.effects.gained, ANOMALIES[id].choices.find(choice => choice.id === choiceId).gain);
    const after = structuredClone(state);
    assert.equal(choose(state, choiceId).ok, false);
    assert.deepEqual(state, after);
    assert.equal(validateSave(state), true);
  }
});

test('history records capped habitability, unavailable refugee destinations, and actual new charts', () => {
  const garden = fixture('garden');
  world(garden).habitability = 95;
  assert.equal(choose(garden, 'preserve').ok, true);
  assert.equal(world(garden).anomaly.history[0].effects.habitability, 5);
  assert.match(world(garden).anomaly.history[0].outcomeText, /5 points/);
  const pilgrims = fixture('pilgrims');
  world(pilgrims, faction(pilgrims).capitalId).owner = null;
  assert.equal(choose(pilgrims, 'welcome').ok, true);
  assert.equal(world(pilgrims).anomaly.history[0].effects.population.amount, 0);
  assert.match(world(pilgrims).anomaly.history[0].outcomeText, /No settled capital/);
  const echo = fixture('echo');
  const before = echo.systems.filter(system => system.knownBy.includes('player')).length;
  assert.equal(choose(echo, 'reach').ok, true);
  assert.equal(world(echo).anomaly.history[0].effects.charted, echo.systems.filter(system => system.knownBy.includes('player')).length - before);
});

test('the recovered escort has a distinctive name and heritage survives merges and destruction', () => {
  const state = fixture('forge');
  assert.equal(choose(state, 'ship').ok, true);
  const relic = state.fleets.find(fleet => fleet.heritage?.length);
  assert.equal(relic.name, `Last Light of ${world(state).name}`);
  assert.equal(relic.type, 'frigate');
  assert.equal(relic.heritage[0].systemId, 's4');
  const originalId = relic.id;
  const generic = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate' && fleet.id !== relic.id);
  generic.systemId = 's4';
  assert.equal(command(state, { type: 'merge', fleetId: generic.id, targetFleetId: relic.id }).ok, true);
  assert.equal(generic.heritage[0].fleetId, originalId);
  mergeDiscoveryHeritage(generic, { heritage: generic.heritage });
  assert.equal(generic.heritage.length, 1);
  state.fleets = state.fleets.filter(fleet => fleet.id !== generic.id);
  assert.equal(getDiscoveryView(state, 's4').history[0].effects.fleet.id, originalId);
  assert.equal(validateSave(state), true);
});

test('both new discoveries offer their exact immediate salvage rewards with atomic prerequisites', () => {
  for (const id of ['observatory', 'reef']) {
    const state = fixture(id), empire = faction(state);
    empire.techs = [];
    const before = structuredClone(state);
    assert.equal(choose(state, 'preserve').ok, false);
    assert.deepEqual(state, before);
    assert.equal(choose(state, 'salvage').ok, true);
    assert.equal(empire.minerals, before.factions[0].minerals + (id === 'reef' ? 85 : 65));
    assert.equal(empire.science, id === 'reef' ? 0 : 20);
    assert.equal(world(state).anomaly.resolved, true);
    assert.equal(getDiscoveryView(state, 's4').history.length, 1);
  }
});

test('preservation may begin on a neutral world but matures only with a colony and supporting building', () => {
  const state = fixture('observatory', false), system = world(state);
  const before = { credits: faction(state).credits, minerals: faction(state).minerals };
  assert.equal(choose(state, 'preserve').ok, true);
  assert.equal(faction(state).credits, before.credits - 40);
  assert.equal(faction(state).minerals, before.minerals - 20);
  nextCycle(state);
  assert.equal(system.anomaly.progress, 0);
  system.owner = 'player'; system.population = 1;
  nextCycle(state);
  assert.equal(system.anomaly.progress, 0);
  system.buildings.push('lab');
  nextCycle(state);
  assert.equal(system.anomaly.progress, 1);
  const after = structuredClone(state);
  assert.equal(advanceDiscoveries(state).advanced, false);
  assert.deepEqual(state, after);
  nextCycle(state); nextCycle(state);
  assert.equal(system.anomaly.stage, 'ready');
  assert.equal(getDiscoveryOptions(state, 's4').length, 2);
  assert.equal(validateSave(state), true);
});

test('maturation pauses under a hostile warship and resumes without decay or expiry', () => {
  const state = fixture('reef');
  choose(state, 'preserve');
  nextCycle(state);
  const enemy = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  enemy.systemId = 's4'; atWar(state);
  for (let i = 0; i < 5; i++) nextCycle(state);
  assert.equal(world(state).anomaly.progress, 1);
  enemy.type = 'scout'; enemy.hp = 18;
  nextCycle(state);
  assert.equal(world(state).anomaly.progress, 2, 'a scout cannot blockade maturation');
  enemy.systemId = 's1';
  nextCycle(state);
  assert.equal(world(state).anomaly.stage, 'ready');
});

test('normal commands never mature a discovery and three full end turns do', () => {
  const state = fixture('observatory');
  quiet(state);
  assert.equal(choose(state, 'preserve').ok, true);
  assert.equal(command(state, { type: 'research', techId: 'weapons' }).ok, true);
  assert.equal(command(state, { type: 'research', techId: 'diplomacy' }).ok, true);
  assert.equal(world(state).anomaly.progress, 0);
  for (let progress = 1; progress <= 3; progress++) {
    assert.equal(endTurn(state).ok, true);
    assert.equal(world(state).anomaly.progress, progress);
    assert.equal(world(state).anomaly.stage, progress < 3 ? 'maturing' : 'ready');
  }
});

test('final portable rewards resolve once and do not require the restoration technology', () => {
  for (const id of ['observatory', 'reef']) {
    const state = ready(id), empire = faction(state);
    empire.techs = [];
    const before = { credits: empire.credits, minerals: empire.minerals, science: empire.science };
    assert.equal(choose(state, 'harvest').ok, true);
    assert.equal(empire.science - before.science, id === 'observatory' ? 140 : 20);
    assert.equal(empire.minerals - before.minerals, id === 'reef' ? 120 : 0);
    assert.equal(empire.credits - before.credits, id === 'observatory' ? 30 : 0);
    assert.equal(world(state).anomaly.history.length, 2);
    assert.equal(world(state).anomaly.restoration, undefined);
    const after = structuredClone(state);
    assert.equal(choose(state, 'harvest').ok, false);
    assert.deepEqual(state, after);
  }
});

test('restoration uses ordinary payment exactly once and cancellation preserves only the entitlement', () => {
  for (const id of ['observatory', 'reef']) {
    const state = ready(id), empire = faction(state), system = world(state), itemId = ANOMALIES[id].siteId;
    const before = { credits: empire.credits, minerals: empire.minerals, orders: empire.orders };
    assert.equal(choose(state, 'restore').ok, true);
    assert.equal(empire.credits, before.credits - 80);
    assert.equal(empire.minerals, before.minerals - 40);
    assert.equal(empire.orders, before.orders - 1);
    assert.equal(system.queue.itemId, itemId);
    assert.deepEqual(system.queue.cost, { credits: 80, minerals: 40 });
    assert.equal(system.queue.work, 60);
    assert.equal(system.anomaly.restoration.buildingId, itemId);
    assert.equal(system.anomaly.history.length, 2);
    assert.equal(getDiscoveryView(state, 's4').site.state, 'building');
    system.queue.progress = 15;
    assert.equal(command(state, { type: 'cancelBuild', systemId: 's4' }).ok, true);
    assert.equal(empire.credits, before.credits - 20);
    assert.equal(empire.minerals, before.minerals - 10);
    assert.equal(getDiscoveryView(state, 's4').site.state, 'planned');
    assert.equal(choose(state, 'harvest').ok, false);
    assert.equal(command(state, { type: 'build', systemId: 's4', itemId }).ok, true);
    assert.equal(system.anomaly.history.length, 2);
    finishQueue(state);
    const without = structuredClone(state);
    world(without).buildings = world(without).buildings.filter(id => id !== itemId);
    const output = getSystemYield(state, system), baseline = getSystemYield(without, world(without));
    assert.equal(output.science - baseline.science, id === 'observatory' ? 8 : 0);
    assert.equal(output.minerals - baseline.minerals, id === 'reef' ? 4 : 0);
    assert.equal(output.production - baseline.production, id === 'reef' ? 4 : 0);
    assert.equal(validateSave(state), true);
  }
});

test('ordinary construction menus cannot bypass discovery gates and can commission a mature site', () => {
  const state = fixture('observatory');
  assert.equal(getBuildOptions(state, 's4').find(item => item.id === 'ancient_observatory').enabled, false);
  assert.equal(getBuildOptions(state, 's4').find(item => item.id === 'lattice_works').enabled, false);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'build', systemId: 's4', itemId: 'ancient_observatory' }).ok, false);
  assert.deepEqual(state, before);
  choose(state, 'preserve'); nextCycle(state); nextCycle(state); nextCycle(state);
  const orders = faction(state).orders;
  assert.equal(command(state, { type: 'build', systemId: 's4', itemId: 'ancient_observatory' }).ok, true);
  assert.equal(faction(state).orders, orders - 1);
  assert.equal(world(state).anomaly.history[1].choiceId, 'restore');
  assert.equal(world(state).anomaly.resolved, true);
});

test('full infrastructure preserves a ready discovery until explicit replacement is chosen', () => {
  const state = ready('reef'), system = world(state);
  system.population = 3;
  system.buildings = ['mine', 'lab', 'market'];
  assert.match(getDiscoveryOptions(state, 's4').find(choice => choice.id === 'restore').reason, /slots are full/);
  const before = structuredClone(state);
  assert.equal(choose(state, 'restore').ok, false);
  assert.deepEqual(state, before);
  for (let i = 0; i < 6; i++) nextCycle(state);
  assert.equal(system.anomaly.stage, 'ready');
  assert.equal(choose(state, 'restore', { replaceBuildingId: 'market' }).ok, true);
  assert.ok(system.buildings.includes('market'));
  finishQueue(state);
  assert.ok(!system.buildings.includes('market'));
  assert.ok(system.buildings.includes('lattice_works'));
  assert.equal(system.buildings.length, 3);
});

test('capture preserves restoration rights and history without transferring rewards or replaying a choice', () => {
  const state = ready('observatory'), system = world(state);
  choose(state, 'restore');
  const entries = structuredClone(system.anomaly.history.map(({ knownBy, ...entry }) => entry));
  const enemy = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  enemy.systemId = system.id;
  system.defenseDamage = getSystemYield(state, system).defense - 1;
  atWar(state);
  faction(state, 'veyr').orders = 10;
  assert.equal(command(state, { type: 'attack', factionId: 'veyr', fleetId: enemy.id }).ok, true);
  assert.equal(system.owner, 'veyr');
  assert.equal(system.queue, null);
  assert.equal(system.anomaly.restoration.factionId, 'player');
  assert.deepEqual(getDiscoveryView(state, 's4', 'veyr').history, entries);
  const before = structuredClone(state);
  assert.equal(choose(state, 'harvest', { factionId: 'veyr' }).ok, false);
  assert.deepEqual(state, before);
  Object.assign(faction(state, 'veyr'), { techs: ['computing'], credits: 300, minerals: 300 });
  assert.equal(command(state, { type: 'build', factionId: 'veyr', systemId: 's4', itemId: 'ancient_observatory' }).ok, true);
  assert.equal(faction(state, 'veyr').credits, 220);
  assert.equal(system.anomaly.history.length, 2);
  assert.equal(validateSave(state), true);
});

test('replacing an ancient site leaves its restoration entitlement and historical identity', () => {
  const state = ready('reef'), system = world(state);
  choose(state, 'restore'); finishQueue(state);
  assert.equal(command(state, { type: 'build', systemId: 's4', itemId: 'market', replaceBuildingId: 'lattice_works' }).ok, true);
  finishQueue(state);
  assert.ok(!system.buildings.includes('lattice_works'));
  assert.equal(getDiscoveryView(state, 's4').site.state, 'planned');
  assert.equal(getDiscoveryView(state, 's4').history.length, 2);
  assert.equal(getBuildOptions(state, 's4').find(option => option.id === 'lattice_works').enabled, true);
});

test('unseen rival choices, maturation and new observers leave remembered discovery views unchanged', () => {
  const state = fixture('observatory', false), system = world(state);
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  const destination = world(state, 's10');
  destination.owner = null;
  if (!destination.knownBy.includes('player')) destination.knownBy.push('player');
  state.lanes.push(['s4', 's10']);
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: 's10' }).ok, true);
  const oldView = getDiscoveryView(state, 's4'), oldOptions = getDiscoveryOptions(state, 's4');
  assert.equal(oldView.stale, true);
  const rivalScout = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'scout');
  rivalScout.systemId = 's4';
  system.exploredBy.push('veyr');
  Object.assign(faction(state, 'veyr'), { techs: ['physics', 'computing'], credits: 1000, minerals: 1000, orders: 50 });
  assert.equal(choose(state, 'preserve', { factionId: 'veyr' }).ok, true);
  system.owner = 'veyr'; system.population = 6; system.buildings = ['lab'];
  nextCycle(state); nextCycle(state); nextCycle(state);
  assert.equal(choose(state, 'harvest', { factionId: 'veyr' }).ok, true);
  assert.deepEqual(getDiscoveryView(state, 's4'), oldView);
  assert.deepEqual(getDiscoveryOptions(state, 's4'), oldOptions);
  const before = structuredClone(state);
  assert.equal(choose(state, 'salvage').message, 'An expedition must be present to investigate.');
  assert.deepEqual(state, before);
  scout.systemId = 's4';
  observeDiscovery(state, 's4', 'player');
  const observed = getDiscoveryView(state, 's4');
  assert.equal(observed.phase, 'resolved');
  assert.equal(observed.history.length, 2);
  assert.ok(observed.history.every(entry => !('knownBy' in entry)));
  scout.systemId = 's10';
  const remembered = getDiscoveryView(state, 's4');
  state.fleets.find(fleet => fleet.owner === 'khar' && fleet.type === 'scout').systemId = 's4';
  system.exploredBy.push('khar');
  observeDiscovery(state, 's4', 'khar');
  assert.deepEqual(getDiscoveryView(state, 's4'), remembered, 'newly learned observer identities are private');
});

test('remembered mature choices do not expose remote production or current site completion', () => {
  const state = ready('observatory'), system = world(state);
  const scout = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'scout');
  scout.systemId = 's4'; system.exploredBy.push('veyr');
  observeDiscovery(state, 's4', 'veyr');
  scout.systemId = 's1';
  const before = getDiscoveryOptions(state, 's4', 'veyr');
  assert.equal(before.find(choice => choice.id === 'restore').turns, null);
  const snapshot = getDiscoveryView(state, 's4', 'veyr');
  choose(state, 'restore'); finishQueue(state);
  faction(state, 'veyr').eliminated = false; // Restore the observer after the isolated construction helper.
  system.population = 20;
  system.buildings.push('factory');
  assert.deepEqual(getDiscoveryOptions(state, 's4', 'veyr'), before);
  assert.deepEqual(getDiscoveryView(state, 's4', 'veyr'), snapshot);
});

test('legacy resolved anomalies retain their ending without inventing a choice or reward', () => {
  const state = fixture('archive'), system = world(state);
  system.anomaly = { id: 'archive', resolved: true, resolvedBy: 'veyr' };
  const view = getDiscoveryView(state, 's4');
  assert.equal(view.legacyOutcome, true);
  assert.deepEqual(view.history, []);
  const before = structuredClone(state);
  assert.equal(choose(state, 'study').ok, false);
  assert.deepEqual(state, before);
  assert.equal(validateSave(state), true);
  system.owner = 'veyr';
  assert.equal(getDiscoveryView(state, 's4').phase, 'unknown', 'old remote surveys without a snapshot do not invent live knowledge');
});

test('legacy resolvers remember their own remote ending without learning another empire’s outcome', () => {
  const state = fixture('echo', false), system = world(state);
  state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout').systemId = 's0';
  system.anomaly = { id: 'echo', resolved: true, resolvedBy: 'player' };
  const before = structuredClone(state);
  const view = getDiscoveryView(state, 's4');
  assert.equal(view.phase, 'resolved');
  assert.equal(view.legacyOutcome, true);
  assert.equal(view.observedTurn, null);
  assert.equal(view.stale, true);
  assert.equal(view.canInteract, false);
  assert.equal(view.progress, 0);
  assert.equal(view.site, null);
  assert.deepEqual(view.history, []);
  assert.deepEqual(getDiscoveryOptions(state, 's4'), []);
  assert.deepEqual(state, before, 'personal legacy memory is a pure projection');
  assert.equal(validateSave(state), true);

  system.anomaly.resolvedBy = 'veyr';
  const foreignResolution = getDiscoveryView(state, 's4');
  assert.equal(foreignResolution.phase, 'unknown');
  assert.equal(foreignResolution.legacyOutcome, false);
  system.anomaly = { id: 'echo', resolved: false };
  assert.deepEqual(getDiscoveryView(state, 's4'), foreignResolution, 'unobserved foreign resolution has no remote signal');
});

test('in-progress discovery and restoration saves resume deterministically', () => {
  const state = fixture('reef');
  choose(state, 'preserve'); nextCycle(state);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(restored), true);
  assert.equal(advanceDiscoveries(restored).advanced, false);
  nextCycle(state); nextCycle(restored); nextCycle(state); nextCycle(restored);
  assert.deepEqual(restored, state);
  choose(state, 'restore'); choose(restored, 'restore');
  endTurn(state); endTurn(restored);
  assert.deepEqual(restored, state);
  assert.equal(validateSave(restored), true);
});

test('optional discovery fields validate bounds, ownership-independent history, and heritage references', () => {
  assert.equal(validateDiscoveryState(createGame('legacy-fields')), true);
  const state = ready('observatory');
  choose(state, 'restore');
  assert.equal(validateDiscoveryState(state), true);
  const mutations = [
    copy => { world(copy).anomaly.history.push(structuredClone(world(copy).anomaly.history[0])); },
    copy => { world(copy).anomaly.history[0].effects.gained.science = -1; },
    copy => { world(copy).anomaly.history[0].knownBy.push('player'); },
    copy => { world(copy).anomaly.history[0].effects.habitability = 101; },
    copy => { world(copy).anomaly.history[0].effects.fleet = null; },
    copy => { world(copy).anomaly.history[0].turn = copy.turn + 1; },
    copy => { world(copy).anomaly.restoration.buildingId = 'lattice_works'; },
    copy => { world(copy).anomaly.observations.player.siteState = 'secret'; },
    copy => { world(copy).anomaly.observations.intruder = world(copy).anomaly.observations.player; },
    copy => { copy.discoveriesUpdatedTurn = copy.turn + 1; },
    copy => { copy.fleets[0].heritage = [{ id: 'bad', name: 'bad', systemId: 's99', discoveryId: 'forge', choiceId: 'ship', turn: 1, factionId: 'player', fleetId: 'f1' }]; },
  ];
  for (const mutate of mutations) {
    const malformed = structuredClone(state); mutate(malformed);
    assert.equal(validateDiscoveryState(malformed), false);
    assert.equal(validateSave(malformed), false);
  }
});
