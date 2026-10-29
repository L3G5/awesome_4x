import { legacyCampaign } from './legacy-campaign-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, command, estimateInvasion, getSystemYield, validateSave } from '../src/game.js';

const clone = value => JSON.parse(JSON.stringify(value));
const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const fleet = (state, id) => state.fleets.find(candidate => candidate.id === id);

// Reconstruct the independently reported synthetic-lethal.json fixture with
// no external /tmp dependency. This is a controlled test, not a campaign loss.
function fixture({ hp = 3, defense = 8, shielded = false, historical = false } = {}) {
  const state = historical ? legacyCampaign('LETHAL-INVASION-REVIEW') : createGame('LETHAL-INVASION-REVIEW');
  state.turn = 2;
  const attacker = state.fleets.find(candidate => candidate.owner === 'player' && candidate.type === 'frigate');
  const target = state.systems.find(system => system.id === 's1');
  attacker.systemId = target.id; attacker.hp = hp;
  state.fleets = state.fleets.filter(candidate => candidate.owner !== 'veyr');
  target.knownBy.push('player'); target.exploredBy.push('player');
  target.defenseDamage = getSystemYield(state, target).defense - defense;
  for (const [first, second] of [['player', 'veyr'], ['veyr', 'player']]) {
    faction(state, first).contacts.push(second);
    faction(state, first).relations[second].status = 'war';
  }
  if (shielded) faction(state).techs.push('shields');
  assert.equal(validateSave(state), true);
  return { state, attacker, target };
}

/** Compare the prediction to an ordinary paid attack, including its report. */
function attackChecked({ state, attacker }) {
  const before = clone(state), unpreviewed = clone(state), action = { type: 'attack', fleetId: attacker.id };
  const forecast = estimateInvasion(state, attacker.id);
  assert.deepEqual(state, before, 'reading the preview cannot change state or consume RNG');
  const result = command(state, action), control = command(unpreviewed, action);
  assert.equal(result.ok, true);
  assert.deepEqual(result, control); assert.deepEqual(state, unpreviewed, 'previewing cannot change any ordinary attack outcome');
  const report = result.combatReports[0];
  assert.equal(report.kind, 'invasion');
  assert.equal(forecast.hullAfter, report.participants[0].hullAfter);
  assert.equal(forecast.hullAfter, fleet(state, attacker.id)?.hp ?? 0);
  assert.equal(forecast.hullAfter > 0, Boolean(fleet(state, attacker.id)));
  assert.equal(forecast.retaliation, report.invasion.retaliation);
  assert.equal(faction(state).orders, faction(before).orders - 1);
  assert.equal(attacker.movesLeft, before.fleets.find(candidate => candidate.id === attacker.id).movesLeft - 1);
  assert.equal(validateSave(state), true);
  return { forecast, report };
}

test('the exact synthetic lethal case exposes zero remaining hull even when the colony loses all defense', () => {
  const scenario = fixture({ historical: true });
  assert.equal(createHash('sha256').update(JSON.stringify(scenario.state)).digest('hex'), 'c2f7711683fd1ac590397f375c27aaecc821d72bccdd3f0c1bf73b2f87014239');
  const { forecast, report } = attackChecked(scenario);
  assert.deepEqual(forecast, {
    systemId: 's1', defense: 8, damageMin: 11, damageMax: 13,
    retaliation: 3, hullAfter: 0, shielded: false, capturePossible: false, captureGuaranteed: false,
  });
  assert.equal(report.outcome, 'repelled'); assert.equal(report.invasion.defenseAfter, 0);
  assert.equal(report.invasion.captured, false); assert.equal(scenario.target.owner, 'veyr');
});

test('surviving an invasion with defenses remaining is distinct from either capture outcome', () => {
  for (const shielded of [false, true]) {
    const scenario = fixture({ hp: 34, defense: 20, shielded });
    const { forecast, report } = attackChecked(scenario);
    assert.ok(forecast.hullAfter > 0); assert.ok(report.invasion.defenseAfter > 0);
    assert.equal(forecast.capturePossible, false); assert.equal(forecast.captureGuaranteed, false);
    assert.equal(report.invasion.captured, false); assert.equal(scenario.target.owner, 'veyr');
  }
});

test('guaranteed capture retains the attacker across ordinary damage rolls, with and without shields', () => {
  for (const shielded of [false, true]) for (const rng of [0, 2147483648]) {
    const scenario = fixture({ hp: 34, shielded }); scenario.state.rng = rng;
    const { forecast, report } = attackChecked(scenario);
    assert.ok(forecast.hullAfter > 0); assert.equal(forecast.captureGuaranteed, true);
    assert.equal(forecast.capturePossible, true); assert.equal(report.invasion.captured, true);
    assert.equal(scenario.target.owner, 'player');
  }
});

