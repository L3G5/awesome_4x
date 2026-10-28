import { test, expect } from '@playwright/test';
import { createGame, command, getNeighbors, getEmpireStats, validateSave } from '../src/game.js';

function formationFixture() {
  const state = createGame('fleet-controls'), original = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate');
  original.ships = 4; original.hp = 80;
  state.systems[0].anomaly = { id: 'forge', resolved: false };
  expect(command(state, { type: 'anomaly', systemId: 's0', choiceId: 'ship' }).ok).toBe(true);
  const escort = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate' && fleet.id !== original.id);
  expect(command(state, { type: 'merge', fleetId: original.id, targetFleetId: escort.id }).ok).toBe(true);
  const destinationId = getNeighbors(state, original.systemId).find(id => !state.systems.find(system => system.id === id).owner);
  expect(command(state, { type: 'planRoute', fleetId: original.id, destinationId }).ok).toBe(true);
  expect(validateSave(state)).toBe(true);
  return { state, original, destinationId };
}

async function load(page, state) {
  await page.addInitScript(saved => {
    if (!localStorage.getItem('fleet-control-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('fleet-control-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}

test('a damaged fleet detaches ships at the disclosed cost while preserving its course and history', async ({ page }) => {
  const { state, original, destinationId } = formationFixture();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state);
  await page.locator(`#inspector [data-fleet="${original.id}"]`).click();
  await page.locator('[data-action="split-menu"]').click();
  await page.locator('#split-ships').selectOption('2');
  await expect(page.locator('.split-preview')).toContainText('45.6 / 68 hull');
  await expect(page.locator('.split-preview')).toContainText('Keeps its plotted course');
  await expect(page.locator('#split-ships')).toBeFocused();
  await page.screenshot({ path: 'test-results/fleet-split.png' });
  await page.locator('[data-action="split-confirm"]').click();
  const after = await page.evaluate(() => window.__asterion.getState());
  const parent = after.fleets.find(fleet => fleet.id === original.id);
  const child = after.fleets.find(fleet => fleet.id === `f${state.nextFleetId}`);
  expect(parent.ships).toBe(3); expect(child.ships).toBe(2);
  expect(parent.hp + child.hp).toBe(original.hp);
  expect(parent.route).toEqual(original.route); expect(child.route).toBeUndefined();
  expect(child.heritage).toEqual(original.heritage);
  expect(after.factions[0].orders).toBe(state.factions[0].orders - 1);
  expect(getEmpireStats(after).upkeep).toBe(getEmpireStats(state).upkeep);
  await expect(page.locator('#fleet-bar h3')).toContainText(child.name);
  await page.locator(`#inspector [data-system-select="${destinationId}"]`).click();
  await page.locator('[data-action="move"]').click();
  const moved = await page.evaluate(() => window.__asterion.getState());
  expect(moved.fleets.find(fleet => fleet.id === child.id).movesLeft).toBe(child.movesLeft - 1);
  expect(moved.fleets.find(fleet => fleet.id === original.id).movesLeft).toBe(original.movesLeft);
  await page.reload();
  expect(await page.evaluate(() => window.__asterion.getState())).toEqual(moved);
  await page.locator(`#inspector [data-fleet="${original.id}"]`).click();
  await expect(page.locator('.route-strip')).toContainText(state.systems.find(system => system.id === destinationId).name);
  expect(errors).toEqual([]);
});

test('the colony discloses one repair pool shared by detached formations', async ({ page }) => {
  const { state, original } = formationFixture();
  expect(command(state, { type: 'split', fleetId: original.id, ships: 2 }).ok).toBe(true);
  const totalHull = value => value.fleets.filter(fleet => fleet.owner === 'player' && fleet.type === 'frigate').reduce((sum, fleet) => sum + fleet.hp, 0);
  await load(page, state);
  await expect(page.locator('.colony-repairs')).toContainText('8 hull recovery');
  await expect(page.locator('.colony-repairs')).toContainText('2 formations');
  await page.locator('[data-action="end-turn"]').click();
  const after = await page.evaluate(() => window.__asterion.getState());
  expect(totalHull(after) - totalHull(state)).toBeCloseTo(8, 10);
  expect(validateSave(after)).toBe(true);
});
