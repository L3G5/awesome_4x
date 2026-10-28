import { FACTIONS } from './content.js';
import { getAlignmentStatus, getPublicRaces } from './victory.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderAlignmentCard(state) {
  const status = getAlignmentStatus(state,'player');
  const completed=state.winner==='player' && state.victoryType==='Transcendence';
  if(completed)status.progress=status.target;
  return `<div class="victory-card alignment-card"><div class="alignment-title"><h3>✦ Transcendence</h3><strong>${status.progress}<small> / ${status.target}</small></strong></div><p>Research the Asterion Protocol and hold three Beacon worlds. Maintain their alignment for ten cycles, paying ${status.cost} credits each advancing cycle.</p><div class="alignment-segments" aria-label="${status.progress} of ${status.target} alignment cycles">${Array.from({length:status.target},(_,i)=>`<i class="${i<status.progress?'complete':''}"></i>`).join('')}</div><p class="alignment-status">${status.beacons} / 3 beacons · ${escape(completed?'Transcendence achieved':status.ready?'Alignment requirements met now':status.reason)}</p><p class="alignment-rules">A hostile warship over a participating beacon, fewer than three owned beacons, or insufficient funds interrupts alignment. Each interrupted cycle loses one step.</p></div>`;
}

export function renderPublicRaces(state) {
  const races = getPublicRaces(state).map(r=>state.winner===r.factionId && state.victoryType==='Transcendence'?{...r,progress:r.target,completed:true}:r).filter(r=>r.beacons>0 || r.progress>0);
  if(!races.length) return '<div class="race-empty"><span>✦</span><p>No beacon signals from known civilizations yet. Restored nodes and alignment progress become public after diplomatic contact.</p></div>';
  return `<div class="public-races">${races.map(race=>`<article class="race-card" data-race="${race.factionId}" style="--race-color:${FACTIONS[race.factionId].color}"><div class="race-heading"><div><div class="eyebrow">${race.factionId==='player'?'YOUR NETWORK':'PUBLIC BEACON SIGNAL'}</div><h3>${escape(race.name || FACTIONS[race.factionId].name)}</h3></div><strong>${race.progress}<small> / ${race.target}</small></strong></div><div class="progress-track"><i style="width:${race.progress/race.target*100}%;background:var(--race-color)"></i></div><p class="race-status">${race.beacons} restored ${race.beacons===1?'beacon':'beacons'} · ${race.completed?'Transcendence achieved':race.active?'Alignment advanced last cycle':race.progress?'Alignment interrupted':'Awaiting alignment'}</p><div class="beacon-sites">${race.sites.map(site=>`<button class="small-button ${race.participatingSites.includes(site.id)?'participating-beacon':'ghost'}" data-action="inspect" data-system="${site.id}" title="${race.participatingSites.includes(site.id)?'Participating in alignment':'Restored beacon'}">✦ ${escape(site.name)} ↗</button>`).join('')}</div></article>`).join('')}</div>`;
}

export function renderBeaconInspector(state,system) {
  const race=getPublicRaces(state).find(r=>r.sites.some(s=>s.id===system.id));
  if(!race)return '';
  const participating=race.participatingSites.includes(system.id);
  return `<section class="panel-section beacon-inspector"><div class="section-label">Public beacon signal <span>✦</span></div><p>${participating?'This world participates in':'A restored node belonging to'} ${escape(FACTIONS[race.factionId].shortName)}${participating?'’s alignment.':'.'}</p><div class="beacon-count">${race.progress} <small>/ ${race.target} cycles</small></div><p class="empty-note">Beacon signals reveal the network’s progress. Fleet presence still requires local sensors.</p></section>`;
}
