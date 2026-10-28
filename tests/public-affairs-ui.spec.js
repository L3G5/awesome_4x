import { test, expect } from '@playwright/test';
import { createGame, command, validateSave, hasSensors, getNeighbors } from '../src/game.js';
import { SHIPS } from '../src/content.js';
import { getPublicDispatches } from '../src/public-affairs.js';

function contact(state, firstId, secondId) {
  for (const [a, b] of [[firstId, secondId], [secondId, firstId]]) {
    const faction = state.factions.find(f => f.id === a);
    if (!faction.contacts.includes(b)) faction.contacts.push(b);
  }
}

function corridorFixture() {
  const state = createGame('public-affairs-browser');
  const path = ['s0', 's4', 's5'];
  state.lanes = [['s0', 's4'], ['s4', 's5']];
  for (const system of state.systems) {
    system.knownBy = system.knownBy.filter(id => id !== 'player');
    system.exploredBy = system.exploredBy.filter(id => id !== 'player');
  }
  path.forEach((id, index) => {
    const system = state.systems.find(s => s.id === id);
    system.knownBy.push('player'); system.anomaly = null;
    system.x = index * 280; system.y = 0;
  });
  state.systems[0].exploredBy.push('player');
  const passage = state.systems.find(s => s.id === 's4');
  passage.owner = 'veyr'; passage.population = 3; passage.buildings = [];
  const player = state.factions.find(f => f.id === 'player');
  player.orders = 18; player.credits = 500;
  contact(state, 'player', 'veyr'); contact(state, 'player', 'khar'); contact(state, 'veyr', 'khar');
  expect(command(state, { type: 'diplomacy', targetId: 'veyr', stance: 'trade' }).ok).toBe(true);
  const scout = state.fleets.find(f => f.owner === 'player' && f.type === 'scout');
  expect(command(state, { type: 'planRoute', fleetId: scout.id, destinationId: 's5' }).ok).toBe(true);
  const attacker = state.fleets.find(f => f.owner === 'khar' && f.type === 'frigate');
  attacker.systemId = passage.id; attacker.ships = 8; attacker.hp = SHIPS.frigate.hp * 8;
  attacker.name = 'Unobserved invasion task force';
  expect(command(state, { type: 'diplomacy', factionId: 'khar', targetId: 'veyr', stance: 'war' }).ok).toBe(true);
  expect(command(state, { type: 'attack', factionId: 'khar', fleetId: attacker.id }).ok).toBe(true);
  expect(passage.owner).toBe('khar');
  expect(hasSensors(state, 'player', passage.id)).toBe(false);
  expect(validateSave(state)).toBe(true);
  return { state, scout, passage, attacker };
}

