import { test, expect } from '@playwright/test';
import { createGame, command, endTurn, getNeighbors } from '../src/game.js';
import { TurnHistory, applyTurnCommand } from '../src/turn-history.js';

const SAVE = 'asterion-reach-save-v1', HISTORY = 'asterion-reach-undo-v1';
const read = page => page.evaluate(() => window.__asterion.getState());
async function load(page, state, language = 'en') {
  await page.addInitScript(({ state, language, SAVE }) => {
    if (localStorage.getItem('undo-fixture-loaded')) return;
    localStorage.setItem(SAVE, JSON.stringify(state));
    localStorage.setItem('asterion-reach-language-v1', language);
    localStorage.setItem('undo-fixture-loaded', 'true');
  }, { state, language, SAVE });
  await page.goto('./');
}

for (const corrupt of [false, true]) {
  test(`a ${corrupt ? 'malformed' : 'missing'} main save never attaches orphan undo to a new campaign`, async ({ page }) => {
    const history = new TurnHistory(() => true), original = createGame('ASTERION');
    let state = applyTurnCommand(original, { type: 'hold', fleetId: 'f1' }, history).state;
    state = applyTurnCommand(state, { type: 'resume', fleetId: 'f1' }, history).state;
    expect(state).toEqual(original);
    await page.addInitScript(({ serialized, corrupt, SAVE, HISTORY }) => {
      localStorage.setItem(HISTORY, serialized);
      if (corrupt) localStorage.setItem(SAVE, '{broken');
      else localStorage.removeItem(SAVE);
    }, { serialized: history.serialize(state), corrupt, SAVE, HISTORY });
    await page.goto('./');
    await expect(page.locator('[data-action="begin"]')).toBeVisible();
    await expect(page.locator('#undo-action')).toBeDisabled();
    await expect(page.locator('.modal [data-action="undo"]')).toHaveCount(0);
    expect(await read(page)).toEqual(original);
    await page.locator('[data-action="begin"]').click();
    expect(await page.evaluate(HISTORY => localStorage.getItem(HISTORY), HISTORY)).toBeNull();
  });
}

for (const width of [1440, 390]) for (const language of ['en', 'ru']) {
  test(`undo research and construction survives reload at ${width} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const original = createGame('ASTERION'), researched = structuredClone(original);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await load(page, original, language);
    const undo = page.locator('#undo-action');
    await expect(undo).toBeDisabled();
    await expect(undo).toHaveText(language === 'ru' ? '↶ Отменить' : '↶ Undo');
    await page.locator('[data-page="research"]').click();
    await page.locator('[data-action="research"][data-tech="physics"]').click();
    expect(command(researched, { type: 'research', techId: 'physics' }).ok).toBe(true);
    expect(await read(page)).toEqual(researched);
    await undo.click();
    expect(await read(page)).toEqual(original);
    expect(await page.evaluate(() => window.__asterion.getPage())).toBe('research');
    await expect(undo).toBeDisabled();
    await page.locator('[data-action="research"][data-tech="physics"]').click();
    await page.locator('[data-page="empire"]').click();
    await page.locator('[data-colony-row="s0"] [data-action="empire-build-menu"]').click();
    await page.locator('[data-action="build"][data-item="lab"]').click();
    const built = structuredClone(researched);
    expect(command(built, { type: 'build', systemId: 's0', itemId: 'lab' }).ok).toBe(true);
    expect(await read(page)).toEqual(built);
    await page.reload();
    expect(await read(page)).toEqual(built);
    await undo.click();
    expect(await read(page)).toEqual(researched);
    expect(await page.evaluate(() => window.__asterion.getPage())).toBe('empire');
    await expect(undo).toBeFocused();
    await page.keyboard.press('Control+z');
    expect(await read(page)).toEqual(original);
    expect(await page.evaluate(() => window.__asterion.getPage())).toBe('research');
    await expect(undo).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('undo restores a consumed colony ark and movement, then repeats exactly', async ({ page }) => {
  const original = createGame('ASTERION');
  const ark = original.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'colony');
  const target = original.systems.find(world => !world.owner && world.habitability >= 50 && getNeighbors(original, ark.systemId).includes(world.id));
  await load(page, original);
  await page.locator(`#inspector [data-fleet="${ark.id}"]`).click();
  await page.locator(`#inspector [data-system-select="${target.id}"]`).click();
  await page.locator('[data-action="move"]').click();
  const moved = await read(page);
  await page.locator('[data-action="colonize"]').click();
  await page.locator('[data-action="colonize-confirm"]').click();
  const settled = await read(page);
  expect(settled.fleets.some(fleet => fleet.id === ark.id)).toBe(false);
  await page.locator('#undo-action').click();
  expect(await read(page)).toEqual(moved);
  await expect(page.locator('[data-action="colonize"]')).toBeVisible();
  await page.locator('[data-action="colonize"]').click();
  await page.locator('[data-action="colonize-confirm"]').click();
  expect(await read(page)).toEqual(settled);
  await page.locator('#undo-action').click();
  await page.locator('#undo-action').click();
  expect(await read(page)).toEqual(original);
  await expect(page.locator('#undo-action')).toBeDisabled();
});

