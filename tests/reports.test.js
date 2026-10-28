import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, estimateInvasion, getCombatReport, getNeighbors, getSystemYield, validateSave } from '../src/game.js';
import { appendCombatReport } from '../src/reports.js';
import { SHIPS, TECHS } from '../src/content.js';

const faction = (state, id = 'player') => state.factions.find(f => f.id === id);
const fleet = (state, owner = 'player', type = 'frigate') => state.fleets.find(f => f.owner === owner && f.type === type);
const system = (state, id) => state.systems.find(s => s.id === id);
const round = value => Math.round(value * 10) / 10;
function war(state, first, second) {
  for (const [a, b] of [[first, second], [second, first]]) {
    Object.assign(faction(state, a).relations[b], { status: 'war', treatyTurn: state.turn, trade: false });
    if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
  }
}
function battleFixture(attackerId = 'player', defenderId = 'veyr') {
  const state = createGame('battle-reports');
  const attacker = fleet(state, attackerId), defender = fleet(state, defenderId);
  const target = system(state, getNeighbors(state, attacker.systemId)[0]);
  target.owner = null; target.population = 0;
  defender.systemId = target.id;
  attacker.ships = 3; attacker.hp = 102;
  defender.ships = 2; defender.hp = 68;
  war(state, attackerId, defenderId);
  return { state, attacker, defender, target };
}
function invadeFixture(shielded = false) {
  const state = createGame('invasion-reports');
  war(state, 'player', 'veyr');
  const attacker = fleet(state); attacker.systemId = 's1'; attacker.ships = 6; attacker.hp = 204;
  for (const foreign of state.fleets.filter(f => f.owner === 'veyr')) foreign.systemId = 's20';
  if (shielded) faction(state).techs.push('shields');
  system(state, 's1').knownBy.push('player'); system(state, 's1').exploredBy.push('player');
  return { state, attacker, target: system(state, 's1') };
}

test('move reports preserve actual ship and hull losses and return an immediate meaningful summary', () => {
  const { state, attacker, defender, target } = battleFixture();
  const before = [structuredClone(attacker), structuredClone(defender)];
  const result = command(state, { type: 'move', fleetId: attacker.id, targetId: target.id });
  assert.equal(result.ok, true);
  assert.equal(result.combatReports.length, 1);
  const report = result.combatReports[0];
  assert.equal(report, getCombatReport(state, report.id));
  assert.equal(report.kind, 'fleet'); assert.equal(report.systemId, target.id); assert.equal(report.turn, state.turn);
  for (const [i, after] of [attacker, defender].entries()) {
    const p = report.participants[i];
    assert.equal(p.fleetId, before[i].id);
    assert.equal(p.shipsBefore, before[i].ships); assert.equal(p.shipsAfter, after.ships);
    assert.equal(p.hullBefore, before[i].hp); assert.equal(p.hullAfter, after.hp);
    assert.match(result.message, new RegExp(`lost ${p.shipsBefore - p.shipsAfter} ships? and ${round(p.hullBefore - p.hullAfter)} hull`));
  }
  assert.match(result.message, /survive|destroyed/);
  assert.equal(state.log.find(entry => entry.reportId === report.id).systemId, target.id);
  const saved = JSON.stringify(report);
  if (attacker.hp > 0) attacker.hp = Math.min(attacker.ships * SHIPS.frigate.hp, attacker.hp + 4);
  attacker.name = 'Renamed after battle';
  assert.equal(JSON.stringify(report), saved, 'later repairs and renaming cannot rewrite history');
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.participants) && Object.isFrozen(report.participants[0]));
  assert.throws(() => { report.participants[0].shipsAfter = 99; }, TypeError);
  assert.ok(validateSave(state));
});

