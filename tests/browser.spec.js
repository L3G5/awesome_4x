import { test, expect } from '@playwright/test';

const readState = page => page.evaluate(() => window.__asterion.getState());
async function begin(page) {
  await page.goto('./');
  await page.locator('[data-action="begin"]').click();
  await expect(page.locator('#galaxy canvas')).toBeVisible();
}
async function endCycle(page) {
  await page.locator('[data-action="end-turn"]').click();
  if (await page.locator('[data-action="end-turn-confirm"]').isVisible()) await page.locator('[data-action="end-turn-confirm"]').click();
  // This opening leaves new trade proposals undecided while developing colonies.
  if (await page.locator('[data-action="trade-response"]').count()) await page.keyboard.press('Escape');
}

test('a real opening campaign surveys, settles, builds, researches, saves, and advances rival empires', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await begin(page);
  const map = await page.locator('#galaxy').boundingBox();
  expect(map.height).toBeGreaterThan(400);
  await page.locator('[data-action="build-menu"]').click();
  await page.locator('[data-action="build"][data-item="lab"]').click();
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="logistics"]').click();
  await page.locator('[data-page="galaxy"]').click();
  let state = await readState(page);
  const home = state.systems.find(s => s.owner === 'player');
  const neighborIds = state.lanes.flatMap(([a,b]) => a === home.id ? [b] : b === home.id ? [a] : []);
  const candidate = state.systems.find(s => neighborIds.includes(s.id) && !s.owner && s.habitability >= 50);
  await page.locator(`[data-system-select="${candidate.id}"]`).click();
  await page.locator('[data-action="move"]').click();
  state = await readState(page);
  expect(state.systems.find(s => s.id === candidate.id).exploredBy).toContain('player');
  await page.locator('[data-action="home"]').click();
  const ark = state.fleets.find(f => f.owner === 'player' && f.type === 'colony');
  await page.locator(`#inspector [data-fleet="${ark.id}"]`).click();
  await page.locator(`[data-system-select="${candidate.id}"]`).click();
  await page.locator('[data-action="move"]').click();
  await page.locator('[data-action="colonize"]').click();
  await page.locator('[data-action="colonize-confirm"]').click();
  state = await readState(page);
  expect(state.systems.filter(s => s.owner === 'player')).toHaveLength(2);
  expect(state.fleets.some(f => f.id === ark.id)).toBe(false);
  await page.reload();
  expect((await readState(page)).systems.filter(s => s.owner === 'player')).toHaveLength(2);
  for (let i = 0; i < 12; i++) await endCycle(page);
  state = await readState(page);
  expect(state.turn).toBe(13);
  expect(state.systems.find(s => s.id === home.id).buildings).toContain('lab');
  expect(state.factions.find(f => f.id === 'player').techs).toContain('logistics');
  expect(state.systems.filter(s => s.owner && s.owner !== 'player').length).toBeGreaterThan(3);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/opening-campaign.png' });
});

test('command views, guide, save export and mobile layout remain usable', async ({ page }) => {
  await begin(page);
  for (const view of ['research','diplomacy','empire','journal']) {
    await page.locator(`[data-page="${view}"]`).click();
    await expect(page.locator('#workspace-page h2')).toBeVisible();
  }
  await page.locator('[data-action="menu"]').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  expect((await downloadEvent).suggestedFilename()).toContain('asterion-reach-cycle-1.json');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-page="galaxy"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#galaxy')).toBeVisible();
  await page.locator('[data-action="end-turn"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-action="end-turn"]')).toBeVisible();
  await page.goto('./guide.html');
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.locator('a[href^="#"]').count()).toBeGreaterThan(5);
});
