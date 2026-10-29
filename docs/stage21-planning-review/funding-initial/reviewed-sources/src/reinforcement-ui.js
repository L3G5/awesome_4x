import { SHIPS } from './content.js';
import { formatHull } from './hull-format.js';
import { getMergeOptions, getMergePreview, getReinforcementPreview } from './reinforcement.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const ships = count => `${count} ${count === 1 ? 'ship' : 'ships'}`;
const jumps = count => `${count} ${count === 1 ? 'jump' : 'jumps'}`;
const hull = formation => escape(formatHull(formation.hp, formation.maxHp, 2));

function mergeNotes(preview) {
  const { selected, partner, result, discarded } = preview;
  if (!result) return '';
  const identity = `${escape(selected.name)} keeps its name${result.route ? ' and plotted course' : ''}; ${result.hold ? 'it remains on Hold' : 'it stays off Hold'}.`;
  const details = ['Remaining movement is the lower of the two allowances.'];
  if (!result.route) details.push('No course will be plotted.');
  if (discarded.route) details.push(`${escape(partner.name)}’s course is discarded.`);
  if (discarded.hold && !result.hold) details.push('The absorbed formation’s Hold does not transfer.');
  if (result.defenseLead) details.push(selected.defenseLead ? 'The defensive lead is retained.' : 'The defensive lead transfers to the combined fleet.');
  if (result.heritage.length) details.push(`${result.heritage.length} expedition ${result.heritage.length === 1 ? 'record is' : 'records are'} retained, with no new discovery rewards.`);
  return `<p class="merge-identity">${identity}</p><p class="merge-note">${details.join(' ')}</p>`;
}

/** One ordinary ship commission, independent of the selected formation. */
export function renderReinforcementPanel(state, fleetId, inspectedSystemId) {
  const preview = getReinforcementPreview(state, fleetId);
  if (!preview || preview.systemId !== inspectedSystemId) return '';
  const cycles = `${preview.cyclesAtCurrentRate} ${preview.cyclesAtCurrentRate === 1 ? 'cycle' : 'cycles'}`;
  return `<section class="panel-section reinforcement-panel" tabindex="-1" aria-label="Shipyard commission at ${escape(preview.systemName)}">
    <div class="section-label">Shipyard commission <span>1 new ship</span></div>
    <div class="reinforcement-class"><span aria-hidden="true">${SHIPS[preview.itemId].icon}</span><strong>${escape(preview.name)}</strong></div>
    <p class="reinforcement-quote">${preview.cost.credits} credits · ${preview.cost.minerals} minerals · ${preview.orderCost} order</p>
    <p class="reinforcement-timing">${cycles} at current production · ${preview.upkeep} credits upkeep / cycle after completion</p>
    <button class="wide-button reinforcement-command" data-action="reinforce" data-fleet-target="${escape(preview.fleetId)}" ${preview.enabled ? '' : 'disabled'}>Commission ${escape(preview.name)}</button>
    ${preview.reason ? `<p class="reinforcement-reason">${escape(preview.reason)}</p>` : ''}
    <p class="reinforcement-note">Completes as a separate formation here. You choose whether to merge it later.</p>
  </section>`;
}

/** Keep the existing direct merge when only one structurally legal partner exists. */
export function renderMergeControls(state, fleetId) {
  const options = getMergeOptions(state, fleetId);
  if (!options?.length || options[0].selected.type === 'colony') return '';
  const compatible = options.filter(option => option.structurallyLegal);
  if (compatible.length === 1) {
    const preview = compatible[0];
    const title = `${preview.partner.name} joins ${preview.selected.name}: ${ships(preview.result.ships)}, ${formatHull(preview.result.hp, preview.result.maxHp, 2)} hull, ${jumps(preview.result.movesLeft)} remaining. ${preview.orderCost} order.${preview.reason ? ` ${preview.reason}` : ''}`;
    return `<button data-action="merge" data-fleet-target="${escape(fleetId)}" data-target="${escape(preview.targetFleetId)}" title="${escape(title)}" aria-label="Merge ${escape(preview.partner.name)} into ${escape(preview.selected.name)}; ${preview.orderCost} order" ${preview.enabled ? '' : 'disabled'}>Merge +${preview.partner.ships}</button>`;
  }
  if (compatible.length > 1) return `<button data-action="merge-menu" data-fleet-target="${escape(fleetId)}" title="Choose one of ${compatible.length} compatible formations to merge; 1 order">Merge fleets…</button>`;
  return `<button data-action="merge-menu" data-fleet-target="${escape(fleetId)}" disabled title="${escape(options[0].structuralReason)}">Merge unavailable</button>`;
}

