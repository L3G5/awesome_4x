import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
const repo=path.resolve(process.argv[2]||'/tmp/asterion-stage17-investment'),url=process.argv[3]||'http://127.0.0.1:5201/';
const out=path.dirname(fileURLToPath(import.meta.url));
const {createGame,command,validateSave}=await import(pathToFileURL(path.join(repo,'src/game.js')));
const {TECHS}=await import(pathToFileURL(path.join(repo,'src/content.js')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourcePaths=['src/investment.js','src/investment-ui.js','src/investment.css','src/development-ui.js','src/main.js'];
const sources=Object.fromEntries(sourcePaths.map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
function fixture(){const s=createGame('independent-investment-ui'),p=s.factions[0],w=s.systems[0];Object.assign(p,{credits:2000,minerals:2000,orders:18,techs:Object.keys(TECHS),research:null});Object.assign(w,{population:8,habitability:75,growth:0,buildings:['mine','factory','shipyard'],queue:null,charter:{type:'forge',level:1}});return s;}
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const checks=[];
async function load(s,width=1280){assert(validateSave(s));const context=await browser.newContext({viewport:{width,height:width===390?844:960},reducedMotion:width===390?'reduce':'no-preference'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),s);await page.goto(url);await page.waitForFunction(()=>window.__asterion);assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),s);return{context,page,errors};}
async function pure(page,s){assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),s);}
async function open(page,id){const details=page.locator(`details[data-investment="${id}"]`),summary=details.locator('summary');assert.equal(await summary.evaluate(el=>Boolean(el.closest('button'))),false);await summary.focus();await page.keyboard.press('Space');assert.equal(await details.getAttribute('open'),'');return details;}
async function shot(page,element,name){await element.evaluate(el=>{const scroller=el.closest('.modal-content');scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top-16;});await page.screenshot({path:path.join(out,name)});}
async function boundary(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const close=await page.locator('.close-modal').boundingBox();assert(close&&close.y>=0&&close.y+close.height<=page.viewportSize().height);}
try{
 {
  const s=fixture(),{context,page,errors}=await load(s);await page.locator('[data-action="development-menu"]').click();
  assert.equal(await page.locator('details[open]').count(),0);const detail=await open(page,'forge');
  assert.match(await detail.locator('.investment-duration').innerText(),/5 cycles[\s\S]*100 work at 24 production/);
  assert.match(await detail.getByRole('row',{name:/Production \/ cycle/}).innerText(),/24\s+30/);
  assert.match(await detail.locator('[data-throughput="frigate"]').innerText(),/2 cycles[\s\S]*1 cycle/);
  assert.match(await page.locator('[data-charter="forge"] .build-cost').innerText(),/300[\s\S]*100/);
  await shot(page,detail.locator('summary'),'forge-1280-effects.png');await shot(page,detail.locator('h4'),'forge-1280-throughput.png');await boundary(page);await pure(page,s);
  await detail.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await detail.getAttribute('open'),null);
  const expected=structuredClone(s);assert(command(expected,{type:'develop',systemId:'s0',charterType:'forge'}).ok);
  await page.locator('[data-charter="forge"]').click();assert.equal(await page.locator('.modal').count(),0);assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),expected);assert.deepEqual(errors,[]);await context.close();
  checks.push({name:'Forge comparison separates upgrade duration and ship throughput; native keyboard inspection is pure; direct commission exactly matches ordinary command',passed:true,screenshots:['forge-1280-effects.png','forge-1280-throughput.png']});
 }
 {
  const s=fixture();s.factions[0].credits=0;s.factions[0].minerals=0;s.factions[0].orders=0;s.systems[0].queue={kind:'ship',itemId:'frigate',cost:{credits:25,minerals:32},work:26,progress:5};
  const{context,page,errors}=await load(s);await page.locator('[data-action="development-menu"]').click();assert(await page.locator('[data-charter="forge"]').isDisabled());const detail=await open(page,'forge');
  assert.match(await detail.innerText(),/Finish or cancel the current project[\s\S]*excludes that waiting time/);assert.match(await detail.getByRole('row',{name:/Production \/ cycle/}).innerText(),/24\s+30/);
  await pure(page,s);await boundary(page);await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),0);await pure(page,s);assert.deepEqual(errors,[]);await context.close();
  checks.push({name:'Zero funds/orders and paid busy queue disable commission while comparison remains accessible and preserves the receipt',passed:true});
 }
 {
  const s=fixture();s.systems[0].charter={type:'extraction',level:1};const{context,page,errors}=await load(s);await page.locator('[data-action="build-menu"]').click();await page.locator('#replace-building').selectOption('mine');const detail=await open(page,'market');
  assert.match(await detail.locator('.investment-replacement').innerText(),/Orbital Extractor and Extraction Charter I/);
  assert.match(await detail.getByRole('row',{name:/Colony minerals \/ cycle/}).innerText(),/15\s+5/);
  assert.match(await detail.locator('.investment-empire').innerText(),/cycle after completion/);
  await shot(page,detail.locator('summary'),'replacement-1280.png');await pure(page,s);await boundary(page);assert.deepEqual(errors,[]);await context.close();
  checks.push({name:'Extractor replacement shows full lost charter output and truthful income collection timing',passed:true,screenshots:['replacement-1280.png']});
 }
 {
  const s=fixture(),{context,page,errors}=await load(s);await page.locator('[data-action="build-menu"]').click();await page.locator('#replace-building').selectOption('shipyard');const detail=await open(page,'market');
  const row=detail.locator('[data-throughput="frigate"]');assert.match(await row.locator('td').last().innerText(),/Unavailable[\s\S]*Orbital Shipyard/);assert(!/0 cycles/.test(await row.innerText()));
  await pure(page,s);assert.deepEqual(errors,[]);await context.close();checks.push({name:'Removing the only shipyard makes downstream ship construction unavailable rather than zero-cycle',passed:true});
 }
 {
  const s=fixture();delete s.systems[0].charter;s.systems[0].population=12;s.systems[0].buildings=['mine','shipyard','habitat','lab'];
  const{context,page,errors}=await load(s,390);await page.locator('[data-action="build-menu"]').click();await page.locator('#replace-building').selectOption('habitat');const detail=await open(page,'factory');
  assert.match(await detail.getByRole('row',{name:/Population \/ capacity/}).innerText(),/12 \/ 12\s+12 \/ 8/);assert.match(await detail.innerText(),/Population stays at 12[\s\S]*Natural growth is paused/);
  await shot(page,detail.locator('summary'),'habitat-390-effects.png');await shot(page,detail.locator('h4'),'habitat-390-throughput.png');await boundary(page);await pure(page,s);
  await page.locator('.close-modal').click();assert.equal(await page.locator('.modal').count(),0);await pure(page,s);assert.deepEqual(errors,[]);await context.close();
  checks.push({name:'390px reduced-motion habitat replacement keeps12 population over8 capacity, readable expanded rows/throughput and reachable close control',passed:true,screenshots:['habitat-390-effects.png','habitat-390-throughput.png']});
 }
}finally{await browser.close();}
const finalSources=Object.fromEntries(sourcePaths.map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));assert.deepEqual(finalSources,sources,'Sources changed during independent UI pass');
const result={generatedAt:new Date().toISOString(),url,method:'Five bounded independent UI cases in isolated browser contexts with explicitly synthetic valid fixtures. Inspection checks compare every saved field; one direct commission compares against the ordinary engine command. No ongoing WATCH or historical campaign files accessed. No campaign cohort.',sources,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),checks};fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks},null,2));
