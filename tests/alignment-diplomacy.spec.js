import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { validateSave } from '../src/game.js';

// These archived0.22 states preserve the historical replay being inspected.
// Re-running its old fleet orders with a changed AI would create another history.
function recordedCycle(cycle) {
  const state = JSON.parse(fs.readFileSync(new URL(`../docs/stage29-design-and-russian/strategy/implementation/replay-derived-cycle${cycle}.json`, import.meta.url)));
  expect(validateSave(state)).toBe(true);
  return state;
}

test('the recorded friendly cycle53 exposes only a possible alignment incentive', async ({ page }) => {
  const state = recordedCycle(53);
  await page.addInitScript(saved => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved)), state);
  await page.goto('./');
  await page.locator('[data-page="diplomacy"]').click();
  const choir = page.locator('.rival-card[data-rival="choir"]');
  await expect(choir).toContainText('Trust 85');
  await expect(choir).toContainText('Their grievance 0');
  await expect(choir.locator('.alignment-competition')).toContainText('even with high trust or low grievances');
  await expect(choir.locator('.alignment-competition')).toContainText('does not establish their ability or intent to attack');
  await expect(choir.locator('.alignment-competition')).not.toContainText(/Halcyon|Vanguard|jumps|cycles remaining/);
});

test('new declarations retain their public cause after reload without relabeling legacy wars', async ({ page }) => {
  const state = recordedCycle(55);
  await page.addInitScript(saved => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved)), state);
  await page.goto('./');
  await page.locator('[data-page="diplomacy"]').click();
  const choir = page.locator('.rival-card[data-rival="choir"]');
  await expect(choir.locator('.alignment-war-cause')).toContainText('This war began over public Asterion alignment');
  await expect(choir.locator('.alignment-competition')).toHaveCount(0);
  await page.reload();
  await page.locator('[data-page="diplomacy"]').click();
  await expect(choir.locator('.alignment-war-cause')).toContainText('Victory competition can outweigh trust');
  await page.locator('[data-page="journal"]').click();
  await expect(page.locator('.log-item').filter({ hasText: 'The Luminous Choir declared war' })).toContainText('Competition over public Asterion alignment prompted this declaration.');

  const legacy = JSON.parse(fs.readFileSync(new URL('../docs/default-campaign/actual/092-asterion-reach-cycle-55.json', import.meta.url)));
  await page.evaluate(saved => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved)), legacy);
  // A fresh Page has no setup script and reads the historical save just stored.
  await page.goto('about:blank');
  const context = page.context();
  const legacyPage = await context.newPage();
  // The setup script belongs to the original Page, not this fresh Page.
  await legacyPage.goto('./');
  await legacyPage.locator('[data-page="diplomacy"]').click();
  await expect(legacyPage.locator('.alignment-war-cause')).toHaveCount(0);
  await expect(legacyPage.locator('.rival-card[data-rival="choir"]')).toContainText('Their grievance 0');
});
