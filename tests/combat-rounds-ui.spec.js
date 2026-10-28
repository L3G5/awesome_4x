import { test, expect } from '@playwright/test';
import { createGame, command, validateSave } from '../src/game.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.evaluate(() => window.__asterion.getState());
const display = value => value > 0 && Math.round(value * 10) === 0 ? '<0.1' : Number.isInteger(value) ? String(value) : value.toFixed(1);
function war(state, opponent) {
  for (const [a, b] of [['player', opponent], [opponent, 'player']]) {
    const faction = state.factions.find(f => f.id === a);
    faction.contacts.push(b);
    Object.assign(faction.relations[b], { status: 'war', trade: false, treatyTurn: state.turn });
  }
}
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(input => {
    if (!localStorage.getItem('rounds-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input));
      localStorage.setItem('rounds-fixture', 'true');
    }
  }, state);
  await page.goto('./');
}
async function reopen(page, id) {
  await page.locator('[data-page="journal"]').click();
  await page.locator(`[data-action="combat-report"][data-report="${id}"]`).click();
}

test('actual four-round exchanges are keyboard-readable and preserve a sequential attack and reload exactly', async ({ page }) => {
  const state = createGame('formation-sequence');
  const attacker = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  const defender = state.fleets.find(f => f.owner === 'veyr' && f.type === 'frigate');
  const ark = state.fleets.find(f => f.owner === 'veyr' && f.type === 'colony');
  war(state, 'veyr');
  for (const faction of state.factions.filter(f => ['player', 'veyr'].includes(f.id))) faction.techs.push('shields');
  for (const fleet of [attacker, defender]) Object.assign(fleet, { ships: 4, hp: 136 });
  defender.systemId = ark.systemId = attacker.systemId;
  state.fleets = [...state.fleets.filter(f => ![defender.id, ark.id].includes(f.id)), defender, ark];
  const expected = copy(state);
  await load(page, state);
  await page.locator(`#inspector [data-fleet="${attacker.id}"]`).click();
  await page.locator('[data-action="attack"]').click();
  const answer = command(expected, { type: 'attack', fleetId: attacker.id });
  expect(answer.ok).toBe(true);
  expect(answer.combatReports).toHaveLength(2);
  const first = answer.combatReports[0];
  expect(first.rounds).toHaveLength(4);
  expect(first.outcome).toBe('contested');
  expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('#modal-title')).toBeInViewport();
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  const report = page.locator('.combat-report').first(), details = report.locator('.combat-exchanges');
  expect(await details.evaluate(el => el.open)).toBe(false);
  await page.keyboard.press('Tab');
  await expect(details.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await details.evaluate(el => el.open)).toBe(true);
  await expect(details.locator('.combat-round')).toHaveCount(4);
  await expect(details.locator('.exchange-ending')).toContainText('Four-round limit reached');
  for (const round of first.rounds) for (const role of ['attacker', 'defender']) {
    const row = details.locator(`[data-round="${round.number}"] [data-role="${role}"]`), side = round[role];
    await expect(row).toContainText(`Volley fired${display(side.rawHit)}`);
    await expect(row).toContainText(`Ships${side.shipsBefore} → ${side.shipsAfter}`);
    await expect(row).toContainText(`Hull${display(side.hullBefore)} → ${display(side.hullAfter)}`);
    await expect(row).toContainText('Shields reduce incoming fire by 20%');
  }
  await page.keyboard.press('Space');
  expect(await details.evaluate(el => el.open)).toBe(false);
  expect(await snapshot(page)).toEqual(expected);
  await page.keyboard.press('Escape');
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);
  await reopen(page, first.id);
  await page.locator('.combat-exchanges summary').click();
  await expect(page.locator('.combat-round')).toHaveCount(4);
  expect(await snapshot(page)).toEqual(expected);
});

test('narrow historical rounds retain battle-time weapons, doctrine and names after later changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = createGame('recorded-round-modifiers');
  const attacker = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  const defender = state.fleets.find(f => f.owner === 'khar' && f.type === 'frigate');
  war(state, 'khar');
  Object.assign(attacker, { ships: 3, hp: 102 });
  Object.assign(defender, { systemId: attacker.systemId, ships: 2, hp: 68 });
  for (const faction of state.factions.filter(f => ['player', 'khar'].includes(f.id))) faction.techs.push('weapons', 'shields');
  const result = command(state, { type: 'attack', fleetId: attacker.id });
  expect(result.ok).toBe(true);
  const historical = copy(result.combatReports[0]);
  for (const faction of state.factions) faction.techs = [];
  for (const fleet of state.fleets) if ([attacker.id, defender.id].includes(fleet.id)) {
    fleet.name = 'Renamed after the battle';
    fleet.hp = fleet.ships * 34;
  }
  await load(page, state);
  await reopen(page, historical.id);
  await expect(page.locator('#modal-title')).toBeInViewport();
  await page.locator('.combat-exchanges summary').click();
  const first = page.locator('.combat-round').first();
  await expect(first).toContainText(historical.participants[0].name);
  await expect(first).toContainText(historical.participants[1].name);
  await expect(first).not.toContainText('Renamed after the battle');
  await expect(first.locator('[data-role="attacker"]')).toContainText('Weapons ×1.25');
  await expect(first.locator('[data-role="defender"]')).toContainText('Khar doctrine ×1.15');
  await expect(first.locator('[data-role="defender"]')).toContainText('Shields reduce incoming fire by 20%');
  expect(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await snapshot(page)).toEqual(copy(state));
  const before = await page.locator('.combat-exchanges').innerText();
  await page.screenshot({ path: 'test-results/combat-rounds-narrow.png' });
  await page.reload();
  await reopen(page, historical.id);
  await page.locator('.combat-exchanges summary').click();
  expect(await page.locator('.combat-exchanges').innerText()).toBe(before);
  expect((await snapshot(page)).combatReports[0]).toEqual(historical);
});

test('older outcome-only reports remain readable without invented rounds', async ({ page }) => {
  const state = createGame('legacy-roundless-report');
  const attacker = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
  const defender = state.fleets.find(f => f.owner === 'veyr' && f.type === 'colony');
  war(state, 'veyr'); defender.systemId = attacker.systemId;
  expect(command(state, { type: 'attack', fleetId: attacker.id }).ok).toBe(true);
  const legacy = copy(state);
  for (const report of legacy.combatReports) delete report.rounds;
  await load(page, legacy);
  await reopen(page, legacy.combatReports[0].id);
  await expect(page.locator('.combat-summary')).toHaveText(legacy.combatReports[0].summary);
  await expect(page.locator('.combat-exchanges')).toHaveCount(0);
  await expect(page.locator('.exchange-unavailable')).toHaveText('Round detail was not recorded for this engagement.');
  expect(await snapshot(page)).toEqual(legacy);
});