test('the player receives a defender report, but AI-versus-AI battles create no player reports or combat logs', () => {
  const visible = battleFixture('veyr', 'player');
  const result = command(visible.state, { type: 'move', factionId: 'veyr', fleetId: visible.attacker.id, targetId: visible.target.id });
  assert.equal(result.combatReports[0].participants[1].owner, 'player');
  assert.equal(result.combatReports[0].participants[1].role, 'defender');
  const hidden = battleFixture('veyr', 'khar');
  const reportId = hidden.state.nextCombatReportId;
  command(hidden.state, { type: 'move', factionId: 'veyr', fleetId: hidden.attacker.id, targetId: hidden.target.id });
  assert.deepEqual(hidden.state.combatReports, []);
  assert.equal(hidden.state.nextCombatReportId, reportId);
  assert.ok(!hidden.state.log.some(entry => entry.type === 'combat'));
});

test('one attack against several fleets returns each engagement with chained attacker snapshots', () => {
  const { state, attacker, defender, target } = battleFixture();
  attacker.systemId = target.id; attacker.ships = 10; attacker.hp = 340;
  defender.ships = 1; defender.hp = 34;
  const extra = { ...defender, id: `f${state.nextFleetId++}`, name: 'Second escort' };
  state.fleets.push(extra);
  const result = command(state, { type: 'attack', fleetId: attacker.id });
  assert.equal(result.combatReports.length, 2);
  const [first, second] = result.combatReports;
  assert.equal(second.participants[0].hullBefore, first.participants[0].hullAfter);
  assert.equal(second.participants[0].shipsBefore, first.participants[0].shipsAfter);
  assert.equal(first.participants[1].fleetId, defender.id);
  assert.equal(second.participants[1].fleetId, extra.id);
  assert.ok(result.message.includes(first.summary) && result.message.includes(second.summary));
  assert.ok(validateSave(state));
});

test('invasion forecasts are pure and actual retaliation, shield reduction and capture match their reports', () => {
  let unshieldedRetaliation;
  for (const shielded of [false, true]) {
    const { state, attacker, target } = invadeFixture(shielded);
    const before = structuredClone(state);
    const forecast = estimateInvasion(state, attacker.id);
    assert.deepEqual(state, before, 'forecast neither consumes RNG nor changes state');
    assert.equal(forecast.shielded, shielded);
    assert.equal(forecast.defense, getSystemYield(state, target).defense);
    assert.ok(forecast.captureGuaranteed && forecast.capturePossible);
    const result = command(state, { type: 'attack', fleetId: attacker.id });
    const report = result.combatReports[0], invasion = report.invasion;
    assert.equal(report.kind, 'invasion'); assert.equal(report.outcome, 'captured');
    assert.equal(invasion.ownerBefore, 'veyr'); assert.equal(invasion.ownerAfter, 'player');
    assert.equal(invasion.defenseBefore, forecast.defense); assert.equal(invasion.defenseAfter, 0);
    assert.equal(invasion.damage, forecast.defense);
    assert.ok(invasion.damageRoll >= forecast.damageMin && invasion.damageRoll <= forecast.damageMax);
    assert.equal(invasion.retaliation, forecast.retaliation);
    assert.equal(invasion.retaliation, round(report.participants[0].hullBefore - report.participants[0].hullAfter));
    assert.equal(invasion.captured, true); assert.equal(target.owner, 'player');
    assert.ok(getSystemYield(state, target).defense > 0, 'report distinguishes defeated defending garrison from restored captured-colony defenses');
    if (!shielded) unshieldedRetaliation = invasion.retaliation;
    else assert.ok(invasion.retaliation < unshieldedRetaliation);
    assert.ok(validateSave(state));
  }
});

