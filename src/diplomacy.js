import { FACTIONS } from './content.js';
import { getVisibleFleets } from './intelligence.js';
import { recordPublicDiplomacy } from './public-affairs.js';

export const DIPLOMACY_RULES = Object.freeze({ peaceCost: 60, tradeCost: 30, giftCost: 35, minimumWarTurns: 5, truceTurns: 5, offerTurns: 3, tradeNoticeTurns: 3, tradeOfferQuietTurns: 5 });
const STANCES = ['war', 'peace', 'trade', 'gift', 'endTrade', 'acceptPeace', 'declinePeace', 'acceptTrade', 'declineTrade'];
const offerKind = offer => offer.kind || 'peace';
const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const coloniesOf = (state, id) => state.systems.filter(system => system.owner === id);
const clamp = value => Math.max(0, Math.min(100, value));
const trust = value => Math.max(-100, Math.min(100, value));
const failure = message => ({ ok: false, message });
const nameOf = (state, id) => factionOf(state, id)?.name || FACTIONS[id]?.name || id;
const neighbors = (state, id) => state.lanes.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []);
// This is a diplomatic pressure measure, not a combat prediction. It uses
// known ship roles only; no hidden enemy fleet or economy is inspected.
const weight = fleet => fleet.type === 'cruiser' ? fleet.ships * 3 : fleet.type === 'frigate' ? fleet.ships : 0;

function record(state, first, second, message, type = 'diplomacy') {
  if (first !== 'player' && second !== 'player') return;
  state.log.unshift({ id: state.nextLogId++, turn: state.turn, type, text: message, targetId: first === 'player' ? second : first });
  state.log.length = Math.min(state.log.length, 160);
}

function pressureFor(state, observerId, otherId) {
  const colonies = coloniesOf(state, observerId);
  const owned = new Set(colonies.map(system => system.id));
  const frontier = new Set(colonies.flatMap(system => neighbors(state, system.id)));
  const visible = getVisibleFleets(state, observerId).filter(fleet => fleet.owner === otherId && weight(fleet) > 0);
  const relevant = visible.filter(fleet => owned.has(fleet.systemId) || frontier.has(fleet.systemId));
  const threatened = colonies.filter(system => relevant.some(fleet => fleet.systemId === system.id || neighbors(state, system.id).includes(fleet.systemId)));
  const borderCount = state.systems.filter(system => system.owner === otherId && frontier.has(system.id) && system.knownBy.includes(observerId)).length;
  return { borderCount, threatenedColonies: threatened.length, invadingWeight: visible.filter(fleet => owned.has(fleet.systemId)).reduce((sum, fleet) => sum + weight(fleet), 0), observedWeight: relevant.reduce((sum, fleet) => sum + weight(fleet), 0) };
}

function willingness(state, recipientId, proposerId) {
  const recipient = factionOf(state, recipientId);
  const relation = recipient.relations[proposerId];
  const warAge = Math.max(0, state.turn - relation.treatyTurn);
  const lostColonies = Math.max(0, (relation.warStartColonies ?? coloniesOf(state, recipientId).length) - coloniesOf(state, recipientId).length);
  const pressure = pressureFor(state, recipientId, proposerId);
  const score = Math.min(60, warAge * 3) + lostColonies * 24 + Math.min(24, pressure.threatenedColonies * 12) + (pressure.invadingWeight > 0 ? 12 : 0);
  const threshold = recipientId === 'khar' ? 48 : 36;
  const accepted = warAge >= DIPLOMACY_RULES.minimumWarTurns && score >= threshold;
  const reasons = [];
  if (lostColonies) reasons.push(`${nameOf(state, recipientId)} has lost ${lostColonies} colon${lostColonies === 1 ? 'y' : 'ies'} since the war began.`);
  if (pressure.threatenedColonies) reasons.push('Their colonies face military pressure they can observe.');
  if (warAge >= 12) reasons.push('The prolonged war increases their willingness to settle.');
  if (recipientId === 'khar') reasons.push('The Khar Dominion is reluctant to concede a war.');
  const reason = warAge < DIPLOMACY_RULES.minimumWarTurns ? `Peace negotiations open after ${DIPLOMACY_RULES.minimumWarTurns} cycles of war.` : accepted ? (reasons[0] || 'They are willing to end the war.') : 'They refuse these terms for now: war weariness and their observed losses or military pressure are insufficient.';
  return { accepted, reason, reasons, warAge, lostColonies };
}

