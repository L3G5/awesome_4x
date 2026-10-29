import {browser,load,read,write,capture,snapshot,assert} from './common.mjs';
import {validateSave,hasSensors} from './reviewed-sources/src/game.js';
const b=await browser(),base=read('inputs/controlled-base.json'),meta=read('inputs/controlled-provenance.json'),a=structuredClone(base),remote=a.systems.find(w=>w.id===meta.fastBuilder.id),foreign=a.factions.find(f=>f.id!=='player');
remote.owner=foreign.id;remote.exploredBy=remote.exploredBy.filter(id=>id!=='player');
remote.queue={kind:'starlane',itemId:'starlane',laneId:meta.laneId,progress:6,work:48,cost:{credits:60,minerals:70}};
const hiddenFleet=a.fleets.find(f=>f.owner===foreign.id);hiddenFleet.systemId=remote.id;
assert.equal(hasSensors(a,'player',remote.id),false);assert(validateSave(a));
const altered=structuredClone(a),other=altered.factions.find(f=>f.id===foreign.id),w=altered.systems.find(w=>w.id===remote.id),f=altered.fleets.find(f=>f.id===hiddenFleet.id);
Object.assign(other,{credits:1777,minerals:2333,science:211});w.queue.progress=43;w.population=6;w.buildings=['mine','factory'];f.systemId=other.capitalId;assert(validateSave(altered));
write('inputs/privacy-a.json',a);write('inputs/privacy-b.json',altered);
write('privacy-provenance.json',{synthetic:true,remote:remote.id,hasPlayerSensors:false,changes:'Foreign treasury, research reserve, unsurveyed endpoint population/infrastructure, private restoration progress6→43, and an unseen foreign fleet location differ. Public ownership, lane identity, charting and borders remain the same.'});
const results=[];
for(const width of [1440,390])for(const language of ['en','ru']){
 const r={width,language};results.push(r);let original;
 for(const [variant,state] of [['a',a],['b',altered]]){
  const {context,page,errors}=await load(b,state,width,language);
  try{
   await page.locator('[data-page="empire"]').click();await page.locator(`[data-colony-row="${meta.slowBuilder.id}"] [data-action="empire-build-menu"]`).click();await page.locator('[data-tab="starlane"]').click();
   const visible=await page.locator('.modal').evaluate(e=>({text:e.innerText,attrs:[...e.querySelectorAll('*')].map(n=>[n.tagName,...['title','aria-label','data-system','data-lane'].map(k=>n.getAttribute(k))]).filter(row=>row.slice(1).some(Boolean))}));
   if(variant==='a')original=visible;else assert.deepEqual(visible,original);
   assert.equal(await page.locator('.starlane-cost,#starlane-builder,[data-action="restore-lane"],.starlane-project [data-action="report-inspect"]').count(),0);
   assert.match(visible.text,language==='en'?/completion time is not known/:/завершения.*неизвест/);
   assert.deepEqual(await snapshot(page),state);assert.deepEqual(errors,[]);
   if(variant==='a'){await capture(page,`foreign-${language}-${width}`);r.foreignProject=visible;}
  }catch(e){r.error=String(e);await capture(page,`foreign-${language}-${width}-${variant}-ERROR`);}
  await context.close();
 }
 r.privateVariantsRenderIdentically=!r.error;write('privacy-results.json',results);
}
await b.close();
