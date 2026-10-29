import {browser,load,read,write,capture,snapshot,assert,selectedFleet,position,toggleTwice,pin,fs,out} from './common.mjs';
import {command} from './reviewed-sources/src/game.js';
await pin('build-before.json');const b=await browser(),fixture=read('inputs/controlled-base.json'),meta=read('inputs/controlled-provenance.json'),results=[];
async function exportReload(page,state,tag){await page.locator('[data-action="menu"]').click();const dp=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const d=await dp,p=new URL(`exports/${tag}.json`,out).pathname;await d.saveAs(p);assert.deepEqual(JSON.parse(fs.readFileSync(p)),state);await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>window.__asterion);assert.deepEqual(await snapshot(page),state);}
for(const width of [1440,390])for(const language of ['en','ru']){
 const tag=`direct-${language}-${width}`,state=structuredClone(fixture),{context,page,errors}=await load(b,state,width,language),r={tag,synthetic:true};results.push(r);
 try{
  const fleet=await selectedFleet(page),scout=structuredClone(state.fleets.find(f=>f.id===meta.scoutId));
  await page.locator('[data-page="empire"]').click();await page.locator(`[data-colony-row="${meta.slowBuilder.id}"] [data-action="inspect"]`).click();await page.locator('.starlane-inspector [data-action="starlane-menu"]').first().click();
  r.initial=await capture(page,`${tag}-initial`);assert.equal(r.initial.focus.action,'close-modal');assert(r.initial.modal.title.y>=r.initial.modal.rect.y);assert.equal(r.initial.documentWidth,width);
  await page.locator('#starlane-builder').selectOption(meta.fastBuilder.id);await toggleTwice(page,state);
  await page.locator('[data-action="restore-lane"]').focus();await page.keyboard.press('Enter');
  assert(command(state,{type:'restoreLane',systemId:meta.fastBuilder.id,laneId:meta.laneId}).ok);assert.deepEqual(await snapshot(page),state);assert.equal(await selectedFleet(page),fleet);assert.deepEqual((await snapshot(page)).fleets.find(f=>f.id===meta.scoutId),scout);
  r.result=await page.evaluate(()=>({focusTag:document.activeElement.tagName,focusClass:document.activeElement.className,heading:document.querySelector('#inspector h2')?.textContent,project:document.querySelector('#inspector .production-row')?.innerText}));
  assert.equal(r.result.heading,'Eos');assert.match(r.result.focusClass,/production-row/);assert(r.result.project);assert.equal(await page.evaluate(()=>window.__asterion.getPage()),'galaxy');
  await capture(page,`${tag}-committed`);r.exactPaidEffectFleetIntentAndResultFocus=true;
  await exportReload(page,state,tag);r.exportReloadExact=true;
 }catch(e){r.error=String(e);await capture(page,`${tag}-ERROR`);}
 r.pageErrors=errors;await context.close();write('results.json',results);
}
for(const width of [1440,390])for(const language of ['en','ru']){
 const tag=`empire-${language}-${width}`,state=JSON.parse(fs.readFileSync('/home/leg/projects/awesome_4x/docs/default-campaign/actual/083-asterion-reach-cycle-50.json')),{context,page,errors}=await load(b,state,width,language),r={tag,actualSave:true};results.push(r);
 try{
  await page.locator('[data-page="empire"]').click();await page.locator('[data-action="colony-sort"][data-sort="science"]').click();
  const opener=page.locator('[data-colony-row="s28"] [data-action="empire-build-menu"]');await opener.scrollIntoViewIfNeeded();await page.locator('.colony-scroll').evaluate(e=>e.scrollLeft=180);await opener.focus();const pos=await position(page),fleet=await selectedFleet(page);r.origin=pos;
  await page.keyboard.press('Enter');await page.locator('#replace-building').selectOption('mine');await page.locator('[data-investment="shipyard"] summary').click();await toggleTwice(page,state);await page.keyboard.press('Escape');assert.deepEqual(await snapshot(page),state);assert(await opener.evaluate(e=>e===document.activeElement));assert.deepEqual(await position(page),pos);r.cancelExactStateFocusScroll=true;
  await opener.focus();await page.keyboard.press('Enter');await page.locator('#replace-building').selectOption('mine');await page.locator('[data-action="build"][data-item="shipyard"]').focus();await page.keyboard.press('Enter');
  assert(command(state,{type:'build',systemId:'s28',itemId:'shipyard',replaceBuildingId:'mine'}).ok);assert.deepEqual(await snapshot(page),state);assert.equal(await selectedFleet(page),fleet);assert.equal(await page.evaluate(()=>window.__asterion.getPage()),'empire');assert.equal(await page.evaluate(()=>document.activeElement.dataset.colonyRow),'s28');
  await capture(page,`${tag}-committed`);r.afterPaint=await position(page);assert.deepEqual(r.afterPaint,pos);r.exactPaidEffectRowFleetAndScroll=true;
  await exportReload(page,state,tag);r.exportReloadExact=true;
 }catch(e){r.error=String(e);await capture(page,`${tag}-ERROR`);}
 r.pageErrors=errors;await context.close();write('results.json',results);
}
await pin('build-after.json');await b.close();
