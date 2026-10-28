import { test, expect } from '@playwright/test';
import { createGame, validateSave } from '../src/game.js';

async function loadFixture(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved => {
    if (!localStorage.getItem('fixture-initialized')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('fixture-initialized', 'true');
    }
  }, state);
  await page.goto('./');
}

test('visible opposition at a neutral star previews combat and reports actual losses immediately', async ({ page }) => {
  const state=createGame('combat-feedback');
  const player=state.factions[0], khar=state.factions.find(f=>f.id==='khar');
  player.contacts.push('khar'); khar.contacts.push('player');
  player.relations.khar.status='war'; khar.relations.player.status='war';
  const targetId=state.lanes.flatMap(([a,b])=>a==='s0'?[b]:b==='s0'?[a]:[])[0];
  const target=state.systems.find(s=>s.id===targetId);
  target.exploredBy.push('player');
  state.fleets.find(f=>f.owner==='player'&&f.type==='scout').systemId=targetId;
  const fleet=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  fleet.ships=3; fleet.hp=102;
  const enemy=state.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');
  enemy.systemId=targetId;enemy.ships=2;enemy.hp=68;
  await loadFixture(page,state);
  await page.locator(`#inspector [data-fleet="${fleet.id}"]`).click();
  await page.locator(`[data-system-select="${targetId}"]`).click();
  await expect(page.locator('[data-action="move"]')).toContainText('Engage');
  await expect(page.locator('#fleet-bar')).toContainText('engagement');
  await expect(page.locator('.engagement-selected')).toContainText(fleet.name);
  await expect(page.locator('.engagement-scope')).toContainText('Only this formation attacks');
  await expect(page.locator('.engagement-order li')).toHaveCount(1);
  await expect(page.locator('.engagement-order li')).toHaveAttribute('data-opponent-id',enemy.id);
  expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(JSON.parse(JSON.stringify(state)));
  await page.locator('[data-action="move"]').click();
  await expect(page.locator('.combat-report')).toBeVisible();
  const current=await page.evaluate(()=>window.__asterion.getState());
  const report=current.combatReports[0], ours=report.participants.find(p=>p.owner==='player');
  expect(ours.shipsBefore-ours.shipsAfter).toBeGreaterThan(0);
  await expect(page.locator('.combat-side[data-owner="player"]')).toContainText(`${ours.shipsBefore} → ${ours.shipsAfter}`);
  await expect(page.locator('.combat-summary')).toHaveText(report.summary);
  await expect(page.locator('.combat-fleet-art .ship-portrait')).toHaveCount(2);
  await expect(page.locator('.combat-scope')).toContainText('one attacking formation');
  await page.locator('.modal [data-action="close-modal"]').last().click();
  await page.reload();
  await page.locator('[data-page="journal"]').click();
  await page.locator(`[data-action="combat-report"][data-report="${report.id}"]`).click();
  await expect(page.locator('.combat-summary')).toHaveText(report.summary);
  await page.screenshot({path:'test-results/combat-report.png'});
});

test('the map roster exposes a fifth remote fleet and selecting it focuses its location', async ({ page }) => {
  const state=createGame('fleet-interface');
  const template=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  for(let i=0;i<2;i++)state.fleets.push({...template,id:`f${state.nextFleetId++}`,name:`Expedition ${i+1}`});
  const fifth=state.fleets.at(-1),home=state.systems[0];
  const remote=state.systems.filter(s=>!s.owner).sort((a,b)=>Math.hypot(b.x-home.x,b.y-home.y)-Math.hypot(a.x-home.x,a.y-home.y))[0];
  fifth.systemId=remote.id;remote.knownBy.push('player');remote.exploredBy.push('player');
  await loadFixture(page,state);
  await page.locator('[data-action="fleet-roster"]').click();
  await expect(page.locator('.modal .fleet-row')).toHaveCount(5);
  await page.locator(`.modal [data-fleet="${fifth.id}"]`).click();
  await expect(page.locator('#fleet-bar h3')).toContainText(fifth.name);
  await expect.poll(async()=>{
    const label=await page.locator(`.galaxy-system-label[data-system-id="${remote.id}"]`).boundingBox();
    const map=await page.locator('#galaxy').boundingBox();
    return !!label && label.x>=map.x && label.y>=map.y && label.x+label.width<=map.x+map.width && label.y+label.height<=map.y+map.height;
  }).toBe(true);
  await page.keyboard.press('n');
  await expect(page.locator('#fleet-bar h3')).toContainText('Pathfinder');
});

test('a persistent cycle briefing includes completions, treaty expiry and shortages without old dispatches', async ({ page }) => {
  const state=createGame('cycle-briefing');state.turn=10;
  const player=state.factions[0],rival=state.factions[1],home=state.systems[0];
  player.credits=0;player.research={techId:'logistics',progress:54};
  home.queue={itemId:'lab',kind:'building',progress:29,work:30,cost:{credits:30,minerals:30}};
  const fleet=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');fleet.ships=12;fleet.hp=408;
  player.contacts.push('veyr');rival.contacts.push('player');
  for(const relation of[player.relations.veyr,rival.relations.player]){relation.trade=true;relation.tradeEndsAt=11;}
  await loadFixture(page,state);
  await page.locator('[data-action="end-turn"]').click();
  await page.locator('[data-action="end-turn-confirm"]').click();
  await page.locator('[data-action="briefing"]').click();
  await expect(page.locator('.briefing-entry').filter({hasText:'Research complete'})).toHaveCount(1);
  await expect(page.locator('.briefing-entry').filter({hasText:'completed Research Enclave'})).toHaveCount(1);
  await expect(page.locator('.briefing-entry').filter({hasText:'Treasury exhausted'})).toHaveCount(1);
  await expect(page.locator('.briefing-entry').filter({hasText:'Trade between'})).toHaveCount(1);
  await expect(page.locator('.modal')).not.toContainText('The gates have been silent');
  await page.reload();
  await page.locator('[data-action="briefing"]').click();
  await expect(page.locator('.briefing-entry').filter({hasText:'Research complete'})).toHaveCount(1);
  await page.locator('[data-action="report-research"]').click();
  await expect(page.locator('#workspace-page h2')).toHaveText('Beyond the known');
});
