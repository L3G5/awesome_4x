import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Unmodified export from the ordinary default campaign, on frozen94f41df.
// Asterion has a paid lab underway; inspecting its optional lane spends nothing.
const actual = JSON.parse(readFileSync(new URL('../docs/mechanics-depth/default-campaign/ui/actual-cycle13.json', import.meta.url)));

for (const width of [1440, 390]) for (const language of ['en', 'ru']) {
  test(`actual colony routes distinguish an unchanged capital connection at ${width} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(({ actual, language }) => {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(actual));
      localStorage.setItem('asterion-reach-language-v1', language);
    }, { actual, language });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('./'); await page.locator('[data-page="empire"]').click();
    await page.locator('[data-colony-row="s41"] [data-action="inspect"]').click();
    await page.locator('[data-action="starlane-menu"]').click();
    const routes = page.locator('.starlane-colony-routes');
    await expect(routes.locator('h4')).toHaveText(language === 'ru' ? 'Маршруты из системы Asterion' : 'Routes from Asterion');
    await expect(routes.locator('[data-route-colony="s0"]')).toContainText('Solace');
    await expect(routes.locator('[data-route-colony="s0"] .starlane-route-distance')).toContainText('3 → 3');
    await expect(routes.locator('[data-route-colony="s0"]')).toContainText(language === 'ru' ? 'Без изменений' : 'Unchanged');
    await expect(routes.locator('[data-route-colony="s34"]')).toContainText('Antares');
    await expect(routes.locator('[data-route-colony="s34"] .starlane-route-distance')).toHaveText('4 → 2');
    await expect(routes.locator('details')).toHaveCount(0);
    await expect(page.locator('[data-action="restore-lane"]')).toBeDisabled();
    expect(await page.evaluate(() => window.__asterion.getState())).toEqual(actual);
    await routes.scrollIntoViewIfNeeded();
    expect(await routes.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const toggle = page.locator('.modal [data-action="language"]');
    await toggle.click(); await toggle.click();
    expect(await page.evaluate(() => window.__asterion.getState())).toEqual(actual);
    expect(errors).toEqual([]);
  });
}
