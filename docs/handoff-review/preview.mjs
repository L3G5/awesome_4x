import {chromium} from '/home/leg/projects/awesome_4x/node_modules/playwright/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root='/tmp/asterion-stage24-handoff',input=`${root}/docs/odyssey-playtest/actual/checkpoints/cycle50.json`,output=`${root}/docs/screenshots/odyssey50-v0211.png`;
const bytes=fs.readFileSync(input),state=JSON.parse(bytes),errors=[],failed=[];
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`)});
await page.goto('http://127.0.0.1:5215');await page.locator('[data-action="begin"]').click();await page.locator('[data-action="menu"]').click();
const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('.modal [data-action="import"]').click()]);await chooser.setFiles(input);await page.locator("#confirm-import").click();
await page.waitForFunction(()=>window.__asterion.getState().seed==='ASTERION-ODYSSEY-20');
if(await page.locator('.modal').count())await page.keyboard.press('Escape');
await page.locator('[data-page="galaxy"]').click();await page.locator('[data-action="home"]').click();await page.locator('[data-action="reset-view"]').click();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(6000);
assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),state);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
fs.mkdirSync(`${root}/docs/screenshots`,{recursive:true});await page.screenshot({path:output});
const metadata=await(await fetch('http://127.0.0.1:5215/build-info.json')).json();
const result={purpose:'Read-only illustration of an actual Odyssey cycle50 save imported into the current interface, not newly played history.',sourceCommit:'648c1f53de5f37d4df012c6b7e9994fb9574819c',build:metadata,viewport:{width:1440,height:960},reducedMotion:true,actualInput:'docs/odyssey-playtest/actual/checkpoints/cycle50.json',inputSha256:createHash('sha256').update(bytes).digest('hex'),image:'docs/screenshots/odyssey50-v0211.png',imageSha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex'),exactStateUnchanged:true,pageErrors:errors,failedResponses:failed};
fs.mkdirSync(`${root}/docs/handoff-review`,{recursive:true});fs.writeFileSync(`${root}/docs/handoff-review/preview.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}finally{await browser.close()}