async function load(page, state) {
  await page.addInitScript(saved => {
    if (!localStorage.getItem('affairs-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('affairs-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}

test('a public capture explains a closed course and diplomacy restores deliberate passage', async ({ page }) => {
  const { state, scout, passage, attacker } = corridorFixture();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state);
  await expect(page.locator('.route-public-cause')).toContainText(`took ${passage.name}`);
  await expect(page.locator('[data-action="continue-route"]')).toBeDisabled();
  await expect(page.locator(`[data-fleet-id="${attacker.id}"]`)).toHaveCount(0);
  await page.locator('[data-page="diplomacy"]').click();
  const war = page.locator('.foreign-relation[data-status="war"]');
  await expect(war).toContainText('Khar'); await expect(war).toContainText('Veyr');
  await expect(page.locator('[data-rival="khar"]')).toContainText('RELATIONS WITH THE CONCORD');
  await expect(page.locator('[data-rival="khar"] .relation-tag')).toHaveText('peace');
  const capture = page.locator('.public-dispatch').filter({ hasText: passage.name });
  await expect(capture).not.toContainText(attacker.name);
  await page.screenshot({ path: 'test-results/public-affairs.png' });
  await page.locator('.public-dispatches summary').click();
  await capture.locator('[data-action="report-inspect"]').click();
  await expect(page.locator('#inspector .sovereignty-note')).toContainText('Khar Dominion');
  await expect(page.locator('#inspector')).not.toContainText(attacker.name);
  await page.locator('.route-public-cause [data-action="report-diplomacy"]').click();
  await page.locator('[data-rival="khar"] [data-stance="gift"]').click();
  await page.locator('[data-rival="khar"] [data-stance="trade"]').click();
  await page.locator('[data-page="galaxy"]').click();
  await expect(page.locator('.route-public-cause')).toHaveCount(0);
  await expect(page.locator('[data-action="continue-route"]')).toBeEnabled();
  const before = await page.evaluate(() => window.__asterion.getState());
  await page.locator('[data-action="continue-route"]').click();
  const after = await page.evaluate(() => window.__asterion.getState());
  expect(after.fleets.find(f => f.id === scout.id).systemId).toBe('s5');
  expect(after.factions[0].orders).toBe(before.factions[0].orders - 2);
  await page.reload();
  await page.locator('[data-page="journal"]').click();
  await page.locator('[data-log-filter="sovereignty"]').click();
  await expect(page.locator('.log-item')).toContainText(passage.name);
  await expect(page.locator('.log-item [data-action="report-inspect"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('anonymous announcements stay anonymous after importing a later-contact save', async ({ page }) => {
  const state = createGame('anonymous-public-affairs');
  contact(state, 'player', 'veyr'); contact(state, 'veyr', 'khar');
  expect(command(state, { type: 'diplomacy', factionId: 'veyr', targetId: 'khar', stance: 'war' }).ok).toBe(true);
  const received = getPublicDispatches(state);
  expect(received).toHaveLength(1);
  expect(received[0].text).not.toContain('Khar');
  await load(page, state);
  await page.locator('[data-page="diplomacy"]').click();
  await expect(page.locator('.foreign-affairs')).toContainText('Uncontacted');
  await expect(page.locator('.foreign-affairs')).not.toContainText('Khar');
  await page.locator('.public-dispatches summary').click();
  const later = structuredClone(state);
  contact(later, 'player', 'khar');
  await page.locator('#import-save').setInputFiles({ name: 'later-contact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(later)) });
  await page.locator('#confirm-import').click();
  await page.locator('[data-page="diplomacy"]').click();
  await expect(page.locator('.foreign-relation[data-status="war"]')).toContainText('Khar');
  await expect(page.locator('.public-dispatch')).toContainText('Uncontacted');
  await expect(page.locator('.public-dispatch')).not.toContainText('Khar');
  await page.reload();
  await page.locator('[data-page="diplomacy"]').click();
  await expect(page.locator('.public-dispatch')).toBeVisible();
  await expect(page.locator('.public-dispatch')).toContainText(received[0].text);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a rival declaration opens the new-cycle public briefing and survives reload', async ({ page }) => {
  const state = createGame('public-cycle-briefing');
  state.turn = 30;
  contact(state, 'player', 'khar'); contact(state, 'player', 'veyr'); contact(state, 'khar', 'veyr');
  const border = state.systems.find(s => s.id === getNeighbors(state, 's2')[0]);
  Object.assign(border, { owner: 'veyr', population: 1, buildings: [], queue: null });
  if (!border.knownBy.includes('khar')) border.knownBy.push('khar');
  state.factions.find(f => f.id === 'khar').relations.veyr.grievance = 30;
  const fleet = state.fleets.find(f => f.owner === 'khar' && f.type === 'frigate');
  fleet.ships = 4; fleet.hp = SHIPS.frigate.hp * 4;
  expect(validateSave(state)).toBe(true);
  await load(page, state);
  await page.locator('[data-action="end-turn"]').click();
  await expect(page.locator('.modal')).toContainText('Cycle 31');
  const declaration = page.locator('.briefing-entry').filter({ hasText: 'Khar Dominion declared war on Veyr Consortium' });
  await expect(declaration).toBeVisible();
  await declaration.locator('[data-action="report-diplomacy"]').click();
  await expect(page.locator('.foreign-relation[data-status="war"]')).toContainText('Veyr');
  const saved = await page.evaluate(() => window.__asterion.getState());
  const entry = saved.lastBriefing.entries.find(e => e.publicAffairId && e.type === 'war');
  expect(entry.turn).toBe(30);
  await page.reload();
  const restored = await page.evaluate(() => window.__asterion.getState());
  expect(restored.lastBriefing).toEqual(saved.lastBriefing);
});
