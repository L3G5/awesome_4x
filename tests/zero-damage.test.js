import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, validateSave } from '../src/game.js';

// Synthetic valid boundary fixtures discovered in a planning review. These
// are not evidence of corruption in an actual historical player campaign.
function fixture(seed = 'zero-damage-control', defenderType = 'colony') {
  const state = createGame(seed);
  const attacker = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate');
  const defender = state.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === defenderType);
  defender.systemId = attacker.systemId;
  for (const [first, second] of [['player', 'veyr'], ['veyr', 'player']]) {
    const faction = state.factions.find(candidate => candidate.id === first);
    faction.contacts.push(second); faction.relations[second].status = 'war';
  }
  return { state, attacker, defender };
}
const attack = ({ state, attacker }) => command(state, { type: 'attack', fleetId: attacker.id });

test('zero-fire Ark attacks preserve exact fractional hull without death or healing', () => {
  for (const hp of [.01, .06, Number.MIN_VALUE]) for (const shielded of [false, true]) {
    const scenario = fixture(), { state, attacker } = scenario;
    attacker.hp = hp;
    if (shielded) state.factions[0].techs.push('shields');
    assert.equal(validateSave(state), true);
    const orders = state.factions[0].orders, moves = attacker.movesLeft;
    const result = attack(scenario);
    assert.equal(result.ok, true);
    assert.equal(attacker.hp, hp);
    assert.equal(attacker.ships, 1);
    assert.ok(state.fleets.includes(attacker));
    assert.equal(state.factions[0].orders, orders - 1);
    assert.equal(attacker.movesLeft, moves - 1);
    // Same RNG endpoint as the healthy, one-frigate/Ark control executed with
    // the unmodified 705b612 engine: zero-hit handling consumes no randomness.
    assert.equal(state.rng, 947381163);
    const report = result.combatReports[0];
    assert.equal(report.outcome, 'defender-destroyed');
    assert.equal(report.participants[0].hullBefore, hp);
    assert.equal(report.participants[0].hullAfter, hp);
    assert.equal(report.participants[0].shipsAfter, 1);
    assert.match(report.summary, /Concord lost 0 ships and 0 hull/);
    assert.equal(validateSave(state), true);
  }
});

test('zero fire preserves valid explicit ship counts above the hull-derived count', () => {
  for (const hp of [.01, .06, .1]) {
    const scenario = fixture(), { state, attacker } = scenario;
    attacker.ships = 12; attacker.hp = hp;
    assert.ok(attacker.ships > Math.ceil(attacker.hp / 34));
    assert.equal(validateSave(state), true);
    const healthy = structuredClone(state);
    const control = healthy.fleets.find(fleet => fleet.id === attacker.id);
    control.hp = control.ships * 34;
    const controlResult = command(healthy, { type: 'attack', fleetId: control.id });
    const result = attack(scenario), participant = result.combatReports[0].participants[0];
    assert.equal(result.ok, true);
    assert.equal(attacker.ships, 12);
    assert.equal(attacker.hp, hp);
    assert.equal(participant.shipsBefore, 12);
    assert.equal(participant.shipsAfter, 12);
    assert.equal(participant.hullBefore, hp);
    assert.equal(participant.hullAfter, hp);
    assert.equal(state.rng, healthy.rng);
    assert.deepEqual(result.combatReports[0].participants[1], controlResult.combatReports[0].participants[1]);
    assert.equal(validateSave(state), true);
  }
});

test('fractional zero-hit reports and the next completed cycle survive exact JSON reload', () => {
  for (const hp of [.01, .06]) {
    const scenario = fixture(), { state, attacker } = scenario; attacker.hp = hp;
    const reloadedBefore = JSON.parse(JSON.stringify(state));
    const result = attack(scenario);
    const replay = command(reloadedBefore, { type: 'attack', fleetId: attacker.id });
    assert.deepEqual(result, replay);
    assert.deepEqual(state, reloadedBefore);
    const historical = JSON.parse(JSON.stringify(state.combatReports));
    const reloadedAfter = JSON.parse(JSON.stringify(state));
    assert.equal(validateSave(reloadedAfter), true);
    endTurn(state); endTurn(reloadedAfter);
    assert.deepEqual(state, reloadedAfter);
    assert.deepEqual(state.combatReports, historical);
    assert.equal(validateSave(state), true);
  }
});

test('positive-hit combat retains the exact pre-fix results with and without shields', () => {
  // Independently captured ordinary attacks from 705b612 before the zero guard.
  for (const shielded of [false, true]) {
    const scenario = fixture('positive-damage-control', 'frigate');
    const { state, attacker, defender } = scenario;
    attacker.ships = 3; attacker.hp = 83.06;
    defender.ships = 2; defender.hp = 68;
    if (shielded) for (const faction of state.factions.filter(candidate => ['player', 'veyr'].includes(candidate.id))) faction.techs.push('shields');
    assert.equal(validateSave(state), true);
    const result = attack(scenario);
    assert.equal(result.ok, true);
    assert.equal(state.rng, 1333619698);
    assert.equal(state.factions[0].orders, 5);
    assert.equal(attacker.movesLeft, 0);
    assert.deepEqual(result.combatReports.map(({ rounds, ...report }) => report), [{
      kind: 'fleet', systemId: 's0',
      participants: [
        { role: 'attacker', fleetId: 'f3', owner: 'player', name: 'Vanguard 3', type: 'frigate', shipsBefore: 3, hullBefore: 83.06, shipsAfter: 1, hullAfter: shielded ? 32.5 : 33.2 },
        { role: 'defender', fleetId: 'f6', owner: 'veyr', name: 'Vanguard 6', type: 'frigate', shipsBefore: 2, hullBefore: 68, shipsAfter: 0, hullAfter: 0 },
      ],
      outcome: 'defender-destroyed',
      summary: `Battle at Solace: Concord lost 2 ships and ${shielded ? '50.6' : '49.9'} hull; Veyr lost 2 ships and 68 hull. Attacking fleet survives; defending fleet destroyed.`,
      id: 1, turn: 1,
    }]);
    assert.equal(validateSave(state), true);
  }
});
