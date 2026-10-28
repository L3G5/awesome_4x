import { FACTIONS, SHIPS } from './content.js';
import { getEngagementPreview } from './combat-preview.js';
import { formatHull } from './hull-format.js';
import { renderShipPortrait } from './ship-ui.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Describes the visible order of formations, without predicting casualties. */
export function renderEngagementPreview(state,fleetId,targetId) {
  const preview=getEngagementPreview(state,fleetId,targetId);
  if(!preview)return '';
  const opponents=preview.opponents;
  if(preview.observed&&!opponents.length&&(!preview.hostileColony||preview.context==='current-system'))return '';
  const selected=preview.selected;
  let html=`<section class="panel-section engagement-preview" data-engagement-system="${escape(preview.systemId)}"><div class="section-label">${preview.observed&&opponents.length?'Engagement plan':'Orbital approach'}</div><div class="engagement-selected">${renderShipPortrait(selected.type,selected.owner)}<div><strong>${escape(selected.name)}</strong><small>${selected.ships} ${selected.ships===1?'ship':'ships'} · ${escape(formatHull(selected.hp,selected.maxHp))} hull</small></div></div><p class="engagement-scope">Only this formation attacks. Nearby friendly fleets do not combine their fire.</p>`;
  if(!preview.observed)html+='<p class="engagement-unknown">Fleet presence unknown. Arrival can trigger combat.</p>';
  else if(opponents.length){
    html+=`<div class="engagement-order-label">Visible opponent order</div><ol class="engagement-order">${opponents.map(fleet=>`<li data-opponent-id="${escape(fleet.id)}"><strong>${escape(fleet.name)}</strong>${fleet.defenseLead?'<span class="defense-badge">Lead defense</span>':''}<span>${escape(FACTIONS[fleet.owner].shortName)} · ${fleet.ships} ${escape(SHIPS[fleet.type].role.toLowerCase())}${fleet.ships===1?'':'s'} · ${escape(formatHull(fleet.hp,fleet.maxHp))} hull</span></li>`).join('')}</ol><p class="engagement-sequence">Each exchange lasts up to four rounds. If your formation survives, it faces the next opponent, even if the previous defender also survives. Destruction ends the attack.</p>`;
  }else html+='<p class="engagement-clear">No hostile fleets are visible in this orbit.</p>';
  if(preview.hostileColony)html+='<p class="engagement-colony">Colony invasion is a separate command after hostile fleets are cleared.</p>';
  html+=`<div class="engagement-cost">${preview.context==='arrival'?'Enter orbit':'Engage'} · 1 order + 1 move</div></section>`;
  return html;
}
