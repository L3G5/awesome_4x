import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
const repo=path.resolve(process.argv[2]||'/tmp/asterion-stage17-investment'),url=process.argv[3]||'http://127.0.0.1:5201/';
const out=path.dirname(fileURLToPath(import.meta.url)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const {createGame,validateSave}=await import(pathToFileURL(path.join(repo,'src/game.js')));
const {TECHS}=await import(pathToFileURL(path.join(repo,'src/content.js')));
const paths=['src/investment.js','src/investment-ui.js','src/investment.css','src/development-ui.js','src/main.js'];
const sources=Object.fromEntries(paths.map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
const previous=JSON.parse(fs.readFileSync(path.join(out,'ui-results.json')));
const changed=paths.filter(p=>sources[p]!==previous.sources[p]);assert.deepEqual(changed,['src/investment-ui.js','src/investment.css']);
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']}),checks=[];
try{for(const width of [1280,390]){
 const s=createGame('independent-final-investment-ui'),p=s.factions[0],w=s.systems[0];Object.assign(p,{techs:Object.keys(TECHS),credits:0,minerals:0,orders:0,research:null});
 Object.assign(w,{population:8,habitability:75,growth:0,buildings:['mine','factory','shipyard'],charter:{type:'forge',level:1},queue:null});
 if(width===390){delete w.charter;w.population=12;w.buildings=['mine','shipyard','habitat','lab'];}
 assert(validateSave(s));const context=await browser.newContext({viewport:{width,height:width===390?844:960},reducedMotion:width===390?'reduce':'no-preference'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),s);await page.goto(url);await page.waitForFunction(()=>window.__asterion);
 // Saved JSON canonicalizes an incidental generated -0 coordinate to 0.
 // Check the exact saved bytes, then use the loaded runtime as the purity baseline.
 const loaded=await page.evaluate(()=>window.__asterion.getState());assert.equal(JSON.stringify(loaded),JSON.stringify(s));
 if(width===1280)await page.locator('[data-action="development-menu"]').click();else{await page.locator('[data-action="build-menu"]').click();await page.locator('#replace-building').selectOption('habitat');}
 const id=width===1280?'forge':'factory',details=page.locator(`details[data-investment="${id}"]`),summary=details.locator('summary');
 const commission=page.locator(width===1280?'[data-charter="forge"]':'[data-item="factory"]');assert(await commission.isDisabled());
 await summary.focus();await page.keyboard.press('Space');assert.equal(await details.getAttribute('open'),'');assert.equal(await summary.evaluate(el=>document.activeElement===el),true);
 assert.match(await details.locator('.investment-project').innerText(),width===1280?/Forge Charter II[\s\S]*300 credits[\s\S]*100 minerals[\s\S]*1 order/:/Manufactory[\s\S]*35 credits[\s\S]*45 minerals[\s\S]*1 order/);
 const effects=await details.locator('.investment-effects').boundingBox(),future=await details.locator('.investment-future').boundingBox();
 if(width===1280){assert(future.x>effects.x+effects.width);assert(Math.abs(future.y-effects.y)<2);assert((await details.boundingBox()).width>700);assert.match(await details.locator('[data-throughput="frigate"]').innerText(),/2 cycles[\s\S]*1 cycle/);}
 else{assert(future.y>effects.y);assert(Math.abs(future.x-effects.x)<2);assert.match(await details.getByRole('row',{name:/Population \/ capacity/}).innerText(),/12 \/ 12\s+12 \/ 8/);}
 const shot=async(target,name)=>{await target.evaluate(el=>{const sc=el.closest('.modal-content');sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-16;});await page.screenshot({path:path.join(out,name)});};
 const names=width===1280?['final-forge-1280.png']:['final-habitat-390-effects.png','final-habitat-390-throughput.png'];
 await shot(summary,names[0]);if(width===390)await shot(details.locator('.investment-future'),names[1]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.equal(await page.locator('.modal-content').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 const close=await page.locator('.close-modal').boundingBox();assert(close.y>=0&&close.y+close.height<=page.viewportSize().height);
 assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),loaded);
 await summary.focus();await page.keyboard.press('Enter');assert.equal(await details.getAttribute('open'),null);assert.equal(await summary.evaluate(el=>document.activeElement===el),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),0);assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),loaded);assert.deepEqual(errors,[]);
 checks.push({name:`Final ${width}px expanded comparison: named/priced project, ${width===1280?'full-width side-by-side':'stacked'} layout, disabled purchase with active native disclosure, keyboard/purity/close boundaries`,passed:true,screenshots:names});await context.close();
}}finally{await browser.close();}
for(const p of paths)assert.equal(hash(fs.readFileSync(path.join(repo,p))),sources[p]);
const result={generatedAt:new Date().toISOString(),url,method:'Two targeted final layout/keyboard cases after changes only to investment-ui.js and investment.css. Previous five UI cases retain original phase hashes and are not represented as rerun. Synthetic valid fixtures only; zero game commands; no WATCH files or profile accessed.',sources,changedSinceOriginalFive:changed,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),checks};
fs.writeFileSync(path.join(out,'final-ui-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,changed,checks},null,2));
