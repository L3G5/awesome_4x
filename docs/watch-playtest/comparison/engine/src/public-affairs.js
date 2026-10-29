/** Public commitments and sovereignty, never remote fleet or economy intelligence. */
import { FACTIONS } from './content.js';

export const PUBLIC_AFFAIRS_LIMITS = Object.freeze({ dispatches: 64, transfers: 32 });
const DIPLOMATIC_KINDS = ['war', 'peace', 'trade', 'trade-notice', 'trade-ended'];
const UNKNOWN = Object.freeze({ id: null, name: 'Uncontacted civilization', shortName: 'Uncontacted', color: null });
const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const knows = (observer, id) => observer.id === id || observer.contacts.includes(id);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const snapshot = value => freeze(structuredClone(value));
function participant(observer, id) {
  if (!knows(observer, id)) return { ...UNKNOWN };
  const faction = FACTIONS[id];
  return { id, name: faction.name, shortName: faction.shortName, color: faction.color };
}

/** Current public facts are available on contact, without inventing old dispatches. */
export function getPublicRelationships(state, observerId = 'player') {
  const observer = factionOf(state, observerId);
  if (!observer) return [];
  const others = state.factions.filter(faction => faction.id !== observerId && !faction.eliminated).sort((a, b) => a.id.localeCompare(b.id));
  const relationships = [];
  for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) {
    const first = others[i], second = others[j];
    const firstKnown = knows(observer, first.id), secondKnown = knows(observer, second.id);
    if (!firstKnown && !secondKnown) continue;
    const relation = first.relations[second.id];
    const truceUntil = relation.truceUntil > state.turn ? relation.truceUntil : null;
    const tradeEndsAt = relation.trade && relation.tradeEndsAt > state.turn ? relation.tradeEndsAt : null;
    const status = relation.status === 'war' ? 'war' : truceUntil ? 'truce' : relation.trade ? 'trade' : 'peace';
    // A default peaceful relation is not evidence of an unknown civilization.
    if (status === 'peace' && !(firstKnown && secondKnown)) continue;
    const participants = [participant(observer, first.id), participant(observer, second.id)];
    // No ordering or key may identify an anonymous counterpart.
    participants.sort((a, b) => Number(b.id !== null) - Number(a.id !== null) || a.name.localeCompare(b.name));
    relationships.push({
      key: firstKnown && secondKnown ? `${first.id}:${second.id}` : null,
      participants, status,
      sinceTurn: ['war', 'truce'].includes(status) && relation.treatyTurn > 0 ? relation.treatyTurn : null,
      truceUntil, tradeEndsAt,
    });
  }
  const priority = { war: 0, truce: 1, trade: 2, peace: 3 };
  relationships.sort((a, b) => priority[a.status] - priority[b.status] || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return snapshot(relationships);
}

/** Historical text is copied, never relabeled using today's contacts. */
export function getPublicDispatches(state, observerId = 'player') {
  return snapshot(state.publicAffairs?.observers?.[observerId]?.dispatches || []);
}

/** Five recent cycles by default (ages 0–4); Infinity returns the retained ledger. */
export function getKnownTransfers(state, observerId = 'player', maxAge = 5) {
  if (!(maxAge === Infinity || Number.isFinite(maxAge) && maxAge >= 0)) return [];
  const transfers = state.publicAffairs?.observers?.[observerId]?.transfers || [];
  return snapshot(transfers.filter(transfer => state.turn - transfer.turn < maxAge));
}

function ledger(state, observerId) {
  state.publicAffairs ||= { version: 1, observers: {} };
  state.publicAffairs.observers[observerId] ||= { nextId: 1, dispatches: [], transfers: [] };
  return state.publicAffairs.observers[observerId];
}

