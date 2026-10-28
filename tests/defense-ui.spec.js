import { test, expect } from '@playwright/test';
import { createGame, command, validateSave } from '../src/game.js';
import { SHIPS } from '../src/content.js';

const snapshot=page=>page.evaluate(()=>window.__asterion.getState());
const saved=value=>JSON.parse(JSON.stringify(value));
async function load(page,state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input=>{
    if(!localStorage.getItem('defense-fixture')){
      localStorage.setItem('asterion-reach-save-v1',JSON.stringify(input));
      localStorage.setItem('defense-fixture','true');
    }
  },state);
  await page.goto('./');
}

test('a held formation spends its last order leading defense and retains usable keyboard focus after reload',async({page})=>{
  const state=createGame('lead-defense-browser'),fleet=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  state.factions[0].orders=1;fleet.movesLeft=0;fleet.hold=true;
  const arrayOrder=state.fleets.map(f=>f.id),expected=saved(state);
  await load(page,state);
  const row=page.locator(`#inspector [data-fleet="${fleet.id}"]`);
  await row.click();
  const control=page.locator('[data-action="defense-lead-toggle"]');
  await expect(control).toHaveText('Lead defense · 1 order');
  expect(await snapshot(page)).toEqual(saved(state));
  await control.focus();await page.keyboard.press('Enter');
  expect(command(expected,{type:'leadDefense',fleetId:fleet.id}).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  expect((await snapshot(page)).fleets.map(f=>f.id)).toEqual(arrayOrder);
  await expect(page.locator('#inspector .fleet-row').first()).toHaveAttribute('data-fleet',fleet.id);
  await expect(row).toContainText('Lead defense');
  await expect(control).toHaveText('Clear lead · 1 order');
  await expect(control).toBeDisabled();
  await expect(page.locator('.defense-reason')).toContainText('No orders remaining');
  await expect(row).toBeFocused();
  await page.screenshot({path:'test-results/defensive-lead-last-order.png'});
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator(`#inspector [data-fleet="${fleet.id}"]`)).toContainText('Holding');
});

test('division explains the retained lead and merging transfers it to the selected survivor before paid clearing',async({page})=>{
  const state=createGame('lead-reorganization-browser'),fleet=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  fleet.ships=2;fleet.hp=68;
  expect(command(state,{type:'leadDefense',fleetId:fleet.id}).ok).toBe(true);
  const expected=saved(state);
  await load(page,state);
  await page.locator(`#inspector [data-fleet="${fleet.id}"]`).click();
  await page.locator('[data-action="split-menu"]').click();
  await expect(page.locator('.split-note')).toContainText('The original keeps its defensive lead');
  await page.locator('[data-action="split-confirm"]').click();
  const split=command(expected,{type:'split',fleetId:fleet.id,ships:1});
  expect(split.ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('.defense-current')).toContainText(fleet.name);
  await expect(page.locator('[data-action="defense-lead-toggle"]')).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-action="merge"]').click();
  expect(command(expected,{type:'merge',fleetId:split.newFleetId,targetFleetId:fleet.id}).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('[data-action="defense-lead-toggle"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-action="defense-lead-toggle"]').click();
  expect(command(expected,{type:'clearDefenseLead',fleetId:split.newFleetId}).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('.defense-default')).toHaveText('Default formation order');
  await expect(page.locator('[data-action="defense-lead-toggle"]')).toBeFocused();
});

test('observed enemy lead order matches actual engagements and its historical defender badge survives reload',async({page})=>{
  // Explicit combat fixture; both lead assignment and attack use ordinary commands.
  const state=createGame('enemy-lead-browser'),player=state.factions[0],enemy=state.factions.find(f=>f.id==='veyr');
  for(const [a,b]of[[player,enemy],[enemy,player]]){
    a.contacts.push(b.id);Object.assign(a.relations[b.id],{status:'war',trade:false,treatyTurn:state.turn});
  }
  const attacker=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
  Object.assign(attacker,{type:'cruiser',ships:12,hp:12*SHIPS.cruiser.hp});
  const escort=state.fleets.find(f=>f.owner==='veyr'&&f.type==='frigate');escort.systemId='s0';
  const lead={...escort,id:`f${state.nextFleetId++}`,name:'Forward Sovereign',type:'cruiser',ships:1,hp:SHIPS.cruiser.hp};state.fleets.push(lead);
  expect(command(state,{type:'leadDefense',fleetId:lead.id,factionId:'veyr'}).ok).toBe(true);
  const expected=saved(state);
  await load(page,state);
  await page.locator(`#inspector [data-fleet="${attacker.id}"]`).click();
  await expect(page.locator('.engagement-order li').first()).toHaveAttribute('data-opponent-id',lead.id);
  await expect(page.locator('.engagement-order li').first()).toContainText('Lead defense');
  expect(await snapshot(page)).toEqual(saved(state));
  await page.locator('[data-action="attack"]').click();
  await expect(page.locator('#modal-title')).toBeInViewport();
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  const answer=command(expected,{type:'attack',fleetId:attacker.id});expect(answer.ok).toBe(true);
  expect(answer.combatReports).toHaveLength(2);
  expect(answer.combatReports[0].participants[1].fleetId).toBe(lead.id);
  expect(answer.combatReports[0].participants[1].defenseLead).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('.combat-report').first().locator('.defense-badge')).toHaveText('Lead defender');
  await expect(page.locator('.combat-report').nth(1).locator('.defense-badge')).toHaveCount(0);
  await page.screenshot({path:'test-results/lead-defender-report.png'});
  await page.reload();
  await page.locator('[data-page="journal"]').click();
  await page.locator(`[data-action="combat-report"][data-report="${answer.combatReports[0].id}"]`).click();
  await expect(page.locator('.combat-report .defense-badge')).toHaveText('Lead defender');
  expect(await snapshot(page)).toEqual(expected);
});
