import { getConquestView } from './conquest.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const identityName = identity => identity.status === 'known' ? identity.shortName : identity.status === 'unowned' ? 'Unclaimed' : 'Unknown government';

export function renderConquestCard(state) {
  const view = getConquestView(state), own = view.empires.find(empire => empire.factionId === 'player');
  return `<div class="victory-card conquest-card"><div class="conquest-heading"><h3>⌂ Domination</h3><strong>${own.controlled}<small> / ${view.target}</small></strong></div>
    <p>Hold all four founding worlds at the same time. These objectives stay fixed when an empire moves its administrative capital.</p>
    <div class="progress-track"><i style="width:${own.controlled / view.target * 100}%"></i></div>
    <div class="founding-world-list">${view.worlds.map(world => `<button class="founding-world" data-action="inspect" data-system="${escape(world.id)}" data-founding-world="${escape(world.id)}" title="Inspect ${escape(world.name)}"><span class="founding-emblem" aria-hidden="true">⌂</span><span class="founding-world-name"><strong>${escape(world.name)}</strong><small>${world.founder.status === 'known' ? `Founded by ${escape(world.founder.shortName)}` : 'Founding civilization unidentified'}</small></span><span class="founding-sovereign" ${world.sovereign.status === 'known' ? `style="color:${world.sovereign.color}"` : ''}>${escape(identityName(world.sovereign))}<small>Current control ↗</small></span></button>`).join('')}</div>
    ${view.unknownCount ? `<p class="founding-unknown">${view.unknownCount} founding ${view.unknownCount === 1 ? 'world remains' : 'worlds remain'} unidentified. Survey the frontier to locate ${view.unknownCount === 1 ? 'it' : 'them'}.</p>` : '<p class="founding-complete">All four founding worlds identified.</p>'}
    <div class="conquest-standings"><div class="section-label">${view.complete ? 'Founding-world control' : 'Confirmed founding-world control'}</div>${view.empires.map(empire => `<div class="conquest-standing" data-conquest-faction="${escape(empire.factionId)}"><span style="color:${empire.color}">${escape(empire.shortName)}</span><strong>${empire.controlled} / ${view.target}${empire.exact ? '' : '<small> confirmed</small>'}</strong></div>`).join('')}</div>
    ${view.empires.filter(empire => empire.factionId !== 'player' && empire.controlled >= 3).map(empire => `<p class="conquest-alert">${escape(empire.shortName)} controls ${empire.controlled}${empire.exact ? '' : ' confirmed'} founding worlds. Holding all four wins Domination.</p>`).join('')}
  </div>`;
}

export function renderFoundingInspector(state, systemId) {
  const world = getConquestView(state).worlds.find(world => world.id === systemId);
  if (!world) return '';
  return `<section class="panel-section founding-inspector"><div class="section-label">Founding world <span>⌂</span></div><p>A permanent Domination objective. Holding all four founding worlds wins the campaign.</p><dl><div><dt>Founded by</dt><dd>${world.founder.status === 'known' ? escape(world.founder.shortName) : 'Unidentified civilization'}</dd></div><div><dt>Current control</dt><dd>${escape(identityName(world.sovereign))}</dd></div></dl><p class="founding-capital-note">Moving an administrative capital does not move this objective.</p></section>`;
}
