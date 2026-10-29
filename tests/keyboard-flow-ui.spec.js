import { test, expect } from '@playwright/test';
import { createGame } from '../src/game.js';

const snapshot = page => page.evaluate(() => window.__asterion.getState());
async function load(page) {
  const state = createGame('ASTERION');
  await page.addInitScript(input => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(input)), state);
  await page.goto('./');
  return state;
}
async function tabTo(page, target) {
  for (let i = 0; i < 30; i++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

for (const width of [1280, 390]) test(`construction categories retain keyboard focus and preserve the campaign at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await load(page);
  const opener = page.locator('[data-action="build-menu"]');
  await opener.click();
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  const tab = kind => page.locator(`.modal [data-action="construction-tab"][data-tab="${kind}"]`);
  await tabTo(page, tab('ship'));
  await expect(tab('ship')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tab('ship')).toBeFocused();
  await expect(tab('ship')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('.modal [data-action="build"][data-item="scout"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(tab('charter')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(tab('charter')).toBeFocused();
  await expect(tab('charter')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.charter-intro')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tab('ship')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(tab('building')).toBeFocused();
  await expect(tab('building')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#replace-building')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tab('charter')).toBeFocused();
  expect(await snapshot(page)).toEqual(state);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await snapshot(page)).toEqual(state);
});

for (const width of [1280, 390]) test(`research and Chronicle filters retain keyboard position at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await load(page);
  await page.locator('[data-page="research"]').click();
  const engineering = page.locator('[data-research-filter="Engineering"]');
  await tabTo(page, engineering);
  await page.keyboard.press('Enter');
  await expect(engineering).toBeFocused();
  await expect(engineering).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  const society = page.locator('[data-research-filter="Society"]');
  await expect(society).toBeFocused();
  await page.keyboard.press('Space');
  await expect(society).toBeFocused();
  await expect(society).toHaveAttribute('aria-pressed', 'true');
  await expect(engineering).toHaveAttribute('aria-pressed', 'false');
  const categories = await page.locator('.tech-top > span:first-child').allTextContents();
  expect(categories.length).toBeGreaterThan(0);
  expect(categories.every(category => category === 'Society')).toBe(true);
  await page.locator('[data-page="journal"]').click();
  const discovery = page.locator('[data-log-filter="discovery"]');
  await tabTo(page, discovery);
  await page.keyboard.press('Space');
  await expect(discovery).toBeFocused();
  await expect(discovery).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  const construction = page.locator('[data-log-filter="construction"]');
  await expect(construction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(construction).toBeFocused();
  await expect(construction).toHaveAttribute('aria-pressed', 'true');
  await expect(discovery).toHaveAttribute('aria-pressed', 'false');
  expect(await snapshot(page)).toEqual(state);
});
