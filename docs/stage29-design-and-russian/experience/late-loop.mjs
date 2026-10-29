import { chromium } from '/home/leg/projects/awesome_4x/node_modules/playwright-core/index.mjs';import fs from 'node:fs';
const out='/tmp/asterion-critique-experience';const original=JSON.parse(fs.readFileSync('/home/leg/projects/awesome_4x/docs/default-campaign/actual/083-asterion-reach-cycle-50.json'));
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});const page=await context.newPage();await page.addInitScript(s=>localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s)),original);await page.goto('http://127.0.0.1:5220');await page.waitForFunction(()=>window.__asterion);
const log=[];for(let i=0;i<5;i++){
 const before=await page.evaluate(()=>window.__asterion.getState().turn);
 await page.locator('#end-turn').click();let confirm='';
 if(await page.locator('[data-action="end-turn-confirm"]').count()){confirm=await page.locator('.modal').innerText();await page.locator('[data-action="end-turn-confirm"]').click();}
 const automaticModal=await page.locator('.modal').count()?await page.locator('.modal').innerText():null;
 if(await page.locator('.modal').count())await page.keyboard.press('Escape');
 const s=await page.evaluate(()=>window.__asterion.getState());
 log.push({before,after:s.turn,confirm,automaticModal,briefing:s.lastBriefing,player:{credits:s.factions[0].credits,orders:s.factions[0].orders,research:s.factions[0].research,alignment:s.factions[0].alignment},fleets:s.fleets.filter(f=>f.owner==='player').map(f=>({id:f.id,name:f.name,held:f.holdPosition,systemId:f.systemId,ships:f.ships,hp:f.hp})),winner:s.winner});
 if(i===0){
  await page.locator('[data-page="research"]').click();await page.locator('[data-action="research"][data-tech="terraforming"]').click();await page.locator('[data-page="galaxy"]').click();
  const after=await page.evaluate(()=>window.__asterion.getState());const newFleet=after.fleets.find(f=>f.owner==='player'&&!original.fleets.some(o=>o.id===f.id));
  if(newFleet){await page.locator('[data-action="fleet-roster"]').click();await page.locator(`.modal [data-fleet="${newFleet.id}"]`).click();await page.locator('[data-action="fleet-hold"]').click();log.push({manual:'Assigned Worldshaping and held the newly completed cruiser at Solace',fleet:newFleet.id});}
 }
}
await page.locator('#briefing-button').click();await page.screenshot({path:out+'/screens/default50-55-briefing.png'});fs.writeFileSync(out+'/late-loop.json',JSON.stringify(log,null,2));fs.writeFileSync(out+'/late-loop-final.json',JSON.stringify(await page.evaluate(()=>window.__asterion.getState()),null,2));await browser.close();
