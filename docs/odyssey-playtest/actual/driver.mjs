import {chromium} from '/home/leg/projects/awesome_4x/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import http from 'node:http';
const directory='/tmp/asterion-odyssey20';
const context=await chromium.launchPersistentContext(`${directory}/browser-profile`,{headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader','--renderer-process-limit=2'],viewport:{width:1500,height:1000},acceptDownloads:true});
const browser=context.browser();
const page=context.pages()[0]||await context.newPage();
const record=fs.existsSync(`${directory}/record.json`)?JSON.parse(fs.readFileSync(`${directory}/record.json`,'utf8')):{seed:'ASTERION-ODYSSEY-20',url:'http://127.0.0.1:5208',method:'All game mutations through actual UI clicks/inputs. Read-only state projection limited to own assets, charted geography, remembered native survey facts, contacted public beacon signals and fleets under current local sensors. Raw exported saves are archived, not consulted for decisions.',events:[],errors:[]};
context.on('close',()=>{record.events.push({time:new Date().toISOString(),kind:'context-closed'});persist();});
page.on('crash',()=>{record.events.push({time:new Date().toISOString(),kind:'page-crashed'});persist();});
page.on('pageerror',error=>{fs.appendFileSync(`${directory}/browser-errors.ndjson`,JSON.stringify({time:new Date().toISOString(),message:error.message})+'\n');record.errors.push(error.message);persist();});
function persist(){fs.writeFileSync(`${directory}/record.json`,JSON.stringify(record,null,2)+'\n');}
async function turn(){return await page.locator('#turn-number').innerText().catch(()=>null);}
async function log(event){record.events.push({time:new Date().toISOString(),cycle:await turn(),...event});persist();}
async function visible(){
 return await page.evaluate(()=>{
  const s=window.__asterion.getState(),p=s.factions.find(f=>f.id==='player');
  const sensorIds=new Set(s.systems.filter(w=>w.owner==='player').map(w=>w.id));for(const f of s.fleets)if(f.owner==='player')sensorIds.add(f.systemId);
  const known=s.systems.filter(w=>w.knownBy.includes('player')||w.exploredBy.includes('player')||w.owner==='player');const knownIds=new Set(known.map(w=>w.id));
  return {seed:s.seed,turn:s.turn,winner:s.winner,victoryType:s.victoryType,ownFaction:{credits:p.credits,minerals:p.minerals,science:p.science,orders:p.orders,techs:p.techs,research:p.research,contacts:p.contacts,relations:p.relations,alignment:p.alignment},systems:known.map(w=>({id:w.id,name:w.name,x:w.x,y:w.y,owner:!w.owner||w.owner==='player'||p.contacts.includes(w.owner)?w.owner:'unknown',surveyed:w.exploredBy.includes('player'),sensor:sensorIds.has(w.id),...(sensorIds.has(w.id)?{type:w.type,habitability:w.habitability,richness:w.richness,science:w.science}:{}),...(w.owner==='player'?{population:w.population,growth:w.growth,buildings:w.buildings,charter:w.charter,queue:w.queue,defenseDamage:w.defenseDamage,anomaly:w.anomaly?{id:w.anomaly.id,resolved:w.anomaly.resolved}:null}:{} )})),fleets:s.fleets.filter(f=>f.owner==='player'||sensorIds.has(f.systemId)).map(f=>({id:f.id,owner:f.owner,name:f.name,systemId:f.systemId,type:f.type,ships:f.ships,hp:f.hp,defenseLead:f.defenseLead===true,...(f.owner==='player'?{movesLeft:f.movesLeft,route:f.route,heritage:f.heritage,hold:f.hold===true}:{} )})),lanes:s.lanes.filter(([a,b])=>knownIds.has(a)&&knownIds.has(b)),publicRaces:s.factions.filter(f=>f.id==='player'||p.contacts.includes(f.id)).map(f=>({id:f.id,name:f.name,progress:f.alignment?.progress||0,active:Boolean(f.alignment?.active),beacons:s.systems.filter(w=>w.owner===f.id&&w.buildings.includes('beacon')&&knownIds.has(w.id)).map(w=>({id:w.id,name:w.name}))}))};
 });
}
async function dom(){return await page.locator('body').innerText();}
async function closeModal(){if(await page.locator('[data-action="close-modal"]').count())await page.locator('[data-action="close-modal"]').last().click();}
async function saveExport(){
 await closeModal();await page.locator('[data-action="menu"]').click();
 const event=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await event;
 const cycle=(await turn()).replace(/\D/g,'');const base=`${directory}/checkpoints/cycle${Number(cycle)}`;let path=`${base}.json`;if(fs.existsSync(path))path=`${base}-${Date.now()}.json`;await download.saveAs(path);await log({kind:'export',path});await closeModal();return path;
}
await page.goto(record.url,{waitUntil:'networkidle'});await log({kind:'opened'});
const server=http.createServer(async(req,res)=>{
 let body='';for await(const part of req)body+=part;try{
  const input=JSON.parse(body||'{}');let result;
  if(input.op==='actions'){
   for(const a of input.actions){
    if(a.note){await log({kind:'decision',text:a.note});continue;}
    if(a.click){const locator=page.locator(a.click).first();a.actualControl=await locator.evaluate(el=>({text:el.innerText,attributes:Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]))}));await locator.click({timeout:5000});}
    if(a.fill)await page.locator(a.fill).fill(a.value);
    if(a.select)await page.locator(a.select).selectOption(a.value);
    if(a.check!==undefined)await page.locator(a.selector).setChecked(a.check);
    if(a.key)await page.keyboard.press(a.key);
    await log({kind:'interaction',action:a,status:await page.locator('#status-message').innerText().catch(()=>''),modal:await page.locator('#modal-root').innerText()});
   }
   result={dom:await dom(),view:input.view===false?null:await visible()};
  }else if(input.op==='read'){result={dom:await dom(),view:input.view===false?null:await visible()};await log({kind:'observation',dom:result.dom,view:result.view});}
  else if(input.op==='note'){await log({kind:'decision',text:input.text});result={ok:true};}
  else if(input.op==='shot'){const path=`${directory}/screenshots/${input.name}.png`;await page.screenshot({path,fullPage:true});await log({kind:'image',path});result={path};}
  else if(input.op==='export')result={path:await saveExport()};
  else if(input.op==='end'){
   await closeModal();await page.locator('[data-action="end-turn"]').click();
   if(await page.locator('[data-action="end-turn-confirm"]').count())await page.locator('[data-action="end-turn-confirm"]').click();
   const briefing=await page.locator('#modal-root').innerText();await log({kind:'command',command:{type:'endTurn'},briefing,resources:await page.locator('#resources').innerText()});
   const n=Number((await turn()).replace(/\D/g,''));if(n%10===0)await saveExport();
   result={dom:await dom(),view:await visible()};
  }else if(input.op==='buttons'){result=await page.locator('button,input,select').evaluateAll(elements=>elements.map(el=>({tag:el.tagName,text:el.innerText,disabled:el.disabled,...Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]))})));}
  else if(input.op==='stop'){await saveExport();await log({kind:'finished'});result={ok:true};setTimeout(async()=>{server.close();await browser.close();process.exit(0);},100);}
  else throw Error('Unknown driver operation');
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(error){fs.appendFileSync(`${directory}/driver-errors.ndjson`,JSON.stringify({time:new Date().toISOString(),message:error.message})+'\n');await log({kind:'driver-error',message:error.message});res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,dom:await dom().catch(()=>null)}));}
});
server.listen(5210,'127.0.0.1',()=>console.log('Playtest driver ready at 5210'));
