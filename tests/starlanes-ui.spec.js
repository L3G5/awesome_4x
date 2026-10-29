import { test, expect } from '@playwright/test';
import { createGame, command, endTurn, validateSave } from '../src/game.js';

const snapshot = page => page.evaluate(() => window.__asterion.getState());
function fixture(many = false) {
  const state = createGame('starlane-interface'), lane = state.ancientLanes[0];
  const [a, b] = lane.endpoints.map(id => state.systems.find(system => system.id === id));
  for (const system of [a, b]) {
    Object.assign(system, { owner: 'player', population: 6, buildings: ['mine', 'factory'], queue: null });
  }
  if (many) for (const system of state.systems.filter(world => !world.owner && !lane.endpoints.includes(world.id)).slice(0, 4)) {
    Object.assign(system, { owner: 'player', population: 3, buildings: ['mine'], queue: null });
  }
  for (const world of state.systems) {
    if (!world.knownBy.includes('player')) world.knownBy.push('player');
    if (!world.exploredBy.includes('player')) world.exploredBy.push('player');
  }
  Object.assign(state.factions[0], { techs: ['logistics', 'industry'], credits: 900, minerals: 900, orders: 10 });
  const scout = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'scout');
  scout.hold = true;
  expect(validateSave(state)).toBe(true);
  return { state, lane, a, b, scout };
}
async function load(page, state, language = 'en') {
  await page.addInitScript(({ state, language }) => {
    if (localStorage.getItem('starlane-interface-fixture')) return;
    localStorage.setItem('asterion-reach-save-v1', JSON.stringify(state));
    localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
    localStorage.setItem('asterion-reach-language-v1', language);
    localStorage.setItem('starlane-interface-fixture', 'loaded');
  }, { state, language });
  await page.goto('./');
}
const viewPosition = page => page.evaluate(() => ({ vertical: document.querySelector('#workspace-page').scrollTop, horizontal: document.querySelector('.colony-scroll').scrollLeft }));

