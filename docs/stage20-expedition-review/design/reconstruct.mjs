import fs from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,command,endTurn,getEmpireStats,getVisibleSystems,getBuildOptions,getNeighbors,estimateCombat,validateSave} from './engine/src/game.js';
import {getVisibleFleets,hasSensors} from './engine/src/intelligence.js';
import {getPublicRaces} from './engine/src/victory.js';
import {auditQueries as q} from './engine/src/ai.js';
const base=path.dirname(fileURLToPath(import.meta.url)),evidence=base+'/inputs';
const trace=JSON.parse(fs.readFileSync(evidence+'/commands.json')),state=createGame('ASTERION-WATCH-14'),snapshots=[],entries=[],actions=[];
const copy=x=>JSON.parse(JSON.stringify(x));let serial=0;
function safe(s,f){
 const own=s.fleets.filter(x=>x.owner===f.id),races=getPublicRaces(s,f.id),intervention=q.raceIntervention(s,f,true),threats=q.threatsToColonies(s,f),objective=q.selectObjective(s,f,threats),rally=q.selectRally(s,f,objective,threats);
 return {turn:s.turn,observer:f.id,resources:{credits:f.credits,minerals:f.minerals,science:f.science,orders:f.orders},research:f.research,techs:f.techs,strategy:f.strategy,relations:f.relations,stats:getEmpireStats(s,f.id),ownColonies:s.systems.filter(w=>w.owner===f.id).map(w=>({id:w.id,name:w.name,buildings:w.buildings,queue:w.queue})),ownFleets:own.map(x=>({...x,power:q.strength(s,x)})),observedForeignFleets:getVisibleFleets(s,f.id).filter(x=>x.owner!==f.id),charted:getVisibleSystems(s,f.id).map(w=>({id:w.id,name:w.name,owner:w.owner,sensors:hasSensors(s,f.id,w.id)})),knownLanes:s.lanes.filter(([a,b])=>s.systems.find(w=>w.id===a).knownBy.includes(f.id)&&s.systems.find(w=>w.id===b).knownBy.includes(f.id)),publicRaces:races,threats:threats.map(x=>({colonyId:x.colony.id,sourceId:x.sourceId,here:x.here,nearby:x.nearby,required:x.required,stationed:x.stationed})),objectiveId:objective?.id,rallyId:rally?.id,selectedIntervention:intervention?{fleetId:intervention.fleet.id,targetId:intervention.race.factionId,systemId:intervention.site.id,path:intervention.travel.path,cost:intervention.travel.cost,arrivalCycles:intervention.arrivalCycles}:null,ownParticipantCombatReports:s.combatReports.filter(r=>r.participants.some(p=>p.owner===f.id)||r.invasion?.ownerBefore===f.id)};
}
globalThis.__watchAudit=(point,s,f,action,result)=>{
 if(s.turn<51||s.turn>59||!['veyr','choir'].includes(f.id))return;
 const id=serial++,record={id,point,turn:s.turn,factionId:f.id,action,result};
 snapshots.push({...record,state:copy(s)});
 const projected={...record,view:copy(safe(s,f))};
 if(point==='entry')entries.push(projected);else actions.push(projected);
};
for(const receipt of trace){const answer=receipt.action.type==='endTurn'?endTurn(state):command(state,receipt.action);assert.ok(answer.ok);assert.ok(validateSave(state));}
const actual=JSON.parse(fs.readFileSync(evidence+'/actual-cycle60.json'));assert.equal(JSON.stringify(state),JSON.stringify(actual),'Logging-only replay still matches actual final export');
fs.writeFileSync(base+'/derived-snapshots.json.gz',gzipSync(JSON.stringify(snapshots)));
fs.writeFileSync(base+'/attacker-entry-views.json',JSON.stringify(entries,null,2)+'\n');fs.writeFileSync(base+'/attacker-action-views.json',JSON.stringify(actions,null,2)+'\n');
const proof={label:'Replay-derived diagnostic states, not actual UI exports',commands:trace.length,finalExportExact:true,finalHash:createHash('sha256').update(JSON.stringify(state)).digest('hex'),entryPoints:entries.length,commandObserverPoints:actions.length};fs.writeFileSync(base+'/reconstruction-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
for(const item of actions.filter(x=>x.point==='before'&&['move','attack'].includes(x.action.type)))console.log(JSON.stringify({id:item.id,turn:item.turn,actor:item.factionId,action:item.action,own:item.view.ownFleets.map(f=>({id:f.id,at:f.systemId,ships:f.ships,power:f.power,moves:f.movesLeft})),sensors:item.view.charted.filter(w=>w.sensors).map(w=>w.id),seen:item.view.observedForeignFleets.map(f=>({id:f.id,owner:f.owner,at:f.systemId,ships:f.ships,hp:f.hp})),expedition:item.view.selectedIntervention}));
