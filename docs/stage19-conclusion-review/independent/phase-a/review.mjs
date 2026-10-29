import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const repo = process.env.REVIEW_REPO || '/tmp/asterion-stage19-conclusion';
const out = process.env.REVIEW_OUT || path.dirname(new URL(import.meta.url).pathname);
const base = process.env.REVIEW_URL || 'http://127.0.0.1:5206';
mkdirSync(out, { recursive: true });
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('@playwright/test');
const { endTurn, getEmpireStats, validateSave } = await import(pathToFileURL(path.join(repo,'src/game.js')));
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const files = ['src/main.js','src/victory-ui.js','src/conclusion-ui.js','src/conclusion.css','src/conclusion.js','src/game.js','src/victory.js','src/conquest.js','src/reports.js','src/style.css'];
const sourceHashes = () => Object.fromEntries(files.map(file => [file,hash(readFileSync(path.join(repo,file)))]));
const fixturePaths = {watch60:'docs/watch-playtest/checkpoints/cycle60.json',watch51:'docs/watch-playtest/checkpoints/cycle51.json',watch56:'docs/watch-playtest/checkpoints/cycle56.json',iron57:'docs/military-playtest/replay/actual-exports/cycle57.json'};
const fixture = name => JSON.parse(readFileSync(path.join(repo,fixturePaths[name])));
const results = { scope:'Independent review of integrated UI/main/victory-ui. Reviewer authored conclusion.js; this is not an independent review of that core helper.', started:new Date().toISOString(), repo, base, commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), initialSourceHashes:sourceHashes(), fixtures:Object.fromEntries(Object.entries(fixturePaths).map(([name,file])=>[name,{file,sha256:hash(readFileSync(path.join(repo,file)))}])), cases:[] };
const browser = await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',headless:true,args:['--enable-unsafe-swiftshader']});
async function run(name, fn, viewport={width:1280,height:900}, fallback=false) {
  const context = await browser.newContext({viewport, reducedMotion:'reduce',acceptDownloads:true});
  if(fallback) await context.addInitScript(()=>{const native=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl')||type==='experimental-webgl')return null;return native.call(this,type,...args);};});
  const page=await context.newPage(), entry={name,viewport,fallback,sourceHashes:sourceHashes(),pageErrors:[],consoleErrors:[],checks:[],screenshots:[]};
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>entry.pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')entry.consoleErrors.push(message.text());});
  const check=(label,condition=true)=>{assert.ok(condition,label);entry.checks.push(label);};
  const screenshot=async label=>{const file=`${name}-${label}.png`;await page.screenshot({path:path.join(out,file),fullPage:true});entry.screenshots.push(file);};
  const dom=async label=>writeFileSync(path.join(out,`${name}-${label}.txt`),await page.locator('body').innerText());
  try {await fn({page,entry,check,screenshot,dom});assert.deepEqual(entry.pageErrors,[]);entry.status='pass';}catch(error){entry.status='fail';entry.driverError={message:error.message,stack:error.stack};await screenshot('failure').catch(()=>{});await dom('failure').catch(()=>{});}finally{entry.finalSourceHashes=sourceHashes();results.cases.push(entry);writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');await context.close();console.log(JSON.stringify({name,status:entry.status,checks:entry.checks.length,error:entry.driverError?.message}));}
}
const snapshot = page=>page.evaluate(()=>window.__asterion.getState());
async function boot(page){await page.goto(base);await page.locator('#app .app-shell').waitFor();if(await page.locator('[data-action="begin"]').count())await page.locator('[data-action="begin"]').click();}
async function importUI(page,state,label){assert.equal(validateSave(state),true);await boot(page);await page.locator('[data-action="menu"]').click();const file=path.join(out,`fixture-${label}.json`);writeFileSync(file,JSON.stringify(state,null,2)+'\n');await page.locator('#import-save').setInputFiles(file);await page.locator('#confirm-import').click();assert.deepEqual(await snapshot(page),state);}
async function menuEnding(page){await page.locator('[data-action="menu"]').click();await page.locator('.modal [data-action="show-conclusion"]').click();await page.locator('.campaign-conclusion').waitFor();}
async function escape(page){await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),0);}
async function metrics(page,expected){for(const [key,value]of Object.entries(expected))assert.equal((await page.locator(`[data-conclusion-stat="${key}"] dd`).innerText()).replaceAll(',',''),String(value));}
async function exportUI(page,filename){const pending=page.waitForEvent('download');await page.locator('.conclusion-actions [data-action="export"]').click();const download=await pending;await download.saveAs(path.join(out,filename));return JSON.parse(readFileSync(path.join(out,filename)));}
await run('watch-desktop',async({page,entry,check,screenshot,dom})=>{
  const state=fixture('watch60');await importUI(page,state,'actual-watch60');check('Actual WATCH imported through the file picker and restore confirmation without state changes');
  await page.locator('#mandate [data-action="show-conclusion"]').click();
  assert.equal(await page.locator('#modal-title').innerText(),'Transcendence');await metrics(page,{colonies:5,population:43,ships:17,techs:11,score:698});check('Saved winner, own holdings and Legacy are correct');
  assert.match(await page.locator('.conclusion-retained-counts').innerText(),/149 Chronicle entries.*4 battle reports/s);assert.match(await page.locator('.conclusion-history-scope').innerText(),/not a complete timeline/);check('Retained history counts and incomplete-history limitation are explicit');
  assert.equal(await page.locator('.modal .close-modal').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.conclusion-footer [data-action="new-game-menu"]').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('.modal .close-modal').evaluate(el=>el===document.activeElement),true);check('Close control receives initial focus and Tab/Shift+Tab wrap within the modal');
  await page.locator('.modal-content').evaluate(el=>el.scrollTop=0);await screenshot('top');await dom('ending');
  const report=page.locator('.conclusion-history [data-action="combat-report"]').first();const id=Number(await report.getAttribute('data-report'));await report.click();assert.ok((await page.locator('.combat-report').innerText()).includes(state.combatReports.find(r=>r.id===id).participants[0].name));check('Retained report link opens its recorded engagement');await escape(page);await menuEnding(page);
  const discovery=page.locator('.conclusion-history [data-action="anomaly"]').first();await discovery.click();assert.match(await page.locator('.modal').innerText(),/Patient Reef|Quarry the lattice/);check('Remembered expedition link opens its observer-safe record');await escape(page);await menuEnding(page);
  assert.deepEqual(await exportUI(page,'watch-exported-through-ui.json'),state);check('Conclusion export preserves the full exact actual saved state');
  await page.locator('[data-action="conclusion-chronicle"]').click();assert.equal(await page.locator('#workspace-page h2').innerText(),'Your chronicle');await page.locator('#workspace-page [data-action="show-conclusion"]').click();await page.locator('[data-action="conclusion-galaxy"]').click();assert.equal(await page.locator('#galaxy-page').isVisible(),true);check('Conclusion → Chronicle → conclusion → Inspect galaxy returns to the actual map');
  await page.reload();await menuEnding(page);assert.deepEqual(await snapshot(page),state);check('Reload and menu reopening preserve the completed campaign');
});
await run('iron-narrow',async({page,entry,check,screenshot,dom})=>{
  const state=fixture('iron57');await importUI(page,state,'actual-iron57');await menuEnding(page);
  assert.equal(await page.locator('#modal-title').innerText(),'Domination');await metrics(page,{colonies:12,population:104,ships:15,techs:11,score:745});assert.equal(await page.locator('#conclusion-worlds-title').innerText(),'4 / 4 founding worlds');check('Actual military ending shows the final four-world sovereignty and own metrics');
  const bounds=await page.locator('.modal').evaluate(el=>{const r=el.getBoundingClientRect();const c=el.querySelector('.modal-content');return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,contentWidth:c.clientWidth,scrollWidth:c.scrollWidth,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight};});entry.bounds=bounds;check('390-pixel modal remains within viewport with no horizontal content overflow',bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.scrollWidth<=bounds.contentWidth);
  await screenshot('top');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.conclusion-footer [data-action="new-game-menu"]').evaluate(el=>el===document.activeElement),true);await screenshot('bottom');check('Keyboard focus reaches the footer and scrolls the long conclusion');await dom('ending');
  await page.locator('.conclusion-world-links [data-system-select="s3"]').click();assert.equal(await page.locator('.modal').count(),0);assert.equal(await page.locator('#inspector .system-header h2').innerText(),'Lumen');check('Founding-world link leaves the ending and selects Lumen on the map');
  await menuEnding(page);await escape(page);assert.equal(await page.locator('[data-action="menu"]').evaluate(el=>el===document.activeElement),true);check('Escape returns focus to the menu opener');assert.deepEqual(await snapshot(page),state);
},{width:390,height:844});
await run('legacy-network',async({page,check,screenshot,dom})=>{
  const state=fixture('watch60');for(const faction of state.factions)delete faction.alignment;delete state.alignmentUpdatedTurn;
  await importUI(page,state,'synthetic-legacy-watch');await menuEnding(page);assert.equal(await page.locator('#modal-title').innerText(),'Transcendence');assert.equal(await page.locator('.conclusion-alignment').count(),0);assert.match(await page.locator('.conclusion-missing').innerText(),/not recorded/);check('Synthetic legacy save preserves Transcendence without inventing alignment or participants');await screenshot('ending');await escape(page);
  await page.locator('[data-page="empire"]').click();assert.equal(await page.locator('.alignment-title strong').innerText(),'— / 10');assert.equal(await page.locator('[data-race="player"] .race-heading strong').innerText(),'— / 10');assert.equal(await page.locator('.alignment-segments').count(),0);check('Empire and public race show missing progress rather than inferred 10/10');
  await page.locator('[data-race="player"] [data-action="inspect"][data-system="s0"]').click();assert.match(await page.locator('.beacon-inspector').innerText(),/— \/ 10 cycles/);assert.match(await page.locator('.beacon-inspector').innerText(),/not recorded/);check('Beacon inspection also preserves unknown legacy progress');await screenshot('beacon');await dom('beacon');assert.deepEqual(await snapshot(page),state);
});
await run('loss-empty',async({page,check,screenshot,dom})=>{
  const state=fixture('watch60');state.winner='choir';state.victoryType='Legacy';state.log=[];state.combatReports=[];state.lastBriefing=null;
  await importUI(page,state,'synthetic-loss-empty');await menuEnding(page);assert.match(await page.locator('.conclusion-heading').innerText(),/CAMPAIGN CONCLUDED/);assert.match(await page.locator('.conclusion-victor').innerText(),/Lumen Choir/);assert.match(await page.locator('.conclusion-empty').innerText(),/No moments/);assert.equal(await page.locator('.conclusion-moment').count(),0);await metrics(page,{colonies:5,population:43,ships:17,techs:11,score:698});check('Loss keeps canonical rival winner, own holdings and an explicitly empty retained history');await screenshot('ending');await dom('ending');assert.deepEqual(await snapshot(page),state);
});
await run('stale-history',async({page,check,screenshot,dom})=>{
  const state=fixture('watch60');state.combatReports=[];state.lastBriefing=null;
  await importUI(page,state,'synthetic-pruned-reports');await menuEnding(page);assert.equal(await page.locator('.conclusion-history [data-action="combat-report"]').count(),0);assert.match(await page.locator('.conclusion-history').innerText(),/Battle at Haven/);check('Pruned report references retain the historical text without dead report buttons');
  const world=page.locator('.conclusion-history [data-system-select]').first();await world.click();assert.equal(await page.locator('.modal').count(),0);assert.equal(await page.locator('#inspector .system-header h2').innerText(),'Haven');check('Safe system fallback still opens Haven');await menuEnding(page);await screenshot('ending');await dom('ending');assert.deepEqual(await snapshot(page),state);
});
await run('race-privacy',async({page,entry,check,screenshot,dom})=>{
  const state=fixture('watch51');await importUI(page,state,'actual-watch51');await page.locator('[data-page="empire"]').click();const before=await page.locator('.network-section').innerHTML();assert.equal(await page.locator('[data-race="player"] .race-heading strong').innerText(),'1 / 10');assert.equal(await page.locator('[data-race="choir"] .race-heading strong').innerText(),'1 / 10');assert.match(await page.locator('.race-tie-rule').innerText(),/higher Legacy wins/);assert.match(await page.locator('.race-tie-rule').innerText(),new RegExp(`Your Legacy: ${getEmpireStats(state).score}`));check('Actual tied race displays public progress, the qualification rule and only own Legacy');await page.locator('.network-section').scrollIntoViewIfNeeded();await screenshot('public');await dom('public');
  const changed=copy(state);entry.foreignScores=[];for(const faction of changed.factions.filter(f=>f.id!=='player')){const colony=changed.systems.find(s=>s.owner===faction.id);const scoreBefore=getEmpireStats(changed,faction.id).score;colony.population+=20;faction.credits+=100000;faction.minerals+=100000;entry.foreignScores.push({id:faction.id,before:scoreBefore,after:getEmpireStats(changed,faction.id).score});}
  await importUI(page,changed,'synthetic-private-scores');await page.locator('[data-page="empire"]').click();assert.equal(await page.locator('.network-section').innerHTML(),before);check('Changing every rival Legacy by 40 plus private treasuries leaves public-race HTML byte-identical');assert.deepEqual(await snapshot(page),changed);
});
await run('ordinary-ending',async({page,entry,check,screenshot,dom})=>{
  const state=fixture('watch56');state.factions.find(f=>f.id==='player').alignment.progress=9;const expected=copy(state);assert.equal(endTurn(expected).ok,true);assert.equal(expected.winner,'player');
  await importUI(page,state,'synthetic-near-finish');await page.locator('[data-action="end-turn"]').click();if(await page.locator('[data-action="end-turn-confirm"]').count())await page.locator('[data-action="end-turn-confirm"]').click();await page.locator('.campaign-conclusion').waitFor();assert.equal(await page.locator('#modal-title').innerText(),'Transcendence');assert.equal(await page.locator('.modal .close-modal').evaluate(el=>el===document.activeElement),true);assert.deepEqual(await snapshot(page),expected);entry.finalTurn=expected.turn;entry.finalRng=expected.rng;check('An ordinary end-cycle command opens the new ending and exactly matches the fixed engine result from an explicit near-finish fixture');await screenshot('ending');await dom('ending');await page.locator('[data-action="conclusion-galaxy"]').click();assert.equal(await page.locator('#end-turn').isDisabled(),true);assert.doesNotMatch(await page.locator('#mandate').innerText(),/fund 60/);check('The completed map disables another cycle and replaces the live funding mandate');
});
await run('fallback',async({page,check,screenshot,dom})=>{
  const state=fixture('watch60');await importUI(page,state,'actual-watch60-fallback');assert.match(await page.locator('.galaxy-fallback-notice').innerText(),/WebGL is unavailable/);await menuEnding(page);await metrics(page,{colonies:5,population:43,ships:17,techs:11,score:698});await screenshot('ending');await page.locator('[data-action="conclusion-galaxy"]').click();assert.equal(await page.locator('#galaxy-page').isVisible(),true);await screenshot('map');await dom('map');assert.deepEqual(await snapshot(page),state);check('Forced WebGL failure keeps the conclusion and tactical-chart return usable without page errors');
},{width:1280,height:900},true);
await browser.close();results.finished=new Date().toISOString();results.finalSourceHashes=sourceHashes();results.passed=results.cases.filter(c=>c.status==='pass').length;results.failed=results.cases.filter(c=>c.status==='fail').length;writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.passed,failed:results.failed}));process.exitCode=results.failed?1:0;
