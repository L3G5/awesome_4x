/** Independent, fixed-seed geometry audit. Generated data is not play or enjoyment evidence. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const out=path.resolve(repo,option('--out')||'docs/mechanics-depth/map');
const candidatePin=execFileSync('git',['rev-parse',option('--candidate')||'a7c955d'],{cwd:repo,encoding:'utf8'}).trim();
const baselinePin='810194596a0fa7d02efa418749bb3e27f547229e';
const pointer='/tmp/asterion-depth-baseline-src.path';
const suppliedBaseline=option('--baseline')||(fs.existsSync(pointer)?fs.readFileSync(pointer,'utf8').trim():null);
const requested={maxNearestDiscovery:option('--max-nearest-discovery')===null?null:Number(option('--max-nearest-discovery')),maxSitesWithin2:option('--max-sites-within2')===null?null:Number(option('--max-sites-within2'))};
for(const value of Object.values(requested))assert.ok(value===null||Number.isInteger(value)&&value>0,'positive discovery bound required');
const seeds=['ASTERION',...Array.from({length:511},(_,i)=>`stage30-map-${i+1}`)];
fs.mkdirSync(out,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-map-audit-'));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function snapshot(pin,folder,archive=null){
 const graph=new Map();
 function collect(file){
  if(graph.has(file))return;
  const source=execFileSync('git',['show',`${pin}:${file}`],{cwd:repo,encoding:'utf8'});graph.set(file,source);
  for(const [,relative]of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm))if(relative.startsWith('.'))collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),relative)));
 }
 collect('src/game.js');
 const dest=path.join(scratch,folder);
 for(const [file,source]of graph){
  if(archive)assert.equal(fs.readFileSync(path.join(archive,file),'utf8'),source,'supplied baseline differs: '+file);
  const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);
 }
 fs.writeFileSync(path.join(dest,'package.json'),'{"type":"module"}\n');
 return {path:dest,files:Object.fromEntries([...graph].map(([file,source])=>[file,sha(source)]))};
}
const snapshots={candidate:snapshot(candidatePin,'reviewed-source'),baseline:snapshot(baselinePin,'baseline-source',suppliedBaseline)};
const engines={candidate:await import(pathToFileURL(path.join(snapshots.candidate.path,'src/game.js'))),baseline:await import(pathToFileURL(path.join(snapshots.baseline.path,'src/game.js')))};
const generator=await import(pathToFileURL(path.join(snapshots.candidate.path,'src/galaxy-generation.js')));
const intelligence=await import(pathToFileURL(path.join(snapshots.candidate.path,'src/intelligence.js')));
const discoveries=await import(pathToFileURL(path.join(snapshots.candidate.path,'src/discoveries.js')));
const ai=await import(pathToFileURL(path.join(snapshots.candidate.path,'src/ai.js')));
const ids=['player','veyr','khar','choir'];
const freq=xs=>xs.reduce((r,x)=>(r[x]=(r[x]||0)+1,r),{});
const stats=xs=>{const v=xs.filter(Number.isFinite).sort((a,b)=>a-b);return {count:v.length,min:v[0]??null,p10:v[Math.floor((v.length-1)*.1)]??null,median:v.length?(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2:null,p90:v[Math.floor((v.length-1)*.9)]??null,max:v.at(-1)??null,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null};};
const edgeKey=([a,b])=>[a,b].sort().join(':');
const jaccard=(a,b)=>{const left=new Set(a),right=new Set(b);return [...left].filter(x=>right.has(x)).length/new Set([...left,...right]).size;};
function graph(state){
 const adj=new Map(state.systems.map(s=>[s.id,[]]));
 for(const [a,b]of state.lanes){assert.ok(adj.has(a)&&adj.has(b));assert.notEqual(a,b);adj.get(a).push(b);adj.get(b).push(a);}
 const distances=(origin,blocked=null)=>{const result=new Map([[origin,0]]),q=[origin];for(const here of q)for(const next of adj.get(here))if(next!==blocked&&!result.has(next)){result.set(next,result.get(here)+1);q.push(next);}return result;};
 const all=new Map(state.systems.map(s=>[s.id,distances(s.id)]));
 const bridges=state.lanes.filter(([a,b])=>{const seen=new Set([a]),q=[a];for(const here of q)for(const next of adj.get(here))if(!((here===a&&next===b)||(here===b&&next===a))&&!seen.has(next)){seen.add(next);q.push(next);}return seen.size<state.systems.length;});
 const cuts=state.systems.filter(s=>{const origin=state.systems.find(t=>t.id!==s.id).id;return distances(origin,s.id).size<state.systems.length-1;}).map(s=>s.id);
 // Capital-colored, ID-independent refinement detects topological differences;
 // equal signatures are not a proof of graph isomorphism.
 let colors=new Map(state.systems.map(s=>[s.id,`${s.originalOwner||'neutral'}:${adj.get(s.id).length}`]));
 for(let pass=0;pass<8;pass++)colors=new Map(state.systems.map(s=>[s.id,sha(colors.get(s.id)+'|'+adj.get(s.id).map(id=>colors.get(id)).sort().join(',')).slice(0,24)]));
 return {adj,all,distances,bridges,cuts,signature:sha([...colors.values()].sort().join('|'))};
}
function record(state){
 const g=graph(state),worlds=new Map(state.systems.map(s=>[s.id,s]));
 assert.equal(new Set(state.lanes.map(edgeKey)).size,state.lanes.length,'duplicate edge');
 const homes=state.factions.map(f=>{
  const d=g.all.get(f.capitalId),prospects=state.systems.filter(s=>!s.owner&&s.exploredBy.includes(f.id));
  const neutral=state.systems.filter(s=>!s.owner),nearestOwn=s=>state.factions.every(other=>other.id===f.id||d.get(s.id)<g.all.get(other.capitalId).get(s.id));
  const sites=state.systems.filter(s=>s.anomaly);
  const attributes=s=>({id:s.id,name:s.name,type:s.type,habitability:s.habitability,richness:s.richness,science:s.science,degree:g.adj.get(s.id).length,outwardReach2:[...g.distances(s.id,f.capitalId)].filter(([id,jumps])=>id!==s.id&&jumps<=2).length,nearestRival:Math.min(...state.factions.filter(o=>o.id!==f.id).map(o=>g.all.get(o.capitalId).get(s.id)))});
  return {factionId:f.id,capitalId:f.capitalId,degree:g.adj.get(f.capitalId).length,neighbors:[...g.adj.get(f.capitalId)].sort(),known:state.systems.filter(s=>s.knownBy.includes(f.id)).length,surveyed:state.systems.filter(s=>s.exploredBy.includes(f.id)).map(s=>s.id),contacts:[...f.contacts],prospects:prospects.map(attributes),prospectTotal:prospects.reduce((n,s)=>n+s.richness+s.science,0),ordinaryWithin2:neutral.filter(s=>s.habitability>=50&&d.get(s.id)<=2).length,ordinaryWithin3:neutral.filter(s=>s.habitability>=50&&d.get(s.id)<=3).length,ownedCatchmentOrdinaryWithin3:neutral.filter(s=>s.habitability>=50&&d.get(s.id)<=3&&nearestOwn(s)).map(s=>s.id),recovery:neutral.filter(s=>!prospects.includes(s)&&s.habitability>=50&&d.get(s.id)<=3&&nearestOwn(s)).map(s=>({id:s.id,jumps:d.get(s.id),habitability:s.habitability})),capitalDistances:state.factions.filter(o=>o.id!==f.id).map(o=>({factionId:o.id,jumps:d.get(o.capitalId)})),nearestDiscovery:Math.min(...sites.map(s=>d.get(s.id))),discoveriesWithin2:sites.filter(s=>d.get(s.id)<=2).map(s=>({id:s.id,type:s.anomaly.id,jumps:d.get(s.id)})),portableWithin1:sites.filter(s=>!['observatory','reef'].includes(s.anomaly.id)&&d.get(s.id)<=1).length};
 });
 let minimumSeparation=Infinity;
 for(let i=0;i<state.systems.length;i++)for(let j=i+1;j<state.systems.length;j++)minimumSeparation=Math.min(minimumSeparation,Math.hypot(state.systems[i].x-state.systems[j].x,state.systems[i].y-state.systems[j].y));
 const capitalPairs=[];for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)capitalPairs.push({from:ids[i],to:ids[j],jumps:g.all.get('s'+i).get('s'+j)});
 return {seed:state.seed,edges:state.lanes.map(edgeKey).sort(),positions:state.systems.map(s=>({id:s.id,x:s.x,y:s.y})),connected:[...g.all.values()].every(d=>d.size===42),edgeCount:state.lanes.length,maxDegree:Math.max(...[...g.adj.values()].map(a=>a.length)),diameter:Math.max(...[...g.all.values()].flatMap(d=>[...d.values()])),minimumSeparation,capitalPairs,bridges:g.bridges.map(edgeKey),articulationPoints:g.cuts,topologySignature:g.signature,homes,discoveries:state.systems.filter(s=>s.anomaly).map(s=>({id:s.id,type:s.anomaly.id,nearestCapital:Math.min(...state.factions.map(f=>g.all.get(f.capitalId).get(s.id)))}))};
}
const rows=[],validation=[],started=Date.now();
for(const seed of seeds){
 const current=engines.candidate.createGame(seed),old=engines.baseline.createGame(seed),layout=generator.generateGalaxyLayout(seed);
 assert.deepEqual(current,engines.candidate.createGame(seed),'repeated candidate generation '+seed);
 assert.equal(engines.candidate.validateSave(current),true);
 assert.equal(engines.baseline.validateSave(old),true);
 const candidate=record(current),baseline=record(old);
 const discoveryProbe=structuredClone(current),probeRng=discoveryProbe.rng;
 const initialSurveyIds=current.systems.filter(system=>!system.owner&&ids.some(id=>system.exploredBy.includes(id))).map(system=>system.id);
 const discoveryPlacementDiagnostics=discoveries.placeDiscoveries(discoveryProbe,initialSurveyIds)||null;
 assert.equal(discoveryProbe.rng,probeRng,'discovery placement must not draw combat RNG');
 assert.deepEqual(discoveryProbe.systems.map(system=>system.anomaly),current.systems.map(system=>system.anomaly),'placement diagnostic reproduces actual sites');
 assert.deepEqual(current.lanes,layout.lanes);
 const candidateBounds={connected:candidate.connected,worlds:current.systems.length===42,edgeRange:candidate.edgeCount>=52&&candidate.edgeCount<=64,homeDegrees:candidate.homes.every(h=>h.degree>=2&&h.degree<=4),maxDegree:candidate.maxDegree<=6,capitalTravel:candidate.capitalPairs.every(p=>p.jumps>=5&&p.jumps<=13),diameter:candidate.diameter<=18,separation:candidate.minimumSeparation>=6.3,localKnowledge:candidate.homes.every(h=>h.prospects.length===2&&h.surveyed.length===3&&h.prospects.every(p=>h.neighbors.includes(p.id)&&p.habitability>=30)&&h.prospects.some(p=>p.habitability>=60)),recovery:candidate.homes.every(h=>h.recovery.length>0),prospectResources:candidate.homes.every(h=>(h.prospects[0].richness-h.prospects[1].richness)*(h.prospects[0].science-h.prospects[1].science)<0),resourceSpread:Math.max(...candidate.homes.map(h=>h.prospectTotal))-Math.min(...candidate.homes.map(h=>h.prospectTotal))<=4,discoveryCount:candidate.discoveries.length===10,stagedCount:['observatory','reef'].every(type=>candidate.discoveries.filter(d=>d.type===type).length===1),ordinaryDeck:['archive','pilgrims','forge','garden','echo','wreck'].every(type=>{const n=candidate.discoveries.filter(d=>d.type===type).length;return n>=1&&n<=2;}),noProspectDiscovery:candidate.homes.every(h=>h.prospects.every(p=>!current.systems.find(s=>s.id===p.id).anomaly)),noInitialContacts:candidate.homes.every(h=>h.contacts.length===0)};
 if(requested.maxNearestDiscovery!==null)candidateBounds.discoveryAccessFloor=candidate.homes.every(h=>h.nearestDiscovery<=requested.maxNearestDiscovery);
 if(requested.maxSitesWithin2!==null)candidateBounds.discoveryTwoHopCap=candidate.homes.every(h=>h.discoveriesWithin2.length<=requested.maxSitesWithin2);
 validation.push({seed,failures:Object.entries(candidateBounds).filter(([,ok])=>!ok).map(([name])=>name)});
 const oldPoints=baseline.positions.slice(4),newPoints=candidate.positions.slice(4);
 const pointDistance=(a,b)=>a.reduce((n,p)=>n+Math.min(...b.map(q=>Math.hypot(p.x-q.x,p.y-q.y))),0)/a.length;
 rows.push({seed,attempts:layout.attempts,fallback:layout.fallback,discoveryPlacementDiagnostics,candidate,baseline,comparison:{edgeJaccard:jaccard(candidate.edges,baseline.edges),idDisplacementMean:newPoints.reduce((n,p,i)=>n+Math.hypot(p.x-oldPoints[i].x,p.y-oldPoints[i].y),0)/38,unlabeledPointDistance:(pointDistance(oldPoints,newPoints)+pointDistance(newPoints,oldPoints))/2}});
}
const paidSettlements=[];
for(const seed of seeds.slice(0,32)){
 const state=engines.candidate.createGame(seed);
 for(const faction of state.factions){
  const ark=state.fleets.find(f=>f.owner===faction.id&&f.type==='colony');
  const target=state.systems.filter(s=>!s.owner&&s.exploredBy.includes(faction.id)&&s.habitability>=60).sort((a,b)=>b.habitability-a.habitability||b.science-a.science||a.id.localeCompare(b.id))[0];
  const before={credits:faction.credits,minerals:faction.minerals,orders:faction.orders,rng:state.rng};
  const move=engines.candidate.command(state,{type:'move',factionId:faction.id,fleetId:ark.id,targetId:target.id});
  const found=engines.candidate.command(state,{type:'colonize',factionId:faction.id,fleetId:ark.id});
  assert.equal(move.ok,true);assert.equal(found.ok,true);assert.equal(faction.credits,before.credits-30);assert.equal(faction.minerals,before.minerals-20);assert.equal(faction.orders,before.orders-2);assert.equal(state.rng,before.rng);assert.equal(target.owner,faction.id);assert.equal(target.population,1);assert.equal(state.fleets.some(f=>f.id===ark.id),false);assert.equal(engines.candidate.validateSave(state),true);
  paidSettlements.push({seed,factionId:faction.id,targetId:target.id,habitability:target.habitability,creditsPaid:30,mineralsPaid:20,ordersPaid:2,arkConsumed:true,randomStateUnchanged:true});
 }
}
const privacy=[];
for(const seed of seeds.slice(0,16)){
 const original=engines.candidate.createGame(seed),changed=structuredClone(original),faction=changed.factions[0];
 const prospect=changed.systems.find(s=>!s.owner&&s.exploredBy.includes('player'));
 const enemy=changed.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');Object.assign(enemy,{systemId:prospect.id,ships:12,hp:34*12});
 assert.equal(intelligence.hasSensors(changed,'player',prospect.id),false);assert.equal(intelligence.getVisibleFleets(changed,'player',prospect.id).length,0);assert.deepEqual(changed.factions[0].contacts,[]);
 const hidden=changed.systems.filter(s=>!s.exploredBy.includes('player')&&!s.owner);
 for(const s of hidden){s.habitability=s.habitability>=50?15:90;s.richness=6-s.richness;s.science=5-s.science;assert.equal(discoveries.getDiscoveryView(changed,s.id),null);assert.deepEqual(discoveries.getDiscoveryOptions(changed,s.id),[]);}
 // Isolate free research selection and forecasts before any movement can reveal information.
 original.factions[0].orders=0;faction.orders=0;
 ai.runAI(original,original.factions[0]);ai.runAI(changed,faction);
 assert.deepEqual(original.factions[0],faction);assert.equal(original.rng,changed.rng);
 const guarded=engines.candidate.createGame(seed);guarded.factions[0].orders=0;
 for(const system of guarded.systems.filter(s=>!s.owner&&!s.exploredBy.includes('player')))for(const key of ['habitability','richness','science','population','buildings'])Object.defineProperty(system,key,{get(){throw new Error('Read hidden '+system.id+'.'+key);}});
 ai.runAI(guarded,guarded.factions[0]);
 privacy.push({seed,surveyDoesNotGrantSensors:true,hiddenFleetNotContacted:true,unsurveyedDiscoveryQueriesEmpty:true,hiddenNativeMutationsDoNotChangeInitialResearch:true,guardedNativeReadsPass:true});
}
function summary(version){
 const rs=rows.map(r=>r[version]),homes=rs.flatMap(r=>r.homes),sites=rs.flatMap(r=>r.discoveries);
 const baseEdges=rs[0].edges;
 return {maps:rs.length,edgeCount:stats(rs.map(r=>r.edgeCount)),diameter:stats(rs.map(r=>r.diameter)),capitalTravel:stats(rs.flatMap(r=>r.capitalPairs.map(p=>p.jumps))),separation:stats(rs.map(r=>r.minimumSeparation)),bridges:stats(rs.map(r=>r.bridges.length)),articulationPoints:stats(rs.map(r=>r.articulationPoints.length)),maxDegree:stats(rs.map(r=>r.maxDegree)),uniqueCapitalColoredRefinementSignatures:new Set(rs.map(r=>r.topologySignature)).size,uniqueConcordNeighborSets:new Set(rs.map(r=>r.homes[0].neighbors.join(','))).size,uniqueHomeDegreeTuples:new Set(rs.map(r=>r.homes.map(h=>h.degree).join(','))).size,homeDegreeCounts:freq(homes.map(h=>h.degree)),capitalDistanceVectors:new Set(rs.map(r=>r.capitalPairs.map(p=>p.jumps).join(','))).size,edgeJaccardAgainstFirstMap:stats(rs.slice(1).map(r=>jaccard(baseEdges,r.edges))),initialKnown:stats(homes.map(h=>h.known)),initialSurveyed:stats(homes.map(h=>h.surveyed.length)),ordinaryWithin2:stats(homes.map(h=>h.ordinaryWithin2)),ordinaryWithin3:stats(homes.map(h=>h.ordinaryWithin3)),nearestDiscovery:stats(homes.map(h=>h.nearestDiscovery)),discoveriesWithin2:stats(homes.map(h=>h.discoveriesWithin2.length)),portableWithin1:stats(homes.map(h=>h.portableWithin1)),discoveryPositionSets:new Set(rs.map(r=>r.discoveries.map(s=>s.id).join(','))).size,distinctDiscoveryWorlds:new Set(sites.map(s=>s.id)).size,discoveryTypeCounts:freq(sites.map(s=>s.type)),prospectResources:homes.some(h=>h.prospects.length)?stats(homes.map(h=>h.prospectTotal)):null,prospectClimateCounts:homes.some(h=>h.prospects.length)?freq(homes.map(h=>h.prospects.map(p=>p.habitability>=50?'ordinary':'ecology').sort().join(','))):{}};
}
const starts=rows.flatMap(r=>r.candidate.homes.map(h=>({seed:r.seed,...h})));
const worst={fewestOrdinaryWithin3:[...starts].sort((a,b)=>a.ordinaryWithin3-b.ordinaryWithin3||a.ownedCatchmentOrdinaryWithin3.length-b.ownedCatchmentOrdinaryWithin3.length||a.seed.localeCompare(b.seed)).slice(0,8),longestFirstDiscovery:[...starts].sort((a,b)=>b.nearestDiscovery-a.nearestDiscovery||a.seed.localeCompare(b.seed)).slice(0,8),richestDiscoveryCluster:[...starts].sort((a,b)=>b.discoveriesWithin2.length-a.discoveriesWithin2.length||a.seed.localeCompare(b.seed)).slice(0,8),mostIsolated:[...starts].sort((a,b)=>Math.min(...b.capitalDistances.map(d=>d.jumps))-Math.min(...a.capitalDistances.map(d=>d.jumps))||a.seed.localeCompare(b.seed)).slice(0,8),highestRetry:[...rows].sort((a,b)=>b.attempts-a.attempts).slice(0,8).map(r=>({seed:r.seed,attempts:r.attempts,fallback:r.fallback}))};
const uiA=rows.find(r=>{const h=r.candidate.homes[0],ore=[...h.prospects].sort((a,b)=>b.richness-a.richness)[0];return ore.habitability<50&&h.ordinaryWithin2<=2&&h.recovery.every(p=>p.jumps>=2);});
const uiB=rows.find(r=>{const h=r.candidate.homes[0];return h.prospects.every(p=>p.habitability>=50)&&Math.abs(h.prospects[0].outwardReach2-h.prospects[1].outwardReach2)>=3;});
const result={candidateCommit:candidatePin,baselineCommit:baselinePin,baselineArchive:suppliedBaseline,sourceHashes:{candidate:snapshots.candidate.files,baseline:snapshots.baseline.files},method:'512 fixed seeds: ASTERION then stage30-map-1..511. Independent adjacency/BFS/bridge/cut/refinement calculations inspect actual serialized states. Coordinate-independent signatures are diagnostics, not a fun score or a proof of graph isomorphism. No end turns, played campaigns or new win-rate sample. Paid founding and knowledge mutations are separately labeled controlled command drills.',acceptanceProfile:requested,runtime:process.version,elapsedSeconds:(Date.now()-started)/1000,seeds,summary:{candidate:summary('candidate'),baseline:summary('baseline'),attempts:stats(rows.map(r=>r.attempts)),attemptHistogram:freq(rows.map(r=>r.attempts)),fallbackSeeds:rows.filter(r=>r.fallback).map(r=>r.seed),discoveryPlacementDiagnostics:{skippedDenseTotal:rows.reduce((n,r)=>n+(r.discoveryPlacementDiagnostics?.skippedDense||0),0),skippedDense:stats(rows.map(r=>r.discoveryPlacementDiagnostics?.skippedDense).filter(Number.isFinite)),startsWithoutSiteWithin3:rows.flatMap(r=>r.candidate.homes).filter(h=>h.nearestDiscovery>3).length,startsOver3SitesWithin2:rows.flatMap(r=>r.candidate.homes).filter(h=>h.discoveriesWithin2.length>3).length},failures:validation.filter(r=>r.failures.length),pairedEdgeJaccard:stats(rows.map(r=>r.comparison.edgeJaccard)),neutralIdDisplacement:stats(rows.map(r=>r.comparison.idDisplacementMean)),unlabeledPointDistance:stats(rows.map(r=>r.comparison.unlabeledPointDistance)),paidFoundingDrills:paidSettlements.length,privacyDrills:privacy.length},worstStarts:worst,uiSelection:{ruleA:'First declared seed whose Concord ore prospect requires Ecology, ordinary worlds within2 <=2, and recovery is at least2 jumps away.',ruleB:'First declared seed with both Concord prospects ordinarily habitable and their capital-avoiding2-hop outward reach differs by at least3.',A:uiA?{seed:uiA.seed,home:uiA.candidate.homes[0]}:null,B:uiB?{seed:uiB.seed,home:uiB.candidate.homes[0]}:null},paidSettlements,privacy,rows};
const resultBytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(out,'audit-results.json.gz'),gzipSync(resultBytes,{level:9}));
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({candidateCommit:candidatePin,baselineCommit:baselinePin,files:result.sourceHashes,auditScriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),resultsOriginalBytes:resultBytes.length,resultsOriginalSha256:sha(resultBytes),method:'Engine import graphs reconstructed from Git in temporary directories and removed after audit. No reviewed source copies are bundled.'},null,2)+'\n');fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({candidateCommit:candidatePin,baselineCommit:baselinePin,method:result.method,acceptanceProfile:requested,summary:result.summary,worstStarts:worst,uiSelection:result.uiSelection},null,2)+'\n');
console.log(JSON.stringify({candidateCommit:candidatePin,summary:result.summary,uiSelection:result.uiSelection},null,2));
if(result.summary.failures.length)process.exitCode=1;
