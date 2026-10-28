import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { executeDiplomacy, advanceDiplomacy, getDiplomacyForecast, getDiplomaticIntent, validateDiplomacyState } from '../src/diplomacy.js';

const faction = (state, id = 'player') => state.factions.find(candidate => candidate.id === id);
const relation = (state, from = 'player', to = 'veyr') => faction(state, from).relations[to];
const military = (state, owner) => state.fleets.find(fleet => fleet.owner === owner && fleet.type === 'frigate');
const contact = (state, a = 'player', b = 'veyr') => { for (const [first, second] of [[a, b], [b, a]]) if (!faction(state, first).contacts.includes(second)) faction(state, first).contacts.push(second); };
function warFixture(other = 'veyr', turn = 10) {
  const state = createGame('diplomatic-test');
  state.turn = turn;
  contact(state, 'player', other);
  for (const [first, second] of [['player', other], [other, 'player']]) Object.assign(relation(state, first, second), { status: 'war', treatyTurn: 1, trade: false, warStartColonies: 1 });
  return state;
}
function proposePeace(state, other = 'veyr') {
  const result = executeDiplomacy(state, { factionId: other, targetId: 'player', stance: 'peace' });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.outcome, 'peaceOffered');
  return result.offer;
}

test('AI peace creates a funded offer without ending war or moving the player', () => {
  const state = warFixture();
  military(state, 'player').systemId = 's1';
  const before = structuredClone(state.fleets);
  const credits = faction(state, 'veyr').credits;
  const playerCredits = faction(state).credits;
  const orders = faction(state, 'veyr').orders;
  const offer = proposePeace(state);
  assert.equal(relation(state).status, 'war');
  assert.equal(relation(state, 'veyr', 'player').status, 'war');
  assert.deepEqual(state.fleets, before);
  assert.equal(faction(state).credits, playerCredits);
  assert.equal(faction(state, 'veyr').credits, credits - 60);
  assert.equal(faction(state, 'veyr').orders, orders - 1);
  assert.equal(offer.expiresTurn, 13);
  assert.equal(offer.truceTurns, 5);
  assert.equal(validateDiplomacyState(state), true);
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').incomingOffer.id, offer.id);
  const duplicateBefore = structuredClone(state);
  assert.equal(executeDiplomacy(state, { factionId: 'veyr', targetId: 'player', stance: 'peace' }).ok, false);
  assert.deepEqual(state, duplicateBefore);
});

test('player acceptance transfers escrow, withdraws both fleets, and enforces five cycles of truce', () => {
  const state = warFixture();
  const playerFleet = military(state, 'player'), otherFleet = military(state, 'veyr');
  playerFleet.systemId = 's1'; otherFleet.systemId = 's0';
  const credits = faction(state).credits, orders = faction(state).orders;
  const offer = proposePeace(state);
  const accepted = executeDiplomacy(state, { stance: 'acceptPeace', offerId: offer.id });
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(offer.status, 'accepted');
  assert.equal(faction(state).credits, credits + 60);
  assert.equal(faction(state).orders, orders - 1);
  assert.equal(playerFleet.systemId, 's0');
  assert.equal(otherFleet.systemId, 's1');
  assert.equal(playerFleet.movesLeft, 0);
  assert.equal(otherFleet.movesLeft, 0);
  assert.equal(relation(state).status, 'peace');
  assert.equal(relation(state).truceUntil, 15);
  assert.equal(relation(state, 'veyr', 'player').truceUntil, 15);
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').war.enabled, false);
  const before = structuredClone(state);
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'war' }).ok, false);
  assert.deepEqual(state, before);
  assert.equal(executeDiplomacy(state, { stance: 'acceptPeace', offerId: offer.id }).ok, false);
  state.turn = 14;
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'war' }).ok, false);
  state.turn = 15;
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'war' }).ok, true);
});

