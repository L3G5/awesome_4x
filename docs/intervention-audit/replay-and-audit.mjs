/** Reproduce the actual Stage 6 UI campaign, then audit clearly labeled branches.
 * Run from a checkout with the archived commit available:
 * node replay-and-audit.mjs --repo /path/to/awesome_4x --output /tmp/intervention-reproduced
 * Writes only to --output and a temporary engine directory. No repository edits.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const repo=path.resolve(option('--repo',process.cwd()));
const output=path.resolve(option('--output',path.join(here,'reproduced')));
fs.mkdirSync(output,{recursive:true});
const sourceCommit=fs.readFileSync(path.join(here,'source-commit.txt'),'utf8').trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const canonical=v=>JSON.stringify(sorted(v));
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2));
const run=(command,args,input)=>{const r=spawnSync(command,args,{input,maxBuffer:30_000_000});if(r.status!==0)throw Error(String(r.stderr)||`${command} exited ${r.status}`);return r.stdout;};
const archive=run('git',['-C',repo,'archive',sourceCommit,'src','package.json']);
const engine=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-intervention-engine-'));
run('tar',['-x','-C',engine],archive);
const engineSourceHashes=Object.fromEntries(['ai.js','game.js','diplomacy.js','victory.js','intelligence.js'].map(name=>[name,sha(fs.readFileSync(path.join(engine,'src',name)))]));
// Export pure diagnostic helpers in this disposable copy; function bodies stay unchanged.
fs.appendFileSync(path.join(engine,'src/ai.js'),'\nexport { raceIntervention, route, strength, threatsToColonies };\n');
const load=name=>import(pathToFileURL(path.join(engine,'src',name)).href);
const {command,endTurn,validateSave,getEmpireStats,getNeighbors,getVisibleSystems}=await load('game.js');
const {runAI,raceIntervention,route,strength,threatsToColonies}=await load('ai.js');
const {getPublicRaces,getAlignmentStatus}=await load('victory.js');
const {getDiplomacyForecast}=await load('diplomacy.js');
const {hasSensors,getVisibleFleets}=await load('intelligence.js');
const {SHIPS}=await load('content.js');
const state=JSON.parse(fs.readFileSync(path.join(here,'campaign-start-cycle40.json')));
const expected=JSON.parse(fs.readFileSync(path.join(here,'campaign-final-cycle67.json')));
const system=name=>state.systems.find(s=>s.name===name).id;
const actionLog=[], snapshots=[];
const act=a=>{const result=command(state,a);actionLog.push({turn:state.turn,a,result});if(!result.ok)throw Error(`T${state.turn} ${JSON.stringify(a)}: ${result.message}`);};
const move=(fleetId,name)=>act({type:'move',fleetId,targetId:system(name)});
const build=(name,itemId,replaceBuildingId)=>act({type:'build',systemId:system(name),itemId,...(replaceBuildingId?{replaceBuildingId}:{} )});
const research=techId=>act({type:'research',techId});
const actions={
40:()=>{build('Sundrift','mine');build('Elysian','lab');move('f46','Kepler');},
41:()=>{act({type:'colonize',fleetId:'f46'});build('Kepler','mine');move('f48','Haven');},
42:()=>{act({type:'develop',systemId:system('Solace'),charterType:'forge'});move('f3','Halcyon');move('f1','Nyx');move('f1','Seraph');move('f48','Kepler');},
43:()=>{move('f3','Elysian');move('f1','Lumen');move('f48','Tethys');act({type:'colonize',fleetId:'f48'});},
44:()=>{build('Tethys','mine');build('Sundrift','factory');build('Haven','mine');},
45:()=>{act({type:'diplomacy',targetId:'khar',stance:'gift'});act({type:'diplomacy',targetId:'khar',stance:'trade'});build('Solace','frigate');},
46:()=>{move('f52','Sundrift');build('Solace','frigate');},
49:()=>{research('command');build('Sundrift','beacon','market');},
50:()=>{build('Elysian','beacon','market');},
52:()=>{move('f1','Ophion');},
53:()=>{build('Solace','beacon','market');research('cruisers');},
54:()=>{build('Haven','shipyard');},
56:()=>{research('terraforming');build('Sundrift','shipyard','mine');},
57:()=>{build('Haven','frigate');},
58:()=>{build('Solace','cruiser');build('Sundrift','cruiser');},
60:()=>{move('f67','Solace');act({type:'merge',fleetId:'f67',targetFleetId:'f54'});build('Haven','frigate');},
61:()=>{build('Solace','cruiser');build('Sundrift','cruiser');},
63:()=>{act({type:'planRoute',fleetId:'f73',destinationId:system('Elysian')});act({type:'continueRoute',fleetId:'f73'});},
64:()=>{act({type:'continueRoute',fleetId:'f73'});},
};
while(!state.winner&&state.turn<67){snapshots.push({turn:state.turn,phase:'beforePlayer',state:structuredClone(state)});actions[state.turn]?.();snapshots.push({turn:state.turn,phase:'beforeAI',state:structuredClone(state)});endTurn(state);if(!validateSave(state))throw Error('invalid '+state.turn);}

assert.deepStrictEqual(state,expected,'Full replayed ending must equal the actual UI export');
const observed=JSON.parse(fs.readFileSync(path.join(here,'observed-resource-bars.json')));
for(const row of observed.rows){const sample=row.turn===67?state:snapshots.find(x=>x.turn===row.turn&&x.phase==='beforePlayer').state;const player=sample.factions.find(f=>f.id==='player');assert.deepStrictEqual([player.credits,player.minerals,player.science],[row.credits,row.minerals,row.science],`Observed resource bar at ${row.turn}`);}
for(const turn of [60,63,64])write(`verified-cycle${turn}-before-ai.json`,snapshots.find(x=>x.turn===turn&&x.phase==='beforeAI').state);
write('replayed-final.json',state);
write('replay-actions.json',actionLog);
const provenance={sourceCommit,sourceArchiveSha256:sha(archive),engineSourceHashes,initialCheckpointSha256:sha(fs.readFileSync(path.join(here,'campaign-start-cycle40.json'))),actualFinalExportSha256:sha(fs.readFileSync(path.join(here,'campaign-final-cycle67.json'))),replayedCanonicalStateSha256:sha(canonical(state)),actualCanonicalStateSha256:sha(canonical(expected)),exactFullStateMatch:true,playerCommands:actionLog.length,observedResourceBarsMatched:observed.rows.length,sourceObservedRecordSha256:observed.sourceRecordSha256,turn:state.turn,winner:state.winner,victoryType:state.victoryType,method:'Archived Stage 6 engine; 43 normal player commands reconstructed from UI decisions; all rival turns ordinary runAI; no grants or state edits. Counterfactuals below fork this verified replay and are not the played campaign.'};
write('provenance.json',provenance);
const results=[];
for(const snap of snapshots.filter(x=>x.phase==='beforeAI'&&x.turn>=48&&x.turn<=66)){
 const s=structuredClone(snap.state), name=id=>s.systems.find(x=>x.id===id)?.name;
 for(const f of s.factions.filter(f=>f.id!=='player')){
  const race=getPublicRaces(s,f.id).find(r=>r.factionId==='player'), threats=threatsToColonies(s,f);
  const candidate=raceIntervention(s,f,true), forecast=getDiplomacyForecast(s,f.id,'player');
  const fleets=s.fleets.filter(g=>g.owner===f.id&&SHIPS[g.type].attack>3).map(g=>({id:g.id,at:name(g.systemId),type:g.type,ships:g.ships,hp:g.hp,moves:g.movesLeft,power:strength(s,g),paths:(race?.participatingSites||[]).map(siteId=>{
   const r=route(s,f,g,siteId,{interventionOwner:'player'}), guards=getVisibleFleets(s,f.id,siteId).filter(other=>other.owner==='player').reduce((a,b)=>a+strength(s,b),0);
   return {target:name(siteId),sensors:hasSensors(s,f.id,siteId),observedGuard:guards,qualifies:g.movesLeft>0&&strength(s,g)>=30&&guards*1.18<=strength(s,g)&&r&&r.path.length-1<=race.target-race.progress,path:r?.path.map(name)||null,cost:r?.cost??null};
  })}));
  results.push({turn:s.turn,faction:f.id,race:race?.progress||0,ownProgress:f.alignment?.progress||0,ownActive:f.alignment?.active||false,orders:f.orders,credits:f.credits,minerals:f.minerals,stats:getEmpireStats(s,f.id),warAllowed:forecast.war.enabled,warReason:forecast.war.reason,trade:forecast.trade,relations:Object.fromEntries(Object.entries(f.relations).map(([id,r])=>[id,{status:r.status,trade:r.trade,truceUntil:r.truceUntil||0,trust:r.trust}])),threats:threats.map(t=>({world:t.colony.name,here:t.here,nearby:t.nearby,required:t.required,stationed:t.stationed,source:name(t.sourceId)})),candidate:candidate?{faction:candidate.race.factionId,site:candidate.site.name,fleet:candidate.fleet.id,path:candidate.travel.path.map(name)}:null,fleets,charted:getVisibleSystems(s,f.id).map(w=>w.name)});
  runAI(s,f);
 }
}

write('decision-audit.json',results);
const snaps=snapshots;
const outcomes=[];
for(const targetName of ['Solace','Sundrift','Elysian']){
 const state=structuredClone(snaps.find(x=>x.phase==='beforeAI'&&x.turn===60).state), target=state.systems.find(w=>w.name===targetName), timeline=[];
 const name=id=>state.systems.find(w=>w.id===id)?.name;
 const act=a=>{const result=command(state,a);timeline.push({turn:state.turn,action:a,result});if(!result.ok)throw Error(JSON.stringify({a,result}));return result;};
 act({type:'diplomacy',factionId:'veyr',targetId:'player',stance:'war'});
 let arrived=false;
 while(state.turn<=66&&!state.winner){
  if(state.turn===61)for(const n of ['Solace','Sundrift'])act({type:'build',systemId:state.systems.find(w=>w.name===n).id,itemId:'cruiser'});
  if(state.turn===63){const own=state.fleets.find(f=>f.owner==='player'&&name(f.systemId)==='Haven'&&f.type==='frigate');if(own){act({type:'move',fleetId:own.id,targetId:state.systems.find(w=>w.name==='Solace').id});if(state.fleets.includes(own))act({type:'move',fleetId:own.id,targetId:state.systems.find(w=>w.name==='Halcyon').id});}}
  if(state.turn===64){const own=state.fleets.find(f=>f.owner==='player'&&name(f.systemId)==='Halcyon'&&f.type==='frigate');if(own)act({type:'move',fleetId:own.id,targetId:state.systems.find(w=>w.name==='Elysian').id});}
  const f=state.factions.find(x=>x.id==='veyr');
  for(let jump=0;jump<2;jump++){
   const fleet=state.fleets.find(x=>x.id==='f59');if(!fleet||fleet.movesLeft<=0||f.orders<=0)break;
   const travel=route(state,f,fleet,target.id,{interventionOwner:'player'});
   if(!travel||travel.path.length<2){timeline.push({turn:state.turn,stop:travel?'arrived':'observed opposition or no legal route',fleet:{...fleet}});break;}
   act({type:'move',factionId:'veyr',fleetId:fleet.id,targetId:travel.path[1]});
   if(fleet.systemId===target.id){arrived=true;timeline.push({turn:state.turn,arrival:{target:targetName,alive:state.fleets.includes(fleet),fleet:{...fleet},guard:state.fleets.filter(g=>g.owner==='player'&&g.systemId===target.id),alignment:getAlignmentStatus(state),veyr:getEmpireStats(state,'veyr')}});break;}
  }
  if(arrived||!state.fleets.some(x=>x.id==='f59'))break;
  endTurn(state);if(!validateSave(state))throw Error('invalid fork');
 }
 const arrival=timeline.find(x=>x.arrival)?.arrival;
 const result={label:'Counterfactual normal-command reachability branch; not the played campaign',startTurn:60,target:targetName,turn:state.turn,arrived,arrival,finalAlignment:getAlignmentStatus(state),timeline};
 outcomes.push(result);write(`counterfactual-veyr-${targetName.toLowerCase()}.json`,result);
}

write('counterfactual-summary.json',outcomes.map(x=>({label:x.label,target:x.target,startTurn:x.startTurn,turn:x.turn,arrived:x.arrived,alive:x.arrival?.alive??false,remainingHP:x.arrival?.fleet.hp??0,alignmentBlocked:Boolean(x.arrival?.alignment.reason.includes('Hostile')),arrivalGuard:x.arrival?.guard.map(f=>({type:f.type,ships:f.ships,hp:f.hp}))??[]})));
fs.rmSync(engine,{recursive:true,force:true});
console.log(JSON.stringify({output,provenance,counterfactuals:outcomes.map(x=>({target:x.target,turn:x.turn,arrived:x.arrived,alive:x.arrival?.alive??false}))},null,2));
