import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { endTurn, getEmpireStats, validateSave } from '../src/game.js';
import { FACTIONS } from '../src/content.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.evaluate(() => window.__asterion.getState());
const watch = cycle => JSON.parse(readFileSync(new URL(`../docs/watch-playtest/checkpoints/cycle${cycle}.json`, import.meta.url)));
const iron = () => JSON.parse(readFileSync(new URL('../docs/military-playtest/replay/actual-exports/cycle57.json', import.meta.url)));
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('conclusion-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('conclusion-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}
async function holdings(page, values) {
  for (const [key, value] of Object.entries(values)) await expect(page.locator(`[data-conclusion-stat="${key}"] dd`)).toHaveText(String(value));
}
async function reopenFromMenu(page) {
  await page.locator('[data-action="menu"]').click();
  await page.locator('.modal [data-action="show-conclusion"]').click();
}

test('the completed WATCH campaign reopens, links retained reports and exports its exact saved outcome', async ({ page }) => {
  const state = watch(60), errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state);
  await expect(page.locator('#end-turn')).toBeDisabled();
  await expect(page.locator('#mandate')).toContainText('THE CHRONICLE IS COMPLETE');
  await expect(page.locator('#mandate')).not.toContainText('fund 60');
  await page.locator('#mandate [data-action="show-conclusion"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Transcendence');
  await expect(page.locator('#modal-title')).toBeInViewport();
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  await holdings(page, { colonies: 5, population: 43, ships: 17, techs: 11, score: 698 });
  await expect(page.locator('.conclusion-alignment')).toContainText('10 / 10');
  await expect(page.locator('.conclusion-retained-counts')).toContainText('149 Chronicle entries');
  await expect(page.locator('.conclusion-retained-counts')).toContainText('4 battle reports');
  expect(await page.locator('.conclusion-moment').count()).toBeLessThanOrEqual(6);
  expect(await snapshot(page)).toEqual(copy(state));
  await page.screenshot({ path: 'test-results/conclusion-watch60.png' });
  const reportButton = page.locator('.conclusion-history [data-action="combat-report"]').first();
  const reportId = Number(await reportButton.getAttribute('data-report'));
  const report = state.combatReports.find(item => item.id === reportId);
  await reportButton.click();
  await expect(page.locator('.combat-report')).toContainText(report.participants[0].name);
  expect(await snapshot(page)).toEqual(copy(state));
  await page.keyboard.press('Escape'); await reopenFromMenu(page);
  const downloading = page.waitForEvent('download');
  await page.locator('.conclusion-actions [data-action="export"]').click();
  const download = await downloading;
  expect(JSON.parse(readFileSync(await download.path(), 'utf8'))).toEqual(copy(state));
  await page.locator('[data-action="conclusion-chronicle"]').click();
  await expect(page.locator('#workspace-page h2')).toHaveText('Your chronicle');
  await page.locator('#workspace-page [data-action="show-conclusion"]').click();
  await page.locator('[data-action="conclusion-galaxy"]').click();
  await expect(page.locator('#galaxy-page')).toBeVisible();
  expect(await snapshot(page)).toEqual(copy(state));
  expect(errors).toEqual([]);
});

test('the actual military ending remains usable at 390 pixels and labels its capped retained history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = iron();
  await load(page, state); await reopenFromMenu(page);
  await expect(page.locator('#modal-title')).toHaveText('Domination');
  await expect(page.locator('#modal-title')).toBeInViewport();
  await holdings(page, { colonies: 12, population: 104, ships: 15, techs: 11, score: 745 });
  await expect(page.locator('#conclusion-worlds-title')).toHaveText('4 / 4 founding worlds');
  await expect(page.locator('.conclusion-retained-counts')).toContainText('160 Chronicle entries');
  await expect(page.locator('.conclusion-history-scope')).toContainText('not a complete timeline');
  expect(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/conclusion-iron57-narrow.png' });
  const worldLink = page.locator('.conclusion-world-links [data-system-select]').first();
  const worldId = await worldLink.getAttribute('data-system-select');
  await worldLink.click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('#inspector .system-header h2')).toHaveText(state.systems.find(system => system.id === worldId).name);
  expect(await snapshot(page)).toEqual(copy(state));
  await page.reload(); await reopenFromMenu(page);
  expect(await snapshot(page)).toEqual(copy(state));
});

