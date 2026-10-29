import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, validateSave } from '../src/game.js';
import { SHIPS, TECHS } from '../src/content.js';
import { getDiplomacyForecast, getDiplomaticIntent, getActiveDiplomacyOffers, DIPLOMACY_RULES } from '../src/diplomacy.js';
import { revealPublicBeacons } from '../src/victory.js';

const faction = (state, id) => state.factions.find(f => f.id === id);
const relation = (state, from, to) => faction(state, from).relations[to];
const fleet = (state, owner, type = 'frigate') => state.fleets.find(f => f.owner === owner && f.type === type);
const forecast = fixture => getDiplomacyForecast(fixture.state, fixture.proposer, fixture.recipient).peace;

function contact(state, first, second) {
  for (const [a, b] of [[first, second], [second, first]]) if (!faction(state, a).contacts.includes(b)) faction(state, a).contacts.push(b);
}

// A controlled valid checkpoint: ownership, infrastructure and completed
// research establish the late-game situation; declarations and blockading
// movement use ordinary commands. It is not another played campaign.
function fixture({ recipient = 'veyr', proposer = 'player', progress = 9, ownProgress = 0,
  ownActive = true, age = 12, blockader = recipient, type = 'frigate', spare = false } = {}) {
  const state = createGame('blockade-peace-contrast');
  state.turn = 30;
  const neutral = state.systems.filter(s => !s.owner);
  const sites = [faction(state, proposer).capitalId, ...neutral.slice(0, 3).map(s => s.id)];
  const remote = neutral[6].id, hiddenRemote = neutral[7].id;
  const setNetwork = (id, worlds, value, active) => {
    for (const systemId of worlds) {
      const world = state.systems.find(s => s.id === systemId);
      world.owner = id; world.population = 4;
      if (!world.buildings.includes('beacon')) world.buildings.push('beacon');
      if (!world.knownBy.includes(id)) world.knownBy.push(id);
      if (!world.exploredBy.includes(id)) world.exploredBy.push(id);
    }
    faction(state, id).techs = ['logistics', 'industry', 'physics', 'computing', 'singularity'];
    faction(state, id).alignment = { progress: value, sites: worlds.slice(0, 3), active: value > 0 && active, started: value > 0, reportedBeacons: [...worlds] };
  };
  setNetwork(proposer, sites, progress, true);
  if (ownProgress) setNetwork(recipient, [faction(state, recipient).capitalId, ...neutral.slice(3, 5).map(s => s.id)], ownProgress, ownActive);
  for (const ownFleet of state.fleets.filter(f => f.owner === proposer)) ownFleet.systemId = remote;
  const recipientHome = faction(state, recipient).capitalId;
  if (!state.systems.find(s => s.id === recipientHome).knownBy.includes(proposer)) state.systems.find(s => s.id === recipientHome).knownBy.push(proposer);
  state.lanes = [[recipientHome, sites[0]], [recipientHome, sites[3]], [recipientHome, remote]];
  contact(state, proposer, recipient);
  assert.equal(command(state, { type: 'diplomacy', factionId: recipient, targetId: proposer, stance: 'war' }).ok, true);
  if (blockader && blockader !== recipient) {
    contact(state, proposer, blockader);
    state.lanes.push([faction(state, blockader).capitalId, spare ? sites[3] : sites[0]]);
    assert.equal(command(state, { type: 'diplomacy', factionId: blockader, targetId: proposer, stance: 'war' }).ok, true);
  }
  state.turn += age;
  revealPublicBeacons(state);
  const checkpoint = { state, recipient, proposer, sites, remote, hiddenRemote };
  if (blockader) occupy(checkpoint, blockader, type, spare ? sites[3] : sites[0]);
  assert.equal(validateSave(state), true);
  return checkpoint;
}

function occupy(checkpoint, owner = checkpoint.recipient, type = 'frigate', systemId = checkpoint.sites[0]) {
  const { state } = checkpoint, formation = fleet(state, owner, type);
  assert.ok(formation);
  if (!state.systems.find(s => s.id === systemId).knownBy.includes(owner)) state.systems.find(s => s.id === systemId).knownBy.push(owner);
  assert.equal(command(state, { type: 'move', factionId: owner, fleetId: formation.id, targetId: systemId }).ok, true);
  return formation;
}

test('a healthy recipient will not abandon its decisive Beacon blockade solely at ordinary peace age', () => {
  const checkpoint = fixture(), { state, proposer, recipient } = checkpoint;
  const terms = forecast(checkpoint), before = structuredClone(state);
  assert.equal(terms.accepted, false);
  assert.equal(terms.enabled, false);
  assert.equal(terms.willingness.warAge, 12);
  assert.equal(terms.willingness.lostColonies, 0);
  assert.equal(terms.willingness.blockadeLeverage, true);
  assert.match(terms.reason, /Beacon blockade/);
  assert.match(terms.reason, /ahead in public alignment/);
  assert.ok(terms.reason.includes(`${DIPLOMACY_RULES.truceTurns}-cycle truce`));
  assert.match(terms.reason, /during the 5-cycle truce/);
  assert.match(terms.reason, /colony losses, observed military pressure and war weariness/);
  assert.equal(command(state, { type: 'diplomacy', factionId: proposer, targetId: recipient, stance: 'peace' }).ok, false);
  assert.deepEqual(state, before, 'denial spends nothing, withdraws nobody and changes no history');
});

