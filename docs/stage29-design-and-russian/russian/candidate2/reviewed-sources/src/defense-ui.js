import { SHIPS } from './content.js';
import { getDefenseOrder } from './combat-preview.js';
import { getDefenseLeadPreview } from './defense.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Call only for an owned or locally observed formation. */
export function renderDefenseBadge(fleet) {
  return fleet.defenseLead===true?'<span class="defense-badge" title="First defensive formation for its government in this system">Lead defense</span>':'';
}

export function renderDefenseControls(state,systemId,selectedFleetId) {
  const formations=getDefenseOrder(state,systemId);
  if(!formations.length)return '';
  const military=formations.filter(fleet=>SHIPS[fleet.type].attack>=4);
  if(!military.length&&formations.length<2)return '';
  const lead=formations.find(fleet=>fleet.defenseLead===true);
  const selected=military.find(fleet=>fleet.id===selectedFleetId);
  let html=`<section class="panel-section defense-controls"><div class="section-label">Defensive lead</div>${lead?`<div class="defense-current"><strong>${escape(lead.name)}</strong><span>Takes your first defensive exchange</span></div>`:'<p class="defense-default">Default formation order</p>'}<p class="formation-order-note">Your formations defend separately in the order listed above. A surviving attacker can still reach later defenders.</p>`;
  if(selected){
    const preview=getDefenseLeadPreview(state,selected.id),option=preview.lead?preview.clear:preview.assign;
    html+=`<button class="wide-button defense-command ${preview.lead?'ghost':''}" data-action="defense-lead-toggle" data-fleet-target="${escape(selected.id)}" aria-pressed="${preview.lead}" ${option.enabled?'':'disabled'}>${preview.lead?'Clear lead':'Lead defense'} · ${option.orders} order</button><p class="defense-command-context">${preview.lead?'Return to the default order.':`${escape(selected.name)} will take your first defensive exchange${lead?`, replacing ${escape(lead.name)}`:''}.`}</p>${option.reason?`<p class="defense-reason">${escape(option.reason)}</p>`:''}`;
  }else if(military.length)html+='<p class="defense-select-note">Select one of your military formations above to assign or clear its lead. Either change costs one order.</p>';
  if(lead)html+='<p class="defense-persistence">Leaving this system clears the assignment. Hold position and local combat preserve it while the formation survives.</p>';
  return html+'</section>';
}