test('an older recorded Transcendence remains authoritative without inventing missing alignment progress', async ({ page }) => {
  const state = watch(60);
  for (const faction of state.factions) delete faction.alignment;
  delete state.alignmentUpdatedTurn;
  await load(page, state); await reopenFromMenu(page);
  await expect(page.locator('#modal-title')).toHaveText('Transcendence');
  await expect(page.locator('.conclusion-missing')).toContainText('Alignment progress was not recorded');
  await expect(page.locator('.conclusion-alignment')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('.alignment-title strong')).toHaveText('— / 10');
  await expect(page.locator('.alignment-segments')).toHaveCount(0);
  await expect(page.locator('[data-race="player"] .race-heading strong')).toHaveText('— / 10');
  await expect(page.locator('[data-race="player"]')).toContainText('Transcendence recorded');
  await expect(page.locator('.participating-beacon')).toHaveCount(0);
  await page.locator('[data-race="player"] [data-action="inspect"]').first().click();
  await expect(page.locator('.beacon-inspector')).not.toContainText('participates in');
  await expect(page.locator('.beacon-inspector')).toContainText('A restored node');
  expect(await snapshot(page)).toEqual(copy(state));
});

test('a loss with no retained history shows the recorded victor and own holdings without a fabricated timeline', async ({ page }) => {
  const state = watch(60);
  state.winner = 'choir'; state.victoryType = 'Legacy';
  state.log = []; state.combatReports = []; state.lastBriefing = null;
  await load(page, state); await reopenFromMenu(page);
  await expect(page.locator('.conclusion-heading')).toContainText('CAMPAIGN CONCLUDED');
  await expect(page.locator('.conclusion-victor')).toContainText(FACTIONS[state.winner].name);
  await expect(page.locator('.conclusion-empty')).toContainText('No moments');
  await expect(page.locator('.conclusion-moment')).toHaveCount(0);
  await holdings(page, { colonies: 5, population: 43, ships: 17, techs: 11, score: 698 });
  await page.keyboard.press('Escape');
  await page.locator('[data-page="journal"]').click();
  await page.locator('#workspace-page [data-action="show-conclusion"]').click();
  await page.locator('[data-action="conclusion-galaxy"]').click();
  await expect(page.locator('#galaxy-page')).toBeVisible();
  expect(await snapshot(page)).toEqual(copy(state));
});

test('the actual tied public race explains Legacy and seeded ties without exposing private rival scores', async ({ page }) => {
  const state = watch(51);
  await load(page, state); await page.locator('[data-page="empire"]').click();
  await expect(page.locator('[data-race="player"] .race-heading strong')).toHaveText('1 / 10');
  await expect(page.locator('[data-race="choir"] .race-heading strong')).toHaveText('1 / 10');
  const rule = page.locator('.race-tie-rule');
  await expect(rule).toContainText('higher Legacy wins');
  await expect(rule).toContainText('galaxy seed');
  await expect(rule).toContainText(`Your Legacy: ${getEmpireStats(state).score}`);
  const before = await page.locator('.network-section').innerHTML();
  expect(await snapshot(page)).toEqual(copy(state));
  // Synthetic private-economy variant of the same public situation.
  const hidden = copy(state);
  for (const faction of hidden.factions.filter(f => f.id !== 'player')) {
    faction.credits += 100000; faction.minerals += 100000;
    const home = hidden.systems.find(system => system.owner === faction.id);
    home.population += 1;
  }
  expect(validateSave(hidden)).toBe(true);
  await page.evaluate(input => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input)), hidden);
  await page.reload(); await page.locator('[data-page="empire"]').click();
  expect(await page.locator('.network-section').innerHTML()).toBe(before);
  expect(await snapshot(page)).toEqual(hidden);
});

test('a normal advancing cycle opens the new conclusion with its exact authoritative win state', async ({ page }) => {
  // Explicit synthetic near-finish variant; the actual WATCH export remains unchanged.
  const state = watch(56); state.factions[0].alignment.progress = 9;
  const expected = copy(state); expect(endTurn(expected).ok).toBe(true);
  expect(expected.winner).toBe('player'); expect(expected.victoryType).toBe('Transcendence');
  await load(page, state);
  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('.campaign-conclusion')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Transcendence');
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  await expect(page.locator('#modal-title')).toBeInViewport();
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('#end-turn')).toBeDisabled();
  await page.locator('[data-action="conclusion-galaxy"]').click();
  await expect(page.locator('#mandate')).not.toContainText('fund 60');
  await page.reload(); await reopenFromMenu(page);
  expect(await snapshot(page)).toEqual(expected);
});