test('ordinary wars and unoccupied, third-party, spare-node or civilian blockades retain ordinary peace', () => {
  const cases = [
    { progress: 0, blockader: null },
    { blockader: null },
    { blockader: 'choir' },
    { spare: true },
    { type: 'scout' },
    { type: 'colony' },
  ];
  for (const options of cases) {
    const checkpoint = fixture(options), terms = forecast(checkpoint);
    assert.equal(terms.willingness.blockadeLeverage, false, JSON.stringify(options));
    assert.equal(terms.accepted, true, JSON.stringify(options));
    assert.equal(terms.enabled, true);
    assert.doesNotMatch(terms.reason, /blockade/);
  }
});

test('the public lead and remaining-step boundary use the whole truce, including an interrupted network', () => {
  for (const [options, leverage] of [
    [{ progress: 4 }, false],
    [{ progress: 5 }, true],
    [{ progress: 9 }, true],
    [{ progress: 5, ownProgress: 5 }, false],
    [{ progress: 5, ownProgress: 6 }, false],
    [{ progress: 5, ownProgress: 6, ownActive: false }, false],
  ]) {
    const checkpoint = fixture(options);
    assert.equal(forecast(checkpoint).willingness.blockadeLeverage, leverage, JSON.stringify(options));
    assert.equal(forecast(checkpoint).accepted, !leverage);
  }
  const interrupted = fixture({ progress: 8 });
  faction(interrupted.state, interrupted.proposer).alignment.active = false;
  assert.equal(validateSave(interrupted.state), true);
  assert.equal(forecast(interrupted).accepted, false, 'an actual blockade must not disappear because last cycle also interrupted alignment');
});

test('one controlled colony loss can outweigh the blockade at ordinary age and peace still pays and withdraws normally', () => {
  const checkpoint = fixture(), { state, recipient, proposer } = checkpoint;
  // A controlled loss checkpoint: the recipient began this war with one more
  // colony than it currently owns. The saved ordinary war counter is valid.
  relation(state, recipient, proposer).warStartColonies++;
  assert.equal(validateSave(state), true);
  assert.equal(forecast(checkpoint).accepted, true);
  assert.equal(forecast(checkpoint).willingness.blockadeLeverage, true);
  assert.match(forecast(checkpoint).willingness.reason, /lost 1 colony/);
  const credits = faction(state, proposer).credits, otherCredits = faction(state, recipient).credits;
  const orders = faction(state, proposer).orders, beforeProgress = faction(state, proposer).alignment.progress;
  const blocker = fleet(state, recipient);
  const restored = JSON.parse(JSON.stringify(state));
  const action = { type: 'diplomacy', factionId: proposer, targetId: recipient, stance: 'peace' };
  const result = command(state, action);
  assert.equal(result.ok, true);
  assert.deepEqual(command(restored, action), result);
  assert.deepEqual(restored, state, 'the next paid settlement has identical effects after JSON reload');
  assert.equal(faction(state, proposer).credits, credits - DIPLOMACY_RULES.peaceCost);
  assert.equal(faction(state, recipient).credits, otherCredits + DIPLOMACY_RULES.peaceCost);
  assert.equal(faction(state, proposer).orders, orders - 1);
  assert.equal(blocker.systemId, faction(state, recipient).capitalId);
  assert.equal(blocker.movesLeft, 0);
  assert.equal(relation(state, proposer, recipient).truceUntil, state.turn + DIPLOMACY_RULES.truceTurns);
  assert.equal(faction(state, proposer).alignment.progress, beforeProgress, 'negotiation does not advance the race');
  assert.equal(validateSave(state), true);
});

test('ordinary movement applying observable home pressure can outweigh a held Beacon', () => {
  const checkpoint = fixture(), { state, proposer, recipient } = checkpoint;
  assert.equal(forecast(checkpoint).accepted, false);
  const attacker = fleet(state, proposer);
  assert.equal(command(state, { type: 'move', factionId: proposer, fleetId: attacker.id, targetId: faction(state, recipient).capitalId }).ok, true);
  assert.equal(forecast(checkpoint).willingness.blockadeLeverage, true);
  assert.equal(forecast(checkpoint).accepted, true);
  assert.match(forecast(checkpoint).willingness.reason, /military pressure/);
  assert.equal(validateSave(state), true);
});

