import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGame, command, validateSave } from '../src/game.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.evaluate(() => window.__asterion.getState());
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('conquest-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('conquest-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}

test('the actual cycle55 campaign identifies its remaining founding objective and preserves beacon navigation', async ({ page }) => {
  const state = JSON.parse(readFileSync(new URL('../docs/military-playtest/replay/actual-exports/cycle55.json', import.meta.url), 'utf8'));
  await load(page, state);
  await page.locator('[data-page="empire"]').click();
  const card = page.locator('.conquest-card');
  await expect(card.locator('.founding-world')).toHaveCount(4);
  await expect(card.locator('[data-conquest-faction="player"]')).toContainText('3 / 4');
  await expect(card.locator('[data-conquest-faction="player"]')).not.toContainText('confirmed');
  for (const name of ['Solace', 'Veyr Prime', 'Kharos', 'Lumen']) await expect(card).toContainText(name);
  const last = card.locator('[data-founding-world="s3"]');
  await expect(last).toContainText('Choir');
  await expect(card.locator('.founding-complete')).toContainText('All four');
  expect(await snapshot(page)).toEqual(state);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/founding-worlds-cycle55.png' });
  await last.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#inspector h2')).toHaveText('Lumen');
  await expect(page.locator('.founding-inspector')).toContainText('permanent Domination objective');
  await expect(page.locator('.beacon-inspector')).toBeVisible();
  const label = page.locator('.galaxy-system-label[data-system-id="s3"]');
  await expect(label).toHaveClass(/is-founding/);
  await expect(label).toHaveClass(/is-beacon/);
  await expect(label).toHaveAttribute('aria-label', /founding world/);
  expect(await snapshot(page)).toEqual(state);
  await page.reload();
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('.founding-world')).toHaveCount(4);
  expect(await snapshot(page)).toEqual(state);
});

test('contact and chart hints reveal no founding targets or hidden control totals', async ({ browser }) => {
  const state = createGame('unidentified-founding-worlds');
  const player = state.factions[0], veyr = state.factions.find(f => f.id === 'veyr');
  player.contacts.push('veyr'); veyr.contacts.push('player');
  state.systems[1].knownBy.push('player');
  const variant = copy(state);
  variant.systems[1].name = 'Hidden founding name';
  variant.systems[1].owner = 'khar'; variant.systems[2].owner = 'veyr';
  variant.systems[2].x += 100;
  for (const fleet of variant.fleets.filter(f => f.owner !== 'player')) {
    fleet.name = 'Hidden overpowering fleet'; fleet.ships = 12;
    fleet.hp = 12 * (fleet.type === 'colony' ? 24 : fleet.type === 'scout' ? 18 : 34);
  }
  const rendered = [];
  for (const input of [state, variant]) {
    const context = await browser.newContext(), page = await context.newPage();
    await load(page, input);
    expect(await page.locator('.galaxy-system-label.is-founding').evaluateAll(nodes => nodes.map(n => n.dataset.systemId))).toEqual(['s0']);
    await page.locator('[data-page="empire"]').click();
    const card = page.locator('.conquest-card');
    await expect(card.locator('.founding-world')).toHaveCount(1);
    await expect(card.locator('.founding-unknown')).toContainText('3 founding worlds remain unidentified');
    await expect(card.locator('[data-conquest-faction="veyr"]')).toContainText('0 / 4 confirmed');
    await expect(card).not.toContainText('Khar');
    await expect(card).not.toContainText('Choir');
    await expect(card).not.toContainText('Hidden');
    rendered.push(await card.innerHTML());
    expect(await snapshot(page)).toEqual(copy(input));
    await context.close();
  }
  expect(rendered[1]).toBe(rendered[0]);
});

test('an ordinary founding-world capture updates control while the relocated frontier capital remains outside the ledger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = createGame('founding-capture-browser'), target = state.systems[1], refuge = state.systems[10];
  const attacker = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  Object.assign(refuge, { owner: 'veyr', population: 3 });
  for (const system of [target, refuge]) {
    system.knownBy = [...new Set([...system.knownBy, 'player', 'veyr'])];
    system.exploredBy = [...new Set([...system.exploredBy, 'player', 'veyr'])];
  }
  for (const fleet of state.fleets.filter(f => f.owner === 'veyr')) fleet.systemId = refuge.id;
  Object.assign(attacker, { systemId: target.id, ships: 12, hp: 408 });
  for (const [a, b] of [['player', 'veyr'], ['veyr', 'player']]) {
    const faction = state.factions.find(f => f.id === a); faction.contacts.push(b); faction.relations[b].status = 'war';
  }
  const expected = copy(state);
  await load(page, state);
  await page.locator('[data-page="empire"]').click();
  await page.locator('[data-founding-world="s1"]').click();
  await page.locator(`#inspector [data-fleet="${attacker.id}"]`).click();
  await page.locator('[data-action="attack"]').click();
  expect(command(expected, { type: 'attack', fleetId: attacker.id }).ok).toBe(true);
  expect(expected.systems[1].owner).toBe('player');
  expect(expected.factions.find(f => f.id === 'veyr').capitalId).toBe(refuge.id);
  expect(await snapshot(page)).toEqual(expected);
  await page.keyboard.press('Escape');
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('[data-conquest-faction="player"]')).toContainText('2 / 4');
  await expect(page.locator('[data-founding-world="s1"] .founding-sovereign')).toContainText('Concord');
  await expect(page.locator('[data-founding-world="s1"]')).toContainText('Founded by Veyr');
  await expect(page.locator('[data-founding-world="s10"]')).toHaveCount(0);
  await page.locator('.conquest-card').scrollIntoViewIfNeeded();
  expect(await page.locator('.conquest-card').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/founding-world-capture-narrow.png' });
  await page.reload();
  await page.locator('[data-page="empire"]').click();
  await expect(page.locator('[data-conquest-faction="player"]')).toContainText('2 / 4');
  expect(await snapshot(page)).toEqual(expected);
});

test('an owned or surveyed legacy world remains inspectable without a redundant chart flag', async ({ page }) => {
  const state = createGame('founding-legacy-chart');
  state.systems[1].exploredBy.push('player');
  state.systems[1].knownBy = state.systems[1].knownBy.filter(id => id !== 'player');
  await load(page, state);
  await page.locator('[data-page="empire"]').click();
  await page.locator('[data-founding-world="s1"]').click();
  await expect(page.locator('#inspector h2')).toHaveText('Veyr Prime');
  await expect(page.locator('.founding-inspector')).toContainText('Unidentified civilization');
  expect(await snapshot(page)).toEqual(copy(state));
});