test('possible capture covers both ordinary outcomes while predicting the same surviving hull', () => {
  const outcomes = new Set(), survivingHull = new Set();
  for (const rng of [0, 2147483648]) {
    const scenario = fixture({ hp: 34, defense: 12 }); scenario.state.rng = rng;
    const { forecast, report } = attackChecked(scenario);
    assert.equal(forecast.capturePossible, true); assert.equal(forecast.captureGuaranteed, false);
    assert.ok(forecast.hullAfter > 0);
    outcomes.add(report.invasion.captured); survivingHull.add(forecast.hullAfter);
  }
  assert.deepEqual([...outcomes].sort(), [false, true]); assert.equal(survivingHull.size, 1);
});

test('rounded retaliation cannot be subtracted from fractional input hull to infer survival', () => {
  for (const [hp, shielded] of [[4.04, false], [3.24, true], [Number.MIN_VALUE, false]]) {
    const scenario = fixture({ hp, shielded });
    const { forecast, report } = attackChecked(scenario);
    assert.ok(hp > forecast.retaliation, 'the rounded loss alone would misleadingly leave positive hull');
    assert.equal(forecast.hullAfter, 0); assert.equal(report.participants[0].shipsAfter, 0);
    assert.equal(report.invasion.captured, false);
    if (hp === Number.MIN_VALUE) assert.equal(forecast.retaliation, 0, 'a displayed zero loss need not preserve tiny legacy hull');
  }
});

test('post-retaliation hull agrees with ordinary commands on both sides of floating rounding boundaries', () => {
  const hulls = [];
  for (const [hp, shielded] of [[4.05, false], [4.050000000000001, false], [4.06, false], [3.25, true], [3.250000000000001, true], [3.26, true]]) {
    const scenario = fixture({ hp, shielded });
    const { forecast, report } = attackChecked(scenario);
    hulls.push(forecast.hullAfter);
    assert.equal(forecast.capturePossible, forecast.hullAfter > 0);
    assert.equal(report.invasion.captured, forecast.hullAfter > 0);
  }
  assert.deepEqual(hulls, [0, .1, .1, 0, .1, .1]);
});

test('the forecast remains pure on frozen input and ignores unrelated remote forces and worlds', () => {
  const { state, attacker, target } = fixture({ hp: 34 });
  const expected = estimateInvasion(state, attacker.id), changed = clone(state);
  for (const empire of changed.factions.filter(empire => empire.id !== 'player')) {
    empire.credits += 99999; empire.minerals += 99999; empire.techs = ['weapons', 'shields'];
    empire.research = { techId: 'industry', progress: 1 };
  }
  for (const other of changed.fleets.filter(other => other.owner !== 'player')) Object.assign(other, { type: 'cruiser', ships: 12, hp: 1020, systemId: 's20' });
  for (const system of changed.systems.filter(system => system.owner !== 'player' && system.id !== target.id)) Object.assign(system, { population: 20, buildings: ['bastion'], defenseDamage: 0 });
  assert.deepEqual(estimateInvasion(changed, attacker.id), expected);
  const before = clone(state);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const forecast = estimateInvasion(freeze(state), attacker.id); forecast.hullAfter = 999;
  assert.deepEqual(state, before); assert.deepEqual(estimateInvasion(state, attacker.id), expected);
});

test('the added field does not widen invasion-preview eligibility or expose remote targets', () => {
  const { state, attacker, target } = fixture({ hp: 34 });
  attacker.systemId = 's0';
  assert.equal(estimateInvasion(state, attacker.id), null, 'an own fleet at home cannot preview a distant enemy invasion');
  assert.equal(estimateInvasion(state, 'missing'), null);
  const scout = state.fleets.find(candidate => candidate.owner === 'player' && candidate.type === 'scout');
  scout.systemId = target.id;
  assert.equal(estimateInvasion(state, scout.id), null);
  attacker.systemId = target.id;
  state.fleets.push({ id: `f${state.nextFleetId++}`, name: 'Visible orbital defender', owner: 'veyr', type: 'frigate', systemId: target.id, ships: 1, hp: 34, movesLeft: 1 });
  assert.equal(estimateInvasion(state, attacker.id), null, 'hostile orbital fleets must be cleared before an invasion can be forecast');
});
