import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
const repo=path.resolve(process.argv[2]||'/tmp/asterion-stage16-founding'),url=process.argv[3]||'http://127.0.0.1:5199/';
const out=path.dirname(fileURLToPath(import.meta.url));
const {createGame,validateSave}=await import(pathToFileURL(path.join(repo,'src/game.js')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources=Object.fromEntries(['src/conquest.js','src/conquest-ui.js','src/conquest.css','src/main.js','src/galaxy.js'].map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const checks=[];
try{
 const legacy=createGame('independent-founding-legacy-chart');legacy.factions[0].contacts=[];
 legacy.systems[0].knownBy=legacy.systems[0].knownBy.filter(id=>id!=='player');legacy.systems[0].exploredBy=[];
 legacy.systems[1].knownBy=legacy.systems[1].knownBy.filter(id=>id!=='player');legacy.systems[1].exploredBy.push('player');
 assert(validateSave(legacy));
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),legacy);
 await page.goto(url);await page.waitForFunction(()=>window.__asterion);
 for(const id of ['s1','s0']){
  await page.locator('[data-page="empire"]').click();
  const button=page.locator(`[data-founding-world="${id}"]`);assert.equal(await button.count(),1);
  if(id==='s1')assert.match(await button.innerText(),/Founding civilization unidentified[\s\S]*Unknown government/);
  await button.focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.__asterion.getPage()),'galaxy');
  assert.equal(await page.locator('.system-header h2').innerText(),legacy.systems.find(s=>s.id===id).name);
  assert.equal(await page.locator('.founding-inspector').count(),1);
  if(id==='s1')assert.match(await page.locator('.founding-inspector').innerText(),/Unidentified civilization[\s\S]*Unknown government/);
  assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),legacy);
 }
 assert.deepEqual(errors,[]);await context.close();
 checks.push({name:'Final selectSystem boundary: owned-only and surveyed-only worlds without redundant knownBy remain inspectable with Enter; founding identity stays anonymous without contact',passed:true,stateUnchanged:true});
 const actualPath=path.join(repo,'docs/military-playtest/replay/actual-exports/cycle55.json'),actual=JSON.parse(fs.readFileSync(actualPath));
 const phoneContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),phone=await phoneContext.newPage();
 await phone.addInitScript(s=>{localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s));const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:original.call(this,kind,...args);};},actual);
 await phone.goto(url);await phone.waitForFunction(()=>window.__asterion);await phone.locator('[data-page="empire"]').click();
 await phone.locator('.conquest-card').evaluate(el=>el.scrollIntoView({block:'start'}));
 await phone.screenshot({path:path.join(out,'actual55-ledger-390-top.png')});
 await phone.locator('.conquest-standings').evaluate(el=>el.scrollIntoView({block:'start'}));
 await phone.screenshot({path:path.join(out,'actual55-ledger-390-bottom.png')});
 assert.deepEqual(await phone.evaluate(()=>window.__asterion.getState()),actual);await phoneContext.close();
}finally{await browser.close();}
const previous=JSON.parse(fs.readFileSync(path.join(out,'ui-results.json')));
const changed=Object.keys(sources).filter(p=>sources[p]!==previous.sources[p]);assert.deepEqual(changed,['src/main.js']);
const result={generatedAt:new Date().toISOString(),url,method:'One new targeted legacy-selection boundary after main.js selectSystem guard broadening. Earlier four UI cases remain attributed to their original source hashes, not claimed as rerun. Two additional phone screenshots reposition the unchanged actual55 export for readability; no gameplay commands.',sources,changedSincePriorFour:changed,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),checks};
fs.writeFileSync(path.join(out,'boundary-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
