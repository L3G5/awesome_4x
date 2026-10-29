import { chromium } from '/home/leg/projects/awesome_4x/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const out='/tmp/asterion-critique-experience';
const root='/home/leg/projects/awesome_4x';
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
const errors=[];
for (const [tag,path,width] of [
 ['default50','docs/default-campaign/actual/083-asterion-reach-cycle-50.json',1440],
 ['odyssey50','docs/odyssey-playtest/actual/checkpoints/cycle50.json',1440],
 ['default60','docs/default-campaign/actual/109-asterion-reach-cycle-60.json',1440],
 ['odyssey66','docs/odyssey-playtest/actual/checkpoints/cycle66.json',1440],
 ['odyssey50-mobile','docs/odyssey-playtest/actual/checkpoints/cycle50.json',390],
]) {
 const state=JSON.parse(fs.readFileSync(root+'/'+path));
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push({tag,error:String(e)}));
 await page.addInitScript(s=>{localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s));},state);
 await page.goto('http://127.0.0.1:5220');await page.waitForFunction(()=>window.__asterion);await page.waitForTimeout(400);
 for(const view of ['galaxy','empire','research','diplomacy','journal']){
  if(view!=='galaxy')await page.locator(`[data-page="${view}"]`).click();
  await page.screenshot({path:`${out}/screens/${tag}-${view}.png`,fullPage:true});
  fs.writeFileSync(`${out}/text/${tag}-${view}.txt`,await page.locator('body').innerText());
 }
 await context.close();
}
fs.writeFileSync(out+'/browser-errors.json',JSON.stringify(errors,null,2));
await browser.close();
