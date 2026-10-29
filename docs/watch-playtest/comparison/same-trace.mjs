import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as baseline from '../replay/engine/src/game.js';
import * as candidate from './engine/src/game.js';
const root=path.dirname(fileURLToPath(import.meta.url)),read=n=>fs.readFileSync(path.join(root,n));
const hash=x=>createHash('sha256').update(x).digest('hex');
const pin=JSON.parse(read('source-pin.json'));for(const [file,sha]of Object.entries(pin.files))assert.equal(hash(read('engine/'+file)),sha);
const original=JSON.parse(read('../replay/source-pin.json'));for(const [file,sha]of Object.entries(original.files))assert.equal(hash(read('../replay/engine/'+file)),sha);
const commands=JSON.parse(read('../replay/commands.json')),a=baseline.createGame('ASTERION-WATCH-14'),b=candidate.createGame('ASTERION-WATCH-14');
const strip=s=>{const c=structuredClone(s);for(const report of c.combatReports)delete report.rounds;return c;};
for(const receipt of commands){
 const call=(api,s)=>receipt.action.type==='endTurn'?api.endTurn(s):api.command(s,receipt.action);
 const x=call(baseline,a),y=call(candidate,b);assert.ok(x.ok&&y.ok,`Event${receipt.eventIndex}`);assert.deepEqual(x,y);
 assert.deepEqual(strip(a),strip(b),`All fields except combatReports[*].rounds at event${receipt.eventIndex}`);assert.ok(candidate.validateSave(b));
}
const downloaded=JSON.parse(read('../checkpoints/cycle60.json'));assert.equal(JSON.stringify(a),JSON.stringify(downloaded));assert.equal(JSON.stringify(strip(b)),JSON.stringify(downloaded));
const result={label:'Postgame same-trace engine comparison; not an additional played campaign',baseline:'a9c61ff / actual frozen0.14',candidate:'13b0392',commands:commands.length,endTurns:59,comparisons:commands.length,onlyRemovedFields:'combatReports[*].rounds',allOtherFieldsEqualAfterEveryCommand:true,allCommandResultsEqual:true,fullFinalExportEqualAfterRemovingOnlyRounds:true,turn:b.turn,winner:b.winner,victoryType:b.victoryType,baselineFinalHash:hash(JSON.stringify(a)),candidateStrippedHash:hash(JSON.stringify(strip(b))),candidateFinalHash:hash(JSON.stringify(b)),roundReports:b.combatReports.filter(x=>x.rounds).map(x=>({id:x.id,rounds:x.rounds.length})),candidateEngineHashes:pin.files};
if(process.argv.includes('--record'))fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2)+'\n');else assert.deepEqual(result,JSON.parse(read('results.json')));
console.log(JSON.stringify({commands:result.commands,comparisons:result.comparisons,onlyRemovedFields:result.onlyRemovedFields,allOtherFieldsEqualAfterEveryCommand:true,fullFinalExportEqualAfterRemovingOnlyRounds:true,roundReports:result.roundReports},null,2));
