import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createGame,command,endTurn,validateSave} from './engine/src/game.js';
const root=path.dirname(fileURLToPath(import.meta.url)),read=n=>fs.readFileSync(path.join(root,n));
const hash=b=>createHash('sha256').update(b).digest('hex');
const transcript=JSON.parse(read('commands.json')),provenance=JSON.parse(read('provenance.json')),pin=JSON.parse(read('source-pin.json'));
for(const [name,sha]of Object.entries(pin.files))assert.equal(hash(read('engine/'+name)),sha,`Engine source: ${name}`);
for(const name of ['record','observations'])assert.equal(hash(gunzipSync(read(`../provenance/${name==='record'?'record.json':'observations.ndjson'}.gz`))),provenance[name+'Sha256']);
const raw=JSON.parse(gunzipSync(read('../provenance/record.json.gz')));
const derived=[];
for(const [eventIndex,event]of raw.events.entries()){
 const original=event.kind==='command'?event.command:event.action?.command;
 if(!original||original.type==='newCampaign')continue;
 const action=structuredClone(original);
 for(const change of provenance.normalizations.filter(x=>x.eventIndex===eventIndex)){assert.equal(action[change.field],change.recorded);action[change.field]=change.actual;}
 derived.push({eventIndex,turnBefore:Number(event.cycle.split(' ').at(-1))-(action.type==='endTurn'),action,uiStatus:event.status??null,uiSelector:event.action?.click??null});
}
assert.deepEqual(derived,transcript,'Commands derive only from original UI receipts plus explicit normalization');
const state=createGame(provenance.seed),checks=[...provenance.checkpointEvents],checkResults=[];
const compare=check=>{const bytes=read(check.file);assert.equal(hash(bytes),check.sha256);assert.equal(JSON.stringify(state),JSON.stringify(JSON.parse(bytes)),`Exact full-state export at event${check.eventIndex}`);checkResults.push({...check,exactMatch:true});};
let reloadChecks=0;const answers=[];
for(const receipt of transcript){
 while(checks.length&&checks[0].eventIndex<receipt.eventIndex)compare(checks.shift());
 assert.equal(state.turn,receipt.turnBefore,`Cycle at event${receipt.eventIndex}`);
 const restored=JSON.parse(JSON.stringify(state));
 const apply=s=>receipt.action.type==='endTurn'?endTurn(s):command(s,receipt.action);
 const answer=apply(state),restoredAnswer=apply(restored);
 assert.ok(answer.ok,`Event${receipt.eventIndex}: ${answer.message}`);assert.deepEqual(answer,restoredAnswer);assert.equal(JSON.stringify(state),JSON.stringify(restored));reloadChecks++;
 assert.ok(validateSave(state),`Valid state event${receipt.eventIndex}`);
 for(const f of state.factions)for(const resource of ['credits','minerals','science','orders'])assert.ok(Number.isFinite(f[resource])&&f[resource]>=0);
 answers.push({eventIndex:receipt.eventIndex,message:answer.message??null});
}
while(checks.length)compare(checks.shift());
const p=state.factions.find(f=>f.id==='player');
const result={seed:provenance.seed,enginePin:provenance.enginePin,engineSourceHashes:pin.files,commands:transcript.length,endTurns:transcript.filter(c=>c.action.type==='endTurn').length,initialization:provenance.initialization,exportChecks:checkResults.length,uniqueExports:new Set(checkResults.map(x=>x.file)).size,jsonReloadChecks:reloadChecks,validNonnegativeAfterEveryCommand:true,exactFinalSerializedMatch:true,turn:state.turn,winner:state.winner,victoryType:state.victoryType,resources:{credits:p.credits,minerals:p.minerals,science:p.science,orders:p.orders},research:p.research,techs:p.techs.length,colonies:state.systems.filter(x=>x.owner==='player').length,ownFleets:state.fleets.filter(x=>x.owner==='player').map(({id,type,ships,hp,systemId})=>({id,type,ships,hp,systemId})),canonicalSha256:hash(JSON.stringify(state)),commandsSha256:hash(read('commands.json')),checkpoints:checkResults,normalizations:provenance.normalizations,pageErrors:provenance.pageErrors,driverErrorCount:provenance.driverErrors.length};
if(process.argv.includes('--record')){fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(root,'command-results.json'),JSON.stringify(answers,null,2)+'\n');}
else assert.deepEqual(result,JSON.parse(read('results.json')),'Reproducible results');
assert.equal(state.winner,'player');assert.equal(state.victoryType,'Transcendence');
console.log(JSON.stringify({commands:result.commands,endTurns:result.endTurns,exportChecks:result.exportChecks,uniqueExports:result.uniqueExports,jsonReloadChecks:reloadChecks,exactFinalSerializedMatch:true,validNonnegative:true,turn:state.turn,winner:state.winner,victoryType:state.victoryType,canonicalSha256:result.canonicalSha256},null,2));
