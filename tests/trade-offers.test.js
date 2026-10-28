import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command, endTurn, getEmpireStats, validateSave } from '../src/game.js';
import { executeDiplomacy, advanceDiplomacy, reconcileDiplomacyOffers, getActiveDiplomacyOffers, getDiplomacyForecast, getDiplomaticIntent } from '../src/diplomacy.js';

const faction = (state, id = 'player') => state.factions.find(f => f.id === id);
const relation = (state, from = 'player', to = 'choir') => faction(state, from).relations[to];
const act = (state, action) => { const result = command(state, action); assert.ok(result.ok, result.message); return result; };
function contact(state, a = 'player', b = 'choir') {
  for (const [first, second] of [[a, b], [b, a]]) if (!faction(state, first).contacts.includes(second)) faction(state, first).contacts.push(second);
}
function fixture() {
  const state = createGame('trade-consent'); contact(state);
  faction(state, 'choir').credits = 500;
  return state;
}
function offerTrade(state, from = 'choir') {
  return act(state, { type: 'diplomacy', factionId: from, targetId: 'player', stance: 'trade' }).offer;
}
const response = (offer, stance = 'acceptTrade') => ({ type: 'diplomacy', targetId: offer.from, stance, offerId: offer.id });
const tradeIntent = state => getDiplomaticIntent(state, 'choir').some(action => action.targetId === 'player' && action.stance === 'trade');

test('AI trade reserves its normal fee/order without treaty income, trust, access or public announcements', () => {
  const state = fixture(), proposer = faction(state, 'choir'), player = faction(state);
  state.lanes.push(['s0', 's3']); state.systems[3].knownBy.push('player');
  const fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  const original = structuredClone(state), income = getEmpireStats(state).creditIncome;
  const offer = offerTrade(state);
  assert.equal(offer.kind, 'trade'); assert.equal(offer.expiresTurn, state.turn + 3); assert.equal(offer.credits, 30);
  assert.equal(proposer.credits, faction(original, 'choir').credits - 30); assert.equal(proposer.orders, faction(original, 'choir').orders - 1);
  assert.equal(player.credits, faction(original).credits); assert.equal(player.orders, faction(original).orders);
  assert.deepEqual(relation(state), relation(original)); assert.deepEqual(relation(state, 'choir', 'player'), relation(original, 'choir', 'player'));
  assert.equal(getEmpireStats(state).creditIncome, income); assert.deepEqual(state.publicAffairs, original.publicAffairs);
  assert.deepEqual(state.fleets, original.fleets); assert.equal(state.rng, original.rng);
  const beforeMove = structuredClone(state);
  assert.equal(command(state, { type: 'move', fleetId: fleet.id, targetId: 's3' }).ok, false); assert.deepEqual(state, beforeMove);
  const forecast = getDiplomacyForecast(state, 'player', 'choir');
  assert.equal(forecast.incomingOffer, null); assert.equal(forecast.incomingTradeOffer.id, offer.id);
  assert.deepEqual(forecast.acceptTrade.cost, { credits: 0, orders: 1 }); assert.equal(forecast.acceptTrade.enabled, true);
  assert.ok(validateSave(state));
});

test('acceptance consumes the escrow without paying or charging the recipient and opens bilateral trade once', () => {
  const state = fixture(), offer = offerTrade(state), proposer = faction(state, 'choir'), player = faction(state);
  player.credits = 0;
  const credits = proposer.credits, orders = player.orders, proposerOrders = proposer.orders, income = getEmpireStats(state).creditIncome;
  const ourTrust = relation(state).trust, theirTrust = relation(state, 'choir', 'player').trust;
  const result = act(state, response(offer));
  assert.equal(result.outcome, 'tradeAccepted'); assert.equal(offer.status, 'accepted');
  assert.equal(player.credits, 0); assert.equal(proposer.credits, credits); assert.equal(player.orders, orders - 1); assert.equal(proposer.orders, proposerOrders);
  assert.equal(relation(state).trade, true); assert.equal(relation(state, 'choir', 'player').trade, true);
  assert.equal(relation(state).trust, ourTrust + 10); assert.equal(relation(state, 'choir', 'player').trust, theirTrust + 10);
  assert.equal(getEmpireStats(state).creditIncome, income + 6);
  assert.deepEqual(getActiveDiplomacyOffers(state), []);
  const after = structuredClone(state); assert.equal(command(state, response(offer)).ok, false); assert.deepEqual(state, after);
  assert.ok(validateSave(state));
});

