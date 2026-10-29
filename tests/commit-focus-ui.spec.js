import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { command } from '../src/game.js';

const snapshot = page => page.evaluate(() => window.__asterion.getState());
const actual50 = () => JSON.parse(readFileSync(new URL('../docs/default-campaign/actual/083-asterion-reach-cycle-50.json', import.meta.url), 'utf8'));
async function load(page) {
  const state = actual50();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(input => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input)), state);
  await page.goto('./');
  await expect(page.locator('#inspector h2')).toHaveText('Solace');
  expect(await snapshot(page)).toEqual(state);
  return state;
}

for (const width of [1440, 390]) {
  test(`keyboard map selection retains the selected label at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await load(page);
    const label = page.locator('.galaxy-system-label:not(.is-selected):visible').first();
    const systemId = await label.getAttribute('data-system-id');
    const selected = page.locator(`.galaxy-system-label[data-system-id="${systemId}"]`);
    const mapScroll = await page.locator('#galaxy').evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }));
    await label.focus();
    await page.keyboard.press('Enter');
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#inspector h2')).toHaveText(state.systems.find(system => system.id === systemId).name);
    expect(await page.locator('#galaxy').evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual(mapScroll);
    expect(await snapshot(page)).toEqual(state);
  });

  test(`keyboard Empire inspection focuses its resulting world at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await load(page);
    await page.locator('[data-page="empire"]').click();
    const inspect = page.locator('[data-colony="s28"] [data-action="inspect"]');
    await inspect.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#inspector .system-header h2')).toHaveText('Haven');
    await expect(page.locator('#inspector .system-header h2')).toBeFocused();
    await expect(page.locator('#inspector .system-header h2')).toBeInViewport();
    expect(await snapshot(page)).toEqual(state);
  });

  test(`keyboard research commission focuses the current result at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await load(page);
    const expected = structuredClone(state);
    expect(command(expected, { type: 'research', techId: 'terraforming' }).ok).toBe(true);
    await page.locator('[data-page="research"]').click();
    await page.locator('[data-action="research"][data-tech="terraforming"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#workspace-page .callout')).toBeFocused();
    await expect(page.locator('#workspace-page .callout')).toContainText('Worldshaping');
    await expect(page.locator('#workspace-page .callout')).toBeInViewport();
    expect(await snapshot(page)).toEqual(expected);
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-research-filter="All"]')).toBeFocused();
  });

  test(`keyboard construction commission focuses the paid project at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await load(page);
    const expected = structuredClone(state);
    expect(command(expected, { type: 'build', systemId: 's28', itemId: 'shipyard', replaceBuildingId: 'mine' }).ok).toBe(true);
    await page.locator('[data-page="empire"]').click();
    await page.locator('[data-colony="s28"] [data-action="inspect"]').click();
    const opener = page.locator('[data-action="build-menu"][data-system="s28"]');
    await opener.focus();
    await page.keyboard.press('Enter');
    const close = page.locator('.modal .close-modal');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#replace-building')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    expect(await snapshot(page)).toEqual(state);
    await page.keyboard.press('Enter');
    await page.locator('#replace-building').selectOption('mine');
    await page.locator('[data-action="build"][data-item="shipyard"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('#inspector .production-row')).toBeFocused();
    await expect(page.locator('#inspector .production-row')).toContainText('Orbital Shipyard');
    await expect(page.locator('#inspector .production-row')).toBeInViewport();
    expect(await snapshot(page)).toEqual(expected);
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-action="cancel-build"]')).toBeFocused();
  });

  test(`keyboard charter commission focuses the paid project at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await load(page);
    const expected = structuredClone(state);
    expect(command(expected, { type: 'develop', systemId: 's28', charterType: 'academy' }).ok).toBe(true);
    await page.locator('[data-page="empire"]').click();
    await page.locator('[data-colony="s28"] [data-action="inspect"]').click();
    await page.locator('[data-action="development-menu"][data-system="s28"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-action="develop"][data-charter="academy"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('#inspector .production-row')).toBeFocused();
    await expect(page.locator('#inspector .production-row')).toContainText('Academy');
    await expect(page.locator('#inspector .production-row')).toBeInViewport();
    expect(await snapshot(page)).toEqual(expected);
  });
}

test('the hidden importer is skipped by Tab and still opens from the menu', async ({ page }) => {
  const state = await load(page);
  await page.locator('#end-turn').focus();
  // Chromium can pass through browser chrome before wrapping to the first control.
  for (let step = 0; step < 2; step++) {
    await page.keyboard.press('Tab');
    await expect(page.locator('#import-save')).not.toBeFocused();
    if (await page.locator('#briefing-button').evaluate(element => element === document.activeElement)) break;
  }
  await expect(page.locator('#briefing-button')).toBeFocused();
  await page.getByRole('button', { name: 'Game menu' }).click();
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import"]').click();
  await fileChooser;
  expect(await snapshot(page)).toEqual(state);
});

test('pointer actions retain their existing focus behavior', async ({ page }) => {
  const state = await load(page);
  await page.locator('.galaxy-system-label:not(.is-selected):visible').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.galaxy-system-label.is-selected')).toBeFocused();
  await page.locator('.galaxy-system-label:not(.is-selected):visible').first().click();
  await expect(page.locator('.galaxy-system-label.is-selected')).not.toBeFocused();
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="terraforming"]').click();
  await expect(page.locator('#workspace-page .callout')).not.toBeFocused();
  const expected = structuredClone(state);
  expect(command(expected, { type: 'research', techId: 'terraforming' }).ok).toBe(true);
  await page.locator('[data-page="empire"]').click();
  await page.locator('[data-colony="s28"] [data-action="inspect"]').click();
  await expect(page.locator('#inspector .system-header h2')).not.toBeFocused();
  await page.locator('[data-action="build-menu"][data-system="s28"]').click();
  await page.locator('#replace-building').selectOption('mine');
  await page.locator('[data-action="build"][data-item="shipyard"]').click();
  await expect(page.locator('#inspector .production-row')).not.toBeFocused();
  expect(command(expected, { type: 'build', systemId: 's28', itemId: 'shipyard', replaceBuildingId: 'mine' }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
});
