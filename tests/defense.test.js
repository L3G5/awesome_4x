import { legacyCampaign } from './legacy-campaign-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getNeighbors, getDefenseLeadPreview, orderDefenders, validateSave } from '../src/game.js';
import { getDefenseOrder, getEngagementPreview } from '../src/combat-preview.js';
import { advanceDiplomacy } from '../src/diplomacy.js';
import { captureParticipant } from '../src/reports.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const fleet = (state, owner = 'player', type = 'frigate') => state.fleets.find(candidate => candidate.owner === owner && candidate.type === type);
const act = (state, type, force, extra = {}) => command(state, { type, fleetId: force.id, ...extra });
const assign = (state, force) => act(state, 'leadDefense', force, { factionId: force.owner });
function war(state, first = 'player', second = 'veyr') {
  for (const [a, b] of [[first, second], [second, first]]) {
    const owner = faction(state, a);
    if (!owner.contacts.includes(b)) owner.contacts.push(b);
    owner.relations[b].status = 'war';
  }
}
function addFleet(state, template, extra = {}) {
  const created = { ...structuredClone(template), id: `f${state.nextFleetId++}`, ...extra };
  state.fleets.push(created);
  return created;
}
function sequence(arrival = false, historical = false) {
  const state = historical ? legacyCampaign('formation-sequence') : createGame('formation-sequence');
  const attacker = fleet(state), defender = fleet(state, 'veyr'), ark = fleet(state, 'veyr', 'colony');
  war(state);
  for (const id of ['player', 'veyr']) faction(state, id).techs.push('shields');
  for (const force of [attacker, defender]) { force.ships = 4; force.hp = 136; }
  const targetId = arrival ? getNeighbors(state, attacker.systemId)[0] : attacker.systemId;
  defender.systemId = ark.systemId = targetId;
  state.fleets = [...state.fleets.filter(force => ![defender.id, ark.id].includes(force.id)), defender, ark];
  return { state, attacker, defender, ark, targetId };
}

test('lead assignment and removal spend one order without changing movement, resources, route, Hold or fleet order', () => {
  const state = createGame('defense-cost'), force = fleet(state);
  force.movesLeft = 0; force.hold = true;
  const target = getNeighbors(state, force.systemId)[0];
  force.route = { destinationId: target, path: [force.systemId, target] };
  const before = structuredClone(state), preview = getDefenseLeadPreview(state, force.id);
  assert.deepEqual(preview, { lead: false, currentLeadId: null, assign: { enabled: true, reason: '', orders: 1 }, clear: { enabled: true, reason: '', orders: 0 } });
  assert.deepEqual(state, before);
  assert.equal(assign(state, force).ok, true);
  const expected = structuredClone(before);
  expected.fleets.find(candidate => candidate.id === force.id).defenseLead = true;
  faction(expected).orders--;
  assert.deepEqual(state, expected);
  assert.equal(getDefenseLeadPreview(state, force.id).currentLeadId, force.id);
  assert.equal(act(state, 'clearDefenseLead', force).ok, true);
  delete expected.fleets.find(candidate => candidate.id === force.id).defenseLead;
  faction(expected).orders--;
  assert.deepEqual(state, expected);
  assert.equal(validateSave(state), true);
});

test('a new lead replaces only the same owner and orbit assignment', () => {
  const state = createGame('defense-replace'), first = fleet(state), second = addFleet(state, first);
  const elsewhere = addFleet(state, first, { systemId: getNeighbors(state, first.systemId)[0] });
  const foreign = fleet(state, 'veyr'); foreign.systemId = first.systemId;
  for (const force of [first, elsewhere, foreign]) assert.equal(assign(state, force).ok, true);
  assert.equal(getDefenseLeadPreview(state, second.id).currentLeadId, first.id);
  const order = state.fleets.map(force => force.id), beforeOrders = faction(state).orders;
  assert.equal(assign(state, second).ok, true);
  assert.equal(faction(state).orders, beforeOrders - 1);
  assert.equal(first.defenseLead, undefined);
  for (const force of [second, elsewhere, foreign]) assert.equal(force.defenseLead, true);
  assert.deepEqual(state.fleets.map(force => force.id), order);
  assert.equal(validateSave(state), true);
});

test('same-lead assignment and clearing a nonlead are exact free no-ops at zero orders', () => {
  const state = createGame('defense-noop'), force = fleet(state), other = addFleet(state, force);
  assign(state, force); other.defenseLead = false; faction(state).orders = 0;
  for (const [type, target, option] of [['leadDefense', force, 'assign'], ['clearDefenseLead', other, 'clear']]) {
    const before = structuredClone(state), preview = getDefenseLeadPreview(state, target.id);
    assert.equal(preview[option].enabled, true);
    assert.equal(preview[option].orders, 0);
    assert.equal(act(state, type, target).ok, true);
    assert.deepEqual(state, before);
  }
  for (const [type, target, option] of [['leadDefense', other, 'assign'], ['clearDefenseLead', force, 'clear']]) {
    const before = structuredClone(state), preview = getDefenseLeadPreview(state, target.id), result = act(state, type, target);
    assert.equal(result.ok, false);
    assert.equal(result.message, preview[option].reason);
    assert.deepEqual(state, before);
  }
});

