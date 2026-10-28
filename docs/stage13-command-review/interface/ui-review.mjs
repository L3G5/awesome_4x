import {chromium} from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
import {createGame,validateSave,command,getNeighbors} from '/tmp/asterion-stage13-forecasts/src/game.js';
import assert from 'node:assert/strict';import fs from 'node:fs';
const out='/tmp/asterion-stage13-independent-review';
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const results={checks:[],errors:[]};
async function load(state,width=1280,height=800){assert.equal(validateSave(state),true);const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>results.errors.push(e.message));await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),state);await page.goto('http://127.0.0.1:5190/');await page.locator('#inspector').waitFor();return page;}
const state=createGame('formation-sequence'),a=state.fleets.find(f=>f.owner==='player'&&f.type==='frigate'),d=state.fleets.find(f=>f.owner==='veyr'&&f.type==='frigate'),civil=state.fleets.find(f=>f.owner==='veyr'&&f.type==='colony');
for(const [first,second] of [['player','veyr'],['veyr','player']]){const f=state.factions.find(f=>f.id===first);f.contacts.push(second);f.relations[second].status='war';f.techs.push('shields');}
for(const f of [a,d]){f.ships=4;f.hp=136;}d.systemId=civil.systemId=a.systemId;state.fleets=[...state.fleets.filter(f=>![d.id,civil.id].includes(f.id)),d,civil];
const page=await load(state);await page.locator(`#inspector [data-fleet="${a.id}"]`).click();
assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),state);
const text=await page.locator('.engagement-preview').innerText();assert.match(text,/Only this formation attacks/);assert.match(text,/even if the previous defender also survives/);assert.match(text,/Engage · 1 order \+ 1 move/);
assert.deepEqual(await page.locator('.engagement-order li').evaluateAll(xs=>xs.map(x=>x.dataset.opponentId)),[d.id,civil.id]);
await page.locator('.engagement-preview').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/current-sequence-1280.png'});
results.checks.push({name:'Current orbit sequence and pure inspection',text});
const extra=await page.evaluate(async original=>{
 const {renderEngagementPreview}=await import('/src/combat-ui.js');const {getEngagementPreview}=await import('/src/combat-preview.js');const {renderCombatReports}=await import('/src/report-ui.js');const {command,getNeighbors}=await import('/src/game.js');
 const s=structuredClone(original),attacker=s.fleets.find(f=>f.owner==='player'&&f.type==='frigate'),target=getNeighbors(s,attacker.systemId)[0];
 for(const f of s.fleets.filter(f=>f.owner!=='player'))f.systemId='s1';
 const before=renderEngagementPreview(s,attacker.id,target),p=getEngagementPreview(s,attacker.id,target);s.fleets.find(f=>f.owner==='veyr').systemId=target;s.fleets.find(f=>f.owner==='veyr').ships=33;s.fleets.find(f=>f.owner==='veyr').hp=594;
 const after=renderEngagementPreview(s,attacker.id,target);
 const observed=structuredClone(original),ownScout=observed.fleets.find(f=>f.owner==='player'&&f.type==='scout');ownScout.systemId=target;for(const f of observed.fleets.filter(f=>f.owner==='veyr'&&f.systemId===attacker.systemId))f.systemId=target;
 const arrival=getEngagementPreview(observed,attacker.id,target),arrivalHtml=renderEngagementPreview(observed,attacker.id,target);
 const battle=structuredClone(original),result=command(battle,{type:'attack',fleetId:attacker.id}),reports=result.combatReports;
 const historical=renderCombatReports(battle,reports);battle.fleets=[];const withNoLivingFleets=renderCombatReports(battle,reports);
 return {unknownInvariant:before===after,unknown:p,arrival:arrival.context,arrivalCost:arrivalHtml.includes('Enter orbit · 1 order + 1 move'),reportInvariant:historical.split('<div class="modal-actions')[0]===withNoLivingFleets.split('<div class="modal-actions')[0],reportArtCount:(historical.match(/class="ship-portrait"/g)||[]).length,outcomes:reports.map(r=>r.outcome),historyHasAncient:historical.includes('Ancient Vanguard')};
},state);
console.log(JSON.stringify(extra));assert.equal(extra.unknownInvariant,true);assert.equal(extra.unknown.observed,false);assert.equal(extra.unknown.opponents,null);assert.equal(extra.arrival,'arrival');assert.equal(extra.arrivalCost,true);assert.equal(extra.reportInvariant,true);assert.deepEqual(extra.outcomes,['contested','defender-destroyed']);assert.equal(extra.reportArtCount,4);assert.equal(extra.historyHasAncient,false);results.checks.push({name:'Hidden opposition, arrival, actual sequential exchanges and historical participant portraits',...extra});await page.close();
for(const width of [1280,390]){
 const s=createGame('discovery-preview-independent'),home=s.systems[0];home.population=8;home.anomaly={id:'pilgrims',resolved:false};const p=await load(s,width,width===390?844:800);await p.locator('#inspector [data-action="anomaly"]').click();const text=await p.locator('[data-choice="welcome"]').innerText();assert.match(text,/8 → 9/);assert.match(text,/9 \/ 8 population after arrival/);assert.match(text,/natural growth pauses at or above/);assert.match(text,/20 credits/);assert.deepEqual(await p.evaluate(()=>window.__asterion.getState()),s);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await p.screenshot({path:out+`/refugees-${width}.png`});results.checks.push({name:`Refugee dialog ${width}`,text});await p.close();
}
for(const habitability of [95,100]){
 const s=createGame('garden-preview-independent'),home=s.systems[0];home.habitability=habitability;home.anomaly={id:'garden',resolved:false};const p=await load(s);await p.locator('#inspector [data-action="anomaly"]').click();const text=await p.locator('[data-choice="preserve"]').innerText();assert.match(text,/Gain 20 science/);if(habitability===95)assert.match(text,/\+5 points/);else assert.match(text,/adds no habitability/);assert.deepEqual(await p.evaluate(()=>window.__asterion.getState()),s);await p.screenshot({path:out+`/garden-${habitability}.png`});results.checks.push({name:`Garden at ${habitability}%`,text});await p.close();
}
assert.deepEqual(results.errors,[]);await browser.close();fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({checks:results.checks.length,errors:results.errors,passed:true}));
