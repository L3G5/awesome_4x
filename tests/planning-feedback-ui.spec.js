import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGame, command, endTurn, estimateInvasion, getSystemYield, validateSave } from '../src/game.js';
import { getAlignmentStatus } from '../src/victory.js';

const copy = value => JSON.parse(JSON.stringify(value));
const player = state => state.factions.find(faction => faction.id === 'player');
const snapshot = page => page.evaluate(() => window.__asterion.getState());
const watch = turn => JSON.parse(readFileSync(new URL(`../docs/watch-playtest/checkpoints/cycle${turn}.json`, import.meta.url)));
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('planning-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('planning-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}
async function empire(page) { await page.locator('[data-page="empire"]').click(); }
function network(credits = 100, upkeep = false) {
  const state = createGame('PLANNING-FEEDBACK-NETWORK');
  Object.assign(player(state), { credits, techs: ['logistics', 'industry', 'physics', 'computing', 'singularity'], research: null });
  const sites = ['s0', 's4', 's5'];
  for (const id of sites) Object.assign(state.systems.find(world => world.id === id), { owner: 'player', population: 4, growth: 0, buildings: ['beacon'], queue: null, knownBy: ['player'], exploredBy: ['player'], anomaly: null });
  player(state).alignment = { progress: 1, active: true, started: true, sites, reportedBeacons: [...sites] };
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'player');
  for (const faction of state.factions.filter(faction => faction.id !== 'player')) faction.eliminated = true;
  if (upkeep) state.fleets.push({ id: `f${state.nextFleetId++}`, owner: 'player', systemId: 's0', type: 'cruiser', ships: 12, hp: 1020, movesLeft: 1, name: 'Synthetic upkeep formation' });
  return state;
}

test('after-income funding explains the WATCH50-credit diagnostic and matches an ordinary cycle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = watch(51); player(state).credits = 50;
  expect(getAlignmentStatus(state).ready).toBe(false);
  const expected = copy(state); expect(endTurn(expected).ok).toBe(true);
  expect(player(expected).credits).toBe(65); expect(player(expected).alignment.progress).toBe(2);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state);
  await expect(page.locator('.resource.credits')).toHaveAttribute('title', /before alignment payments/);
  await expect(page.locator('.credit-income-scope')).toBeVisible();
  await expect(page.locator('#mandate')).toContainText('Funding is covered after current income');
  await page.locator('#mandate [data-action="review-alignment"]').click();
  for (const [key, value] of Object.entries({ treasury: '50', income: '+75', 'after-income': '125', cost: '60' })) await expect(page.locator(`[data-budget="${key}"]`)).toHaveText(value);
  await expect(page.locator('.alignment-budget-result')).toHaveText('65 credits would remain if alignment advances.');
  await expect(page.locator('.alignment-outlook h4')).toBeInViewport();
  await expect(page.locator('.alignment-budget-result')).toBeInViewport();
  await page.locator('#inspector [data-action="review-alignment"]').click();
  await expect(page.locator('.alignment-outlook h4')).toBeInViewport();
  await expect(page.locator('.alignment-budget-assumption')).toContainText('treaty changes');
  await expect(page.locator('#inspector')).toContainText('Funding is covered after current income');
  await expect(page.locator('.alignment-status')).not.toContainText('requires 60 credits after ordinary income');
  expect(await snapshot(page)).toEqual(copy(state));
  await page.locator('.alignment-outlook').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/planning-funded.png' });
  await page.locator('[data-action="end-turn"]').click();
  await expect.poll(() => snapshot(page)).toEqual(expected);
  expect(errors).toEqual([]);
});

test('a current treasury above sixty still shows its after-upkeep deficit at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = network(70, true), expected = copy(state);
  expect(getAlignmentStatus(state).ready).toBe(true); expect(endTurn(expected).ok).toBe(true);
  expect(player(expected).credits).toBe(55); expect(player(expected).alignment.progress).toBe(0);
  await load(page, state); await empire(page);
  await expect(page.locator('[data-budget="income"]')).toHaveText('−15');
  await expect(page.locator('[data-budget="after-income"]')).toHaveText('55');
  await expect(page.locator('.alignment-budget-result')).toHaveText('Short 5 credits after current income.');
  await expect(page.locator('#inspector')).toContainText('Short 5 credits after current income.');
  await page.locator('.alignment-outlook').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/planning-deficit-narrow.png' });
  expect(await snapshot(page)).toEqual(copy(state));
  await page.locator('[data-action="end-turn"]').click();
  await expect.poll(() => snapshot(page)).toEqual(expected);
});

for (const kind of ['blockade', 'missing Protocol', 'missing site']) test(`covered funding does not imply a payment with ${kind}`, async ({ page }) => {
  const state = network(); let reason;
  if (kind === 'blockade') {
    const rival = state.factions.find(faction => faction.id === 'veyr');
    player(state).relations.veyr.status = rival.relations.player.status = 'war';
    Object.assign(state.fleets.find(fleet => fleet.owner === 'veyr'), { systemId: 's0', type: 'frigate', ships: 1, hp: 34 });
    reason = 'Hostile warships block alignment at Solace';
  } else if (kind === 'missing Protocol') { player(state).techs = player(state).techs.filter(id => id !== 'singularity'); reason = 'Research the Asterion Protocol'; }
  else { state.systems.find(world => world.id === 's5').buildings = []; reason = 'Complete Asterion Beacons on three owned worlds (2/3)'; }
  await load(page, state); await empire(page);
  await expect(page.locator('.alignment-outlook')).toHaveAttribute('data-funding-covered', 'true');
  await expect(page.locator('.alignment-outlook')).toHaveAttribute('data-network-ready', 'false');
  await expect(page.locator('.alignment-status')).toContainText(reason);
  await expect(page.locator('.alignment-budget-result')).toContainText('Funding is covered.');
  await expect(page.locator('.alignment-budget-result')).toContainText(reason);
  await expect(page.locator('.alignment-budget-result')).not.toContainText('would remain');
  expect(await snapshot(page)).toEqual(copy(state));
});