test('foreign, missing and civilian previews are neutral; ended and eliminated commands reject even no-ops', () => {
  const state = createGame('defense-boundaries'), force = fleet(state), foreign = fleet(state, 'veyr');
  for (const id of [foreign.id, fleet(state, 'player', 'scout').id, fleet(state, 'player', 'colony').id, 'missing']) {
    assert.equal(getDefenseLeadPreview(state, id), null);
    for (const type of ['leadDefense', 'clearDefenseLead']) {
      const before = structuredClone(state);
      assert.equal(command(state, { type, fleetId: id }).ok, false);
      assert.deepEqual(state, before);
    }
  }
  const absent = getDefenseLeadPreview(state, foreign.id);
  foreign.systemId = 's35'; foreign.defenseLead = true;
  assert.equal(getDefenseLeadPreview(state, foreign.id), absent);
  for (const ended of [true, false]) {
    const copy = structuredClone(state), own = fleet(copy); own.defenseLead = true;
    if (ended) { copy.winner = 'veyr'; copy.victoryType = 'Legacy'; } else faction(copy).eliminated = true;
    for (const type of ['leadDefense', 'clearDefenseLead']) {
      const before = structuredClone(copy), preview = getDefenseLeadPreview(copy, own.id), result = act(copy, type, own);
      assert.equal(result.ok, false);
      assert.equal(result.message, preview[type === 'leadDefense' ? 'assign' : 'clear'].reason);
      assert.deepEqual(copy, before);
    }
  }
});

test('ordering promotes each local lead only within its government slots and never mutates the input', () => {
  const make = (id, owner, systemId = 's0', defenseLead) => ({ id, owner, systemId, defenseLead });
  const input = [make('pCivil', 'player'), make('kCivil', 'khar'), make('pNormal', 'player'), make('pElsewhere', 'player', 's4'), make('kLead', 'khar', 's0', true), make('pLead', 'player', 's0', true), make('pOtherLead', 'player', 's4', true)];
  const before = structuredClone(input), result = orderDefenders(input);
  assert.notEqual(result, input);
  assert.deepEqual(result.map(force => force.id), ['pLead', 'kLead', 'pCivil', 'pOtherLead', 'kCivil', 'pNormal', 'pElsewhere']);
  assert.deepEqual(input, before);
  for (const force of result) assert.equal(force, input.find(candidate => candidate.id === force.id));
  const unmarked = input.map(({ defenseLead, ...force }) => force);
  assert.deepEqual(orderDefenders(unmarked), unmarked);
});

test('move and attack use the previewed defensive order, including continuation after a surviving lead', () => {
  for (const arrival of [false, true]) {
    const { state, attacker, defender, ark, targetId } = sequence(arrival);
    // The Ark originally occupies the earlier slot. An explicit order promotes
    // the military formation without changing the underlying fleet array.
    state.fleets = [...state.fleets.filter(force => ![defender.id, ark.id].includes(force.id)), ark, defender];
    if (arrival) fleet(state, 'player', 'scout').systemId = targetId;
    assert.equal(assign(state, defender).ok, true);
    const preview = getEngagementPreview(state, attacker.id, targetId);
    assert.deepEqual(preview.opponents.map(force => force.id), [defender.id, ark.id]);
    assert.equal(preview.opponents[0].defenseLead, true);
    const result = act(state, arrival ? 'move' : 'attack', attacker, arrival ? { targetId } : {});
    assert.equal(result.ok, true);
    assert.deepEqual(result.combatReports.map(report => report.participants[1].fleetId), [defender.id, ark.id]);
    assert.equal(result.combatReports[0].outcome, 'contested');
    assert.equal(result.combatReports[0].participants[1].defenseLead, true);
    assert.equal(defender.defenseLead, true);
    assert.equal(result.combatReports[1].participants[1].defenseLead, undefined);
    assert.equal(validateSave(state), true);
  }
});

