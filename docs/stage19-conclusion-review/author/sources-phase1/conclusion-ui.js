import { getCampaignConclusion } from './conclusion.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const number = value => escape(value.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const plural = (count, one, many = `${one}s`) => count === 1 ? one : many;

function metric(key, label, value, detail = '') {
  return `<div class="conclusion-stat" data-conclusion-stat="${key}"><dt>${label}</dt><dd>${number(value)}</dd>${detail ? `<small>${detail}</small>` : ''}</div>`;
}

function worldLinks(worlds) {
  return worlds.map(world => `<button class="small-button ghost" data-system-select="${escape(world.id)}">${escape(world.name)} <span aria-hidden="true">↗</span></button>`).join('');
}

function momentLinks(links) {
  return links.map(link => {
    if (link.kind === 'report') return `<button class="small-button ghost" data-action="combat-report" data-report="${escape(link.reportId)}">Battle report <span aria-hidden="true">→</span></button>`;
    if (link.kind === 'discovery') return `<button class="small-button ghost" data-action="anomaly" data-system="${escape(link.systemId)}">Expedition record <span aria-hidden="true">→</span></button>`;
    if (link.kind === 'world') return `<button class="small-button ghost" data-system-select="${escape(link.systemId)}">View system <span aria-hidden="true">↗</span></button>`;
    return '';
  }).join('');
}

function retainedRange(first, last) {
  if (first === null || last === null) return '';
  return first === last ? ` · cycle ${number(first)}` : ` · cycles ${number(first)}–${number(last)}`;
}

/** A saved outcome and the player's final state, never a reconstructed campaign history. */
export function renderCampaignConclusion(state) {
  const conclusion = getCampaignConclusion(state);
  if (!conclusion) return '';
  const { outcome, holdings, conquest, network, history, moments } = conclusion;
  const emblem = outcome.victoryType === 'Transcendence' ? '✦' : outcome.victoryType === 'Domination' ? '⌂' : '◇';
  const color = /^#[\da-f]{3,8}$/i.test(outcome.winnerColor || '') ? outcome.winnerColor : '#d9bb80';
  const title = outcome.victoryType === 'Concord defeated' ? 'The Concord’s age concludes' : outcome.victoryType;
  return `<article class="campaign-conclusion" style="--conclusion-color:${color}" aria-labelledby="modal-title">
    <header class="conclusion-header">
      <div class="conclusion-emblem" aria-hidden="true"><span>${emblem}</span></div>
      <div class="conclusion-heading"><div class="eyebrow">${outcome.playerWon ? 'VICTORY RECORDED' : 'CAMPAIGN CONCLUDED'} · CYCLE ${number(outcome.turn)}</div>
        <h2 id="modal-title">${escape(title)}</h2>
        <p class="conclusion-victor"><strong>${escape(outcome.winnerName)}</strong> · Recorded victor</p>
        <p class="conclusion-seed">Galaxy <span>${escape(outcome.seed)}</span></p>
      </div>
    </header>
    <div class="conclusion-actions" aria-label="Explore the completed campaign">
      <button class="primary" data-action="close-modal">Inspect galaxy</button>
      <button data-action="conclusion-chronicle">Read Chronicle</button>
      <button data-action="export">Export campaign</button>
    </div>
    <section class="conclusion-holdings" aria-labelledby="conclusion-holdings-title">
      <div class="conclusion-section-heading"><h3 id="conclusion-holdings-title">Your final holdings</h3><span>The Concord · Cycle ${number(outcome.turn)}</span></div>
      <dl class="conclusion-stat-grid">
        ${metric('colonies', 'Worlds', holdings.worlds)}
        ${metric('population', 'Population', holdings.population)}
        ${metric('ships', 'Ships', holdings.ships, `${number(holdings.militaryShips)} military`)}
        ${metric('techs', 'Technologies', holdings.technologies)}
        ${metric('score', 'Legacy', holdings.legacy)}
      </dl>
      <dl class="conclusion-resources"><div><dt>Credits</dt><dd>${number(holdings.resources.credits)}</dd></div><div><dt>Minerals</dt><dd>${number(holdings.resources.minerals)}</dd></div><div><dt>Science</dt><dd>${number(holdings.resources.science)}</dd></div><div><dt>Orders remaining</dt><dd>${number(holdings.resources.orders)}</dd></div></dl>
    </section>
    <div class="conclusion-objectives">
      <section class="conclusion-objective" aria-labelledby="conclusion-network-title"><div class="eyebrow">Your final network</div><h3 id="conclusion-network-title">${number(network.beacons)} ${plural(network.beacons, 'Beacon')}</h3>
        <p>${network.hasProtocol ? 'Asterion Protocol researched.' : 'Asterion Protocol not researched.'} ${number(network.requiredBeacons)} Beacons required for alignment.</p>
        ${network.hasRecordedAlignment ? `<p class="conclusion-alignment"><strong>${number(network.progress)} / ${number(network.target)}</strong> recorded alignment cycles</p>` : '<p class="conclusion-missing">Alignment progress was not recorded in this older save. The saved campaign outcome is preserved.</p>'}
        ${network.sites.length ? `<p class="conclusion-link-label">Final participating sites</p><div class="conclusion-world-links">${worldLinks(network.sites)}</div>` : ''}
      </section>
      <section class="conclusion-objective" aria-labelledby="conclusion-worlds-title"><div class="eyebrow">Your founding-world control</div><h3 id="conclusion-worlds-title">${number(conquest.controlled)} / ${number(conquest.target)} founding worlds</h3>
        <p>Original founding worlds under your final sovereignty. Their identity stays fixed when capitals relocate.</p>
        ${conquest.worlds.length ? `<div class="conclusion-world-links">${worldLinks(conquest.worlds)}</div>` : '<p class="conclusion-missing">No founding worlds remain under Concord control.</p>'}
      </section>
    </div>
    <section class="conclusion-history" aria-labelledby="conclusion-history-title">
      <div class="conclusion-section-heading"><h3 id="conclusion-history-title">Selected retained moments</h3><span>Newest first</span></div>
      <p class="conclusion-history-scope">A selection from the records still in this save, not a complete timeline. The Chronicle retains up to ${number(history.logLimit)} entries; battle reports retain up to ${number(history.reportLimit)} engagements involving your forces.</p>
      <div class="conclusion-retained-counts"><span>${number(history.logCount)} Chronicle ${plural(history.logCount, 'entry', 'entries')}${retainedRange(history.earliestLogTurn, history.latestLogTurn)}</span><span>${number(history.reportCount)} battle ${plural(history.reportCount, 'report')}${retainedRange(history.earliestReportTurn, history.latestReportTurn)}</span></div>
      ${moments.length ? `<ol class="conclusion-moments">${moments.slice(0, 6).map(moment => `<li class="conclusion-moment"><div class="conclusion-moment-meta"><time>Cycle ${number(moment.turn)}</time><span>${escape(moment.category)}</span></div><p>${escape(moment.text)}</p>${moment.links.length ? `<div class="conclusion-moment-links">${momentLinks(moment.links)}</div>` : ''}</li>`).join('')}</ol>` : '<p class="conclusion-empty">No moments from these chapters remain in this save. Your recorded outcome and final holdings are still available above.</p>'}
    </section>
    <footer class="conclusion-footer"><p>This age remains available to inspect and export.</p><button class="ghost" data-action="new-game-menu">Begin a new campaign</button></footer>
  </article>`;
}
