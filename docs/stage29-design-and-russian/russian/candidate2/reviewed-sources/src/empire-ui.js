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
  return `<div class="colonial-economy-heading"><div><div class="section-label">Colonial administration</div><p>Output per cycle, before fleet upkeep and trade. Select a column to compare your worlds.</p></div><span>${colonies.length} ${colonies.length === 1 ? 'colony' : 'colonies'}</span></div><div class="colony-scroll" role="region" aria-label="Colony economy and construction" tabindex="0"><table class="colony-table economy-table"><thead><tr>${heading('name')}<th scope="col">Specialty</th>${columns.slice(1).map(([key]) => heading(key)).join('')}<th scope="col">Construction</th><th scope="col"><span class="sr-only">Inspect world</span></th></tr></thead><tbody>${colonies.map(({ system, output }) => {
    const project = getConstructionProject(system.queue);
    return `<tr data-colony="${system.id}"><td><strong>${escape(system.name)}</strong><small>${system.population} / ${output.capacity} population</small></td><td><span class="colony-charter-name">${escape(charterLabel(system))}</span><small class="colony-slot-count">${system.buildings.length} / ${getInfrastructure(state, system).capacity} slots</small></td>${['credits', 'minerals', 'science', 'production'].map(key => `<td class="colony-output output-${key}">${output[key]}</td>`).join('')}<td>${project ? `<span class="colony-project">${escape(project.name)}</span><small>${Math.ceil((system.queue.work - system.queue.progress) / output.production)} cycles remaining</small>` : '<span class="colony-idle">Idle</span>'}</td><td><button class="small-button ghost" data-action="inspect" data-system="${system.id}" aria-label="Inspect ${escape(system.name)}">↗</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
