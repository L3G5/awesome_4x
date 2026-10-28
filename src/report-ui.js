import { FACTIONS, SHIPS } from './content.js';
import { renderShipPortrait } from './ship-ui.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount = n => n>0&&Math.round(n*10)===0 ? '&lt;0.1' : Number.isInteger(n) ? n : n.toFixed(1);

export function renderCombatReports(state, reports) {
  const first = reports[0], location = state.systems.find(s => s.id === first.systemId);
  let html = `<div class="eyebrow">CONCORD OPERATIONS · CYCLE ${first.turn}</div><h2 id="modal-title">${first.kind === 'invasion' ? 'The battle for' : 'Engagement at'} ${escape(location.name)}</h2>`;
  if (reports.some(report => report.kind === 'fleet')) html += '<p class="combat-scope">Each engagement pairs one attacking formation with one defending formation. Nearby friendly fleets do not combine their fire. A surviving attacker continues to the next hostile formation; a destroyed attacker ends the sequence.</p>';
  for (const report of reports) {
    html += `<section class="combat-report" data-report-id="${report.id}"><p class="combat-summary">${escape(report.summary)}</p><div class="combat-sides">`;
    for (const participant of report.participants) {
      const lost = participant.shipsBefore - participant.shipsAfter;
      html += `<article class="combat-side" data-owner="${participant.owner}" style="--side-color:${FACTIONS[participant.owner].color}"><div class="eyebrow">${escape(FACTIONS[participant.owner].shortName)} · ${participant.role}</div>${participant.defenseLead?'<span class="defense-badge">Lead defender</span>':''}<div class="combat-fleet-art">${renderShipPortrait(participant.type,participant.owner)}</div><div class="combat-fleet-heading"><div><h3>${escape(participant.name)}</h3><p>${SHIPS[participant.type].role} formation</p></div></div><div class="combat-numbers"><div><strong>${participant.shipsBefore} <span>→</span> ${participant.shipsAfter}</strong><small>Ships remaining</small></div><div><strong class="${lost ? 'loss' : ''}">${lost}</strong><small>Ships lost</small></div></div><div class="combat-hull"><span>Hull ${amount(participant.hullBefore)} → ${amount(participant.hullAfter)}</span><b>${participant.shipsAfter ? 'Survived' : 'Destroyed'}</b></div><div class="progress-track"><i style="width:${participant.hullAfter / participant.hullBefore * 100}%;background:var(--side-color)"></i></div></article>`;
    }
    if (report.invasion) {
      const invasion = report.invasion;
      html += `<article class="combat-side colony-combat" style="--side-color:${FACTIONS[invasion.ownerBefore].color}"><div class="eyebrow">${escape(FACTIONS[invasion.ownerBefore].shortName)} · Planetary defense</div><h3>${escape(state.systems.find(s => s.id === report.systemId).name)}</h3><div class="combat-numbers"><div><strong>${amount(invasion.defenseBefore)} <span>→</span> ${amount(invasion.defenseAfter)}</strong><small>Colony defenses</small></div><div><strong>${amount(invasion.retaliation)}</strong><small>Retaliation damage</small></div></div><p class="capture-outcome">${invasion.captured ? 'Colony captured. A new administration takes control.' : report.outcome === 'repelled' ? 'The invasion was repelled.' : 'Defenses remain. Further bombardment is required.'}</p></article>`;
    }
    html += '</div></section>';
  }
  const survivors = reports.flatMap(report => report.participants).filter((p, i, all) => p.owner === 'player' && all.findIndex(other => other.fleetId === p.fleetId) === i && state.fleets.some(f => f.id === p.fleetId));
  const opponent = reports.flatMap(r => r.participants).find(p => p.owner !== 'player')?.owner || first.invasion?.ownerBefore;
  html += `<div class="modal-actions report-actions"><button data-action="report-inspect" data-system="${first.systemId}">Inspect system</button>${survivors.map(p => `<button data-action="report-select-fleet" data-fleet-target="${p.fleetId}">Select ${escape(p.name)}</button>`).join('')}${opponent && opponent !== 'player' ? `<button data-action="report-diplomacy" data-target="${opponent}">Open diplomacy</button>` : ''}<button class="primary" data-action="close-modal">Return to command →</button></div>`;
  return html;
}

function eventButtons(state, entry) {
  let html = '';
  if (entry.reportId && state.combatReports?.some(report => report.id === entry.reportId)) html += `<button class="small-button" data-action="combat-report" data-report="${entry.reportId}">Battle report →</button>`;
  if (entry.systemId) html += `<button class="small-button ghost" data-action="report-inspect" data-system="${entry.systemId}">Inspect ${escape(state.systems.find(s => s.id === entry.systemId)?.name || 'system')}</button>`;
  if (entry.techId) html += '<button class="small-button ghost" data-action="report-research">Choose research →</button>';
  if (entry.targetId) html += `<button class="small-button ghost" data-action="report-diplomacy" data-target="${entry.targetId}">Open diplomacy →</button>`;
  return html;
}
export function renderBriefing(state) {
  const briefing = state.lastBriefing;
  if (!briefing) return '<h2 id="modal-title">Your first mandate</h2><p class="modal-lead">Complete a cycle to receive a briefing from your colonies and fleet commanders.</p>';
  const categories = [
    ['Threats & diplomacy', entry => ['combat','war','warning','diplomacy','sovereignty','victory','alignment'].includes(entry.type)],
    ['Completed projects', entry => ['construction','research'].includes(entry.type)],
    ['Across the frontier', entry => !['combat','war','warning','diplomacy','sovereignty','victory','alignment','construction','research'].includes(entry.type)],
  ];
  let html = `<div class="eyebrow">THE SPEAKER'S BRIEFING</div><h2 id="modal-title">A new cycle. A changing Reach.</h2><p class="modal-lead">Cycle ${briefing.turn} · ${briefing.entries.length} ${briefing.entries.length === 1 ? 'dispatch' : 'dispatches'} from the latest turn. This report remains available from the top bar.</p>`;
  for (const [label, predicate] of categories) {
    const entries = briefing.entries.filter(predicate);
    if (!entries.length) continue;
    html += `<div class="modal-subhead">${label} <span class="briefing-count">${entries.length}</span></div><div class="briefing-entries">${entries.map(entry => `<article class="briefing-entry ${['combat','war','warning'].includes(entry.type) ? 'urgent' : ''}"><div class="briefing-type">${escape(entry.type)}</div><p>${escape(entry.text)}</p><div class="briefing-event-actions">${eventButtons(state,entry)}</div></article>`).join('')}</div>`;
  }
  if (!briefing.entries.length) html += '<div class="callout">No major events this cycle. Income, population growth, ongoing construction and research have advanced as usual.</div>';
  return html + '<div class="modal-actions"><button data-action="report-chronicle">Full chronicle</button><button class="primary" data-action="close-modal">Continue planning →</button></div>';
}
