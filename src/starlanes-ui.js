import { getKnownStarlanes, getStarlaneOptions } from './starlanes.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const systemOf = (state, id) => state.systems.find(system => system.id === id);

export function renderStarlaneInspector(state, systemId) {
  const lanes = getKnownStarlanes(state).filter(lane => lane.endpoints.includes(systemId));
  if (!lanes.length) return '';
  return `<section class="panel-section starlane-inspector"><div class="section-label">Ancient starlanes</div>${lanes.map(lane => {
    const destination = systemOf(state, lane.endpoints.find(id => id !== systemId));
    const builder = lane.endpoints.map(id => systemOf(state, id)).find(system => system.id === systemId && system.owner === 'player') || lane.endpoints.map(id => systemOf(state, id)).find(system => system.owner === 'player');
    const status = lane.opened ? `Restored in cycle ${lane.openedTurn}` : lane.project ? `Restoration underway at ${systemOf(state, lane.project.systemId).name}` : 'Dormant · Not traversable';
    return `<div class="starlane-summary"><b>⌁ <button class="starlane-destination" data-system-select="${destination.id}">${escape(destination.name)} ↗</button></b><p>${escape(status)}</p>${!lane.opened ? `<p class="empty-note">${builder ? 'Restore a permanent shortcut shared by all empires.' : 'Establish a colony at either endpoint to restore this lane.'}</p>${builder ? `<button class="small-button" data-action="starlane-menu" data-system="${builder.id}">Review restoration →</button>` : ''}` : '<p class="empty-note">Normal movement costs and borders apply. Replot a course to use the new route.</p>'}</div>`;
  }).join('')}</section>`;
}

export function renderStarlaneProjects(state, systemId) {
  const options = getStarlaneOptions(state, systemId);
  if (!options.length) return '<p class="empty-note">Survey a dormant starlane endpoint to discover a restoration project.</p>';
  const player = state.factions.find(faction => faction.id === 'player');
  return `<div class="starlane-projects">${options.map(option => {
    const source = systemOf(state, systemId), destination = systemOf(state, option.destinationId);
    const reason = state.winner ? 'This campaign has ended.' : player.eliminated ? 'This empire is no longer active.' : option.reason;
    const ownedEndpoints = option.endpoints.map(id => systemOf(state, id)).filter(system => system.owner === 'player');
    const builderChoice = ownedEndpoints.length > 1 && !option.project && !option.opened ? `<label class="form-label" for="starlane-builder">Construction colony</label><select id="starlane-builder">${ownedEndpoints.map(system => `<option value="${system.id}" ${system.id === source.id ? 'selected' : ''}>${escape(system.name)}</option>`).join('')}</select>` : '';
    const travel = option.opened ? '<p>This connection is already part of the ordinary starlane network.</p>' : !option.borderOpen ? '<p class="starlane-warning">Destination borders are closed. Restoration does not grant entry.</p>' : option.beforeJumps === null ? '<p>No accessible charted route connects these endpoints today.</p><p>After restoration: one jump between the endpoints.</p>' : `<p class="starlane-travel"><b>${option.beforeJumps} → 1</b><span>Jumps between endpoints</span></p><p>${option.savings} fewer movement orders per crossing.</p>`;
    const progress = option.project ? `<div class="starlane-project-status"><p>Restoration underway at ${escape(systemOf(state, option.project.systemId).name)}</p>${option.project.turns !== undefined ? `<small>${option.project.turns} cycles remaining at current production</small><button class="small-button ghost" data-action="report-inspect" data-system="${option.project.systemId}">Inspect construction →</button>` : '<p>The foreign project’s completion time is not known.</p>'}</div>` : '';
    const cost = !option.opened && !option.project ? `<dl class="starlane-cost"><div><dt>Commission cost</dt><dd>◈ ${option.cost.credits} · ◇ ${option.cost.minerals} · 1 order</dd></div><div><dt>Construction</dt><dd>${option.work} work · ${option.turns} cycles at current production</dd></div></dl>` : '';
    const border = destination.owner && destination.owner !== 'player' && !option.opened ? '<p class="starlane-warning">This creates a direct frontier with another empire. New neighboring claims can increase diplomatic grievances.</p>' : '';
    const action = !option.opened && !option.project ? `<button class="primary" data-action="restore-lane" data-system="${systemId}" data-lane="${option.id}" ${reason ? 'disabled' : ''}>Restore lane · 1 order</button>${reason ? `<p class="build-reason">${escape(reason)}</p>` : ''}` : '';
    const rules = `<details class="starlane-rules"><summary>Construction and movement rules</summary><p>Uses the builder’s construction queue. No infrastructure slot or upkeep.</p><p>Requires Deep-space Logistics. Cancelling returns the unspent share of the paid resources; the order is not refunded.</p><p>Existing plotted courses stay unchanged until you replot. Restoration neither moves fleets nor restores their movement.</p></details>`;
    return `<article class="starlane-project" data-starlane="${option.id}"><div class="eyebrow">STARLANE RESTORATION</div><h3>${escape(source.name)} ↔ ${escape(destination.name)}</h3>${builderChoice}${cost}${progress}${travel}<p class="starlane-shared">The shortcut is permanent and shared. Other empires can use it under normal border rules, including hostile fleets during war.</p>${border}${action}${rules}</article>`;
  }).join('')}</div>`;
}
