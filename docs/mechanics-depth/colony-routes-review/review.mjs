import {browser,load,read,write,capture,snapshot,assert,selectedFleet,toggleTwice,pin} from './common.mjs';
await pin('build-before.json');const b=await browser(),actual=read('inputs/actual-cycle13.json'),controlled=read('inputs/controlled-base.json'),meta=read('inputs/controlled-provenance.json'),results=[];
async function rows(page){return page.locator('.starlane-colony-routes').evaluate(e=>({heading:e.querySelector('h4').innerText,caption:e.querySelector('.starlane-route-caption').innerText,primary:[...e.children].filter(c=>c.classList.contains('starlane-colony-route')).map(c=>({id:c.dataset.routeColony,text:c.innerText})),details:e.querySelector('details')?{open:e.querySelector('details').open,rows:e.querySelectorAll('details [data-route-colony]').length}:null,height:e.getBoundingClientRect().height,all:[...e.querySelectorAll('[data-route-colony]')].map(c=>({id:c.dataset.routeColony,text:c.innerText}))}));}
for(const width of [1440,390])for(const language of ['en','ru']){
 const tag=`actual-${language}-${width}`,{context,page,errors}=await load(b,actual,width,language),r={tag,actualSave:true};results.push(r);
 try{
  const fleet=await selectedFleet(page);await page.locator('[data-page="empire"]').click();await page.locator('[data-colony-row="s41"] [data-action="inspect"]').click();await page.locator('.starlane-inspector [data-action="starlane-menu"]').click();
  assert(await page.locator('[data-action="restore-lane"]').isDisabled());r.cost=await page.locator('.starlane-cost').innerText();assert.match(r.cost,/60/);assert.match(r.cost,/70/);assert.match(r.cost,/10/);r.routes=await rows(page);
  const solace=r.routes.primary.find(x=>x.id==='s0'),antares=r.routes.primary.find(x=>x.id==='s34');assert(solace&&antares);assert.match(solace.text,/3\s*→\s*3/);assert.match(solace.text,language==='en'?/Unchanged/:/Без изменений/);assert.match(antares.text,/4\s*→\s*2/);assert.equal(r.routes.details,null);assert.equal(r.routes.all.length,2);
  await page.locator('.starlane-colony-routes').scrollIntoViewIfNeeded();r.metrics=await capture(page,`${tag}-routes`);assert.equal(r.metrics.documentWidth,width);
  r.shared=await page.locator('.starlane-shared').innerText();assert.match(r.shared,language==='en'?/including hostile fleets during war/:/вражеские флоты/);
  if(width===390){await page.locator('.starlane-shared').scrollIntoViewIfNeeded();await capture(page,`${tag}-shared-warning`);}
  await toggleTwice(page,actual);assert.deepEqual(await snapshot(page),actual);assert.equal(await selectedFleet(page),fleet);await page.keyboard.press('Escape');assert.deepEqual(await snapshot(page),actual);r.pendingLabUnchanged=structuredClone((await snapshot(page)).systems.find(s=>s.id==='s41').queue);r.pass=true;
 }catch(e){r.error=String(e);await capture(page,`${tag}-ERROR`);}
 r.pageErrors=errors;await context.close();write('results.json',results);
}
for(const width of [1440,390])for(const language of ['en','ru']){
 const tag=`controlled-${language}-${width}`,{context,page,errors}=await load(b,controlled,width,language),r={tag,synthetic:true};results.push(r);
 try{
  const fleet=await selectedFleet(page);await page.locator('[data-page="empire"]').click();await page.locator(`[data-colony-row="${meta.slowBuilder.id}"] [data-action="empire-build-menu"]`).click();await page.locator('[data-tab="starlane"]').click();r.before=await rows(page);r.beforeCost=await page.locator('.starlane-cost').innerText();assert(r.before.primary.length<=3);assert.equal(r.before.primary[0].id,'s0');assert(r.before.details&&!r.before.details.open&&r.before.details.rows>0);assert.equal(r.before.all.length,controlled.systems.filter(s=>s.owner==='player').length-1);
  await page.locator('.starlane-colony-routes').scrollIntoViewIfNeeded();await capture(page,`${tag}-collapsed`);await page.locator('.starlane-colony-routes summary').click();r.expanded=await rows(page);assert(r.expanded.details.open);await capture(page,`${tag}-expanded`);
  await page.locator('#starlane-builder').selectOption(meta.fastBuilder.id);r.after=await rows(page);r.afterCost=await page.locator('.starlane-cost').innerText();assert.match(r.beforeCost,/7/);assert.match(r.afterCost,/2/);assert.match(r.after.heading,/Eos/);assert(r.after.all.some(row=>row.id===meta.slowBuilder.id));assert(!r.after.all.some(row=>row.id===meta.fastBuilder.id));assert.equal(r.after.primary[0].id,'s0');assert(r.after.primary.length<=3);assert.match(r.afterCost,/60/);assert.match(r.afterCost,/70/);
  await page.locator('.starlane-colony-routes').scrollIntoViewIfNeeded();r.metrics=await capture(page,`${tag}-switched`);assert.equal(r.metrics.documentWidth,width);r.shared=await page.locator('.starlane-shared').innerText();assert.match(r.shared,language==='en'?/including hostile fleets during war/:/вражеские флоты/);await page.locator('.starlane-shared').scrollIntoViewIfNeeded();assert(await page.locator('.starlane-shared').isVisible());assert.equal(await page.locator('.starlane-shared').evaluate(e=>e.closest('details')===null),true);
  await toggleTwice(page,controlled);assert.deepEqual(await snapshot(page),controlled);assert.equal(await selectedFleet(page),fleet);r.pass=true;
 }catch(e){r.error=String(e);await capture(page,`${tag}-ERROR`);}
 r.pageErrors=errors;await context.close();write('results.json',results);
}
await pin('build-after.json');await b.close();