function dispatchText(dispatch) {
  const [first, second] = dispatch.participants.map(person => person.name);
  switch (dispatch.kind) {
    case 'war': return `${first} declared war on ${second}.`;
    case 'peace': return `Peace agreed between ${first} and ${second}. Their truce forbids war until cycle ${dispatch.untilTurn}.`;
    case 'trade': return `${first} and ${second} announced a trade agreement. Their borders are open to each other.`;
    case 'trade-notice': return `${first} gave notice to end trade with ${second}. Their trade and mutual border access end on cycle ${dispatch.untilTurn}.`;
    case 'trade-ended': return `Trade between ${first} and ${second} has ended. Their mutual border access is closed.`;
    case 'sovereignty': return `${dispatch.systemName} changed sovereignty from ${first} to ${second}.`;
    default: return '';
  }
}

function appendDispatch(state, observer, book, data) {
  const dispatch = snapshot({ ...data, text: dispatchText(data) });
  book.dispatches.unshift(dispatch);
  book.dispatches.length = Math.min(book.dispatches.length, PUBLIC_AFFAIRS_LIMITS.dispatches);
  if (observer.id === 'player') {
    state.log.unshift({
      id: state.nextLogId++, turn: state.turn,
      type: dispatch.kind === 'war' ? 'war' : dispatch.kind === 'sovereignty' ? 'sovereignty' : 'diplomacy',
      text: dispatch.text, publicAffairId: dispatch.id,
      ...(dispatch.targetId ? { targetId: dispatch.targetId } : {}),
      ...(dispatch.systemId ? { systemId: dispatch.systemId } : {}),
    });
    state.log.length = Math.min(state.log.length, 160);
  }
  return dispatch;
}

/** Called only after a real public diplomatic mutation; never pass raw AI reasons. */
export function recordPublicDiplomacy(state, { kind, firstId, secondId, untilTurn }) {
  if (!DIPLOMATIC_KINDS.includes(kind) || firstId === secondId || !FACTIONS[firstId] || !FACTIONS[secondId]) return [];
  if (['peace', 'trade-notice'].includes(kind) && (!Number.isSafeInteger(untilTurn) || untilTurn <= state.turn)) return [];
  const received = [];
  for (const observer of state.factions) {
    // Participants already receive their normal bilateral reports.
    if (observer.eliminated || [firstId, secondId].includes(observer.id) || !knows(observer, firstId) && !knows(observer, secondId)) continue;
    const participants = [participant(observer, firstId), participant(observer, secondId)];
    const book = ledger(state, observer.id);
    received.push(appendDispatch(state, observer, book, {
      id: book.nextId++, turn: state.turn, kind, participants,
      targetId: participants.find(person => person.id !== null).id,
      ...(['peace', 'trade-notice'].includes(kind) ? { untilTurn } : {}),
    }));
  }
  return received;
}

/**
 * observerIds is the pre-capture charting snapshot. Contact may reveal public
 * beacons, but such newly charted worlds must not retroactively reveal a capture.
 * The game establishes contact with the new sovereign before calling this hook.
 */
export function recordSovereigntyTransfer(state, { systemId, fromId, toId, observerIds }) {
  const system = state.systems.find(candidate => candidate.id === systemId);
  if (!system || fromId === toId || !FACTIONS[fromId] || !FACTIONS[toId] || !Array.isArray(observerIds)) return [];
  const received = [];
  for (const observer of state.factions) {
    if (observer.eliminated || !observerIds.includes(observer.id) || !system.knownBy.includes(observer.id)) continue;
    const book = ledger(state, observer.id);
    const transfer = snapshot({ id: book.nextId++, turn: state.turn, systemId, systemName: system.name, from: participant(observer, fromId), to: participant(observer, toId) });
    book.transfers.unshift(transfer);
    book.transfers.length = Math.min(book.transfers.length, PUBLIC_AFFAIRS_LIMITS.transfers);
    received.push(transfer);
    if ([fromId, toId].includes(observer.id)) continue;
    appendDispatch(state, observer, book, {
      id: transfer.id, turn: transfer.turn, kind: 'sovereignty',
      participants: [transfer.from, transfer.to], systemId, systemName: system.name,
      targetId: transfer.to.id || transfer.from.id,
    });
  }
  return received;
}

