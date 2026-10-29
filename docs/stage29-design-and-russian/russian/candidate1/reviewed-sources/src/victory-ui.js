import { FACTIONS } from './content.js';
import { getEmpireStats } from './game.js';
import { getAlignmentStatus, getPublicRaces } from './victory.js';
import { getAlignmentOutlook } from './alignment-outlook.js';
import { alignmentOutlookSummary, renderAlignmentFunding } from './alignment-outlook-ui.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderAlignmentCard(state) {
  const status = getAlignmentStatus(state,'player');
  const outlook = getAlignmentOutlook(state);
  const completed = state.winner === 'player' && state.victoryType === 'Transcendence';
  const unknownFinal = Boolean(state.winner && !state.factions.find(f => f.id === 'player').alignment);
  const description = state.winner
    ? 'This age has ended. Your final network is available to inspect.'
    : `Research the Asterion Protocol and hold three Beacon worlds. Maintain their alignment for ten cycles, paying ${status.cost} credits each advancing cycle.`;
  const label = completed ? 'Transcendence recorded' : state.winner ? 'Final network state' : alignmentOutlookSummary(outlook) || status.reason;
  return `<div class="victory-card alignment-card"><div class="alignment-title"><h3>✦ Transcendence</h3><strong>${unknownFinal ? '—' : status.progress}<small> / ${status.target}</small></strong></div><p>${description}</p>
    ${unknownFinal ? '<p class="alignment-rules">Alignment progress was not recorded in this older save. The saved campaign outcome is preserved.</p>' : `<div class="alignment-segments" aria-label="${status.progress} of ${status.target} alignment cycles">${Array.from({length:status.target},(_,i)=>`<i class="${i<status.progress?'complete':''}"></i>`).join('')}</div>`}
    <p class="alignment-status">${status.beacons} / 3 beacons · ${escape(label)}</p>
    ${!state.winner && (status.beacons > 0 || status.progress > 0) ? renderAlignmentFunding(outlook) : ''}
    ${state.winner ? '' : '<p class="alignment-rules">A hostile warship over a participating beacon, fewer than three owned beacons, or insufficient funds interrupts alignment. Each interrupted cycle loses one step.</p>'}</div>`;
}

export function renderPublicRaces(state) {
  const races = getPublicRaces(state).map(race => ({
    ...race,
    completed: state.winner === race.factionId && state.victoryType === 'Transcendence',
    unknownFinal: Boolean(state.winner && !state.factions.find(f => f.id === race.factionId).alignment),
  })).filter(race => race.beacons > 0 || race.progress > 0);
  if (!races.length) return `<div class="race-empty"><span>✦</span><p>${state.winner ? 'No beacon signals are present among known civilizations.' : 'No beacon signals from known civilizations yet. Restored nodes and alignment progress become public after diplomatic contact.'}</p></div>`;
  const rule = state.winner ? '' : `<p class="race-tie-rule">If civilizations qualify for victory together, higher Legacy wins. Equal Legacy uses a tie-break determined by the galaxy seed. <strong>Your Legacy: ${getEmpireStats(state).score}.</strong> <a href="./guide.html#victory" target="_blank" rel="noopener">Victory rules ↗</a></p>`;
  return `${rule}<div class="public-races">${races.map(race=>`<article class="race-card" data-race="${race.factionId}" style="--race-color:${FACTIONS[race.factionId].color}"><div class="race-heading"><div><div class="eyebrow">${race.factionId==='player'?'YOUR NETWORK':'PUBLIC BEACON SIGNAL'}</div><h3>${escape(race.name || FACTIONS[race.factionId].name)}</h3></div><strong>${race.unknownFinal ? '—' : race.progress}<small> / ${race.target}</small></strong></div>
    ${race.unknownFinal ? '<p class="race-status">Final alignment progress was not recorded in this older save.</p>' : `<div class="progress-track"><i style="width:${race.progress/race.target*100}%;background:var(--race-color)"></i></div>`}
    <p class="race-status">${race.beacons} restored ${race.beacons===1?'beacon':'beacons'} · ${race.completed?'Transcendence recorded':state.winner?'Final recorded signal':race.active?'Alignment advanced last cycle':race.progress?'Alignment interrupted':'Awaiting alignment'}</p><div class="beacon-sites">${race.sites.map(site=>`<button class="small-button ${!race.unknownFinal&&race.participatingSites.includes(site.id)?'participating-beacon':'ghost'}" data-action="inspect" data-system="${site.id}" title="${!race.unknownFinal&&race.participatingSites.includes(site.id)?'Participating in alignment':'Restored beacon'}">✦ ${escape(site.name)} ↗</button>`).join('')}</div></article>`).join('')}</div>`;
}

export function renderBeaconInspector(state,system) {
  const race=getPublicRaces(state).find(r=>r.sites.some(s=>s.id===system.id));
  if(!race)return '';
  const unknownFinal=Boolean(state.winner&&!state.factions.find(f=>f.id===race.factionId).alignment);
  const participating=!unknownFinal&&race.participatingSites.includes(system.id);
  return `<section class="panel-section beacon-inspector"><div class="section-label">Public beacon signal <span>✦</span></div><p>${participating?'This world participates in':'A restored node belonging to'} ${escape(FACTIONS[race.factionId].shortName)}${participating?'’s alignment.':'.'}</p><div class="beacon-count">${unknownFinal?'—':race.progress} <small>/ ${race.target} cycles</small></div><p class="empty-note">${unknownFinal?'Alignment progress was not recorded in this older save.':'Beacon signals reveal the network’s progress. Fleet presence still requires local sensors.'}</p></section>`;
}
