import './style.css';
import './workspace.css';
import './fleet-operations.css';
import './command-clarity.css';
import './defense.css';
import './combat-rounds.css';
import './conquest.css';
import './investment.css';
import './reinforcement.css';
import './conclusion.css';
import { GalaxyView } from './galaxy.js';
import { hasSensors, getVisibleFleets } from './intelligence.js';
import { getDiplomacyForecast, getActiveDiplomacyOffers } from './diplomacy.js';
import { renderDiplomacyPage } from './diplomacy-ui.js';
import { renderColonyTable } from './empire-ui.js';
import { renderWorkspaceInspector } from './workspace-ui.js';
import { renderShipPortrait } from './ship-ui.js';
import { renderEngagementPreview } from './combat-ui.js';
import { orderDefenders } from './defense.js';
import { renderDefenseControls, renderDefenseBadge } from './defense-ui.js';
import { renderSplitDialog, renderColonyRepairSummary, renderFleetReadiness } from './fleet-ui.js';
import { getMergePreview, getReinforcementPreview } from './reinforcement.js';
import { renderReinforcementPanel, renderMergeControls, renderMergeSummary, renderMergeDialog } from './reinforcement-ui.js';
import { renderCampaignConclusion } from './conclusion-ui.js';
import { getFleetReadiness, getReadyFleets } from './game.js';
import { formatHull } from './hull-format.js';
import { renderPublicDispatchLinks, renderSovereigntyNote } from './public-affairs-ui.js';
import { renderCombatReports, renderBriefing } from './report-ui.js';
import { renderConquestCard, renderFoundingInspector } from './conquest-ui.js';
import { planetImage } from './planet-art.js';
import { renderDiscoverySummary, renderDiscoveryDialog } from './discovery-ui.js';
import { getDiscoveryView } from './discoveries.js';
import { getNavigationView, renderRouteStrip } from './navigation-ui.js';
import { renderDevelopmentSummary, renderConstructionMenu } from './development-ui.js';
import { renderAlignmentCard, renderPublicRaces, renderBeaconInspector } from './victory-ui.js';
import { getAlignmentStatus, getPublicRaces, revealPublicBeacons } from './victory.js';
import { createGame, command, endTurn, getEmpireStats, getSystemYield, getVisibleSystems, getNeighbors, getBuildOptions, getConstructionProject, getResearchOptions, getVictoryProgress, fleetPower, estimateCombat, estimateInvasion, getCombatReport, validateSave } from './game.js';
import { FACTIONS, TECHS, BUILDINGS, SHIPS, ANOMALIES, PLANET_TYPES } from './content.js';

