import { test, expect } from '@playwright/test';
import { createGame, validateSave } from '../src/game.js';

async function load(page,state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved=>{
    if(!localStorage.getItem('development-fixture')) {
      localStorage.setItem('asterion-reach-save-v1',JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1',JSON.stringify({warnUnspent:false}));
      localStorage.setItem('development-fixture','true');
    }
  },state);
  await page.goto('./');
}
async function nextCycle(page) {
  const turn=await page.evaluate(()=>window.__asterion.getState().turn);
  await page.locator('[data-action="end-turn"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__asterion.getState().turn)).toBe(turn+1);
  if(await page.locator('.modal').count())await page.locator('.modal .close-modal').click();
}

test('a capped civic upgrade discloses zero usable orders while preserving the legal credit investment',async({page})=>{
  const state=createGame('capped-development'),p=state.factions[0],home=state.systems[0];
  for(const [index,world] of [home,...state.systems.slice(4,11)].entries()){
    Object.assign(world,{owner:'player',population:8,buildings:index===0?['forum','lab','factory']:[],queue:null});
    if(!world.knownBy.includes('player'))world.knownBy.push('player');
    if(!world.exploredBy.includes('player'))world.exploredBy.push('player');
  }
  home.charter={type:'civic',level:1};
  Object.assign(p,{techs:['logistics','industry','diplomacy','command'],credits:2000,minerals:2000,orders:18});
  await load(page,state);
  await page.locator('[data-action="development-menu"]').click();
  const civic=page.locator('[data-action="develop"][data-charter="civic"]');
  await expect(civic).toBeEnabled();
  await expect(civic.locator('.order-effect')).toContainText('18 → 18');
  await expect(civic.locator('.order-effect')).toContainText('+0 usable orders');
  await expect(civic).toContainText('+6 credits');
  await page.screenshot({path:'test-results/capped-civic-development.png'});
  await civic.click();
  let current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].credits).toBe(1700);
  expect(current.factions[0].minerals).toBe(1900);
  while(current.systems[0].queue){
    await nextCycle(page);
    current=await page.evaluate(()=>window.__asterion.getState());
  }
  expect(current.systems[0].charter).toEqual({type:'civic',level:2});
  expect(current.factions[0].orders).toBe(18);
});

test('a full colony replaces infrastructure on completion and establishes a persistent specialty',async({page})=>{
  const state=createGame('development-browser'),p=state.factions[0],home=state.systems[0];
  p.techs=['logistics','industry'];p.credits=800;p.minerals=500;
  home.buildings=['mine','shipyard','lab'];home.charter={type:'extraction',level:1};
  await load(page,state);
  await expect(page.locator('.colony-development')).toContainText('3 / 3 slots');
  await page.locator('[data-action="build-menu"]').click();
  await expect(page.locator('[data-action="build"][data-item="market"]')).toBeDisabled();
  await page.locator('#replace-building').selectOption('mine');
  await expect(page.locator('.replacement-warning')).toContainText('also removes the Extraction Charter I');
  await page.locator('[data-action="build"][data-item="market"]').click();
  let current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.systems[0].buildings).toContain('mine');
  expect(current.systems[0].charter.type).toBe('extraction');
  expect(current.factions[0].credits).toBe(775);
  await page.locator('[data-action="cancel-build"]').click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].credits).toBe(800);
  expect(current.systems[0].charter.type).toBe('extraction');
  await page.locator('[data-action="build-menu"]').click();
  await page.locator('#replace-building').selectOption('mine');
  await page.locator('[data-action="build"][data-item="market"]').click();
  for(let i=0;i<3;i++)await nextCycle(page);
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.systems[0].buildings).toContain('market');
  expect(current.systems[0].buildings).not.toContain('mine');
  expect(current.systems[0].charter).toBeFalsy();
  await page.locator('[data-action="development-menu"]').click();
  const option=page.locator('[data-action="develop"][data-charter="academy"]');
  await expect(option).toContainText(`+${2+home.science} science`);
  await page.screenshot({path:'test-results/colonial-charters.png'});
  const before=await page.evaluate(()=>window.__asterion.getState().factions[0]);
  await option.click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].credits).toBe(before.credits-120);
  expect(current.factions[0].minerals).toBe(before.minerals-60);
  expect(current.factions[0].orders).toBe(before.orders-1);
  await expect(page.locator('.production-row')).toContainText('Academy Charter I');
  for(let i=0;i<8;i++) {
    if(await page.evaluate(()=>!!window.__asterion.getState().systems[0].charter))break;
    await nextCycle(page);
  }
  await expect(page.locator('.charter-summary')).toContainText('Academy Charter I');
  await page.reload();
  await expect(page.locator('.charter-summary')).toContainText('Academy Charter I');
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('.colony-table')).toContainText('Academy Charter I');
});

