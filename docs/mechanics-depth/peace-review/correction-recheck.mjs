import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { command, validateSave } from '../../../src/game.js';
const baseURL = 'http://127.0.0.1:44459', out = new URL('./', import.meta.url);
const inputPath = 'docs/military-playtest/replay/actual-exports/cycle40.json';
const input = JSON.parse(readFileSync(new URL('../../../' + inputPath, import.meta.url)));
const expected = structuredClone(input);
assert.equal(command(expected, { type: 'diplomacy', targetId: 'veyr', stance: 'peace' }).ok, true);
const hash = value => createHash('sha256').update(value).digest('hex');
const htmlResponse = await fetch(baseURL), html = await htmlResponse.text(), servedAssets = [];
assert.equal(htmlResponse.status, 200);
for (const match of html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)) {
  const response = await fetch(new URL(match[1], baseURL)); assert.equal(response.status, 200);
  servedAssets.push({ path: match[1], sha256: hash(Buffer.from(await response.arrayBuffer())) });
}
const browser = await chromium.launch({ executablePath: '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--enable-unsafe-swiftshader'] });
const results = [], errors = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 } }), page = await context.newPage();
    page.on('pageerror', error => errors.push({ width, message: error.message }));
    await page.addInitScript(saved => {
      if (!localStorage.getItem('peace-correction-review-initialized')) {
        localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
        localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
        localStorage.setItem('asterion-reach-language-v1', 'en');
        localStorage.setItem('peace-correction-review-initialized', 'true');
      }
    }, input);
    await page.goto(baseURL); await page.locator('[data-page="diplomacy"]').click();
    await page.locator('[data-rival="veyr"] [data-action="peace-confirmation"]').click();
    const modal = page.locator('.modal'), terms = modal.locator('.modal-lead'), toggle = modal.locator('[data-action="language"]');
    const englishTerms = await terms.innerText();
    assert.match(englishTerms, /Pay 60 credits/); assert.match(englishTerms, /forbidden for 5 cycles/);
    const snapshot = () => page.evaluate(() => window.__asterion.getState());
    assert.deepEqual(await snapshot(), input);
    await toggle.click();
    const russianTerms = await terms.innerText();
    assert.equal(/[a-z]/i.test(russianTerms), false, 'the complete decision paragraph has no residual English');
    assert.match(russianTerms, /60 кредитов/); assert.match(russianTerms, /5 циклов/);
    assert.match(russianTerms, /ближайшей своей колонии/); assert.match(russianTerms, /Если колоний нет/);
    assert.match(russianTerms, /нейтральную систему/); assert.match(russianTerms, /флот остаётся на месте/);
    const geometry = await terms.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, height: element.getBoundingClientRect().height }));
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1);
    const screenshot = `correction-a1c2eb7-ru-${width}-terms.png`;
    await modal.screenshot({ path: new URL(screenshot, out).pathname });
    await toggle.click(); assert.equal(await terms.innerText(), englishTerms, 'English round trip restores the canonical full terms');
    assert.deepEqual(await snapshot(), input, 'language round trip and reading remain state-pure');
    await toggle.click();
    await modal.locator('[data-action="diplomatic-confirm"]').click();
    const after = await snapshot(); assert.deepEqual(after, expected, 'actual UI settlement equals the ordinary command, including every withdrawal and log');
    assert.equal(validateSave(after), true);
    await page.reload(); assert.deepEqual(await snapshot(), expected, 'ordinary settlement persists exactly after reload');
    results.push({ width, inputKind: 'Unmodified actual historical military campaign cycle40 export', inputPath, englishTerms, russianTerms, geometry, screenshot,
      languageRoundTripPure: true, ordinaryCommandExactMatch: true, reloadExactMatch: true, creditsPaid: 60, ordersUsed: 1, truceUntil: 45 });
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
const sourceFiles = ['src/diplomacy.js', 'src/diplomacy-ui.js', 'src/locales/ru.js', 'src/locales/bindings.js', 'src/main.js', 'src/game.js', 'src/localization.js'];
const evidence = { candidate: { baseURL, requestedCommit: 'a1c2eb7', htmlSha256: hash(html), servedAssets,
 sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(new URL('../../../' + path, import.meta.url)))])) }, inputSha256: hash(readFileSync(new URL('../../../' + inputPath, import.meta.url))), browserCases: results.length, pageErrors: errors, results };
writeFileSync(new URL('correction-results.json', out), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ browserCases: results.length, pageErrors: errors.length, allAssertionsPassed: true }));