test('default no-lead exchanges preserve pre-feature casualties, RNG, costs and report shape', () => {
  // Captured from the ordinary Stage13 engine at 0fc7de7 for this exact seed
  // and fixture, independently for both move and attack commands.
  const expected = [
    { outcome: 'contested', participants: [
      { fleetId: 'f3', shipsBefore: 4, shipsAfter: 1, hullBefore: 136, hullAfter: 12.4 },
      { fleetId: 'f6', shipsBefore: 4, shipsAfter: 2, hullBefore: 136, hullAfter: 44 },
    ] },
    { outcome: 'defender-destroyed', participants: [
      { fleetId: 'f3', shipsBefore: 1, shipsAfter: 1, hullBefore: 12.4, hullAfter: 12.4 },
      { fleetId: 'f5', shipsBefore: 1, shipsAfter: 0, hullBefore: 24, hullAfter: 0 },
    ] },
  ];
  for (const arrival of [false, true]) for (const explicitFalse of [false, true]) {
    const { state, attacker, targetId } = sequence(arrival, true);
    if (explicitFalse) for (const force of state.fleets) force.defenseLead = false;
    const result = act(state, arrival ? 'move' : 'attack', attacker, arrival ? { targetId } : {});
    assert.equal(state.rng, 1063615140);
    assert.equal(faction(state).orders, 5);
    assert.equal(attacker.movesLeft, 0);
    assert.deepEqual(result.combatReports.map(report => ({ outcome: report.outcome, participants: report.participants.map(({ fleetId, shipsBefore, shipsAfter, hullBefore, hullAfter }) => ({ fleetId, shipsBefore, shipsAfter, hullBefore, hullAfter })) })), expected);
    assert.ok(result.combatReports.every(report => report.participants.every(participant => !Object.hasOwn(participant, 'defenseLead'))));
  }
});

test('physical movement and route continuation clear a lead; planning, failed movement and repair preserve it', () => {
  for (const routed of [false, true]) {
    const state = createGame('defense-departure'), force = fleet(state), destination = getNeighbors(state, force.systemId)[0];
    assign(state, force); force.hp = 25;
    assert.equal(act(state, 'repair', force).ok, true);
    assert.equal(force.defenseLead, true);
    assert.equal(act(state, 'planRoute', force, { destinationId: destination }).ok, true);
    assert.equal(force.defenseLead, true);
    const before = structuredClone(state);
    assert.equal(act(state, 'move', force, { targetId: force.systemId }).ok, false);
    assert.deepEqual(state, before);
    assert.equal(act(state, routed ? 'continueRoute' : 'move', force, routed ? {} : { targetId: destination }).ok, true);
    assert.equal(force.systemId, destination);
    assert.equal(force.defenseLead, undefined);
    assert.equal(validateSave(state), true);
  }
});

test('a civilian interception preserves its explicit false metadata because no physical departure occurs', () => {
  const state = createGame('defense-interception'), scout = fleet(state, 'player', 'scout'), origin = scout.systemId, targetId = getNeighbors(state, origin)[0];
  scout.defenseLead = false; war(state);
  fleet(state, 'veyr').systemId = targetId;
  const result = act(state, 'move', scout, { targetId });
  assert.equal(result.outcome, 'intercepted');
  assert.equal(scout.systemId, origin);
  assert.equal(scout.defenseLead, false);
  assert.equal(validateSave(state), true);
});

test('split leaves the original lead and merge transfers either input lead to the survivor', () => {
  for (const keepOriginal of [false, true]) {
    const state = createGame('defense-split'), original = fleet(state);
    original.ships = 3; original.hp = 83; original.hold = true; assign(state, original);
    const split = act(state, 'split', original, { ships: 1 }), child = state.fleets.find(force => force.id === split.newFleetId);
    assert.equal(split.ok, true);
    assert.equal(original.defenseLead, true);
    assert.equal(child.defenseLead, undefined);
    const survivor = keepOriginal ? original : child, consumed = keepOriginal ? child : original;
    assert.equal(act(state, 'merge', survivor, { targetFleetId: consumed.id }).ok, true);
    assert.equal(survivor.defenseLead, true);
    assert.equal(survivor.hp, 83);
    assert.equal(survivor.ships, 3);
    assert.equal(survivor.hold, keepOriginal ? true : undefined);
    assert.equal(validateSave(state), true);
  }
});

test('treaty withdrawal clears only departing leads and preserves an existing destination lead', () => {
  const state = createGame('defense-withdrawal'), departing = fleet(state), resident = addFleet(state, departing);
  departing.systemId = 's1'; assign(state, departing); assign(state, resident);
  for (const [a, b] of [['player', 'veyr'], ['veyr', 'player']]) {
    faction(state, a).contacts.push(b);
    Object.assign(faction(state, a).relations[b], { trade: true, tradeEndsAt: 2 });
  }
  state.turn = 2; advanceDiplomacy(state);
  assert.equal(departing.systemId, resident.systemId);
  assert.equal(departing.movesLeft, 0);
  assert.equal(departing.defenseLead, undefined);
  assert.equal(resident.defenseLead, true);
  assert.equal(validateSave(state), true);
});