for (const width of [1440, 390]) for (const language of ['en', 'ru']) {
  test(`Empire commissions a lane without losing comparison context or fleet intent at ${width} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const { state, lane, a, scout } = fixture(true);
    await load(page, state, language);
    await page.locator('[data-page="empire"]').click();
    await page.locator('[data-action="colony-sort"][data-sort="production"]').click();
    const row = page.locator(`[data-colony-row="${a.id}"]`), commission = row.locator('[data-action="empire-build-menu"]');
    await commission.scrollIntoViewIfNeeded();
    await page.locator('.colony-scroll').evaluate(element => { element.scrollLeft = 180; });
    await commission.focus();
    const position = await viewPosition(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal')).toBeVisible();
    expect(await page.evaluate(() => window.__asterion.getPage())).toBe('empire');
    await page.locator('[data-action="construction-tab"][data-tab="starlane"]').click();
    const project = page.locator(`[data-starlane="${lane.id}"]`);
    await expect(project).toContainText(language === 'ru' ? 'Короткий путь' : 'shortcut');
    await expect(project).toContainText('60'); await expect(project).toContainText('70'); await expect(project).toContainText('48');
    await expect(project.locator('[data-action="restore-lane"]')).toBeEnabled();
    expect(await snapshot(page)).toEqual(state);
    const toggle = page.locator('.modal [data-action="language"]');
    await toggle.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await expect(toggle).toBeFocused(); expect(await snapshot(page)).toEqual(state);
    const restore = project.locator('[data-action="restore-lane"]');
    await restore.focus(); await page.keyboard.press('Enter');
    expect(command(state, { type: 'restoreLane', systemId: a.id, laneId: lane.id }).ok).toBe(true);
    expect(await snapshot(page)).toEqual(state);
    expect(await page.evaluate(() => window.__asterion.getPage())).toBe('empire');
    await expect(row).toBeFocused();
    expect(await viewPosition(page)).toEqual(position);
    await expect(page.locator('[data-action="colony-sort"][data-sort="production"]').locator('..')).toHaveAttribute('aria-sort', 'descending');
    await expect(row.locator('[data-action="empire-build-menu"]')).toHaveCount(0);
    await expect(row).toContainText(language === 'ru' ? 'Восстановление звёздного пути' : 'Starlane restoration');
    const expected = state.fleets.find(fleet => fleet.id === scout.id);
    expect(expected.hold).toBe(true); expect(expected.systemId).toBe('s0');
    await page.locator('[data-page="galaxy"]').click();
    await expect(page.locator(`.fleet-switch [data-fleet="${scout.id}"]`)).toHaveClass(/selected/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('changing the construction endpoint, cancelling and reloading preserve the exact campaign', async ({ page }) => {
  const { state, lane, a, b } = fixture();
  await load(page, state, 'ru');
  await page.locator('[data-page="empire"]').click();
  const opener = page.locator(`[data-colony-row="${a.id}"] [data-action="empire-build-menu"]`);
  await opener.click();
  await page.locator('[data-action="construction-tab"][data-tab="starlane"]').click();
  await page.locator('#starlane-builder').selectOption(b.id);
  await expect(page.locator('#starlane-builder')).toBeFocused();
  await expect(page.locator('[data-action="restore-lane"]')).toHaveAttribute('data-system', b.id);
  expect(await snapshot(page)).toEqual(state);
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
  expect(await snapshot(page)).toEqual(state);
  await opener.click(); await page.locator('[data-action="construction-tab"][data-tab="starlane"]').click();
  await page.locator('#starlane-builder').selectOption(b.id);
  await page.locator('[data-action="restore-lane"]').click();
  expect(command(state, { type: 'restoreLane', systemId: b.id, laneId: lane.id }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(state);
  await page.reload(); expect(await snapshot(page)).toEqual(state);
  await page.locator('[data-page="empire"]').click();
  await page.locator(`[data-colony-row="${b.id}"] [data-action="inspect"]`).click();
  await page.locator('[data-action="cancel-build"]').click();
  expect(command(state, { type: 'cancelBuild', systemId: b.id }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(state);
  await page.reload(); expect(await snapshot(page)).toEqual(state);
});

test('completion announces a shared lane and ordinary UI movement spends one order and jump', async ({ page }) => {
  const { state, lane, a, b, scout } = fixture();
  scout.systemId = a.id;
  await load(page, state);
  await page.locator('[data-page="empire"]').click();
  await page.locator(`[data-colony-row="${a.id}"] [data-action="empire-build-menu"]`).click();
  await page.locator('[data-action="construction-tab"][data-tab="starlane"]').click();
  await page.locator('[data-action="restore-lane"]').click();
  expect(command(state, { type: 'restoreLane', systemId: a.id, laneId: lane.id }).ok).toBe(true);
  for (let cycle = 0; a.queue && cycle < 8; cycle++) {
    await page.locator('#end-turn').click(); expect(endTurn(state).ok).toBe(true);
    expect(await snapshot(page)).toEqual(state);
    if (!a.queue) {
      await expect(page.locator('.modal')).toContainText('The dormant lane between');
      await expect(page.locator('.modal')).toContainText('All empires can use it');
    }
    if (await page.locator('.modal').count()) await page.locator('.modal .close-modal').click();
  }
  expect(lane.openedTurn).not.toBeNull();
  await page.locator('[data-page="galaxy"]').click();
  await page.locator(`.fleet-switch [data-fleet="${scout.id}"]`).click();
  await page.locator(`#inspector .building-pills [data-system-select="${b.id}"]`).click();
  await page.locator('[data-action="move"]').click();
  expect(command(state, { type: 'move', fleetId: scout.id, targetId: b.id }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(state);
  await expect(page.locator('.starlane-inspector')).toContainText('Restored in cycle');
});


for (const width of [1440, 390]) for (const language of ['en', 'ru']) {
  test(`inspector restoration follows the chosen builder and retains the held scout at ${width} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { state, lane, a, b, scout } = fixture();
    await load(page, state, language);
    await page.locator('[data-page="empire"]').click();
    await page.locator(`[data-colony-row="${a.id}"] [data-action="inspect"]`).click();
    await page.locator('[data-action="starlane-menu"]').click();
    await expect(page.locator('.modal .close-modal')).toBeFocused();
    await page.locator('#starlane-builder').selectOption(b.id);
    const restore = page.locator('[data-action="restore-lane"]');
    await restore.focus(); await page.keyboard.press('Enter');
    expect(command(state, { type: 'restoreLane', systemId: b.id, laneId: lane.id }).ok).toBe(true);
    expect(await snapshot(page)).toEqual(state);
    await expect(page.locator('#inspector h2')).toHaveText(b.name);
    await expect(page.locator('#inspector .production-row')).toBeFocused();
    await expect(page.locator(`.fleet-switch [data-fleet="${scout.id}"]`)).toHaveClass(/selected/);
    expect(state.fleets.find(fleet => fleet.id === scout.id).hold).toBe(true);
    expect(state.fleets.find(fleet => fleet.id === scout.id).systemId).toBe('s0');
  });
}
