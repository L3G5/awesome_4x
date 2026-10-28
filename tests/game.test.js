import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getNeighbors, getVisibleSystems, getEmpireStats, getBuildOptions, getResearchOptions, getSystemYield, getVictoryProgress, validateSave } from '../src/game.js';
import { BUILDINGS, SHIPS, TECHS } from '../src/content.js';

const player = state => state.factions.find(f => f.id === 'player');
const ownFleet = (state, type) => state.fleets.find(f => f.owner === 'player' && f.type === type);
const home = state => state.systems.find(s => s.id === 's0');
function grant(state) { player(state).credits = 10000; player(state).minerals = 10000; player(state).orders = 100; }

test('seeded maps are reproducible, connected, and give every empire an accessible settling world', () => {
  for (const seed of ['ASTERION', 'small', '42', 'another galaxy']) {
    const state = createGame(seed);
    assert.deepEqual(state, createGame(seed));
    const reached = new Set(['s0']), queue = ['s0'];
    while (queue.length) for (const id of getNeighbors(state, queue.shift())) if (!reached.has(id)) { reached.add(id); queue.push(id); }
    assert.equal(reached.size, 42);
    for (const faction of state.factions) {
      assert.ok(getNeighbors(state, faction.capitalId).some(id => state.systems.some(s => s.id === id && !s.owner && s.habitability >= 50)));
      assert.equal(state.fleets.filter(f => f.owner === faction.id).length, 3);
    }
  }
  assert.notDeepEqual(createGame('A').systems, createGame('B').systems);
});

test('exploration follows lanes, reveals survey detail and consumes movement plus orders', () => {
  const state = createGame(), scout = ownFleet(state, 'scout');
  const neighbor = state.systems.find(s => s.id === getNeighbors(state, scout.systemId)[0]);
  const initialKnown = getVisibleSystems(state).length;
  assert.ok(neighbor.knownBy.includes('player'));
  assert.ok(!neighbor.exploredBy.includes('player'));
  const original = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: 's2' }).ok, false);
  assert.deepEqual(state, original, 'invalid jumps do not change any state');
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: neighbor.id }).ok, true);
  assert.equal(scout.systemId, neighbor.id);
  assert.equal(scout.movesLeft, 1);
  assert.equal(player(state).orders, 5);
  assert.ok(neighbor.exploredBy.includes('player'));
  assert.ok(getVisibleSystems(state).length >= initialKnown);
});

test('colony establishment consumes the ark and founding resources, then produces income', () => {
  const state = createGame(), ark = ownFleet(state, 'colony');
  const candidate = state.systems.find(s => getNeighbors(state, ark.systemId).includes(s.id) && !s.owner && s.habitability >= 50);
  assert.ok(command(state, { type: 'move', fleetId: ark.id, targetId: candidate.id }).ok);
  const before = { credits: player(state).credits, minerals: player(state).minerals };
  assert.ok(command(state, { type: 'colonize', fleetId: ark.id }).ok);
  assert.equal(candidate.owner, 'player');
  assert.equal(candidate.population, 1);
  assert.ok(!state.fleets.find(f => f.id === ark.id));
  assert.equal(player(state).credits, before.credits - 30);
  assert.equal(player(state).minerals, before.minerals - 20);
  assert.equal(getEmpireStats(state).colonies, 2);
  const income = getEmpireStats(state).creditIncome;
  const credits = player(state).credits;
  endTurn(state);
  assert.equal(player(state).credits, credits + income);
  assert.equal(player(state).orders, getEmpireStats(state).maxOrders);
});

test('harsh worlds require research and invalid colonization is atomic', () => {
  const state = createGame(), ark = ownFleet(state, 'colony');
  const candidate = state.systems.find(s => getNeighbors(state, ark.systemId).includes(s.id) && !s.owner);
  candidate.habitability = 35;
  command(state, { type: 'move', fleetId: ark.id, targetId: candidate.id });
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'colonize', fleetId: ark.id }).ok, false);
  assert.deepEqual(state, before);
  player(state).techs.push('ecology');
  assert.ok(command(state, { type: 'colonize', fleetId: ark.id }).ok);
});

test('orders prevent unlimited actions and cannot be bypassed by low resources', () => {
  const state = createGame();
  player(state).orders = 0;
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'build', systemId: 's0', itemId: 'lab' }).ok, false);
  assert.deepEqual(state, before);
  assert.ok(command(state, { type: 'research', techId: 'physics' }).ok, 'research direction is free');
  endTurn(state);
  assert.ok(player(state).orders > 0);
});