for (const legacy of [false, true]) test(`a ${legacy ? 'legacy' : 'modern'} finished network has no future funding estimate`, async ({ page }) => {
  const state = watch(60);
  if (legacy) { for (const faction of state.factions) delete faction.alignment; delete state.alignmentUpdatedTurn; }
  await load(page, state); await empire(page);
  await expect(page.locator('.alignment-outlook')).toHaveCount(0);
  await expect(page.locator('.credit-income-scope')).toHaveCount(0);
  await expect(page.locator('#inspector')).toContainText('This age has ended.');
  await expect(page.locator('#inspector')).not.toContainText('credits per advancing cycle');
  if (legacy) await expect(page.locator('#inspector')).toContainText('— / 10 alignment');
  expect(await snapshot(page)).toEqual(copy(state));
});

test('private rival economic changes cannot alter the player funding card', async ({ page }) => {
  const state = watch(51); player(state).credits = 50;
  await load(page, state); await empire(page);
  const before = await page.locator('.alignment-card').innerHTML();
  const changed = copy(state);
  for (const faction of changed.factions.filter(faction => faction.id !== 'player')) { faction.credits += 100000; faction.minerals += 100000; faction.science += 100000; }
  expect(validateSave(changed)).toBe(true);
  await page.evaluate(input => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input)), changed);
  await page.reload(); await empire(page);
  expect(await page.locator('.alignment-card').innerHTML()).toBe(before);
  expect(await snapshot(page)).toEqual(changed);
});

function invasion(hp = 3, defense = 8) {
  const state = createGame('LETHAL-INVASION-REVIEW'); state.turn = 2;
  const own = player(state), rival = state.factions.find(faction => faction.id === 'veyr');
  own.contacts.push('veyr'); rival.contacts.push('player'); own.relations.veyr.status = rival.relations.player.status = 'war';
  const target = state.systems.find(world => world.id === 's1');
  target.defenseDamage = getSystemYield(state, target).defense - defense; target.knownBy.push('player'); target.exploredBy.push('player');
  state.fleets = state.fleets.filter(fleet => fleet.owner !== 'veyr');
  const fleet = state.fleets.find(fleet => fleet.owner === 'player' && fleet.type === 'frigate'); fleet.systemId = 's1'; fleet.hp = hp;
  return { state, fleet };
}
for (const hp of [3, 4.04]) test(`lethal retaliation at ${hp} hull is explicit and a voluntary ordinary attack remains possible`, async ({ page }) => {
  const { state, fleet } = invasion(hp), expected = copy(state);
  expect(estimateInvasion(state, fleet.id).hullAfter).toBe(0);
  expect(command(expected, { type: 'attack', fleetId: fleet.id }).ok).toBe(true);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, state); await page.locator(`#fleet-bar [data-fleet="${fleet.id}"]`).click();
  await expect(page.locator('.invasion-survival.lethal')).toHaveText('Retaliation will destroy this formation; it cannot capture the colony.');
  await expect(page.locator('.invasion-preview')).toContainText('Hull after retaliation: 0');
  await expect(page.locator('.invasion-preview')).not.toContainText('Further bombardment');
  expect(await snapshot(page)).toEqual(copy(state));
  await expect(page.locator('#fleet-bar [data-action="attack"]')).toBeEnabled();
  await page.locator('.invasion-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/planning-lethal-${hp}.png` });
  await page.locator('#fleet-bar [data-action="attack"]').click();
  await expect(page.locator('.combat-report')).toContainText('Invading fleet destroyed');
  expect(await snapshot(page)).toEqual(expected); expect(errors).toEqual([]);
});
for (const [defense, text] of [[20, 'Further bombardment is required.'], [8, 'Capture expected with this volley.']]) test(`a surviving invasion with ${defense} defenses keeps the appropriate outcome and projected hull`, async ({ page }) => {
  const { state, fleet } = invasion(34, defense), forecast = estimateInvasion(state, fleet.id), expected = copy(state);
  expect(forecast.hullAfter).toBeGreaterThan(0); expect(command(expected, { type: 'attack', fleetId: fleet.id }).ok).toBe(true);
  await load(page, state); await page.locator(`#fleet-bar [data-fleet="${fleet.id}"]`).click();
  await expect(page.locator('.invasion-survival')).toHaveText(text);
  await expect(page.locator('.invasion-survival.lethal')).toHaveCount(0);
  await expect(page.locator('.invasion-preview')).toContainText(`Hull after retaliation: ${forecast.hullAfter}`);
  expect(await snapshot(page)).toEqual(copy(state));
  await page.locator('#fleet-bar [data-action="attack"]').click();
  expect(await snapshot(page)).toEqual(expected);
});
