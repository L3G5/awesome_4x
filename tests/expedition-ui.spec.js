import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('a rival challenging the Concord alignment opens a war briefing and its expedition survives reload', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('../docs/intervention-audit/results/verified-cycle60-before-ai.json', import.meta.url)));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(state => {
    if (!localStorage.getItem('expedition-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(state));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('expedition-fixture', 'true');
    }
  }, fixture);
  await page.goto('./');
  await page.locator('[data-action="end-turn"]').click();
  const declaration = page.locator('.briefing-entry').filter({ hasText: 'Veyr Consortium declared war on The Concord' });
  await expect(declaration).toBeVisible();
  await expect(declaration).toContainText('trade treaty was broken');
  await declaration.locator('[data-action="report-diplomacy"]').click();
  await expect(page.locator('[data-rival="veyr"] .relation-tag')).toHaveText('war');
  const before = await page.evaluate(() => window.__asterion.getState());
  expect(before.factions.find(faction => faction.id === 'veyr').strategy.expedition).toBeTruthy();
  await page.reload();
  expect(await page.evaluate(() => window.__asterion.getState())).toEqual(before);
  await page.locator('#briefing-button').click();
  await expect(declaration).toBeVisible();
  expect(errors).toEqual([]);
});
