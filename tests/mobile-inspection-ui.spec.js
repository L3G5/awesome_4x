import { test, expect } from '@playwright/test';
import { createGame, command, getNeighbors } from '../src/game.js';

const snapshot = page => page.evaluate(() => window.__asterion.getState());
const activeFleet = page => page.locator('#fleet-bar .fleet-switch .selected').getAttribute('data-fleet');
const inspection = async page => {
  await expect(page.locator('#fleet-bar')).toHaveClass(/is-inspecting/);
  await expect(page.locator('#fleet-bar h3,.route-strip')).toHaveCount(0);
  await expect(page.locator('.galaxy-fleet[aria-pressed="true"]')).toHaveCount(0);
};

test.describe('mobile touch inspection', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const language of ['en', 'ru']) {
    test(`a fresh world tap inspects without an incidental fleet card in ${language}`, async ({ page }) => {
      await page.addInitScript(lang => localStorage.setItem('asterion-reach-language-v1', lang), language);
      await page.goto('./'); await page.locator('[data-action="begin"]').tap();
      const state = await snapshot(page);
      await inspection(page);
      await page.locator('.galaxy-system-label[data-system-id="s9"]').tap();
      await expect(page.locator('#inspector h2')).toHaveText('Velorum');
      await inspection(page);
      expect((await page.locator('#fleet-bar').boundingBox()).height).toBeLessThanOrEqual(56);
      expect(await snapshot(page)).toEqual(state);
      await page.screenshot({ path: `test-results/mobile-world-inspection-${language}.png` });

      await page.locator('.galaxy-fleet[data-fleet-id="f1"]').tap();
      await expect(page.locator('#fleet-bar h3')).toBeVisible();
      await page.screenshot({ path: `test-results/mobile-explicit-fleet-${language}.png` });
      const close = page.getByRole('button', { name: language === 'ru' ? 'Закрыть панель флота' : 'Close fleet controls', exact: true });
      await close.tap(); await inspection(page);
      await expect(page.locator('#fleet-bar [data-action="fleet-roster"]')).toBeFocused();
      expect(await snapshot(page)).toEqual(state);
    });

    test(`deliberate targeting pays normally and closing preserves a held course in ${language}`, async ({ page }) => {
      const state = createGame('mobile-explicit-controls'), fleet = state.fleets.find(f => f.owner === 'player' && f.type === 'scout');
      const destination = getNeighbors(state, fleet.systemId).find(id => !state.systems.find(s => s.id === id).owner);
      expect(command(state, { type: 'planRoute', fleetId: fleet.id, destinationId: destination }).ok).toBe(true);
      expect(command(state, { type: 'hold', fleetId: fleet.id }).ok).toBe(true);
      await page.addInitScript(({ state, language }) => {
        localStorage.setItem('asterion-reach-save-v1', JSON.stringify(state));
        localStorage.setItem('asterion-reach-language-v1', language);
      }, { state, language });
      await page.goto('./'); await inspection(page);
      await page.locator(`#inspector [data-fleet="${fleet.id}"]`).tap();
      await expect(page.locator('#fleet-bar .route-strip')).toBeVisible();
      await page.locator('[data-action="close-fleet-controls"]').tap();
      await inspection(page); expect(await snapshot(page)).toEqual(state);

      await page.locator('#fleet-bar [data-action="fleet-roster"]').tap();
      await page.locator(`.modal [data-fleet="${fleet.id}"]`).tap();
      await page.locator(`#inspector .building-pills [data-system-select="${destination}"]`).tap();
      expect(await activeFleet(page)).toBe(fleet.id);
      expect(await snapshot(page)).toEqual(state);
      await page.locator('[data-action="move"]').tap();
      expect(command(state, { type: 'move', fleetId: fleet.id, targetId: destination }).ok).toBe(true);
      expect(await snapshot(page)).toEqual(state);
      await page.locator('[data-action="close-fleet-controls"]').tap();
      await inspection(page); expect(await snapshot(page)).toEqual(state);
    });
  }
});

test('entering mobile clears once; explicit keyboard selection and modal Escape retain their meanings', async ({ page }) => {
  await page.goto('./'); await page.locator('[data-action="begin"]').click();
  const state = await snapshot(page);
  expect(await activeFleet(page)).toBe('f1');
  await expect(page.locator('[data-action="close-fleet-controls"]')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 }); await inspection(page);
  await page.keyboard.press('n'); expect(await activeFleet(page)).toBe('f1');
  await page.setViewportSize({ width: 400, height: 844 }); expect(await activeFleet(page)).toBe('f1');
  await page.locator('[data-action="menu"]').click(); await page.keyboard.press('Escape');
  expect(await activeFleet(page)).toBe('f1');
  await page.keyboard.press('Escape'); await inspection(page);
  await page.keyboard.press('n'); await page.keyboard.press('h'); await inspection(page);
  await page.keyboard.press('n'); await page.locator('[data-action="home"]').click(); await inspection(page);
  await page.keyboard.press('n'); await page.locator('[data-page="empire"]').click();
  await page.locator('[data-colony-row="s0"] [data-action="inspect"]').click(); await inspection(page);
  expect(await snapshot(page)).toEqual(state);
});

test('mobile reload, import and new campaign start in inspection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./'); await page.locator('[data-action="begin"]').click();
  await page.keyboard.press('n'); await page.reload(); await inspection(page);
  const imported = createGame('mobile-import-inspection');
  await page.keyboard.press('n');
  await page.locator('#import-save').setInputFiles({ name: 'campaign.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.locator('#confirm-import').click(); await inspection(page);
  expect(await snapshot(page)).toEqual(imported);
  await page.keyboard.press('n'); await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new-game-menu"]').click();
  await page.locator('#galaxy-seed').fill('mobile-new-inspection');
  await page.locator('[data-action="new-game-confirm"]').click();
  await page.locator('[data-action="begin"]').click(); await inspection(page);
  expect(await snapshot(page)).toEqual(createGame('mobile-new-inspection'));
});

test.describe('mobile landscape touch', () => {
  test.use({ viewport: { width: 640, height: 390 }, isMobile: true, hasTouch: true });
  test('the inspector does not cover deliberate movement controls', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('asterion-reach-language-v1', 'ru'));
    await page.goto('./'); await page.locator('[data-action="begin"]').tap();
    const state = await snapshot(page), target = getNeighbors(state, 's0').find(id => !state.systems.find(s => s.id === id).owner);
    await page.locator('.galaxy-fleet[data-fleet-id="f1"]').tap();
    await page.locator(`#inspector .building-pills [data-system-select="${target}"]`).tap();
    const geometry = await page.evaluate(() => ({ mapBottom: document.querySelector('#galaxy-page').getBoundingClientRect().bottom, inspectorTop: document.querySelector('.inspector').getBoundingClientRect().top }));
    expect(geometry.mapBottom).toBeLessThanOrEqual(geometry.inspectorTop + 1);
    await page.locator('[data-action="move"]').tap();
    expect(command(state, { type: 'move', fleetId: 'f1', targetId: target }).ok).toBe(true);
    expect(await snapshot(page)).toEqual(state);
  });
});
