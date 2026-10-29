import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '/home/leg/projects/awesome_4x/node_modules/@playwright/test/index.mjs';
import {createGame,getNeighbors,validateSave} from '/tmp/asterion-stage18-reinforcement/src/game.js';
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const results=[];
try{for(const width of [1280,390]){
 const s=createGame('reinforcement-author-visual'),p=s.factions[0],home=s.systems[0],f=s.fleets.find(f=>f.owner==='player'&&f.type==='frigate');
 Object.assign(home,{population:8,habitability:75,buildings:['mine','factory','shipyard'],charter:{type:'forge',level:2}});Object.assign(p,{techs:['logistics','industry'],credits:300,minerals:200,orders:10});
 const neighbor=getNeighbors(s,'s0')[0];if(!s.systems.find(w=>w.id===neighbor).knownBy.includes('player'))s.systems.find(w=>w.id===neighbor).knownBy.push('player');
 Object.assign(f,{ships:4,hp:105,hold:true,route:{destinationId:neighbor,path:['s0',neighbor]}});
 s.fleets.push({...f,id:'f99',name:'Forward Reserve',ships:2,hp:61,movesLeft:0,defenseLead:true,route:undefined},{...f,id:'f100',name:'Local Guard',ships:1,hp:34,hold:false,route:undefined},{...f,id:'f101',name:'Grand Formation',ships:9,hp:306,route:undefined});
 const input=JSON.parse(JSON.stringify(s));assert(validateSave(input));const context=await browser.newContext({viewport:{width,height:width===390?844:960}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),input);await page.goto('http://127.0.0.1:5203/');await page.waitForFunction(()=>window.__asterion);
 await page.locator(`#inspector [data-fleet="${f.id}"]`).click();await page.locator('.reinforcement-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/asterion-stage18-ui-author-review/commission-${width}.png`});
 await page.locator('[data-action="merge-menu"]').click();await page.locator('#merge-partner').selectOption('f99');
 assert.match(await page.locator('.merge-result').innerText(),/6 \/ 12[\s\S]*166 \/ 204[\s\S]*0 jumps/);
 assert.match(await page.locator('.merge-result').innerText(),/remains on Hold[\s\S]*defensive lead transfers/);
 assert(await page.locator('#merge-partner option[value="f101"]').isDisabled());
 await page.locator('.merge-result').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/asterion-stage18-ui-author-review/merge-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await page.locator('.modal-content').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),input);assert.deepEqual(errors,[]);results.push({width,passed:true,inspectionPure:true});await context.close();
}}finally{await browser.close();}
fs.writeFileSync('/tmp/asterion-stage18-ui-author-review/results.json',JSON.stringify({method:'Author visual QA, synthetic valid fixture; no commands or campaign modifications.',results},null,2));console.log(results);
