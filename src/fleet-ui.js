import { SHIPS } from './content.js';
import { getSplitPreview, getColonyRepairForecast, getFleetReadiness } from './game.js';
import { renderShipPortrait } from './ship-ui.js';
import { formatHull } from './hull-format.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const hull = value => Number(value.toFixed(2)).toLocaleString();

export function renderFleetReadiness(state, fleet) {
  const readiness = getFleetReadiness(state, fleet.id);
  const status = readiness.held ? 'Holding' : readiness.ready ? 'Ready' : state.winner ? 'Ended' : readiness.movesLeft < 1 ? 'Spent' : 'No orders';
  return `<span class="fleet-ready fleet-attention${readiness.held ? ' is-held' : ''}" title="${escape(readiness.reason)}"><b>${status}</b><small>${readiness.movesLeft} ${readiness.movesLeft === 1 ? 'jump' : 'jumps'}</small></span>`;
}

export function renderSplitDialog(state, fleetId, ships = 1) {
  const fleet = state.fleets.find(candidate => candidate.id === fleetId && candidate.owner === 'player');
  if (!fleet) return '<h2 id="modal-title">Fleet unavailable</h2><p class="modal-lead">Select one of your active fleets to reorganize it.</p>';
  const preview = getSplitPreview(state, fleetId, ships);
  const location = state.systems.find(system => system.id === fleet.systemId);
  const formation = (label, part, original) => part ? `<article class="split-formation"><div class="eyebrow">${label}</div><strong>${part.ships}<small>${part.ships === 1 ? 'ship' : 'ships'}</small></strong><p>${escape(formatHull(part.hp, part.ships * SHIPS[fleet.type].hp, 2))} hull</p><p>${part.movesLeft} ${part.movesLeft === 1 ? 'jump' : 'jumps'} remaining</p><small>${original && preview.originalHasRoute ? 'Keeps its plotted course' : 'No course plotted'}</small></article>` : '';
  return `<div class="eyebrow">CONCORD FLEET COMMAND · ${escape(location.name)}</div><h2 id="modal-title">Divide ${escape(fleet.name)}</h2><div class="split-introduction">${renderShipPortrait(fleet.type, fleet.owner, Boolean(fleet.heritage?.length))}<p>Leave a garrison or send a separate expedition. The two formations keep the same total ships and hull, and each retains its remaining movement.</p></div><label class="form-label" for="split-ships">Ships to detach from this ${fleet.ships}-ship formation</label><select id="split-ships" data-fleet-target="${fleetId}">${Array.from({ length: Math.max(0, fleet.ships - 1) }, (_, index) => index + 1).map(count => `<option value="${count}" ${count === ships ? 'selected' : ''}>${count} ${count === 1 ? 'ship' : 'ships'}</option>`).join('')}</select><div class="split-preview">${formation('Original formation', preview.parent, true)}${formation('Detached formation', preview.detached, false)}</div><p class="split-note">Hull damage is shared proportionally. The original keeps its name and course${getFleetReadiness(state,fleet.id).held?' and remains on hold':''}; the detached formation awaits orders. ${fleet.defenseLead?'The original keeps its defensive lead. ':''}Upkeep is unchanged.${fleet.heritage?.length ? ' Both carry the same expedition history.' : ''}</p>${!preview.enabled ? `<p class="split-reason">${escape(preview.reason)}</p>` : ''}<div class="modal-actions"><button data-action="close-modal">Keep together</button><button class="primary" data-action="split-confirm" data-fleet-target="${fleetId}" data-ships="${ships}" ${preview.enabled ? '' : 'disabled'}>Detach ${ships} ${ships === 1 ? 'ship' : 'ships'} · ${preview.orderCost} order</button></div>`;
}

export function renderColonyRepairSummary(state, system) {
  if (system.owner !== 'player' || !state.fleets.some(fleet => fleet.owner === 'player' && fleet.systemId === system.id)) return '';
  const forecast = getColonyRepairForecast(state, system.id);
  const damaged = forecast.fleets.filter(fleet => fleet.missingHull > 0);
  return `<section class="panel-section colony-repairs"><div class="section-label">Orbital maintenance <span>${hull(forecast.capacity)} hull / cycle</span></div><p>${forecast.blocked ? 'Hostile fleets prevent passive repairs in this system.' : damaged.length ? `${hull(forecast.totalRepair)} hull recovery at current damage, shared by ${damaged.length} ${damaged.length === 1 ? 'formation' : 'formations'}.` : 'All your fleets here are fully repaired.'}</p>${!forecast.blocked && damaged.length ? `<ul>${damaged.map(entry => { const fleet = state.fleets.find(candidate => candidate.id === entry.fleetId); return `<li><span>${escape(fleet.name)}</span><b>+${hull(entry.repair)} hull</b></li>`; }).join('')}</ul>` : ''}<small>Ships at one colony share its repair capacity. Splitting or merging does not increase the total.</small></section>`;
}