const SAVE_KEY = 'asterion-reach-save-v1';
const SETTINGS_KEY = 'asterion-reach-settings-v1';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = value => Math.round(value).toLocaleString();
const signed = value => `${value >= 0 ? '+' : ''}${num(value)}`;
const icons = {
 galaxy:'<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><path d="M4 4l1 1m14 14 1 1M3 17h1m16-10h1"/>',
 research:'<path d="M9 3h6m-5 0v6L4 19a1.4 1.4 0 001 2h14a1.4 1.4 0 001-2L14 9V3M7 15h10"/><path d="M10 17h.1m3 2h.1"/>',
 diplomacy:'<path d="M5 4h14v6c0 5-7 10-7 10S5 15 5 10z"/><path d="m8 10 3 3 5-6"/>',
 empire:'<path d="M3 21h18M5 21V10h5v11m4 0V5h5v16M8 10V4m-3 0h6M3 10h9M12 5h9"/>',
 journal:'<path d="M5 3h14v18H5zM8 7h8m-8 4h8m-8 4h5"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
 home:'<path d="m3 10 9-7 9 7M6 8v13h12V8m-8 13v-7h4v7"/>',
 mark:'<path d="m12 1 3.5 7.5L23 12l-7.5 3.5L12 23l-3.5-7.5L1 12l7.5-3.5z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = (name, size=20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.mark}</svg>`;
let state, settings = { warnUnspent: true, publicDispatchesOpen: false }, saveError = false, importedError = '';
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch {}
try { const saved = JSON.parse(localStorage.getItem(SAVE_KEY)); if (validateSave(saved)) state = saved; else if (saved) importedError = 'The previous save could not be read. Your new campaign is ready.'; } catch { importedError = 'Browser storage is unavailable or the previous save is invalid. Use Export in the menu to keep a backup.'; }
const isNew = !state;
state ||= createGame('ASTERION');
revealPublicBeacons(state);
let selectedSystemId = state.factions.find(f => f.id === 'player').capitalId;
let selectedFleetId = state.fleets.find(f => f.owner === 'player' && f.type === 'scout')?.id || null;
if(state.fleets.find(f=>f.id===selectedFleetId)?.route)selectedSystemId=state.fleets.find(f=>f.id===selectedFleetId).systemId;
let colonySort = 'name', colonySortDirection = 'asc';
let selectedRivalId = null;
let page = 'galaxy', researchFilter = 'All', logFilter = 'All', modalType = null, lastFocus = null, previousTurn = state.turn;
const player = () => state.factions.find(f => f.id === 'player');
const systemById = id => state.systems.find(s => s.id === id);
const fleetById = id => state.fleets.find(f => f.id === id);
const dossierRivalId = () => player().contacts.includes(selectedRivalId) ? selectedRivalId : state.factions.find(f=>f.id!=='player'&&player().contacts.includes(f.id))?.id;

$('#app').innerHTML = `<div class="app-shell">
  <header class="topbar"><div class="brand"><div class="brand-mark">${icon('mark',34)}</div><div><h1>ASTERION REACH</h1><small>THE STARS REMEMBER</small></div></div><div class="resources" id="resources"></div><div class="top-actions"><button data-action="briefing" id="briefing-button" aria-label="Latest cycle briefing" title="Latest cycle briefing">${icon('journal')}</button><a href="./guide.html" target="_blank" rel="noopener" aria-label="Open field guide" title="Field guide (?)">${icon('help')}</a><button data-action="menu" aria-label="Game menu" title="Game menu">${icon('menu')}</button></div></header>
  <nav class="rail" aria-label="Command views">${[['galaxy','Galaxy'],['research','Research'],['diplomacy','Diplomacy'],['empire','Empire'],['journal','Chronicle']].map(([id,label],i)=>`<button data-page="${id}" class="${id==='galaxy'?'active':''}" title="${label} (${i+1})">${icon(id)}<span>${label}</span></button>`).join('')}<div class="rail-bottom"><button data-action="home" title="Focus homeworld (H)">${icon('home')}<span>Home</span></button></div></nav>
  <main class="main-stage"><div class="galaxy-page" id="galaxy-page"><div class="map-canvas" id="galaxy" aria-label="Interactive galaxy map"></div><div class="map-heading"><div class="eyebrow">CONCORD EXPLORATION AUTHORITY</div><h2>The Asterion Reach</h2><p id="map-meta"></p></div><div class="map-tools"><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="reset-view" title="Fit galaxy" aria-label="Fit galaxy">⌖</button></div><div class="map-message" id="mandate"></div><div class="map-caption">PER ASPERA, AD ASTRA</div><div class="map-legend"><span><i></i>CONCORD</span><span><i style="background:#d9bd7c"></i>CHARTED</span><span><i style="background:#596a82"></i>UNKNOWN</span><span class="founding-legend">⌂ FOUNDING WORLD</span></div><div class="fleet-bar" id="fleet-bar"></div></div><div class="workspace-page" id="workspace-page" hidden></div></main>
  <aside class="inspector" aria-label="System inspector"><div class="inspector-content" id="inspector"></div><div class="turn-panel"><div class="turn-meta"><b id="turn-number"></b><span id="turn-year"></span></div><button class="primary end-turn" data-action="end-turn" id="end-turn"><span>End cycle →</span><kbd>SPACE</kbd></button><div class="turn-hint" id="turn-hint"></div></div></aside>
  <footer class="statusbar"><span class="status-message" id="status-message">Your mandate begins among the stars.</span><span class="version">ASTERION REACH <span class="green">/</span> EARLY ACCESS ${__APP_VERSION__}</span><span id="save-status">LOCAL CAMPAIGN</span></footer></div><div id="modal-root"></div><div class="toast-stack" id="toasts" role="status" aria-live="polite"></div><input class="sr-only" type="file" id="import-save" accept="application/json,.json" aria-label="Import campaign save" />`;

const galaxy = new GalaxyView($('#galaxy'), { onSelect: selectSystem, onFleetSelect: selectFleet });
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); saveError = false; $('#save-status').textContent = '● AUTOSAVED'; }
  catch { if (!saveError) toast('Autosave unavailable. Export your campaign from the menu.', true); saveError = true; $('#save-status').textContent = 'SAVE UNAVAILABLE'; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toasts').appendChild(el); while($('#toasts').children.length>3)$('#toasts').firstElementChild.remove(); setTimeout(() => el.remove(), error ? 6500 : 4200);
  $('#status-message').textContent = message;
}
function selectSystem(id) { const system=systemById(id); if (!system || !(system.knownBy.includes('player') || system.exploredBy.includes('player') || system.owner==='player')) return; selectedSystemId = id; if (page !== 'galaxy') setPage('galaxy'); render(); }
function selectFleet(id) { const fleet = fleetById(id); if (!fleet || fleet.owner !== 'player') return; selectedFleetId = id; selectedSystemId = fleet.systemId; if (page !== 'galaxy') setPage('galaxy'); render(); galaxy.focus(fleet.systemId); }
function setPage(value) { const changed=page!==value;page = value; galaxy.setPaused?.(Boolean(modalType) || page !== 'galaxy'); $('#galaxy-page').hidden = page !== 'galaxy'; $('#workspace-page').hidden = page === 'galaxy'; document.querySelectorAll('[data-page]').forEach(el => { el.classList.toggle('active',el.dataset.page === page); el.setAttribute('aria-current',el.dataset.page === page ? 'page' : 'false'); }); renderPage(); renderInspector(); $('#inspector').scrollTop=0; if(changed)$('#workspace-page').scrollTop=0; }
function dispatch(action) {
  const result = command(state, action);
  if (!result.ok) { toast(result.message, true); return false; }
  if(action.type==='split'&&result.newFleetId){selectedFleetId=result.newFleetId;selectedSystemId=fleetById(selectedFleetId).systemId;}
  if (['move','continueRoute'].includes(action.type) && fleetById(action.fleetId)) selectedSystemId = fleetById(action.fleetId).systemId;
  if (selectedFleetId && !fleetById(selectedFleetId)) selectedFleetId = null;
  save(); render(); toast(result.combatReports?.length ? `${result.combatReports.length} combat report${result.combatReports.length>1?'s':''} recorded.` : result.message); if (state.winner) showVictory(); else if(result.combatReports?.length)showReports(result.combatReports.map(r=>r.id)); return true;
}
function render() {
  const p = player(), stats = getEmpireStats(state);
  $('#resources').innerHTML = [['credits','◈','Credits',stats.credits,stats.creditIncome],['minerals','◇','Minerals',stats.minerals,stats.mineralIncome],['science','✧','Science',stats.science,stats.scienceIncome],['orders','⌘','Orders',stats.orders,null]].map(([key,symbol,label,value,delta])=>`<div class="resource ${key}" title="${label}: ${num(value)}${delta!==null?`; ${signed(delta)} per cycle${key==='credits'?` after ${stats.upkeep} fleet upkeep`:''}`:` of ${stats.maxOrders} available this cycle`}"><span class="symbol" aria-hidden="true">${symbol}</span><div><strong>${num(value)}${key==='orders'?`<small style="color:#6f8996"> / ${stats.maxOrders}</small>`:''}</strong>${delta!==null?`<span class="delta ${delta<0?'negative':''}">${signed(delta)}</span>`:''}<label>${label}</label></div></div>`).join('');
  $('#turn-number').textContent = `Cycle ${String(state.turn).padStart(2,'0')}`; $('#turn-year').textContent = `${2400 + state.turn - 1} CE`;
  $('#turn-hint').textContent = state.winner ? 'The chronicle of this age is complete.' : `${stats.orders} orders remaining · ${stats.colonies} ${stats.colonies===1?'colony':'colonies'}`;
  $('#end-turn').disabled = !!state.winner;
  const briefing=state.lastBriefing;
  $('#briefing-button').disabled=!briefing;
  $('#briefing-button').classList.toggle('briefing-alert', Boolean(briefing?.entries.length && settings.reviewedBriefing!==briefingKey()));
  $('#briefing-button').title=briefing?`Cycle ${briefing.turn} briefing · ${briefing.entries.length} dispatches`:'Complete a cycle to receive a briefing';
  $('#map-meta').innerHTML = `<span class="live-dot"></span>${getVisibleSystems(state).length} charted systems · ${stats.explored} surveyed · seed ${escape(state.seed)}`;
  const alignment = getAlignmentStatus(state,'player');
  const rivalRace = getPublicRaces(state).filter(r=>r.factionId!=='player'&&r.progress>0).sort((a,b)=>b.progress-a.progress)[0];
  const mandate = state.winner ? ['THE CHRONICLE IS COMPLETE',`${FACTIONS[state.winner]?.name||'The galaxy'} · ${state.victoryType} · Cycle ${state.turn}. Review the conclusion or inspect the final galaxy.`] : rivalRace?.progress>=5 && rivalRace.progress>=alignment.progress ? ['A RIVAL AWAKENS THE NETWORK',`${rivalRace.name} has reached ${rivalRace.progress}/${rivalRace.target} alignment. Review its public beacon signals in Empire.`] : stats.colonies<2 ? ['YOUR FIRST MANDATE','Scout a neighboring star. Send your Colony Ark to a habitable world and establish a second home.'] : !p.research && p.techs.length<12 ? ['THE NEXT HORIZON','Your archives await direction. Choose a research project to turn discoveries into progress.'] : stats.beacons>0 ? ['THE ANCIENT NETWORK',`${stats.beacons} of 3 Beacons restored · alignment ${alignment.progress}/${alignment.target}. ${alignment.ready?`Protect the network and fund ${alignment.cost} credits each cycle.`:alignment.reason}`] : ['A CIVILIZATION TAKES SHAPE',`${stats.colonies} worlds share your future. Develop your economy, meet the frontier powers, and choose your path to victory.`];
  $('#mandate').innerHTML = `<strong>${escape(mandate[0])}</strong>${escape(mandate[1])}${state.winner?'<button class="small-button ghost" data-action="show-conclusion">Review this age →</button>':rivalRace?.progress>=5?'<button class="small-button ghost" data-action="review-network">Review network →</button>':''}`;
  const empireButton=$('[data-page="empire"]');
  empireButton.querySelector('.nav-badge')?.remove();
  empireButton.setAttribute('aria-label',`Empire${rivalRace?`, rival alignment ${rivalRace.progress} of ${rivalRace.target}`:''}`);
  if(rivalRace)empireButton.insertAdjacentHTML('beforeend',`<b class="nav-badge">${rivalRace.progress}/${rivalRace.target}</b>`);
  const incomingOffers = getActiveDiplomacyOffers(state).filter(offer => offer.to === 'player');
  const diplomacyButton = $('[data-page="diplomacy"]');
  diplomacyButton.setAttribute('aria-label', `Diplomacy${incomingOffers.length ? `, ${incomingOffers.length} pending diplomatic proposal${incomingOffers.length===1?'':'s'}` : ''}`);
  diplomacyButton.querySelector('.nav-badge')?.remove();
  if (incomingOffers.length) diplomacyButton.insertAdjacentHTML('beforeend', `<b class="nav-badge">${incomingOffers.length}</b>`);
  renderInspector(); renderFleet(); renderPage(); galaxy.update(state, selectedSystemId, selectedFleetId);
}
function renderInspector() {
  $('.inspector').setAttribute('aria-label',page==='galaxy'?'System inspector':`${page==='journal'?'Chronicle':page[0].toUpperCase()+page.slice(1)} context`);
  $('#inspector').classList.toggle('workspace-context',page!=='galaxy');
  if(page!=='galaxy') { $('#inspector').innerHTML=renderWorkspaceInspector(state,page,{rivalId:dossierRivalId()}); return; }
  const system = systemById(selectedSystemId); if (!system) return;
  const surveyed = system.exploredBy.includes('player'), mine = system.owner === 'player', owner = FACTIONS[system.owner], planet = PLANET_TYPES[system.type], output = getSystemYield(state,system);
  const orbit = orderDefenders(getVisibleFleets(state, 'player', system.id));
  let html = `<div class="system-header"><div class="owner-tag" style="color:${owner?.color||'#bba77e'}"><i></i>${owner?escape(owner.name):'UNCLAIMED FRONTIER'}</div><h2>${escape(system.name)}</h2><p class="subtitle">${surveyed?`${escape(planet.name)} world · ${system.originalOwner?'Founding system':'Frontier system'}`:'Unsurveyed system · Charted starlanes'}</p></div><div class="planet-art"><img class="planet-globe" src="${planetImage(surveyed?{...system,seed:state.seed}:{type:'unknown'})}" alt="${surveyed?escape(planet.name)+' world':'Unsurveyed world'}" width="142" height="142" /></div><p class="system-description">${surveyed?escape(planet.description):'Send a fleet to survey this system and reveal its worlds, resources, and hidden history.'}</p>`;
  if (surveyed) html += `<div class="stat-grid"><div class="stat-cell"><b>${system.habitability}%</b><span>Habitability</span></div><div class="stat-cell"><b>${mine?`${system.population}/${output.capacity}`:system.richness}</b><span>${mine?'Population':'Ore richness'}</span></div><div class="stat-cell"><b>${mine?output.production:system.science}</b><span>${mine?'Production':'Science'}</span></div></div>`;
  if (mine) {
    const queue = system.queue, item = getConstructionProject(queue);
    html += `<section class="panel-section"><div class="section-label">Colony production <span>${output.production} / cycle</span></div>${queue?`<div class="production-row"><span class="big-icon">${item.icon}</span><div><b>${escape(item.name)}</b><p>${Math.ceil((queue.work-queue.progress)/output.production)} cycles to completion</p></div><button class="small-button ghost" data-action="cancel-build" data-system="${system.id}" title="Cancel and refund unspent work">×</button></div><div class="progress-track"><i style="width:${queue.progress/queue.work*100}%"></i></div>`:`<p class="empty-note">Your construction teams await a new project.</p><button class="wide-button" data-action="build-menu" data-system="${system.id}">+ Commission a project</button>`}</section>${renderReinforcementPanel(state,selectedFleetId,system.id)}${renderDevelopmentSummary(state,system)}<section class="panel-section"><p class="empty-note">${signed(output.credits)} credits · ${signed(output.minerals)} minerals · ${signed(output.science)} science</p></section>`;
  }
  html += renderFoundingInspector(state,system.id);
  html += renderBeaconInspector(state,system);
  html += renderSovereigntyNote(state,system.id);
  html += renderDiscoverySummary(state,system);
  if (orbit.length) html += `<section class="panel-section"><div class="section-label">In orbit <span>${orbit.length} ${orbit.length===1?'fleet':'fleets'}</span></div><div class="fleet-list">${orbit.map(f=>`<button class="fleet-row ${f.id===selectedFleetId?'selected':''}" data-fleet="${f.id}" ${f.owner!=='player'?'disabled':''}>${renderShipPortrait(f.type,f.owner,Boolean(f.heritage?.length))}<span class="fleet-name">${escape(f.name)}${f.ships>1?` ×${f.ships}`:''}${renderDefenseBadge(f)}<small>${f.owner==='player'?SHIPS[f.type].role:FACTIONS[f.owner].shortName} · ${escape(formatHull(f.hp, f.ships * SHIPS[f.type].hp))} hull</small></span>${f.owner==='player'?renderFleetReadiness(state,f):''}</button>`).join('')}</div></section>`;
  const selectedFleet=fleetById(selectedFleetId);
  html+=renderMergeSummary(state,selectedFleetId,system.id);
  html+=renderDefenseControls(state,system.id,selectedFleetId);
  if(selectedFleet)html+=renderEngagementPreview(state,selectedFleet.id,system.id);
  html += renderColonyRepairSummary(state,system);
  const invasion=selectedFleet?.systemId===system.id ? estimateInvasion(state,selectedFleet.id) : null;
  if(invasion) html+=`<section class="panel-section"><div class="invasion-preview"><div class="section-label">Invasion forecast</div><strong>${invasion.defense} colony defenses</strong><br>Your volley: ${invasion.damageMin}–${invasion.damageMax} defense damage<br>Retaliation: ${invasion.retaliation} hull${invasion.shielded?' · Shields applied':''}<br>${invasion.captureGuaranteed?'Capture expected with this volley.':invasion.capturePossible?'This volley may capture the colony.':'Further bombardment is required.'}<br>Cost: 1 order + 1 move</div></section>`;
  const neighbors = getNeighbors(state,system.id).map(systemById).filter(s=>s.knownBy.includes('player'));
  html += `<section class="panel-section"><div class="section-label">Connected systems</div><div class="building-pills">${neighbors.map(s=>`<button class="small-button ghost" data-system-select="${s.id}">${escape(s.name)} ↗</button>`).join('')}</div></section>`;
  $('#inspector').innerHTML = html;
}
function movementReason(fleet, target) {
  if (!getNeighbors(state,fleet.systemId).includes(target.id)) return 'Choose a star connected by a starlane.';
  if (!fleet.movesLeft) return 'Movement spent. End the cycle to move again.';
  if (!player().orders) return 'No orders remain this cycle.';
  if (target.owner && target.owner!=='player' && player().relations[target.owner].status!=='war' && !player().relations[target.owner].trade) return 'Borders closed. Negotiate trade or declare war.';
  if (SHIPS[fleet.type].attack<4 && getVisibleFleets(state, 'player', target.id).some(f=>f.owner!=='player' && player().relations[f.owner].status==='war')) return 'Hostile fleet present. Civilian ships cannot enter.';
  return '';
}
function renderFleet() {
  const fleet = fleetById(selectedFleetId), target = systemById(selectedSystemId), ownFleets = state.fleets.filter(f=>f.owner==='player');
  if (!fleet) { $('#fleet-bar').classList.remove('has-route'); $('#fleet-bar').innerHTML = `<div class="fleet-title"><div class="empty-fleet">A galaxy of possibilities.</div><p>Select a fleet in orbit to explore the frontier.</p></div>${ownFleets.length?'<button data-action="fleet-roster">Fleet roster →</button>':''}`; return; }
  const home = systemById(fleet.systemId), ship = SHIPS[fleet.type], different = target.id!==home.id;
  const readiness=getFleetReadiness(state,fleet.id);
  const navigation=getNavigationView(state,fleet,target);
  const adjacent=getNeighbors(state,fleet.systemId).includes(target.id);
  let detail = `${ship.role} · ${fleet.ships} ${fleet.ships===1?'ship':'ships'} · ${fleet.movesLeft} jumps · ${formatHull(fleet.hp, fleet.ships * ship.hp)} hull`, actions='';
  if (different && !adjacent) {
    detail=navigation.preview?.ok?`${home.name} → ${target.name} · ${navigation.preview.jumps} charted jumps`:(navigation.preview?.reason || 'No route through charted lanes.');
    actions=`<button class="ghost small-button" data-system-select="${home.id}" title="Back to fleet">↶</button>`;
  } else if (different) {
    const reason = movementReason(fleet,target), hostileColony = target.owner && target.owner!=='player' && player().relations[target.owner].status==='war';
    const hostileFleet = getVisibleFleets(state,'player',target.id).some(f=>f.owner!=='player' && player().relations[f.owner].status==='war');
    const approach = hostileFleet?`${estimateCombat(state,fleet.id,target.id).odds} engagement`:!hasSensors(state,'player',target.id)?'Fleet presence unknown':hostileColony?'Invasion is a separate action':'';
    detail = reason || `${home.name} → ${target.name} · 1 order${approach?` · ${approach}`:''}`;
    actions = `<button class="primary" data-action="move" data-target="${target.id}" ${reason?'disabled':''}>${hostileFleet?'Engage':hostileColony?'Enter orbit':'Move'} →</button><button class="ghost small-button" data-system-select="${home.id}" title="Back to fleet">↶</button>`;
  } else {
    if (fleet.type==='colony' && !home.owner) actions += `<button class="primary" data-action="colonize">Settle world</button>`;
    const enemiesHere = getVisibleFleets(state,'player',home.id).some(f=>f.owner!=='player' && player().relations[f.owner].status==='war');
    if (enemiesHere && ship.attack>3) actions += `<button class="danger" data-action="attack" ${!fleet.movesLeft||!player().orders?'disabled':''}>Engage</button>`;
    else if (home.owner && home.owner!=='player' && player().relations[home.owner].status==='war' && ship.attack>3) actions += `<button class="danger" data-action="attack" ${!fleet.movesLeft||!player().orders?'disabled':''}>Invade</button>`;
    if (home.owner==='player' && fleet.hp<fleet.ships*ship.hp) actions += '<button data-action="repair">Repair ◇10</button>';
    actions += renderMergeControls(state,fleet.id);
    if (!actions) detail += ' · Select a star to plot a jump or a course.';
  }
  if(readiness.held)detail+=' · Holding position';
  actions+=`<button class="small-button ghost fleet-hold" data-action="fleet-hold" data-fleet-target="${fleet.id}" aria-pressed="${readiness.held}" title="${readiness.held?'Return this fleet to the ready queue; free.':'Hold at '+escape(home.name)+'; free. Movement remains available.'}" ${state.winner?'disabled':''}>${readiness.held?'Resume':'Hold position'}</button>`;
  if(!different&&fleet.ships>1&&fleet.type!=='colony')actions+=`<button data-action="split-menu" data-fleet-target="${fleet.id}" title="Detach ships into a separate formation; 1 order">Split fleet</button>`;
  if(fleet.heritage?.length)actions+=`<button class="small-button ghost" data-action="fleet-heritage" data-fleet-target="${fleet.id}">Heritage ✦</button>`;
  $('#fleet-bar').classList.toggle('has-route',Boolean(navigation.display));
  $('#fleet-bar').innerHTML = `${renderShipPortrait(fleet.type,fleet.owner,Boolean(fleet.heritage?.length))}<div class="fleet-title"><h3>${escape(fleet.name)} <span style="font-weight:400;color:#7f9aa9">/ ${escape(home.name)}</span></h3><p>${escape(detail)}</p></div>${actions}<button class="small-button ghost" data-action="fleet-roster" title="All fleets">⌁ ${ownFleets.length}</button><button class="small-button ghost" data-action="next-fleet" title="Next fleet (N)">⇥</button><div class="fleet-switch">${ownFleets.slice(0,4).map(f=>`<button data-fleet="${f.id}" class="${f.id===fleet.id?'selected':''}" title="${escape(f.name)} at ${escape(systemById(f.systemId).name)}">${SHIPS[f.type].icon}</button>`).join('')}</div>${renderRouteStrip(state,fleet,navigation)}`;
}
function renderPage() {
  if (page==='galaxy') return;
  const stats = getEmpireStats(state), p=player();
  let html='';
  if (page==='research') {
    const current=p.research && TECHS[p.research.techId];
    const researchRank=tech=>tech.completed?3:tech.active?0:tech.enabled?1:2;
    const researchOptions=getResearchOptions(state).filter(tech=>researchFilter==='All'||tech.category===researchFilter).sort((a,b)=>researchRank(a)-researchRank(b));
    html = `<div class="page-top"><div><div class="eyebrow">THE CONCORD ARCHIVES</div><h2>Beyond the known</h2><p>Rediscover the sciences that once connected the stars. Each breakthrough opens a different future for your civilization.</p></div><div class="page-symbol">✧</div></div>${current?`<div class="callout"><strong>${escape(current.name)}</strong> · ${p.research.progress} / ${current.cost} science · ${Math.ceil((current.cost-p.research.progress)/Math.max(1,stats.scienceIncome))} cycles remaining<div class="progress-track"><i style="width:${p.research.progress/current.cost*100}%"></i></div></div>`:`<div class="callout">${p.techs.length===Object.keys(TECHS).length?'The archives are complete. Your civilization has mastered the sciences of this age.':'<strong>Choose a research direction.</strong> Science accumulates in your reserves until assigned. Selecting or changing a project uses no orders.'}</div>`}<div class="filter-tabs">${['All','Engineering','Society','Physics','Military'].map(c=>`<button class="${researchFilter===c?'active':''}" data-research-filter="${c}">${c}</button>`).join('')}</div><div class="tech-grid">${researchOptions.map(t=>`<article class="tech-card ${t.completed?'researched':t.active?'current':!t.enabled?'locked':''}"><div class="tech-top"><span>${t.category}</span><span>${t.completed?'✓ DISCOVERED':`✧ ${t.cost}`}</span></div><h3>${escape(t.name)}</h3><p>${escape(t.description)}</p><div class="tech-footer"><span>${t.requires.length?`Requires ${t.requires.map(id=>escape(TECHS[id].name)).join(' + ')}`:'Foundational science'}</span><button data-action="research" data-tech="${t.id}" ${!t.enabled?'disabled':''} title="${escape(t.reason)}">${t.completed?'Complete':t.active?'In progress':'Research →'}</button></div></article>`).join('')}</div>`;
  } else if (page==='diplomacy') {
    html=renderDiplomacyPage(state,{dispatchesOpen:settings.publicDispatchesOpen===true,selectedRivalId:dossierRivalId()});
  } else if (page==='empire') {
    const victory=getVictoryProgress(state);
    html=`<div class="page-top"><div><div class="eyebrow">MANY WORLDS. ONE HORIZON.</div><h2>The Concord</h2><p>Make a civilization worth inheriting. Prosperity, knowledge, and the strength to protect them are all part of your legacy.</p></div><div class="page-symbol">⌘</div></div><div class="empire-overview"><div class="overview-card"><div class="eyebrow">COLONIZED WORLDS</div><strong>${stats.colonies}</strong><p>${stats.population} billion citizens across the Reach</p></div><div class="overview-card"><div class="eyebrow">FLEET POWER</div><strong>${num(stats.military)}</strong><p>${stats.ships} ships · ${stats.upkeep} credits upkeep / cycle</p></div><div class="overview-card"><div class="eyebrow">LEGACY SCORE</div><strong>${num(stats.score)}</strong><p>Highest score at cycle ${victory.legacy.finalTurn} wins</p></div></div>${renderColonyTable(state,colonySort,colonySortDirection)}<div class="victory-grid">${renderAlignmentCard(state)}${renderConquestCard(state)}</div><section class="network-section"><div class="section-label">The awakening network</div>${renderPublicRaces(state)}</section><div class="panel-section" style="margin-top:22px;padding-left:0;padding-right:0"><div class="section-label">Fleet registry</div><div class="fleet-list">${state.fleets.filter(f=>f.owner==='player').map(f=>`<button class="fleet-row" data-fleet="${f.id}">${renderShipPortrait(f.type,f.owner,Boolean(f.heritage?.length))}<span class="fleet-name">${escape(f.name)} ×${f.ships}${renderDefenseBadge(f)}<small>${escape(systemById(f.systemId).name)} · ${escape(formatHull(f.hp, f.ships * SHIPS[f.type].hp))} hull · ${fleetPower(state,f)} combat power</small></span>${renderFleetReadiness(state,f)}</button>`).join('')}</div></div>`;
  } else if (page==='journal') {
    html=`<div class="page-top"><div><div class="eyebrow">THE RECORD OF AN AGE</div><h2>Your chronicle</h2><p>Every discovery, every world, every promise. The story of your civilization, one cycle at a time.</p>${state.winner?'<button class="small-button" data-action="show-conclusion">Review this age →</button>':''}</div><div class="page-symbol">☷</div></div><div class="filter-tabs">${['All','discovery','construction','research','combat','diplomacy','war','sovereignty'].map(c=>`<button data-log-filter="${c}" class="${logFilter===c?'active':''}">${c[0].toUpperCase()+c.slice(1)}</button>`).join('')}</div>${state.log.filter(l=>logFilter==='All'||l.type===logFilter).map(l=>`<article class="log-item"><div><time>CYCLE ${String(l.turn).padStart(2,'0')}</time><div class="log-type">${escape(l.type)}</div></div><div><p>${escape(l.text)}</p>${l.reportId && getCombatReport(state,l.reportId)?`<button class="small-button" style="margin-top:10px" data-action="combat-report" data-report="${l.reportId}">Battle report →</button>`:''}${l.type==='discovery' && l.systemId && getDiscoveryView(state,l.systemId)?`<button class="small-button" style="margin-top:10px" data-action="anomaly" data-system="${l.systemId}">Expedition record →</button>`:''}${l.publicAffairId?`<div class="public-affair-links">${renderPublicDispatchLinks({...l,systemName:systemById(l.systemId)?.name})}</div>`:''}</div></article>`).join('')||'<p class="empty-note">This chapter has yet to be written.</p>'}`;
  }
  $('#workspace-page').innerHTML=html;
}
function openModal(type,html,wide=false) {
  if (!modalType) lastFocus=document.activeElement;
  $('#toasts').replaceChildren();
  modalType=type; galaxy.setPaused?.(true); $('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal ${wide?'wide':''} ${type==='welcome'?'welcome':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="close-modal" data-action="close-modal" aria-label="Close dialog">×</button><div class="modal-content">${html}</div></section></div>`;
  const focusTarget=type==='combat-report'||type==='conclusion'?$('.modal .close-modal'):type==='merge'?$('.modal select') || $('.modal .close-modal'):$('.modal .primary:not(:disabled)') || $('.modal button:not(:disabled)'); focusTarget?.focus({preventScroll:type==='combat-report'||type==='merge'||type==='conclusion'});
}
function closeModal() { modalType=null; galaxy.setPaused?.(page !== 'galaxy'); $('#modal-root').innerHTML=''; lastFocus?.isConnected && lastFocus.focus(); }
function buildMenu(systemId,tab='building',replaceBuildingId=null) {
  openModal('build',renderConstructionMenu(state,systemId,tab,replaceBuildingId),true);
}
function showAnomaly(systemId,replaceBuildingId=null) {
  openModal('anomaly',renderDiscoveryDialog(state,systemId,replaceBuildingId),true);
}
function showSplit(fleetId,ships=1) {
  openModal('split',renderSplitDialog(state,fleetId,ships));
}
function showMerge(fleetId,targetFleetId=null) {
  const html=renderMergeDialog(state,fleetId,targetFleetId);
  if(!html)return;
  openModal('merge',html);
  $('#merge-partner')?.focus({preventScroll:true});
}
function mergeFleets(fleetId,targetFleetId,close=false) {
  const preview=getMergePreview(state,fleetId,targetFleetId);
  if(!preview?.enabled){if(preview?.reason)toast(preview.reason,true);return;}
  if(dispatch(preview.command)){
    if(close)closeModal();
    const reinforcement=getReinforcementPreview(state,fleetId);
    if(reinforcement?.enabled&&reinforcement.systemId===selectedSystemId)$('.reinforcement-panel')?.focus();
    else document.querySelector(`#inspector [data-fleet="${fleetId}"]`)?.focus({preventScroll:true});
  }
}
function showFleetHeritage(fleetId) {
  const fleet=fleetById(fleetId);if(!fleet || fleet.owner!=='player')return;
  openModal('heritage',`<div class="eyebrow">CONCORD FLEET HERITAGE</div><h2 id="modal-title">${escape(fleet.name)}</h2><div class="heritage-portrait">${renderShipPortrait(fleet.type,fleet.owner,true)}</div><p class="modal-lead">The discoveries carried forward by this task force. These records survive mergers; they do not imply that every original hull remains.</p><div class="discovery-history">${(fleet.heritage||[]).map(entry=>`<article class="discovery-history-entry"><div class="discovery-history-meta">RECOVERED IN CYCLE ${entry.turn} · ${escape(FACTIONS[entry.factionId].shortName)}</div><h3>${escape(entry.name)}</h3><p>Recovered from ${escape(systemById(entry.systemId).name)}. The expedition's story remains with this fleet.</p><button class="small-button ghost" data-action="heritage-origin" data-system="${entry.systemId}">Read the expedition record →</button></article>`).join('')}</div>`);
}
function showMenu() {
  openModal('menu',`<div class="eyebrow">CAMPAIGN CONTROL</div><h2 id="modal-title">A moment among the stars</h2><p class="modal-lead">Cycle ${state.turn} · ${escape(state.seed)} · The Concord</p><div class="menu-grid">${state.winner?'<button data-action="show-conclusion">Review this age</button>':''}<button data-action="export">↓ Export campaign</button><button data-action="import">↑ Import campaign</button><a href="./guide.html" target="_blank" rel="noopener">Read the field guide ↗</a><button data-action="new-game-menu">Begin a new campaign</button></div><p class="save-meta">${saveError?'Browser autosave is unavailable. Export a backup to preserve progress.':'Progress is automatically saved in this browser after every action. Export a backup to move your campaign to another device.'}</p><label style="font-size:12px;display:flex;gap:10px;align-items:center"><input type="checkbox" id="warn-unspent" ${settings.warnUnspent?'checked':''} style="width:auto">Warn before ending a cycle with unused orders</label><div class="modal-actions"><button class="primary" data-action="close-modal">Return to the Reach</button></div>`);
}
function briefingKey() {
  return state.lastBriefing ? `${state.seed}:${state.lastBriefing.turn}:${state.lastBriefing.entries[0]?.id || 0}` : '';
}
function showCycleBriefing() {
  settings.reviewedBriefing=briefingKey();saveSettings();
  $('#briefing-button').classList.remove('briefing-alert');
  openModal('briefing',renderBriefing(state),true);
}
function showReports(ids) {
  const reports=ids.map(id=>getCombatReport(state,id)).filter(Boolean);
  if(!reports.length)return toast('This report is no longer in the active archive.',true);
  openModal('combat-report',renderCombatReports(state,reports),true);
}
function nextFleet() {
  const all=state.fleets.filter(f=>f.owner==='player');
  if(!all.length)return toast('Your empire has no active fleets.');
  const ready=getReadyFleets(state);
  if(!ready.length)return toast(state.winner?'This campaign has ended.':player().orders<1?'No orders remain. Your fleets are still available in the roster.':'No fleet awaits orders. Held and spent fleets remain available in the roster.');
  const index=ready.findIndex(f=>f.id===selectedFleetId);
  selectFleet(ready[(index+1)%ready.length].id);
}
function showFleetRoster() {
  const fleets=state.fleets.filter(f=>f.owner==='player').sort((a,b)=>{
    const first=getFleetReadiness(state,a.id),second=getFleetReadiness(state,b.id);
    return Number(second.ready)-Number(first.ready)||Number(first.held)-Number(second.held)||a.name.localeCompare(b.name);
  });
  const ready=getReadyFleets(state).length,held=fleets.filter(f=>getFleetReadiness(state,f.id).held).length;
  openModal('fleet-roster',`<div class="eyebrow">CONCORD FLEET COMMAND</div><h2 id="modal-title">Your presence among the stars</h2><p class="modal-lead">${fleets.length} fleets · ${ready} awaiting orders · ${held} holding position. Select any fleet to focus its location.</p><div class="fleet-list">${fleets.map(f=>`<button class="fleet-row" data-fleet="${f.id}">${renderShipPortrait(f.type,f.owner,Boolean(f.heritage?.length))}<span class="fleet-name">${escape(f.name)} ×${f.ships}${renderDefenseBadge(f)}<small>${escape(systemById(f.systemId).name)} · ${escape(formatHull(f.hp, f.ships * SHIPS[f.type].hp))} hull · ${SHIPS[f.type].upkeep*f.ships} credits upkeep</small></span>${renderFleetReadiness(state,f)}</button>`).join('')||'<p class="empty-note">Commission ships at an Orbital Shipyard to return to the stars.</p>'}</div><p class="empty-note" style="margin-top:18px">Hold position keeps a fleet out of the ready queue without spending orders or movement. Select a held fleet to resume it or issue a manual command.</p>`);
}
function showPeaceOffer(offerId) {
  const offer=getActiveDiplomacyOffers(state).find(o=>o.id===offerId && o.to==='player' && o.kind==='peace');
  if(!offer) return toast('That proposal is no longer available.',true);
  const forecast=getDiplomacyForecast(state,'player',offer.from);
  openModal('peace-offer',`<div class="eyebrow">AN ENVOY FROM ${escape(FACTIONS[offer.from].shortName)}</div><h2 id="modal-title">An offer to end the war</h2><p class="modal-lead">${escape(FACTIONS[offer.from].name)} proposes a settlement. The war continues until you agree.</p><ul class="peace-terms"><li><b>Receive ${offer.credits} credits.</b> Their payment is already reserved for this agreement.</li><li><b>A ${offer.truceTurns}-cycle mutual truce.</b> Neither side may declare war during the truce.</li><li><b>Military withdrawal.</b> Fleets inside each other's territory return to their nearest owned colony and lose remaining movement.</li><li><b>Expires on cycle ${offer.expiresTurn}.</b> Responding uses one order.</li></ul><div class="modal-actions"><button data-action="peace-response" data-stance="declinePeace" data-target="${offer.from}" data-offer="${offer.id}" ${forecast.actions.declinePeace.enabled?'':'disabled'}>Decline proposal</button><button class="primary" data-action="peace-response" data-stance="acceptPeace" data-target="${offer.from}" data-offer="${offer.id}" ${forecast.actions.acceptPeace.enabled?'':'disabled'}>Accept settlement →</button></div>${!forecast.actions.acceptPeace.enabled?`<p class="empty-note" style="margin-top:14px">${escape(forecast.actions.acceptPeace.reason)}</p>`:''}`);
}
function showTradeOffer(offerId) {
  const offer=getActiveDiplomacyOffers(state).find(candidate=>candidate.id===offerId && candidate.to==='player' && candidate.kind==='trade');
  if(!offer)return toast('This trade offer is no longer available.',true);
  const forecast=getDiplomacyForecast(state,'player',offer.from),income=player().techs.includes('diplomacy')?10:6;
  openModal('trade-offer',`<div class="eyebrow">A TRADE ENVOY FROM ${escape(FACTIONS[offer.from].shortName)}</div><h2 id="modal-title">An offer of open borders</h2><p class="modal-lead">${escape(FACTIONS[offer.from].name)} proposes a trade treaty. Your borders stay closed until you accept.</p><ul class="peace-terms"><li><b>No signing fee from your treasury.</b> The proposer has reserved ${offer.credits} credits to establish the treaty.</li><li><b>Mutual border access.</b> Both empires may move their fleets through each other's territory under the ordinary movement rules.</li><li><b>Earn ${income} credits per cycle.</b> Mutual trust improves by 10; existing grievances remain.</li><li><b>Decision due before cycle ${offer.expiresTurn}.</b> Accepting or declining uses one order. Refusal or expiry refunds the proposer and leaves borders closed.</li><li><b>Trade continues until cancelled.</b> Peaceful cancellation gives three cycles of notice before income and access end and visiting fleets withdraw.</li></ul><div class="modal-actions"><button data-action="trade-response" data-stance="declineTrade" data-target="${offer.from}" data-offer="${offer.id}" ${forecast.actions.declineTrade.enabled?'':'disabled'}>Decline · 1 order</button><button class="primary" data-action="trade-response" data-stance="acceptTrade" data-target="${offer.from}" data-offer="${offer.id}" ${forecast.actions.acceptTrade.enabled?'':'disabled'}>Accept trade · 1 order</button></div>${!forecast.actions.acceptTrade.enabled?`<p class="empty-note" style="margin-top:14px">${escape(forecast.actions.acceptTrade.reason)}</p>`:''}`);
}
function showDiplomaticConfirmation(stance,targetId) {
  const forecast=getDiplomacyForecast(state,'player',targetId),option=forecast.actions[stance];
  const peace=stance==='peace';
  openModal('diplomatic-confirmation',`<div class="eyebrow">CONCORD FOREIGN AFFAIRS</div><h2 id="modal-title">${peace?'Propose a peace settlement':'Give notice to end trade'}</h2><p class="modal-lead">${escape(option.effect)}</p><p class="empty-note">${peace?escape(option.willingness?.reason || option.reason):'Trade income and open borders continue during the notice period. At its end, foreign fleets withdraw to their nearest owned colony.'}</p><div class="modal-actions"><button data-action="close-modal">Keep current policy</button><button class="primary" data-action="diplomatic-confirm" data-stance="${stance}" data-target="${targetId}" ${option.enabled?'':'disabled'}>${peace?'Offer 60 credits · 1 order':'Give notice · 1 order'}</button></div>`);
}
function showWelcome() {
  openModal('welcome',`<div class="welcome-emblem">✦</div><div class="eyebrow">A NEW CHAPTER AMONG THE STARS</div><h2 id="modal-title">The Reach is calling.</h2><p class="modal-lead">For centuries, the ancient gates have been silent.<br>From the oceans of Solace, the Concord looks outward once more.<br>You have a homeworld, three ships, and a future to decide.</p><div class="welcome-steps"><div><span>01 / EXPLORE</span><b>Follow the starlanes</b><p>Select your Pathfinder, then a neighboring star. Choose Move to survey it.</p></div><div><span>02 / ESTABLISH</span><b>Found a second home</b><p>Move your Colony Ark to a habitable world. Settle it to grow your empire.</p></div><div><span>03 / ENDURE</span><b>Every order matters</b><p>Build, research, and meet your rivals. End each cycle to renew your orders.</p></div></div><div class="modal-actions"><a href="./guide.html" target="_blank" rel="noopener" style="align-self:center;font-size:11px;margin-right:12px">Field guide ↗</a><button class="primary" data-action="begin">Take command →</button></div>`);
}
function advanceTurn(force=false) {
  const stats=getEmpireStats(state), idle=getReadyFleets(state).length;
  const unassignedResearch=!player().research && getResearchOptions(state).some(option=>option.enabled);
  if (!force && settings.warnUnspent && stats.orders>0 && (idle || unassignedResearch)) {
    openModal('end-confirm',`<div class="eyebrow">BEFORE THE NEXT CYCLE</div><h2 id="modal-title">Conclude your mandate?</h2><p class="modal-lead">${stats.orders} orders remain${idle?`, and ${idle} ${idle===1?'fleet awaits':'fleets await'} orders`:''}. Unused orders do not carry over.${unassignedResearch?' Your researchers have no assigned project; their science will remain in reserve.':''}</p><p class="empty-note">Rival empires will act, colonies will grow, production and research will advance, and your orders will replenish.</p><div class="modal-actions"><button data-action="close-modal">Keep planning</button><button class="primary" data-action="end-turn-confirm">End cycle →</button></div>`); return;
  }
  const previousRaces=getPublicRaces(state);
  closeModal(); const result=endTurn(state); if (!result.ok) return toast(result.message,true);
  previousTurn=state.turn-1; save(); render(); toast(result.message);
  if (state.winner) showVictory();
  else {
    const briefing=state.lastBriefing;
    if(briefing?.entries.length) $('#status-message').textContent=`Cycle ${briefing.turn}: ${briefing.entries.length} dispatches available in your briefing.`;
    const newOffer=getActiveDiplomacyOffers(state).find(offer=>offer.to==='player' && offer.createdTurn>=previousTurn);
    const raceAlert=getPublicRaces(state).some(race=>{const before=previousRaces.find(r=>r.factionId===race.factionId);return race.factionId!=='player' && (race.progress>0 && !before?.progress || race.progress>=8 && (before?.progress||0)<8);});
    const transferBlocksRoute=entry=>{const world=systemById(entry.systemId);return world?.owner && world.owner!=='player' && !player().relations[world.owner].trade && player().relations[world.owner].status!=='war' && state.fleets.some(fleet=>fleet.owner==='player' && fleet.route?.path.slice(1).includes(entry.systemId));};
    const publicAlert=briefing?.entries.some(entry=>entry.type==='war' || entry.publicAffairId && entry.type==='sovereignty' && transferBlocksRoute(entry));
    if(briefing?.reportIds.length || raceAlert || publicAlert)showCycleBriefing();
    else if(newOffer) newOffer.kind==='trade'?showTradeOffer(newOffer.id):showPeaceOffer(newOffer.id);
  }
}
function showVictory() {
  if(state.winner)openModal('conclusion',renderCampaignConclusion(state),true);
}

function exportSave() {
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url; a.download=`asterion-reach-cycle-${state.turn}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Campaign exported. Keep this file as your backup.');
}
$('#import-save').addEventListener('change',async event=>{
  const file=event.target.files[0]; event.target.value=''; if (!file) return;
  try { if (file.size>3_000_000) throw new Error('Save file is too large.'); const candidate=JSON.parse(await file.text()); if (!validateSave(candidate)) throw new Error('This file is not a valid Asterion Reach campaign.');
    openModal('confirm-import',`<div class="eyebrow">RESTORE A CAMPAIGN</div><h2 id="modal-title">Return to cycle ${candidate.turn}?</h2><p class="modal-lead">This will replace the current autosave. Export your current campaign first if you want to keep it.</p><div class="modal-actions"><button data-action="export">Export current</button><button id="confirm-import" class="primary">Restore campaign</button></div>`);
    $('#confirm-import').addEventListener('click',()=>{state=candidate;revealPublicBeacons(state);selectedSystemId=player().capitalId;selectedFleetId=state.fleets.find(f=>f.owner==='player')?.id||null;if(fleetById(selectedFleetId)?.route)selectedSystemId=fleetById(selectedFleetId).systemId;closeModal();setPage('galaxy');save();render();galaxy.reset();toast('Campaign restored.');});
  } catch(error){toast(error.message,true);}
});
document.addEventListener('change',event=>{if(event.target.id==='merge-partner'){showMerge(event.target.dataset.fleetTarget,event.target.value);$('#merge-partner')?.focus();}if(event.target.id==='split-ships'){showSplit(event.target.dataset.fleetTarget,Number(event.target.value));$('#split-ships')?.focus();}if(event.target.id==='discovery-replacement'){showAnomaly(event.target.dataset.system,event.target.value||null);$('#discovery-replacement')?.focus();}if(event.target.id==='replace-building'){buildMenu(event.target.dataset.system,'building',event.target.value||null);$('#replace-building')?.focus();}if(event.target.id==='warn-unspent'){settings.warnUnspent=event.target.checked;saveSettings();}});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.public-dispatches') && event.target.isConnected && settings.publicDispatchesOpen!==event.target.open){settings.publicDispatchesOpen=event.target.open;saveSettings();}},true);
document.addEventListener('click',event=>{
  const el=event.target.closest('button,a'); if (!el||el.disabled) return;
  if (el.dataset.page) return setPage(el.dataset.page);
  if (el.dataset.fleet) { if(modalType==='fleet-roster')closeModal(); return selectFleet(el.dataset.fleet); }
  if (el.dataset.systemSelect) { if(modalType==='conclusion')closeModal(); return selectSystem(el.dataset.systemSelect); }
  if (el.dataset.researchFilter) { researchFilter=el.dataset.researchFilter;return renderPage(); }
  if (el.dataset.logFilter) {logFilter=el.dataset.logFilter;return renderPage();}
  const action=el.dataset.action;
  switch(action){
    case 'menu':showMenu();break;
    case 'show-conclusion':showVictory();break;
    case 'conclusion-chronicle':closeModal();setPage('journal');break;
    case 'briefing':showCycleBriefing();break;
    case 'review-network':setPage('empire');$('.network-section')?.scrollIntoView({block:'start'});break;
    case 'combat-report':showReports([Number(el.dataset.report)]);break;
    case 'colony-sort':colonySortDirection=colonySort===el.dataset.sort?(colonySortDirection==='asc'?'desc':'asc'):el.dataset.sort==='name'?'asc':'desc';colonySort=el.dataset.sort;renderPage();document.querySelector(`[data-action="colony-sort"][data-sort="${colonySort}"]`)?.focus();break;
    case 'report-inspect':closeModal();selectSystem(el.dataset.system);galaxy.focus(el.dataset.system);break;
    case 'report-select-fleet':closeModal();selectFleet(el.dataset.fleetTarget);break;
    case 'report-diplomacy':selectedRivalId=el.dataset.target;closeModal();setPage('diplomacy');document.querySelector(`[data-rival="${el.dataset.target}"]`)?.scrollIntoView({block:'nearest'});break;
    case 'rival-dossier':selectedRivalId=el.dataset.target;renderInspector();$('#inspector').scrollTop=0;document.querySelectorAll('[data-action="rival-dossier"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.target===selectedRivalId)));if(matchMedia('(max-width:660px)').matches)$('#inspector').scrollIntoView({block:'start'});break;
    case 'rival-channel':document.querySelector(`[data-rival="${el.dataset.target}"]`)?.scrollIntoView({block:'center',behavior:'instant'});document.querySelector(`[data-rival="${el.dataset.target}"] .rival-actions button:not(:disabled)`)?.focus({preventScroll:true});break;
    case 'report-research':closeModal();setPage('research');break;
    case 'report-chronicle':closeModal();setPage('journal');break;
    case 'close-modal':closeModal();break;
    case 'begin':closeModal();save();break;
    case 'home':selectSystem(player().capitalId);galaxy.focus(player().capitalId);break;
    case 'fleet-roster':showFleetRoster();break;
    case 'next-fleet':nextFleet();break;
    case 'fleet-hold':if(dispatch({type:getFleetReadiness(state,el.dataset.fleetTarget).held?'resume':'hold',fleetId:el.dataset.fleetTarget}))$('[data-action="fleet-hold"]')?.focus();break;
    case 'defense-lead-toggle':if(dispatch({type:fleetById(el.dataset.fleetTarget)?.defenseLead?'clearDefenseLead':'leadDefense',fleetId:el.dataset.fleetTarget})){const control=$('[data-action="defense-lead-toggle"]');(control&&!control.disabled?control:$('#inspector [data-fleet="'+el.dataset.fleetTarget+'"]'))?.focus();}break;
    case 'zoom-in':galaxy.zoom(1);break;
    case 'zoom-out':galaxy.zoom(-1);break;
    case 'reset-view':galaxy.reset();break;
    case 'inspect':selectSystem(el.dataset.system);galaxy.focus(el.dataset.system);break;
    case 'build-menu':buildMenu(el.dataset.system);break;
    case 'development-menu':buildMenu(el.dataset.system,'charter');break;
    case 'construction-tab':buildMenu(el.dataset.system,el.dataset.tab);break;
    case 'develop':if(dispatch({type:'develop',systemId:el.dataset.system,charterType:el.dataset.charter}))closeModal();break;
    case 'build':if(dispatch({type:'build',systemId:el.dataset.system,itemId:el.dataset.item,replaceBuildingId:el.dataset.replace||null}))closeModal();break;
    case 'cancel-build':dispatch({type:'cancelBuild',systemId:el.dataset.system});break;
    case 'research':dispatch({type:'research',techId:el.dataset.tech});break;
    case 'plan-route':if(dispatch({type:'planRoute',fleetId:selectedFleetId,destinationId:el.dataset.destination}))galaxy.focusRoute?.(fleetById(selectedFleetId)?.route?.path);break;
    case 'fit-route':galaxy.focusRoute?.(fleetById(selectedFleetId)?.route?.path);break;
    case 'continue-route':dispatch({type:'continueRoute',fleetId:selectedFleetId});break;
    case 'clear-route':dispatch({type:'clearRoute',fleetId:selectedFleetId});break;
    case 'replot-route':{const destinationId=fleetById(selectedFleetId)?.route?.destinationId;if(destinationId&&dispatch({type:'planRoute',fleetId:selectedFleetId,destinationId}))galaxy.focusRoute?.(fleetById(selectedFleetId)?.route?.path);break;}
    case 'move':dispatch({type:'move',fleetId:selectedFleetId,targetId:el.dataset.target});break;
    case 'colonize':openModal('colonize',`<div class="eyebrow">A NEW WORLD</div><h2 id="modal-title">Settle ${escape(systemById(fleetById(selectedFleetId).systemId).name)}?</h2><p class="modal-lead">Your Colony Ark will become the foundation of a new settlement. Establishing the colony consumes the ark, 30 credits, 20 minerals, and 1 order.</p><p class="empty-note">Worlds need at least ${player().techs.includes('terraforming')?0:player().techs.includes('ecology')?30:50}% habitability with your current technology.</p><div class="modal-actions"><button data-action="close-modal">Wait</button><button class="primary" data-action="colonize-confirm">Found colony →</button></div>`);break;
    case 'colonize-confirm':if(dispatch({type:'colonize',fleetId:selectedFleetId}))closeModal();break;
    case 'attack':dispatch({type:'attack',fleetId:selectedFleetId});break;
    case 'repair':dispatch({type:'repair',fleetId:selectedFleetId});break;
    case 'merge':mergeFleets(el.dataset.fleetTarget||selectedFleetId,el.dataset.target);break;
    case 'merge-menu':showMerge(el.dataset.fleetTarget);break;
    case 'merge-confirm':mergeFleets(el.dataset.fleetTarget,el.dataset.target,true);break;
    case 'reinforce': {
      const preview=getReinforcementPreview(state,el.dataset.fleetTarget);
      if(!preview||preview.fleetId!==selectedFleetId||preview.systemId!==selectedSystemId)break;
      if(!preview.enabled){toast(preview.reason,true);break;}
      if(dispatch(preview.command))$('.reinforcement-panel')?.focus({preventScroll:true});
      break;
    }
    case 'split-menu':showSplit(el.dataset.fleetTarget);break;
    case 'split-confirm':if(dispatch({type:'split',fleetId:el.dataset.fleetTarget,ships:Number(el.dataset.ships)}))closeModal();break;
    case 'fleet-heritage':showFleetHeritage(el.dataset.fleetTarget);break;
    case 'heritage-origin':showAnomaly(el.dataset.system);break;
    case 'anomaly':showAnomaly(el.dataset.system);break;
    case 'anomaly-choice':if(dispatch({type:'anomaly',systemId:el.dataset.system,choiceId:el.dataset.choice,replaceBuildingId:el.dataset.replace||null}))closeModal();break;
    case 'diplomacy':dispatch({type:'diplomacy',targetId:el.dataset.target,stance:el.dataset.stance,offerId:el.dataset.offer});break;
    case 'review-peace':showPeaceOffer(el.dataset.offer);break;
    case 'review-trade':showTradeOffer(el.dataset.offer);break;
    case 'peace-response':if(dispatch({type:'diplomacy',targetId:el.dataset.target,stance:el.dataset.stance,offerId:el.dataset.offer}))closeModal();break;
    case 'trade-response':if(dispatch({type:'diplomacy',targetId:el.dataset.target,stance:el.dataset.stance,offerId:el.dataset.offer}))closeModal();break;
    case 'peace-confirmation':showDiplomaticConfirmation('peace',el.dataset.target);break;
    case 'end-trade-confirmation':showDiplomaticConfirmation('endTrade',el.dataset.target);break;
    case 'diplomatic-confirm':if(dispatch({type:'diplomacy',targetId:el.dataset.target,stance:el.dataset.stance}))closeModal();break;
    case 'declare-war':openModal('war',`<div class="eyebrow">A POINT OF NO RETURN</div><h2 id="modal-title">War with ${escape(FACTIONS[el.dataset.target].shortName)}?</h2><p class="modal-lead">Trade will end immediately. Fleets will fight on contact, and colonies can be invaded. Peace negotiations will remain closed for five cycles.${player().relations[el.dataset.target].trade?' Breaking this trade agreement also incurs a severe trust penalty and a lasting grievance.':''}</p><div class="modal-actions"><button data-action="close-modal">Stand down</button><button class="danger" data-action="war-confirm" data-target="${el.dataset.target}">Declare war · 1 order</button></div>`);break;
    case 'war-confirm':if(dispatch({type:'diplomacy',targetId:el.dataset.target,stance:'war'}))closeModal();break;
    case 'end-turn':advanceTurn();break;
    case 'end-turn-confirm':advanceTurn(true);break;
    case 'export':exportSave();break;
    case 'import':$('#import-save').click();break;
    case 'new-game-menu':openModal('new-game',`<div class="eyebrow">ANOTHER POSSIBLE FUTURE</div><h2 id="modal-title">Begin a new age</h2><p class="modal-lead">A new campaign replaces your autosave. Export this campaign from the menu if you want to return to it.</p><label class="form-label" for="galaxy-seed">Galaxy seed · the same seed creates the same frontier</label><input id="galaxy-seed" maxlength="48" value="${escape(`REACH-${Math.floor(Math.random()*90000+10000)}`)}"><div class="modal-actions"><button data-action="export">Export current</button><button class="primary" data-action="new-game-confirm">Begin campaign →</button></div>`);break;
    case 'new-game-confirm':state=createGame($('#galaxy-seed').value.trim()||'ASTERION');selectedSystemId='s0';selectedFleetId=state.fleets.find(f=>f.owner==='player'&&f.type==='scout').id;closeModal();setPage('galaxy');save();render();galaxy.reset();showWelcome();break;
  }
});
document.addEventListener('keydown',event=>{
  if (modalType) {
    if (event.key==='Escape'){event.preventDefault();closeModal();}
    if(event.key==='Tab'){const focusable=[...document.querySelectorAll('.modal button:not(:disabled),.modal a[href],.modal input:not(:disabled),.modal select:not(:disabled),.modal textarea:not(:disabled),.modal summary,.modal [tabindex]')].filter(el=>el.tabIndex>=0&&el.getClientRects().length&&!el.matches(':disabled'));const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    return;
  }
  if (event.target.matches('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey) return;
  if(event.code==='Space'&&!event.repeat&&!event.target.matches('button,a')){event.preventDefault();advanceTurn();}
  if (['1','2','3','4','5'].includes(event.key)) setPage(['galaxy','research','diplomacy','empire','journal'][Number(event.key)-1]);
  if(event.key.toLowerCase()==='n')nextFleet();
  if(event.key.toLowerCase()==='h'){selectSystem(player().capitalId);galaxy.focus(player().capitalId);}
  if(event.key==='Escape'){selectedFleetId=null;render();}
  if(event.key==='?')window.open('./guide.html','_blank','noopener');
});
render();
fleetById(selectedFleetId)?.route?galaxy.focusRoute?.(fleetById(selectedFleetId).route.path):galaxy.focus(selectedSystemId);
if(importedError)toast(importedError,true);
if(isNew)showWelcome();
// Read-only inspection hook for reproducible browser acceptance, never a mutation API.
window.__asterion={getState:()=>structuredClone(state),getPage:()=>page};