test('construction takes turns, cannot duplicate a project, and adds real yield', () => {
  const state = createGame();
  const initialScience = getEmpireStats(state).scienceIncome;
  assert.ok(command(state, { type: 'build', systemId: 's0', itemId: 'lab' }).ok);
  assert.equal(player(state).minerals, 80);
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'build', systemId: 's0', itemId: 'market' }).ok, false);
  assert.deepEqual(state, before);
  for (let i = 0; i < 8 && home(state).queue; i++) endTurn(state);
  assert.ok(home(state).buildings.includes('lab'));
  assert.equal(home(state).queue, null);
  assert.ok(getEmpireStats(state).scienceIncome >= initialScience + 5);
  assert.equal(getBuildOptions(state, 's0').find(o => o.id === 'lab').enabled, false);
});

test('cancelling construction refunds only unused resources', () => {
  const state = createGame();
  const credits = player(state).credits;
  command(state, { type: 'build', systemId: 's0', itemId: 'lab' });
  command(state, { type: 'cancelBuild', systemId: 's0' });
  assert.equal(player(state).credits, credits);
  command(state, { type: 'build', systemId: 's0', itemId: 'lab' });
  home(state).queue.progress = 15;
  command(state, { type: 'cancelBuild', systemId: 's0' });
  assert.equal(player(state).credits, credits - 15);
});

test('research prerequisites are enforced and switching preserves invested science', () => {
  const state = createGame();
  assert.equal(command(state, { type: 'research', techId: 'singularity' }).ok, false);
  player(state).science = 25;
  assert.ok(command(state, { type: 'research', techId: 'physics' }).ok);
  assert.equal(player(state).research.progress, 25);
  assert.equal(player(state).science, 0);
  command(state, { type: 'research', techId: 'ecology' });
  assert.equal(player(state).research.progress, 25);
  player(state).science = 40;
  command(state, { type: 'research', techId: 'physics' });
  assert.ok(player(state).techs.includes('physics'));
  assert.equal(player(state).science, 5);
  assert.equal(player(state).research, null);
  assert.ok(getResearchOptions(state).find(t => t.id === 'computing').enabled);
});

test('anomalies require an expedition, resolve once, and grant authored effects', () => {
  const state = createGame(), scout = ownFleet(state, 'scout');
  const system = state.systems.find(s => getNeighbors(state, scout.systemId).includes(s.id) && !s.owner);
  system.anomaly = { id: 'archive', resolved: false };
  system.exploredBy.push('player');
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'anomaly', systemId: system.id, choiceId: 'study' }).ok, false);
  assert.deepEqual(state, before);
  command(state, { type: 'move', fleetId: scout.id, targetId: system.id });
  assert.ok(command(state, { type: 'anomaly', systemId: system.id, choiceId: 'study' }).ok);
  assert.equal(player(state).science, 50);
  assert.equal(command(state, { type: 'anomaly', systemId: system.id, choiceId: 'study' }).ok, false);
  assert.equal(player(state).science, 50);
});

test('diplomacy is symmetric, trade pays income, and negotiated peace enforces a truce', () => {
  const state = createGame(), other = state.factions.find(f => f.id === 'veyr');
  assert.equal(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'trade' }).ok, false);
  player(state).contacts.push('veyr'); other.contacts.push('player');
  const income = getEmpireStats(state).creditIncome;
  assert.ok(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'trade' }).ok);
  assert.ok(other.relations.player.trade);
  assert.equal(getEmpireStats(state).creditIncome, income + 6);
  assert.ok(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'war' }).ok);
  assert.equal(other.relations.player.status, 'war');
  assert.equal(other.relations.player.trade, false);
  assert.equal(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'peace' }).ok, false);
  state.turn += 5;
  // The negotiation floor opens talks, but an unpressured rival can refuse.
  const beforeRefusal = structuredClone(state);
  assert.equal(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'peace' }).ok, false);
  assert.deepEqual(state, beforeRefusal);
  state.turn += 7;
  assert.ok(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'peace' }).ok);
  assert.equal(other.relations.player.status, 'peace');
  assert.equal(player(state).relations.veyr.status, 'peace');
  assert.equal(player(state).relations.veyr.truceUntil, state.turn + 5);
  assert.equal(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'war' }).ok, false);
});

