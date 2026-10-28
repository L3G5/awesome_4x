import { BUILDINGS, FACTIONS } from './content.js';
import { getDiscoveryView, getDiscoveryOptions } from './discoveries.js';
import { getInfrastructure } from './game.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={observatory:'✧',reef:'◇'};
const resourceText=cost=>Object.entries(cost||{}).filter(([,amount])=>amount>0).map(([key,amount])=>`${key==='credits'?'◈':key==='minerals'?'◇':key==='science'?'✧':''} ${amount} ${key}`).join(' · ');

export function renderDiscoverySummary(state,system) {
  const view=getDiscoveryView(state,system.id);
  if(!view)return '';
  const unresolved=!['resolved','unknown'].includes(view.phase);
  let html=`<section class="panel-section discovery-summary" data-discovery="${view.id}"><div class="section-label">${view.site?'Ancient site':unresolved?'Unusual signal':'Expedition record'} <span>${symbols[view.id]||'✦'}</span></div><h3>${escape(view.name)}</h3>`;
  if(view.stale && !view.legacyOutcome)html+=`<p class="discovery-memory">${view.observedTurn===null?'Earlier charts contain no detailed expedition record.':`Last observed in cycle ${view.observedTurn}.`} Send an expedition for an updated report.</p>`;
  if(view.phase==='maturing')html+=`<div class="discovery-progress"><span>${view.progress} / ${view.target} qualifying cycles</span><div class="progress-track"><i style="width:${view.progress/view.target*100}%"></i></div></div><p class="discovery-continuation">${escape(view.continuation)}</p>`;
  if(view.phase==='ready')html+='<p class="discovery-ready">The work is complete. A final choice awaits.</p>';
  if(view.site)html+=`<p class="discovery-site-label">${escape(view.site.name)} · ${view.site.state==='active'?'Restored':view.site.state==='building'?'Under construction':'Restoration available'}</p>`;
  if(view.history.length)html+=`<p class="discovery-history-teaser">${escape(view.history.at(-1).choiceLabel)} · cycle ${view.history.at(-1).turn}</p>`;
  else if(view.legacyOutcome)html+='<p class="discovery-memory">Earlier expedition; detailed outcome was not recorded.</p>';
  html+=`<button class="wide-button" data-action="anomaly" data-system="${system.id}">${unresolved&&view.canInteract&&view.phase!=='maturing'?'Investigate discovery · 1 order':'Read expedition record'} →</button>`;
  if(view.site?.state==='planned' && system.owner==='player' && !system.queue)html+=`<button class="wide-button ghost" data-action="build-menu" data-system="${system.id}">Commission restoration →</button>`;
  return html+'</section>';
}

function renderHistory(view) {
  let html='<div class="modal-subhead">The story of this world</div>';
  if(!view.history.length)return html+`<p class="empty-note">${view.legacyOutcome?'Earlier expedition; detailed outcome was not recorded.':'Your expedition has yet to leave its mark here.'}</p>`;
  return html+`<div class="discovery-history">${view.history.map(entry=>`<article class="discovery-history-entry"><div class="discovery-history-meta">CYCLE ${entry.turn} · ${escape(FACTIONS[entry.factionId]?.shortName || entry.factionId)}</div><h3>${escape(entry.choiceLabel)}</h3><p>${escape(entry.outcomeText)}</p></article>`).join('')}</div>`;
}

export function renderDiscoveryDialog(state,systemId,replaceBuildingId=null) {
  const system=state.systems.find(s=>s.id===systemId),view=getDiscoveryView(state,systemId);
  if(!view)return '<h2 id="modal-title">An uncharted story</h2><p class="modal-lead">Survey this world to learn what remains here.</p>';
  const options=view.canInteract?getDiscoveryOptions(state,systemId,'player',replaceBuildingId):[];
  let html=`<div class="eyebrow">FIELD EXPEDITION · ${escape(system.name)}</div><div class="discovery-title"><span>${symbols[view.id]||'✦'}</span><h2 id="modal-title">${escape(view.name)}</h2></div><p class="modal-lead">${escape(view.description)}</p>`;
  if(view.stale && !view.legacyOutcome)html+=`<div class="callout">${view.observedTurn===null?'Earlier charts contain no detailed expedition record.':`Last observed in cycle ${view.observedTurn}.`} This record retains what your expedition learned. Return to the system to observe its current state.</div>`;
  if(view.phase==='maturing')html+=`<div class="discovery-maturation"><div><span class="eyebrow">RESTORATION IN PROGRESS</span><strong>${view.progress}<small> / ${view.target} cycles</small></strong></div><p>${escape(view.continuation)}</p><div class="progress-track"><i style="width:${view.progress/view.target*100}%"></i></div></div>`;
  if(view.site)html+=`<div class="discovery-site-card"><span>${BUILDINGS[view.site.id]?.icon||'✦'}</span><div><h3>${escape(view.site.name)}</h3><p>${escape(BUILDINGS[view.site.id]?.description||'A restored legacy of this world.')}</p><small>${view.site.state==='active'?'Restoration complete':view.site.state==='building'?'Construction in progress':'The restoration plan remains with this world'}</small></div></div>`;
  if(options.some(option=>option.kind==='restore')) {
    const slots=getInfrastructure(state,system);
    html+=`<div class="replacement-control"><label for="discovery-replacement">Restored sites use one infrastructure slot (${slots.used}/${slots.capacity} occupied)</label><select id="discovery-replacement" data-system="${systemId}"><option value="">${slots.available?'Use an open slot':'Choose infrastructure to replace…'}</option>${system.buildings.map(id=>`<option value="${id}" ${replaceBuildingId===id?'selected':''}>Replace ${escape(BUILDINGS[id].name)}</option>`).join('')}</select></div>`;
    if(replaceBuildingId)html+=`<div class="callout replacement-warning">${escape(BUILDINGS[replaceBuildingId].name)} continues working until restoration is complete, then is removed. Any charter it supports is also removed.</div>`;
  }
  html+=options.map(option=>`<button class="choice-card discovery-choice" data-action="anomaly-choice" data-system="${systemId}" data-choice="${option.id}" ${replaceBuildingId&&option.kind==='restore'?`data-replace="${replaceBuildingId}"`:''} ${option.enabled?'':'disabled'}><b>${escape(option.label)} →</b><p>${escape(option.description)}</p>${option.continuation?`<p class="discovery-choice-future">${escape(option.continuation)}</p>`:''}<div class="discovery-choice-cost">${resourceText(option.cost)?`${escape(resourceText(option.cost))} · `:''}1 order${option.work?` · ${option.work} work · ${option.turns} cycles`:''}</div>${option.reason?`<p class="build-reason">${escape(option.reason)}</p>`:''}</button>`).join('');
  if(!view.canInteract && !view.stale && !['resolved','maturing'].includes(view.phase))html+=`<p class="empty-note">${system.owner&&system.owner!=='player'?'Only this world’s sovereign can make a choice.':'An expedition must be present, or this world must belong to you, to make a choice.'}</p>`;
  if(options.length)html+='<p class="empty-note discovery-permanence">Each choice leaves a permanent record. Restorations use ordinary construction; cancelling keeps the plan but never reopens the salvage choice.</p>';
  return html+renderHistory(view);
}
