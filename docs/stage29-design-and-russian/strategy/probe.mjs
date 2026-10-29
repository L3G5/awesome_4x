import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createGame,command,endTurn,getEmpireStats,getInfrastructure,getSystemYield,validateSave} from '/home/leg/projects/awesome_4x/src/game.js';
import {getDiplomacyForecast} from '/home/leg/projects/awesome_4x/src/diplomacy.js';
import {getPublicRaces} from '/home/leg/projects/awesome_4x/src/victory.js';
const root='/home/leg/projects/awesome_4x';
const read=p=>JSON.parse(fs.readFileSync(root+'/'+p));
const copy=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const apply=(s,a)=>a.type==='endTurn'?endTurn(s):command(s,a);
const output={method:'Read-only source review and current-baseline replay-derived measurements of existing actual UI transcripts; counterfactual forks are separately labeled. No new human-play sample.',pin:'93a62961e994994d30c05240b17c39a418020473'};
let s=read('docs/default-campaign/actual/input-actual-cycle12-v0.21.0.json');
const cmds=read('docs/default-campaign/replay/final/commands.json');
const ends=[],research=[],builds=[],declarations=[];
for(const c of cmds){
 assert.equal(c.turnBefore,s.turn);
 if(c.action.type==='endTurn'){
  const f=s.factions.find(f=>f.id==='player'),stats=getEmpireStats(s);
  ends.push({cycle:s.turn,ordersUnused:f.orders,maxOrders:stats.maxOrders,credits:f.credits,minerals:f.minerals,science:f.science,scienceIncome:stats.scienceIncome,techs:f.techs.length,activeResearch:f.research?.techId||null,colonies:stats.colonies,military:stats.military,queuedOwnedProjects:s.systems.filter(w=>w.owner==='player'&&w.queue).map(w=>w.queue.itemId),alignment:f.alignment.progress});
 }
 if(c.action.type==='research')research.push({cycle:s.turn,tech:c.action.techId});
 if(['build','develop','colonize'].includes(c.action.type))builds.push({cycle:s.turn,action:c.action});
 const before=copy(s),oldLog=before.nextLogId;
 const r=apply(s,c.action);assert.ok(r.ok,JSON.stringify(c)+r.message);assert.ok(validateSave(s));
 if(c.action.type==='endTurn') for(const event of s.log.filter(l=>l.id>=oldLog&&l.type==='war'&&l.targetId)){
  const rivalBefore=before.factions.find(f=>f.id===event.targetId),rivalAfter=s.factions.find(f=>f.id===event.targetId);
  if(rivalBefore?.relations.player.status==='peace'&&rivalAfter?.relations.player.status==='war')declarations.push({viewedAt:s.turn,operationsCycle:event.turn,rival:event.targetId,publicPlayerAlignmentBefore:before.factions.find(f=>f.id==='player').alignment.progress,relationBefore:rivalBefore.relations.player,relationAfter:rivalAfter.relations.player,recordedMessage:event.text,privateAfterStrategyForReviewerOnly:rivalAfter.strategy});
 }
}
assert.deepEqual(s,read('docs/default-campaign/actual/109-asterion-reach-cycle-60.json'));
output.defaultReplay={commands:cmds.length,ends:ends.length,exactFinalActualExport:true,finalHash:sha(s),endCycleCheckpoints:ends,research,builds,declarations};
s=createGame('ASTERION-ODYSSEY-20');
const odyssey=read('docs/odyssey-playtest/replay/commands.json');
const peaces=[];let preFinalPeace=null;
for(const c of odyssey){
 assert.equal(s.turn,c.turnBefore);
 if(c.action.type==='diplomacy'&&c.action.stance==='peace'){
  const p=getDiplomacyForecast(s,'player',c.action.targetId).peace;
  peaces.push({cycle:s.turn,target:c.action.targetId,publicRaces:getPublicRaces(s).map(r=>({factionId:r.factionId,progress:r.progress,active:r.active})),forecast:p});
  if(s.turn===65&&!preFinalPeace)preFinalPeace=copy(s);
 }
 const r=apply(s,c.action);assert.ok(r.ok,JSON.stringify(c)+r.message);assert.ok(validateSave(s));
}
assert.deepEqual(s,read('docs/odyssey-playtest/actual/checkpoints/cycle66.json'));
output.odysseyReplay={commands:odyssey.length,exactFinalActualExport:true,finalHash:sha(s),peaceCommands:peaces};
fs.writeFileSync('/tmp/asterion-critique-strategy/replay-derived-before-final-peace.json',JSON.stringify(preFinalPeace,null,2)+'\n');
const withoutPeace=copy(preFinalPeace);
for(const c of odyssey.slice(odyssey.findIndex(c=>c.turnBefore===65&&c.action.type==='diplomacy'&&c.action.stance==='peace'))){
 if(c.action.type==='diplomacy'&&c.action.stance==='peace')continue;
 const r=apply(withoutPeace,c.action);assert.ok(r.ok,r.message);
}
output.counterfactualOmitFinalPeace={kind:'counterfactual ordinary-command fork from replay-derived actual cycle65; no save patches',winner:withoutPeace.winner,turn:withoutPeace.turn,alignment:withoutPeace.factions.find(f=>f.id==='player').alignment.progress,credits:withoutPeace.factions.find(f=>f.id==='player').credits,meaning:'Single-cycle test only: does not establish what further war would do.'};
const synthetic=copy(preFinalPeace);
const target=synthetic.factions.find(f=>f.id==='veyr'),player=synthetic.factions.find(f=>f.id==='player');
const beacon=synthetic.systems.find(w=>w.id===player.alignment.sites[0]);
synthetic.fleets=synthetic.fleets.filter(f=>!(f.owner==='player'&&f.systemId===beacon.id));
const vFleet=synthetic.fleets.find(f=>f.owner==='veyr'&&f.type==='frigate');
assert.ok(vFleet);vFleet.systemId=beacon.id;vFleet.movesLeft=1;
if(!beacon.knownBy.includes('veyr'))beacon.knownBy.push('veyr');
if(!beacon.exploredBy.includes('veyr'))beacon.exploredBy.push('veyr');
assert.ok(validateSave(synthetic));
const occupied=copy(synthetic),boughtPeace=copy(synthetic);
const accepted=command(boughtPeace,{type:'diplomacy',targetId:'veyr',stance:'peace'});assert.ok(accepted.ok);
endTurn(occupied);endTurn(boughtPeace);
output.syntheticOccupiedBeacon={kind:'Synthetic valid fixture derived from cycle65: remove player defenders at first beacon; place an existing Veyr frigate there. Not an actual event or likely outcome.',peaceForecast:getDiplomacyForecast(synthetic,'player','veyr').peace,withoutSettlement:{winner:occupied.winner,turn:occupied.turn,progress:occupied.factions.find(f=>f.id==='player').alignment.progress},withSettlement:{winner:boughtPeace.winner,turn:boughtPeace.turn,progress:boughtPeace.factions.find(f=>f.id==='player').alignment.progress},valid:true};
fs.writeFileSync('/tmp/asterion-critique-strategy/probe-results.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({defaultCommands:cmds.length,odysseyCommands:odyssey.length,exactActuals:true,declarations,unusedOrderMedian:ends.map(e=>e.ordersUnused).sort((a,b)=>a-b)[24],post50:ends.filter(e=>e.cycle>=50).map(e=>({cycle:e.cycle,ordersUnused:e.ordersUnused,techs:e.techs,activeResearch:e.activeResearch,science:e.science,queuedOwnedProjects:e.queuedOwnedProjects})),odysseyPeace:peaces.map(p=>({cycle:p.cycle,target:p.target,accepted:p.forecast.accepted,warAge:p.forecast.willingness.warAge,playerProgress:p.publicRaces.find(r=>r.factionId==='player').progress})),withoutFinalPeace:output.counterfactualOmitFinalPeace,synthetic:output.syntheticOccupiedBeacon},null,2));
