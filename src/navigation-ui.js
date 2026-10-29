import { getRoutePreview, getRouteStatus } from './navigation.js';
import { renderRoutePublicCause } from './public-affairs-ui.js';
import { getFleetReadiness } from './game.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural=(count,word)=>`${count} ${word}${count===1?'':'s'}`;

export function getNavigationView(state,fleet,target) {
  const stored=fleet.route?getRouteStatus(state,fleet.id):null;
  const preview=target.id!==fleet.systemId?getRoutePreview(state,fleet.id,target.id):null;
  const proposing=preview?.ok && preview.path.length>2 && target.id!==stored?.destinationId;
  return {stored,preview,proposing,display:proposing?preview:stored};
}

export function renderRouteStrip(state,fleet,navigation) {
  const {stored,preview,proposing,display}=navigation;
  if(!display)return '';
  const location=id=>state.systems.find(s=>s.id===id);
  const destination=location(display.destinationId);
  const held=getFleetReadiness(state,fleet.id).held;
  const canContinue=stored?.ok && stored.maxJumpsNow>0;
  let actions=proposing?`<button class="primary" data-action="plan-route" data-destination="${preview.destinationId}">Plot course · free</button>`:`<button class="primary" data-action="continue-route" ${canContinue?'':'disabled'} title="${escape(stored.reason)}">${held?'Resume course':'Continue'} · up to ${plural(stored.maxJumpsNow,'jump')}</button>`;
  if(stored)actions+=`<button class="small-button ghost" data-action="fit-route" title="Fit the planned course on the map">⌖</button><button class="small-button ghost" data-action="replot-route" title="Recalculate a route through currently open borders">Replot</button><button class="small-button ghost" data-action="clear-route" title="Clear this fleet’s plotted route" aria-label="Clear plotted route">×</button>`;
  const uncertainty=display.uncertainSystems.length?`Opposition unknown at ${plural(display.uncertainSystems.length,'stop')}.`:'';
  const currentCost=proposing?`Planning spends no orders.${held?' A new course resumes this fleet.':''}`:canContinue?`${held?'Continuing resumes this held fleet. ':''}Up to ${plural(stored.maxOrdersNow,'order')} now; stops for new contacts, discoveries or combat.`:stored.reason;
  const blocked=display.stopBefore?`Stops before ${location(display.stopBefore.systemId)?.name || 'a blocked system'}: ${display.stopBefore.reason}`:'';
  return `<div class="route-strip ${proposing?'route-proposal':'route-committed'}"><div class="route-heading"><div><span class="eyebrow">${proposing?'COURSE PREVIEW':'PLANNED COURSE'}</span><strong>${escape(destination?.name || display.destinationId)} <small>· ${plural(display.jumps,'jump')} · ${plural(display.totalOrders,'order')} total</small></strong></div><div class="route-actions">${actions}</div></div><div class="route-itinerary" aria-label="${proposing?'Proposed':'Planned'} route">${display.path.map((id,index)=>`${index?'<span class="route-arrow" aria-hidden="true">›</span>':''}<button class="route-stop" data-system-select="${id}" title="Inspect ${escape(location(id)?.name || id)}"><span>${index===0?'●':index}</span>${escape(location(id)?.name || id)}</button>`).join('')}</div><p class="route-explanation"><span>${escape(currentCost)}</span>${uncertainty?` <span>${escape(uncertainty)}</span>`:''}</p>${blocked?`<p class="route-blockage">${escape(blocked)}</p>`:''}${renderRoutePublicCause(state,fleet,display)}</div>`;
}