/** Visible explanation beside the orbit list, without another paid action. */
export function renderMergeSummary(state, fleetId, inspectedSystemId) {
  const options = getMergeOptions(state, fleetId);
  if (!options?.length || options[0].systemId !== inspectedSystemId || options[0].selected.type === 'colony') return '';
  const compatible = options.filter(option => option.structurallyLegal);
  const heading = '<div class="section-label">Combine formations <span>1 order</span></div>';
  if (!compatible.length) return `<section class="panel-section merge-summary">${heading}<p class="merge-reason">${escape(options[0].structuralReason)}</p></section>`;
  if (compatible.length > 1) return `<section class="panel-section merge-summary">${heading}<p>${compatible.length} compatible formations can join <strong>${escape(options[0].selected.name)}</strong>. Use <b>Merge fleets</b> to choose one.</p><p class="merge-note">The selected fleet survives. Combined hull is preserved; remaining movement uses the lower allowance.</p></section>`;
  const preview = compatible[0], result = preview.result;
  return `<section class="panel-section merge-summary">${heading}
    <p><strong>${escape(preview.partner.name)}</strong> joins <strong>${escape(preview.selected.name)}</strong>.</p>
    <div class="merge-summary-outcome"><b>${ships(result.ships)}</b><span>${hull(result)} hull</span><span>${jumps(result.movesLeft)} remaining</span></div>
    ${mergeNotes(preview)}${preview.reason ? `<p class="merge-reason">${escape(preview.reason)}</p>` : ''}
  </section>`;
}

function formationCard(formation, label) {
  return `<article class="merge-formation"><div class="eyebrow">${label}</div><h3>${escape(formation.name)}</h3><p>${ships(formation.ships)} · ${hull(formation)} hull</p><p>${jumps(formation.movesLeft)} remaining${formation.hold ? ' · Holding position' : ''}</p>${formation.defenseLead ? '<small>Defensive lead</small>' : ''}</article>`;
}

/** The selector only chooses an existing ordinary merge command. */
export function renderMergeDialog(state, fleetId, targetId = null) {
  const options = getMergeOptions(state, fleetId);
  if (!options?.length || options[0].selected.type === 'colony') return '<h2 id="modal-title">No compatible formation</h2><p class="modal-lead">Select two of your same-class formations in one system. Colony Arks operate independently.</p><div class="modal-actions"><button class="primary" data-action="close-modal">Return to the fleet</button></div>';
  const chosen = options.find(option => option.targetFleetId === targetId)
    || options.find(option => option.structurallyLegal) || options[0];
  const preview = getMergePreview(state, fleetId, chosen.targetFleetId);
  const result = preview.result;
  const choices = options.map(option => `<option value="${escape(option.targetFleetId)}" ${option.targetFleetId === chosen.targetFleetId ? 'selected' : ''} ${option.structurallyLegal ? '' : 'disabled'}>${escape(option.partner.name)} · ${ships(option.partner.ships)} · ${hull(option.partner)} hull${option.structurallyLegal ? '' : ` · ${escape(option.structuralReason)}`}</option>`).join('');
  return `<div class="eyebrow">CONCORD FLEET COMMAND</div><h2 id="modal-title">Combine formations</h2>
    <p class="modal-lead">Choose which formation joins <strong>${escape(preview.selected.name)}</strong>. The selected fleet survives; merging does not repair damage.</p>
    <label class="form-label" for="merge-partner">Formation to absorb</label>
    <select id="merge-partner" data-fleet-target="${escape(fleetId)}">${choices}</select>
    <div class="merge-inputs">${formationCard(preview.selected, 'Selected · survives')}${formationCard(preview.partner, 'Joins selected fleet')}</div>
    ${result ? `<section class="merge-result" aria-label="Combined formation preview"><div class="eyebrow">Combined formation</div><h3>${escape(result.name)}</h3><dl><div><dt>Ships</dt><dd>${result.ships} / 12</dd></div><div><dt>Hull</dt><dd>${hull(result)}</dd></div><div><dt>Movement remaining</dt><dd>${jumps(result.movesLeft)}</dd></div></dl>${mergeNotes(preview)}<p class="merge-note">Upkeep is unchanged. Combining formations grants no extra passive repair.</p></section>` : ''}
    ${preview.reason ? `<p class="merge-reason">${escape(preview.reason)}</p>` : ''}
    <div class="modal-actions"><button data-action="close-modal">Keep separate</button><button class="primary" data-action="merge-confirm" data-fleet-target="${escape(fleetId)}" data-target="${escape(preview.targetFleetId)}" ${preview.enabled ? '' : 'disabled'}>Merge ${ships(preview.partner.ships)} · ${preview.orderCost} order</button></div>`;
}