test('a forge displays and charges the discounted military ship price',async({page})=>{
  const state=createGame('forge-browser'),p=state.factions[0],home=state.systems[0];
  p.techs=['logistics','industry','weapons','cruisers'];p.credits=800;p.minerals=500;
  home.population=9;home.buildings=['mine','shipyard','factory'];home.charter={type:'forge',level:2};
  await load(page,state);
  await page.locator('[data-action="build-menu"]').click();
  await page.locator('[data-action="construction-tab"][data-tab="ship"]').click();
  const cruiser=page.locator('[data-action="build"][data-item="cruiser"]');
  await expect(cruiser).toContainText('◇ 68');
  await cruiser.click();
  const current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].minerals).toBe(432);
  expect(current.systems[0].queue.cost.minerals).toBe(68);
  await page.locator('[data-action="cancel-build"]').click();
  expect(await page.evaluate(()=>window.__asterion.getState().factions[0].minerals)).toBe(500);
});

test('public beacon signals show an interrupted race without revealing hidden fleets',async({page})=>{
  const state=createGame('race-browser'),p=state.factions[0],rival=state.factions[1];
  p.contacts.push('veyr');rival.contacts.push('player');rival.techs=['singularity'];rival.credits=1500;
  const sites=[state.systems[1],...state.systems.filter(s=>!s.owner).slice(-2)];
  for(const system of sites){system.owner='veyr';system.population=4;system.buildings=['beacon'];system.knownBy=system.knownBy.filter(id=>id!=='player');}
  rival.alignment={progress:6,sites:sites.map(s=>s.id),active:false,started:true,reportedBeacons:sites.map(s=>s.id)};
  const hidden=state.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');hidden.systemId=sites[2].id;hidden.name='Unseen Interdictor';
  rival.relations.khar.status='war';state.factions.find(f=>f.id==='khar').relations.veyr.status='war';
  await load(page,state);
  await page.locator('[data-page="empire"]').click();
  const race=page.locator('[data-race="veyr"]');
  await expect(race).toContainText('6 / 10');
  await expect(race).toContainText('Alignment interrupted');
  await expect(race.locator('.beacon-sites button')).toHaveCount(3);
  expect(await page.evaluate(siteId=>window.__asterion.getState().systems.find(s=>s.id===siteId).knownBy.includes('player'),sites[2].id)).toBe(true);
  await expect(page.locator('body')).not.toContainText('Unseen Interdictor');
  await race.locator(`[data-system="${sites[2].id}"]`).click();
  await expect(page.locator('.beacon-inspector')).toContainText('6 / 10 cycles');
  await expect(page.locator('#inspector')).toContainText('Unsurveyed system');
  await expect(page.locator(`[data-fleet-id="${hidden.id}"]`)).toHaveCount(0);
  await expect(page.locator('#inspector')).not.toContainText('Unseen Interdictor');
  await page.reload();
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('[data-race="veyr"]')).toContainText('6 / 10');
  await page.screenshot({path:'test-results/alignment-race.png'});
});