function compatibleOffer(state, offer) {
  const proposer = factionOf(state, offer.from), recipient = factionOf(state, offer.to);
  if (!proposer || !recipient || proposer.eliminated || recipient.eliminated) return false;
  const relation = proposer.relations[offer.to];
  return offerKind(offer) === 'trade' ? relation.status === 'peace' && !relation.trade : relation.status === 'war';
}

/** Participant-only, current proposals. Legacy kindless entries remain peace. */
export function getActiveDiplomacyOffers(state, factionId = 'player') {
  if (state.winner || !factionOf(state, factionId) || factionOf(state, factionId).eliminated) return [];
  return (state.diplomacyOffers || []).filter(offer => (offer.from === factionId || offer.to === factionId)
    && offer.status === 'pending' && state.turn < offer.expiresTurn && compatibleOffer(state, offer))
    .map(offer => ({ ...offer, kind: offerKind(offer) }));
}

function tradeOfferDeadline(state, factionId, targetId) {
  const saved = factionOf(state, factionId).relations[targetId].tradeOfferAfter || 0;
  // A stale imported pending record is already expired even before its refund
  // is reconciled. Reading it must not permit an immediate replacement offer.
  const expired = (state.diplomacyOffers || []).filter(offer => offerKind(offer) === 'trade' && offer.from === factionId && offer.to === targetId && offer.status === 'pending' && state.turn >= offer.expiresTurn);
  return Math.max(saved, ...expired.map(offer => offer.expiresTurn + DIPLOMACY_RULES.tradeOfferQuietTurns));
}

function option(enabled, reason, effect, credits = 0) {
  return { enabled, reason: enabled ? '' : reason, effect, cost: { credits, orders: 1 } };
}

