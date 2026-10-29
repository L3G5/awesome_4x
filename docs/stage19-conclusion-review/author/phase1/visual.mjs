import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
import { validateSave } from '/tmp/asterion-stage19-conclusion/src/game.js';

const root = '/tmp/asterion-stage19-conclusion';
const output = '/tmp/asterion-stage19-ui-author-review';
const sha = data => createHash('sha256').update(data).digest('hex');
const sourceFiles = ['conclusion-ui.js', 'conclusion.css', 'conclusion.js', 'main.js', 'victory-ui.js', 'style.css'];
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, 'src', file)))]));
const watchPath = path.join(root, 'docs/watch-playtest/checkpoints/cycle60.json');
const militaryPath = path.join(root, 'docs/military-playtest/replay/actual-exports/cycle57.json');
const watch = JSON.parse(fs.readFileSync(watchPath));
const military = JSON.parse(fs.readFileSync(militaryPath));
const legacy = structuredClone(watch);
delete legacy.factions.find(faction => faction.id === 'player').alignment;
const cases = [
  { name: 'watch-1280', width: 1280, state: watch, expected: [5, 43, 17, 11, 698], original: watchPath },
  { name: 'watch-390', width: 390, state: watch, expected: [5, 43, 17, 11, 698], original: watchPath },
  { name: 'military-1280', width: 1280, state: military, expected: [12, 104, 15, 11, 745], original: militaryPath },
  { name: 'legacy-390', width: 390, state: legacy, expected: [5, 43, 17, 11, 698], synthetic: 'Actual completed WATCH60 copy with only player alignment metadata omitted. Not a historical export.' },
];
const results = [];
const browser = await chromium.launch({ executablePath: '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  for (const test of cases) {
    assert(validateSave(test.state));
    const context = await browser.newContext({ viewport: { width: test.width, height: test.width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(state => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(state)), test.state);
    await page.goto('http://127.0.0.1:5206/');
    await page.waitForFunction(() => window.__asterion);
    await page.locator('[data-action="menu"]').click();
    await page.locator('.modal [data-action="show-conclusion"]').click();
    await page.locator('.campaign-conclusion').waitFor();
    assert.equal(await page.locator('.close-modal').evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('.modal-content').evaluate(element => element.scrollTop), 0);
    for (const [index, key] of ['colonies', 'population', 'ships', 'techs', 'score'].entries()) {
      assert.equal(await page.locator(`[data-conclusion-stat="${key}"] dd`).innerText(), String(test.expected[index]));
    }
    assert.equal(await page.locator('.conclusion-moment').count(), 6);
    await page.screenshot({ path: path.join(output, `${test.name}-top.png`) });
    if (test.synthetic) {
      assert.match(await page.locator('.conclusion-objectives').innerText(), /Alignment progress was not recorded/);
      assert.equal(await page.locator('.conclusion-alignment').count(), 0);
      await page.locator('.conclusion-objectives').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${test.name}-network.png`) });
    } else {
      await page.locator('.conclusion-history').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${test.name}-history.png`) });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.locator('.modal-content').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.modal').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__asterion.getState()), test.state);
    assert.deepEqual(errors, []);
    results.push({ name: test.name, width: test.width, provenance: test.synthetic || 'Actual exported completed campaign', originalPath: test.original || null, originalSha256: test.original ? sha(fs.readFileSync(test.original)) : null, fixtureJsonSha256: sha(JSON.stringify(test.state)), passed: true, holdings: test.expected, noHorizontalOverflow: true, inspectionPure: true, reducedMotion: true });
    await context.close();
  }
} finally { await browser.close(); }
const afterHashes = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, 'src', file)))]));
assert.deepEqual(afterHashes, sourceHashes, 'UI source changed during the author review');
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), method: 'Author visual review only; four pure inspection cases, no game commands and no campaign mutations. Browser actions: menu, conclusion, scroll, Escape. Root owns independent integration/action tests.', sourceHashes, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
