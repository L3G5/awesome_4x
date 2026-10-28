import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
const repo = path.resolve(process.argv[2] || '/tmp/asterion-stage16-founding');
const url = process.argv[3] || 'http://127.0.0.1:5199/';
const out = path.dirname(fileURLToPath(import.meta.url));
const { createGame, validateSave } = await import(pathToFileURL(path.join(repo, 'src/game.js')));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourcePaths = ['src/conquest.js','src/conquest-ui.js','src/conquest.css','src/main.js','src/galaxy.js'];
const sources = Object.fromEntries(sourcePaths.map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
const actualPath = path.join(repo,'docs/military-playtest/replay/actual-exports/cycle55.json');
const actualBytes = fs.readFileSync(actualPath), actual = JSON.parse(actualBytes);
const browser = await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const checks=[];
async function load(state, width=1280, fallback=false) {
  assert(validateSave(state));
  const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:width===390?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({state,fallback})=>{
    localStorage.setItem('asterion-reach-save-v1',JSON.stringify(state));
    if(fallback){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:original.call(this,kind,...args);};}
  },{state,fallback});
  await page.goto(url);await page.waitForFunction(()=>window.__asterion);
  const loaded=await page.evaluate(()=>window.__asterion.getState());assert.deepEqual(loaded,state);
  return {context,page,errors};
}
async function unchanged(page,state){assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),state);}
try {
  for (const width of [1280,390]) {
    const {context,page,errors}=await load(actual,width,width===390);
    await page.locator('[data-page="empire"]').click();
    const card=page.locator('.conquest-card');await card.scrollIntoViewIfNeeded();
    assert.equal(await card.locator('[data-founding-world]').count(),4);
    assert.match(await card.innerText(),/3\s*\/\s*4/);
    assert.match(await card.locator('[data-founding-world="s3"]').innerText(),/Lumen[\s\S]*Choir/);
    const screenshot=`actual55-ledger-${width}.png`;await page.screenshot({path:path.join(out,screenshot)});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
    const target=card.locator('[data-founding-world="s3"]');await target.focus();await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>window.__asterion.getPage()),'galaxy');
    assert.match(await page.locator('.system-header h2').innerText(),/Lumen/);
    assert.match(await page.locator('.founding-inspector').innerText(),/Moving an administrative capital does not move this objective/);
    assert.match(await page.locator('[data-system-id="s3"].galaxy-system-label').getAttribute('aria-label'),/founding world/);
    await unchanged(page,actual);assert.deepEqual(errors,[]);
    checks.push({name:`Actual cycle55 at ${width}px${width===390?' with WebGL disabled and reduced motion':''}`,passed:true,screenshot,keyboardInspectPure:true,noHorizontalOverflow:true});
    if(width===1280){await page.locator('[data-action="reset-view"]').click();await page.screenshot({path:path.join(out,'actual55-map-1280.png')});await unchanged(page,actual);}
    await context.close();
  }
  const state=createGame('independent-conquest-ui-privacy');state.factions[0].contacts=['veyr','khar','choir'];
  state.systems[1].knownBy.push('player');
  const altered=structuredClone(state);
  for(const system of altered.systems.slice(1,4)){system.owner=system.owner==='khar'?'veyr':'khar';system.population+=7;system.buildings.push('bastion');}
  for(const fleet of altered.fleets.filter(f=>f.owner!=='player')){fleet.ships*=3;fleet.hp*=3;}
  const projections=[];
  for(const fixture of [state,altered]){
    const {context,page,errors}=await load(fixture);
    const marks=await page.locator('.galaxy-system-label.is-founding').evaluateAll(nodes=>nodes.map(n=>n.dataset.systemId).sort());
    await page.locator('[data-page="empire"]').click();const card=page.locator('.conquest-card');
    projections.push({html:await card.innerHTML(),marks});
    assert.equal(await card.locator('[data-founding-world]').count(),1);
    assert.match(await card.innerText(),/3 founding worlds remain unidentified/);
    assert(!await card.locator('[data-founding-world="s1"]').count());
    assert.match(await card.locator('[data-conquest-faction="veyr"]').innerText(),/0\s*\/\s*4\s*confirmed/);
    await unchanged(page,fixture);assert.deepEqual(errors,[]);await context.close();
  }
  assert.deepEqual(projections[0],projections[1]);
  checks.push({name:'Charted/contacted world stays unidentified and hidden ownership/fleet changes leave new ledger/markers identical',passed:true,foundingMarkers:projections[0].marks});
  const warning=createGame('independent-conquest-warning');warning.factions[0].contacts=['veyr','khar','choir'];
  for(const system of warning.systems.slice(1,4)){system.owner='veyr';for(const key of ['knownBy','exploredBy'])if(!system[key].includes('player'))system[key].push('player');}
  const {context,page,errors}=await load(warning);await page.locator('[data-page="empire"]').click();
  assert.match(await page.locator('.conquest-alert').innerText(),/Veyr controls 3 founding worlds/);
  assert.equal(await page.locator('.modal').count(),0);await unchanged(page,warning);assert.deepEqual(errors,[]);await context.close();
  checks.push({name:'Recognized rival three-world control appears only in ledger without popup or state change',passed:true});
} finally {await browser.close();}
const finalSources=Object.fromEntries(sourcePaths.map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
assert.deepEqual(finalSources,sources,'Reviewed source changed during browser review');
const result={generatedAt:new Date().toISOString(),url,method:'Four independent read-only UI cases: two widths of unchanged actual completed cycle55 export, a two-fixture synthetic hidden-state comparison, and a synthetic rival-control warning. Each uses an isolated fresh browser context. No ongoing WATCH files/profile/state accessed. No commands dispatched.',sources,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),actualInput:{path:actualPath,sha256:hash(actualBytes)},checks};
fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks},null,2));