test('fleets cannot bypass neutral borders; trade permits peaceful passage', () => {
  const state = createGame(), scout = ownFleet(state, 'scout');
  const neighbor = state.systems.find(s => s.id === getNeighbors(state, scout.systemId)[0]);
  neighbor.owner = 'veyr'; neighbor.population = 1;
  const before = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: scout.id, targetId: neighbor.id }).ok, false);
  assert.deepEqual(state, before);
  player(state).relations.veyr.trade = true;
  state.factions.find(f => f.id === 'veyr').relations.player.trade = true;
  assert.ok(command(state, { type: 'move', fleetId: scout.id, targetId: neighbor.id }).ok);
  assert.equal(neighbor.owner, 'veyr');
});

test('combat damages both sides, then a surviving force can invade and capture', () => {
  const state = createGame(), frigate = ownFleet(state, 'frigate');
  grant(state);
  const target = state.systems.find(s => s.id === getNeighbors(state, frigate.systemId)[0]);
  target.owner = 'veyr'; target.population = 1;
  const enemy = state.fleets.find(f => f.owner === 'veyr' && f.type === 'frigate');
  enemy.systemId = target.id;
  player(state).relations.veyr.status = 'war'; state.factions.find(f => f.id === 'veyr').relations.player.status = 'war';
  frigate.ships = 5; frigate.hp = 170;
  assert.ok(command(state, { type: 'move', fleetId: frigate.id, targetId: target.id }).ok);
  assert.ok(frigate.hp < 170);
  assert.ok(!state.fleets.some(f => f.id === enemy.id));
  assert.equal(target.owner, 'veyr', 'fleet victory alone does not capture a colony');
  frigate.movesLeft = 1;
  assert.ok(command(state, { type: 'attack', fleetId: frigate.id }).ok);
  assert.equal(target.owner, 'player');
  assert.ok(state.log.some(entry => entry.type === 'combat'));
});

test('fleets built at shipyards can merge and repairs cannot create missing ships', () => {
  const state = createGame(), fleet = ownFleet(state, 'frigate');
  grant(state);
  command(state, { type: 'build', systemId: 's0', itemId: 'frigate' });
  for (let i = 0; i < 6 && home(state).queue; i++) endTurn(state);
  const second = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate' && f.id !== fleet.id);
  assert.ok(second);
  assert.ok(command(state, { type: 'merge', fleetId: fleet.id, targetFleetId: second.id }).ok);
  assert.equal(fleet.ships, 2);
  assert.equal(fleet.hp, 68);
  fleet.hp = 45;
  assert.ok(command(state, { type: 'repair', fleetId: fleet.id }).ok);
  assert.equal(fleet.hp, 68);
  assert.equal(command(state, { type: 'repair', fleetId: fleet.id }).ok, false);
});

test('victory objectives are actionable and a concluded campaign rejects commands', () => {
  const state = createGame();
  assert.equal(getVictoryProgress(state).transcendence.target, 3);
  for (const system of state.systems.slice(0, 3)) { system.owner = 'player'; system.buildings.push('beacon'); }
  command(state, { type: 'research', techId: 'physics' });
  assert.equal(state.winner, null, 'three beacons alone no longer trigger immediate transcendence');
  player(state).techs.push('singularity');
  player(state).alignment = { progress: 10, sites: ['s0', 's1', 's2'], active: true, started: true, reportedBeacons: ['s0', 's1', 's2'] };
  command(state, { type: 'research', techId: 'logistics' });
  assert.equal(state.winner, 'player');
  assert.equal(state.victoryType, 'Transcendence');
  const before = structuredClone(state);
  assert.equal(endTurn(state).ok, false);
  assert.deepEqual(state, before);
});

test('AI expands, researches, builds industry and completes a campaign without broken state', () => {
  for (const seed of ['ASTERION', 'simulation-2', 'simulation-3']) {
    const state = createGame(seed);
    const colonyPeaks = Object.fromEntries(state.factions.map(f => [f.id, 1]));
    for (let i = 0; i < 120 && !state.winner; i++) {
      endTurn(state);
      assert.ok(validateSave(state), `valid save on ${seed} turn ${state.turn}`);
      for (const faction of state.factions) {
        colonyPeaks[faction.id] = Math.max(colonyPeaks[faction.id], getEmpireStats(state, faction.id).colonies);
        assert.ok(faction.orders >= 0);
        assert.equal(new Set(faction.techs).size, faction.techs.length);
      }
      assert.equal(new Set(state.fleets.map(f => f.id)).size, state.fleets.length);
      for (const fleet of state.fleets) assert.ok(fleet.hp <= SHIPS[fleet.type].hp * fleet.ships);
    }
    assert.ok(state.winner, 'campaign reaches a concrete ending');
    for (const faction of state.factions.filter(f => f.id !== 'player')) {
      assert.ok(colonyPeaks[faction.id] >= 3, `${faction.id} expands before any later military losses`);
      assert.ok(faction.techs.length >= 4, `${faction.id} researches`);
    }
    assert.ok(state.systems.some(s => s.owner !== 'player' && s.buildings.includes('lab')));
  }
});

