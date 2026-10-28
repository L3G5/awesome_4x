import { test, expect } from '@playwright/test';
import { createGame, validateSave } from '../src/game.js';

function routeFixture() {
  const state=createGame('navigation-browser');
  const path=['s0','s4','s5','s6','s7'];
  state.lanes=path.slice(1).map((id,i)=>[path[i],id]);
  for(const system of state.systems)system.knownBy=system.knownBy.filter(id=>id!=='player');
  path.forEach((id,i)=>{const system=state.systems.find(s=>s.id===id);system.knownBy.push('player');system.anomaly=null;system.x=i*300;system.y=0;});
  for(const faction of state.factions.filter(f=>f.id!=='player'))faction.orders=0;
  return {state,path,scout:state.fleets.find(f=>f.owner==='player'&&f.type==='scout')};
}
async function load(page,state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved=>{
    if(!localStorage.getItem('navigation-fixture')){
      localStorage.setItem('asterion-reach-save-v1',JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1',JSON.stringify({warnUnspent:false}));
      localStorage.setItem('navigation-fixture','true');
    }
  },state);
  await page.goto('./');
  await page.locator('[data-action="reset-view"]').click();
}

test('a plotted course spends only deliberate movement and survives a cycle and reload',async({page})=>{
  const {state,path,scout}=routeFixture();
  await load(page,state);
  await page.locator(`.galaxy-system-label[data-system-id="${path.at(-1)}"]`).click();
  await expect(page.locator('.route-proposal')).toContainText('4 jumps · 4 orders total');
  await page.locator('[data-action="plan-route"]').click();
  let current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].orders).toBe(state.factions[0].orders);
  expect(current.fleets.find(f=>f.id===scout.id).route.path).toEqual(path);
  await expect(page.locator('[data-action="continue-route"]')).toContainText('2 jumps');
  await page.screenshot({path:'test-results/plotted-course.png'});
  await page.locator('[data-action="continue-route"]').click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.fleets.find(f=>f.id===scout.id).systemId).toBe(path[2]);
  expect(current.factions[0].orders).toBe(state.factions[0].orders-2);
  await expect(page.locator('[data-action="continue-route"]')).toBeDisabled();
  await page.locator('[data-action="end-turn"]').click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.fleets.find(f=>f.id===scout.id).systemId).toBe(path[2]);
  expect(current.fleets.find(f=>f.id===scout.id).route.path).toEqual(path.slice(2));
  await page.reload();
  await expect(page.locator('.route-committed')).toContainText('2 jumps · 2 orders total');
  await page.locator('[data-action="continue-route"]').click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.fleets.find(f=>f.id===scout.id).systemId).toBe(path.at(-1));
  expect(current.fleets.find(f=>f.id===scout.id).route).toBeUndefined();
  await expect(page.locator('.route-strip')).toHaveCount(0);
});

test('route planning conceals a hidden blockade and charges for the intercepted attempt',async({page})=>{
  const {state,path,scout}=routeFixture();
  const khar=state.factions.find(f=>f.id==='khar'),enemy=state.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');
  state.factions[0].relations.khar.status='war';khar.relations.player.status='war';
  enemy.systemId=path[1];enemy.name='Hidden route blockade';
  await load(page,state);
  await page.locator(`.galaxy-system-label[data-system-id="${path.at(-1)}"]`).click();
  await expect(page.locator('.route-proposal')).toContainText('Opposition unknown');
  await expect(page.locator('.route-proposal')).not.toContainText('blocks');
  await page.locator('[data-action="plan-route"]').click();
  await page.locator('[data-action="continue-route"]').click();
  const current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.fleets.find(f=>f.id===scout.id).systemId).toBe(path[0]);
  expect(current.fleets.find(f=>f.id===scout.id).movesLeft).toBe(1);
  expect(current.fleets.find(f=>f.id===scout.id).route.path).toEqual(path);
  expect(current.factions[0].orders).toBe(state.factions[0].orders-1);
  expect(current.systems.find(s=>s.id===path[1]).exploredBy).not.toContain('player');
  await expect(page.locator('#status-message')).toContainText('withdrew');
  await expect(page.locator(`[data-fleet-id="${enemy.id}"]`)).toHaveCount(0);
});
