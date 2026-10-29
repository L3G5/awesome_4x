import fs from 'node:fs';
import crypto from 'node:crypto';
import {createGame,getNeighbors,getEmpireStats,getResearchOptions,validateSave,endTurn} from '/home/leg/projects/awesome_4x/src/game.js';
import {runAI} from '/home/leg/projects/awesome_4x/src/ai.js';
const root='/home/leg/projects/awesome_4x';
const seeds=['ASTERION','ASTERION-ODYSSEY-20','ASTERION-WATCH-14',...Array.from({length:61},(_,i)=>`replayability-review-${i+1}`)];
const edgeKey=([a,b])=>[a,b].sort().join(':');
const freq=values=>values.reduce((out,x)=>(out[x]=(out[x]||0)+1,out),{});
const range=values=>({min:Math.min(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)});
function distances(state,origin){ const d={[origin]:0},queue=[origin];for(const x of queue)for(const y of getNeighbors(state,x))if(!(y in d)){d[y]=d[x]+1;queue.push(y);} return d; }
const maps=seeds.map(seed=>{
 const state=createGame(seed), d=distances(state,'s0'), edges=state.lanes.map(edgeKey).sort(),neighbours=getNeighbors(state,'s0');
 return {seed,edges,coordinates:state.systems.map(s=>({id:s.id,x:s.x,y:s.y})),capitalNeighbors:neighbours,initialKnown:state.systems.filter(s=>s.knownBy.includes('player')).map(s=>s.id),initialSurveyed:state.systems.filter(s=>s.exploredBy.includes('player')).map(s=>s.id),firstBoostedNeighbor:neighbours.find(id=>!state.systems.find(s=>s.id===id).owner),homeDistance:Object.fromEntries(['s1','s2','s3'].map(id=>[id,d[id]])),worldsWithinTwo:state.systems.filter(s=>s.id!=='s0'&&d[s.id]<=2).map(s=>({id:s.id,name:s.name,jumps:d[s.id],habitability:s.habitability,richness:s.richness,science:s.science,anomaly:s.anomaly?.id||null})),anomalies:state.systems.filter(s=>s.anomaly).map(s=>({id:s.id,name:s.name,type:s.anomaly.id,jumps:d[s.id],habitability:s.habitability})),valid:validateSave(state)};
});
const allEdges=new Set(maps.flatMap(m=>m.edges)),edgeCounts=freq(maps.flatMap(m=>m.edges)),jaccard=maps.slice(1).map(m=>{const base=new Set(maps[0].edges),current=new Set(m.edges);return [...base].filter(e=>current.has(e)).length/new Set([...base,...current]).size;});
const coordinateSpread=maps[0].coordinates.map((s,i)=>({id:s.id,maxDisplacementFromDefault:Math.max(...maps.map(m=>Math.hypot(m.coordinates[i].x-s.x,m.coordinates[i].y-s.y)))}));
const summary={count:maps.length,edgeCount:range(maps.map(m=>m.edges.length)),uniqueEdges:allEdges.size,alwaysEdges:Object.entries(edgeCounts).filter(([k,v])=>v===maps.length).map(([k])=>k),edgeJaccardVsDefault:range(jaccard),capitalNeighborSets:freq(maps.map(m=>m.capitalNeighbors.slice().sort().join(','))),firstBoostedNeighbors:freq(maps.map(m=>m.firstBoostedNeighbor)),initialKnownSets:freq(maps.map(m=>m.initialKnown.join(','))),initialSurveyedSets:freq(maps.map(m=>m.initialSurveyed.join(','))),capitalDistances:Object.fromEntries(['s1','s2','s3'].map(id=>[id,range(maps.map(m=>m.homeDistance[id]))])),colonizableWithinTwo:range(maps.map(m=>m.worldsWithinTwo.filter(s=>s.habitability>=50).length)),anomalySlotSets:freq(maps.map(m=>m.anomalies.map(a=>a.id).join(','))),nearAnomalyTypes:freq(maps.flatMap(m=>m.anomalies.filter(a=>a.jumps<=2).map(a=>a.type))),coordinateSpread,allValid:maps.every(m=>m.valid)};
const runs=[];
for(const seed of seeds.slice(0,12)){
 const state=createGame(seed), observations=[],firstTech={},firstColony={},firstProtocol={},firstBeacon={},allTechs={};
 while(!state.winner&&state.turn<100){
  const player=state.factions.find(f=>f.id==='player');
  runAI(state,player);endTurn(state);
  for(const f of state.factions){
   if(f.techs.length&&!firstTech[f.id])firstTech[f.id]={turn:state.turn,tech:f.techs[0]};
   if(state.systems.filter(s=>s.owner===f.id).length>1&&!firstColony[f.id])firstColony[f.id]={turn:state.turn,worlds:state.systems.filter(s=>s.owner===f.id&&!s.originalOwner).map(s=>s.id)};
   if(f.techs.includes('singularity')&&!firstProtocol[f.id])firstProtocol[f.id]=state.turn;
   if(state.systems.some(s=>s.owner===f.id&&s.buildings.includes('beacon'))&&!firstBeacon[f.id])firstBeacon[f.id]=state.turn;
   if(f.techs.length===12&&!allTechs[f.id])allTechs[f.id]=state.turn;
  }
  if([10,20,30,40,50,60,70,80,90,100].includes(state.turn))observations.push({turn:state.turn,factions:state.factions.map(f=>({id:f.id,techOrder:[...f.techs],research:f.research?.techId||null,colonies:state.systems.filter(s=>s.owner===f.id).map(s=>s.id),stats:getEmpireStats(state,f.id),alignment:f.alignment||null}))});
  if(!validateSave(state))throw new Error(`invalid ${seed} ${state.turn}`);
 }
 const player=state.factions.find(f=>f.id==='player');
 runs.push({seed,turn:state.turn,winner:state.winner,victoryType:state.victoryType,firstTech,firstColony,firstProtocol,firstBeacon,allTechs,observations,finalPlayerStats:getEmpireStats(state),finalPlayerTechOrder:player.techs,discoveryDecisions:state.systems.filter(s=>s.anomaly?.history?.length).map(s=>({id:s.id,history:s.anomaly.history.map(h=>({turn:h.turn,factionId:h.factionId,choiceId:h.choiceId}))}))});
}
const campaignSummary={count:runs.length,method:'Player and rivals use shared runAI through normal command API; fixed policy and ordinary traits. Outcomes characterize this policy only, not optimal play or human fun.',outcomes:freq(runs.map(r=>r.winner+':'+r.victoryType)),finish:range(runs.map(r=>r.turn)),playerFirstTech:freq(runs.map(r=>r.firstTech.player?.tech||'none')),playerFirstColony:freq(runs.map(r=>r.firstColony.player?.worlds.join(',')||'none')),playerTechOrders:freq(runs.map(r=>r.finalPlayerTechOrder.join(','))),playerProtocol:range(runs.map(r=>r.firstProtocol.player).filter(Number.isFinite)),playerAllTechs:runs.map(r=>({seed:r.seed,turn:r.allTechs.player||null,finish:r.turn})),playerObservedExploredAt30:runs.map(r=>({seed:r.seed,explored:r.observations.find(o=>o.turn===30)?.factions.find(f=>f.id==='player').stats.explored||null})),finalPlayerColonies:range(runs.map(r=>r.finalPlayerStats.colonies))};
const paths=['src/game.js','src/content.js','src/development.js','src/discoveries.js','src/ai.js','src/victory.js'];
const sources=Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(root+'/'+p)).digest('hex')]));
fs.writeFileSync('/tmp/asterion-critique-replayability/audit-results.json',JSON.stringify({sourceCommit:'93a62961e994994d30c05240b17c39a418020473',sources,seeds,mapSummary:summary,maps,campaignSummary,runs},null,2)+'\n');
console.log(JSON.stringify({mapSummary:summary,campaignSummary},null,2));