/** Pure UI forecast. Every action includes its real cost and denial reason. */
export function getDiplomacyForecast(state, factionId = 'player', targetId) {
  const faction = factionOf(state, factionId), target = factionOf(state, targetId);
  const relation = faction?.relations?.[targetId];
  const commonReason = state.winner ? 'This campaign has ended.' : !faction || faction.eliminated ? 'This empire is no longer active.' : !target || targetId === factionId || target.eliminated || !relation ? 'Select an active foreign empire.' : !faction.contacts.includes(targetId) ? 'Establish first contact before opening negotiations.' : faction.orders < 1 ? 'No orders remaining.' : '';
  if (!relation || !target || !faction) {
    const actions = Object.fromEntries(STANCES.map(stance => [stance, option(false, commonReason, '')]));
    return { factionId, targetId, status: null, actions, ...actions, pendingOffers: [], incomingOffer: null, outgoingOffer: null, incomingTradeOffer: null, outgoingTradeOffer: null };
  }
  const pendingOffers = getActiveDiplomacyOffers(state, factionId).filter(offer => offer.from === targetId || offer.to === targetId);
  const incomingOffer = pendingOffers.find(offer => offer.kind === 'peace' && offer.to === factionId) || null;
  const outgoingOffer = pendingOffers.find(offer => offer.kind === 'peace' && offer.from === factionId) || null;
  const incomingTradeOffer = pendingOffers.find(offer => offer.kind === 'trade' && offer.to === factionId) || null;
  const outgoingTradeOffer = pendingOffers.find(offer => offer.kind === 'trade' && offer.from === factionId) || null;
  const truceUntil = Math.max(relation.truceUntil || 0, target.relations[factionId]?.truceUntil || 0);
  const truceRemaining = Math.max(0, truceUntil - state.turn);
  const tradeEndsAt = relation.trade ? relation.tradeEndsAt || 0 : 0;
  const tradeEndingIn = tradeEndsAt ? Math.max(0, tradeEndsAt - state.turn) : null;
  const warAge = Math.max(0, state.turn - relation.treatyTurn);
  const peaceMode = targetId === 'player' && factionId !== 'player' ? 'offer' : 'settlement';
  const tradeMode = peaceMode;
  const tradeOfferAfter = tradeMode === 'offer' ? tradeOfferDeadline(state, factionId, targetId) : 0;
  const peaceWillingness = relation.status === 'war' && peaceMode === 'settlement' ? willingness(state, targetId, factionId) : null;
  const warReason = commonReason || (relation.status === 'war' ? 'Already at war.' : truceRemaining ? `The peace settlement forbids war until turn ${truceUntil} (${truceRemaining} cycles remaining).` : '');
  const peaceReason = commonReason || (relation.status !== 'war' ? 'Already at peace.' : warAge < DIPLOMACY_RULES.minimumWarTurns ? `They will not discuss peace during the first ${DIPLOMACY_RULES.minimumWarTurns} cycles of war.` : outgoingOffer ? `A peace offer is pending until turn ${outgoingOffer.expiresTurn}.` : faction.credits < DIPLOMACY_RULES.peaceCost ? `A peace settlement costs ${DIPLOMACY_RULES.peaceCost} credits.` : peaceWillingness && !peaceWillingness.accepted ? peaceWillingness.reason : '');
  const tradeReason = commonReason || (relation.status === 'war' ? 'End the war before negotiating trade.' : relation.trade ? tradeEndsAt ? `Trade is ending on turn ${tradeEndsAt}.` : 'A trade treaty is already active.' : incomingTradeOffer || outgoingTradeOffer ? 'A trade offer is awaiting a decision.' : tradeOfferAfter > state.turn ? `A new trade proposal may be sent on cycle ${tradeOfferAfter}.` : relation.trust < 0 ? 'Trust must be at least zero. A diplomatic gift can improve it.' : faction.credits < DIPLOMACY_RULES.tradeCost ? `A trade treaty costs ${DIPLOMACY_RULES.tradeCost} credits.` : '');
  const giftReason = commonReason || (relation.status === 'war' ? 'Diplomatic gifts cannot be sent during war.' : faction.credits < DIPLOMACY_RULES.giftCost ? `A diplomatic gift costs ${DIPLOMACY_RULES.giftCost} credits.` : '');
  const endTradeReason = commonReason || (!relation.trade ? 'No active trade treaty.' : tradeEndsAt ? `Cancellation already announced for turn ${tradeEndsAt}.` : '');
  const answerReason = commonReason || (!incomingOffer ? 'No active incoming peace offer.' : relation.status !== 'war' ? 'The war has already ended.' : '');
  const tradeAnswerReason = commonReason || (!incomingTradeOffer ? 'No active incoming trade offer.' : '');
  const withdrawal = 'Fleets in each other’s territory withdraw to their nearest owned colony, or a charted neutral system if they have no colony. A fleet with neither destination remains in place with no moves.';
  const actions = {
    war: option(!warReason, warReason, relation.trade ? 'Break trade immediately: mutual trust −65; the betrayed empire gains 35 grievance. War opens their borders.' : 'Declare war: mutual trust −40; the other empire gains 20 grievance. War opens their borders.'),
    peace: { ...option(!peaceReason, peaceReason, peaceMode === 'offer' ? `Reserve ${DIPLOMACY_RULES.peaceCost} credits for a player decision. The war continues until acceptance. Offer expires on turn ${state.turn + DIPLOMACY_RULES.offerTurns}; refusal or expiry refunds the credits. Acceptance creates a ${DIPLOMACY_RULES.truceTurns}-cycle truce. ${withdrawal}` : `Pay ${DIPLOMACY_RULES.peaceCost} credits to end the war. War is forbidden for ${DIPLOMACY_RULES.truceTurns} cycles. ${withdrawal}`, DIPLOMACY_RULES.peaceCost), accepted: peaceMode === 'offer' ? null : Boolean(peaceWillingness?.accepted), mode: peaceMode, willingness: peaceWillingness },
    trade: { ...option(!tradeReason, tradeReason, tradeMode === 'offer' ? `Reserve ${DIPLOMACY_RULES.tradeCost} credits for a trade offer. Borders, income and trust stay unchanged until the player accepts. The reserved treaty fee is consumed on acceptance, or refunded on refusal or expiry.` : 'Open borders and earn 6 credits per turn, or 10 with Stellar Accords. Mutual trust +10. Border grievances can still cause cancellation.', DIPLOMACY_RULES.tradeCost), mode: tradeMode },
    gift: option(!giftReason, giftReason, 'Transfer 35 credits; mutual trust +20. Existing border grievances remain.', DIPLOMACY_RULES.giftCost),
    endTrade: option(!endTradeReason, endTradeReason, `Give ${DIPLOMACY_RULES.tradeNoticeTurns} cycles of notice. Income and access continue until turn ${state.turn + DIPLOMACY_RULES.tradeNoticeTurns}, then both end and visiting fleets withdraw. Mutual trust −5; the other empire gains 5 grievance.`),
    acceptPeace: option(!answerReason, answerReason, `Receive ${incomingOffer?.credits || DIPLOMACY_RULES.peaceCost} credits. End the war and establish a ${DIPLOMACY_RULES.truceTurns}-cycle truce. ${withdrawal}`),
    declinePeace: option(!answerReason, answerReason, 'Continue the war without moving any fleet. The proposer receives its reserved credits back.'),
    acceptTrade: option(!tradeAnswerReason, tradeAnswerReason, `Open borders and begin trade income. Mutual trust +10. The proposer already reserved the ${DIPLOMACY_RULES.tradeCost}-credit treaty fee; acceptance costs you no credits.`),
    declineTrade: option(!tradeAnswerReason, tradeAnswerReason, 'Keep borders closed. The proposer receives its reserved treaty fee back.'),
  };
  const pressure = pressureFor(state, factionId, targetId);
  return { factionId, targetId, status: relation.status, trust: relation.trust, grievance: relation.grievance || 0, ourGrievance: relation.grievance || 0, theirGrievance: target.relations[factionId].grievance || 0, truceUntil, truceRemaining, tradeEndsAt, tradeEndingIn, tradeOfferAfter, borderCount: pressure.borderCount, policy: targetId === 'khar' ? 'Khar frontier rivalry: a shared border increases its grievances by 1 each peaceful cycle. At 24 grievances, a sufficiently strong Khar force may cancel trade with notice and prepare for war.' : 'New neighboring claims and observed military pressure create grievances. A quiet frontier lets grievances ease.', actions, ...actions, pendingOffers, incomingOffer, outgoingOffer, incomingTradeOffer, outgoingTradeOffer };
}