test('a beacon blockade loses an alignment step and a player fleet can restore the race',async({page})=>{
  const state=createGame('alignment-relief'),p=state.factions[0],khar=state.factions.find(f=>f.id==='khar');
  p.techs=['singularity'];p.credits=1000;
  p.contacts.push('khar');khar.contacts.push('player');
  p.relations.khar.status='war';khar.relations.player.status='war';
  const targetId=state.lanes.flatMap(([a,b])=>a==='s0'?[b]:b==='s0'?[a]:[]).find(id=>!state.systems.find(s=>s.id===id).owner);
  const target=state.systems.find(s=>s.id===targetId),third=state.systems.find(s=>!s.owner&&s.id!==targetId);
  const sites=[state.systems[0],target,third];
  for(const system of sites){system.owner='player';system.population=4;system.buildings=['beacon'];if(!system.knownBy.includes('player'))system.knownBy.push('player');if(!system.exploredBy.includes('player'))system.exploredBy.push('player');}
  p.alignment={progress:6,sites:sites.map(s=>s.id),active:true,started:true,reportedBeacons:sites.map(s=>s.id)};
  const ours=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');ours.ships=6;ours.hp=204;
  const enemy=state.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');enemy.systemId=targetId;enemy.movesLeft=0;
  for(const faction of state.factions.filter(f=>f.id!=='player')){faction.credits=0;faction.minerals=0;faction.orders=0;}
  await load(page,state);
  await nextCycle(page);
  expect(await page.evaluate(()=>window.__asterion.getState().factions[0].alignment.progress)).toBe(5);
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('.alignment-status')).toContainText('Hostile warships block alignment');
  await page.locator(`#workspace-page [data-fleet="${ours.id}"]`).click();
  await page.locator(`[data-system-select="${targetId}"]`).click();
  await page.locator('[data-action="move"]').click();
  await expect(page.locator('.combat-report')).toBeVisible();
  await page.locator('.modal .close-modal').click();
  expect(await page.evaluate(enemyId=>window.__asterion.getState().fleets.some(f=>f.id===enemyId),enemy.id)).toBe(false);
  await nextCycle(page);
  expect(await page.evaluate(()=>window.__asterion.getState().factions[0].alignment.progress)).toBe(6);
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('.alignment-status')).toContainText('Alignment requirements met now');
  await expect(page.locator('[data-race="player"]')).toContainText('Alignment advanced last cycle');
  await page.reload();
  expect(await page.evaluate(()=>window.__asterion.getState().factions[0].alignment.progress)).toBe(6);
});

test('a rival nearing alignment completion opens a briefing and highlights its public network',async({page})=>{
  const state=createGame('alignment-warning'),p=state.factions[0],rival=state.factions[1];
  p.contacts.push('veyr');rival.contacts.push('player');rival.techs=['singularity'];rival.credits=1500;
  const sites=[state.systems[1],...state.systems.filter(s=>!s.owner).slice(-2)];
  for(const system of sites){system.owner='veyr';system.population=4;system.buildings=['beacon'];}
  rival.alignment={progress:7,sites:sites.map(s=>s.id),active:true,started:true,reportedBeacons:sites.map(s=>s.id)};
  for(const faction of state.factions)faction.orders=0;
  await load(page,state);
  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('.modal h2')).toHaveText('A new cycle. A changing Reach.');
  await expect(page.locator('.briefing-entry').filter({hasText:'reaches 8/10'})).toHaveCount(1);
  await page.locator('.modal .close-modal').click();
  await expect(page.locator('[data-page="empire"] .nav-badge')).toHaveText('8/10');
  await expect(page.locator('#mandate')).toContainText('Veyr Consortium has reached 8/10');
  await page.locator('[data-action="review-network"]').click();
  await expect(page.locator('[data-race="veyr"]')).toBeInViewport();
});
