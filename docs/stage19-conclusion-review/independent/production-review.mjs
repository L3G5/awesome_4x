import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const artifacts=path.dirname(new URL(import.meta.url).pathname);
const repo=process.env.REVIEW_REPO||'/tmp/asterion-stage19-conclusion';
const build=process.env.REVIEW_BUILD||'/tmp/asterion-stage19-final-t0y1ho_q';
const base=process.env.REVIEW_URL||'http://127.0.0.1:5207';
const out=process.env.REVIEW_OUT||path.join(artifacts,'production');mkdirSync(out,{recursive:true});
const {chromium}=createRequire(path.join(repo,'package.json'))('@playwright/test');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const html=readFileSync(path.join(build,'index.html'),'utf8');
const compiled=[...new Set([...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+\.(?:js|css))"/g)].map(m=>m[1].replace(/^\.\//,'')))];
assert.equal(compiled.length,2);
const result={started:new Date().toISOString(),scope:'Separate production font/layout follow-up only; not pooled with the eight interaction cases.',base,build,metadata:JSON.parse(readFileSync(path.join(build,'build-info.json'))),compiled:[],cases:[]};
for(const file of ['index.html','build-info.json',...compiled]){const local=readFileSync(path.join(build,file));const response=await fetch(`${base}/${file}`);assert.equal(response.status,200);const remote=Buffer.from(await response.arrayBuffer());assert.equal(hash(remote),hash(local));result.compiled.push({file,sha256:hash(local),bytes:local.length,servedBytesMatch:true});}
const browser=await chromium.launch({executablePath:process.env.REVIEW_CHROMIUM||'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
for(const spec of [{name:'watch-desktop',file:'watch60.json',viewport:{width:1280,height:900},title:'Transcendence',metrics:{colonies:5,population:43,ships:17,techs:11,score:698}},{name:'iron-narrow',file:'iron57.json',viewport:{width:390,height:844},title:'Domination',metrics:{colonies:12,population:104,ships:15,techs:11,score:745}}]){
 const context=await browser.newContext({viewport:spec.viewport,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
 const entry={...spec,pageErrors:[],consoleErrors:[],failedResponses:[],fontResponses:[]};page.on('pageerror',e=>entry.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')entry.consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)entry.failedResponses.push({url:r.url(),status:r.status()});if(/\.(woff|woff2)(\?|$)/.test(r.url()))entry.fontResponses.push({url:r.url(),status:r.status()});});
 try{
 await page.goto(base);await page.locator('[data-action="begin"]').click();await page.locator('[data-action="menu"]').click();const fixture=path.join(artifacts,'original-exports',spec.file);await page.locator('#import-save').setInputFiles(fixture);await page.locator('#confirm-import').click();await page.locator('[data-action="menu"]').click();await page.locator('.modal [data-action="show-conclusion"]').click();await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#modal-title').innerText(),spec.title);for(const[key,value]of Object.entries(spec.metrics))assert.equal((await page.locator(`[data-conclusion-stat="${key}"] dd`).innerText()).replaceAll(',',''),String(value));
 entry.fonts=await page.evaluate(()=>({loaded:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,status:f.status})),body:getComputedStyle(document.body).fontFamily,heading:getComputedStyle(document.querySelector('#modal-title')).fontFamily}));
 assert.ok(entry.fonts.loaded.some(f=>f.family==='DM Sans Variable'));assert.ok(entry.fonts.loaded.some(f=>f.family==='Marcellus'));assert.ok(entry.fontResponses.length>=2);assert.ok(entry.fontResponses.every(r=>r.status===200));assert.match(entry.fonts.body,/DM Sans Variable/);assert.match(entry.fonts.heading,/Marcellus/);
 entry.bounds=await page.locator('.modal').evaluate(el=>{const r=el.getBoundingClientRect(),c=el.querySelector('.modal-content');return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,contentWidth:c.clientWidth,scrollWidth:c.scrollWidth};});assert.ok(entry.bounds.left>=0&&entry.bounds.right<=entry.bounds.width&&entry.bounds.top>=0&&entry.bounds.bottom<=entry.bounds.height&&entry.bounds.scrollWidth<=entry.bounds.contentWidth);
 assert.equal(await page.locator('.modal .close-modal').evaluate(el=>el===document.activeElement),true);await page.screenshot({path:path.join(out,`${spec.name}.png`)});writeFileSync(path.join(out,`${spec.name}.txt`),await page.locator('.campaign-conclusion').innerText());
 if(spec.name==='iron-narrow'){await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.conclusion-footer [data-action="new-game-menu"]').evaluate(el=>el===document.activeElement),true);await page.screenshot({path:path.join(out,'iron-narrow-footer.png')});await page.keyboard.press('Tab');assert.equal(await page.locator('.modal .close-modal').evaluate(el=>el===document.activeElement),true);}
 const expected=JSON.parse(readFileSync(fixture));assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),expected);entry.stateUnchanged=true;assert.deepEqual(entry.pageErrors,[]);assert.deepEqual(entry.consoleErrors,[]);assert.deepEqual(entry.failedResponses,[]);entry.status='pass';
 }catch(error){entry.status='fail';entry.error={message:error.message,stack:error.stack};await page.screenshot({path:path.join(out,`${spec.name}-failure.png`)}).catch(()=>{});}
 result.cases.push(entry);console.log(JSON.stringify({name:entry.name,status:entry.status,fonts:entry.fonts?.loaded,error:entry.error?.message}));await context.close();
}
await browser.close();result.finished=new Date().toISOString();result.passed=result.cases.filter(c=>c.status==='pass').length;result.failed=result.cases.filter(c=>c.status==='fail').length;writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');process.exitCode=result.failed?1:0;