/** Strict optional version-1 state: imports cannot add private payload fields. */
export function validatePublicAffairsState(state) {
  if (state.publicAffairs === undefined) return true;
  try {
    const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
    const positive = value => Number.isSafeInteger(value) && value > 0;
    const publicState = state.publicAffairs;
    if (!exact(publicState, ['version', 'observers']) || publicState.version !== 1 || !publicState.observers || typeof publicState.observers !== 'object' || Array.isArray(publicState.observers)) return false;
    const observers = Object.entries(publicState.observers);
    if (observers.length > state.factions.length) return false;
    for (const [observerId, book] of observers) {
      const observer = factionOf(state, observerId);
      if (!observer || !exact(book, ['nextId', 'dispatches', 'transfers']) || !positive(book.nextId)) return false;
      if (!Array.isArray(book.dispatches) || book.dispatches.length > PUBLIC_AFFAIRS_LIMITS.dispatches || !Array.isArray(book.transfers) || book.transfers.length > PUBLIC_AFFAIRS_LIMITS.transfers) return false;
      const validPerson = person => {
        if (!exact(person, ['id', 'name', 'shortName', 'color'])) return false;
        if (person.id === null) return Object.keys(UNKNOWN).every(key => person[key] === UNKNOWN[key]);
        if (!FACTIONS[person.id] || !knows(observer, person.id)) return false;
        const expected = participant(observer, person.id);
        return Object.keys(expected).every(key => person[key] === expected[key]);
      };
      const ordered = entries => entries.every((entry, index) => entry && positive(entry.id) && entry.id < book.nextId && positive(entry.turn) && entry.turn <= state.turn && (!index || entry.id < entries[index - 1].id && entry.turn <= entries[index - 1].turn));
      if (!ordered(book.dispatches) || !ordered(book.transfers)) return false;
      for (const transfer of book.transfers) {
        if (!exact(transfer, ['id', 'turn', 'systemId', 'systemName', 'from', 'to']) || !validPerson(transfer.from) || !validPerson(transfer.to) || transfer.to.id === null || transfer.from.id === transfer.to.id) return false;
        const system = state.systems.find(candidate => candidate.id === transfer.systemId);
        if (!system || !system.knownBy.includes(observerId) || transfer.systemName !== system.name) return false;
      }
      for (const dispatch of book.dispatches) {
        const isTransfer = dispatch.kind === 'sovereignty', deadline = ['peace', 'trade-notice'].includes(dispatch.kind);
        const keys = ['id', 'turn', 'kind', 'text', 'participants', 'targetId', ...(isTransfer ? ['systemId', 'systemName'] : []), ...(deadline ? ['untilTurn'] : [])];
        if (!exact(dispatch, keys) || ![...DIPLOMATIC_KINDS, 'sovereignty'].includes(dispatch.kind) || !Array.isArray(dispatch.participants) || dispatch.participants.length !== 2 || !dispatch.participants.every(validPerson)) return false;
        const identified = dispatch.participants.filter(person => person.id !== null).map(person => person.id);
        if (!identified.length || identified.includes(observerId) || new Set(identified).size !== identified.length || !identified.includes(dispatch.targetId)) return false;
        if (deadline && (!positive(dispatch.untilTurn) || dispatch.untilTurn <= dispatch.turn || dispatch.untilTurn > dispatch.turn + 120)) return false;
        if (isTransfer) {
          const system = state.systems.find(candidate => candidate.id === dispatch.systemId);
          if (!system || !system.knownBy.includes(observerId) || dispatch.systemName !== system.name) return false;
        }
        if (dispatch.text !== dispatchText(dispatch)) return false;
      }
    }
    return true;
  } catch { return false; }
}