test('a binding trade offer remains acceptable when trust later falls', () => {
  const state = fixture(), offer = offerTrade(state);
  relation(state).trust = -50; relation(state, 'choir', 'player').trust = -40;
  assert.equal(getDiplomacyForecast(state, 'player', 'choir').acceptTrade.enabled, true);
  act(state, response(offer)); assert.equal(relation(state).trade, true);
  assert.equal(relation(state).trust, -40); assert.equal(relation(state, 'choir', 'player').trust, -30);
});

test('decline refunds exactly once and keeps borders closed for five quiet cycles of AI initiation', () => {
  const state = fixture(), initialCredits = faction(state, 'choir').credits, offer = offerTrade(state);
  const before = structuredClone(state.fleets), trust = relation(state).trust;
  act(state, response(offer, 'declineTrade'));
  assert.equal(faction(state, 'choir').credits, initialCredits); assert.equal(relation(state).trade, false);
  assert.equal(relation(state).trust, trust); assert.deepEqual(state.fleets, before);
  assert.equal(relation(state, 'choir', 'player').tradeOfferAfter, 6);
  for (state.turn = 1; state.turn < 6; state.turn++) assert.equal(tradeIntent(state), false);
  assert.equal(tradeIntent(state), true);
  const declined = structuredClone(state); assert.equal(command(state, response(offer, 'declineTrade')).ok, false); assert.deepEqual(state, declined);
});

test('trade cooldown never prevents manual player initiation at the original price', () => {
  const state = fixture(), offer = offerTrade(state); act(state, response(offer, 'declineTrade'));
  const credits = faction(state).credits, orders = faction(state).orders, choirCredits = faction(state, 'choir').credits;
  assert.equal(getDiplomacyForecast(state, 'player', 'choir').trade.enabled, true);
  act(state, { type: 'diplomacy', targetId: 'choir', stance: 'trade' });
  assert.equal(relation(state).trade, true); assert.equal(faction(state).credits, credits - 30); assert.equal(faction(state).orders, orders - 1);
  assert.equal(faction(state, 'choir').credits, choirCredits); assert.equal(state.diplomacyOffers.length, 1);
});

test('expiry refunds once and derives its quiet deadline from expiry, including late imported records', () => {
  const state = fixture(), credits = faction(state, 'choir').credits, offer = offerTrade(state);
  state.turn = offer.expiresTurn;
  const untouched = structuredClone(state);
  assert.deepEqual(getActiveDiplomacyOffers(state), []); assert.equal(tradeIntent(state), false); assert.deepEqual(state, untouched);
  assert.equal(advanceDiplomacy(state).offersExpired, 1);
  assert.equal(faction(state, 'choir').credits, credits); assert.equal(offer.status, 'expired'); assert.equal(relation(state).trade, false);
  assert.equal(relation(state, 'choir', 'player').tradeOfferAfter, offer.expiresTurn + 5);
  const settled = structuredClone(state); assert.equal(reconcileDiplomacyOffers(state), 0); advanceDiplomacy(state); assert.deepEqual(state, settled);
  const late = fixture(), lateOffer = offerTrade(late); late.turn = lateOffer.expiresTurn + 2;
  reconcileDiplomacyOffers(late); assert.equal(relation(late, 'choir', 'player').tradeOfferAfter, lateOffer.expiresTurn + 5);
  assert.ok(validateSave(late));
});

test('stale imported pending escrow cannot trigger a new AI proposal before end-turn expiry reconciliation', () => {
  const state = fixture(), offer = offerTrade(state); state.turn = offer.expiresTurn;
  assert.ok(validateSave(state)); const before = structuredClone(state);
  assert.equal(getDiplomacyForecast(state, 'choir', 'player').trade.enabled, false);
  assert.deepEqual(getActiveDiplomacyOffers(state), []); assert.deepEqual(state, before);
  assert.ok(endTurn(state).ok);
  assert.equal(state.diplomacyOffers.filter(o => (o.kind || 'peace') === 'trade' && o.from === 'choir').length, 1);
  assert.equal(offer.status, 'expired'); assert.equal(relation(state).trade, false);
  assert.equal(relation(state, 'choir', 'player').tradeOfferAfter, offer.expiresTurn + 5);
  assert.ok(validateSave(state));
});

