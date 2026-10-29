import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const home = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const url = arg('--url', 'http://127.0.0.1:5216');
const source = arg('--source', '/tmp/asterion-stage25-label');
const build = arg('--build', '/tmp/asterion-stage25-final-tj1q21s5');
const out = path.resolve(arg('--out', home));
const chromiumPath = arg('--chromium', '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');
const playwrightPath = arg('--playwright', '/home/leg/projects/awesome_4x/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const git = (...a) => execFileSync('git', ['-C', source, ...a], {encoding:'utf8'}).trim();
for (const dir of ['screenshots','exports']) await mkdir(path.join(out,dir), {recursive:true});
const inputSpecs = [
  {id:'actual-default38',label:'Review alignment requirements →',outlook:false,heading:'.alignment-card h3',turn:38},
  {id:'actual-odyssey50',label:'Review your funding →',outlook:true,heading:'.alignment-outlook h4',turn:50},
  {id:'actual-odyssey66',label:'Review final network →',outlook:false,heading:'.alignment-card h3',turn:66},
];
const provenance = {generatedAt:new Date().toISOString(), source, sourceHead:git('rev-parse','HEAD'), url, build, method:'Six independent browser contexts; actual file imports, ordinary inspection and exports only. No gameplay, engine command, save injection or state edits. Full structural state equality after import, page selection, link activation and export. Two complete extra desktop reload checks are unnecessary for this label-only boundary.', inputs:[],sourceFiles:[],productionFiles:[],served:[]};
for (const spec of inputSpecs) {const file=path.join(home,'inputs',`${spec.id}.json`), bytes=await readFile(file);spec.file=file;spec.state=JSON.parse(bytes);assert.equal(spec.state.turn,spec.turn);provenance.inputs.push({id:spec.id,path:path.relative(home,file),bytes:bytes.length,sha256:hash(bytes)});}
for (const name of git('ls-files','src').split('\n')) provenance.sourceFiles.push({path:name,sha256:hash(await readFile(path.join(source,name)))});
const patch=git('diff','HEAD','--','src/workspace-ui.js'); await writeFile(path.join(out,'workspace-ui.diff'),`${patch}\n`);
provenance.sourcePatchSha256=hash(`${patch}\n`);
async function walk(dir,prefix='') { const found=[];for(const d of await readdir(dir,{withFileTypes:true})){const rel=path.join(prefix,d.name);if(d.isDirectory())found.push(...await walk(path.join(dir,d.name),rel));else found.push(rel);}return found; }
for (const file of await walk(build)) provenance.productionFiles.push({path:file,sha256:hash(await readFile(path.join(build,file)))});
const indexBytes=await readFile(path.join(build,'index.html'));
const refs=['index.html','build-info.json',...Array.from(indexBytes.toString().matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g),m=>m[1].replace(/^\.\//,'').replace(/^\//,''))];
for(const file of refs){const response=await fetch(`${url}/${file}`),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(hash(bytes),hash(await readFile(path.join(build,file))));provenance.served.push({path:file,status:response.status,sha256:hash(bytes),matchesFrozenProduction:true});}
provenance.buildInfo=JSON.parse(await readFile(path.join(build,'build-info.json'),'utf8'));
const browser=await chromium.launch({executablePath:chromiumPath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const results={generatedAt:new Date().toISOString(),browser:browser.version(),cases:[],errors:[]};
try {
 for(const viewport of [{width:1440,height:960},{width:390,height:844}]) for(const spec of inputSpecs){
  const key=`${spec.id}-${viewport.width}`,context=await browser.newContext({viewport,reducedMotion:'reduce',acceptDownloads:true}), page=await context.newPage();
  const errors=[],failedRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));page.setDefaultTimeout(12000);
  const checks=[]; const same=async phase=>{assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),spec.state);checks.push({phase,fullStateExact:true});};
  try {
   await page.goto(url,{waitUntil:'networkidle'});
   const begin=page.locator('[data-action="begin"]');if(await begin.isVisible())await begin.click();
   await page.locator('#import-save').setInputFiles(spec.file);
   await page.locator('#confirm-import').click();
   await same('actual file import');
   await page.locator('[data-page="empire"]').click();
   await same('Empire inspection');
   const link=page.locator('#inspector [data-action="review-alignment"]');
   assert.equal(await link.textContent(),spec.label);
   assert.equal(await page.locator('.alignment-outlook').count(),Number(spec.outlook));
   await link.scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,'screenshots',`${key}-context.png`)});
   // A real keyboard activation checks the same control without changing campaign state.
   await link.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;},spec.heading);
   const heading=await page.locator(spec.heading).textContent();
   const card=await page.locator('.alignment-card').innerText();
   if(spec.turn===66){assert.match(card,/This age has ended/);assert.match(card,/Transcendence recorded/);assert.doesNotMatch(card,/Maintain their alignment/);}
   await same('context link keyboard activation and landing');
   const layout=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
   assert.ok(layout.documentWidth<=viewport.width,JSON.stringify(layout));
   await page.screenshot({path:path.join(out,'screenshots',`${key}-landing.png`)});
   await page.locator('[data-action="menu"]').click();
   const downloadWait=page.waitForEvent('download');await page.locator('.modal [data-action="export"]').click();const download=await downloadWait;
   const exportFile=path.join(out,'exports',`${key}.json`);await download.saveAs(exportFile);const exportBytes=await readFile(exportFile);
   assert.deepEqual(JSON.parse(exportBytes),spec.state);assert.equal(hash(exportBytes),provenance.inputs.find(i=>i.id===spec.id).sha256);
   await same('actual export');assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
   results.cases.push({id:key,viewport,turn:spec.turn,label:spec.label,outlookRendered:spec.outlook,landingHeading:heading,keyboard:'Enter on context link',checks,exportByteExact:true,exportSha256:hash(exportBytes),layout,browserErrors:errors,failedRequests,screenshots:[`screenshots/${key}-context.png`,`screenshots/${key}-landing.png`]});
   console.log(`PASS ${key}: ${spec.label}; four exact state checks + byte-identical export`);
  } catch(error){results.errors.push({id:key,message:error.message,stack:error.stack,browserErrors:errors,failedRequests});await page.screenshot({path:path.join(out,'screenshots',`${key}-error.png`)}).catch(()=>{});throw error;}
  finally {await context.close();await writeFile(path.join(out,'results.json'),json(results));}
 }
} finally {await browser.close();await writeFile(path.join(out,'provenance.json'),json(provenance));await writeFile(path.join(out,'results.json'),json(results));}