test('declining a peace offer refunds its proposer exactly once and preserves the war', () => {
  const state = warFixture();
  military(state, 'player').systemId = 's1';
  const beforeFleets = structuredClone(state.fleets), credits = faction(state, 'veyr').credits;
  const offer = proposePeace(state);
  assert.equal(executeDiplomacy(state, { stance: 'declinePeace', targetId: 'veyr' }).ok, true);
  assert.equal(offer.status, 'declined');
  assert.equal(faction(state, 'veyr').credits, credits);
  assert.equal(relation(state).status, 'war');
  assert.deepEqual(state.fleets, beforeFleets);
  assert.equal(executeDiplomacy(state, { stance: 'declinePeace', offerId: offer.id }).ok, false);
  state.turn += 4;
  advanceDiplomacy(state);
  assert.equal(faction(state, 'veyr').credits, credits);
  assert.equal(validateDiplomacyState(state), true);
});

test('expired offers refund escrow without acceptance or withdrawal, and advancing is idempotent', () => {
  const state = warFixture();
  military(state, 'player').systemId = 's1';
  const beforeFleets = structuredClone(state.fleets), credits = faction(state, 'veyr').credits;
  const offer = proposePeace(state);
  state.turn = offer.expiresTurn;
  assert.equal(executeDiplomacy(state, { stance: 'acceptPeace', offerId: offer.id }).ok, false);
  assert.equal(advanceDiplomacy(state).offersExpired, 1);
  assert.equal(offer.status, 'expired');
  assert.equal(faction(state, 'veyr').credits, credits);
  assert.equal(relation(state).status, 'war');
  assert.deepEqual(state.fleets, beforeFleets);
  const after = structuredClone(state);
  assert.deepEqual(advanceDiplomacy(state), { offersExpired: 0, treatiesEnded: 0 });
  assert.deepEqual(state, after);
});

test('players cannot answer another recipient’s offer or bypass order costs', () => {
  const state = warFixture();
  const offer = proposePeace(state);
  const before = structuredClone(state);
  assert.equal(executeDiplomacy(state, { factionId: 'khar', stance: 'acceptPeace', offerId: offer.id }).ok, false);
  assert.equal(executeDiplomacy(state, { targetId: 'khar', stance: 'acceptPeace', offerId: offer.id }).ok, false);
  assert.deepEqual(state, before);
  faction(state).orders = 0;
  const exhausted = structuredClone(state);
  assert.equal(executeDiplomacy(state, { stance: 'acceptPeace', offerId: offer.id }).ok, false);
  assert.deepEqual(state, exhausted);
});

test('player peace forecasts explain refusal and use war age or actual colony losses for acceptance', () => {
  const state = warFixture('veyr', 6);
  const refused = getDiplomacyForecast(state, 'player', 'veyr');
  assert.equal(refused.peace.accepted, false);
  assert.match(refused.peace.reason, /refuse/i);
  assert.equal(refused.peace.cost.credits, 60);
  const before = structuredClone(state);
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'peace' }).ok, false);
  assert.deepEqual(state, before);
  relation(state, 'veyr', 'player').warStartColonies = 2;
  const losses = getDiplomacyForecast(state, 'player', 'veyr');
  assert.equal(losses.peace.accepted, true);
  assert.equal(losses.peace.willingness.lostColonies, 1);
  assert.match(losses.peace.willingness.reason, /lost 1 colony/);
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'peace' }).ok, true);
  assert.equal(relation(state).truceUntil, 11);
  const prolonged = warFixture('veyr', 13);
  assert.equal(getDiplomacyForecast(prolonged, 'player', 'veyr').peace.accepted, true);
});

test('observed invading fleets increase willingness, but remote hidden fleets do not influence it', () => {
  const state = warFixture('veyr', 6);
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').peace.accepted, false);
  const fleet = military(state, 'player');
  fleet.systemId = 's20';
  fleet.ships = 12; fleet.hp = 408;
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').peace.accepted, false);
  fleet.systemId = 's1';
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').peace.accepted, true);
});