function withdrawFleets(state, first, second) {
  let moved = 0, stranded = 0;
  for (const fleet of state.fleets.filter(fleet => fleet.owner === first || fleet.owner === second)) {
    const location = state.systems.find(system => system.id === fleet.systemId);
    if (!location || location.owner !== (fleet.owner === first ? second : first)) continue;
    let candidates = coloniesOf(state, fleet.owner);
    if (!candidates.length) candidates = state.systems.filter(system => !system.owner && system.knownBy.includes(fleet.owner));
    const destination = [...candidates].sort((a, b) => Math.hypot(a.x - location.x, a.y - location.y) - Math.hypot(b.x - location.x, b.y - location.y) || a.id.localeCompare(b.id))[0];
    fleet.movesLeft = 0;
    if (destination) { fleet.systemId = destination.id; delete fleet.route; moved++; } else stranded++;
  }
  return { moved, stranded };
}

function resolveOffer(state, offer, status) {
  if (offer.status !== 'pending') return;
  offer.status = status;
  if (status === 'accepted') {
    if (offerKind(offer) === 'peace') factionOf(state, offer.to).credits += offer.credits;
  } else {
    factionOf(state, offer.from).credits += offer.credits;
    if (offerKind(offer) === 'trade') {
      const resolvedTurn = status === 'expired' ? Math.min(state.turn, offer.expiresTurn) : state.turn;
      delayTradeOffer(state, offer.from, offer.to, resolvedTurn);
    }
  }
}

function delayTradeOffer(state, first, second, turn = state.turn) {
  if (first !== 'player' && second !== 'player') return;
  const sender = first === 'player' ? second : first;
  const relation = factionOf(state, sender).relations.player;
  relation.tradeOfferAfter = Math.max(relation.tradeOfferAfter || 0, turn + DIPLOMACY_RULES.tradeOfferQuietTurns);
}

/** Safe after any successful mutation: refund incompatible commitments once. */
export function reconcileDiplomacyOffers(state) {
  let offersExpired = 0;
  for (const offer of state.diplomacyOffers || []) {
    if (offer.status !== 'pending' || state.turn < offer.expiresTurn && compatibleOffer(state, offer)) continue;
    resolveOffer(state, offer, 'expired'); offersExpired++;
    const trade = offerKind(offer) === 'trade';
    record(state, offer.from, offer.to, `${nameOf(state, offer.from)}’s ${trade ? 'trade' : 'peace'} offer expired. Its ${offer.credits} reserved credits were returned; ${trade ? 'no treaty was established' : 'no fleets moved'}.`);
  }
  return offersExpired;
}

function establishTrade(state, first, second) {
  const faction = factionOf(state, first), target = factionOf(state, second);
  for (const relation of [faction.relations[second], target.relations[first]]) {
    relation.trade = true; relation.tradeEndsAt = 0; relation.trust = trust(relation.trust + 10);
  }
  const message = `Trade established between ${faction.name} and ${target.name}. Borders are open; existing grievances remain.`;
  record(state, first, second, message);
  recordPublicDiplomacy(state, { kind: 'trade', firstId: first, secondId: second });
  return message;
}

