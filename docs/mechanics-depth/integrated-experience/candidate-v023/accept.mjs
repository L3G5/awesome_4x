import {browser,load,read,write,capture,snapshot,assert,selectedFleet,toggleTwice,pin} from './common.mjs';
import {command} from './reviewed-sources/src/game.js';
await pin('build-before.json');
const b=await browser(),fixture=read('inputs/controlled-base.json'),meta=read('inputs/controlled-provenance.json'),results=[];
for(const width of [1440,390])for(const language of ['en','ru']){
 const tag=`accept-${language}-${width}`,state=structuredClone(fixture),{context,page,errors}=await load(b,state,width,language),r={tag};results.push(r);
 try{
  const scout=await selectedFleet(page);
  await page.locator('[data-page="empire"]').click();
  await page.locator(`[data-colony-row="${meta.slowBuilder.id}"] [data-action="inspect"]`).click();
  await page.locator('.starlane-inspector [data-action="starlane-menu"]').first().click();
  r.initial=await capture(page,`${tag}-initial`);
  assert.equal(r.initial.focus.action,'close-modal');
  assert(r.initial.modal.title.y>=r.initial.modal.rect.y);
  assert.equal(r.initial.documentWidth,width);
  r.slowQuote=await page.locator('.starlane-cost').innerText();
  assert.match(r.slowQuote,/48/);assert.match(r.slowQuote,/7/);
  await page.locator('#starlane-builder').selectOption(meta.fastBuilder.id);
  r.fastQuote=await page.locator('.starlane-cost').innerText();assert.match(r.fastQuote,/2/);
  await toggleTwice(page,state);
  await page.locator('.starlane-rules summary').click();
  r.rules=await page.locator('.starlane-rules').innerText();
  await capture(page,`${tag}-rules`);
  await page.locator('[data-action="restore-lane"]').focus();await page.keyboard.press('Enter');
  assert(command(state,{type:'restoreLane',systemId:meta.fastBuilder.id,laneId:meta.laneId}).ok);
  assert.deepEqual(await snapshot(page),state);assert.equal(await selectedFleet(page),scout);
  r.afterDirectAlternate=await page.evaluate(()=>({focusTag:document.activeElement.tagName,focusClass:document.activeElement.className,heading:document.querySelector('#inspector h2')?.textContent,project:document.querySelector('#inspector .production-row')?.innerText}));
  await capture(page,`${tag}-direct-alternate-committed`);
  await page.locator('[data-page="empire"]').click();
  await page.locator(`[data-colony-row="${meta.slowBuilder.id}"] [data-action="empire-build-menu"]`).click();
  await page.locator('[data-tab="starlane"]').click();
  r.underway=await page.locator('.starlane-project').innerText();
  assert.equal(await page.locator('.starlane-cost,#starlane-builder,[data-action="restore-lane"]').count(),0);
  assert.match(r.underway,/Eos/);assert.match(r.underway,/2/);
  await capture(page,`${tag}-underway`);
  await toggleTwice(page,state);
  await page.locator('.starlane-project [data-action="report-inspect"]').click();
  r.inspectConstruction=await page.locator('#inspector h2').innerText();assert.equal(r.inspectConstruction,'Eos');
  assert.deepEqual(await snapshot(page),state);
  r.knownFixesPass=true;
 }catch(e){r.error=String(e);await capture(page,`${tag}-ERROR`);}
 r.pageErrors=errors;await context.close();write('accept-results.json',results);
}
await pin('build-after.json');await b.close();
