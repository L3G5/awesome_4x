import { BUILDINGS } from './content.js';
import { CHARTERS, getCharterBonuses } from './development.js';
import { getBuildOptions, getDevelopmentOptions, getInfrastructure, getSystemYield } from './game.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`;
const roman = level => level === 2 ? 'II' : 'I';
const effectLabels = {credits:'credits',minerals:'minerals',science:'science',production:'production',orders:'orders',repair:'orbital repair',militaryDiscount:'military mineral saving'};

export function effectSummary(bonuses, signedValues = true) {
  return Object.entries(effectLabels).filter(([key]) => bonuses?.[key]).map(([key,label]) => `${signedValues ? signed(key==='militaryDiscount'?Math.round(bonuses[key]*100):bonuses[key]) : key==='militaryDiscount'?Math.round(bonuses[key]*100):bonuses[key]}${key==='militaryDiscount'?'%':''} ${label}`).join(' · ');
}

export function charterLabel(system) {
  const charter = system.charter;
  return charter ? `${CHARTERS[charter.type].name} ${roman(charter.level)}` : 'Unchartered';
}

export function renderDevelopmentSummary(state, system) {
  const slots = getInfrastructure(state, system);
  return `<section class="panel-section colony-development"><div class="section-label">Infrastructure <span>${slots.used} / ${slots.capacity} slots</span></div><div class="slot-track" aria-label="${slots.used} of ${slots.capacity} infrastructure slots occupied">${Array.from({length:Math.max(slots.used,slots.capacity)},(_,i)=>`<i class="${i<slots.used?'occupied':''}${i>=slots.capacity?' legacy-slot':''}"></i>`).join('')}</div><div class="building-pills">${system.buildings.map(id=>`<span class="building-pill" title="${escape(BUILDINGS[id].description)}">${BUILDINGS[id].icon} ${escape(BUILDINGS[id].name)}</span>`).join('')||'<p class="empty-note">A new world, waiting to take shape.</p>'}</div><p class="development-hint">${slots.overCapacity?'Existing infrastructure is retained. Replace a building to change this world’s role.':slots.available>0?`${slots.available} open ${slots.available===1?'slot':'slots'}. More population opens slots, up to five.`:'All slots occupied. Replace infrastructure or grow the colony.'}</p><div class="charter-summary"><span class="charter-emblem">${system.charter?CHARTERS[system.charter.type].icon:'⌂'}</span><div><b>${escape(charterLabel(system))}</b><p>${system.charter?'A specialized colonial economy.':'Give this world a lasting specialty.'}</p></div><button class="small-button ghost" data-action="development-menu" data-system="${system.id}">${system.charter?'Manage':'Develop'} →</button></div>${system.charter?`<p class="charter-current-effects">${escape(effectSummary(getCharterBonuses(system)))}</p>`:''}</section>`;
}