function settlePeace(state, first, second) {
  const a = factionOf(state, first), b = factionOf(state, second);
  for (const relation of [a.relations[second], b.relations[first]]) {
    relation.status = 'peace'; relation.trade = false; relation.tradeEndsAt = 0;
    relation.trust = -5; relation.treatyTurn = state.turn; relation.truceUntil = state.turn + DIPLOMACY_RULES.truceTurns;
    relation.grievance = Math.max(0, (relation.grievance || 0) - 15);
  }
  for (const offer of state.diplomacyOffers || []) if (offer.status === 'pending' && [first, second].includes(offer.from) && [first, second].includes(offer.to)) resolveOffer(state, offer, 'expired');
  const withdrawal = withdrawFleets(state, first, second);
  record(state, first, second, `Peace agreed between ${a.name} and ${b.name}. The truce forbids war until turn ${state.turn + DIPLOMACY_RULES.truceTurns}. ${withdrawal.moved} fleet${withdrawal.moved === 1 ? '' : 's'} withdrew.${withdrawal.stranded ? ` ${withdrawal.stranded} fleet${withdrawal.stranded === 1 ? ' has' : 's have'} no owned colony or charted neutral withdrawal point and remain in place.` : ''}`);
  recordPublicDiplomacy(state, { kind: 'peace', firstId: first, secondId: second, untilTurn: state.turn + DIPLOMACY_RULES.truceTurns });
  return withdrawal;
}

