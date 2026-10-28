import { test, expect } from '@playwright/test';
import { createGame, command, validateSave } from '../src/game.js';

const snapshot=page=>page.evaluate(()=>window.__asterion.getState());
async function load(page,state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved=>{
    if(!localStorage.getItem('effect-preview-fixture')){
      localStorage.setItem('asterion-reach-save-v1',JSON.stringify(saved));
      localStorage.setItem('effect-preview-fixture','true');
    }
  },state);
  await page.goto('./');
  await page.locator('#inspector [data-action="anomaly"]').click();
}

test('refugee terms explain arrival above capacity and match the paid command and reload',async({page})=>{
  // Synthetic boundary: the ordinary choice is made with a full capital.
  const state=createGame('refugee-capacity-browser'),home=state.systems[0];
  home.population=8;home.anomaly={id:'pilgrims',resolved:false};
  await load(page,state);
  const choice=page.locator('[data-choice="welcome"]');
  await expect(choice).toContainText('8 → 9');
  await expect(choice).toContainText('9 / 8 population after arrival');
  await expect(choice).toContainText('natural growth pauses at or above the limit');
  await expect(choice).toContainText('20 credits');
  await expect(choice).toContainText('1 order');
  expect(await snapshot(page)).toEqual(state);
  await page.screenshot({path:'test-results/refugee-capacity-preview.png'});
  const expected=structuredClone(state);
  expect(command(expected,{type:'anomaly',systemId:home.id,choiceId:'welcome'}).ok).toBe(true);
  await choice.click();
  expect(await snapshot(page)).toEqual(expected);
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);
});

test('Garden terms retain science while showing the actual habitability increase',async({page})=>{
  const state=createGame('garden-capacity-browser'),home=state.systems[0];
  home.habitability=95;home.anomaly={id:'garden',resolved:false};
  await load(page,state);
  const choice=page.locator('[data-choice="preserve"]');
  await expect(choice).toContainText('95% to 100% (+5 points)');
  await expect(choice).toContainText('Gain 20 science');
  expect(await snapshot(page)).toEqual(state);
  const expected=structuredClone(state);
  expect(command(expected,{type:'anomaly',systemId:home.id,choiceId:'preserve'}).ok).toBe(true);
  await choice.click();
  expect(await snapshot(page)).toEqual(expected);
  await page.locator('#inspector [data-action="anomaly"]').click();
  await expect(page.locator('.discovery-history-entry')).toContainText('Habitability increased by 5 points');
});

test('a lost refugee destination discloses no population gain before charging its unchanged price',async({page})=>{
  const state=createGame('refugee-no-capital-browser'),home=state.systems[0];
  // Local expedition remains at the unclaimed former capital; its Ark survives.
  home.owner=null;home.population=0;home.buildings=[];home.anomaly={id:'pilgrims',resolved:false};
  await load(page,state);
  const choice=page.locator('[data-choice="welcome"]');
  await expect(choice).toBeEnabled();
  await expect(choice).toContainText('this choice adds no population');
  await expect(choice).toContainText('20 credits');
  expect(await snapshot(page)).toEqual(state);
  // The alternative remains a deliberate player decision.
  const expected=structuredClone(state);
  expect(command(expected,{type:'anomaly',systemId:home.id,choiceId:'supplies'}).ok).toBe(true);
  await page.locator('[data-choice="supplies"]').click();
  expect(await snapshot(page)).toEqual(expected);
});
