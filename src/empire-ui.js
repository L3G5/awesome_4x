import { getSystemYield, getConstructionProject, getInfrastructure } from './game.js';
import { charterLabel } from './development-ui.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const columns = [['name', 'World'], ['credits', '◈ Credits'], ['minerals', '◇ Minerals'], ['science', '✧ Science'], ['production', '▥ Work']];

export function renderColonyTable(state, sort = 'name', direction = 'asc') {
  if (!columns.some(([key]) => key === sort)) sort = 'name';
  const sign = direction === 'desc' ? -1 : 1;
  const colonies = state.systems.filter(system => system.owner === 'player').map(system => ({ system, output: getSystemYield(state, system) }));
  colonies.sort((a, b) => (sort === 'name' ? a.system.name.localeCompare(b.system.name) : a.output[sort] - b.output[sort]) * sign || a.system.name.localeCompare(b.system.name));
  const heading = key => {
    const label = columns.find(([candidate]) => candidate === key)[1];
    return `<th scope="col"${sort === key ? ` aria-sort="${direction === 'desc' ? 'descending' : 'ascending'}"` : ''}><button data-action="colony-sort" data-sort="${key}" title="Sort colonies by ${key === 'name' ? 'name' : key}">${label}<span aria-hidden="true">${sort === key ? direction === 'desc' ? '↓' : '↑' : '↕'}</span></button></th>`;
  };
  const player = state.factions.find(faction => faction.id === 'player');
  const inactiveReason = state.winner ? 'This campaign has ended.' : player?.eliminated ? 'This empire is no longer active.' : '';
  return `<div class="colonial-economy-heading"><div><div class="section-label">Colonial administration</div><p>Output per cycle, before fleet upkeep and trade. Select a column to compare your worlds.</p></div><span>${colonies.length} ${colonies.length === 1 ? 'colony' : 'colonies'}</span></div><div class="colony-scroll" role="region" aria-label="Colony economy and construction" tabindex="0"><table class="colony-table economy-table empire-colonies"><thead><tr>${heading('name')}<th scope="col">Specialty</th>${columns.slice(1).map(([key]) => heading(key)).join('')}</tr></thead><tbody>${colonies.map(({ system, output }) => {
    const project = getConstructionProject(system.queue);
    const busy = Boolean(system.queue);
    const systemId = escape(system.id), nameId = `colony-world-${systemId}`, statusId = `colony-construction-${systemId}`;
    const remaining = project ? Math.ceil((system.queue.work - system.queue.progress) / output.production) : null;
    const construction = busy
      ? project ? `<span class="sr-only">Construction </span><span class="colony-project">${escape(project.name)}</span><small>${remaining} ${remaining === 1 ? 'cycle' : 'cycles'} remaining</small>` : '<span class="colony-project">Construction in progress</span>'
      : '<span class="colony-idle">Idle</span>';
    return `<tr data-colony="${systemId}" data-colony-row="${systemId}" tabindex="-1" aria-labelledby="${nameId}" aria-describedby="${statusId}"><th scope="row" class="colony-world-cell" aria-labelledby="${nameId}"><button class="colony-world-inspect" data-action="inspect" data-system="${systemId}" aria-label="Inspect ${escape(system.name)}"><strong id="${nameId}">${escape(system.name)}</strong><span aria-hidden="true">↗</span></button><small class="colony-population">${system.population} / ${output.capacity} population</small><div class="colony-construction"><div id="${statusId}" class="colony-construction-status">${construction}</div>${!busy ? `<button class="small-button colony-commission" data-action="empire-build-menu" data-system="${systemId}" aria-label="Commission a project at ${escape(system.name)}" ${inactiveReason ? `disabled title="${escape(inactiveReason)}"` : ''}>Commission</button>` : ''}</div></th><td class="colony-specialty"><span class="colony-charter-name">${escape(charterLabel(system))}</span><small class="colony-slot-count">${system.buildings.length} / ${getInfrastructure(state, system).capacity} slots</small></td>${['credits', 'minerals', 'science', 'production'].map(key => `<td class="colony-output output-${key}">${output[key]}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}
