import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, command, getNeighbors, getReadyFleets, validateSave } from '../src/game.js';

const actual = name => JSON.parse(fs.readFileSync(new URL(`../docs/${name}`, import.meta.url)));
const snapshot = page => page.evaluate(() => window.__asterion.getState());

async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved => {
    if (!localStorage.getItem('readiness-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: true }));
      localStorage.setItem('readiness-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}

async function selectFleet(page, id) {
  await page.locator('[data-page="empire"]').click();
  await page.locator(`#workspace-page [data-fleet="${id}"]`).click();
}

test('acknowledged garrisons stay out of next-fleet cycling and completed-research warnings', async ({ page }, testInfo) => {
  const state = actual('intervention-audit/results/verified-cycle63-before-ai.json');
  const ready = getReadyFleets(state);
  expect(ready).toHaveLength(6);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state);
  const expected = await snapshot(page);
  for (const fleet of ready) {
    await selectFleet(page, fleet.id);
    await page.locator('[data-action="fleet-hold"]').click();
    await expect(page.locator('[data-action="fleet-hold"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="fleet-hold"]')).toBeFocused();
    expected.fleets.find(candidate => candidate.id === fleet.id).hold = true;
  }
  expect(await snapshot(page)).toEqual(expected);
  const selected = await page.locator('#fleet-bar h3').textContent();
  await page.keyboard.press('n');
  await expect(page.locator('#fleet-bar h3')).toHaveText(selected);
  await expect(page.locator('#status-message')).toContainText('No fleet awaits orders');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await expect(page.locator('#fleet-bar .empty-fleet')).toBeVisible();
  await expect(page.locator('[data-action="fleet-roster"]')).toHaveText('Fleet roster →');
  await page.locator('[data-action="fleet-roster"]').click();
  await expect(page.locator('.modal-lead')).toContainText('7 fleets · 0 awaiting orders · 6 holding position');
  await expect(page.locator('.modal .fleet-row')).toHaveCount(7);
  await page.keyboard.press('Escape');

  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('#turn-number')).toHaveText('Cycle 64');
  await expect(page.locator('[data-action="end-turn-confirm"]')).toHaveCount(0);
  const afterCycle = await snapshot(page);
  expect(afterCycle.fleets.some(fleet => fleet.owner === 'player' && fleet.hold)).toBe(true);
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.locator('[data-action="menu"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadPromise, exportedPath = testInfo.outputPath('held-campaign.json');
  await download.saveAs(exportedPath);
  expect(JSON.parse(fs.readFileSync(exportedPath))).toEqual(afterCycle);
  await page.locator('#import-save').setInputFiles(exportedPath);
  await page.locator('#confirm-import').click();
  await page.reload();
  expect(await snapshot(page)).toEqual(afterCycle);
  expect(errors).toEqual([]);
});

test('holding a fleet preserves research warnings and continuing its course resumes normal paid movement', async ({ page }) => {
  const state = createGame('readiness-course');
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  const destinationId = getNeighbors(state, scout.systemId).find(id => !state.systems.find(system => system.id === id).owner);
  expect(command(state, { type: 'planRoute', fleetId: scout.id, destinationId }).ok).toBe(true);
  for (const fleet of state.fleets.filter(fleet => fleet.owner === 'player')) {
    expect(command(state, { type: 'hold', fleetId: fleet.id }).ok).toBe(true);
  }
  await load(page, state);
  await expect(page.locator('[data-action="continue-route"]')).toContainText('Resume course');
  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('.modal-lead')).toContainText('researchers have no assigned project');
  await expect(page.locator('.modal-lead')).not.toContainText('fleets await');
  await page.keyboard.press('Escape');
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="logistics"]').click();
  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('#turn-number')).toHaveText('Cycle 02');
  const before = await snapshot(page);
  expect(before.fleets.find(fleet => fleet.id === scout.id).hold).toBe(true);
  expect(before.fleets.find(fleet => fleet.id === scout.id).route).toEqual(scout.route);
  await selectFleet(page, scout.id);
  await page.locator('[data-action="continue-route"]').click();
  const after = await snapshot(page), moved = after.fleets.find(fleet => fleet.id === scout.id);
  expect(moved.hold).toBeUndefined();
  expect(moved.systemId).toBe(destinationId);
  expect(moved.movesLeft).toBe(before.fleets.find(fleet => fleet.id === scout.id).movesLeft - 1);
  expect(after.factions[0].orders).toBe(before.factions[0].orders - 1);
  await expect(page.locator('[data-action="fleet-hold"]')).toHaveText('Hold position');
});

test('fractional damage stays visible and a detachment starts active while its original holds', async ({ page }) => {
  const state = actual('stage10-fleet-review/cycle60-after-shared-repair.json');
  const fleet = state.fleets.find(candidate => candidate.id === 'f71');
  expect(fleet.hp).toBeLessThan(68);
  expect(Math.ceil(fleet.hp)).toBe(68);
  await load(page, state);
  await selectFleet(page, fleet.id);
  await expect(page.locator('#fleet-bar')).toContainText('67 / 68 hull');
  await expect(page.locator(`#inspector [data-fleet="${fleet.id}"]`)).toContainText('67 / 68 hull');
  await page.locator('[data-action="fleet-hold"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="fleet-roster"]').click();
  await expect(page.locator(`.modal [data-fleet="${fleet.id}"]`)).toContainText('67 / 68 hull');
  await expect(page.locator(`.modal [data-fleet="${fleet.id}"]`)).toContainText('Holding');
  await page.locator(`.modal [data-fleet="${fleet.id}"]`).click();
  await page.screenshot({ path: 'test-results/held-damaged-fleet.png' });
  await page.locator('[data-action="split-menu"]').click();
  await expect(page.locator('.split-note')).toContainText('remains on hold');
  const before = await snapshot(page);
  await page.locator('[data-action="split-confirm"]').click();
  const after = await snapshot(page);
  expect(after.fleets.find(candidate => candidate.id === fleet.id).hold).toBe(true);
  const detached = after.fleets.find(candidate => !before.fleets.some(previous => previous.id === candidate.id));
  expect(detached.hold).toBeUndefined();
  await expect(page.locator('#fleet-bar h3')).toContainText(detached.name);
  await expect(page.locator('[data-action="fleet-hold"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(validateSave(after)).toBe(true);
});
