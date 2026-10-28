import { test, expect } from '@playwright/test';
import { createGame } from '../src/game.js';

test('the command interface conceals remote fleets and charges for a blind interception', async ({ page }) => {
  const state = createGame('sensor-ui');
  const home = state.systems.find(s => s.owner === 'player');
  const neighborId = state.lanes.flatMap(([a,b]) => a === home.id ? [b] : b === home.id ? [a] : [])[0];
  const target = state.systems.find(s => s.id === neighborId);
  const enemy = state.fleets.find(f => f.owner === 'khar' && f.type === 'frigate');
  enemy.systemId = target.id;
  enemy.name = 'Hidden blockade';
  state.factions.find(f => f.id === 'player').relations.khar.status = 'war';
  state.factions.find(f => f.id === 'khar').relations.player.status = 'war';
  const scout = state.fleets.find(f => f.owner === 'player' && f.type === 'scout');
  await page.addInitScript(saved => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved)), state);
  await page.goto('./');
  await page.locator(`[data-system-select="${target.id}"]`).click();
  await expect(page.locator('#inspector')).not.toContainText('Hidden blockade');
  await expect(page.locator('#galaxy [data-fleet-id="' + enemy.id + '"]')).toHaveCount(0);
  await expect(page.locator('#fleet-bar')).toContainText('Fleet presence unknown');
  await expect(page.locator('[data-action="move"]')).toBeEnabled();
  await page.locator('[data-action="move"]').click();
  const after = await page.evaluate(() => window.__asterion.getState());
  expect(after.factions.find(f => f.id === 'player').orders).toBe(5);
  expect(after.fleets.find(f => f.id === scout.id).movesLeft).toBe(1);
  expect(after.fleets.find(f => f.id === scout.id).systemId).toBe(home.id);
  expect(after.systems.find(s => s.id === target.id).exploredBy).not.toContain('player');
  await expect(page.locator('#status-message')).toContainText(/intercept|withdr/i);
});