/** Owns all diplomacy mutations, including exactly one order per success. */
export function executeDiplomacy(state, action = {}) {
  const factionId = action.factionId || 'player';
  const stance = action.stance;
  if (!STANCES.includes(stance)) return failure('Unknown diplomatic proposal.');
  let targetId = action.targetId;
  let offer = null;
  if (['acceptPeace', 'declinePeace', 'acceptTrade', 'declineTrade'].includes(stance)) {
    const kind = stance.endsWith('Trade') ? 'trade' : 'peace';
    offer = (state.diplomacyOffers || []).find(candidate => offerKind(candidate) === kind && candidate.status === 'pending' && candidate.to === factionId && (action.offerId ? candidate.id === action.offerId : candidate.from === targetId));
    if (!offer || state.turn >= offer.expiresTurn || !compatibleOffer(state, offer) || (targetId && targetId !== offer.from)) return failure(`No matching active incoming ${kind} offer.`);
    targetId = offer.from;
  }
  const forecast = getDiplomacyForecast(state, factionId, targetId);
  const available = forecast.actions[stance];
  if (!available.enabled) return failure(available.reason);
  const faction = factionOf(state, factionId), target = factionOf(state, targetId);
  const relation = faction.relations[targetId], reverse = target.relations[factionId];
  let outcome = stance, message = '', extra = {};
  if (stance === 'war') {
    const betrayal = relation.trade;
    for (const r of [relation, reverse]) { r.status = 'war'; r.trade = false; r.tradeEndsAt = 0; r.trust = trust(r.trust - (betrayal ? 65 : 40)); r.treatyTurn = state.turn; r.truceUntil = 0; }
    relation.warStartColonies = coloniesOf(state, factionId).length;
    reverse.warStartColonies = coloniesOf(state, targetId).length;
    reverse.grievance = clamp((reverse.grievance || 0) + (betrayal ? 35 : 20));
    message = `${faction.name} declared war on ${target.name}.${betrayal ? ' The active trade treaty was broken; the betrayal deepens their grievance.' : ''}`;
    record(state, factionId, targetId, message, 'war');
    recordPublicDiplomacy(state, { kind: 'war', firstId: factionId, secondId: targetId });
  } else if (stance === 'peace' && forecast.peace.mode === 'offer') {
    faction.credits -= DIPLOMACY_RULES.peaceCost;
    state.diplomacyOffers ||= [];
    state.nextDiplomacyOfferId ||= 1;
    offer = { id: `peace-${state.nextDiplomacyOfferId++}`, from: factionId, to: targetId, createdTurn: state.turn, expiresTurn: state.turn + DIPLOMACY_RULES.offerTurns, credits: DIPLOMACY_RULES.peaceCost, status: 'pending', truceTurns: DIPLOMACY_RULES.truceTurns };
    state.diplomacyOffers.push(offer);
    relation.peaceOfferTurn = state.turn;
    message = `${faction.name} offers ${offer.credits} credits for peace and a ${offer.truceTurns}-cycle truce. Your decision is required before turn ${offer.expiresTurn}; the war continues until you accept.`;
    record(state, factionId, targetId, message);
    outcome = 'peaceOffered'; extra.offer = offer;
  } else if (stance === 'peace') {
    faction.credits -= DIPLOMACY_RULES.peaceCost; target.credits += DIPLOMACY_RULES.peaceCost;
    extra.withdrawal = settlePeace(state, factionId, targetId);
    outcome = 'peaceAccepted'; message = `Peace accepted. The truce lasts until turn ${relation.truceUntil}.`;
  } else if (stance === 'acceptPeace') {
    resolveOffer(state, offer, 'accepted');
    extra.withdrawal = settlePeace(state, factionId, targetId);
    outcome = 'peaceAccepted'; message = `Peace accepted. You receive ${offer.credits} credits; war is forbidden until turn ${relation.truceUntil}.`;
    extra.offer = offer;
  } else if (stance === 'declinePeace') {
    resolveOffer(state, offer, 'declined');
    message = `${faction.name} declined ${target.name}’s peace offer. The war continues.`;
    record(state, factionId, targetId, message); outcome = 'peaceDeclined'; extra.offer = offer;
  } else if (stance === 'trade' && forecast.trade.mode === 'offer') {
    faction.credits -= DIPLOMACY_RULES.tradeCost;
    state.diplomacyOffers ||= [];
    state.nextDiplomacyOfferId ||= 1;
    offer = { id: `trade-${state.nextDiplomacyOfferId++}`, kind: 'trade', from: factionId, to: targetId, createdTurn: state.turn, expiresTurn: state.turn + DIPLOMACY_RULES.offerTurns, credits: DIPLOMACY_RULES.tradeCost, status: 'pending' };
    state.diplomacyOffers.push(offer);
    message = `${faction.name} proposes trade and reserves its ${offer.credits}-credit treaty fee. Borders remain closed until you accept. The offer expires on cycle ${offer.expiresTurn}.`;
    record(state, factionId, targetId, message);
    outcome = 'tradeOffered'; extra.offer = offer;
  } else if (stance === 'trade') {
    faction.credits -= DIPLOMACY_RULES.tradeCost;
    message = establishTrade(state, factionId, targetId);
  } else if (stance === 'acceptTrade') {
    resolveOffer(state, offer, 'accepted');
    message = establishTrade(state, offer.from, offer.to);
    outcome = 'tradeAccepted'; extra.offer = offer;
  } else if (stance === 'declineTrade') {
    resolveOffer(state, offer, 'declined');
    message = `${faction.name} declined ${target.name}’s trade offer. Borders remain closed.`;
    record(state, factionId, targetId, message); outcome = 'tradeDeclined'; extra.offer = offer;
  } else if (stance === 'gift') {
    faction.credits -= DIPLOMACY_RULES.giftCost; target.credits += DIPLOMACY_RULES.giftCost;
    for (const r of [relation, reverse]) r.trust = trust(r.trust + 20);
    message = `${faction.name} sent a 35-credit gift to ${target.name}. Trust improves; border grievances remain.`;
    record(state, factionId, targetId, message);
  } else if (stance === 'endTrade') {
    for (const r of [relation, reverse]) { r.tradeEndsAt = state.turn + DIPLOMACY_RULES.tradeNoticeTurns; r.trust = trust(r.trust - 5); }
    reverse.grievance = clamp((reverse.grievance || 0) + 5);
    message = `${faction.name} gave notice to end trade with ${target.name}. Income and open borders continue until turn ${relation.tradeEndsAt}, when visiting fleets withdraw.`;
    record(state, factionId, targetId, message); outcome = 'tradeNotice';
    recordPublicDiplomacy(state, { kind: 'trade-notice', firstId: factionId, secondId: targetId, untilTurn: relation.tradeEndsAt });
  }
  faction.orders--;
  reconcileDiplomacyOffers(state);
  return { ok: true, message, outcome, ...extra };
}

