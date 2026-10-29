import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const repo=path.resolve(arg('--repo','/home/leg/projects/awesome_4x'));
const original=path.resolve(arg('--original','/tmp/asterion-asterion21-midgame'));
const input=path.resolve(arg('--input','/tmp/asterion-stage21-novice-audit/040-asterion-reach-cycle-12.json'));
const build=path.resolve(arg('--build','/tmp/asterion-stage23-final-vapk8k8e'));
const out=path.resolve(arg('--out',path.dirname(fileURLToPath(import.meta.url))));
const pin='648c1f53de5f37d4df012c6b7e9994fb9574819c',buildPin='3c6e822211e380510ddd387a24d3f021dc4bb36b';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=x=>JSON.stringify(x),copy=x=>JSON.parse(json(x));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',maxBuffer:20e6});
const read=file=>fs.readFileSync(path.join(original,file));
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
const inputBytes=fs.readFileSync(input);assert.equal(sha(inputBytes),'d8bf73702ea980fd3b3f7079fd7a31fe0e2d09ce4bdaa1704b68355bef14a45c');
assert.equal(sha(read('input-actual-cycle12-v0.21.0.json')),sha(inputBytes));
const boundary=JSON.parse(read('checkpoint60.json'));
assert.equal(sha(read('actions.jsonl')),'f0f9efc47364122976ce11b77ed6af4b9bbf7d20092c5fb3a07cd0b0cbb4afa5');
for(const[file,hash]of Object.entries(boundary.hashes))assert.equal(sha(read(file)),hash,file);
const log=read('actions.jsonl').toString().trim().split('\n').map(JSON.parse);assert.equal(log.length,684);
const originals=['actions.jsonl','through-cycle60-actions.jsonl','ending-export-equality.json','checkpoint60.json','checkpoint50.json','through-cycle50-actions.jsonl','checkpoint40.json','through-cycle40-actions.jsonl','checkpoint30.json','through-cycle30-actions.jsonl','provenance.json','driver.cjs','input-actual-cycle12-v0.21.0.json',...log.filter(e=>e.kind==='actual-ui-download').map(e=>path.basename(e.path)),...log.filter(e=>e.kind==='observation').map(e=>`observation-${String(e.index).padStart(3,'0')}.json`)];
const inputManifest=[...new Set(originals)].sort().map(file=>({file,bytes:read(file).length,sha256:sha(read(file))}));
assert.ok(read('actions.jsonl').toString().startsWith(read('through-cycle60-actions.jsonl').toString()),'Frozen through60 log remains an exact prefix');
const graph=new Map();function collect(file){if(graph.has(file))return;const text=git('show',`${pin}:${file}`);assert.equal(text,git('show',`${buildPin}:${file}`),`Rules unchanged since frozen build: ${file}`);graph.set(file,text);for(const[,s]of text.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)){assert.ok(s.startsWith('.'));collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),s)));}}
collect('src/game.js');assert.equal(graph.size,14);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-continuation-replay-'));
for(const[file,text]of graph){const dest=path.join(scratch,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);}fs.writeFileSync(path.join(scratch,'package.json'),' {"type":"module"}\n');
const game=await import(pathToFileURL(path.join(scratch,'src/game.js'))),content=await import(pathToFileURL(path.join(scratch,'src/content.js'))),victory=await import(pathToFileURL(path.join(scratch,'src/victory.js'))),diplomacy=await import(pathToFileURL(path.join(scratch,'src/diplomacy.js')));
const metadata=JSON.parse(fs.readFileSync(path.join(build,'build-info.json')));assert.equal(metadata.version,'0.21.1');assert.equal(metadata.commit,buildPin);
const assetFiles=['build-info.json','index.html','guide.html',...fs.readdirSync(path.join(build,'assets')).filter(f=>/\.(js|css)$/.test(f)).map(f=>`assets/${f}`)];
const assets=assetFiles.map(file=>({file,bytes:fs.statSync(path.join(build,file)).size,sha256:sha(fs.readFileSync(path.join(build,file)))}));
assert.equal(assets.find(a=>a.file.endsWith('.js')).sha256,'4fd3cb1146abcffab52202e627fbce345b85542da76aa19a4b67bbe4bdc22b5c');
assert.equal(assets.find(a=>a.file.endsWith('.css')).sha256,'f7829bf71c0bd4c6666070939a0372ae0b7cae0c7beb7c5d986de8914a55e003');
write('source-pins.json',{pin,buildPin,metadata,engine:Object.fromEntries([...graph].sort().map(([file,text])=>[file,sha(text)])),uiMainSha256:sha(git('show',`${pin}:src/main.js`)),assets});
write('input-manifest.json',{inputOriginal:{originalFile:'040-asterion-reach-cycle-12.json',bytes:inputBytes.length,sha256:sha(inputBytes)},phase:'Frozen continuation only, actual cycle12 through actual cycle60',files:inputManifest});
let state=null,selectedFleetId=null,selectedSystemId=null,modal=null,menuSystemId=null,menuReplaceId=null,validStates=0;
const commands=[],commandResults=[],exports=[],observations=[],eventHashes=[],noncommands=[];
const own=()=>state.factions.find(f=>f.id==='player'),fleet=id=>state.fleets.find(f=>f.id===id);
const unique=(rows,label)=>{assert.equal(rows.length,1,`Unique ${label}`);return rows[0];};
function world(name){name=name.replace(/ ↗$/,'');return unique(state.systems.filter(w=>w.name===name&&(w.owner==='player'||w.knownBy.includes('player')||w.exploredBy.includes('player'))),`observed world ${name}`);}
function selectFleet(name,at){name=name.replace(/ ×\d+$/,'');const f=unique(state.fleets.filter(f=>f.owner==='player'&&f.name===name),`own fleet ${name}`);if(at)assert.equal(state.systems.find(w=>w.id===f.systemId).name,at,`Fleet selector location ${name}`);selectedFleetId=f.id;selectedSystemId=f.systemId;}
function validate(){assert.ok(game.validateSave(state));for(const f of state.factions)for(const key of['credits','minerals','science','orders'])assert.ok(Number.isFinite(f[key])&&f[key]>=0);validStates++;}
function execute(action,e,line){const previousRaces=action.type==='endTurn'?victory.getPublicRaces(state):null;const restored=copy(state),apply=s=>action.type==='endTurn'?game.endTurn(s):game.command(s,action),before=state.turn;const answer=apply(state),again=apply(restored);assert.ok(answer.ok,`line${line} request${e.index}: ${answer.message}`);assert.deepEqual(answer,again);assert.equal(json(state),json(restored),`Reload-next-command at line${line}`);assert.equal(Number(e.turn.match(/\d+/)[0]),state.turn);validate();const expectedStatus=action.type==='endTurn'?(!state.winner&&state.lastBriefing?.entries.length?`Cycle ${state.lastBriefing.turn}: ${state.lastBriefing.entries.length} dispatches available in your briefing.`:answer.message):(answer.combatReports?.length?`${answer.combatReports.length} combat report${answer.combatReports.length>1?'s':''} recorded.`:answer.message);assert.equal(e.status,expectedStatus,`UI receipt at line${line}`);if(['move','continueRoute'].includes(action.type)&&fleet(action.fleetId))selectedSystemId=fleet(action.fleetId).systemId;if(selectedFleetId&&!fleet(selectedFleetId))selectedFleetId=null;if(answer.combatReports?.length&&action.type!=='endTurn')modal=state.winner?'conclusion':'reports';if(action.type==='endTurn'){const briefing=state.lastBriefing,newOffer=diplomacy.getActiveDiplomacyOffers(state).find(o=>o.to==='player'&&o.createdTurn>=before),raceAlert=victory.getPublicRaces(state).some(r=>{const old=previousRaces.find(x=>x.factionId===r.factionId);return r.factionId!=='player'&&(r.progress>0&&!old?.progress||r.progress>=8&&(old?.progress||0)<8);}),blocks=entry=>{const w=state.systems.find(w=>w.id===entry.systemId);return w?.owner&&w.owner!=='player'&&!own().relations[w.owner].trade&&own().relations[w.owner].status!=='war'&&state.fleets.some(f=>f.owner==='player'&&f.route?.path.slice(1).includes(entry.systemId));},publicAlert=briefing?.entries.some(x=>x.type==='war'||x.publicAffairId&&x.type==='sovereignty'&&blocks(x));modal=state.winner?'conclusion':briefing?.reportIds.length||raceAlert||publicAlert?'briefing':newOffer?'offer':null;}commands.push({line,requestIndex:e.index,time:e.at,turnBefore:before,action,selector:e.action,status:e.status});commandResults.push({line,answer,canonicalSha256:sha(json(state))});}
function observe(e,line){const file=`observation-${String(e.index).padStart(3,'0')}.json`,o=JSON.parse(read(file));assert.equal(o.turn,e.turn);assert.equal(o.status,e.status);if(!state){observations.push({line,requestIndex:e.index,file,scope:'Default startup before actual cycle12 import; outside replay boundary'});return;}assert.equal(Number(o.turn.match(/\d+/)[0]),state.turn);const m=o.text.match(/◈\n([\d,]+)([+−-][\d,]+)\nCREDITS\n(?:income before alignment\n)?◇\n([\d,]+)([+−-][\d,]+)\nMINERALS\n✧\n([\d,]+)([+−-][\d,]+)\nSCIENCE\n⌘\n(\d+) \/ (\d+)\nORDERS/);assert.ok(m,`Visible resources in ${file}`);const stats=game.getEmpireStats(state),keys=['credits','creditIncome','minerals','mineralIncome','science','scienceIncome','orders','maxOrders'];const visible=Object.fromEntries(keys.map((k,i)=>[k,Number(m[i+1].replaceAll(',','').replace('−','-'))]));for(const k of keys)assert.equal(visible[k],stats[k],`${file} ${k}`);observations.push({line,requestIndex:e.index,file,turn:state.turn,visibleResources:visible,exact:true});}
try{
for(const[line,e]of log.entries()){
 if(e.kind==='action-complete'){
  const a=e.action,s=a.click||'';let action=null,recognized=false;
  if(s==='#confirm-import'){
   assert.equal(state,null,'Only one initial import');state=JSON.parse(inputBytes);assert.equal(state.turn,12);assert.equal(state.seed,'ASTERION');const before=json(state);victory.revealPublicBeacons(state);assert.equal(json(state),before,'Normal import public reveal leaves actual input untouched');selectedSystemId=own().capitalId;selectedFleetId=state.fleets.find(f=>f.owner==='player')?.id||null;if(fleet(selectedFleetId)?.route)selectedSystemId=fleet(selectedFleetId).systemId;validate();recognized=true;
  }else if(!state){assert.ok(a.importFile||/data-action="(?:begin|menu)"/.test(s));recognized=true;}
  else if(a.select){assert.equal(a.select.selector,'#replace-building');const name=a.select.value.label.replace(/^Replace /,'');menuReplaceId=unique(Object.entries(content.BUILDINGS).filter(([,d])=>d.name===name),'replacement building')[0];assert.ok(state.systems.find(w=>w.id===menuSystemId).buildings.includes(menuReplaceId));recognized=true;}
  else if(a.press){
   if(a.press==='Enter'){assert.equal(modal,'colonize');const prior=log.slice(0,line).findLast(x=>x.kind==='observation');assert.equal(JSON.parse(read(`observation-${String(prior.index).padStart(3,'0')}.json`)).focus.action,'colonize-confirm');action={type:'colonize',fleetId:selectedFleetId};modal=null;}
   else if(a.press==='Escape'){if(modal)modal=null;else selectedFleetId=null;}
   else if(a.press.toLowerCase()==='h'){if(!modal)selectedSystemId=own().capitalId;}
   else assert.ok(['1','2','3','4','5'].includes(a.press),`Known read-only key ${a.press}`);
   recognized=true;
  }else if(s.includes('.fleet-switch')){const m=s.match(/title="(.+) at (.+)"/),prefix=s.match(/title\^="(.+) at"/);assert.ok(m||prefix);selectFleet(m?m[1]:prefix[1],m?.[2]);recognized=true;}
  else if(s.includes('.fleet-row')||/ ×\d+/.test(s)){const name=s.match(/:has-text\("([^"]+)"\)/)?.[1];assert.ok(name);if(s.includes('#inspector')&&Object.values(content.SHIPS).some(d=>d.role===name)){const f=unique(state.fleets.filter(f=>f.owner==='player'&&f.systemId===selectedSystemId&&content.SHIPS[f.type].role===name),'own formation by visible inspector role');selectFleet(f.name);}else selectFleet(name);recognized=true;}
  else if(s.includes('aria-label="Inspect ')){selectedSystemId=world(s.match(/Inspect ([^"]+)/)[1]).id;recognized=true;}
  else if(s.includes('[data-system-select]')||s.includes('.galaxy-system-label')){selectedSystemId=world(s.match(/:has-text\("([^"]+)"\)/)[1]).id;recognized=true;}
  else if(s.includes('Plot course · free'))action={type:'planRoute',fleetId:selectedFleetId,destinationId:selectedSystemId};
  else if(s.includes('Continue · up to'))action={type:'continueRoute',fleetId:selectedFleetId};
  else if(s==='[data-action="move"]')action={type:'move',fleetId:selectedFleetId,targetId:selectedSystemId};
  else if(s==='#end-turn'){assert.equal(Number(e.turn.match(/\d+/)[0]),state.turn+1);action={type:'endTurn'};modal=null;}
  else if(s.includes('development-menu')||s.includes('build-menu')){menuSystemId=selectedSystemId;menuReplaceId=null;modal='construction';recognized=true;}
  else if(s.startsWith('.investment-option')&&s.endsWith(' summary')){assert.equal(modal,'construction');recognized=true;}
  else if(s.includes('.build-card')){
   assert.equal(modal,'construction');const name=s.match(/:has-text\("([^"]+)"\)/)[1];const charters=Object.values(game.CHARTERS).filter(c=>c.name===name);
   if(charters.length)action={type:'develop',systemId:menuSystemId,charterType:unique(charters,name).id};
   else{const defs=Object.entries({...content.BUILDINGS,...content.SHIPS}).filter(([,v])=>v.name===name);action={type:'build',systemId:menuSystemId,itemId:unique(defs,name)[0],replaceBuildingId:menuReplaceId};}modal=null;
  }else if(s.includes('.tech-card')){const name=s.match(/h3:text-is\("([^"]+)"\)/)[1];action={type:'research',techId:unique(Object.entries(content.TECHS).filter(([,t])=>t.name===name),name)[0]};}
  else if(s==='[data-action="colonize"]'){modal='colonize';recognized=true;}
  else if(s==='[data-action="fleet-hold"]')action={type:game.getFleetReadiness(state,selectedFleetId).held?'resume':'hold',fleetId:selectedFleetId};
  else if(s.includes('Merge +1')){const f=fleet(selectedFleetId),mate=unique(state.fleets.filter(g=>g.id!==f.id&&g.owner===f.owner&&g.type===f.type&&g.systemId===f.systemId&&g.ships+f.ships<=12),'sole legal local merge partner');action={type:'merge',fleetId:f.id,targetFleetId:mate.id};}
  else if(s.includes('Lead defense · 1 order'))action={type:'leadDefense',fleetId:selectedFleetId};
  else if(s==='[data-action="menu"]'){modal='menu';recognized=true;}
  else if(s.includes('Commission Vanguard')||s.includes('Commission Sovereign')){const f=fleet(selectedFleetId);assert.ok(s.includes(content.SHIPS[f.type].name));assert.equal(f.systemId,selectedSystemId);action={type:'build',systemId:selectedSystemId,itemId:f.type};}
  else if(s.includes('Repair ◇10'))action={type:'repair',fleetId:selectedFleetId};
  else if(s==='button:text-is("Engage")')action={type:'attack',fleetId:selectedFleetId};
  else if(s.includes('Battle report →')){modal='reports';recognized=true;}
  else if(s.startsWith('button:text-is("Select ')){selectFleet(s.match(/Select ([^"]+)/)[1]);modal=null;recognized=true;}
  else if(s==='[data-action="briefing"]'){modal='briefing';recognized=true;}
  else if(s==='button:text-is("Resume")')action={type:'resume',fleetId:selectedFleetId};
  else if(s.includes('[data-rival=')&&s.includes('[data-stance=')){const targetId=s.match(/data-rival="([^"]+)"/)[1],stance=s.match(/data-stance="([^"]+)"/)[1];action={type:'diplomacy',targetId,stance};}
  else if(s.includes('Review your funding')||s.includes('review-alignment')){assert.equal(modal,null);recognized=true;}
  else if(s==='.modal button:text-is("Read Chronicle")'){assert.ok(state.winner);modal=null;recognized=true;}
  else if(s==='#workspace-page button:text-is("Combat")'){assert.ok(state.winner);recognized=true;}
  else if(s.includes('Review this age')){assert.ok(state.winner);modal='conclusion';recognized=true;}
  else if(s.includes('Read expedition record')){modal='discovery';recognized=true;}
  else if((s==='[data-action="export"]'||s==='.modal [data-action="export"]')||s==='[data-tab="ship"]'||s==='[aria-label="Fit galaxy"]'){recognized=true;}
  assert.ok(action||recognized,`Unclassified receipt ${line}: ${json(a)}`);
  if(action)execute(action,e,line);else noncommands.push({line,requestIndex:e.index,action:a});
 }
 if(e.kind==='actual-ui-download'){const file=path.basename(e.path),bytes=read(file);assert.equal(json(state),json(JSON.parse(bytes)),`Exact actual export ${file}`);exports.push({line,file,turn:state.turn,bytesSha256:sha(bytes),canonicalSha256:sha(json(state)),exact:true});}
 if(e.kind==='observation')observe(e,line);
 if(state)eventHashes.push({line,requestIndex:e.index??null,kind:e.kind,turn:state.turn,canonicalSha256:sha(json(state))});
}
assert.equal(state.turn,60);assert.equal(state.winner,'player');assert.equal(state.victoryType,'Transcendence');assert.equal(exports.length,11);assert.equal(commands.filter(c=>c.action.type==='endTurn').length,48);assert.equal(log.filter(e=>e.kind==='driver-error').length,5);
const finalExports=exports.filter(e=>e.turn===60);assert.equal(finalExports.length,2);assert.equal(finalExports[0].bytesSha256,finalExports[1].bytesSha256);assert.ok(eventHashes.filter(e=>e.line>=645).every(e=>e.canonicalSha256===sha(json(state))));const ending=JSON.parse(read('ending-export-equality.json'));assert.equal(ending.sha256,finalExports[0].bytesSha256);assert.equal(ending.bytes,read(finalExports[0].file).length);
const result={scope:'One cross-version continuation of the actual ASTERION opening, beginning from unedited cycle12. No reconstruction or replay claim for cycles1–12; no continued play beyond cycle60; frozen read-only postgame receipts through request119 are included.',pin,buildPin,scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),inputSha256:sha(inputBytes),frozenLogSha256:sha(read('actions.jsonl')),logEvents:log.length,successfulActionReceipts:log.filter(e=>e.kind==='action-complete').length,commands:commands.length,commandKinds:Object.fromEntries([...new Set(commands.map(c=>c.action.type))].map(type=>[type,commands.filter(c=>c.action.type===type).length])),endTurns:48,jsonReloadNextCommandChecks:commands.length,validNonnegativeStates:validStates,exports,visibleObservationChecks:observations.filter(o=>o.exact).length,preImportObservations:observations.filter(o=>!o.exact).length,driverErrors:log.filter(e=>e.kind==='driver-error').map(e=>({index:e.index,message:e.message})),initialTurn:12,finalTurn:60,winner:state.winner,victoryType:state.victoryType,retainedCombatReports:state.combatReports.length,retainedChronicle:state.log.length,completedTechnologies:own().techs.length,ownShipsByClass:state.fleets.filter(f=>f.owner==='player').reduce((r,f)=>({...r,[f.type]:(r[f.type]||0)+f.ships}),{}),postgame:{firstWinnerCommandLine:645,lastFrozenRequest:119,firstFinalExport:finalExports[0].file,lastFinalExport:finalExports[1].file,byteIdentical:true,allPostgameEventStatesEqual:true},stats:game.getEmpireStats(state),finalCanonicalSha256:sha(json(state)),statePatches:0,unexecutedRequestedActionsApplied:0,originalFilesVerified:inputManifest.length};
write('commands.json',commands);write('command-results.json',commandResults);write('observation-checks.json',observations);write('event-state-hashes.json',eventHashes);write('noncommand-receipts.json',noncommands);write('results.json',result);
for(const f of inputManifest)assert.equal(sha(read(f.file)),f.sha256,`Frozen original unchanged ${f.file}`);assert.equal(sha(fs.readFileSync(input)),sha(inputBytes));
console.log(JSON.stringify({commands:result.commands,endTurns:48,exports:exports.map(e=>({turn:e.turn,exact:e.exact,hash:e.bytesSha256})),reloadChecks:commands.length,visibleObservations:result.visibleObservationChecks,final:result.finalCanonicalSha256},null,2));
}catch(error){write('failure.json',{message:error.message,stack:error.stack,lastCommand:commands.at(-1),selectedFleetId,selectedSystemId,modal,turn:state?.turn,exports,commandsSoFar:commands.length});throw error;}
finally{fs.rmSync(scratch,{recursive:true,force:true});}
