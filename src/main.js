import './style.css';
import { GalaxyView } from './galaxy.js';
import { createGame, command, endTurn, getEmpireStats, getSystemYield, getVisibleSystems, getNeighbors, getBuildOptions, getResearchOptions, getVictoryProgress, fleetPower, estimateCombat, validateSave } from './game.js';
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
let state, settings = { warnUnspent: true }, saveError = false, importedError = '';
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch {}
try { const saved = JSON.parse(localStorage.getItem(SAVE_KEY)); if (validateSave(saved)) state = saved; else if (saved) importedError = 'The previous save could not be read. Your new campaign is ready.'; } catch { importedError = 'Browser storage is unavailable or the previous save is invalid. Use Export in the menu to keep a backup.'; }
const isNew = !state;
state ||= createGame('ASTERION');
let selectedSystemId = state.factions.find(f => f.id === 'player').capitalId;
let selectedFleetId = state.fleets.find(f => f.owner === 'player' && f.type === 'scout')?.id || null;
let page = 'galaxy', researchFilter = 'All', logFilter = 'All', modalType = null, lastFocus = null, previousTurn = state.turn;
const player = () => state.factions.find(f => f.id === 'player');
const systemById = id => state.systems.find(s => s.id === id);
const fleetById = id => state.fleets.find(f => f.id === id);

$('#app').innerHTML = `<div class="app-shell">
  <header class="topbar"><div class="brand"><div class="brand-mark">${icon('mark',34)}</div><div><h1>ASTERION REACH</h1><small>THE STARS REMEMBER</small></div></div><div class="resources" id="resources"></div><div class="top-actions"><a href="./guide.html" target="_blank" rel="noopener" aria-label="Open field guide" title="Field guide (?)">${icon('help')}</a><button data-action="menu" aria-label="Game menu" title="Game menu">${icon('menu')}</button></div></header>
  <nav class="rail" aria-label="Command views">${[['galaxy','Galaxy'],['research','Research'],['diplomacy','Diplomacy'],['empire','Empire'],['journal','Chronicle']].map(([id,label],i)=>`<button data-page="${id}" class="${id==='galaxy'?'active':''}" title="${label} (${i+1})">${icon(id)}<span>${label}</span></button>`).join('')}<div class="rail-bottom"><button data-action="home" title="Focus homeworld (H)">${icon('home')}<span>Home</span></button></div></nav>
  <main class="main-stage"><div class="galaxy-page" id="galaxy-page"><div class="map-canvas" id="galaxy" aria-label="Interactive galaxy map"></div><div class="map-heading"><div class="eyebrow">CONCORD EXPLORATION AUTHORITY</div><h2>The Asterion Reach</h2><p id="map-meta"></p></div><div class="map-tools"><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="reset-view" title="Fit galaxy" aria-label="Fit galaxy">⌖</button></div><div class="map-message" id="mandate"></div><div class="map-caption">PER ASPERA, AD ASTRA</div><div class="map-legend"><span><i></i>CONCORD</span><span><i style="background:#d9bd7c"></i>CHARTED</span><span><i style="background:#596a82"></i>UNKNOWN</span></div><div class="fleet-bar" id="fleet-bar"></div></div><div class="workspace-page" id="workspace-page" hidden></div></main>
  <aside class="inspector" aria-label="System inspector"><div class="inspector-content" id="inspector"></div><div class="turn-panel"><div class="turn-meta"><b id="turn-number"></b><span id="turn-year"></span></div><button class="primary end-turn" data-action="end-turn" id="end-turn"><span>End cycle →</span><kbd>SPACE</kbd></button><div class="turn-hint" id="turn-hint"></div></div></aside>
  <footer class="statusbar"><span class="status-message" id="status-message">Your mandate begins among the stars.</span><span class="version">ASTERION REACH <span class="green">/</span> EARLY ACCESS 0.1</span><span id="save-status">LOCAL CAMPAIGN</span></footer></div><div id="modal-root"></div><div class="toast-stack" id="toasts" role="status" aria-live="polite"></div><input class="sr-only" type="file" id="import-save" accept="application/json,.json" aria-label="Import campaign save" />`;

