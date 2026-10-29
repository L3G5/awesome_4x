import { FACTIONS } from './content.js';
import { getDiplomacyForecast, getActiveDiplomacyOffers } from './diplomacy.js';
import { renderPublicAffairs } from './public-affairs-ui.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function proposalButton(forecast, stance, targetId, label, specialAction = null) {
  const option = forecast.actions[stance];
  return `<button ${stance === 'war' ? 'class="danger"' : ''} data-action="${specialAction || 'diplomacy'}" data-stance="${stance}" data-target="${targetId}" ${option.enabled ? '' : 'disabled'} title="${escape(option.enabled ? option.effect : option.reason)}">${label}</button>`;
}

export function renderDiplomacyPage(state, options = {}) {
  const player = state.factions.find(f => f.id === 'player');
  let html = `<div class="page-top"><div><div class="eyebrow">THE INTERSTELLAR ASSEMBLY</div><h2>Voices in the void</h2><p>Rivals have ambitions of their own. Trade opens borders only by agreement; frontier claims create tension, and peace binds both empires.</p></div><div class="page-symbol">⛨</div></div>`;
  const incoming = getActiveDiplomacyOffers(state).filter(offer => offer.to === 'player');
  for (const offer of incoming) html += offer.kind==='trade'
    ? `<div class="callout peace-offer trade-offer"><div><div class="eyebrow">TRADE PROPOSAL · EXPIRES CYCLE ${offer.expiresTurn}</div><h3>${escape(FACTIONS[offer.from].name)} requests open borders</h3><p>They fund the ${offer.credits}-credit treaty fee. Accept for one order to open both borders and begin trade income; your treasury pays no signing fee. Borders stay closed while you decide.</p></div><button class="primary" data-action="review-trade" data-offer="${offer.id}">Review terms →</button></div>`
    : `<div class="callout peace-offer"><div><div class="eyebrow">PEACE PROPOSAL · EXPIRES CYCLE ${offer.expiresTurn}</div><h3>${escape(FACTIONS[offer.from].name)} offers a settlement</h3><p>Receive ${offer.credits} credits and agree to a ${offer.truceTurns}-cycle mutual truce. Fleets inside each other's territory return to their nearest colony when accepted.</p></div><button class="primary" data-action="review-peace" data-offer="${offer.id}">Review terms →</button></div>`;
  html += renderPublicAffairs(state, options);
  for (const faction of state.factions.filter(f => f.id !== 'player')) {
    const contact = player.contacts.includes(faction.id), relation = player.relations[faction.id];
    const forecast = contact ? getDiplomacyForecast(state, 'player', faction.id) : null;
    const status = !contact ? 'No contact' : faction.eliminated ? 'Fallen' : forecast.truceRemaining > 0 ? `Truce · ${forecast.truceRemaining} cycles` : forecast.tradeEndingIn > 0 ? `Trade ending · ${forecast.tradeEndingIn}` : relation.trade ? 'Trade partner' : relation.status;
    html += `<article class="rival-card" data-rival="${faction.id}" style="--faction:${contact?FACTIONS[faction.id].color:'#788898'}"><div class="rival-seal">${contact?{ veyr:'◈', khar:'⛨', choir:'✧' }[faction.id]:'?'}</div><div><div class="eyebrow bilateral-label">RELATIONS WITH THE CONCORD</div><h3>${contact ? escape(faction.name) : 'Unidentified civilization'}<span class="relation-tag ${relation.status === 'war' && contact ? 'war' : ''}">${status}</span></h3><div class="leader">${contact ? escape(faction.leader) : 'A signal beyond our charted stars'}</div><p>${contact ? `${escape(faction.description)}<br><em>“${escape(faction.motto)}”</em>` : 'Explore connected systems to establish first contact. Our envoys cannot negotiate with a civilization we have not encountered.'}</p>`;
    if (contact) html += `<button class="small-button ghost dossier-button" data-action="rival-dossier" data-target="${faction.id}" aria-controls="inspector" aria-label="View ${escape(faction.name)} civilization dossier" aria-pressed="${options.selectedRivalId===faction.id}">Civilization dossier ↗</button>`;
    if (contact && !faction.eliminated) {
      html += `<div class="diplomatic-stats"><span>Trust <b>${relation.trust}</b></span><span>Our grievance <b>${forecast.ourGrievance}</b></span><span>Their grievance <b>${forecast.theirGrievance}</b></span><span>Shared borders <b>${forecast.borderCount}</b></span></div><p class="empty-note">${relation.trade ? `Trade income +${player.techs.includes('diplomacy') ? 10 : 6} credits / cycle · Open borders` : relation.status === 'war' ? 'Military access · Hostile fleets engage on arrival' : 'Closed borders'} · Proposals use 1 order</p>`;
      if (forecast.tradeEndingIn > 0) html += `<div class="diplomatic-notice">Trade and border access end on cycle ${forecast.tradeEndsAt}. Foreign fleets will withdraw from each other's territory.</div>`;
      if (forecast.truceRemaining > 0) html += `<div class="diplomatic-notice">Neither empire can declare war before cycle ${forecast.truceUntil}. The signed settlement binds both sides.</div>`;
      if (forecast.alignmentWarning) html += `<p class="diplomatic-policy alignment-competition">${escape(forecast.alignmentWarning)}</p>`;
      if (forecast.warCause) html += `<p class="diplomatic-policy alignment-war-cause">${escape(forecast.warCause)}</p>`;
      if (relation.status === 'war') html += `<p class="diplomatic-willingness">${escape(forecast.incomingOffer?`Their funded offer remains open until cycle ${forecast.incomingOffer.expiresTurn}. Receive ${forecast.incomingOffer.credits} credits on acceptance.`:forecast.actions.peace.reason || forecast.actions.peace.willingness?.reason || '')}</p>`;
      html += '<div class="rival-actions">';
      if (relation.status === 'war') {
        if (forecast.incomingOffer) html += `<button data-action="review-peace" data-offer="${forecast.incomingOffer.id}">Review their peace offer</button>`;
        else html += proposalButton(forecast, 'peace', faction.id, 'Propose peace ◈60', 'peace-confirmation');
      } else {
        if (forecast.incomingTradeOffer) html += `<button data-action="review-trade" data-offer="${forecast.incomingTradeOffer.id}">Review their trade offer</button>`;
        else if (!relation.trade) html += proposalButton(forecast, 'trade', faction.id, 'Trade treaty ◈30');
        else html += proposalButton(forecast, 'endTrade', faction.id, 'End trade', 'end-trade-confirmation');
        html += proposalButton(forecast, 'gift', faction.id, 'Send gift ◈35');
        html += proposalButton(forecast, 'war', faction.id, 'Declare war', 'declare-war');
      }
      html += '</div>';
      if (forecast.policy) html += `<p class="diplomatic-policy">${escape(forecast.policy)}</p>`;
    }
    html += '</div></article>';
  }
  return html;
}
