import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createGame, command, endTurn } from '../src/game.js';

const LANGUAGE='asterion-reach-language-v1', SAVE='asterion-reach-save-v1';
const actual50=new URL('../docs/default-campaign/actual/083-asterion-reach-cycle-50.json',import.meta.url);
const actual60=new URL('../docs/default-campaign/actual/109-asterion-reach-cycle-60.json',import.meta.url);
async function exportCampaign(page){
  const download=page.waitForEvent('download');
  await page.locator('[data-action="export"]').last().click();
  return fs.readFile(await (await download).path(),'utf8');
}
for(const width of [1440,390]){
 test(`language switch preserves campaign, dialog, focus and setting at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');await expect(page.locator('.modal')).toBeVisible();
  const original=await page.evaluate(()=>window.__asterion.getState());
  const toggle=page.locator('.modal [data-action="language"]');
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang','ru');
  await expect(page).toHaveTitle('Asterion Reach — Космическая 4X');
  await expect(page.locator('#modal-title')).toHaveText('Предел зовёт.');
  await expect(toggle).toHaveText('English');await expect(toggle).toBeFocused();
  expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(original);
  await page.locator('.modal [data-action="close-modal"]').last().click();
  await page.locator('[data-page="research"]').click();
  await expect(page.locator('#workspace-page h2')).toHaveText('За пределами известного');
  await page.locator('[data-research-filter="Engineering"]').click();
  await expect(page.locator('[data-research-filter="Engineering"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('.top-actions [data-action="language"]').click();
  await expect(page.locator('[data-research-filter="Engineering"]')).toHaveText('Engineering');
  await expect(page.locator('[data-research-filter="Engineering"]')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(original);
  await page.locator('.top-actions [data-action="language"]').click();await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','ru');
  expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(original);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect(errors).toEqual([]);
 });
}

test('Russian ordinary research and End Cycle have exact English-engine effects',async({page})=>{
 const state=createGame('Research');
 await page.addInitScript(({state,SAVE,LANGUAGE})=>{
  localStorage.setItem(SAVE,JSON.stringify(state));localStorage.setItem(LANGUAGE,'ru');
  localStorage.setItem('asterion-reach-settings-v1',JSON.stringify({warnUnspent:false}));
 },{state,SAVE,LANGUAGE});
 await page.goto('./');
 await expect(page.locator('#map-meta [translate="no"]')).toHaveText('Research');
 await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'т',code:'KeyN',bubbles:true})));
 await expect(page.locator('.fleet-switch [data-fleet="f2"]')).toHaveClass(/selected/);
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(state);
 await page.locator('[data-page="research"]').click();
 await page.locator('[data-action="research"][data-tech="logistics"]').click();
 expect(command(state,{type:'research',techId:'logistics'}).ok).toBe(true);
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(state);
 await page.locator('#end-turn').click();expect(endTurn(state).ok).toBe(true);
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(state);
 await expect(page.locator('#turn-number')).toHaveText('Цикл 02');
 await expect(page.locator('#resources')).toContainText('Кредиты');
});

test('actual midgame toggles and exports exactly while the field guide stays English',async({page})=>{
 const saved=JSON.parse(await fs.readFile(actual50,'utf8'));
 await page.addInitScript(({saved,SAVE})=>localStorage.setItem(SAVE,JSON.stringify(saved)),{saved,SAVE});
 await page.goto('./');await page.locator('[data-action="menu"]').click();
 const english=await exportCampaign(page);
 await page.locator('.modal [data-action="language"]').click();
 const russian=await exportCampaign(page);expect(russian).toBe(english);
 await page.locator('.modal [data-action="close-modal"]').first().click();
 await page.locator('[data-page="diplomacy"]').click();
 await expect(page.locator('#workspace-page')).toContainText('Консорциум Вейр');
 const popup=page.waitForEvent('popup');await page.locator('.top-actions a[href="./guide.html"]').click();
 const guide=await popup;await guide.waitForLoadState();await expect(guide.locator('html')).toHaveAttribute('lang','en');await expect(guide).toHaveTitle(/Field Guide/);await guide.close();
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(saved);
});

test('Russian import and finished conclusion preserve the original save',async({page})=>{
 const saved=JSON.parse(await fs.readFile(actual60,'utf8'));
 await page.addInitScript(LANGUAGE=>localStorage.setItem(LANGUAGE,'ru'),LANGUAGE);
 await page.goto('./');await page.locator('.modal [data-action="close-modal"]').last().click();
 await page.locator('[data-action="menu"]').click();
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-action="import"]').click();await (await chooser).setFiles(actual60.pathname);
 await expect(page.locator('#confirm-import')).toHaveText('Восстановить кампанию');await page.locator('#confirm-import').click();
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(saved);
 await page.locator('[data-action="show-conclusion"]').first().click();
 await expect(page.locator('#modal-title')).toContainText('Трансценденция');
 const first=await exportCampaign(page);
 await page.locator('.modal [data-action="language"]').click();await expect(page.locator('#modal-title')).toContainText('Transcendence');
 expect(await exportCampaign(page)).toBe(first);
 expect(await page.evaluate(()=>window.__asterion.getState())).toEqual(saved);
});

test('Russian ordinary peace explains all binding terms and keeps its exact paid effect', async ({ page }) => {
  const state = JSON.parse(await fs.readFile(new URL('../docs/military-playtest/replay/actual-exports/cycle40.json', import.meta.url), 'utf8'));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.addInitScript(({ state, SAVE, LANGUAGE }) => {
    if (localStorage.getItem('peace-localization-loaded')) return;
    localStorage.setItem(SAVE, JSON.stringify(state)); localStorage.setItem(LANGUAGE, 'ru');
    localStorage.setItem('peace-localization-loaded', 'true');
  }, { state, SAVE, LANGUAGE });
  await page.goto('./'); await page.locator('[data-page="diplomacy"]').click();
  await page.locator('[data-rival="khar"] [data-action="peace-confirmation"]').click();
  const terms = page.locator('.modal .modal-lead');
  await expect(terms).toContainText('Заплатить 60 кредитов');
  await expect(terms).toContainText('Война запрещена на 5 циклов');
  await expect(terms).toContainText('известную нейтральную систему');
  await expect(terms).toContainText('остаётся на месте без возможности перемещения');
  expect(await terms.innerText()).not.toMatch(/[a-z]/i);
  expect(await page.evaluate(() => window.__asterion.getState())).toEqual(state);
  const toggle = page.locator('.modal [data-action="language"]');
  await toggle.click(); await expect(terms).toContainText('Pay 60 credits');
  await toggle.click(); await expect(terms).toContainText('Заплатить 60 кредитов');
  await page.locator('[data-action="diplomatic-confirm"]').click();
  expect(command(state, { type: 'diplomacy', targetId: 'khar', stance: 'peace' }).ok).toBe(true);
  expect(await page.evaluate(() => window.__asterion.getState())).toEqual(state);
  await page.reload(); expect(await page.evaluate(() => window.__asterion.getState())).toEqual(state);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