const galaxy = new GalaxyView($('#galaxy'), { onSelect: selectSystem, onFleetSelect: selectFleet });
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); saveError = false; $('#save-status').textContent = '● AUTOSAVED'; }
  catch { if (!saveError) toast('Autosave unavailable. Export your campaign from the menu.', true); saveError = true; $('#save-status').textContent = 'SAVE UNAVAILABLE'; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), error ? 6500 : 4200);
  $('#status-message').textContent = message;
}
function selectSystem(id) { if (!systemById(id)?.knownBy.includes('player')) return; selectedSystemId = id; if (page !== 'galaxy') setPage('galaxy'); render(); }
function selectFleet(id) { const fleet = fleetById(id); if (!fleet || fleet.owner !== 'player') return; selectedFleetId = id; selectedSystemId = fleet.systemId; if (page !== 'galaxy') setPage('galaxy'); render(); }
function setPage(value) { page = value; galaxy.setPaused?.(Boolean(modalType) || page !== 'galaxy'); $('#galaxy-page').hidden = page !== 'galaxy'; $('#workspace-page').hidden = page === 'galaxy'; document.querySelectorAll('[data-page]').forEach(el => { el.classList.toggle('active',el.dataset.page === page); el.setAttribute('aria-current',el.dataset.page === page ? 'page' : 'false'); }); renderPage(); }
function dispatch(action) {
  const result = command(state, action);
  if (!result.ok) { toast(result.message, true); return false; }
  if (action.type === 'move' && fleetById(action.fleetId)) selectedSystemId = fleetById(action.fleetId).systemId;
  if (selectedFleetId && !fleetById(selectedFleetId)) selectedFleetId = null;
  save(); render(); toast(result.message); if (state.winner) showVictory(); return true;
}
function render() {
  const p = player(), stats = getEmpireStats(state);
  $('#resources').innerHTML = [['credits','◈','Credits',stats.credits,stats.creditIncome],['minerals','◇','Minerals',stats.minerals,stats.mineralIncome],['science','✧','Science',stats.science,stats.scienceIncome],['orders','⌘','Orders',stats.orders,null]].map(([key,symbol,label,value,delta])=>`<div class="resource ${key}" title="${label}: ${num(value)}${delta!==null?`; ${signed(delta)} per cycle${key==='credits'?` after ${stats.upkeep} fleet upkeep`:''}`:` of ${stats.maxOrders} available this cycle`}"><span class="symbol" aria-hidden="true">${symbol}</span><div><strong>${num(value)}${key==='orders'?`<small style="color:#6f8996"> / ${stats.maxOrders}</small>`:''}</strong>${delta!==null?`<span class="delta ${delta<0?'negative':''}">${signed(delta)}</span>`:''}<label>${label}</label></div></div>`).join('');
  $('#turn-number').textContent = `Cycle ${String(state.turn).padStart(2,'0')}`; $('#turn-year').textContent = `${2400 + state.turn - 1} CE`;
  $('#turn-hint').textContent = state.winner ? 'The chronicle of this age is complete.' : `${stats.orders} orders remaining · ${stats.colonies} ${stats.colonies===1?'colony':'colonies'}`;
  $('#end-turn').disabled = !!state.winner;
  $('#map-meta').innerHTML = `<span class="live-dot"></span>${getVisibleSystems(state).length} charted systems · ${stats.explored} surveyed · seed ${escape(state.seed)}`;
  const mandate = stats.colonies<2 ? ['YOUR FIRST MANDATE','Scout a neighboring star. Send your Colony Ark to a habitable world and establish a second home.'] : !p.research && p.techs.length<12 ? ['THE NEXT HORIZON','Your archives await direction. Choose a research project to turn discoveries into progress.'] : stats.beacons>0 ? ['THE ANCIENT NETWORK',`${stats.beacons} of 3 Asterion Beacons restored. Protect your worlds as the network awakens.`] : ['A CIVILIZATION TAKES SHAPE',`${stats.colonies} worlds share your future. Develop your economy, meet the frontier powers, and choose your path to victory.`];
  $('#mandate').innerHTML = `<strong>${mandate[0]}</strong>${mandate[1]}`;
  renderInspector(); renderFleet(); renderPage(); galaxy.update(state, selectedSystemId, selectedFleetId);
}
function renderInspector() {
  const system = systemById(selectedSystemId); if (!system) return;
  const surveyed = system.exploredBy.includes('player'), mine = system.owner === 'player', owner = FACTIONS[system.owner], planet = PLANET_TYPES[system.type], output = getSystemYield(state,system);
  const hasSensors = mine || state.fleets.some(f => f.owner === 'player' && f.systemId === system.id);
  const orbit = state.fleets.filter(f => f.systemId === system.id && (f.owner === 'player' || hasSensors));
  let html = `<div class="system-header"><div class="owner-tag" style="color:${owner?.color||'#bba77e'}"><i></i>${owner?escape(owner.name):'UNCLAIMED FRONTIER'}</div><h2>${escape(system.name)}</h2><p class="subtitle">${surveyed?`${escape(planet.name)} world · ${system.originalOwner?'Founding system':'Frontier system'}`:'Unsurveyed system · Charted starlanes'}</p></div><div class="planet-art"><div class="planet-sphere" style="--planet:${surveyed?planet.color:'#5a6477'}"></div></div><p class="system-description">${surveyed?escape(planet.description):'Send a fleet to survey this system and reveal its worlds, resources, and hidden history.'}</p>`;
  if (surveyed) html += `<div class="stat-grid"><div class="stat-cell"><b>${system.habitability}%</b><span>Habitability</span></div><div class="stat-cell"><b>${mine?`${system.population}/${output.capacity}`:system.richness}</b><span>${mine?'Population':'Ore richness'}</span></div><div class="stat-cell"><b>${mine?output.production:system.science}</b><span>${mine?'Production':'Science'}</span></div></div>`;
  if (mine) {
    const queue = system.queue, item = queue && (BUILDINGS[queue.itemId]||SHIPS[queue.itemId]);
    html += `<section class="panel-section"><div class="section-label">Colony production <span>${output.production} / cycle</span></div>${queue?`<div class="production-row"><span class="big-icon">${item.icon}</span><div><b>${escape(item.name)}</b><p>${Math.ceil((queue.work-queue.progress)/output.production)} cycles to completion</p></div><button class="small-button ghost" data-action="cancel-build" data-system="${system.id}" title="Cancel and refund unspent work">×</button></div><div class="progress-track"><i style="width:${queue.progress/queue.work*100}%"></i></div>`:`<p class="empty-note">Your construction teams await a new project.</p><button class="wide-button" data-action="build-menu" data-system="${system.id}">+ Commission a project</button>`}</section><section class="panel-section"><div class="section-label">Infrastructure <span>${system.buildings.length} installed</span></div><div class="building-pills">${system.buildings.map(id=>`<span class="building-pill" title="${escape(BUILDINGS[id].description)}">${BUILDINGS[id].icon} ${escape(BUILDINGS[id].name)}</span>`).join('')||'<p class="empty-note">A new world, waiting to take shape.</p>'}</div><p class="empty-note" style="margin-top:12px">${signed(output.credits)} credits · ${signed(output.minerals)} minerals · ${signed(output.science)} science</p></section>`;
  }
  if (surveyed && system.anomaly && !system.anomaly.resolved) html += `<section class="panel-section"><div class="section-label">Unusual signal <span>✦</span></div><p style="font-family:var(--heading);font-size:17px;color:var(--gold)">${escape(ANOMALIES[system.anomaly.id].name)}</p><button class="wide-button" data-action="anomaly" data-system="${system.id}">Investigate discovery · 1 order</button></section>`;
  if (orbit.length) html += `<section class="panel-section"><div class="section-label">In orbit <span>${orbit.length} ${orbit.length===1?'fleet':'fleets'}</span></div><div class="fleet-list">${orbit.map(f=>`<button class="fleet-row ${f.id===selectedFleetId?'selected':''}" data-fleet="${f.id}" ${f.owner!=='player'?'disabled':''}><span class="ship-symbol" style="color:${FACTIONS[f.owner].color}">${SHIPS[f.type].icon}</span><span class="fleet-name">${escape(f.name)}${f.ships>1?` ×${f.ships}`:''}<small>${f.owner==='player'?SHIPS[f.type].role:FACTIONS[f.owner].shortName} · ${Math.ceil(f.hp)} hull</small></span><span class="fleet-ready">${f.owner==='player'?`${f.movesLeft} ⌁`:''}</span></button>`).join('')}</div></section>`;
  const neighbors = getNeighbors(state,system.id).map(systemById).filter(s=>s.knownBy.includes('player'));
  html += `<section class="panel-section"><div class="section-label">Connected systems</div><div class="building-pills">${neighbors.map(s=>`<button class="small-button ghost" data-system-select="${s.id}">${escape(s.name)} ↗</button>`).join('')}</div></section>`;
  $('#inspector').innerHTML = html;
}
function movementReason(fleet, target) {
  if (!getNeighbors(state,fleet.systemId).includes(target.id)) return 'Choose a star connected by a starlane.';
  if (!fleet.movesLeft) return 'Movement spent. End the cycle to move again.';
  if (!player().orders) return 'No orders remain this cycle.';
  if (target.owner && target.owner!=='player' && player().relations[target.owner].status!=='war' && !player().relations[target.owner].trade) return 'Borders closed. Negotiate trade or declare war.';
  if (SHIPS[fleet.type].attack<4 && state.fleets.some(f=>f.systemId===target.id && f.owner!=='player' && player().relations[f.owner].status==='war')) return 'Hostile fleet present. Civilian ships cannot enter.';
  return '';
}
function renderFleet() {
  const fleet = fleetById(selectedFleetId), target = systemById(selectedSystemId), ownFleets = state.fleets.filter(f=>f.owner==='player');
  if (!fleet) { $('#fleet-bar').innerHTML = `<div class="fleet-title"><div class="empty-fleet">A galaxy of possibilities.</div><p>Select a fleet in orbit to explore the frontier.</p></div>${ownFleets[0]?`<button data-fleet="${ownFleets[0].id}">Select fleet →</button>`:''}`; return; }
  const home = systemById(fleet.systemId), ship = SHIPS[fleet.type], different = target.id!==home.id;
  let detail = `${ship.role} · ${fleet.ships} ${fleet.ships===1?'ship':'ships'} · ${fleet.movesLeft} jumps · ${Math.ceil(fleet.hp)}/${fleet.ships*ship.hp} hull`, actions='';
  if (different) {
    const reason = movementReason(fleet,target), war = target.owner && target.owner!=='player' && player().relations[target.owner].status==='war';
    detail = reason || `${home.name} → ${target.name} · 1 order${war?` · ${estimateCombat(state,fleet.id,target.id).odds} engagement`:''}`;
    actions = `<button class="primary" data-action="move" data-target="${target.id}" ${reason?'disabled':''}>${war?'Engage':'Move'} →</button><button class="ghost small-button" data-system-select="${home.id}" title="Back to fleet">↶</button>`;
  } else {
    if (fleet.type==='colony' && !home.owner) actions += `<button class="primary" data-action="colonize">Settle world</button>`;
    if (home.owner && home.owner!=='player' && player().relations[home.owner].status==='war' && ship.attack>3) actions += '<button class="danger" data-action="attack">Invade</button>';
    if (state.fleets.some(f=>f.systemId===home.id && f.owner!=='player' && player().relations[f.owner].status==='war') && ship.attack>3) actions += '<button class="danger" data-action="attack">Engage</button>';
    if (home.owner==='player' && fleet.hp<fleet.ships*ship.hp) actions += '<button data-action="repair">Repair ◇10</button>';
    const merge = ownFleets.find(f=>f.id!==fleet.id && f.systemId===home.id && f.type===fleet.type && fleet.type!=='colony');
    if (merge) actions += `<button data-action="merge" data-target="${merge.id}" title="Merge ${escape(merge.name)} into this fleet; 1 order">Merge +${merge.ships}</button>`;
    if (!actions) detail += ' · Select a connected star to plot a jump.';
  }
  $('#fleet-bar').innerHTML = `<span class="fleet-icon">${ship.icon}</span><div class="fleet-title"><h3>${escape(fleet.name)} <span style="font-weight:400;color:#7f9aa9">/ ${escape(home.name)}</span></h3><p>${escape(detail)}</p></div>${actions}<div class="fleet-switch">${ownFleets.slice(0,4).map(f=>`<button data-fleet="${f.id}" class="${f.id===fleet.id?'selected':''}" title="${escape(f.name)} at ${escape(systemById(f.systemId).name)}">${SHIPS[f.type].icon}</button>`).join('')}</div>`;
}
function renderPage() {
  if (page==='galaxy') return;
  const stats = getEmpireStats(state), p=player();
  let html='';
  if (page==='research') {
    const current=p.research && TECHS[p.research.techId];
    html = `<div class="page-top"><div><div class="eyebrow">THE CONCORD ARCHIVES</div><h2>Beyond the known</h2><p>Rediscover the sciences that once connected the stars. Each breakthrough opens a different future for your civilization.</p></div><div class="page-symbol">✧</div></div>${current?`<div class="callout"><strong>${escape(current.name)}</strong> · ${p.research.progress} / ${current.cost} science · ${Math.ceil((current.cost-p.research.progress)/Math.max(1,stats.scienceIncome))} cycles remaining<div class="progress-track"><i style="width:${p.research.progress/current.cost*100}%"></i></div></div>`:`<div class="callout">${p.techs.length===Object.keys(TECHS).length?'The archives are complete. Your civilization has mastered the sciences of this age.':'<strong>Choose a research direction.</strong> Science accumulates in your reserves until assigned. Selecting or changing a project uses no orders.'}</div>`}<div class="filter-tabs">${['All','Engineering','Society','Physics','Military'].map(c=>`<button class="${researchFilter===c?'active':''}" data-research-filter="${c}">${c}</button>`).join('')}</div><div class="tech-grid">${getResearchOptions(state).filter(t=>researchFilter==='All'||t.category===researchFilter).map(t=>`<article class="tech-card ${t.completed?'researched':t.active?'current':!t.enabled?'locked':''}"><div class="tech-top"><span>${t.category}</span><span>${t.completed?'✓ DISCOVERED':`✧ ${t.cost}`}</span></div><h3>${escape(t.name)}</h3><p>${escape(t.description)}</p><div class="tech-footer"><span>${t.requires.length?`Requires ${t.requires.map(id=>escape(TECHS[id].name)).join(' + ')}`:'Foundational science'}</span><button data-action="research" data-tech="${t.id}" ${!t.enabled?'disabled':''} title="${escape(t.reason)}">${t.completed?'Complete':t.active?'In progress':'Research →'}</button></div></article>`).join('')}</div>`;
  } else if (page==='diplomacy') {
    html=`<div class="page-top"><div><div class="eyebrow">THE INTERSTELLAR ASSEMBLY</div><h2>Voices in the void</h2><p>Rivals have ambitions of their own. Trade opens borders and brings shared prosperity; war turns every starlane into a frontier.</p></div><div class="page-symbol">⛨</div></div>`;
    for (const faction of state.factions.filter(f=>f.id!=='player')) {
      const contact=p.contacts.includes(faction.id), relation=p.relations[faction.id];
      html+=`<article class="rival-card" style="--faction:${faction.color}"><div class="rival-seal">${{veyr:'◈',khar:'⛨',choir:'✧'}[faction.id]}</div><div><h3>${contact?escape(faction.name):'Unidentified civilization'}<span class="relation-tag ${relation.status==='war'?'war':''}">${contact?(faction.eliminated?'Fallen':relation.trade?'Trade partner':relation.status):'No contact'}</span></h3><div class="leader">${contact?escape(faction.leader):'A signal beyond our charted stars'}</div><p>${contact?`${escape(faction.description)}<br><em>“${escape(faction.motto)}”</em>`:'Explore connected systems to establish first contact. Our envoys cannot negotiate with a civilization we have not encountered.'}</p>${contact&&!faction.eliminated?`<p class="empty-note">Trust ${relation.trust} · ${relation.trade?`Trade income +${p.techs.includes('diplomacy')?10:6} credits / cycle · Open borders`:relation.status==='war'?'Military access · Hostile fleets engage on arrival':'Closed borders'} · Every proposal uses 1 order</p><div class="rival-actions">${relation.status==='war'?`<button data-action="diplomacy" data-stance="peace" data-target="${faction.id}">Negotiate peace ◈60</button>`:`${!relation.trade?`<button data-action="diplomacy" data-stance="trade" data-target="${faction.id}">Trade treaty ◈30</button>`:''}<button data-action="diplomacy" data-stance="gift" data-target="${faction.id}">Send gift ◈35</button><button class="danger" data-action="declare-war" data-target="${faction.id}">Declare war</button>`}</div>`:''}</div></article>`;
    }
  } else if (page==='empire') {
    const victory=getVictoryProgress(state), colonies=state.systems.filter(s=>s.owner==='player');
    html=`<div class="page-top"><div><div class="eyebrow">MANY WORLDS. ONE HORIZON.</div><h2>The Concord</h2><p>Make a civilization worth inheriting. Prosperity, knowledge, and the strength to protect them are all part of your legacy.</p></div><div class="page-symbol">⌘</div></div><div class="empire-overview"><div class="overview-card"><div class="eyebrow">COLONIZED WORLDS</div><strong>${stats.colonies}</strong><p>${stats.population} billion citizens across the Reach</p></div><div class="overview-card"><div class="eyebrow">FLEET POWER</div><strong>${num(stats.military)}</strong><p>${stats.ships} ships · ${stats.upkeep} credits upkeep / cycle</p></div><div class="overview-card"><div class="eyebrow">LEGACY SCORE</div><strong>${num(stats.score)}</strong><p>Highest score at cycle ${victory.legacy.finalTurn} wins</p></div></div><div class="section-label">Colonial administration</div><table class="colony-table"><thead><tr><th>World</th><th>Population</th><th>Income</th><th>Construction</th><th></th></tr></thead><tbody>${colonies.map(s=>`<tr><td>${escape(s.name)}</td><td>${s.population} / ${getSystemYield(state,s).capacity}</td><td>◈ ${getSystemYield(state,s).credits} · ◇ ${getSystemYield(state,s).minerals}</td><td>${s.queue?escape((BUILDINGS[s.queue.itemId]||SHIPS[s.queue.itemId]).name):'Idle'}</td><td><button data-action="inspect" data-system="${s.id}">Inspect →</button></td></tr>`).join('')}</tbody></table><div class="victory-grid"><div class="victory-card"><h3>✦ Transcendence</h3><p>Research the Asterion Protocol, then complete a Beacon on three worlds. The ancient network will awaken.</p><div class="progress-track"><i style="width:${victory.transcendence.current/3*100}%"></i></div><p style="margin-top:10px">${victory.transcendence.current} / 3 beacons · ${victory.transcendence.unlocked?'Protocol unlocked':'Protocol undiscovered'}</p></div><div class="victory-card"><h3>⛨ Domination</h3><p>Unite the Reach under one banner by holding all four founding homeworlds at the same time.</p><div class="progress-track"><i style="width:${victory.domination.current/4*100}%"></i></div><p style="margin-top:10px">${victory.domination.current} / 4 founding systems</p></div></div><div class="panel-section" style="margin-top:22px;padding-left:0;padding-right:0"><div class="section-label">Fleet registry</div><div class="fleet-list">${state.fleets.filter(f=>f.owner==='player').map(f=>`<button class="fleet-row" data-fleet="${f.id}"><span class="ship-symbol">${SHIPS[f.type].icon}</span><span class="fleet-name">${escape(f.name)} ×${f.ships}<small>${escape(systemById(f.systemId).name)} · ${Math.ceil(f.hp)} hull · ${fleetPower(state,f)} combat power</small></span><span class="fleet-ready">${f.movesLeft} jumps</span></button>`).join('')}</div></div>`;
  } else if (page==='journal') {
    html=`<div class="page-top"><div><div class="eyebrow">THE RECORD OF AN AGE</div><h2>Your chronicle</h2><p>Every discovery, every world, every promise. The story of your civilization, one cycle at a time.</p></div><div class="page-symbol">☷</div></div><div class="filter-tabs">${['All','discovery','construction','combat','diplomacy'].map(c=>`<button data-log-filter="${c}" class="${logFilter===c?'active':''}">${c[0].toUpperCase()+c.slice(1)}</button>`).join('')}</div>${state.log.filter(l=>logFilter==='All'||l.type===logFilter).map(l=>`<article class="log-item"><div><time>CYCLE ${String(l.turn).padStart(2,'0')}</time><div class="log-type">${escape(l.type)}</div></div><p>${escape(l.text)}</p></article>`).join('')||'<p class="empty-note">This chapter has yet to be written.</p>'}`;
  }
  $('#workspace-page').innerHTML=html;
}
function openModal(type,html,wide=false) {
  if (!modalType) lastFocus=document.activeElement;
  modalType=type; galaxy.setPaused?.(true); $('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal ${wide?'wide':''} ${type==='welcome'?'welcome':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="close-modal" data-action="close-modal" aria-label="Close dialog">×</button>${html}</section></div>`;
  const focusTarget=$('.modal .primary') || $('.modal button'); focusTarget?.focus();
}
function closeModal() { modalType=null; galaxy.setPaused?.(page !== 'galaxy'); $('#modal-root').innerHTML=''; lastFocus?.isConnected && lastFocus.focus(); }
function buildMenu(systemId) {
  const system=systemById(systemId), options=getBuildOptions(state,systemId);
  openModal('build',`<div class="eyebrow">COLONIAL COMMISSION · ${escape(system.name)}</div><h2 id="modal-title">Shape this world's future</h2><p class="modal-lead">Each commission uses one order. Materials are paid now; local production completes the project over the following cycles.</p>${['building','ship'].map(kind=>`<div class="modal-subhead">${kind==='building'?'Planetary infrastructure':'Orbital shipyard'}</div><div class="build-grid">${options.filter(o=>o.kind===kind).map(o=>`<button class="build-card" data-action="build" data-system="${systemId}" data-item="${o.id}" ${!o.enabled?'disabled':''} title="${escape(o.reason||o.description)}"><span class="build-icon">${o.icon}</span><div><b>${escape(o.name)}</b><p>${escape(o.description)}</p><div class="build-cost">◈ ${o.cost.credits} &nbsp; ◇ ${o.cost.minerals} &nbsp; · ${o.turns} cycles${kind==='ship'?` · ${o.upkeep} upkeep`:''}</div>${o.reason?`<p style="color:#d2a887;margin-top:7px">${escape(o.reason)}</p>`:''}</div></button>`).join('')}</div>`).join('')}`,true);
}
function showAnomaly(systemId) {
  const system=systemById(systemId), anomaly=ANOMALIES[system.anomaly?.id]; if (!anomaly) return;
  openModal('anomaly',`<div class="eyebrow">EXPEDITION REPORT · ${escape(system.name)}</div><h2 id="modal-title">${escape(anomaly.name)}</h2><p class="modal-lead">${escape(anomaly.description)}</p>${anomaly.choices.map(c=>`<button class="choice-card" data-action="anomaly-choice" data-system="${systemId}" data-choice="${c.id}"><b>${escape(c.label)} →</b><p>${escape(c.description)} · 1 order</p></button>`).join('')}<p class="empty-note" style="margin-top:17px">An expedition must be present, or this world must belong to you. The choice is permanent.</p>`);
}
function showMenu() {
  openModal('menu',`<div class="eyebrow">CAMPAIGN CONTROL</div><h2 id="modal-title">A moment among the stars</h2><p class="modal-lead">Cycle ${state.turn} · ${escape(state.seed)} · The Concord</p><div class="menu-grid"><button data-action="export">↓ Export campaign</button><button data-action="import">↑ Import campaign</button><a href="./guide.html" target="_blank" rel="noopener">Read the field guide ↗</a><button data-action="new-game-menu">Begin a new campaign</button></div><p class="save-meta">${saveError?'Browser autosave is unavailable. Export a backup to preserve progress.':'Progress is automatically saved in this browser after every action. Export a backup to move your campaign to another device.'}</p><label style="font-size:12px;display:flex;gap:10px;align-items:center"><input type="checkbox" id="warn-unspent" ${settings.warnUnspent?'checked':''} style="width:auto">Warn before ending a cycle with unused orders</label><div class="modal-actions"><button class="primary" data-action="close-modal">Return to the Reach</button></div>`);
}
function showWelcome() {
  openModal('welcome',`<div class="welcome-emblem">✦</div><div class="eyebrow">A NEW CHAPTER AMONG THE STARS</div><h2 id="modal-title">The Reach is calling.</h2><p class="modal-lead">For centuries, the ancient gates have been silent.<br>From the oceans of Solace, the Concord looks outward once more.<br>You have a homeworld, three ships, and a future to decide.</p><div class="welcome-steps"><div><span>01 / EXPLORE</span><b>Follow the starlanes</b><p>Select your Pathfinder, then a neighboring star. Choose Move to survey it.</p></div><div><span>02 / ESTABLISH</span><b>Found a second home</b><p>Move your Colony Ark to a habitable world. Settle it to grow your empire.</p></div><div><span>03 / ENDURE</span><b>Every order matters</b><p>Build, research, and meet your rivals. End each cycle to renew your orders.</p></div></div><div class="modal-actions"><a href="./guide.html" target="_blank" rel="noopener" style="align-self:center;font-size:11px;margin-right:12px">Field guide ↗</a><button class="primary" data-action="begin">Take command →</button></div>`);
}
function advanceTurn(force=false) {
  const stats=getEmpireStats(state), idle=state.fleets.filter(f=>f.owner==='player'&&f.movesLeft>0).length;
  if (!force && settings.warnUnspent && stats.orders>0 && (idle || !player().research)) {
    openModal('end-confirm',`<div class="eyebrow">BEFORE THE NEXT CYCLE</div><h2 id="modal-title">Conclude your mandate?</h2><p class="modal-lead">${stats.orders} orders remain${idle?`, and ${idle} ${idle===1?'fleet has':'fleets have'} movement available`:''}. Unused orders do not carry over.${!player().research&&player().techs.length<12?' Your researchers have no assigned project; their science will remain in reserve.':''}</p><p class="empty-note">Rival empires will act, colonies will grow, production and research will advance, and your orders will replenish.</p><div class="modal-actions"><button data-action="close-modal">Keep planning</button><button class="primary" data-action="end-turn-confirm">End cycle →</button></div>`); return;
  }
  closeModal(); const result=endTurn(state); if (!result.ok) return toast(result.message,true);
  previousTurn=state.turn-1; save(); render(); toast(result.message);
  if (state.winner) showVictory();
  else {
    const important=state.log.filter(l=>l.turn>=previousTurn && ['construction','research','war','combat'].includes(l.type)).slice(0,3);
    if (important.length) $('#status-message').textContent=important.map(l=>l.text).join(' · ');
  }
}
function showVictory() {
  const won=state.winner==='player';
  openModal('victory',`<div class="eyebrow">THE END OF AN AGE · CYCLE ${state.turn}</div><h2 id="modal-title">${won?'The stars remember your name.':'A new power shapes the Reach.'}</h2><p class="modal-lead">${escape(FACTIONS[state.winner]?.name||'The galaxy')} · ${escape(state.victoryType)}<br>Your legacy: ${getEmpireStats(state).score} points, ${getEmpireStats(state).colonies} worlds, ${player().techs.length} discoveries.</p><p class="empty-note">Your chronicle and galaxy remain available to inspect. Export the campaign from the menu to preserve this age.</p><div class="modal-actions"><button data-action="close-modal">View the galaxy</button><button class="primary" data-action="new-game-menu">A new beginning</button></div>`);
}
function exportSave() {
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url; a.download=`asterion-reach-cycle-${state.turn}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Campaign exported. Keep this file as your backup.');
}
$('#import-save').addEventListener('change',async event=>{
  const file=event.target.files[0]; event.target.value=''; if (!file) return;
  try { if (file.size>3_000_000) throw new Error('Save file is too large.'); const candidate=JSON.parse(await file.text()); if (!validateSave(candidate)) throw new Error('This file is not a valid Asterion Reach campaign.');
    openModal('confirm-import',`<div class="eyebrow">RESTORE A CAMPAIGN</div><h2 id="modal-title">Return to cycle ${candidate.turn}?</h2><p class="modal-lead">This will replace the current autosave. Export your current campaign first if you want to keep it.</p><div class="modal-actions"><button data-action="export">Export current</button><button id="confirm-import" class="primary">Restore campaign</button></div>`);
    $('#confirm-import').addEventListener('click',()=>{state=candidate;selectedSystemId=player().capitalId;selectedFleetId=state.fleets.find(f=>f.owner==='player')?.id||null;closeModal();setPage('galaxy');save();render();galaxy.reset();toast('Campaign restored.');});
  } catch(error){toast(error.message,true);}
});
document.addEventListener('change',event=>{if(event.target.id==='warn-unspent'){settings.warnUnspent=event.target.checked;saveSettings();}});
document.addEventListener('click',event=>{
  const el=event.target.closest('button,a'); if (!el||el.disabled) return;
  if (el.dataset.page) return setPage(el.dataset.page);
  if (el.dataset.fleet) return selectFleet(el.dataset.fleet);
  if (el.dataset.systemSelect) return selectSystem(el.dataset.systemSelect);
  if (el.dataset.researchFilter) { researchFilter=el.dataset.researchFilter;return renderPage(); }
  if (el.dataset.logFilter) {logFilter=el.dataset.logFilter;return renderPage();}
  const action=el.dataset.action;
  switch(action){
    case 'menu':showMenu();break;
    case 'close-modal':closeModal();break;
    case 'begin':closeModal();save();break;
    case 'home':selectSystem(player().capitalId);galaxy.focus(player().capitalId);break;
    case 'zoom-in':galaxy.zoom(1);break;
    case 'zoom-out':galaxy.zoom(-1);break;
    case 'reset-view':galaxy.reset();break;
    case 'inspect':selectSystem(el.dataset.system);galaxy.focus(el.dataset.system);break;
    case 'build-menu':buildMenu(el.dataset.system);break;
    case 'build':if(dispatch({type:'build',systemId:el.dataset.system,itemId:el.dataset.item}))closeModal();break;
    case 'cancel-build':dispatch({type:'cancelBuild',systemId:el.dataset.system});break;
    case 'research':dispatch({type:'research',techId:el.dataset.tech});break;
    case 'move':dispatch({type:'move',fleetId:selectedFleetId,targetId:el.dataset.target});break;
    case 'colonize':openModal('colonize',`<div class="eyebrow">A NEW WORLD</div><h2 id="modal-title">Settle ${escape(systemById(fleetById(selectedFleetId).systemId).name)}?</h2><p class="modal-lead">Your Colony Ark will become the foundation of a new settlement. Establishing the colony consumes the ark, 30 credits, 20 minerals, and 1 order.</p><p class="empty-note">Worlds need at least ${player().techs.includes('terraforming')?0:player().techs.includes('ecology')?30:50}% habitability with your current technology.</p><div class="modal-actions"><button data-action="close-modal">Wait</button><button class="primary" data-action="colonize-confirm">Found colony →</button></div>`);break;
    case 'colonize-confirm':if(dispatch({type:'colonize',fleetId:selectedFleetId}))closeModal();break;
    case 'attack':dispatch({type:'attack',fleetId:selectedFleetId});break;
    case 'repair':dispatch({type:'repair',fleetId:selectedFleetId});break;
    case 'merge':dispatch({type:'merge',fleetId:selectedFleetId,targetFleetId:el.dataset.target});break;
    case 'anomaly':showAnomaly(el.dataset.system);break;
    case 'anomaly-choice':if(dispatch({type:'anomaly',systemId:el.dataset.system,choiceId:el.dataset.choice}))closeModal();break;
    case 'diplomacy':dispatch({type:'diplomacy',targetId:el.dataset.target,stance:el.dataset.stance});break;
    case 'declare-war':openModal('war',`<div class="eyebrow">A POINT OF NO RETURN</div><h2 id="modal-title">War with ${escape(FACTIONS[el.dataset.target].shortName)}?</h2><p class="modal-lead">Trade will end immediately. Fleets will fight on contact, and colonies can be invaded. Peace negotiations will remain closed for five cycles.</p><div class="modal-actions"><button data-action="close-modal">Stand down</button><button class="danger" data-action="war-confirm" data-target="${el.dataset.target}">Declare war · 1 order</button></div>`);break;
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
    if(event.key==='Tab'){const focusable=[...document.querySelectorAll('.modal button:not(:disabled),.modal a,.modal input')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    return;
  }
  if (event.target.matches('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey) return;
  if(event.code==='Space'&&!event.repeat&&!event.target.matches('button,a')){event.preventDefault();advanceTurn();}
  if (['1','2','3','4','5'].includes(event.key)) setPage(['galaxy','research','diplomacy','empire','journal'][Number(event.key)-1]);
  if(event.key.toLowerCase()==='h'){selectSystem(player().capitalId);galaxy.focus(player().capitalId);}
  if(event.key==='Escape'){selectedFleetId=null;render();}
  if(event.key==='?')window.open('./guide.html','_blank','noopener');
});
render();
galaxy.focus(selectedSystemId);
if(importedError)toast(importedError,true);
if(isNew)showWelcome();
// Read-only inspection hook for reproducible browser acceptance, never a mutation API.
window.__asterion={getState:()=>structuredClone(state),getPage:()=>page};