test('a stranded withdrawal has no physical destination and retains the defensive lead', () => {
  const state = createGame('defense-stranded'), force = fleet(state), home = state.systems[0];
  home.owner = 'veyr'; force.systemId = home.id;
  for (const system of state.systems.filter(candidate => !candidate.owner)) system.knownBy = system.knownBy.filter(id => id !== 'player');
  assign(state, force);
  for (const [a, b] of [['player', 'veyr'], ['veyr', 'player']]) {
    faction(state, a).contacts.push(b);
    Object.assign(faction(state, a).relations[b], { trade: true, tradeEndsAt: 2 });
  }
  state.turn = 2; advanceDiplomacy(state);
  assert.equal(force.systemId, home.id);
  assert.equal(force.defenseLead, true);
  assert.equal(force.movesLeft, 0);
});

test('a surviving lead faces repeated attackers while combat clears Hold independently', () => {
  const state = createGame('defense-repeated'), defender = fleet(state), first = fleet(state, 'veyr');
  war(state); defender.ships = 4; defender.hp = 136;
  first.systemId = defender.systemId; first.hp = 1;
  const second = addFleet(state, first); assign(state, defender);
  act(state, 'hold', defender);
  for (const attacker of [first, second]) {
    const result = act(state, 'attack', attacker, { factionId: 'veyr' });
    assert.equal(result.ok, true);
    assert.equal(result.combatReports.length, 1);
    assert.equal(result.combatReports[0].participants[1].fleetId, defender.id);
    assert.equal(result.combatReports[0].participants[1].defenseLead, true);
    assert.equal(defender.defenseLead, true);
    assert.equal(defender.hold, undefined);
  }
  assert.equal(validateSave(state), true);
});

test('only an actual defending lead enters historical snapshots, which survive later lead changes and fleet loss', () => {
  const { state, attacker, defender } = sequence();
  assign(state, attacker); assign(state, defender);
  const result = act(state, 'attack', attacker), report = result.combatReports[0];
  assert.equal(attacker.defenseLead, true, 'attacking in place is not a departure');
  assert.equal(report.participants[0].defenseLead, undefined);
  assert.equal(report.participants[1].defenseLead, true);
  assert.equal(captureParticipant(attacker, 'attacker').defenseLead, undefined);
  const historical = structuredClone(report);
  act(state, 'clearDefenseLead', defender, { factionId: 'veyr' });
  state.fleets = state.fleets.filter(force => force.id !== defender.id);
  assert.deepEqual(report, historical);
  assert.equal(validateSave(state), true);
  for (const mutate of [
    copy => { copy.combatReports[1].participants[0].defenseLead = true; },
    copy => { copy.combatReports[0].participants[1].defenseLead = true; },
    copy => { copy.combatReports[1].participants[1].defenseLead = 'yes'; },
  ]) {
    const invalid = JSON.parse(JSON.stringify(state)); mutate(invalid);
    assert.equal(validateSave(invalid), false);
  }
});

test('v1 saves allow absent and false lead fields but reject malformed, civilian or duplicate true leads', () => {
  const state = createGame('defense-validation'), own = fleet(state), other = addFleet(state, own);
  assert.equal(validateSave(state), true);
  for (const force of state.fleets) force.defenseLead = false;
  assert.equal(validateSave(state), true);
  assign(state, own);
  for (const mutate of [
    copy => { fleet(copy).defenseLead = 1; },
    copy => { fleet(copy).defenseLead = null; },
    copy => { fleet(copy, 'player', 'scout').defenseLead = true; },
    copy => { fleet(copy, 'player', 'colony').defenseLead = true; },
    copy => { copy.fleets.find(force => force.id === other.id).defenseLead = true; },
  ]) {
    const invalid = structuredClone(state); mutate(invalid); assert.equal(validateSave(invalid), false);
  }
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(validateSave(restored), true);
  assert.deepEqual(getDefenseOrder(restored, own.systemId), getDefenseOrder(state, own.systemId));
  endTurn(state); endTurn(restored);
  assert.deepEqual(state, restored);
  assert.equal(validateSave(state), true);
});

test('unobserved foreign lead assignments do not change an arrival preview', () => {
  const state = createGame('defense-fog'), own = fleet(state), target = getNeighbors(state, own.systemId)[0];
  war(state); const before = getEngagementPreview(state, own.id, target);
  const hidden = fleet(state, 'veyr'); hidden.systemId = target; hidden.defenseLead = true;
  hidden.ships = 9; hidden.hp = 306;
  assert.deepEqual(getEngagementPreview(state, own.id, target), before);
  assert.equal(getDefenseLeadPreview(state, hidden.id), null);
});
