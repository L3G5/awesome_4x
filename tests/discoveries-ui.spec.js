import { test, expect } from '@playwright/test';
import { createGame, command, endTurn, validateSave } from '../src/game.js';

async function load(page,state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved=>{
    if(!localStorage.getItem('discovery-fixture')){
      localStorage.setItem('asterion-reach-save-v1',JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1',JSON.stringify({warnUnspent:false}));
      localStorage.setItem('discovery-fixture','true');
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

test('an observatory matures, reserves its restoration after cancellation, and persists its story',async({page})=>{
  const state=createGame('observatory-browser'),p=state.factions[0],home=state.systems[0];
  p.techs=['physics','logistics','industry','computing'];p.credits=1000;p.minerals=700;
  home.buildings=['mine','shipyard','lab'];home.anomaly={id:'observatory',resolved:false};
  await load(page,state);
  await page.locator('#inspector [data-action="anomaly"]').click();
  await page.locator('[data-illustration="observatory"] img').evaluate(img=>img.decode());
  await expect(page.locator('[data-illustration="observatory"] img')).toBeVisible();
  await expect(page.locator('[data-choice="preserve"]')).toContainText('Research Enclave');
  await page.locator('[data-choice="preserve"]').click();
  let current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].credits).toBe(960);
  expect(current.factions[0].minerals).toBe(680);
  await expect(page.locator('.discovery-progress')).toContainText('0 / 3');
  for(let i=0;i<3;i++)await nextCycle(page);
  await expect(page.locator('.discovery-ready')).toContainText('final choice');
  await page.locator('#inspector [data-action="anomaly"]').click();
  await expect(page.locator('[data-choice="restore"]')).toBeDisabled();
  await page.locator('#discovery-replacement').selectOption('shipyard');
  await expect(page.locator('[data-choice="restore"]')).toBeEnabled();
  await expect(page.locator('.replacement-warning')).toContainText('Orbital Shipyard continues working');
  await page.screenshot({path:'test-results/observatory-decision.png'});
  const before=await page.evaluate(()=>window.__asterion.getState().factions[0]);
  await page.locator('[data-choice="restore"]').click();
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.factions[0].credits).toBe(before.credits-80);
  expect(current.factions[0].minerals).toBe(before.minerals-40);
  expect(current.factions[0].orders).toBe(before.orders-1);
  expect(current.systems[0].anomaly.history).toHaveLength(2);
  await page.locator('[data-action="cancel-build"]').click();
  await page.locator('#inspector [data-action="anomaly"]').click();
  await expect(page.locator('[data-choice="harvest"]')).toHaveCount(0);
  await expect(page.locator('.discovery-history-entry')).toHaveCount(2);
  await page.locator('.modal .close-modal').click();
  await page.locator('.discovery-summary [data-action="build-menu"]').click();
  await page.locator('#replace-building').selectOption('shipyard');
  await page.locator('[data-item="ancient_observatory"]').click();
  for(let i=0;i<10;i++){
    if(await page.evaluate(()=>window.__asterion.getState().systems[0].buildings.includes('ancient_observatory')))break;
    await nextCycle(page);
  }
  current=await page.evaluate(()=>window.__asterion.getState());
  expect(current.systems[0].buildings).toContain('ancient_observatory');
  expect(current.systems[0].buildings).not.toContain('shipyard');
  expect(current.systems[0].anomaly.history).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.discovery-site-label')).toContainText('Ancient Observatory · Restored');
  await page.locator('#inspector [data-action="anomaly"]').click();
  await expect(page.locator('.discovery-history-entry')).toHaveCount(2);
  await expect(page.locator('.discovery-history')).toContainText('Paid 80 credits and 40 minerals');
  await page.locator('.modal .close-modal').click();
  await page.locator('[data-page="journal"]').click();
  await page.locator('#workspace-page [data-action="anomaly"]').first().click();
  await expect(page.locator('.discovery-history-entry')).toHaveCount(2);
});

test('an exhausted expedition can reach the restoration selector by keyboard',async({page})=>{
  const state=createGame('keyboard-restoration'),p=state.factions[0],home=state.systems[0];
  p.techs=['physics','logistics','industry','computing'];p.credits=1000;p.minerals=700;
  home.buildings=['mine','shipyard','lab'];home.anomaly={id:'observatory',resolved:false};
  expect(command(state,{type:'anomaly',systemId:home.id,choiceId:'preserve'}).ok).toBe(true);
  for(let i=0;i<3;i++)endTurn(state);
  p.orders=0;
  await load(page,state);
  const opener=page.locator('#inspector [data-action="anomaly"]');
  await opener.click();
  await expect(page.locator('.discovery-choice:enabled')).toHaveCount(0);
  await expect(page.locator('.close-modal')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.modal [data-action="language"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#discovery-replacement')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.close-modal')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#discovery-replacement')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('a recovered escort keeps its name and fleet heritage after merging',async({page})=>{
  const state=createGame('escort-browser'),home=state.systems[0];home.anomaly={id:'forge',resolved:false};
  const original=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  await load(page,state);
  await page.locator('#inspector [data-action="anomaly"]').click();
  await page.locator('[data-choice="ship"]').click();
  const recovered=await page.evaluate(()=>window.__asterion.getState().fleets.find(f=>f.name==='Last Light of Solace'));
  expect(recovered).toBeTruthy();
  await page.locator(`#inspector [data-fleet="${original.id}"]`).click();
  await page.locator('[data-action="merge"]').click();
  expect(await page.evaluate(id=>window.__asterion.getState().fleets.some(f=>f.id===id),recovered.id)).toBe(false);
  await page.locator('[data-action="fleet-heritage"]').click();
  await expect(page.locator('.modal')).toContainText('Last Light of Solace');
  await page.locator('[data-action="heritage-origin"]').click();
  await expect(page.locator('.discovery-history')).toContainText('Recovered Last Light of Solace');
  await page.reload();
  await page.locator(`#inspector [data-fleet="${original.id}"]`).click();
  await page.locator('[data-action="fleet-heritage"]').click();
  await expect(page.locator('.modal')).toContainText('Last Light of Solace');
});