test('trade cancellation provides three cycles of income and access before deterministic withdrawal', () => {
  const state = createGame('trade-notice');
  contact(state);
  const startCredits = faction(state).credits;
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'trade' }).ok, true);
  assert.equal(faction(state).credits, startCredits - 30);
  military(state, 'player').systemId = 's1';
  const result = executeDiplomacy(state, { targetId: 'veyr', stance: 'endTrade' });
  assert.equal(result.outcome, 'tradeNotice');
  assert.equal(relation(state).tradeEndsAt, 4);
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').tradeEndingIn, 3);
  assert.equal(relation(state).trade, true);
  assert.equal(military(state, 'player').systemId, 's1');
  for (state.turn = 2; state.turn < 4; state.turn++) { advanceDiplomacy(state); assert.equal(relation(state).trade, true); }
  assert.equal(advanceDiplomacy(state).treatiesEnded, 1);
  assert.equal(relation(state).trade, false);
  assert.equal(relation(state, 'veyr', 'player').trade, false);
  assert.equal(relation(state).tradeEndsAt, 0);
  assert.equal(military(state, 'player').systemId, 's0');
  assert.equal(military(state, 'player').movesLeft, 0);
  assert.equal(validateDiplomacyState(state), true);
});

test('direct war may break trade, with a visible betrayal penalty', () => {
  const state = createGame('broken-treaty');
  contact(state);
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'trade' }).ok, true);
  const startingTrust = relation(state).trust;
  const forecast = getDiplomacyForecast(state, 'player', 'veyr');
  assert.equal(forecast.war.enabled, true);
  assert.match(forecast.war.effect, /65/);
  assert.match(forecast.war.effect, /35 grievance/);
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'war' }).ok, true);
  assert.equal(relation(state).trade, false);
  assert.equal(relation(state).trust, startingTrust - 65);
  assert.equal(relation(state, 'veyr', 'player').grievance, 35);
  assert.equal(relation(state).warStartColonies, 1);
});

test('a gift and trade do not permanently pacify a strong Khar rival on a disputed frontier', () => {
  const state = createGame('frontier-rivalry');
  contact(state, 'player', 'khar');
  state.lanes = [['s0', 's2']];
  state.systems.find(system => system.id === 's0').knownBy.push('khar');
  state.systems.find(system => system.id === 's2').knownBy.push('player');
  military(state, 'khar').ships = 5; military(state, 'khar').hp = 170;
  assert.equal(executeDiplomacy(state, { targetId: 'khar', stance: 'gift' }).ok, true);
  assert.equal(executeDiplomacy(state, { targetId: 'khar', stance: 'trade' }).ok, true);
  for (state.turn = 2; state.turn <= 25; state.turn++) advanceDiplomacy(state);
  state.turn = 25;
  const intent = getDiplomaticIntent(state, 'khar').find(action => action.targetId === 'player');
  assert.equal(intent?.stance, 'endTrade');
  assert.equal(executeDiplomacy(state, intent).ok, true);
  assert.equal(relation(state, 'khar', 'player').tradeEndsAt, 28);
  for (state.turn = 26; state.turn <= 28; state.turn++) advanceDiplomacy(state);
  state.turn = 28;
  const war = getDiplomaticIntent(state, 'khar').find(action => action.targetId === 'player');
  assert.equal(war?.stance, 'war');
  assert.equal(executeDiplomacy(state, war).ok, true);
  assert.equal(relation(state, 'khar', 'player').status, 'war');
  assert.ok(state.log.some(entry => entry.text.includes('gave notice')));
  assert.equal(validateDiplomacyState(state), true);
});

