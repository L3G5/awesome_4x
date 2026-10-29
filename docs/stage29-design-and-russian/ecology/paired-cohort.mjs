import fs from 'node:fs';
import crypto from 'node:crypto';
import * as baseline from '/tmp/asterion-ecology-baseline/src/game.js';
import * as candidate from '/tmp/asterion-ecology-priority/src/game.js';
import {getEarlyEcologyPlan} from '/tmp/asterion-ecology-priority/src/ai.js';
const out='/tmp/asterion-ecology-evidence';
const seeds=['ASTERION',...Array.from({length:19},(_,i)=>`stage4-audit-${i+1}`)];
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sourceFiles=['ai.js','game.js','content.js','development.js','discoveries.js','victory.js','navigation.js','diplomacy.js','intelligence.js'];
const sourceHashes=Object.fromEntries(['baseline','candidate'].map(version=>[version,Object.fromEntries(sourceFiles.map(name=>[name,hash(fs.readFileSync(`/tmp/asterion-ecology-${version==='baseline'?'baseline':'priority'}/src/${name}`,'utf8'))]))]));
const researchState=(state,id)=>{const f=state.factions.find(f=>f.id===id);return {id,techs:[...f.techs],research:f.research?{...f.research}:null,colonies:state.systems.filter(s=>s.owner===id).map(s=>s.id)};};
const runs=[], started=Date.now();
for(const seed of seeds){
 const states={baseline:baseline.createGame(seed),candidate:candidate.createGame(seed)};
 if(hash(states.baseline)!==hash(states.candidate))throw new Error('generation changed');
 const frames=[], opportunities=[], starts={baseline:[],candidate:[]}, milestones={baseline:[],candidate:[]};let firstDifference=null;
 while(Object.values(states).some(state=>!state.winner&&state.turn<120)){
  const before=Object.fromEntries(Object.entries(states).map(([v,s])=>[v,structuredClone(s)]));
  for(const version of ['baseline','candidate']){
   const state=states[version];if(state.winner||state.turn>=120)continue;
   const plans=state.factions.filter(f=>f.id!=='player').map(f=>({factionId:f.id,plan:getEarlyEcologyPlan(state,f.id)})).filter(p=>p.plan);
   opportunities.push(...plans.map(p=>({version,turn:state.turn,...p,own:researchState(state,p.factionId)})));
   const old=state.factions.map(f=>({id:f.id,research:f.research,techs:[...f.techs]}));
   (version==='baseline'?baseline:candidate).endTurn(state);
   if(!(version==='baseline'?baseline:candidate).validateSave(state))throw new Error(`invalid ${version} ${seed} ${state.turn}`);
   for(const f of state.factions){
    if([f.credits,f.minerals,f.science,f.orders].some(x=>!Number.isFinite(x)||x<0))throw new Error('invalid resources');
    const previous=old.find(o=>o.id===f.id);
    if(!previous.research&&(f.research||f.techs.length>previous.techs.length))starts[version].push({turn:state.turn-1,factionId:f.id,techId:f.research?.techId||f.techs.find(t=>!previous.techs.includes(t))});
   }
  }
  for(const version of ['baseline','candidate']) {
   const previous=before[version], state=states[version];
   if(previous.winner)continue;
   for(const f of state.factions.filter(f=>f.id!=='player')) {
    const old=previous.factions.find(o=>o.id===f.id), events=[];
    for(const techId of f.techs.filter(t=>!old.techs.includes(t)))events.push({type:'research',techId});
    for(const system of state.systems.filter(s=>s.owner===f.id&&previous.systems.find(o=>o.id===s.id).owner!==f.id))events.push({type:'colony',systemId:system.id,previousOwner:previous.systems.find(o=>o.id===system.id).owner,habitability:system.habitability});
    for(const fleet of state.fleets.filter(a=>a.owner===f.id&&a.type==='colony'&&!previous.fleets.some(o=>o.id===a.id)))events.push({type:'ark',fleetId:fleet.id,systemId:fleet.systemId});
    if(events.length)milestones[version].push({turn:state.turn,factionId:f.id,events,stats:(version==='baseline'?baseline:candidate).getEmpireStats(state,f.id)});
   }
  }
  const hashes=Object.fromEntries(Object.entries(states).map(([v,s])=>[v,hash(s)]));
  frames.push({turn:Math.max(states.baseline.turn,states.candidate.turn),hashes});
  if(!firstDifference&&hashes.baseline!==hashes.candidate){
   firstDifference={turn:Math.min(states.baseline.turn,states.candidate.turn),beforePlans:Object.fromEntries(Object.entries(before).map(([v,s])=>[v,s.factions.filter(f=>f.id!=='player').map(f=>({factionId:f.id,plan:getEarlyEcologyPlan(s,f.id)})).filter(p=>p.plan)])),research:Object.fromEntries(Object.entries(states).map(([v,s])=>[v,s.factions.filter(f=>f.id!=='player').map(f=>researchState(s,f.id))]))};
   const prefix=out+'/'+seed+'-first-difference';
   fs.writeFileSync(prefix+'-before.json',JSON.stringify(before,null,2)+'\n');
   fs.writeFileSync(prefix+'-after.json',JSON.stringify(states,null,2)+'\n');
  }
 }
 const final=Object.fromEntries(Object.entries(states).map(([v,s])=>[v,{turn:s.turn,winner:s.winner,victoryType:s.victoryType,hash:hash(s),factions:s.factions.map(f=>({id:f.id,stats:(v==='baseline'?baseline:candidate).getEmpireStats(s,f.id),techs:f.techs}))}]));
 runs.push({seed,firstDifference,opportunities,starts,milestones,frames,final});
}
for(const [version,files] of Object.entries(sourceHashes))for(const [name,expected]of Object.entries(files))if(hash(fs.readFileSync(`/tmp/asterion-ecology-${version==='baseline'?'baseline':'priority'}/src/${name}`,'utf8'))!==expected)throw new Error('source changed');
const summary={seeds:seeds.length,firstStateDifferences:runs.filter(r=>r.firstDifference).map(r=>({seed:r.seed,turn:r.firstDifference.turn})),qualifyingPreTurnWindows:runs.reduce((n,r)=>n+r.opportunities.length,0),candidateQualifyingPreTurnWindows:runs.reduce((n,r)=>n+r.opportunities.filter(o=>o.version==='candidate').length,0),equalFinalStates:runs.filter(r=>r.final.baseline.hash===r.final.candidate.hash).length,outcomeChanges:runs.filter(r=>r.final.baseline.winner!==r.final.candidate.winner||r.final.baseline.victoryType!==r.final.candidate.victoryType).map(r=>r.seed)};
fs.writeFileSync(out+'/paired-cohort.json',JSON.stringify({baselineCommit:'93a62961e994994d30c05240b17c39a418020473',seeds,sourceHashes,method:'Twenty predeclared standard seeds, paired passive-player campaigns. Only rivals act, ordinary commands and traits. Each completed cycle validates saves and finite nonnegative budgets. Source hashes checked before and after. Opportunity queries occur just before the shared end-turn phase, so they are pre-turn diagnostics, not an exact action log of later sequential rival turns. Full before/after states are retained at the first divergence only. No sample expansion was performed.',elapsedSeconds:(Date.now()-started)/1000,summary,runs},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
