import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getEmpireStats,endTurn,validateSave} from './reviewed-sources/src/game.js';
import {getAlignmentStatus} from './reviewed-sources/src/victory.js';
import {getAlignmentOutlook} from './reviewed-sources/src/alignment-outlook.js';
import {renderAlignmentCard} from './reviewed-sources/src/victory-ui.js';
import {renderWorkspaceInspector} from './reviewed-sources/src/workspace-ui.js';
import {SHIPS} from './reviewed-sources/src/content.js';
import {hasSensors} from './reviewed-sources/src/intelligence.js';
const require=createRequire(import.meta.url),{chromium}=require('/home/leg/projects/awesome_4x/node_modules/playwright');
const out='/tmp/asterion-stage21-funding-review',baseURL='http://127.0.0.1:5212';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x),own=s=>s.factions.find(x=>x.id==='player');
const checkpoint='/home/leg/projects/awesome_4x/docs/watch-playtest/checkpoints/cycle51.json';
const actual=JSON.parse(fs.readFileSync(checkpoint,'utf8'));
const completed=JSON.parse(fs.readFileSync('/home/leg/projects/awesome_4x/docs/watch-playtest/checkpoints/cycle60.json','utf8'));
const cases=[];function fixture(name,source,alter,notes){const state=clone(source);alter?.(state);assert.ok(validateSave(state),name);fs.writeFileSync(`${out}/fixtures/${name}.json`,JSON.stringify(state,null,2)+'\n');const item={name,state,notes};cases.push(item);return item;}
const original=fixture('actual-watch51',actual,null,'Actual unmodified UI checkpoint; inspection only.');
const affordable=fixture('synthetic-credit50',actual,s=>own(s).credits=50,'Synthetic: only own credits change from954 to50.');
const negative=fixture('synthetic-upkeep-deficit',actual,s=>{own(s).credits=70;for(let i=0;i<2;i++)s.fleets.push({id:`f${s.nextFleetId++}`,name:`Synthetic upkeep cruiser ${i+1}`,owner:'player',systemId:'s0',type:'cruiser',ships:12,hp:SHIPS.cruiser.hp*12,movesLeft:1});},'Synthetic: own credits70 and two additional12-cruiser formations; existing+75 ordinary income becomes−21.');
const depleted=fixture('synthetic-clamped-deficit',negative.state,s=>own(s).credits=5,'Synthetic upkeep fixture with own credits5; after-income budget clamps tozero.');
const blocked=fixture('synthetic-covered-blockade',affordable.state,s=>{own(s).relations.veyr.status='war';s.factions.find(x=>x.id==='veyr').relations.player.status='war';s.fleets.push({id:`f${s.nextFleetId++}`,name:'Synthetic visible blocker',owner:'veyr',systemId:'s0',type:'frigate',ships:1,hp:SHIPS.frigate.hp,movesLeft:0});},'Synthetic affordable fixture with one visible hostile Veyr frigate overSolace and mutualwar.');
const protocol=fixture('synthetic-missing-protocol',affordable.state,s=>own(s).techs=own(s).techs.filter(x=>x!=='singularity'),'Synthetic affordable fixture with Protocol removed.');
const twoSites=fixture('synthetic-two-sites',affordable.state,s=>{const site=s.systems.find(x=>x.owner==='player'&&x.buildings.includes('beacon')&&x.id!=='s0');site.buildings=site.buildings.filter(x=>x!=='beacon');},'Synthetic affordable fixture with one beacon removed.');
const expiry=fixture('synthetic-treaty-expiry',affordable.state,s=>{own(s).relations.choir.tradeEndsAt=s.turn+1;s.factions.find(x=>x.id==='choir').relations.player.tradeEndsAt=s.turn+1;},'Synthetic affordable fixture with already-noticed mutualChoir treaty expiry on52. Current estimate65; actual next-cycle treasury55.');
const hidden=fixture('synthetic-private-rivals',affordable.state,s=>{for(const f of s.factions.filter(x=>x.id!=='player')){f.credits=77777;f.minerals=88888;f.science=99999;}for(const f of s.fleets.filter(x=>x.owner!=='player'&&!hasSensors(s,'player',x.systemId))){f.type='cruiser';f.ships=12;f.hp=SHIPS.cruiser.hp*12;delete f.defenseLead;}for(const w of s.systems.filter(x=>x.owner&&x.owner!=='player'&&!hasSensors(s,'player',x.id))){w.queue=null;w.population+=4;}},'Synthetic affordable fixture changes only remote private rival economies, remote fleets and queues; public signals unchanged.');
const finished=fixture('actual-watch60-finished',completed,null,'Actual unmodified completed UI checkpoint.');
const legacy=fixture('synthetic-finished-legacy',completed,s=>{for(const f of s.factions)delete f.alignment;delete s.alignmentUpdatedTurn;},'Synthetic completed checkpoint with optional legacy alignment records removed; saved result retained.');
const result={reviewer:'Independent funding implementation review; no implementation authorship.',provenance:{checkpoint,checkpointSHA256:hash(fs.readFileSync(checkpoint,'utf8')),baselineURL:baseURL},core:[],browser:[],errors:[]};
const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;};
for(const item of cases){const state=clone(item.state),untouched=clone(state),start=hash(state);const outlook=getAlignmentOutlook(freeze(clone(state)));assert.deepEqual(getAlignmentOutlook(state),outlook);const card=renderAlignmentCard(state),context=renderWorkspaceInspector(state,'empire');assert.deepEqual(state,untouched);let continuation=null;if(!state.winner){for(let i=0;i<3;i++)getAlignmentOutlook(state);const first=endTurn(state),second=endTurn(untouched);assert.deepEqual(first,second);assert.deepEqual(state,untouched);assert.ok(validateSave(state));continuation={turn:state.turn,credits:own(state).credits,progress:own(state).alignment.progress,stateHash:hash(state),resultHash:hash(first)};}else{assert.equal(outlook,null);assert.ok(!card.includes('Funding at current income'));assert.ok(!context.includes('credits per advancing cycle'));}result.core.push({name:item.name,notes:item.notes,inputHash:start,outlook,instantaneous:getAlignmentStatus(item.state),unchanged:true,continuation,cardHash:hash(card),contextHash:hash(context)});}
const get=n=>result.core.find(x=>x.name===n);
assert.equal(get('synthetic-credit50').outlook.creditsAfterAlignment,65);assert.equal(get('synthetic-credit50').continuation.credits,65);assert.equal(get('synthetic-credit50').continuation.progress,2);
assert.equal(get('synthetic-upkeep-deficit').instantaneous.ready,true);assert.equal(get('synthetic-upkeep-deficit').outlook.creditIncome,-21);assert.equal(get('synthetic-upkeep-deficit').outlook.shortfall,11);assert.equal(get('synthetic-upkeep-deficit').continuation.credits,49);assert.equal(get('synthetic-upkeep-deficit').continuation.progress,0);
assert.equal(get('synthetic-clamped-deficit').outlook.creditsAfterIncome,0);
for(const name of ['synthetic-covered-blockade','synthetic-missing-protocol','synthetic-two-sites']){assert.equal(get(name).outlook.fundingCovered,true);assert.equal(get(name).outlook.networkReady,false);assert.equal(get(name).outlook.creditsAfterAlignment,null);}
assert.equal(get('synthetic-treaty-expiry').outlook.creditsAfterAlignment,65);assert.equal(get('synthetic-treaty-expiry').continuation.credits,55);
assert.deepEqual(get('synthetic-private-rivals').outlook,get('synthetic-credit50').outlook);assert.equal(get('synthetic-private-rivals').cardHash,get('synthetic-credit50').cardHash);assert.equal(get('synthetic-private-rivals').contextHash,get('synthetic-credit50').contextHash);
fs.writeFileSync(`${out}/core-results.json`,JSON.stringify(result,null,2)+'\n');
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
async function inspect(item,width,{turn=false,navigation=false}={}){
 const height=width===390?844:960;const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[],badResponses=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
 await page.goto(baseURL);await page.locator('[data-action="begin"]').click();await page.locator('#import-save').setInputFiles(`${out}/fixtures/${item.name}.json`);await page.locator('#confirm-import').click();if(await page.locator('.close-modal').isVisible())await page.locator('.close-modal').click();await page.evaluate(()=>document.fonts.ready);await page.mouse.move(3,3);await page.waitForTimeout(250);
 const start=await page.evaluate(()=>window.__asterion.getState());assert.deepEqual(start,item.state,`${item.name}: import preserves parsed state`);const mandate=await page.locator('#mandate').innerText();const creditTitle=await page.locator('.resource.credits').getAttribute('title');const scopeVisible=await page.locator('.credit-income-scope').isVisible();
 const prefix=`${item.name}-${width}`;await page.screenshot({path:`${out}/screens/${prefix}-galaxy.png`,fullPage:width===390});
 let navigationView=null;if(navigation){await page.locator('#mandate [data-action="review-network"]').click();navigationView=await page.evaluate(()=>{const a=document.querySelector('.alignment-outlook')?.getBoundingClientRect(),n=document.querySelector('.network-section')?.getBoundingClientRect(),w=document.querySelector('#workspace-page').getBoundingClientRect();return{fundingBounds:a?.toJSON(),networkBounds:n?.toJSON(),workspaceBounds:w.toJSON(),scrollTop:document.querySelector('#workspace-page').scrollTop};});await page.screenshot({path:`${out}/screens/${prefix}-review-network-landing.png`});}
 await page.locator('[data-page="empire"]').click();await page.locator('#workspace-page').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(180);const card=await page.locator('.alignment-card').innerText(),sidebar=await page.locator('#inspector').innerText();const budget=await page.locator('[data-budget]').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.dataset.budget,e.textContent])));const fundingCount=await page.locator('.alignment-outlook').count();const fonts=await page.evaluate(()=>({dmSans:document.fonts.check('12px "DM Sans Variable"'),marcellus:document.fonts.check('16px "Marcellus"'),creditFont:getComputedStyle(document.querySelector('.resource')).fontFamily,headingFont:getComputedStyle(document.querySelector('.alignment-title h3')).fontFamily}));
 await page.screenshot({path:`${out}/screens/${prefix}-empire-top.png`,fullPage:width===390});
 await page.locator('.alignment-card').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(120);await page.screenshot({path:`${out}/screens/${prefix}-funding-top.png`,fullPage:width===390});
 if(fundingCount){await page.locator('.alignment-budget-assumption').evaluate(e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:`${out}/screens/${prefix}-funding-bottom.png`,fullPage:width===390});}
 const layout=await page.evaluate(()=>{const selectors=['.topbar','.resources','.resource.credits','.alignment-card','.alignment-outlook','.alignment-budget','.alignment-budget-assumption','#inspector','#workspace-page'];return{viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},elements:Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);return[s,e?{bounds:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,fontSize:getComputedStyle(e).fontSize}:null];}))};});
 assert.equal(layout.document.scrollWidth,layout.document.clientWidth,`${prefix}: document overflow`);for(const s of ['.topbar','.resources','.resource.credits','.alignment-card','.alignment-outlook','.alignment-budget']){const e=layout.elements[s];if(e)assert.ok(e.scrollWidth<=e.clientWidth+1,`${prefix}: ${s} overflow`);}
 const inspected=await page.evaluate(()=>window.__asterion.getState());assert.deepEqual(inspected,start,`${prefix}: rendering changes state`);
 if(item.state.winner){assert.equal(fundingCount,0);assert.equal(scopeVisible,false);assert.ok(!sidebar.includes('credits per advancing cycle'));if(item.name.includes('legacy'))assert.ok(card.includes('—'));}else{assert.equal(fundingCount,1);assert.equal(budget.income,get(item.name).outlook.creditIncome>=0?`+${get(item.name).outlook.creditIncome}`:`−${-get(item.name).outlook.creditIncome}`);assert.ok(card.includes('Estimate holds current income and network conditions fixed.'));assert.ok(card.includes('treaty changes'));assert.equal(scopeVisible,width>900);}
 let actualTurn=null;if(turn){const expected=clone(start),expectedResult=endTurn(expected);await page.locator('#end-turn').click();if(await page.locator('[data-action="end-turn-confirm"]').isVisible())await page.locator('[data-action="end-turn-confirm"]').click();await page.waitForTimeout(150);const after=await page.evaluate(()=>window.__asterion.getState());assert.deepEqual(after,expected,`${prefix}: browser ordinary turn differs`);actualTurn={stateHash:hash(after),resultHash:hash(expectedResult),turn:after.turn,credits:own(after).credits,progress:own(after).alignment.progress};await page.screenshot({path:`${out}/screens/${prefix}-after-turn.png`,fullPage:width===390});}
 const row={name:item.name,width,height,notes:item.notes,creditTitle,scopeVisible,mandate,card,sidebar,budget,fonts,layout,navigationView,inputHash:hash(start),inspectedHash:hash(inspected),unchanged:hash(start)===hash(inspected),actualTurn,errors,badResponses};fs.writeFileSync(`${out}/text/${prefix}.json`,JSON.stringify(row,null,2)+'\n');await fs.promises.writeFile(`${out}/text/${prefix}.html`,await page.content());result.browser.push(row);result.errors.push(...errors,...badResponses);await context.close();console.log(`${prefix}: verified${actualTurn?' with exact ordinary turn':''}`);
}
try{
 await inspect(affordable,1280,{turn:true,navigation:true});
 await inspect(negative,1280,{turn:true});
 await inspect(blocked,1280);
 await inspect(expiry,1280,{turn:true});
 await inspect(hidden,1280);
 await inspect(finished,1280);
 await inspect(legacy,1280);
 await inspect(affordable,390,{turn:true});
 await inspect(negative,390);
 await inspect(blocked,390);
 await inspect(legacy,390);
 const before=result.browser.find(x=>x.name==='synthetic-credit50'&&x.width===1280),privateCase=result.browser.find(x=>x.name==='synthetic-private-rivals');for(const key of ['creditTitle','mandate','card','sidebar','budget'])assert.deepEqual(before[key],privateCase[key],`private invariance ${key}`);
 assert.deepEqual(result.errors,[]);result.pass=true;
}catch(error){result.pass=false;result.failure={message:error.message,stack:error.stack};console.error(error);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(`${out}/results.json`,JSON.stringify(result,null,2)+'\n');}