/** Call after incrementing turn, before income. Repeated calls are harmless. */
export function advanceDiplomacy(state) {
  if (state.diplomacyUpdatedTurn === state.turn) return { offersExpired: 0, treatiesEnded: 0 };
  const offersExpired = reconcileDiplomacyOffers(state);
  let treatiesEnded = 0;
  for (let i = 0; i < state.factions.length; i++) for (let j = i + 1; j < state.factions.length; j++) {
    const first = state.factions[i], second = state.factions[j];
    const relation = first.relations[second.id], reverse = second.relations[first.id];
    if (relation.trade && relation.tradeEndsAt && state.turn >= relation.tradeEndsAt) {
      for (const r of [relation, reverse]) { r.trade = false; r.tradeEndsAt = 0; }
      const withdrawal = withdrawFleets(state, first.id, second.id);
      delayTradeOffer(state, first.id, second.id);
      record(state, first.id, second.id, `Trade between ${first.name} and ${second.name} has ended. Trade income and open borders cease; ${withdrawal.moved} visiting fleet${withdrawal.moved === 1 ? '' : 's'} withdrew.`);
      recordPublicDiplomacy(state, { kind: 'trade-ended', firstId: first.id, secondId: second.id });
      treatiesEnded++;
    }
    for (const [observer, other, r] of [[first, second, relation], [second, first, reverse]]) {
      if (observer.eliminated || other.eliminated || !observer.contacts.includes(other.id)) continue;
      const pressure = pressureFor(state, observer.id, other.id);
      const newClaims = r.lastBorderCount === undefined ? 0 : Math.max(0, pressure.borderCount - r.lastBorderCount);
      r.lastBorderCount = pressure.borderCount;
      if (r.status === 'war') continue;
      const rivalry = observer.id === 'khar' && pressure.borderCount > 0 ? 1 : 0;
      const militaryPressure = Math.min(6, pressure.threatenedColonies * 2 + Math.floor(pressure.invadingWeight / 2));
      const gain = newClaims * 8 + militaryPressure + rivalry;
      const previous = r.grievance || 0;
      r.grievance = clamp(previous + (gain || -1));
      if (gain) r.trust = trust(r.trust - Math.min(6, Math.ceil(gain / 3)));
      else if (r.trade) r.trust = trust(r.trust + 1);
      const threshold = observer.id === 'khar' ? 24 : 45;
      if (previous < threshold && r.grievance >= threshold) record(state, observer.id, other.id, `${observer.name} warns ${other.name}: ${newClaims ? 'new frontier claims' : militaryPressure ? 'observed military pressure' : 'their disputed shared frontier'} have brought grievances to ${r.grievance}. Trade may be cancelled and war preparations may follow.`);
    }
  }
  if (state.diplomacyOffers?.length > 32) state.diplomacyOffers = [...state.diplomacyOffers.filter(offer => offer.status !== 'pending').slice(-20), ...state.diplomacyOffers.filter(offer => offer.status === 'pending')];
  state.diplomacyUpdatedTurn = state.turn;
  return { offersExpired, treatiesEnded };
}

/** Pure strategic suggestions. The normal command path still validates them. */
export function getDiplomaticIntent(state, factionId) {
  const faction = factionOf(state, factionId);
  if (!faction || faction.eliminated || factionId === 'player' || state.winner || faction.orders < 1) return [];
  const ownStrength = state.fleets.filter(fleet => fleet.owner === factionId).reduce((sum, fleet) => sum + weight(fleet), 0);
  const actions = [];
  for (const targetId of [...faction.contacts].sort()) {
    const target = factionOf(state, targetId);
    if (!target || target.eliminated) continue;
    const relation = faction.relations[targetId], forecast = getDiplomacyForecast(state, factionId, targetId);
    const propose = (stance, reason) => actions.push({ type: 'diplomacy', factionId, targetId, stance, reason });
    if (relation.status === 'war') {
      const ready = willingness(state, factionId, targetId);
      if (ready.accepted && forecast.peace.enabled && state.turn - (relation.peaceOfferTurn ?? -100) >= 5) propose('peace', ready.reason);
      continue;
    }
    const pressure = pressureFor(state, factionId, targetId);
    const grievance = relation.grievance || 0;
    const threshold = factionId === 'khar' ? 24 : 45;
    const prepared = ownStrength >= (factionId === 'khar' ? 4 : 3) && ownStrength >= pressure.observedWeight * 1.1;
    const conflict = grievance >= threshold && (pressure.borderCount > 0 || pressure.threatenedColonies > 0) && prepared;
    if (conflict) {
      if (relation.trade && forecast.endTrade.enabled) propose('endTrade', 'Frontier grievances outweigh the value of trade. Give notice before closing borders.');
      else if (!relation.trade && forecast.war.enabled) propose('war', 'Unresolved frontier grievances and a prepared fleet make war a credible policy.');
    } else if (forecast.trade.enabled && faction.credits > 110 && grievance < 12 && (factionId !== 'khar' || pressure.borderCount === 0)) propose('trade', 'Peaceful relations and manageable frontier tensions favor trade.');
  }
  return actions;
}

