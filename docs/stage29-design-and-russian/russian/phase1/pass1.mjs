import { chromium } from '/home/leg/projects/awesome_4x/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const out='/tmp/asterion-russian-independent';const root='/home/leg/projects/awesome_4x';
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
const results=[], errors=[];const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const [name,file] of [['initial',null],['default50','docs/default-campaign/actual/083-asterion-reach-cycle-50.json'],['finished60','docs/default-campaign/actual/109-asterion-reach-cycle-60.json']])for(const width of [1440,390]){
 const tag=`${name}-${width}`, record={tag,checks:[]};results.push(record);
 const state=file?JSON.parse(fs.readFileSync(root+'/'+file)):null;
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce',acceptDownloads:true});const page=await context.newPage();page.on('pageerror',e=>errors.push({tag,error:String(e)}));
 await page.addInitScript(s=>{if(s&&!localStorage.getItem('asterion-reach-save-v1'))localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s));},state);
 const snapshot=()=>page.evaluate(()=>window.__asterion.getState());
 async function capture(view){await page.waitForTimeout(20);fs.writeFileSync(`${out}/text/${tag}-${view}.txt`,await page.locator('body').innerText());await page.screenshot({path:`${out}/screens/${tag}-${view}.png`,fullPage:true});const data=await page.evaluate(()=>{
  const visible=e=>{const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&e.getClientRects().length;};
  const text=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())if(n.parentElement&&!n.parentElement.closest('script,style')&&visible(n.parentElement)&&/[a-z]{2}/i.test(n.textContent))text.push({text:n.textContent.trim(),element:n.parentElement.tagName,action:n.parentElement.closest('[data-action]')?.dataset.action});
  const attrs=[];for(const e of document.querySelectorAll('[aria-label],[title],[alt]'))if(visible(e))for(const a of ['aria-label','title','alt'])if(/[a-z]{2}/i.test(e.getAttribute(a)||''))attrs.push({attribute:a,text:e.getAttribute(a),tag:e.tagName,action:e.dataset.action});
  const m=document.querySelector('.modal');return {text,attrs,layout:{documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,modal:m?{width:m.clientWidth,scrollWidth:m.scrollWidth}:null}};
 });fs.writeFileSync(`${out}/text/${tag}-${view}-latin.json`,JSON.stringify(data,null,2));record.checks.push({capture:view,layout:data.layout});}
 async function toggle(){const before=await snapshot();const modal=page.locator('.modal');const inModal=await modal.count()>0;const b=page.locator(inModal?'.modal [data-action="language"]':'.topbar [data-action="language"]');const handle=await b.elementHandle();await b.focus();await page.keyboard.press('Enter');assert(await handle.evaluate(e=>e===document.activeElement&&e.isConnected));assert.deepEqual(await snapshot(),before);record.checks.push({toggle:true,dialogRetained:inModal?await modal.count()===1:null,focusRetained:true,stateSha:sha(JSON.stringify(before))});}
 try{
  record.startBuild=await (await page.request.get('http://127.0.0.1:5221/build-info.json')).json();
  await page.goto('http://127.0.0.1:5221');await page.waitForFunction(()=>window.__asterion);const first=await snapshot();record.initialStateSha=sha(JSON.stringify(first));
  await toggle();assert.equal(await page.locator('html').getAttribute('lang'),'ru');
  if(name==='initial'){await capture('welcome');await toggle();await toggle();await page.locator('[data-action="begin"]').click();}
  for(const view of ['galaxy','research','diplomacy','empire','journal']){if(view!=='galaxy')await page.locator(`[data-page="${view}"]`).click();await capture(view);}
  await page.locator('[data-page="galaxy"]').click();
  if(name==='default50'){await page.locator('[data-page="empire"]').click();await page.locator('[data-colony="s28"] [data-action="inspect"]').click();}
  if(name==='initial'||name==='default50'){
   await page.locator('[data-action="build-menu"]').click();
   if(name==='default50'){await page.locator('#replace-building').selectOption('mine');await page.locator('[data-investment="shipyard"] summary').click();}
   await capture('construction');const select=await page.locator('#replace-building').inputValue();const modalHandle=await page.locator('.modal').elementHandle();const openDetails=await page.locator('.modal details[open]').count();await toggle();await toggle();assert.equal(await page.locator('#replace-building').inputValue(),select);assert.equal(await page.locator('.modal details[open]').count(),openDetails);assert(await modalHandle.evaluate(e=>e.isConnected));record.checks.push({dialogSelectionPreserved:true,replacement:select,openDetails});
   await page.locator('[data-action="construction-tab"][data-tab="charter"]').click();await capture('charter');await toggle();await toggle();assert.equal(await page.locator('[data-tab="charter"]').getAttribute('aria-pressed'),'true');
   await page.locator('[data-action="construction-tab"][data-tab="ship"]').click();await capture('ships');await page.keyboard.press('Escape');
  }
  await page.locator('#briefing-button').isEnabled().then(async enabled=>{if(enabled){await page.locator('#briefing-button').click();await capture('briefing');await toggle();await toggle();await page.keyboard.press('Escape');}});
  if(name==='finished60'){
   await page.locator('#mandate [data-action="show-conclusion"]').click();await capture('conclusion');await toggle();await toggle();await page.keyboard.press('Escape');
   await page.locator('[data-page="journal"]').click();await page.locator('[data-log-filter="combat"]').click();await page.locator('[data-action="combat-report"]').first().click();await page.locator('.combat-exchanges summary').first().click();await capture('battle-rounds');const count=await page.locator('.combat-exchanges[open]').count();await toggle();await toggle();assert.equal(await page.locator('.combat-exchanges[open]').count(),count);await page.keyboard.press('Escape');
  }
  const beforeExport=await snapshot();await page.locator('[data-action="menu"]').click();await capture('menu');const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await downloadPromise;const savedPath=`${out}/saves/${tag}.json`;await download.saveAs(savedPath);assert.deepEqual(JSON.parse(fs.readFileSync(savedPath)),beforeExport);record.checks.push({exportExact:true});
  await page.locator('#import-save').setInputFiles(savedPath);await capture('import-confirmation');await toggle();await toggle();await page.locator('#confirm-import').click();assert.deepEqual(await snapshot(),beforeExport);record.checks.push({importExact:true,languageAfterImport:await page.locator('html').getAttribute('lang')});
  await page.reload();await page.waitForFunction(()=>window.__asterion);assert.equal(await page.locator('html').getAttribute('lang'),'ru');assert.deepEqual(await snapshot(),beforeExport);record.checks.push({reloadLanguagePersists:true,reloadStateExact:true});
  const docs=await context.newPage();await docs.goto('http://127.0.0.1:5221/guide.html');record.checks.push({docsEnglish:await docs.locator('html').getAttribute('lang'),docsTitle:await docs.title(),heading:await docs.locator('h1').innerText()});await docs.close();
  record.endBuild=await (await page.request.get('http://127.0.0.1:5221/build-info.json')).json();
 }catch(e){record.error=String(e);await page.screenshot({path:`${out}/screens/${tag}-ERROR.png`,fullPage:true});}
 await context.close();fs.writeFileSync(out+'/pass1-results.json',JSON.stringify(results,null,2));
}
fs.writeFileSync(out+'/pass1-browser-errors.json',JSON.stringify(errors,null,2));await browser.close();