test('combat report offers undo and repeating combat retains the exact random result', async ({ page }) => {
  // Controlled encounter: ordinary combat command; no runtime mutation hook.
  const original = createGame('formation-sequence');
  const attacker = original.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate');
  const defender = original.fleets.find(fleet => fleet.owner === 'veyr' && fleet.type === 'frigate');
  for (const [a, b] of [['player', 'veyr'], ['veyr', 'player']]) {
    const faction = original.factions.find(faction => faction.id === a);
    faction.contacts.push(b);
    Object.assign(faction.relations[b], { status: 'war', trade: false, treatyTurn: original.turn });
  }
  defender.systemId = attacker.systemId;
  const expected = structuredClone(original);
  expect(command(expected, { type: 'attack', fleetId: attacker.id }).ok).toBe(true);
  await load(page, original);
  await page.locator(`#inspector [data-fleet="${attacker.id}"]`).click();
  await page.locator('[data-action="attack"]').click();
  await expect(page.locator('.combat-report')).toBeVisible();
  expect(await read(page)).toEqual(expected);
  await page.locator('.modal [data-action="undo"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await read(page)).toEqual(original);
  await page.locator('[data-action="attack"]').click();
  expect(await read(page)).toEqual(expected);
  await page.keyboard.press('Control+z');
  expect(await read(page)).toEqual(original);
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('mobile modal Undo returns focus to the visible restored workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = createGame('ASTERION');
  await load(page, original, 'ru');
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="physics"]').click();
  await page.locator('[data-action="menu"]').click();
  await page.locator('.modal [data-action="undo"]').click();
  expect(await read(page)).toEqual(original);
  await expect(page.locator('#workspace-page h2')).toBeFocused();
  await expect(page.locator('#workspace-page h2')).toBeInViewport();
});

test('only confirmed End cycle, import and new campaign discard action history', async ({ page }) => {
  const original = createGame('ASTERION');
  await load(page, original);
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="physics"]').click();
  const planned = await read(page);
  await page.locator('#end-turn').click();
  await page.locator('.modal [data-action="close-modal"]').first().click();
  await expect(page.locator('#undo-action')).toBeEnabled();
  expect(await read(page)).toEqual(planned);
  await page.locator('#end-turn').click();
  await page.locator('[data-action="end-turn-confirm"]').click();
  const next = structuredClone(planned); expect(endTurn(next).ok).toBe(true);
  expect(await read(page)).toEqual(next);
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await expect(page.locator('#undo-action')).toBeDisabled();
  expect(await page.evaluate(HISTORY => localStorage.getItem(HISTORY), HISTORY)).toBeNull();
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="logistics"]').click();
  const beforeImport = await read(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('#import-save').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await page.keyboard.press('Escape');
  expect(await read(page)).toEqual(beforeImport);
  await expect(page.locator('#undo-action')).toBeEnabled();
  await page.locator('#import-save').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await page.locator('#confirm-import').click();
  expect(await read(page)).toEqual(original);
  await expect(page.locator('#undo-action')).toBeDisabled();
  await page.locator('[data-page="research"]').click();
  await page.locator('[data-action="research"][data-tech="physics"]').click();
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new-game-menu"]').click();
  await page.locator('#galaxy-seed').fill('NEW-UNDO-CAMPAIGN');
  await page.locator('[data-action="new-game-confirm"]').click();
  await page.locator('[data-action="begin"]').click();
  expect((await read(page)).seed).toBe('NEW-UNDO-CAMPAIGN');
  await expect(page.locator('#undo-action')).toBeDisabled();
});
