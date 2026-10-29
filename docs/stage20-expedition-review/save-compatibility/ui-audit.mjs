import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const repo=path.resolve(arg('--repo',process.cwd()));
const output=path.resolve(arg('--out',path.dirname(fileURLToPath(import.meta.url))));
const uiURL=arg('--ui-url','http://127.0.0.1:5208');
const only=arg('--only',null);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(output,'input-manifest.json')));
const {chromium}=await import(pathToFileURL(path.join(repo,'node_modules/@playwright/test/index.mjs')));
const browser=await chromium.launch({headless:true,executablePath:arg('--chromium','/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'),args:['--enable-unsafe-swiftshader']});
const result={generatedAt:new Date().toISOString(),uiURL,expectedVersion:'0.20.0',engineRevision:'47e037308271ff3d3ac0d1fc870a889cdf0a67c4',scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),method:'Fresh isolated browser contexts. Real Menu > Import file chooser > Restore. No state setters or localStorage fixtures. Public read-only UI inspection; exact whole parsed JSON comparison before/after, actual download and browser autosave reload. No turns or gameplay commands are issued in this UI pass.',cases:[],failures:[]};
const assets=new Map();
const save=()=>fs.writeFileSync(path.join(output,only?'ui-followup-results.json':'ui-results.json'),JSON.stringify({...result,servedAssets:[...assets.values()]},null,2)+'\n');
try{
for(const [id,width,height]of [['original-asterion',1440,960],['actual-stage6-route63',1280,900],['actual-stage6-final67',1280,900],['actual-iron-57',390,844],['actual-watch-51',1280,900],['actual-watch-60',1440,960]]){
 if(only&&id!==only)continue;
 const input=manifest.find(x=>x.id===id),originalBytes=fs.readFileSync(path.join(repo,input.path)),original=JSON.parse(originalBytes);
 assert.equal(sha(originalBytes),input.sha256);
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const row={id,input:input.path,inputSha256:input.sha256,viewport:[width,height],status:'pending'};
 try{
  await page.goto(uiURL);await page.waitForFunction(()=>Boolean(window.__asterion));
  if(await page.locator('[data-action="begin"]').count())await page.locator('[data-action="begin"]').click();
  row.version=await page.locator('.version').innerText();assert.ok(row.version.includes('0.20.0'));
  const assetPaths=await page.evaluate(()=>[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.src||e.href));
  for(const url of assetPaths){const bytes=Buffer.from(await(await page.request.get(url)).body());const name=new URL(url).pathname;const record={path:name,bytes:bytes.length,sha256:sha(bytes)};if(assets.has(name))assert.deepEqual(record,assets.get(name));else assets.set(name,record);}
  await page.locator('[data-action="menu"]').click();
  const choosing=page.waitForEvent('filechooser');await page.locator('.modal [data-action="import"]').click();await(await choosing).setFiles(path.join(repo,input.path));
  await page.locator('#confirm-import').click();await page.waitForFunction(turn=>window.__asterion.getState().turn===turn,original.turn);
  const snapshot=()=>page.evaluate(()=>window.__asterion.getState());
  assert.deepEqual(await snapshot(),original,'picker import changed data');row.fullStateImportEqual=true;
  for(const pageName of ['empire','research','diplomacy','journal','galaxy']){await page.locator(`[data-page="${pageName}"]`).click();assert.deepEqual(await snapshot(),original,`${pageName} inspection changed data`);}
  row.inspectionStateEqual=true;
  if(original.winner){
   assert.equal(await page.locator('#end-turn').isDisabled(),true);
   row.mandate=await page.locator('#mandate').innerText();assert.ok(row.mandate.includes('THE CHRONICLE IS COMPLETE'));assert.ok(!row.mandate.includes('fund 60'));
   if(await page.locator('#mandate [data-action="show-conclusion"]').isVisible())await page.locator('#mandate [data-action="show-conclusion"]').click();
   else {await page.locator('[data-action="menu"]').click();await page.locator('.modal [data-action="show-conclusion"]').click();}
   row.conclusionTitle=await page.locator('#modal-title').innerText();assert.equal(row.conclusionTitle,original.victoryType);
   row.conclusionText=await page.locator('.modal').innerText();assert.deepEqual(await snapshot(),original);
   assert.equal(await page.locator('.modal .close-modal').evaluate(e=>e===document.activeElement),true);
   row.completedEndTurnDisabled=true;row.recordedConclusion=true;
   row.screenshot=`${id}-conclusion.png`;await page.screenshot({path:path.join(output,row.screenshot),fullPage:true});
   const button=page.locator('.conclusion-history [data-action="combat-report"]').first();
   if(await button.count()){
    const reportId=Number(await button.getAttribute('data-report'));const report=original.combatReports.find(r=>r.id===reportId);
    await button.click();const text=await page.locator('.combat-report').innerText();assert.ok(text.includes(report.participants[0].name));
    row.inspectedHistoricalReport={id:reportId,hadRounds:Object.hasOwn(report,'rounds'),participant:report.participants[0].name};assert.deepEqual(await snapshot(),original);await page.keyboard.press('Escape');
   }else await page.keyboard.press('Escape');
  }else{
   assert.equal(await page.locator('#end-turn').isDisabled(),false);row.screenshot=`${id}-import.png`;await page.screenshot({path:path.join(output,row.screenshot),fullPage:true});
  }
  row.noPageOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.equal(row.noPageOverflow,true);
  await page.locator('[data-action="menu"]').click();const downloading=page.waitForEvent('download');await page.locator('.modal [data-action="export"]').click();const download=await downloading;
  row.exportFile=`${id}-ui-export.json`;await download.saveAs(path.join(output,row.exportFile));const exported=fs.readFileSync(path.join(output,row.exportFile));assert.deepEqual(JSON.parse(exported),original);row.exportFullStateEqual=true;row.exportSha256=sha(exported);row.exportByteIdentical=exported.equals(originalBytes);
  await page.reload();await page.waitForFunction(()=>Boolean(window.__asterion));assert.deepEqual(await snapshot(),original);row.autosaveReloadEqual=true;
  assert.deepEqual(errors,[]);row.pageErrors=errors;row.status='pass';
 }catch(error){row.status='fail';row.error=error.stack;row.pageErrors=errors;result.failures.push({id,error:error.message});await page.screenshot({path:path.join(output,`${id}-failure.png`),fullPage:true}).catch(()=>{});}
 result.cases.push(row);save();console.log(`${row.status}: ${id} picker/export/read-only UI at ${width}`);await context.close();
}
for(const input of manifest)assert.equal(sha(fs.readFileSync(path.join(repo,input.path))),input.sha256);
result.originalInputsUnchanged=true;save();
}finally{await browser.close();}
if(result.failures.length)process.exitCode=1;
