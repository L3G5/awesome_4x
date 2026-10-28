import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/asterion-stage15-rounds/package.json');
const { chromium } = require('playwright');
const source = '/home/leg/projects/awesome_4x/docs/military-playtest/replay/actual-exports/cycle55.json';
const input = fs.readFileSync(source, 'utf8');
const browser = await chromium.launch({ executablePath: '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(save => localStorage.setItem('asterion-reach-save-v1', save), input);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5198/');
  await page.locator('[data-page="empire"]').click();
  await page.locator('.victory-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/asterion-stage16-design/cycle55-current-empire.png' });
  const victoryText = await page.locator('.victory-grid').innerText();
  const foundingLinks = await page.locator('.victory-grid [data-action="inspect"]').count();
  await page.locator('[data-page="galaxy"]').click();
  await page.screenshot({ path: '/tmp/asterion-stage16-design/cycle55-current-galaxy.png' });
  const labels = await page.locator('.galaxy-system-label').allTextContents();
  fs.writeFileSync('/tmp/asterion-stage16-design/interface-evidence.json', JSON.stringify({ source, sourceSha256: crypto.createHash('sha256').update(input).digest('hex'), preview: 'http://127.0.0.1:5198/', fixture: 'Unchanged actual historical cycle55 export from the completed IRON-COVENANT-10 campaign, loaded into current0.15 presentation in a fresh ephemeral browser context. No commands issued; no WATCH data accessed.', victoryText, foundingLinks, visibleSystemLabels: labels }, null, 2));
  console.log(JSON.stringify({ victoryText, foundingLinks }));
} finally { await browser.close(); }
