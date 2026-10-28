import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGame,command,endTurn,validateSave} from '../military-playtest/replay/engine/src/game.js';
const here=new URL('./',import.meta.url),history=new URL('../military-playtest/replay/',import.meta.url);
const read=(base,file)=>fs.readFileSync(new URL(file,base));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const provenance=JSON.parse(read(history,'results.json')),receiptBytes=read(history,'commands.json'),receipts=JSON.parse(receiptBytes);
assert.equal(provenance.sourceRevision,'60fd9f8e85edfee92ed40ee29c9b8c314e140da3');
assert.equal(receipts.length,340);assert.equal(sha(receiptBytes),provenance.commandsSha256);
for(const [file,hash]of Object.entries(provenance.engineSourceHashes))assert.equal(sha(read(history,`engine/${file}`)),hash,`Historical engine ${file}`);
const baseline=createGame('IRON-COVENANT-10'),used=[];
let boundary;
for(const receipt of receipts){
 if(receipt.action.type==='endTurn'&&baseline.turn===41){boundary=receipt;break;}
 const answer=receipt.action.type==='endTurn'?endTurn(baseline):command(baseline,receipt.action);
 assert.ok(answer.ok,`Recorded event ${receipt.eventIndex}`);assert.ok(validateSave(baseline));used.push(receipt.eventIndex);
}
assert.equal(boundary.turnBefore,41);const pre41=JSON.stringify(baseline,null,2)+'\n';
const before=baseline.fleets.filter(f=>f.owner==='player'&&f.systemId==='s13').map(f=>structuredClone(f));
const screen=JSON.parse(JSON.stringify(baseline)),own=screen.fleets.map((f,i)=>({f,i})).filter(x=>x.f.owner==='player'&&x.f.systemId==='s13');
assert.equal(own.length,2);assert.equal(own[0].f.type,'frigate');assert.equal(own[1].f.type,'cruiser');
[screen.fleets[own[0].i],screen.fleets[own[1].i]]=[screen.fleets[own[1].i],screen.fleets[own[0].i]];
endTurn(baseline);endTurn(screen);assert.ok(validateSave(baseline)&&validateSave(screen));
const actualBytes=read(history,'actual-exports/cycle42.json'),actual=JSON.parse(actualBytes);
const exportRecord=provenance.checkpoints.find(c=>c.file==='actual-exports/cycle42.json');
assert.equal(sha(actualBytes),exportRecord.sha256);
const intervening=receipts.filter(r=>r.eventIndex>boundary.eventIndex&&r.eventIndex<exportRecord.eventIndex);
assert.deepEqual(intervening,[],'No additional game command occurred before the actual42 export');
assert.equal(JSON.stringify(baseline),JSON.stringify(actual),'Baseline must equal the actual cycle42 download in every serialized field');
const project=s=>({reports:s.combatReports.filter(r=>r.turn===41&&r.systemId==='s13'),ownSable:s.fleets.filter(f=>f.owner==='player'&&f.systemId==='s13').map(f=>({id:f.id,type:f.type,ships:f.ships,hp:f.hp})),rng:s.rng});
const original=JSON.parse(read(here,'original-counterfactual.json'));
assert.deepEqual(before,original.before);assert.deepEqual(project(baseline),original.baseline);assert.deepEqual(project(screen),original.cruiserFirst);
const result={sourceRevision:provenance.sourceRevision,receiptFile:'../military-playtest/replay/commands.json',receiptCount:receipts.length,receiptSha256:sha(receiptBytes),engineSourceHashes:provenance.engineSourceHashes,checkpointKind:'Replay-derived cycle41 after recorded player commands, immediately before the rival phase. Not an actual UI export.',commandsReplayedBeforeBoundary:used.length,lastPlayerCommandEvent:used.at(-1),rivalPhaseEvent:boundary.eventIndex,actual42ExportEvent:exportRecord.eventIndex,extraCommandsBeforeActual42:intervening,actual42Sha256:sha(actualBytes),baselineMatchesActual42Exactly:true,pre41Sha256:sha(pre41),pre41CanonicalSha256:sha(JSON.stringify(JSON.parse(pre41))),counterfactual:'Exchange only the two own Sable fleet array positions before the historical endTurn. This is an order-only hypothetical, not a legal historical command or a Stage14 implementation. No order cost is charged. Subsequent RNG differs, so no whole-campaign improvement is claimed.',before,baseline:project(baseline),cruiserFirst:project(screen)};
if(process.argv.includes('--write')){fs.writeFileSync(new URL('verified-pre41.json',here),pre41);fs.writeFileSync(new URL('sable-results.json',here),JSON.stringify(result,null,2)+'\n');}
else{assert.equal(read(here,'verified-pre41.json').toString(),pre41);assert.deepEqual(JSON.parse(read(here,'sable-results.json')),result);}
console.log(JSON.stringify({historicalEngine:result.sourceRevision,receiptCount:receipts.length,commandsBeforeBoundary:used.length,rivalPhaseEvent:boundary.eventIndex,actual42ExportEvent:exportRecord.eventIndex,extraCommands:intervening.length,baselineMatchesActual42Exactly:true,originalCounterfactualReproduced:true,baseline:result.baseline.ownSable,cruiserFirst:result.cruiserFirst.ownSable},null,2));
