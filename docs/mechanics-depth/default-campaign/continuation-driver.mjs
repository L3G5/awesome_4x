/** Records manually specified visible UI actions; contains no game policy or state API calls. */
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
import {fileURLToPath} from 'node:url';import {chromium} from '@playwright/test';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'ui');fs.mkdirSync(root,{recursive:true});
const url=process.env.PLAYTEST_URL||'http://127.0.0.1:33147';
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
let context,page,seed;
const previous=fs.readFileSync(path.join(root,'actions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
let request=Math.max(0,...previous.map(row=>row.request||0)),receipt=Math.max(0,...previous.map(row=>row.receipt||0));
const log=entry=>fs.appendFileSync(path.join(root,'actions.jsonl'),JSON.stringify({...entry,at:new Date().toISOString()})+'\n');
async function action(a){
 if(a.note){log({type:'decision',request,seed,text:a.note});return;}
 if(a.end){
  const close=page.locator('.modal .close-modal');if(await close.count())await close.click();
  await page.locator('[data-action="end-turn"]').click();
  const confirm=page.locator('[data-action="end-turn-confirm"]');if(await confirm.count())await confirm.click();
 }else if(a.click)await page.locator(a.click).click();
 else if(a.fill)await page.locator(a.fill.selector).fill(a.fill.value);
 else if(a.press)await page.keyboard.press(a.press);
 else if(a.select)await page.locator(a.select.selector).selectOption(a.select.value);
 else if(a.import){const pending=page.waitForEvent('filechooser');await page.locator('[data-action="import"]').click();await(await pending).setFiles(path.join(root,a.import));await page.locator('#confirm-import').click();}
 else if(a.export){const pending=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await pending;await download.saveAs(path.join(root,a.export));}
 else throw new Error('Unknown UI action');
 log({type:'action-complete',request,receipt:++receipt,seed,action:a});
}
async function observation(tag,screenshot=false){
 const data={request,seed,url:page.url(),body:await page.locator('body').innerText(),inspector:await page.locator('#inspector').innerText(),resources:await page.locator('#resources').innerText(),buttons:await page.locator('button:visible,select:visible').evaluateAll(es=>es.map(e=>({tag:e.tagName,text:e.innerText,attributes:Object.fromEntries([...e.attributes].filter(a=>a.name.startsWith('data-')||a.name==='id').map(a=>[a.name,a.value])),disabled:e.disabled})))};
 const file=`${String(request).padStart(3,'0')}-${tag||'observation'}.json`;fs.writeFileSync(path.join(root,file),JSON.stringify(data,null,2)+'\n');
 if(screenshot)await page.screenshot({path:path.join(root,file.replace('.json','.png'))});
 log({type:'observation',request,seed,file});
 console.log(JSON.stringify({request,seed,file,resources:data.resources,inspector:data.inspector,body:data.body.slice(-16000),controls:data.buttons.filter(b=>b.attributes['data-system-select']||b.attributes['data-action']&& !['language','menu','help','end-turn','toggle-sound'].includes(b.attributes['data-action']))},null,2));
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
console.log('UI driver ready. Submit one JSON request per line.');
for await(const line of rl){
 if(!line.trim())continue;request++;
 try{
 const cmd=JSON.parse(line);log({type:'request',request,seed,command:cmd});
 if(cmd.close){if(context)await context.close();await browser.close();console.log('Closed isolated browser.');break;}
 if(cmd.resume){
  seed='ASTERION';context=await browser.newContext({viewport:{width:1440,height:960},locale:'en-US'});page=await context.newPage();
  page.on('pageerror',e=>log({type:'pageerror',request,seed,message:e.message}));
  await page.goto(url);await page.waitForLoadState('networkidle');
  const build=await page.request.get(url+'/build-info.json');fs.writeFileSync(path.join(root,`served-build-${request}.json`),await build.text());
  for(const a of [{click:'[data-action="begin"]'},{click:'[data-action="menu"]'},{import:cmd.resume}])await action(a);
 }
 for(const a of cmd.actions||[])await action(a);
 await observation(cmd.tag,cmd.screenshot);
 }catch(error){log({type:'driver-error',request,seed,message:error.message});console.log('ERROR '+error.message);if(page)await observation('after-error');}
}
