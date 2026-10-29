import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
import * as game from './reviewed-sources/src/game.js';
import * as baseline from '/home/leg/projects/awesome_4x/src/game.js';
const out='/tmp/asterion-stage21-invasion-review';
const original=JSON.parse(fs.readFileSync(`${out}/fixtures/original-synthetic-lethal.json`));
const hash=x=>createHash('sha256').update(x).digest('hex');
const sourcePin={reviewedAt:new Date().toISOString(),coreCommit:'1912ab1e76c031f2d1c3504a79440923e98ff780',baseUrl:'http://127.0.0.1:5212',originalFixtureHash:hash(fs.readFileSync(`${out}/fixtures/original-synthetic-lethal.json`)),sourceHashes:{},productionHashes:{}};
for(const file of fs.readdirSync(`${out}/reviewed-sources/src`))sourcePin.sourceHashes[`src/${file}`]=hash(fs.readFileSync(`${out}/reviewed-sources/src/${file}`));
for(const file of ['index.html','build-info.json',...fs.readdirSync('/tmp/asterion-stage21-initial-tk6jnoho/assets').filter(f=>/\.(js|css)$/.test(f)).map(f=>`assets/${f}`)]) {
 const local=fs.readFileSync(`/tmp/asterion-stage21-initial-tk6jnoho/${file}`),response=await fetch(`http://127.0.0.1:5212/${file}`);assert.equal(response.status,200);
 const remote=Buffer.from(await response.arrayBuffer());assert.equal(hash(local),hash(remote));sourcePin.productionHashes[file]=hash(local);
}
function fixture({hp=3,defense=8,shield=false,rng=null}={}) {
 const state=structuredClone(original),fleet=state.fleets.find(f=>f.id==='f3'),world=state.systems.find(w=>w.id==='s1');
 fleet.hp=hp;world.defenseDamage=39-defense;if(shield)state.factions[0].techs.push('shields');if(rng!==null)state.rng=rng;
 assert.ok(game.validateSave(state));return state;
}
const cases=[
 {id:'original-lethal',opts:{},expect:'lethal',width:1440},
 {id:'rounded-lethal',opts:{hp:4.04},expect:'lethal',width:1440},
 {id:'surviving-bombardment',opts:{hp:34,defense:20},expect:'bombardment',width:1440},
 {id:'possible-noncapture',opts:{hp:34,defense:12,rng:0},expect:'possible',width:1440},
 {id:'possible-capture',opts:{hp:34,defense:12,rng:2147483648},expect:'possible',width:1440},
 {id:'guaranteed-capture',opts:{hp:34},expect:'guaranteed',width:1440},
 {id:'shield-rounded-lethal',opts:{hp:3.24,shield:true},expect:'lethal',width:1440},
 {id:'fractional-survivor',opts:{hp:4.06},expect:'guaranteed',width:1440},
 {id:'narrow-original-lethal',opts:{},expect:'lethal',width:390},
];
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
const results=[];
for(const spec of cases) {
 const state=fixture(spec.opts),unchanged=structuredClone(state),preview=game.estimateInvasion(state,'f3'),old=baseline.estimateInvasion(state,'f3');
 assert.deepEqual(state,unchanged);assert.deepEqual((({hullAfter,...p})=>p)(preview),old);
 const expected=structuredClone(state),oldAfter=structuredClone(state),answer=game.command(expected,{type:'attack',fleetId:'f3'}),oldAnswer=baseline.command(oldAfter,{type:'attack',fleetId:'f3'});
 assert.deepEqual(answer,oldAnswer);assert.deepEqual(expected,oldAfter);assert.ok(answer.ok);assert.ok(game.validateSave(expected));
 assert.equal(preview.hullAfter,expected.fleets.find(f=>f.id==='f3')?.hp??0);
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(game.command(restored,{type:'attack',fleetId:'f3'}),answer);assert.deepEqual(restored,expected);
 const context=await browser.newContext({viewport:{width:spec.width,height:spec.width===390?844:960},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>{localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s));localStorage.setItem('asterion-reach-settings-v1',JSON.stringify({warnUnspent:false}));},state);
 await page.goto('http://127.0.0.1:5212/');if(spec.width<900){await page.locator('#fleet-bar [data-action="fleet-roster"]').click();await page.locator('.modal [data-fleet="f3"]').click();}else await page.locator('#fleet-bar [data-fleet="f3"]').click();await page.locator('.invasion-preview').scrollIntoViewIfNeeded();
 const text=await page.locator('.invasion-preview').innerText(),warning=await page.locator('.invasion-survival').innerText();
 const expectedCopy={lethal:'Retaliation will destroy this formation; it cannot capture the colony.',bombardment:'Further bombardment is required.',possible:'This volley may capture the colony.',guaranteed:'Capture expected with this volley.'}[spec.expect];
 assert.equal(warning,expectedCopy);assert.ok(text.includes(`Hull after retaliation: ${preview.hullAfter}`));assert.equal(await page.locator('.invasion-survival.lethal').count(),Number(spec.expect==='lethal'));
 assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),state);
 const layout=await page.locator('.invasion-preview').evaluate(el=>{const r=el.getBoundingClientRect(),w=el.querySelector('.invasion-survival'),wr=w.getBoundingClientRect(),css=getComputedStyle(w);return {documentOverflow:document.documentElement.scrollWidth>innerWidth,previewOverflow:el.scrollWidth>el.clientWidth,warningOverflow:w.scrollWidth>w.clientWidth,warningVisible:wr.top>=0&&wr.bottom<=innerHeight&&wr.left>=0&&wr.right<=innerWidth,fontSize:css.fontSize,lineHeight:css.lineHeight,color:css.color,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};});
 assert.equal(layout.documentOverflow,false);assert.equal(layout.previewOverflow,false);assert.equal(layout.warningOverflow,false);assert.equal(layout.warningVisible,true);
 await page.screenshot({path:`${out}/screens/${spec.id}-before.png`});
 await page.locator('#fleet-bar [data-action="attack"]').click();
 assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),expected);
 if(spec.id==='original-lethal'||spec.id==='narrow-original-lethal')await page.screenshot({path:`${out}/screens/${spec.id}-after.png`});
 assert.deepEqual(errors,[]);
 results.push({id:spec.id,kind:'controlled synthetic fixture',viewport:spec.width,preview,warning,layout,commandOutcome:answer.combatReports[0].outcome,captured:answer.combatReports[0].invasion.captured,exactOldEngineEquality:true,exactReloadEquality:true,exactBrowserCommandEquality:true,inspectionPure:true,errors});
 fs.writeFileSync(`${out}/fixtures/${spec.id}.json`,JSON.stringify(state,null,2));
 fs.writeFileSync(`${out}/case-progress.json`,JSON.stringify(results,null,2));
 await context.close();
}
await browser.close();
const privacy=[];
{
 const state=fixture({hp:34}),expected=game.estimateInvasion(state,'f3'),changed=structuredClone(state);
 for(const f of changed.factions.filter(f=>f.id!=='player')){f.credits=99999;f.minerals=99999;f.science=99999;f.techs=['weapons','shields'];}
 for(const f of changed.fleets.filter(f=>f.owner!=='player')){f.type='cruiser';f.hp=1020;f.ships=12;f.systemId='s20';}
 for(const w of changed.systems.filter(w=>w.owner!=='player'&&w.id!=='s1')){w.population=12;w.buildings=['bastion'];w.defenseDamage=0;}
 assert.deepEqual(game.estimateInvasion(changed,'f3'),expected);privacy.push('Unrelated hidden fleets, treasuries, technologies and colonies do not change preview.');
 const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 assert.deepEqual(game.estimateInvasion(freeze(state),'f3'),expected);privacy.push('Deep-frozen input remains readable and pure.');
 const remote=fixture({hp:34});remote.fleets.find(f=>f.id==='f3').systemId='s0';assert.equal(game.estimateInvasion(remote,'f3'),null);privacy.push('Moving the own fleet out of hostile orbit removes the invasion preview.');
 const blocked=fixture({hp:34});blocked.fleets.push({id:`f${blocked.nextFleetId++}`,name:'Visible enemy',owner:'veyr',type:'frigate',ships:1,hp:34,movesLeft:1,systemId:'s1'});assert.equal(game.estimateInvasion(blocked,'f3'),null);privacy.push('Visible orbital enemy prevents an invasion preview.');
}
fs.writeFileSync(`${out}/source-pins.json`,JSON.stringify(sourcePin,null,2));
fs.writeFileSync(`${out}/results.json`,JSON.stringify({passed:results.length,cases:results,privacy,priorFailureEvidence:'/tmp/asterion-final-strategy-review',limits:['Synthetic fixture coverage, not new played campaigns.','Reviews invasion forecast only; alignment funding UI has separate acceptance.','No broad rules or browser suite rerun.']},null,2));
console.log(JSON.stringify({passed:results.length,cases:results.map(r=>({id:r.id,hullAfter:r.preview.hullAfter,outcome:r.commandOutcome,captured:r.captured})),privacyChecks:privacy.length,errors:[]},null,2));
