/** Cross-release v1 save audit. Writes only to --output and temporary archives.
 * node /tmp/asterion-save-compatibility-audit.mjs --repo /path/to/awesome_4x --output /tmp/asterion-save-compatibility --ui-url http://127.0.0.1:5179
 * Historical campaigns use only createGame, ordinary build, and endTurn.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg=(key,fallback)=>{const at=process.argv.indexOf(key);return at<0?fallback:process.argv[at+1];};
const repo=path.resolve(arg('--repo',process.cwd()));
const output=path.resolve(arg('--output','/tmp/asterion-save-compatibility'));
const uiURL=arg('--ui-url','http://127.0.0.1:5179');
const engineRef='60fd9f8e85edfee92ed40ee29c9b8c314e140da3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',maxBuffer:30_000_000});
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(path.join(output,'inputs'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-compat-engines-'));
const engines=new Map(), sourceRecords={};
async function engine(ref){
  const revision=git('rev-parse',`${ref}^{commit}`).trim();
  if(engines.has(revision))return engines.get(revision);
  const directory=path.join(scratch,revision),graph=new Map();
  function collect(file){
    if(graph.has(file))return;
    const source=git('show',`${revision}:${file}`);graph.set(file,source);
    for(const match of source.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)){
      assert.ok(match[1].startsWith('.'));
      collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
    }
  }
  collect('src/game.js');
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),'{"type":"module"}');
  for(const [file,source]of graph){fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.writeFileSync(path.join(directory,file),source);}
  const loaded={game:await import(pathToFileURL(path.join(directory,'src/game.js'))),content:await import(pathToFileURL(path.join(directory,'src/content.js'))),revision};
  engines.set(revision,loaded);sourceRecords[revision]=Object.fromEntries([...graph].map(([file,source])=>[file,sha(source)]));
  return loaded;
}
const result={generatedAt:new Date().toISOString(),engineRevision:engineRef,scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),method:{saveVersion:1,resumeLimit:20,playerPolicy:'Passive after import: no new player commands, ordinary endTurn runs current rival AI. Existing plotted routes are not automatically advanced.',generation:'Pinned historical engines: createGame(seed), ordinary endTurn to cycle30, then one lab commission at the player capital if enabled. No grants or direct state edits.',reload:'Every resumed cycle runs once from uninterrupted state and once from a JSON-parsed copy; endTurn result and full serialized next state must match exactly.',balanceFields:['credits','minerals','science','orders'],history:'Existing discovery event bodies must persist; knownBy may legitimately expand. Existing heritage entries must remain on surviving same-ID fleets. Fleet destruction/merger is ordinary gameplay.',limitation:'Finite real-save sample, not proof that every possible v1 save is accepted. Current rules and AI govern future play; future outcomes need not match the historical engine. Synthetic malformed fixtures are excluded.'},sources:sourceRecords,cases:[],ui:null,failures:[]};
const current=await engine(engineRef);
const generated=[
  ['original-asterion','99afa91','ASTERION','Initial playable release'],
  ['original-legacy2','99afa91','stage4-legacy-2','Initial playable release, second seed'],
  ['sensors','e5af486','ASTERION','Sensor intelligence release'],
  ['stage2','379459b','ASTERION','Tactical AI and diplomacy'],
  ['stage3','536e9ec','ASTERION','Battle reports and briefings'],
  ['stage4','554612e','ASTERION','Colonies and alignment'],
  ['stage5','af9d817','ASTERION','Routes and discoveries'],
  ['stage6','c4b3366','ASTERION','Public affairs and readiness'],
  ['stage7','ff2dfa2','ASTERION','Economic forecasts'],
  ['stage8','6c4ce93','ASTERION','Civilization dossiers'],
  ['stage9','feb7894','ASTERION','Alignment expeditions'],
];
const inputs=[];
for(const [id,ref,seed,label]of generated){
  const old=await engine(ref),state=old.game.createGame(seed),commands=[];
  while(state.turn<30&&!state.winner){assert.ok(old.game.validateSave(state));const turn=state.turn,answer=old.game.endTurn(state);commands.push({turn,action:{type:'endTurn'},answer});}
  const home=state.factions.find(f=>f.id==='player').capitalId;
  const lab=old.game.getBuildOptions(state,home).find(option=>option.id==='lab'&&option.enabled);
  if(lab&&!state.winner){const action={type:'build',systemId:home,itemId:'lab'};const answer=old.game.command(state,action);assert.ok(answer.ok);commands.push({turn:state.turn,action,answer});}
  assert.ok(old.game.validateSave(state));
  const name=`inputs/${id}-cycle${state.turn}.json`;write(name,state);
  write(`inputs/${id}-commands.json`,commands);
  inputs.push({id,label,input:name,origin:'Reproducibly generated historical-engine export',revision:old.revision,commands:commands.length,commandLogSha256:sha(JSON.stringify(commands))});
}
const stage6=await engine('c4b3366');
fs.copyFileSync(path.join(repo,'docs/intervention-audit/results/provenance.json'),path.join(output,'stage6-provenance.json'));
result.historicalProvenance={file:'stage6-provenance.json',sha256:sha(fs.readFileSync(path.join(output,'stage6-provenance.json')))};
for(const [id,name,label,provenance]of [
  ['actual-stage6-cycle40','campaign-start-cycle40.json','Actual Stage6 cycle40 checkpoint','Canonical checkpoint starting the recorded human campaign; SHA matches its published replay provenance.'],
  ['actual-stage6-route63','results/verified-cycle63-before-ai.json','Verified human campaign cycle63 route checkpoint','Ordinary-command replay of the human UI campaign at Stage6; its final full state matched the actual export exactly. This checkpoint includes a partially travelled plotted route.'],
  ['actual-stage6-final67','campaign-final-cycle67.json','Actual human Stage6 final cycle67 export','Human campaign played through the UI with no grants/save edits; independently reconstructed from 43 ordinary commands.'],
]){
  const bytes=fs.readFileSync(path.join(repo,'docs/intervention-audit',name));
  const saved=`inputs/${id}.json`;fs.writeFileSync(path.join(output,saved),bytes);
  inputs.push({id,label,input:saved,origin:'Previously exported actual campaign or verified replay checkpoint',revision:stage6.revision,provenance,repositorySource:`docs/intervention-audit/${name}`});
}
write('input-manifest.json',inputs);
const counters={cases:inputs.length,oldValidatorsAccepted:0,currentValidatorsAccepted:0,resumedCycles:0,reloadChecks:0,checkedStates:0,paidQueues:0,queueReceiptChecks:0,overCapacityColonies:0,historicalEvents:0,heritageFleets:0,plottedRoutes:0,finishedImports:0};
function checkState(state){assert.ok(current.game.validateSave(state),'Current save validator rejected state');for(const f of state.factions)for(const field of result.method.balanceFields)assert.ok(Number.isFinite(f[field])&&f[field]>=0,`${f.id}.${field} is invalid`);counters.checkedStates++;}
function features(state){return {overCapacity:state.systems.filter(s=>s.buildings.length>current.game.getInfrastructure(state,s).capacity).map(s=>({id:s.id,owner:s.owner,buildings:s.buildings,capacity:current.game.getInfrastructure(state,s).capacity,population:s.population})),queues:state.systems.filter(s=>s.queue).map(s=>({systemId:s.id,owner:s.owner,...clone(s.queue)})),history:state.systems.flatMap(s=>(s.anomaly?.history||[]).map(h=>({systemId:s.id,...clone(h)}))),heritage:state.fleets.filter(f=>f.heritage?.length).map(f=>({fleetId:f.id,entries:clone(f.heritage)})),routes:state.fleets.filter(f=>f.route).map(f=>({fleetId:f.id,owner:f.owner,systemId:f.systemId,route:clone(f.route)})),charters:state.systems.filter(s=>s.charter).length,combatReports:state.combatReports?.length||0,hasBriefing:!!state.lastBriefing};}
for(const input of inputs){
  const state=JSON.parse(fs.readFileSync(path.join(output,input.input))),initial=clone(state),row={...input,inputSha256:sha(fs.readFileSync(path.join(output,input.input))),seed:state.seed,start:state.turn,initialWinner:state.winner,status:'pending'};
  try{
    const old=await engine(input.revision);assert.ok(old.game.validateSave(state),'Historical validator rejected source');counters.oldValidatorsAccepted++;
    checkState(state);counters.currentValidatorsAccepted++;
    const beforeInspect=JSON.stringify(state),before=features(state);
    for(const f of state.factions){current.game.getEmpireStats(state,f.id);current.game.getResearchOptions(state,f.id);}
    for(const s of state.systems){current.game.getColonyRepairForecast(state,s.id);if(s.owner)current.game.getBuildOptions(state,s.id,s.owner);}
    for(const f of state.fleets){current.game.getSplitPreview(state,f.id);current.game.getRouteStatus(state,f.id);}
    assert.equal(JSON.stringify(state),beforeInspect,'Validation/inspection mutated imported state');
    counters.paidQueues+=before.queues.length;counters.overCapacityColonies+=before.overCapacity.length;counters.historicalEvents+=before.history.length;counters.heritageFleets+=before.heritage.length;counters.plottedRoutes+=before.routes.length;
    row.features={overCapacity:before.overCapacity,paidQueues:before.queues.length,queueReceiptsDifferFromCurrentBaseDefinitions:before.queues.filter(q=>q.kind!=='charter'&&(()=>{const item=(q.kind==='ship'?current.content.SHIPS:current.content.BUILDINGS)[q.itemId];return JSON.stringify(q.cost)!==JSON.stringify(item.cost)||q.work!==item.work;})()).map(q=>({systemId:q.systemId,kind:q.kind,itemId:q.itemId,cost:q.cost,work:q.work})),historicalEvents:before.history.length,heritageFleets:before.heritage.length,plottedRoutes:before.routes,charters:before.charters,combatReports:before.combatReports,hasBriefing:before.hasBriefing};
    let reload=clone(state),steps=0;const pending=new Map(before.queues.map(q=>[q.systemId,q]));
    if(state.winner){const answer=current.game.endTurn(state);assert.equal(answer.ok,false);assert.deepEqual(state,initial);counters.finishedImports++;row.finishedCampaignUnchanged=true;}
    while(!state.winner&&steps<20){
      const a=current.game.endTurn(state),b=current.game.endTurn(reload);assert.deepEqual(a,b);assert.equal(JSON.stringify(state),JSON.stringify(reload),'Reload changed next-turn full JSON');counters.reloadChecks++;counters.resumedCycles++;steps++;checkState(state);checkState(reload);
      for(const [id,q]of pending){const now=state.systems.find(s=>s.id===id);if(now.owner!==q.owner||!now.queue||now.queue.itemId!==q.itemId||now.queue.kind!==q.kind||now.queue.progress<q.progress){pending.delete(id);continue;}assert.deepEqual(now.queue.cost,q.cost,'Paid queue cost repriced');assert.equal(now.queue.work,q.work,'Paid queue work repriced');counters.queueReceiptChecks++;}
      for(const entry of before.history){const now=state.systems.find(s=>s.id===entry.systemId).anomaly?.history?.find(h=>h.id===entry.id);assert.ok(now,'Discovery event was lost');const {systemId,knownBy,...original}=entry,{knownBy:nowKnown,...body}=now;assert.deepEqual(body,original,'Historical event body changed');}
      for(const heritage of before.heritage){const fleet=state.fleets.find(f=>f.id===heritage.fleetId);if(fleet)for(const entry of heritage.entries)assert.deepEqual(fleet.heritage?.find(h=>h.id===entry.id),entry,'Heritage changed on surviving fleet');}
      for(const route of before.routes.filter(r=>r.owner==='player')){const fleet=state.fleets.find(f=>f.id===route.fleetId);if(fleet&&fleet.systemId===route.systemId)assert.deepEqual(fleet.route,route.route,'Untravelled player route was lost');}
      reload=clone(reload);
    }
    Object.assign(row,{status:'pass',end:state.turn,steps,winner:state.winner,victoryType:state.victoryType,finalCanonicalSha256:sha(JSON.stringify(state)),retainedInitialPendingQueues:pending.size,remainingInitialHeritageFleets:before.heritage.filter(h=>state.fleets.some(f=>f.id===h.fleetId)).length});
  }catch(error){row.status='fail';row.error=error.stack;result.failures.push({case:input.id,error:error.message});}
  result.cases.push(row);console.log(`${row.status}: ${input.id} ${row.start} -> ${row.end??'rejected'} (${row.steps??0} cycles)`);
}
result.summary=counters;
if(!process.argv.includes('--skip-ui')){
  try{
    const {chromium}=await import(pathToFileURL(path.join(repo,'node_modules/@playwright/test/index.mjs')));
    const browser=await chromium.launch({executablePath:arg('--chromium','/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'),args:['--no-sandbox','--enable-unsafe-swiftshader']});
    result.ui={status:'pending',url:uiURL,cases:[]};
    for(const inputId of ['original-asterion','actual-stage6-cycle40','actual-stage6-route63']){
    const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const chosen=inputs.find(i=>i.id===inputId),original=JSON.parse(fs.readFileSync(path.join(output,chosen.input)));
    await page.goto(uiURL);await page.waitForFunction(()=>!!window.__asterion);
    if(await page.locator('[data-action="begin"]').count())await page.locator('[data-action="begin"]').click();
    await page.locator('[data-action="menu"]').click();
    const chooserPromise=page.waitForEvent('filechooser');await page.locator('[data-action="import"]').click();await(await chooserPromise).setFiles(path.join(output,chosen.input));
    await page.locator('#confirm-import').click();await page.waitForFunction(turn=>window.__asterion.getState().turn===turn,original.turn);
    const imported=await page.evaluate(()=>window.__asterion.getState());assert.deepEqual(imported,original,'Actual UI import changed historical data');
    await page.locator('[data-page="empire"]').click();await page.locator('[data-page="research"]').click();await page.locator('[data-page="journal"]').click();await page.locator('[data-page="galaxy"]').click();
    assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),original,'Inspection changed campaign');
    const screenshot=`${inputId}-import.png`,exportFile=`${inputId}-ui-export.json`;
    await page.screenshot({path:path.join(output,screenshot),fullPage:true});
    await page.locator('[data-action="menu"]').click();const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await downloadPromise;await download.saveAs(path.join(output,exportFile));
    const exported=JSON.parse(fs.readFileSync(path.join(output,exportFile)));assert.deepEqual(exported,original,'UI exported state differs');
    await page.reload();await page.waitForFunction(()=>!!window.__asterion);assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),original,'Autosave reload differs');assert.deepEqual(errors,[]);
    result.ui.cases.push({id:inputId,status:'pass',input:chosen.input,viewport:[1440,960],actions:'Menu > Import campaign > choose historical save file > Restore campaign; inspect Empire/Research/Chronicle/Galaxy; Menu > Export; browser reload.',fullStateImportEqual:true,inspectionStateEqual:true,exportEqual:true,autosaveReloadEqual:true,pageErrors:errors,screenshot,exportSha256:sha(fs.readFileSync(path.join(output,exportFile)))});
    await context.close();
    }
    result.ui.status='pass';
    await browser.close();
  }catch(error){result.ui={status:'fail',error:error.stack};result.failures.push({case:'UI import roundtrip',error:error.message});}
}
write('results.json',result);
const esc=value=>String(value??'—').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rows=result.cases.map(r=>`<tr><td><b>${esc(r.label)}</b><small>${esc(r.revision.slice(0,7))} · ${r.origin.startsWith('Repro')?'archived engine export':'recorded campaign'}</small></td><td>${r.start} → ${r.end??'—'}</td><td>${r.features?.overCapacity.length??'—'}</td><td>${r.features?.paidQueues??'—'}</td><td>${r.features?.historicalEvents??'—'} / ${r.features?.heritageFleets??'—'} / ${r.features?.plottedRoutes.length??'—'}</td><td class="${r.status}">${r.status.toUpperCase()}</td></tr>`).join('');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asterion Reach · Save continuity audit</title><style>*{box-sizing:border-box}body{margin:0;background:#08101b;color:#dce6ef;font:16px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:64px 32px}h1{font:500 clamp(34px,5vw,62px)/1.1 Georgia,serif;max-width:850px;margin:14px 0 24px}h2{font:500 28px Georgia,serif;margin:44px 0 14px}p{max-width:880px;color:#a9bbcc}.eyebrow{color:#76d7c4;letter-spacing:.18em;font-size:12px;text-transform:uppercase}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:32px 0}.metric{border:1px solid #29384b;border-top:2px solid #76d7c4;padding:20px;background:#101b2a}.metric b{display:block;font:40px Georgia,serif;color:#fff}.metric span,small{font-size:12px;color:#92a9be}small{display:block}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #233247;padding:15px 10px}th{color:#9db5cc;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.pass{color:#76d7c4}.fail{color:#ff8d8d}.note{padding:22px 26px;background:#151f2d;border-left:3px solid #bfa779}.scroll{overflow:auto}a{color:#91d8ed}code,pre{font:12px/1.7 ui-monospace,monospace}pre{overflow:auto;padding:20px;border:1px solid #29384b}img{max-width:100%;border:1px solid #29384b}footer{font-size:12px;color:#8399ad;margin-top:48px}@media(max-width:700px){main{padding:30px 16px}.metrics{grid-template-columns:repeat(2,1fr)}} </style><main><div class="eyebrow">ASTERION REACH / ENGINE EVIDENCE / STAGE10</div><h1>One save format.<br>Across ten stages of play.</h1><p>Real campaign exports and ordinary-command campaigns regenerated under pinned historical engines, imported without rewriting their contents. Resumed under <b>60fd9f8</b> for up to twenty cycles each.</p><div class="metrics"><div class="metric"><b>${counters.currentValidatorsAccepted}/${counters.cases}</b><span>historical saves accepted</span></div><div class="metric"><b>${counters.resumedCycles}</b><span>resumed cycles / exact reload checks</span></div><div class="metric"><b>${counters.overCapacityColonies}</b><span>legacy over-capacity colonies</span></div><div class="metric"><b>${result.failures.length}</b><span>audit failures</span></div></div><div class="note"><b>Continuity means retaining a campaign, not freezing its future.</b><p>The current rules govern alignment funding, infrastructure, discoveries, AI and shared passive repairs. This audit does not require historical and current engines to produce the same future outcome. A completed imported campaign remains completed.</p></div><h2>What crossed the boundary</h2><p>${counters.paidQueues} paid construction queues, ${counters.historicalEvents} discovery events, ${counters.heritageFleets} heritage-bearing fleets and ${counters.plottedRoutes} plotted routes were present in the inputs. Import and read-only forecasts preserved the entire state exactly. During resumed play, ${counters.queueReceiptChecks} surviving paid-queue observations retained their original cost and work; historical event bodies and surviving fleet heritage remained intact. Feature counts are occurrences across all14 input saves, not distinct worlds or events across the shared-seed campaigns. Absent newer optional fields needed no manual rewriting.</p><div class="scroll"><table><thead><tr><th>Source campaign</th><th>Cycles</th><th>Over cap</th><th>Paid queue</th><th>Events / heritage / routes</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Browser import and export</h2><p>${result.ui?.status==='pass'?'Three inputs passed the actual Menu → Import → Restore flow on the frozen Stage10 preview: regenerated original99afa91 cycle30, the previously exported Stage6 cycle40 campaign, and its verified route-bearing cycle63 checkpoint. Empire, Research and Chronicle inspection did not change state. Export and browser autosave reload both matched the historical input’s full parsed JSON, with no page errors.':'See results.json for the browser status.'}</p><a href="original-asterion-import.png"><img src="original-asterion-import.png" alt="Original cycle30 campaign imported into the Stage10 interface" loading="lazy"></a><h2>Reproduce and inspect</h2><pre>node ./audit.mjs \\\n  --repo /path/to/awesome_4x \\\n  --output /tmp/asterion-save-compatibility \\\n  --ui-url http://127.0.0.1:5179</pre><p>Use <code>--skip-ui</code> for the engine-only audit; the browser pass requires the installed Playwright package and Chromium (override with <code>--chromium /path/to/chrome</code>). The script reads pinned git objects, writes only temporary/archive output, and stores exact input SHA256 and dependency-graph source hashes in <a href="results.json">results.json</a>. Generated historical input saves and their ordinary-command receipts are in <a href="input-manifest.json">the manifest</a>. Actual Stage6 exports and the verified route checkpoint retain their existing replay provenance.</p><p><b>Limits:</b> This finite sample is targeted compatibility evidence, not a proof for every valid v1 state. Resume policy is passive for the player; current rivals act normally. Destruction, conquest, queue completion and expanded discovery knowledge are legitimate later play. The final cycle67 campaign required an atomic rejected end-turn check rather than twenty more cycles.</p><footer>Generated ${esc(result.generatedAt)} · Engine ${esc(engineRef)} · Script SHA256 ${result.scriptSha256}</footer></main></html>`);
fs.rmSync(scratch,{recursive:true,force:true});
console.log(JSON.stringify({summary:counters,ui:result.ui?.status,failures:result.failures,report:path.join(output,'index.html')},null,2));
if(result.failures.length)process.exitCode=1;