test('completed cancellation suppresses AI renewal and the eventual new proposal cannot reopen borders itself', () => {
  const state = fixture(); act(state, { type: 'diplomacy', targetId: 'choir', stance: 'trade' });
  act(state, { type: 'diplomacy', targetId: 'choir', stance: 'endTrade' });
  for (state.turn = 2; state.turn <= 4; state.turn++) advanceDiplomacy(state);
  assert.equal(relation(state).trade, false); assert.equal(relation(state, 'choir', 'player').tradeOfferAfter, 9);
  for (state.turn = 4; state.turn < 9; state.turn++) assert.equal(tradeIntent(state), false);
  assert.equal(tradeIntent(state), true);
  const offer = offerTrade(state); assert.equal(relation(state).trade, false);
  act(state, response(offer, 'declineTrade')); assert.equal(relation(state).trade, false);
  assert.ok(validateSave(state));
});

test('duplicate, wrong-kind, wrong-recipient, stale and zero-order responses are entirely atomic', () => {
  const state = fixture(), offer = offerTrade(state); contact(state, 'player', 'veyr');
  for (const action of [
    { type: 'diplomacy', factionId: 'choir', targetId: 'player', stance: 'trade' },
    { type: 'diplomacy', targetId: 'choir', stance: 'trade' },
    response(offer, 'acceptPeace'), response(offer, 'declinePeace'),
    { ...response(offer), factionId: 'veyr' }, { ...response(offer), targetId: 'veyr' },
    { ...response(offer), offerId: 'trade-999' },
  ]) { const before = structuredClone(state); assert.equal(command(state, action).ok, false); assert.deepEqual(state, before); }
  faction(state).orders = 0;
  for (const stance of ['acceptTrade', 'declineTrade']) { const before = structuredClone(state); assert.equal(command(state, response(offer, stance)).ok, false); assert.deepEqual(state, before); }
  faction(state).orders = 1; state.turn = offer.expiresTurn;
  const stale = structuredClone(state); assert.equal(command(state, response(offer)).ok, false); assert.deepEqual(state, stale);
});

test('war invalidates and refunds a pending trade immediately without an invalid intermediate save', () => {
  const state = fixture(), credits = faction(state, 'choir').credits, offer = offerTrade(state);
  act(state, { type: 'diplomacy', targetId: 'choir', stance: 'war' });
  assert.equal(offer.status, 'expired'); assert.equal(faction(state, 'choir').credits, credits);
  assert.equal(relation(state).status, 'war'); assert.equal(relation(state).trade, false); assert.ok(validateSave(state));
  const after = structuredClone(state); assert.equal(command(state, response(offer)).ok, false); assert.deepEqual(state, after);
});

test('successful game mutations reconcile proposals when a participant collapses', () => {
  const state = fixture(), credits = faction(state, 'choir').credits, offer = offerTrade(state);
  for (const system of state.systems.filter(s => s.owner === 'choir')) { system.owner = null; system.population = 0; }
  state.fleets = state.fleets.filter(f => f.owner !== 'choir');
  act(state, { type: 'research', techId: 'logistics' });
  assert.equal(faction(state, 'choir').eliminated, true); assert.equal(offer.status, 'expired'); assert.equal(faction(state, 'choir').credits, credits);
  assert.ok(validateSave(state));
});

