import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGame, command, endTurn, getNeighbors, validateSave } from '../src/game.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.evaluate(() => window.__asterion.getState());
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('reinforcement-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('reinforcement-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}
const select = (page, id) => page.locator(`#inspector [data-fleet="${id}"]`).click();
function addPartner(state, original, values = {}) {
  const partner = { ...original, id: `f${state.nextFleetId++}`, name: 'Reinforcement escort', ...values };
  state.fleets.push(partner);
  return partner;
}

test('the actual WATCH40 formation merges and commissions in two explicit actions with exact ordinary results', async ({ page }) => {
  const state = JSON.parse(readFileSync(new URL('../docs/watch-playtest/checkpoints/cycle40.json', import.meta.url)));
  const expected = copy(state), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, state); await select(page, 'f47');
  await expect(page.locator('.merge-summary')).toContainText('Vanguard 49');
  await expect(page.locator('.merge-summary')).toContainText('68');
  await expect(page.locator('.reinforcement-panel')).toContainText('25');
  await expect(page.locator('.reinforcement-panel')).toContainText('28');
  await expect(page.locator('.reinforcement-panel')).toContainText('separate formation');
  expect(await snapshot(page)).toEqual(copy(state));
  await page.screenshot({ path: 'test-results/reinforcement-watch40.png' });
  await page.locator('[data-action="merge"]').click();
  expect(command(expected, { type: 'merge', fleetId: 'f47', targetFleetId: 'f49' }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('[data-action="reinforce"]')).toBeInViewport();
  await expect(page.locator('.reinforcement-panel')).toBeFocused();
  await page.locator('[data-action="reinforce"]').focus(); await page.keyboard.press('Space');
  expect(command(expected, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  expect(expected.factions[0].orders).toBe(state.factions[0].orders - 2);
  expect(expected.factions[0].credits).toBe(state.factions[0].credits - 25);
  expect(expected.factions[0].minerals).toBe(state.factions[0].minerals - 28);
  expect(expected.fleets.find(f => f.id === 'f47')).toMatchObject({ ships: 2, hp: 68, hold: true, movesLeft: 1 });
  await expect(page.locator('.reinforcement-panel')).toBeFocused();
  await expect(page.locator('[data-action="reinforce"]')).toBeDisabled();
  await page.reload(); expect(await snapshot(page)).toEqual(expected);
  const nextId = `f${expected.nextFleetId}`;
  endTurn(expected); await page.locator('[data-action="end-turn"]').click();
  expect(await snapshot(page)).toEqual(expected);
  expect(expected.fleets.find(f => f.id === nextId)).toMatchObject({ owner: 'player', type: 'frigate', ships: 1, hp: 34, systemId: 's0' });
  expect(expected.fleets.find(f => f.id === nextId).hold).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a single compatible partner remains one click when the first local partner would exceed the cap', async ({ page }) => {
  const state = createGame('reinforcement-cap-browser'), fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  Object.assign(fleet, { ships: 9, hp: 230 });
  const oversized = addPartner(state, fleet, { name: 'Four-ship guard', ships: 4, hp: 130 });
  const compatible = addPartner(state, fleet, { name: 'Two-ship escort', ships: 2, hp: 50, movesLeft: 0 });
  const expected = copy(state);
  await load(page, state); await select(page, fleet.id);
  await expect(page.locator('[data-action="merge-menu"]')).toHaveCount(0);
  await expect(page.locator('[data-action="merge"]')).toHaveAttribute('data-target', compatible.id);
  await expect(page.locator('.merge-summary')).toContainText(compatible.name);
  await expect(page.locator('.merge-summary')).toContainText('280');
  await page.locator('[data-action="merge"]').click();
  expect(command(expected, { type: 'merge', fleetId: fleet.id, targetFleetId: compatible.id }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  expect(expected.fleets.find(f => f.id === fleet.id)).toMatchObject({ ships: 11, hp: 280, movesLeft: 0 });
  expect(expected.fleets.find(f => f.id === oversized.id)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Merge unavailable' })).toBeDisabled();
});

test('a narrow keyboard chooser previews the deliberate survivor, course, hold, defensive lead and heritage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = createGame('reinforcement-choice-browser'), fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  Object.assign(fleet, { ships: 2, hp: 50 });
  state.systems[0].anomaly = { id: 'forge', resolved: false };
  expect(command(state, { type: 'anomaly', systemId: 's0', choiceId: 'ship' }).ok).toBe(true);
  const ancient = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate' && f.id !== fleet.id);
  ancient.movesLeft = 0;
  const alternative = addPartner(state, fleet, { name: 'Local watch', ships: 1, hp: 20 });
  const destination = getNeighbors(state, 's0').find(id => !state.systems.find(s => s.id === id).owner);
  expect(command(state, { type: 'planRoute', fleetId: fleet.id, destinationId: destination }).ok).toBe(true);
  expect(command(state, { type: 'hold', fleetId: fleet.id }).ok).toBe(true);
  expect(command(state, { type: 'leadDefense', fleetId: ancient.id }).ok).toBe(true);
  const expected = copy(state);
  await load(page, state); await select(page, fleet.id);
  await page.locator('[data-action="merge-menu"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#merge-partner')).toBeFocused();
  await expect(page.locator('#modal-title')).toBeInViewport();
  await page.locator('#merge-partner').selectOption(ancient.id);
  await expect(page.locator('.merge-result')).toContainText(fleet.name);
  await expect(page.locator('.merge-result')).toContainText('84');
  await expect(page.locator('.modal')).toContainText('course');
  await expect(page.locator('.modal')).toContainText('defensive lead');
  expect(await snapshot(page)).toEqual(copy(state));
  await expect(page.locator('.modal .close-modal')).toBeInViewport();
  expect(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/reinforcement-merge-narrow.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-action="merge-menu"]')).toBeFocused();
  await page.keyboard.press('Enter'); await page.locator('#merge-partner').selectOption(ancient.id);
  await page.locator('[data-action="merge-confirm"]').click();
  expect(command(expected, { type: 'merge', fleetId: fleet.id, targetFleetId: ancient.id }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  const merged = expected.fleets.find(f => f.id === fleet.id);
  expect(merged).toMatchObject({ ships: 3, hp: 84, movesLeft: 0, hold: true, defenseLead: true });
  expect(merged.route).toEqual(fleet.route); expect(merged.heritage).toEqual(ancient.heritage);
  expect(expected.fleets.find(f => f.id === alternative.id)).toBeTruthy();
  await page.reload(); expect(await snapshot(page)).toEqual(expected);
});

test('a full task force can commission a separate ship at its inspected yard using its last order', async ({ page }) => {
  const state = createGame('reinforcement-full-browser'), fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  Object.assign(fleet, { ships: 12, hp: 408 }); state.factions[0].orders = 1;
  const expected = copy(state);
  await load(page, state); await select(page, fleet.id);
  const neighbor = getNeighbors(state, 's0')[0];
  await page.locator(`#inspector [data-system-select="${neighbor}"]`).click();
  await expect(page.locator('[data-action="reinforce"]')).toHaveCount(0);
  await page.locator('[data-action="home"]').click();
  await expect(page.locator('[data-action="reinforce"]')).toBeEnabled();
  await page.locator('[data-action="reinforce"]').click();
  expect(command(expected, { type: 'build', systemId: 's0', itemId: 'frigate' }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  expect(expected.fleets.find(f => f.id === fleet.id).ships).toBe(12);
  await expect(page.locator('.reinforcement-panel')).toBeFocused();
  await expect(page.locator('[data-action="reinforce"]')).toBeDisabled();
  await expect(page.locator('.reinforcement-panel')).toContainText('No orders');
});

for (const ended of [false, true]) test(`${ended ? 'a finished campaign' : 'an exhausted mandate'} retains read-only merge choices and disables new commissions`, async ({ page }) => {
  const state = createGame(`reinforcement-disabled-${ended}`), fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  addPartner(state, fleet, { name: 'First escort' }); addPartner(state, fleet, { name: 'Second escort' });
  state.factions[0].orders = 0;
  if (ended) { state.winner = 'player'; state.victoryType = 'Legacy'; }
  await load(page, state); await select(page, fleet.id);
  await expect(page.locator('[data-action="reinforce"]')).toBeDisabled();
  await expect(page.locator('.reinforcement-panel')).toContainText(ended ? 'campaign has ended' : 'No orders');
  await page.locator('[data-action="merge-menu"]').click();
  await expect(page.locator('[data-action="merge-confirm"]')).toBeDisabled();
  await page.locator('#merge-partner').selectOption({ label: await page.locator('#merge-partner option').last().textContent() });
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  expect(await page.locator('.modal').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  expect(await snapshot(page)).toEqual(copy(state));
});
