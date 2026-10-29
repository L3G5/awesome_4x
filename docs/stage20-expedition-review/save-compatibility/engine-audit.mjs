import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const repo=path.resolve(arg('--repo',process.cwd()));
const output=path.resolve(arg('--out',path.dirname(fileURLToPath(import.meta.url))));
const revision='47e037308271ff3d3ac0d1fc870a889cdf0a67c4';
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',maxBuffer:20e6});
const read=file=>fs.readFileSync(path.join(repo,file));
const readJSON=file=>JSON.parse(read(file));
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(output,'simulation-finals'),{recursive:true});
assert.equal(git('rev-parse',`${revision}^{commit}`).trim(),revision);
const previous=readJSON('docs/save-compatibility/results.json');
const oldManifest=readJSON('docs/save-compatibility/input-manifest.json');
assert.equal(oldManifest.length,14);
const inputs=oldManifest.map(item=>({...item,path:`docs/save-compatibility/${item.input}`,expectedSha256:previous.cases.find(row=>row.id===item.id).inputSha256,group:'existing compatibility artifact'}));
const ironManifest=readJSON('docs/military-playtest/replay/MANIFEST.sha256.json');
for(const cycle of [55,57]) inputs.push({id:`actual-iron-${cycle}`,label:`Actual IRON cycle ${cycle}`,path:`docs/military-playtest/replay/actual-exports/cycle${cycle}.json`,group:'actual completed military campaign checkpoint',origin:'Unmodified actual UI export from the completed IRON campaign',expectedSha256:ironManifest[`actual-exports/cycle${cycle}.json`],provenance:'docs/military-playtest/replay/MANIFEST.sha256.json'});
for(const cycle of [40,51,60]) inputs.push({id:`actual-watch-${cycle}`,label:`Actual WATCH cycle ${cycle}`,path:`docs/watch-playtest/checkpoints/cycle${cycle}.json`,group:'actual completed WATCH campaign checkpoint',origin:'Unmodified actual UI export from the completed WATCH campaign',provenance:'docs/watch-playtest/replay/provenance.json'});
for(const input of inputs){const bytes=read(input.path);input.sha256=sha(bytes);input.bytes=bytes.length;if(input.expectedSha256)assert.equal(input.sha256,input.expectedSha256);assert.equal(bytes.toString(),git('show',`${revision}:${input.path}`));}
write('input-manifest.json',inputs);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-stage20-save-engine-'));
const sources=new Map();
function collect(file){if(sources.has(file))return;const source=git('show',`${revision}:${file}`);sources.set(file,source);for(const [,specifier]of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)){assert.ok(specifier.startsWith('.'));collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)));}}
for(const module of ['game','conquest','conclusion','investment','reinforcement','combat-preview'])collect(`src/${module}.js`);
for(const [file,source]of sources){const dest=path.join(scratch,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source);}fs.writeFileSync(path.join(scratch,'package.json'),'{"type":"module"}\n');
const load=name=>import(pathToFileURL(path.join(scratch,`src/${name}.js`)));
const game=await load('game'),diplo=await load('diplomacy'),reports=await load('reports'),conquest=await load('conquest'),conclusion=await load('conclusion'),investment=await load('investment'),reinforcement=await load('reinforcement'),victory=await load('victory');
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function inventory(s){return {
  presentTopLevelFields:Object.keys(s),absentOptionalTopLevel:['combatReports','lastBriefing','diplomacyOffers','publicAffairs','alignmentUpdatedTurn','discoveriesUpdatedTurn'].filter(key=>!Object.hasOwn(s,key)),
  queues:s.systems.filter(x=>x.queue).map(x=>({systemId:x.id,owner:x.owner,queue:clone(x.queue)})),
  combatReports:(s.combatReports||[]).map(x=>({id:x.id,kind:x.kind,hasRounds:Object.hasOwn(x,'rounds'),sha256:sha(JSON.stringify(x))})),
  routes:s.fleets.filter(f=>Object.hasOwn(f,'route')).map(f=>({fleetId:f.id,owner:f.owner,systemId:f.systemId,route:clone(f.route)})),
  hold:s.fleets.filter(f=>Object.hasOwn(f,'hold')).length,defenseLead:s.fleets.filter(f=>Object.hasOwn(f,'defenseLead')).length,
  heritageFleets:s.fleets.filter(f=>f.heritage?.length).length,expeditions:s.factions.filter(f=>f.strategy?.expedition).length,
  diplomacyOffers:(s.diplomacyOffers||[]).map(o=>({id:o.id,kind:o.kind??'(kindless legacy peace)',status:o.status,credits:o.credits})),
  tradeCooldownRelations:s.factions.reduce((n,f)=>n+Object.values(f.relations).filter(r=>Object.hasOwn(r,'tradeOfferAfter')).length,0),overCapacity:s.systems.filter(x=>x.buildings.length>game.getInfrastructure(s,x).capacity).length,
};}
function check(s){assert.ok(game.validateSave(s),'save rejected');for(const f of s.factions)for(const key of ['credits','minerals','science','orders'])assert.ok(Number.isFinite(f[key])&&f[key]>=0,`${f.id}.${key}`);}
function inspect(s){
  for(const f of s.factions){game.getEmpireStats(s,f.id);game.getResearchOptions(s,f.id);game.getVictoryProgress(s,f.id);diplo.getActiveDiplomacyOffers(s,f.id);for(const other of s.factions)if(other.id!==f.id)diplo.getDiplomacyForecast(s,f.id,other.id);}
  for(const system of s.systems){game.getSystemYield(s,system);game.getInfrastructure(s,system);game.getColonyRepairForecast(s,system.id);if(system.owner==='player'){game.getBuildOptions(s,system.id);game.getDevelopmentOptions(s,system.id);investment.getInvestmentComparison(s,system.id,{kind:'building',itemId:'lab'});}}
  for(const f of s.fleets){game.getSplitPreview(s,f.id);game.getRouteStatus(s,f.id);game.getDefenseLeadPreview(s,f.id);reinforcement.getMergeOptions(s,f.id);reinforcement.getReinforcementPreview(s,f.id);}
  for(const report of s.combatReports||[])reports.getCombatReport(s,report.id);
  conquest.getConquestView(s);conclusion.getCampaignConclusion(s);
}
const result={generatedAt:new Date().toISOString(),runtime:process.version,engineRevision:revision,scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),sources:Object.fromEntries([...sources].sort().map(([file,source])=>[file,sha(source)])),method:{inputs:'Exactly 14 existing compatibility artifacts plus IRON55/57 and WATCH40/51/60. Original bytes and previous provenance remain untouched; no historical generation is executed.',continuation:'Simulation-only passive player: ordinary endTurn with current rules and AI until a winner is recorded. No player commands, grants, edited state or old-future equality requirement.',reload:'At every step, JSON-copy the uninterrupted current state, execute ordinary endTurn once on each, compare return values and entire next JSON, and validate both balances/states.',preservation:'Whole input JSON remains identical after frozen validation and read-only projections. Existing paid queue receipts retain cost/work while the same queue remains active; retained old reports remain byte-identical and do not acquire round traces.',limits:'19 artifact checks include related and byte-identical historical snapshots; they are not independent games or a win-rate sample. Completed imports remain terminal. Simulation outcomes are not continuations played by a human.'},inputManifestSha256:sha(fs.readFileSync(path.join(output,'input-manifest.json'))),cases:[],failures:[],summary:{inputs:19,uniqueInputHashes:new Set(inputs.map(x=>x.sha256)).size,accepted:0,unfinishedImports:0,finishedImports:0,continuationSteps:0,reloadChecks:0,stateChecks:0,retainedQueueReceiptChecks:0,retainedReportChecks:0,finishedAtomicChecks:0}};
try{
for(const input of inputs){
 const state=JSON.parse(read(input.path)),original=JSON.stringify(state),row={id:input.id,input:input.path,inputSha256:input.sha256,seed:state.seed,startTurn:state.turn,initialWinner:state.winner,status:'pending'};
 try{
  check(state);result.summary.stateChecks++;const before=inventory(state);row.features=before;
  const frozen=freeze(clone(state));check(frozen);inspect(frozen);assert.equal(JSON.stringify(frozen),original);assert.equal(JSON.stringify(state),original);row.importPreservedExactly=true;result.summary.accepted++;
  // Also measure the UI's existing public-beacon reconciliation explicitly;
  // no reconciled clone is used for the engine continuation.
  const reveal=clone(state);victory.revealPublicBeacons(reveal);row.publicBeaconRefreshChangesImport=JSON.stringify(reveal)!==original;
  let steps=0,receiptChecks=0,reportChecks=0;const originalReports=new Map((state.combatReports||[]).map(report=>[report.id,JSON.stringify(report)]));
  const pending=new Map(before.queues.map(item=>[item.systemId,{...item,reference:state.systems.find(x=>x.id===item.systemId).queue}]));
  const trajectory=createHash('sha256');
  if(state.winner){result.summary.finishedImports++;const answer=game.endTurn(state);assert.equal(answer.ok,false);assert.equal(JSON.stringify(state),original);row.completedImportRemainsTerminal=true;result.summary.finishedAtomicChecks++;}
  else result.summary.unfinishedImports++;
  while(!state.winner){
   assert.ok(steps<=game.LAST_TURN+1,'continuation did not terminate');const reload=clone(state),turn=state.turn;
   const a=game.endTurn(state),b=game.endTurn(reload);assert.ok(a.ok);assert.deepEqual(a,b);assert.equal(JSON.stringify(state),JSON.stringify(reload));check(state);check(reload);result.summary.stateChecks+=2;result.summary.reloadChecks++;steps++;
   assert.ok(state.turn===turn+1||(state.turn===turn&&state.winner));trajectory.update(JSON.stringify(state)).update('\n');
   for(const [id,item]of pending){const now=state.systems.find(x=>x.id===id),q=now.queue,old=item.queue;if(now.owner!==item.owner||q!==item.reference){pending.delete(id);continue;}assert.deepEqual(q.cost,old.cost);assert.equal(q.work,old.work);receiptChecks++;}
   for(const report of state.combatReports||[]){if(originalReports.has(report.id)){assert.equal(JSON.stringify(report),originalReports.get(report.id));reportChecks++;}}
  }
  const final=JSON.stringify(state);const ending=clone(state),rejected=game.endTurn(state);assert.equal(rejected.ok,false);assert.deepEqual(state,ending);result.summary.finishedAtomicChecks++;
  result.summary.continuationSteps+=steps;result.summary.retainedQueueReceiptChecks+=receiptChecks;result.summary.retainedReportChecks+=reportChecks;
  Object.assign(row,{status:'pass',steps,finishTurn:state.turn,winner:state.winner,victoryType:state.victoryType,queueReceiptChecks:receiptChecks,retainedOldReportChecks:reportChecks,finalCanonicalSha256:sha(final),trajectorySha256:trajectory.digest('hex'),simulationOnly:!row.initialWinner});
  if(steps){row.simulationFinal=`simulation-finals/${input.id}.json`;write(row.simulationFinal,state);}
 }catch(error){row.status='fail';row.error=error.stack;result.failures.push({id:input.id,error:error.message});}
 result.cases.push(row);write('engine-results.json',result);console.log(`${row.status}: ${row.id} ${row.startTurn} -> ${row.finishTurn??'failed'} (${row.steps??0} simulated steps)`);
}
for(const input of inputs)assert.equal(sha(read(input.path)),input.sha256,'original input changed');
result.originalInputsUnchanged=true;write('engine-results.json',result);
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({summary:result.summary,failures:result.failures},null,2));if(result.failures.length)process.exitCode=1;