test('JSON saves resume deterministically and malformed saves are rejected', () => {
  const state = createGame('roundtrip');
  command(state, { type: 'research', techId: 'physics' });
  for (let i = 0; i < 10; i++) endTurn(state);
  const restored = JSON.parse(JSON.stringify(state));
  assert.ok(validateSave(restored));
  endTurn(state); endTurn(restored);
  assert.deepEqual(state, restored);
  for (const malformed of [null, {}, { ...restored, version: 0 }, { ...restored, systems: [] }, { ...restored, systems: Array(42).fill(null) }, { ...restored, fleets: [{ type: 'dragon' }] }, { ...restored, fleets: [null] }, { ...restored, log: [null] }]) assert.equal(validateSave(malformed), false);
  const prototypeTech = structuredClone(restored);
  prototypeTech.factions[0].techs.push('__proto__');
  assert.equal(validateSave(prototypeTech), false);
});

function simultaneousAlignment(seed, equalScores = false) {
  const state = createGame(seed);
  state.lanes = [];
  for (const id of ['player', 'veyr']) {
    const faction = state.factions.find(f => f.id === id);
    faction.techs = ['singularity']; faction.credits = 10000; faction.minerals = 0;
    faction.orders = 0; faction.research = { techId: 'physics', progress: 0 };
    const sites = id === 'player' ? ['s0', 's4', 's5'] : ['s1', 's6', 's7'];
    for (const site of sites) {
      const system = state.systems.find(s => s.id === site);
      Object.assign(system, { owner: id, population: 8, habitability: 90, buildings: ['mine', 'shipyard', 'beacon'], knownBy: [id], exploredBy: [id], anomaly: null });
    }
    faction.alignment = { progress: 9, sites, active: true, started: true, reportedBeacons: sites };
  }
  for (const faction of state.factions) faction.orders = 0;
  if (!equalScores) player(state).techs.push('logistics', 'industry', 'computing', 'shields');
  return state;
}

test('simultaneous alignment finishes use Legacy score after all factions resolve, independent of faction array order', () => {
  const first = simultaneousAlignment('alignment-tie'), reordered = structuredClone(first);
  assert.equal(getEmpireStats(first, 'player').score, 411);
  assert.equal(getEmpireStats(first, 'veyr').score, 363);
  reordered.factions.reverse();
  endTurn(first); endTurn(reordered);
  for (const state of [first, reordered]) {
    assert.equal(state.factions.find(f => f.id === 'player').alignment.progress, 10);
    assert.equal(state.factions.find(f => f.id === 'veyr').alignment.progress, 10);
    assert.equal(state.winner, 'player');
    assert.equal(state.victoryType, 'Transcendence');
    assert.ok(validateSave(state));
  }
});

test('exact-score alignment ties use a deterministic seeded draw without consuming combat RNG', () => {
  const seedHash = seed => { let hash = 2166136261; for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return hash >>> 0; };
  const winners = new Set();
  for (const seed of ['tied-race-A', 'tied-race-B', 'tied-race-C', 'tied-race-D']) {
    const state = simultaneousAlignment(seed, true), restored = JSON.parse(JSON.stringify(state));
    const rng = state.rng;
    restored.factions = [restored.factions[1], restored.factions[3], restored.factions[0], restored.factions[2]];
    assert.equal(getEmpireStats(state, 'player').score, getEmpireStats(state, 'veyr').score);
    const expected = ['player', 'veyr'].sort((a, b) => seedHash(`${seed}:victory:2:${b}`) - seedHash(`${seed}:victory:2:${a}`) || a.localeCompare(b))[0];
    endTurn(state); endTurn(restored);
    assert.equal(state.winner, expected); assert.equal(restored.winner, expected);
    assert.equal(state.rng, rng); assert.equal(restored.rng, rng);
    winners.add(state.winner);
  }
  assert.equal(winners.size, 2, 'the seeded draw does not always favor a fixed faction');
});
