import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(arg('--repo','/home/leg/projects/awesome_4x'));
const original=path.resolve(arg('--original','/tmp/asterion-odyssey20'));
const out=path.resolve(arg('--out',root));
const enginePin='fe09832333e98886568beb6e3a07c84bccbb285b',integratedPin='47e037308271ff3d3ac0d1fc870a889cdf0a67c4';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value);
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',maxBuffer:20e6});
const read=name=>fs.readFileSync(path.join(original,name));
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
const originalManifest=JSON.parse(read('original-evidence-manifest.json'));
assert.equal(hash(read('original-evidence-manifest.json')),'1833ec839e140261d922df8a8498ba54efc5b2ad8d6b6fdc18f26091a8b22a79');
for(const item of originalManifest.files){const bytes=read(item.file);assert.equal(bytes.length,item.bytes,item.file);assert.equal(hash(bytes),item.sha256,item.file);}
const record=JSON.parse(read('record.json')),observations=read('observations.ndjson').toString().trim().split('\n').map(line=>JSON.parse(line));
assert.equal(record.seed,'ASTERION-ODYSSEY-20');assert.equal(record.events.length,782);
assert.deepEqual(record.errors,[]);assert.equal(read('browser-errors.ndjson').length,0);
const graph=new Map();
function collect(file){if(graph.has(file))return;const source=git('show',`${enginePin}:${file}`);assert.equal(source,git('show',`${integratedPin}:${file}`),`Integrated engine ${file}`);graph.set(file,source);for(const [,specifier]of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)){assert.ok(specifier.startsWith('.'));collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)));}}
collect('src/game.js');assert.equal(graph.size,14);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-odyssey-replay-'));
for(const [file,source]of graph){const dest=path.join(scratch,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source);}fs.writeFileSync(path.join(scratch,'package.json'),'{"type":"module"}\n');
const game=await import(pathToFileURL(path.join(scratch,'src/game.js')));
const frozenBuild=JSON.parse(read('frozen-build.json'));
const buildDirectory=path.resolve(arg('--frozen-build',frozenBuild.directory));
for(const item of frozenBuild.files)assert.equal(hash(fs.readFileSync(path.join(buildDirectory,item.file))),item.sha256,`Frozen served asset ${item.file}`);
const build=JSON.parse(fs.readFileSync(path.join(buildDirectory,'build-info.json')));assert.equal(build.commit,integratedPin);assert.equal(build.version,'0.20.0');
write('source-pin.json',{enginePin,integratedPin,files:Object.fromEntries([...graph].sort().map(([name,source])=>[name,hash(source)])),uiMainSha256:hash(git('show',`${integratedPin}:src/main.js`)),frozenBuild,build,buildInfoSha256:hash(fs.readFileSync(path.join(buildDirectory,'build-info.json')))});