test('a repelled invasion records destruction and a forecast never promises capture to a fleet that will die', () => {
  const { state, attacker, target } = invadeFixture(true);
  attacker.ships = 1; attacker.hp = 1;
  const forecast = estimateInvasion(state, attacker.id);
  assert.equal(forecast.retaliation, 1);
  assert.equal(forecast.capturePossible, false);
  assert.equal(forecast.captureGuaranteed, false);
  const result = command(state, { type: 'attack', fleetId: attacker.id });
  const report = result.combatReports[0];
  assert.equal(report.outcome, 'repelled'); assert.equal(report.participants[0].shipsAfter, 0); assert.equal(report.participants[0].hullAfter, 0);
  assert.equal(report.invasion.ownerAfter, 'veyr'); assert.equal(report.invasion.captured, false);
  assert.equal(target.owner, 'veyr'); assert.ok(validateSave(state));
  assert.equal(estimateInvasion(state, attacker.id), null, 'destroyed fleets cannot preview an invasion');
});

test('invasion preview and reports do not expose remote colonies or unrelated AI wars', () => {
  const state = createGame();
  assert.equal(estimateInvasion(state, fleet(state).id), null);
  assert.equal(estimateInvasion(state, fleet(state, 'player', 'scout').id), null);
  const attacker = fleet(state, 'veyr'); attacker.systemId = 's2'; attacker.ships = 6; attacker.hp = 204;
  for (const defender of state.fleets.filter(f => f.owner === 'khar')) defender.systemId = 's20';
  war(state, 'veyr', 'khar');
  const result = command(state, { type: 'attack', factionId: 'veyr', fleetId: attacker.id });
  assert.equal(result.ok, true); assert.deepEqual(result.combatReports, []);
  assert.deepEqual(state.combatReports, []);
  assert.ok(!state.log.some(entry => entry.type === 'combat'));
});

test('AI attacks are captured in the cycle briefing, including an early victory before the turn increments', () => {
  for (const lethal of [false, true]) {
    const state = createGame('AI-report');
    war(state, 'player', 'khar');
    state.lanes = [['s0', 's2']];
    const attacker = fleet(state, 'khar'); attacker.systemId = 's0'; attacker.ships = 8; attacker.hp = 272;
    system(state, 's0').knownBy.push('khar'); system(state, 's0').exploredBy.push('khar');
    if (lethal) state.fleets = state.fleets.filter(f => f.owner !== 'player');
    else { const defender = fleet(state); defender.ships = 1; defender.hp = 34; }
    const turn = state.turn;
    const firstId = state.nextLogId;
    assert.ok(endTurn(state).ok);
    assert.ok(state.lastBriefing.reportIds.length > 0);
    assert.ok(state.lastBriefing.entries.some(entry => entry.type === 'combat' && entry.reportId));
    assert.ok(state.lastBriefing.entries.every(entry => entry.id >= firstId));
    const report = getCombatReport(state, state.lastBriefing.reportIds[0]);
    if (lethal) {
      assert.ok(state.winner); assert.equal(state.turn, turn); assert.equal(state.lastBriefing.turn, turn);
      assert.equal(report.kind, 'invasion'); assert.equal(report.invasion.ownerBefore, 'player');
      assert.ok(state.lastBriefing.entries.some(entry => entry.type === 'victory'));
    } else assert.equal(state.lastBriefing.turn, turn + 1);
    assert.ok(validateSave(state));
  }
});