/** Optional v1 fields are absent in older saves; present fields are strict. */
export function validateDiplomacyState(state) {
  if (!state || !Array.isArray(state.factions) || state.factions.some(faction => !faction || typeof faction.id !== 'string') || !Number.isSafeInteger(state.turn)) return false;
  const ids = new Set(state.factions.map(faction => faction.id));
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  if (state.diplomacyUpdatedTurn !== undefined && (!integer(state.diplomacyUpdatedTurn) || state.diplomacyUpdatedTurn > state.turn)) return false;
  if (state.nextDiplomacyOfferId !== undefined && (!integer(state.nextDiplomacyOfferId) || state.nextDiplomacyOfferId < 1)) return false;
  for (const faction of state.factions) {
    if (!faction?.relations || typeof faction.relations !== 'object') return false;
    for (const [targetId, relation] of Object.entries(faction.relations)) {
      if (!ids.has(targetId) || !relation || typeof relation !== 'object') return false;
      for (const key of ['truceUntil', 'tradeEndsAt', 'warStartColonies', 'peaceOfferTurn', 'lastBorderCount']) if (relation[key] !== undefined && !integer(relation[key])) return false;
      if (relation.tradeOfferAfter !== undefined && (faction.id === 'player' || targetId !== 'player' || !integer(relation.tradeOfferAfter) || relation.tradeOfferAfter > state.turn + DIPLOMACY_RULES.tradeOfferQuietTurns)) return false;
      if (relation.grievance !== undefined && (!Number.isFinite(relation.grievance) || relation.grievance < 0 || relation.grievance > 100)) return false;
      if (relation.warStartColonies > state.systems?.length || relation.lastBorderCount > state.systems?.length || relation.peaceOfferTurn > state.turn) return false;
      const reverse = factionOf(state, targetId)?.relations?.[faction.id];
      if (!reverse || (relation.truceUntil || 0) !== (reverse.truceUntil || 0) || (relation.tradeEndsAt || 0) !== (reverse.tradeEndsAt || 0)) return false;
      if (relation.tradeEndsAt && !relation.trade) return false;
      if (relation.status === 'war' && relation.truceUntil > state.turn) return false;
    }
  }
  if (state.diplomacyOffers === undefined) return true;
  if (!Array.isArray(state.diplomacyOffers) || state.diplomacyOffers.length > 100 || !Number.isSafeInteger(state.nextDiplomacyOfferId)) return false;
  const seen = new Set(), pending = new Set();
  for (const offer of state.diplomacyOffers) {
    if (!offer || typeof offer !== 'object' || (offer.kind !== undefined && !['peace', 'trade'].includes(offer.kind))) return false;
    const kind = offerKind(offer), trade = kind === 'trade';
    if (typeof offer.id !== 'string' || !(trade ? /^trade-[1-9]\d*$/ : /^peace-[1-9]\d*$/).test(offer.id) || seen.has(offer.id)) return false;
    if (!ids.has(offer.from) || !ids.has(offer.to) || offer.from === offer.to || !['pending', 'accepted', 'declined', 'expired'].includes(offer.status)) return false;
    if (!integer(offer.createdTurn) || offer.createdTurn > state.turn || !integer(offer.expiresTurn) || offer.expiresTurn !== offer.createdTurn + DIPLOMACY_RULES.offerTurns || offer.credits !== (trade ? DIPLOMACY_RULES.tradeCost : DIPLOMACY_RULES.peaceCost)) return false;
    if (trade ? offer.to !== 'player' || offer.from === 'player' || offer.truceTurns !== undefined : offer.truceTurns !== DIPLOMACY_RULES.truceTurns) return false;
    if (Number(offer.id.slice(6)) >= state.nextDiplomacyOfferId) return false;
    if (offer.status === 'pending') {
      const key = `${kind}:${offer.from}:${offer.to}`;
      if (pending.has(key) || (trade ? !compatibleOffer(state, offer) : factionOf(state, offer.from).relations[offer.to]?.status !== 'war')) return false;
      pending.add(key);
    }
    seen.add(offer.id);
  }
  return true;
}
