import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createGame,command,endTurn,validateSave} from './engine/src/game.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const result=JSON.parse(read('results.json')),commands=JSON.parse(read('commands.json'));
for(const [name,sha]of Object.entries(result.engineSourceHashes))assert.equal(hash(read(`engine/${name}`)),sha,`Pinned source ${name}`);
if(fs.existsSync(path.join(root,'provenance/record.json.gz')))assert.equal(hash(gunzipSync(read('provenance/record.json.gz'))),result.recordSha256,'Original receipt provenance');
if(fs.existsSync(path.join(root,'provenance/observations.ndjson.gz')))assert.equal(hash(gunzipSync(read('provenance/observations.ndjson.gz'))),result.observationsSha256,'Original observation provenance');
assert.equal(hash(read('commands.json')),result.commandsSha256,'Command transcript');
const state=createGame(result.seed),checks=[...result.checkpoints];
let reloadChecks=0,exportChecks=0;
function compareExport(check){const bytes=read(check.file),expected=JSON.parse(bytes);assert.equal(hash(bytes),check.sha256);assert.equal(JSON.stringify(state),JSON.stringify(expected),check.file);exportChecks++;}
for(const receipt of commands){
 while(checks.length&&checks[0].eventIndex<receipt.eventIndex)compareExport(checks.shift());
 assert.equal(state.turn,receipt.turnBefore,`Cycle at event ${receipt.eventIndex}`);
 const copy=JSON.parse(JSON.stringify(state)),action=receipt.action;
 const apply=s=>action.type==='endTurn'?endTurn(s):command(s,action);
 const answer=apply(state),restoredAnswer=apply(copy);
 assert.ok(answer.ok,`Command event ${receipt.eventIndex}: ${answer.message}`);
 assert.equal(answer.message||null,receipt.result);assert.deepEqual(state,copy);assert.deepEqual(answer,restoredAnswer);reloadChecks++;
 assert.ok(validateSave(state));for(const f of state.factions)for(const k of ['credits','minerals','science','orders'])assert.ok(f[k]>=0);
}
while(checks.length)compareExport(checks.shift());
assert.equal(hash(JSON.stringify(state)),result.finalCanonicalSha256);
assert.equal(reloadChecks,result.jsonReloadChecks);assert.equal(state.winner,'player');assert.equal(state.victoryType,'Domination');
console.log(JSON.stringify({commands:commands.length,endTurns:commands.filter(x=>x.action.type==='endTurn').length,exportChecks,reloadChecks,validNonnegative:true,exactFinalSerializedMatch:true,turn:state.turn,winner:state.winner,victoryType:state.victoryType,canonicalSha256:hash(JSON.stringify(state))},null,2));