test('elapsed time alone creates no war policy and hidden armies do not affect AI diplomacy', () => {
  const state = createGame('quiet-relations');
  contact(state, 'player', 'khar');
  state.lanes = [];
  military(state, 'khar').ships = 10; military(state, 'khar').hp = 340;
  for (state.turn = 2; state.turn <= 60; state.turn++) advanceDiplomacy(state);
  state.turn = 60;
  assert.equal(getDiplomaticIntent(state, 'khar').some(action => action.stance === 'war'), false);
  relation(state, 'khar', 'player').grievance = 60;
  state.lanes = [['s0', 's2']];
  state.systems.find(system => system.id === 's0').knownBy.push('khar');
  const before = getDiplomaticIntent(state, 'khar');
  military(state, 'player').systemId = 's35';
  military(state, 'player').ships = 100;
  military(state, 'player').hp = 3400;
  assert.deepEqual(getDiplomaticIntent(state, 'khar'), before);
  const forecast = getDiplomacyForecast(state, 'khar', 'player');
  military(state, 'player').systemId = 's36';
  assert.deepEqual(getDiplomacyForecast(state, 'khar', 'player'), forecast);
});

test('new public border claims create grievance while a quiet peaceful frontier recovers', () => {
  const state = createGame('border-claims');
  contact(state);
  state.lanes = [['s1', 's4']];
  state.systems.find(system => system.id === 's4').knownBy.push('veyr');
  advanceDiplomacy(state);
  const claim = state.systems.find(system => system.id === 's4');
  claim.owner = 'player'; claim.population = 1;
  state.turn++;
  advanceDiplomacy(state);
  assert.equal(relation(state, 'veyr', 'player').grievance, 8);
  state.turn++;
  advanceDiplomacy(state);
  assert.equal(relation(state, 'veyr', 'player').grievance, 7);
});

test('peace withdrawal has a deterministic charted neutral fallback for an empire without colonies', () => {
  const state = warFixture();
  const neutral = state.systems.find(system => system.id === 's4');
  neutral.knownBy = ['player'];
  state.systems.find(system => system.id === 's0').owner = 'veyr';
  for (const system of state.systems) if (!system.owner && system !== neutral) system.knownBy = system.knownBy.filter(id => id !== 'player');
  military(state, 'player').systemId = 's1';
  const offer = proposePeace(state);
  assert.equal(executeDiplomacy(state, { stance: 'acceptPeace', offerId: offer.id }).ok, true);
  assert.equal(military(state, 'player').systemId, neutral.id);
});

test('optional diplomacy save state is backward compatible and rejects malformed new fields', () => {
  const legacy = createGame('legacy-diplomacy');
  assert.equal(validateDiplomacyState(legacy), true);
  for (const value of [null, {}, { factions: [null], turn: 1 }]) assert.equal(validateDiplomacyState(value), false);
  const state = warFixture();
  proposePeace(state);
  assert.equal(validateDiplomacyState(state), true);
  const invalid = [
    copy => { copy.diplomacyOffers = null; },
    copy => { copy.diplomacyOffers.push(structuredClone(copy.diplomacyOffers[0])); },
    copy => { copy.diplomacyOffers[0].credits = -60; },
    copy => { copy.diplomacyOffers[0].truceTurns = 99; },
    copy => { copy.diplomacyOffers[0].expiresTurn = 1; },
    copy => { copy.diplomacyOffers[0].from = 'unknown'; },
    copy => { copy.diplomacyOffers[0].status = 'paid'; },
    copy => { copy.nextDiplomacyOfferId = 1; },
    copy => { copy.diplomacyUpdatedTurn = copy.turn + 1; },
    copy => { relation(copy).grievance = 101; },
    copy => { relation(copy).truceUntil = 20; },
    copy => { relation(copy).tradeEndsAt = -1; },
    copy => { relation(copy).warStartColonies = 100; },
    copy => { relation(copy).lastBorderCount = 1.5; },
    copy => { relation(copy).peaceOfferTurn = copy.turn + 1; },
  ];
  for (const corrupt of invalid) { const copy = structuredClone(state); corrupt(copy); assert.equal(validateDiplomacyState(copy), false, corrupt.toString()); }
});
