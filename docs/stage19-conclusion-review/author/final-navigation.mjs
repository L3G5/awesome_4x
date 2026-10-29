import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
const root = '/tmp/asterion-stage19-conclusion', output = '/tmp/asterion-stage19-ui-author-review';
const files = ['conclusion-ui.js', 'conclusion.css', 'conclusion.js', 'main.js', 'victory-ui.js', 'style.css'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashSources = () => Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(root, 'src', file)))]));
const sourceHashes = hashSources();
const state = JSON.parse(fs.readFileSync(path.join(root, 'docs/watch-playtest/checkpoints/cycle60.json')));
const browser = await chromium.launch({ executablePath: '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(state => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(state)), state);
    await page.goto('http://127.0.0.1:5206/');
    await page.waitForFunction(() => window.__asterion);
    await page.locator('[data-page="journal"]').click();
    await page.locator('#workspace-page [data-action="show-conclusion"]').click();
    assert.equal(await page.locator('.close-modal').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-action="conclusion-galaxy"]').evaluate(element => element === document.activeElement), true);
    await page.screenshot({ path: path.join(output, `final-watch-${width}-top.png`) });
    await page.locator('.conclusion-history').evaluate(element => {
      const pane = element.closest('.modal-content');
      pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 55;
    });
    await page.screenshot({ path: path.join(output, `final-watch-${width}-history.png`) });
    assert.match(await page.locator('.conclusion-history-scope').innerText(), /involving your civilization/);
    assert.equal(await page.locator('.modal-content').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await page.locator('[data-action="conclusion-galaxy"]').click();
    assert.equal(await page.evaluate(() => window.__asterion.getPage()), 'galaxy');
    assert.equal(await page.locator('.modal').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__asterion.getState()), state);
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, chronicleOrigin: true, inspectReturnsToGalaxy: true, closeInitialFocus: true, keyboardNextAction: true, noHorizontalOverflow: true, inspectionPure: true });
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(hashSources(), sourceHashes, 'Sources changed during final targeted review');
fs.mkdirSync(path.join(output, 'sources-final'), { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, 'src', file), path.join(output, 'sources-final', file));
fs.writeFileSync(path.join(output, 'final-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), method: 'Two final targeted author checks after conclusion-galaxy navigation and civilization wording changes. These do not relabel or repeat the four earlier phase-1 cases.', sourceHashes, results }, null, 2));
console.log(results);