test('briefings include new research, construction, diplomacy and warnings once, excluding previous player actions', () => {
  const state = createGame('briefing-boundary');
  faction(state).contacts.push('veyr'); faction(state, 'veyr').contacts.push('player');
  command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'gift' });
  command(state, { type: 'build', systemId: 's0', itemId: 'lab' });
  system(state, 's0').queue.progress = system(state, 's0').queue.work - 1;
  command(state, { type: 'research', techId: 'physics' });
  faction(state).research.progress = TECHS.physics.cost - 1;
  for (const id of ['player', 'veyr']) {
    const relation = faction(state, id).relations[id === 'player' ? 'veyr' : 'player'];
    relation.trade = true; relation.tradeEndsAt = 2;
  }
  faction(state).credits = 0;
  const expensive = fleet(state); expensive.type = 'cruiser'; expensive.ships = 8; expensive.hp = 680;
  const oldIds = new Set(state.log.map(entry => entry.id));
  endTurn(state);
  const briefing = state.lastBriefing;
  const entries = briefing.entries;
  for (const type of ['research', 'construction', 'diplomacy', 'warning']) assert.ok(entries.some(entry => entry.type === type), `${type} appears in briefing`);
  assert.ok(entries.every(entry => !oldIds.has(entry.id)));
  assert.equal(entries.find(entry => entry.type === 'research').techId, 'physics');
  assert.equal(entries.find(entry => entry.type === 'construction').systemId, 's0');
  assert.equal(entries.find(entry => entry.type === 'construction').itemId, 'lab');
  assert.ok(entries.filter(entry => entry.type === 'diplomacy').every(entry => entry.targetId === 'veyr'));
  const firstEntryIds = new Set(entries.map(entry => entry.id));
  const historical = JSON.stringify(briefing);
  endTurn(state);
  assert.ok(state.lastBriefing.entries.every(entry => !firstEntryIds.has(entry.id)), 'old cycle events are not repeated');
  assert.equal(JSON.stringify(briefing), historical);
  assert.ok(Object.isFrozen(briefing) && Object.isFrozen(briefing.entries));
  assert.ok(validateSave(state));
});

test('war declarations generated by AI appear in the briefing with a diplomatic navigation target', () => {
  const state = createGame('briefing-war');
  state.lanes = [['s0', 's2']];
  faction(state).contacts.push('khar'); faction(state, 'khar').contacts.push('player');
  system(state, 's0').knownBy.push('khar'); system(state, 's2').knownBy.push('player');
  const khar = faction(state, 'khar'); khar.relations.player.grievance = 40;
  fleet(state, 'khar').ships = 5; fleet(state, 'khar').hp = 170;
  endTurn(state);
  const declaration = state.lastBriefing.entries.find(entry => entry.type === 'war' && entry.text.includes('declared war'));
  assert.ok(declaration); assert.equal(declaration.targetId, 'khar');
});

test('report storage is bounded, historical links can outlive retention, and saves validate/report round-trip', () => {
  const { state, attacker, target } = battleFixture();
  const report = command(state, { type: 'move', fleetId: attacker.id, targetId: target.id }).combatReports[0];
  for (let i = 0; i < 55; i++) appendCombatReport(state, report);
  assert.equal(state.combatReports.length, 50);
  assert.equal(state.nextCombatReportId, 57);
  assert.equal(getCombatReport(state, report.id), null);
  assert.ok(validateSave(state), 'evicted report links in older logs are valid historical references');
  endTurn(state);
  const restored = JSON.parse(JSON.stringify(state));
  assert.ok(validateSave(restored));
  assert.deepEqual(restored.combatReports, state.combatReports);
  assert.deepEqual(restored.lastBriefing, state.lastBriefing);
  const old = createGame(); delete old.combatReports; delete old.nextCombatReportId; delete old.lastBriefing;
  assert.ok(validateSave(old), 'old version-one saves need no reporting fields');
  for (const corrupt of [
    value => { value.combatReports[0].participants[0].shipsAfter = 99; },
    value => { value.combatReports[0].participants[0].hullAfter = -1; },
    value => { value.combatReports[0].systemId = 'missing'; },
    value => { value.combatReports[0].turn = value.turn + 1; },
    value => { value.combatReports[0].participants[0].owner = 'choir'; value.combatReports[0].participants[1].owner = 'veyr'; },
    value => { value.nextCombatReportId = 1; },
    value => { value.lastBriefing.entries = [{ id: 1, turn: 1, type: 'research', text: 'Bad tech', techId: '__proto__' }]; },
    value => { value.lastBriefing.reportIds = [999]; },
    value => { value.lastBriefing.turn = value.turn + 1; },
  ]) { const copy = structuredClone(restored); corrupt(copy); assert.equal(validateSave(copy), false); }
});
