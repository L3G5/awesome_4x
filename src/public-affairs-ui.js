import { getPublicRelationships, getPublicDispatches, getKnownTransfers } from './public-affairs.js';
import './public-affairs.css';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const seals = { player: '⌘', veyr: '◈', khar: '⛨', choir: '✧' };

function government(participant) {
  const body = `<span class="government-seal" style="--government-color:${participant.color || '#8296a5'}" aria-hidden="true">${seals[participant.id] || '?'}</span><span>${escape(participant.shortName || participant.name)}</span>`;
  return participant.id
    ? `<button class="government-link" data-action="report-diplomacy" data-target="${participant.id}" title="Open diplomacy with ${escape(participant.name)}">${body}</button>`
    : `<span class="government-link unidentified-government">${body}</span>`;
}

function relationship(row) {
  const label = { war: 'At war', trade: 'Trade partners', truce: 'Truce', peace: 'At peace' }[row.status];
  const detail = row.tradeEndsAt ? `Trade ends cycle ${row.tradeEndsAt}`
    : row.status === 'truce' ? `Until cycle ${row.truceUntil}`
    : row.sinceTurn !== null ? `Since cycle ${row.sinceTurn}` : 'Current public status';
  return `<article class="foreign-relation status-${row.status}" data-status="${row.status}">${government(row.participants[0])}<div class="foreign-commitment"><strong>${label}</strong><small>${detail}</small></div>${government(row.participants[1])}</article>`;
}

export function renderPublicDispatchLinks(entry) {
  return `${entry.systemId ? `<button class="small-button ghost" data-action="report-inspect" data-system="${entry.systemId}">Inspect ${escape(entry.systemName || 'world')} →</button>` : ''}${entry.targetId ? `<button class="small-button ghost" data-action="report-diplomacy" data-target="${entry.targetId}">Open diplomacy →</button>` : ''}`;
}

export function renderRoutePublicCause(state, fleet, route) {
  const system = route?.stopBefore && state.systems.find(candidate => candidate.id === route.stopBefore.systemId);
  const faction = state.factions.find(candidate => candidate.id === fleet.owner);
  if (!system?.owner || system.owner === fleet.owner || faction.relations[system.owner].trade || faction.relations[system.owner].status === 'war') return '';
  const transfer = getKnownTransfers(state, fleet.owner, Infinity).find(entry => entry.systemId === system.id && entry.to.id === system.owner);
  if (!transfer) return '';
  return `<div class="route-public-cause"><p>Cycle ${transfer.turn}: ${escape(transfer.to.shortName)} took ${escape(transfer.systemName)} from ${escape(transfer.from.shortName)}. This course now crosses closed borders.</p><button data-action="report-inspect" data-system="${system.id}">Inspect world</button><button data-action="report-diplomacy" data-target="${transfer.to.id}">Negotiate access</button></div>`;
}

export function renderSovereigntyNote(state, systemId) {
  const system = state.systems.find(candidate => candidate.id === systemId);
  const transfer = getKnownTransfers(state, 'player', Infinity).find(entry => entry.systemId === systemId && entry.to.id === system?.owner);
  if (!transfer) return '';
  return `<div class="sovereignty-note"><div class="section-label">PUBLIC RECORD · CYCLE ${transfer.turn}</div><p>${escape(transfer.to.name)} took control of this world from ${escape(transfer.from.name)}.</p></div>`;
}

export function renderPublicAffairs(state, { dispatchesOpen = false } = {}) {
  const relationships = getPublicRelationships(state);
  const dispatches = getPublicDispatches(state);
  const wars = relationships.filter(row => row.status === 'war').length;
  const recent = dispatches.slice(0, 4);
  return `<section class="foreign-affairs" aria-labelledby="foreign-affairs-title"><div class="affairs-heading"><div><div class="eyebrow">GOVERNMENT BROADCASTS</div><h3 id="foreign-affairs-title">Across the Reach</h3></div><span class="affairs-count ${wars ? 'has-war' : ''}">${wars ? `${wars} public ${wars === 1 ? 'war' : 'wars'}` : 'Foreign relations'}</span></div><p class="affairs-lead">The commitments of other civilizations. These agreements do not change their relations with the Concord.</p><div class="foreign-relationships" data-public-relationships>${relationships.length ? relationships.map(relationship).join('') : '<p class="empty-note">No foreign commitments received. Establish contact to hear a government’s public announcements.</p>'}</div>${recent.length ? `<details class="public-dispatches" ${dispatchesOpen ? 'open' : ''}><summary>Recent public dispatches <span>${recent.length}</span></summary><div>${recent.map(entry => `<article class="public-dispatch" data-public-dispatch="${entry.id}"><time>CYCLE ${entry.turn}</time><div><p>${escape(entry.text)}</p><div class="public-affair-links">${renderPublicDispatchLinks(entry)}</div></div></article>`).join('')}</div><button class="small-button ghost" data-action="report-chronicle">Full chronicle →</button></details>` : ''}<p class="affairs-footnote">Broadcasts report commitments and charted sovereignty. Distant fleets still require local sensors.</p></section>`;
}