test('the threshold cap preserves eventual exhaustion for Veyr, Choir and Khar without removing the minimum war period', () => {
  for (const recipient of ['veyr', 'choir', 'khar']) {
    const reluctant = fixture({ recipient, age: recipient === 'khar' ? 16 : 12 });
    assert.equal(forecast(reluctant).accepted, false, recipient);
    const exhausted = fixture({ recipient, age: 20 });
    assert.equal(forecast(exhausted).willingness.blockadeLeverage, true);
    assert.equal(forecast(exhausted).accepted, true, recipient);
  }
  const early = fixture({ age: DIPLOMACY_RULES.minimumWarTurns - 1 });
  relation(early.state, early.recipient, early.proposer).warStartColonies += 2;
  assert.equal(forecast(early).accepted, false);
  assert.match(forecast(early).reason, /first 5 cycles/);
});

test('AI originating policy respects blockade leverage and new settlements apply the same rule between rivals', () => {
  const ordinary = fixture({ blockader: null });
  assert.ok(getDiplomaticIntent(ordinary.state, ordinary.recipient).some(a => a.stance === 'peace' && a.targetId === ordinary.proposer));
  occupy(ordinary);
  assert.equal(getDiplomaticIntent(ordinary.state, ordinary.recipient).some(a => a.stance === 'peace' && a.targetId === ordinary.proposer), false);
  const rivalWar = fixture({ proposer: 'choir', recipient: 'veyr' });
  assert.equal(forecast(rivalWar).mode, 'settlement');
  assert.equal(forecast(rivalWar).accepted, false);
  const before = structuredClone(rivalWar.state);
  assert.equal(command(rivalWar.state, { type: 'diplomacy', factionId: 'choir', targetId: 'veyr', stance: 'peace' }).ok, false);
  assert.deepEqual(rivalWar.state, before);
});

test('an already funded peace offer remains binding after an ordinary move establishes a decisive blockade', () => {
  const checkpoint = fixture({ blockader: null }), { state, proposer, recipient } = checkpoint;
  assert.equal(command(state, { type: 'diplomacy', factionId: recipient, targetId: proposer, stance: 'peace' }).ok, true);
  const offer = getActiveDiplomacyOffers(state, proposer).find(o => o.from === recipient);
  assert.ok(offer);
  const proposerCredits = faction(state, proposer).credits, proposerOrders = faction(state, proposer).orders;
  const escrowedCredits = faction(state, recipient).credits;
  const blocker = occupy(checkpoint);
  assert.equal(forecast(checkpoint).accepted, false, 'a newly proposed settlement now faces the blockade policy');
  assert.equal(getDiplomacyForecast(state, proposer, recipient).acceptPeace.enabled, true);
  assert.equal(command(state, { type: 'diplomacy', factionId: proposer, stance: 'acceptPeace', offerId: offer.id }).ok, true);
  assert.equal(state.diplomacyOffers.find(o => o.id === offer.id).status, 'accepted');
  assert.equal(faction(state, proposer).credits, proposerCredits + offer.credits);
  assert.equal(faction(state, recipient).credits, escrowedCredits);
  assert.equal(faction(state, proposer).orders, proposerOrders - 1);
  assert.equal(blocker.systemId, faction(state, recipient).capitalId);
  assert.equal(relation(state, proposer, recipient).status, 'peace');
  assert.equal(validateSave(state), true);
});

test('public forecasts are pure, reload-stable and invariant to unrelated hidden economies and armies', () => {
  const checkpoint = fixture(), { state, proposer, recipient, hiddenRemote } = checkpoint;
  const before = structuredClone(state), expected = forecast(checkpoint);
  assert.deepEqual(forecast(checkpoint), expected);
  assert.deepEqual(state, before);
  assert.deepEqual(getDiplomacyForecast(JSON.parse(JSON.stringify(state)), proposer, recipient).peace, expected);
  const hidden = structuredClone(state), opponent = faction(hidden, recipient);
  opponent.credits = 99999; opponent.minerals = 99999; opponent.science = 99999;
  opponent.techs = Object.keys(TECHS);
  const secretFleet = fleet(hidden, recipient, 'scout');
  Object.assign(secretFleet, { type: 'cruiser', ships: 12, hp: SHIPS.cruiser.hp * 12, systemId: hiddenRemote, movesLeft: 0 });
  const distantEnemy = fleet(hidden, proposer);
  Object.assign(distantEnemy, { ships: 12, hp: SHIPS.frigate.hp * 12 });
  assert.equal(validateSave(hidden), true);
  assert.deepEqual(getDiplomacyForecast(hidden, proposer, recipient).peace, expected);
  assert.doesNotMatch(expected.reason.replace(`${DIPLOMACY_RULES.truceTurns}-cycle truce`, 'truce'), /Vanguard|Sovereign|Solace|jump|fleet count|\d/);
});
