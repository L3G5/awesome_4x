import { FACTIONS, TECHS, BUILDINGS, SHIPS } from './content.js';
import { getEmpireStats, getSystemYield, getConstructionProject } from './game.js';
import { getDiplomacyForecast } from './diplomacy.js';
import { getPublicRaces, getAlignmentStatus } from './victory.js';
import { getDiscoveryView } from './discoveries.js';
import { getAlignmentOutlook } from './alignment-outlook.js';
import { alignmentOutlookSummary } from './alignment-outlook-ui.js';
import { renderIllustration } from './illustrations.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const section = (title, body) => `<section class="context-section"><div class="section-label">${title}</div>${body}</section>`;
const inspect = (system, detail) => `<button class="context-link" data-action="inspect" data-system="${system.id}"><span>${escape(system.name)}<small>${escape(detail)}</small></span><span aria-hidden="true">↗</span></button>`;

export function renderWorkspaceInspector(state, page, { rivalId = null } = {}) {
  const player = state.factions.find(faction => faction.id === 'player');
  const stats = getEmpireStats(state);
  const colonies = state.systems.filter(system => system.owner === 'player');
  if (page === 'research') {
    const current = player.research && TECHS[player.research.techId];
    const output = colonies.map(system => ({ system, science: getSystemYield(state, system).science })).sort((a, b) => b.science - a.science || a.system.name.localeCompare(b.system.name));
    let html = `<div class="context-heading"><div class="eyebrow">CONCORD RESEARCH COUNCIL</div><h2>Your archives</h2><p>${player.techs.length} of ${Object.keys(TECHS).length} sciences recovered</p></div><div class="context-metric"><strong>+${stats.scienceIncome}</strong><span>science each cycle</span><small>${Math.floor(player.science)} in reserve</small></div>`;
    if (current) {
      const remaining = current.cost - player.research.progress;
      html += section('Commissioned research', `<h3>${escape(current.name)}</h3><p>${escape(current.description)}</p><div class="progress-track"><i style="width:${player.research.progress / current.cost * 100}%"></i></div><p>${player.research.progress} / ${current.cost} science · ${stats.scienceIncome > 0 ? `${Math.ceil(remaining / stats.scienceIncome)} cycles at current output` : 'Awaiting science production'}</p>`);
      const next = Object.values(TECHS).filter(tech => tech.requires.includes(current.id) && !player.techs.includes(tech.id));
      const unlocked = [...Object.values(BUILDINGS), ...Object.values(SHIPS)].filter(item => item.requires.includes(current.id));
      if (next.length || unlocked.length) html += section('This breakthrough opens', `<ul class="context-list">${unlocked.map(item => `<li>${escape(item.name)}</li>`).join('')}${next.map(tech => `<li>${escape(tech.name)}<small>${tech.requires.filter(id => id !== current.id && !player.techs.includes(id)).map(id => `Also needs ${escape(TECHS[id].name)}`).join(' · ') || 'Research becomes available'}</small></li>`).join('')}</ul>`);
    } else html += section('Research direction', `<p>${player.techs.length === Object.keys(TECHS).length ? 'The sciences of this age are complete. Your archives retain further discoveries.' : 'Choose a project in the archives. Stored science is applied when you commission it; changing research uses no orders.'}</p>`);
    return html + section('Research worlds', output.map(({ system, science }) => inspect(system, `${science} science / cycle`)).join(''));
  }
  if (page === 'diplomacy') {
    const faction = state.factions.find(candidate => candidate.id === rivalId && player.contacts.includes(candidate.id)) || state.factions.find(candidate => candidate.id !== 'player' && player.contacts.includes(candidate.id));
    if (!faction) return `<div class="context-heading"><div class="eyebrow">DIPLOMATIC CHANNELS</div><h2>Beyond our signals</h2><p>Explore the Reach to make contact. A civilization's dossier becomes available when your envoys establish a channel.</p></div>${section('Known commitments', '<p>Public announcements can mention an unidentified partner. That does not reveal their civilization or give your fleets sensors in their territory.</p>')}`;
    const forecast = getDiplomacyForecast(state, 'player', faction.id);
    const relation = player.relations[faction.id];
    const race = getPublicRaces(state).find(entry => entry.factionId === faction.id);
    let html = `<div class="context-heading" style="--faction:${FACTIONS[faction.id].color}"><div class="eyebrow">CIVILIZATION DOSSIER</div><h2>${escape(faction.name)}</h2><p>${escape(faction.leader)}</p></div>${renderIllustration(faction.id)}<div class="context-quotation">“${escape(faction.motto)}”</div>${section('Their civilization', `<p>${escape(faction.description)}</p>`)}`;
    if (faction.eliminated) return html + section('Diplomatic status', '<p>This government has fallen. Its public history remains in the Chronicle.</p>');
    const terms = relation.status === 'war' ? 'At war. Military fleets engage hostile forces on arrival.' : relation.trade ? `Open borders and +${player.techs.includes('diplomacy') ? 10 : 6} credits each cycle from trade.` : 'At peace. Borders remain closed without a trade treaty.';
    html += section('Relations with the Concord', `<p>${terms}</p>${forecast.truceRemaining ? `<p>Binding truce through cycle ${forecast.truceUntil}.</p>` : ''}${forecast.tradeEndingIn ? `<p>Trade ends on cycle ${forecast.tradeEndsAt}; foreign fleets then withdraw.</p>` : ''}<button class="wide-button" data-action="rival-channel" data-target="${faction.id}">View diplomatic actions →</button>`);
    if (race?.beacons > 0) html += section('Public beacon signal', `<p>${race.progress} / ${race.target} alignment</p><p>Beacon locations are public. Their broadcast does not reveal defending fleets.</p><button class="wide-button ghost" data-action="review-network">Review the network →</button>`);
    return html;
  }
  if (page === 'empire') {
    const alignment = getAlignmentStatus(state, 'player');
    const outlook = getAlignmentOutlook(state);
    const networkProgress = state.winner && !player.alignment ? '—' : alignment.progress;
    const networkSummary = state.winner ? 'This age has ended. Review the final network in Empire.' : alignmentOutlookSummary(outlook);
    const networkCost = state.winner ? '' : ` · ${alignment.cost} credits per advancing cycle`;
    const projects = colonies.filter(system => system.queue).sort((a, b) => (a.queue.work - a.queue.progress) / getSystemYield(state, a).production - (b.queue.work - b.queue.progress) / getSystemYield(state, b).production);
    return `<div class="context-heading"><div class="eyebrow">CONCORD ADMINISTRATION</div><h2>The working empire</h2><p>${stats.colonies} worlds · ${stats.population} billion citizens</p></div><div class="context-metric"><strong>${stats.production}</strong><span>construction work each cycle</span><small>${colonies.length - projects.length} idle ${colonies.length - projects.length === 1 ? 'colony' : 'colonies'}</small></div>${section('Upcoming completions', projects.length ? projects.map(system => inspect(system, `${getConstructionProject(system.queue).name} · ${Math.ceil((system.queue.work - system.queue.progress) / getSystemYield(state, system).production)} cycles`)).join('') : '<p>Your construction teams await their next commission.</p>')}${section('Your beacon network', `<p>${networkProgress} / ${alignment.target} alignment${networkCost}</p><p>${escape(networkSummary)}</p><button class="wide-button ghost" data-action="review-alignment">${state.winner?'Review final network':'Review your funding'} →</button>`)}`;
  }
  const discoveries = state.systems.map(system => ({ system, view: getDiscoveryView(state, system.id) })).filter(({ view }) => view).sort((a, b) => Number(b.view.phase === 'ready') - Number(a.view.phase === 'ready') || a.system.name.localeCompare(b.system.name));
  return `<div class="context-heading"><div class="eyebrow">CONCORD HISTORICAL OFFICE</div><h2>Stories of the Reach</h2><p>Received reports and the memory of your expeditions.</p></div>${section('Latest cycle briefing', state.lastBriefing ? `<p>Cycle ${state.lastBriefing.turn} · ${state.lastBriefing.entries.length} dispatches</p><button class="wide-button" data-action="briefing">Read the briefing →</button>` : '<p>Your first briefing arrives after the next cycle.</p>')}${section('Expedition records', discoveries.length ? discoveries.map(({ system, view }) => `<button class="context-link" data-action="anomaly" data-system="${system.id}"><span>${escape(view.name)}<small>${escape(system.name)}${view.phase === 'ready' ? ' · A final choice awaits' : ''}</small></span><span aria-hidden="true">↗</span></button>`).join('') : '<p>Survey new worlds to discover the histories they hold.</p>')}`;
}
