import { test, expect } from '@playwright/test';
import { createGame, command, validateSave } from '../src/game.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.evaluate(() => window.__asterion.getState());
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('investment-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('investment-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}
const effect = (details, label) => details.locator('.investment-table').first().locator('tr').filter({ has: details.page().getByRole('rowheader', { name: label, exact: true }) });

test('an unfunded exhausted mandate can compare Forge throughput by keyboard without committing it', async ({ page }) => {
  const state = createGame('forge-investment-browser'), player = state.factions[0], home = state.systems[0];
  Object.assign(player, { credits: 0, minerals: 0, orders: 0, techs: ['logistics', 'industry'] });
  Object.assign(home, { population: 8, buildings: ['mine', 'shipyard', 'factory'], charter: { type: 'forge', level: 1 } });
  await load(page, state);
  await page.locator('[data-action="development-menu"]').click();
  const option = page.locator('[data-investment-project="forge"]'), details = option.locator('.investment-comparison');
  await expect(option.locator('[data-action="develop"]')).toBeDisabled();
  await expect(option.locator('.build-cost')).toContainText('300');
  await expect(option.locator('.build-cost')).toContainText('100');
  expect(await details.evaluate(el => el.open)).toBe(false);
  await details.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(details.locator('.investment-duration')).toContainText('5 cycles to build this project');
  await expect(details.locator('.investment-duration')).toContainText('100 work at 24 production');
  await expect(effect(details, 'Production / cycle').locator('td')).toHaveText(['24', '30']);
  await expect(details.locator('[data-throughput="frigate"] td strong')).toHaveText(['2 cycles', '1 cycle']);
  await expect(details.locator('.investment-replacement')).toContainText('Replaced on completion: Forge Charter I');
  expect(await snapshot(page)).toEqual(copy(state));
  await page.keyboard.press('Space');
  expect(await details.evaluate(el => el.open)).toBe(false);
  await page.keyboard.press('Escape');
  expect(await snapshot(page)).toEqual(copy(state));
});

test('replacement comparison includes the lost Extraction charter and keeps ordinary one-click payment unchanged', async ({ page }) => {
  const state = createGame('extractor-investment-browser'), player = state.factions[0], home = state.systems[0];
  Object.assign(player, { credits: 500, minerals: 500, techs: ['logistics'] });
  Object.assign(home, { buildings: ['mine', 'shipyard', 'lab'], charter: { type: 'extraction', level: 1 } });
  const expected = copy(state);
  await load(page, state);
  await page.locator('[data-action="build-menu"]').click();
  await page.locator('#replace-building').selectOption('mine');
  const option = page.locator('[data-investment-project="market"]'), details = option.locator('.investment-comparison');
  await details.locator('summary').click();
  await expect(effect(details, 'Colony minerals / cycle').locator('td')).toHaveText(['14', '4']);
  await expect(effect(details, 'Colony credits / cycle').locator('td')).toHaveText(['11', '18']);
  await expect(details.locator('.investment-replacement')).toContainText('Orbital Extractor and Extraction Charter I');
  await expect(details.locator('.investment-empire')).toContainText('New income is collected from the cycle after completion');
  expect(await snapshot(page)).toEqual(copy(state));
  await option.locator('[data-action="build"]').click();
  expect(command(expected, { type: 'build', systemId: home.id, itemId: 'market', replaceBuildingId: 'mine' }).ok).toBe(true);
  expect(await snapshot(page)).toEqual(expected);
  expect(expected.systems[0].buildings).toContain('mine');
  expect(expected.systems[0].charter).toEqual({ type: 'extraction', level: 1 });
  expect(expected.systems[0].queue.cost).toEqual({ credits: 25, minerals: 20 });
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);
});

test('narrow replacement details retain above-capacity population and disclose loss of shipbuilding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = createGame('capacity-investment-browser'), player = state.factions[0], home = state.systems[0];
  Object.assign(player, { credits: 500, minerals: 500, techs: ['ecology', 'logistics', 'industry', 'weapons', 'cruisers'] });
  Object.assign(home, { population: 10, buildings: ['mine', 'shipyard', 'habitat', 'lab'] });
  await load(page, state);
  await page.locator('[data-action="build-menu"]').click();
  await page.locator('#replace-building').selectOption('habitat');
  let details = page.locator('[data-investment="market"]');
  await details.locator('summary').click();
  await expect(effect(details, 'Population / capacity').locator('td')).toHaveText(['10 / 12', '10 / 8']);
  await expect(details).toContainText('Population stays at 10. Natural growth is paused');
  await page.locator('#replace-building').selectOption('shipyard');
  details = page.locator('[data-investment="market"]');
  await details.locator('summary').click();
  const frigate = details.locator('[data-throughput="frigate"]');
  await expect(frigate.locator('td').last()).toContainText('Unavailable');
  await expect(frigate.locator('td').last()).toContainText('Requires an Orbital Shipyard');
  await expect(frigate.locator('td').last()).not.toContainText('0 cycles');
  await expect(effect(details, 'Shared repair pool').locator('td')).toHaveText(['8', '4']);
  await frigate.scrollIntoViewIfNeeded();
  expect(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.locator('.modal .close-modal')).toBeInViewport();
  await page.screenshot({ path: 'test-results/investment-narrow-shipyard.png' });
  await page.keyboard.press('Escape');
  expect(await snapshot(page)).toEqual(copy(state));
});

test('a capped Civic investment shows unchanged usable orders and remains readable after the campaign ends', async ({ page }) => {
  const state = createGame('capped-investment-browser'), player = state.factions[0], home = state.systems[0];
  for (const [index, world] of [home, ...state.systems.slice(4, 11)].entries()) {
    Object.assign(world, { owner: 'player', population: 8, buildings: index === 0 ? ['forum', 'lab', 'factory'] : [], queue: null });
    world.knownBy = [...new Set([...world.knownBy, 'player'])];
    world.exploredBy = [...new Set([...world.exploredBy, 'player'])];
  }
  home.charter = { type: 'civic', level: 1 };
  Object.assign(player, { techs: ['logistics', 'industry', 'diplomacy', 'command'], credits: 2000, minerals: 2000, orders: 18 });
  state.winner = 'player'; state.victoryType = 'Legacy';
  await load(page, state);
  await page.locator('[data-action="development-menu"]').click();
  const option = page.locator('[data-investment-project="civic"]'), details = option.locator('.investment-comparison');
  await expect(option.locator('[data-action="develop"]')).toBeDisabled();
  await expect(option.locator('.build-reason')).toContainText('campaign has ended');
  await details.locator('summary').click();
  await expect(effect(details, 'Empire orders / cycle').locator('td')).toHaveText(['18', '18']);
  await expect(details).toContainText('18-order cap keeps usable orders unchanged');
  await expect(details).toContainText('Capacity before the cap: 18 → 19');
  expect(await snapshot(page)).toEqual(copy(state));
});