test('participant offer views normalize legacy kindless peace, filter stale data and cannot mutate escrow records', () => {
  const state = fixture(), trade = offerTrade(state); contact(state, 'veyr', 'khar');
  state.turn = 10;
  for (const [a, b] of [['veyr', 'khar'], ['khar', 'veyr']]) Object.assign(relation(state, a, b), { status: 'war', treatyTurn: 1 });
  // A valid older-style pending peace record between other empires is private.
  state.diplomacyOffers.push({ id: `peace-${state.nextDiplomacyOfferId++}`, from: 'veyr', to: 'khar', createdTurn: 9, expiresTurn: 12, credits: 60, status: 'pending', truceTurns: 5 });
  const before = structuredClone(state); assert.deepEqual(getActiveDiplomacyOffers(state), []);
  const foreignView = getActiveDiplomacyOffers(state, 'veyr'); assert.equal(foreignView[0].kind, 'peace'); foreignView[0].credits = 999;
  assert.deepEqual(state, before); assert.equal(trade.status, 'pending');
});

test('legacy peace consent and direct AI-to-AI trade retain their original costs and behavior', () => {
  const state = fixture(); state.turn = 15; contact(state, 'veyr', 'choir');
  for (const [a, b] of [['player', 'choir'], ['choir', 'player']]) Object.assign(relation(state, a, b), { status: 'war', treatyTurn: 1 });
  const peace = act(state, { type: 'diplomacy', factionId: 'choir', targetId: 'player', stance: 'peace' }).offer;
  assert.equal(peace.kind, undefined); assert.equal(getDiplomacyForecast(state, 'player', 'choir').incomingOffer.id, peace.id);
  const wrongKind = structuredClone(state); assert.equal(command(state, response(peace)).ok, false); assert.deepEqual(state, wrongKind);
  const credits = faction(state).credits; act(state, response(peace, 'acceptPeace')); assert.equal(faction(state).credits, credits + 60);
  const senderCredits = faction(state, 'veyr').credits, recipientCredits = faction(state, 'choir').credits;
  act(state, { type: 'diplomacy', factionId: 'veyr', targetId: 'choir', stance: 'trade' });
  assert.equal(relation(state, 'veyr', 'choir').trade, true); assert.equal(faction(state, 'veyr').credits, senderCredits - 30); assert.equal(faction(state, 'choir').credits, recipientCredits);
  assert.ok(validateSave(state));
});

test('new offer kinds and quiet deadlines are narrowly validated without requiring migration of legacy saves', () => {
  const legacy = createGame('legacy-trade'); assert.ok(validateSave(legacy));
  const state = fixture(); offerTrade(state); assert.ok(validateSave(state));
  for (const mutate of [
    s => { s.diplomacyOffers[0].kind = 'gift'; }, s => { s.diplomacyOffers[0].kind = null; },
    s => { s.diplomacyOffers[0].credits = 60; }, s => { s.diplomacyOffers[0].truceTurns = 5; },
    s => { s.diplomacyOffers[0].id = 'peace-1'; }, s => { s.diplomacyOffers[0].to = 'veyr'; },
    s => { s.diplomacyOffers.push({ ...s.diplomacyOffers[0], id: `trade-${s.nextDiplomacyOfferId++}` }); },
    s => { relation(s, 'choir', 'player').tradeOfferAfter = -1; },
    s => { relation(s, 'choir', 'player').tradeOfferAfter = s.turn + 6; },
    s => { relation(s).tradeOfferAfter = 3; }, s => { relation(s, 'choir', 'veyr').tradeOfferAfter = 3; },
  ]) { const copy = structuredClone(state); mutate(copy); assert.equal(validateSave(copy), false); }
  const reloaded = JSON.parse(JSON.stringify(state)); assert.deepEqual(reloaded, state); assert.ok(validateSave(reloaded));
});

test('peace denial after the minimum period describes unwillingness without claiming negotiations remain barred', () => {
  const state = fixture(); contact(state, 'player', 'khar'); state.turn = 29;
  for (const [a, b] of [['player', 'khar'], ['khar', 'player']]) Object.assign(relation(state, a, b), { status: 'war', treatyTurn: 19, warStartColonies: 1 });
  const forecast = getDiplomacyForecast(state, 'player', 'khar');
  assert.equal(forecast.peace.willingness.warAge, 10); assert.equal(forecast.peace.enabled, false);
  assert.doesNotMatch(forecast.peace.reason, /not lasted long enough|first 5 cycles/);
  assert.match(forecast.peace.reason, /refuse these terms/);
  faction(state).orders = 0; assert.equal(getDiplomacyForecast(state, 'player', 'khar').peace.reason, 'No orders remaining.');
});