export function renderConstructionMenu(state, systemId, tab='building', replaceBuildingId=null) {
  const system = state.systems.find(s=>s.id===systemId), slots = getInfrastructure(state,system), output=getSystemYield(state,system);
  const current = system.charter && CHARTERS[system.charter.type];
  const oldBuilding = replaceBuildingId && BUILDINGS[replaceBuildingId];
  let html = `<div class="eyebrow">COLONIAL COMMISSION · ${escape(system.name)}</div><h2 id="modal-title">Shape this world's future</h2><p class="modal-lead">${slots.used} / ${slots.capacity} infrastructure slots · ${output.production} production per cycle. Each commission costs one order. Payment is made now; the project completes over the following cycles.</p><div class="filter-tabs construction-tabs">${[['building','Infrastructure'],['charter','Colony charter'],['ship','Ships']].map(([kind,label])=>`<button data-action="construction-tab" data-system="${systemId}" data-tab="${kind}" class="${kind===tab?'active':''}" aria-pressed="${kind===tab}">${label}</button>`).join('')}</div>`;
  if (tab==='charter') {
    html += `<div class="charter-intro"><strong>${system.charter?escape(charterLabel(system)):'One world. One specialty.'}</strong><p>A charter uses existing infrastructure and no extra slot. Level I requires population 4 and Deep-space Logistics. Level II requires population 8 and Autonomous Industry. Current benefits continue while a new charter is commissioned.</p></div><div class="build-grid charter-grid">`;
    html += getDevelopmentOptions(state,systemId).map(option=>{
      const charter = CHARTERS[option.charterType], switching=system.charter && system.charter.type!==option.charterType;
      return `<button class="build-card charter-card" data-action="develop" data-system="${systemId}" data-charter="${option.charterType}" ${!option.enabled?'disabled':''}><span class="build-icon">${option.icon}</span><div><span class="charter-tier">${option.completed?'Established':switching?'Switch to':system.charter?.type===option.charterType?'Upgrade to':'Establish'} level ${roman(option.level)}</span><b>${escape(charter.name)}</b><p>${escape(charter.description || '')}</p><p class="charter-effects">${escape(effectSummary(option.bonuses))}</p>${system.charter?`<p class="charter-delta">Change: ${escape(effectSummary(option.delta)||'No change')}</p>`:''}<div class="build-cost">◈ ${option.cost.credits} &nbsp; ◇ ${option.cost.minerals} · ${option.turns} cycles · 1 order</div><p class="charter-support">Requires ${escape(BUILDINGS[charter.support].name)}</p>${option.reason && option.reason!==`Requires ${BUILDINGS[charter.support].name}`?`<p class="build-reason">${escape(option.reason)}</p>`:''}${switching?`<p class="build-reason">Replaces ${escape(charterLabel(system))} on completion. Its investment is not refunded.</p>`:''}</div></button>`;
    }).join('');
    return html+'</div>';
  }
  if (tab==='building') {
    html += `<div class="replacement-control"><label for="replace-building">${slots.available>0?'Use an open slot, or replace existing infrastructure':'Choose infrastructure to replace'}</label><select id="replace-building" data-system="${systemId}"><option value="">${slots.available>0?'Use an open slot':'Select a building to replace…'}</option>${system.buildings.map(id=>`<option value="${id}" ${id===replaceBuildingId?'selected':''}>Replace ${escape(BUILDINGS[id].name)}</option>`).join('')}</select></div>`;
    if(oldBuilding) html += `<div class="callout replacement-warning"><strong>${escape(oldBuilding.name)} remains active until the new building is finished.</strong> Its benefits are then removed.${current?.support===replaceBuildingId?` This also removes the ${escape(charterLabel(system))} charter.`:''}${replaceBuildingId==='beacon'?' Removing this beacon may interrupt your alignment.':''} Cancelling construction keeps the existing infrastructure.</div>`;
  } else html += `<p class="empty-note construction-note">Ships need an Orbital Shipyard and do not occupy infrastructure slots. Forge charter discounts are included in the prices below.</p>`;
  html += '<div class="build-grid">'+getBuildOptions(state,systemId,'player',tab==='building'?replaceBuildingId:null).filter(o=>o.kind===tab).map(o=>`<button class="build-card" data-action="build" data-system="${systemId}" data-item="${o.id}" ${tab==='building'&&replaceBuildingId?`data-replace="${replaceBuildingId}"`:''} ${!o.enabled?'disabled':''} title="${escape(o.reason||o.description)}"><span class="build-icon">${o.icon}</span><div><b>${escape(o.name)}</b><p>${escape(o.description)}</p><div class="build-cost">◈ ${o.cost.credits} &nbsp; ◇ ${o.cost.minerals} · ${o.turns} cycles${tab==='ship'?` · ${o.upkeep} upkeep`:''}</div>${o.reason?`<p class="build-reason">${escape(o.reason)}</p>`:''}</div></button>`).join('')+'</div>';
  return html;
}