let state=null,selectedFleetId=null,selectedSystemId=null,seedInput=null;
const fleet=id=>state.fleets.find(f=>f.id===id);
const own=()=>state.factions.find(f=>f.id==='player');
const commands=[],checkpoints=[],answers=[],normalizations=[],ignoredInteractions=[],eventStates=[],observationChecks=[],visibleEventStates=[];
let reloadChecks=0,validStates=0;
// This is the original driver's recorded read-only schema, applied to replayed
// state. It does not supply any information to the command reconstruction.
function visible(s){
 const p=s.factions.find(f=>f.id==='player');
 const sensorIds=new Set(s.systems.filter(w=>w.owner==='player').map(w=>w.id));for(const f of s.fleets)if(f.owner==='player')sensorIds.add(f.systemId);
 const known=s.systems.filter(w=>w.knownBy.includes('player')||w.exploredBy.includes('player')||w.owner==='player'),knownIds=new Set(known.map(w=>w.id));
 return {seed:s.seed,turn:s.turn,winner:s.winner,victoryType:s.victoryType,ownFaction:{credits:p.credits,minerals:p.minerals,science:p.science,orders:p.orders,techs:p.techs,research:p.research,contacts:p.contacts,relations:p.relations,alignment:p.alignment},systems:known.map(w=>({id:w.id,name:w.name,x:w.x,y:w.y,owner:!w.owner||w.owner==='player'||p.contacts.includes(w.owner)?w.owner:'unknown',surveyed:w.exploredBy.includes('player'),sensor:sensorIds.has(w.id),...(sensorIds.has(w.id)?{type:w.type,habitability:w.habitability,richness:w.richness,science:w.science}:{}),...(w.owner==='player'?{population:w.population,growth:w.growth,buildings:w.buildings,charter:w.charter,queue:w.queue,defenseDamage:w.defenseDamage,anomaly:w.anomaly?{id:w.anomaly.id,resolved:w.anomaly.resolved}:null}:{} )})),fleets:s.fleets.filter(f=>f.owner==='player'||sensorIds.has(f.systemId)).map(f=>({id:f.id,owner:f.owner,name:f.name,systemId:f.systemId,type:f.type,ships:f.ships,hp:f.hp,defenseLead:f.defenseLead===true,...(f.owner==='player'?{movesLeft:f.movesLeft,route:f.route,heritage:f.heritage,hold:f.hold===true}:{} )})),lanes:s.lanes.filter(([a,b])=>knownIds.has(a)&&knownIds.has(b)),publicRaces:s.factions.filter(f=>f.id==='player'||p.contacts.includes(f.id)).map(f=>({id:f.id,name:f.name,progress:f.alignment?.progress||0,active:Boolean(f.alignment?.active),beacons:s.systems.filter(w=>w.owner===f.id&&w.buildings.includes('beacon')&&knownIds.has(w.id)).map(w=>({id:w.id,name:w.name}))}))};
}
const welcome=game.createGame('ASTERION');
function validate(){assert.ok(game.validateSave(state));for(const f of state.factions)for(const key of ['credits','minerals','science','orders'])assert.ok(Number.isFinite(f[key])&&f[key]>=0);validStates++;}
function selectFleet(id){const f=fleet(id);assert.ok(f&&f.owner==='player',`Selected own fleet ${id}`);selectedFleetId=id;selectedSystemId=f.systemId;}
function execute(action,event,eventIndex){
 const beforeTurn=state.turn;
 assert.equal(Number(event.cycle.match(/\d+/)[0]),beforeTurn+(action.type==='endTurn'?1:0),`Receipt turn at ${eventIndex}`);
 const restored=copy(state),apply=s=>action.type==='endTurn'?game.endTurn(s):game.command(s,action);
 const answer=apply(state),reloaded=apply(restored);assert.ok(answer.ok,`event ${eventIndex}: ${answer.message}`);
 assert.deepEqual(answer,reloaded,`Reload result ${eventIndex}`);assert.equal(json(state),json(restored),`Reload full state ${eventIndex}`);reloadChecks++;validate();
 if(action.type!=='endTurn'){
   const expected=answer.combatReports?.length?`${answer.combatReports.length} combat report${answer.combatReports.length>1?'s':''} recorded.`:answer.message;
   assert.equal(event.status,expected,`UI status at ${eventIndex}`);
   if(action.type==='split'&&answer.newFleetId){selectedFleetId=answer.newFleetId;selectedSystemId=fleet(selectedFleetId).systemId;}
   if(['move','continueRoute'].includes(action.type)&&fleet(action.fleetId))selectedSystemId=fleet(action.fleetId).systemId;
   if(selectedFleetId&&!fleet(selectedFleetId))selectedFleetId=null;
 }
 commands.push({eventIndex,time:event.time,turnBefore:beforeTurn,action,uiStatus:event.status??null,uiSelector:event.action?.click??null,actualControl:event.action?.actualControl??null});
 answers.push({eventIndex,result:answer,canonicalSha256:hash(json(state))});
}
try{
for(const [eventIndex,event]of record.events.entries()){
 if(event.kind==='command'){assert.deepEqual(event.command,{type:'endTurn'});assert.ok(state);execute({type:'endTurn'},event,eventIndex);}
 if(event.kind==='interaction'){
  const a=event.action,attrs=a.actualControl?.attributes||{},type=attrs['data-action'];
  if(a.fill==='#galaxy-seed')seedInput=a.value;
  if(type==='new-game-confirm'){
   assert.equal(state,null,'Only the initial new-campaign action is allowed');assert.equal(seedInput,record.seed);state=game.createGame(seedInput);selectedSystemId='s0';selectedFleetId=state.fleets.find(f=>f.owner==='player'&&f.type==='scout').id;validate();
   normalizations.push({eventIndex,type:'initialization',note:'Default ASTERION welcome was inspected but never played. Actual new-game confirmation initializes the recorded ODYSSEY seed before any gameplay command.'});
  }else if(state){
   let action=null;
   if(attrs['data-fleet'])selectFleet(attrs['data-fleet']);
   else if(attrs['data-system-select'])selectedSystemId=attrs['data-system-select'];
   else switch(type){
    case 'home':selectedSystemId=own().capitalId;break;
    case 'inspect':case 'report-inspect':selectedSystemId=attrs['data-system'];break;
    case 'report-select-fleet':selectFleet(attrs['data-fleet-target']);break;
    case 'move':action={type:'move',fleetId:selectedFleetId,targetId:attrs['data-target']};break;
    case 'colonize-confirm':action={type:'colonize',fleetId:selectedFleetId};break;
    case 'research':action={type:'research',techId:attrs['data-tech']};break;
    case 'build':action={type:'build',systemId:attrs['data-system'],itemId:attrs['data-item'],replaceBuildingId:attrs['data-replace']||null};break;
    case 'develop':action={type:'develop',systemId:attrs['data-system'],charterType:attrs['data-charter']};break;
    case 'anomaly-choice':action={type:'anomaly',systemId:attrs['data-system'],choiceId:attrs['data-choice'],replaceBuildingId:attrs['data-replace']||null};break;
    case 'diplomacy':case 'trade-response':case 'peace-response':case 'diplomatic-confirm':action={type:'diplomacy',targetId:attrs['data-target'],stance:attrs['data-stance'],...(attrs['data-offer']?{offerId:attrs['data-offer']}:{} )};break;
    case 'fleet-hold':{
      const id=attrs['data-fleet-target'],held=game.getFleetReadiness(state,id).held;
      assert.equal(attrs['aria-pressed'],String(held));action={type:held?'resume':'hold',fleetId:id};break;
    }
    case 'defense-lead-toggle':{const id=attrs['data-fleet-target'];action={type:fleet(id).defenseLead?'clearDefenseLead':'leadDefense',fleetId:id};break;}
    case 'plan-route':action={type:'planRoute',fleetId:selectedFleetId,destinationId:attrs['data-destination']};break;
    case 'continue-route':action={type:'continueRoute',fleetId:selectedFleetId};break;
    case 'clear-route':action={type:'clearRoute',fleetId:selectedFleetId};break;
    case 'repair':action={type:'repair',fleetId:selectedFleetId};break;
    case 'merge':case 'merge-confirm':action={type:'merge',fleetId:attrs['data-fleet-target']||selectedFleetId,targetFleetId:attrs['data-target']};break;
    case 'reinforce':{
      const f=fleet(attrs['data-fleet-target']);assert.equal(f.id,selectedFleetId);assert.equal(f.systemId,selectedSystemId);
      action={type:'build',systemId:f.systemId,itemId:f.type};break;
    }
   }
   if(action){assert.ok(!Object.hasOwn(attrs,'disabled'),`Disabled action ${eventIndex}`);execute(action,event,eventIndex);}
   else {
    assert.ok([undefined,'begin','anomaly','colonize','home','build-menu','construction-tab','fleet-roster','close-modal','development-menu','reset-view','combat-report','merge-menu','peace-confirmation','menu','show-conclusion','conclusion-chronicle'].includes(type),`Unclassified UI action ${type} at ${eventIndex}`);
    ignoredInteractions.push({eventIndex,uiAction:type||null,selector:a.click||a.select||a.fill||a.key||null});
   }
  }
 }
 if(event.kind==='export'){
  const file=`checkpoints/${path.basename(event.path)}`,bytes=read(file),expected=JSON.parse(bytes);
  assert.equal(json(state),json(expected),`Actual export event ${eventIndex}: ${file}`);
  checkpoints.push({eventIndex,time:event.time,file,sha256:hash(bytes),canonicalSha256:hash(json(expected)),turn:state.turn,exact:true});
 }
 if(state)eventStates.push({eventIndex,time:event.time,turn:state.turn,canonicalSha256:hash(json(state))});
 const view=visible(state||welcome),viewHash=hash(json(view));
 visibleEventStates.push({eventIndex,time:event.time,seed:view.seed,turn:view.turn,sha256:viewHash});
 if(event.kind==='observation'&&event.view){assert.equal(json(view),json(event.view),`Recorded visible observation ${eventIndex}`);observationChecks.push({source:'record.json',eventIndex,turn:view.turn,seed:view.seed,sha256:viewHash,exact:true});}
}
for(const [observationIndex,receipt]of observations.entries())if(receipt.result?.view){
 const previous=visibleEventStates.findLast(e=>e.time<=receipt.time),expected=hash(json(receipt.result.view));
 assert.equal(previous.sha256,expected,`Client observation ${observationIndex} after event ${previous.eventIndex}`);
 observationChecks.push({source:'observations.ndjson',observationIndex,eventIndex:previous.eventIndex,turn:previous.turn,seed:previous.seed,sha256:expected,exact:true});
}
assert.ok(state.winner);assert.equal(state.turn,66);assert.equal(state.winner,'player');assert.equal(state.victoryType,'Transcendence');
assert.equal(commands.filter(c=>c.action.type==='endTurn').length,65);assert.equal(checkpoints.length,16);
const finalBytes=read('checkpoints/cycle66.json');assert.equal(hash(finalBytes),'98b961e2ea588ee7c6ffadcabdeb1a947515f489101262951916dd851122610b');assert.equal(json(state),json(JSON.parse(finalBytes)));
const stats=game.getEmpireStats(state),p=own();
const result={seed:record.seed,enginePin,integratedPin,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),originalManifestSha256:hash(read('original-evidence-manifest.json')),originalFilesVerified:originalManifest.files.length,recordSha256:hash(read('record.json')),observationsSha256:hash(read('observations.ndjson')),observationReceipts:observations.length,commands:commands.length,commandKinds:Object.fromEntries([...new Set(commands.map(c=>c.action.type))].map(type=>[type,commands.filter(c=>c.action.type===type).length])),endTurns:65,jsonReloadChecks:reloadChecks,validNonnegativeStates:validStates,exportChecks:checkpoints.length,actualExportFiles:new Set(checkpoints.map(c=>c.file)).size,uniqueExportHashes:new Set(checkpoints.map(c=>c.sha256)).size,checkpoints,turn:state.turn,winner:state.winner,victoryType:state.victoryType,finalCanonicalSha256:hash(json(state)),finalActualExportSha256:hash(finalBytes),stats,playerResources:{credits:p.credits,minerals:p.minerals,science:p.science,orders:p.orders},races:state.factions.map(f=>({id:f.id,progress:f.alignment?.progress??0})),driverErrorCount:record.events.filter(e=>e.kind==='driver-error').length,pageErrors:record.errors,normalizations,scope:'One actual UI campaign faithfully replayed; no state patches, grants, counterfactuals or new outcome sample.'};
result.observationChecks={record:observationChecks.filter(x=>x.source==='record.json').length,client:observationChecks.filter(x=>x.source==='observations.ndjson').length,initialWelcomeChecks:observationChecks.filter(x=>x.seed==='ASTERION').length,exact:true};
result.completedTechnologies=p.techs.length;
result.playerShipCounts=state.fleets.filter(f=>f.owner==='player').reduce((counts,f)=>({...counts,[f.type]:(counts[f.type]||0)+f.ships}),{});
result.retainedCombatReports=state.combatReports.map(report=>({id:report.id,operationTurn:report.turn,outcome:report.outcome,rounds:report.rounds?.length??0}));
result.postgameReadOnly={firstExportEvent:757,laterExportEvents:[777,779],byteIdentical:checkpoints.filter(c=>c.turn===66).every(c=>c.sha256===hash(finalBytes)),stateUnchanged:eventStates.filter(e=>e.eventIndex>=757).every(e=>e.canonicalSha256===hash(json(state)))};
write('commands.json',commands);write('command-results.json',answers);write('event-state-hashes.json',eventStates);write('results.json',result);write('noncommand-interactions.json',ignoredInteractions);write('observation-checks.json',observationChecks);
for(const item of originalManifest.files)assert.equal(hash(read(item.file)),item.sha256,`Original remains unchanged: ${item.file}`);
console.log(JSON.stringify({commands:result.commands,endTurns:result.endTurns,exports:result.exportChecks,reloadChecks,final:result.finalCanonicalSha256,stats:result.stats},null,2));
}catch(error){write('failure.json',{message:error.message,stack:error.stack,lastCommand:commands.at(-1),stateTurn:state?.turn,commandsSoFar:commands.length,checkpoints});throw error;}
finally{fs.rmSync(scratch,{recursive:true,force:true});}
