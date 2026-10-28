/** Reproduce the verified human campaign checkpoint using only ordinary commands.
 * node replay.mjs --repo /path/to/awesome_4x
 * Requires pinned historical git objects. No repository/source/save mutations.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(process.argv.includes('--repo')?process.argv[process.argv.indexOf('--repo')+1]:process.cwd());
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const evidence=read('results.json'),commands=read('commands.json'),state=read('actual-cycle20.json');
assert.equal(hash(fs.readFileSync(path.join(here,'actual-cycle20.json'))),evidence.inputSha256);
assert.equal(hash(fs.readFileSync(path.join(here,'actual-postsettlement29.json'))),evidence.actualFinalExportSha256);
assert.equal(hash(fs.readFileSync(path.join(here,'verified-before-accept29.json'))),evidence.verifiedPreacceptSha256);
const archive=execFileSync('git',['archive',evidence.sourceRevision,'src','package.json'],{cwd:repo,maxBuffer:20_000_000});
assert.equal(hash(archive),evidence.sourceArchiveSha256);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-diplomacy-replay-'));
try{
  execFileSync('tar',['-x','-C',scratch],{input:archive});
  for(const[file,sha]of Object.entries(evidence.engineSourceHashes))assert.equal(hash(fs.readFileSync(path.join(scratch,file))),sha);
  const game=await import(pathToFileURL(path.join(scratch,'src/game.js')));
  const diplomacy=await import(pathToFileURL(path.join(scratch,'src/diplomacy.js')));
  assert.ok(game.validateSave(state));let preaccept=null;
  for(const step of commands){
    assert.equal(state.turn,step.turnBefore,`Before recorded event ${step.eventIndex}`);
    if(step.action.stance==='acceptPeace'){
      assert.deepEqual(state,read('verified-before-accept29.json'));
      const forecast=diplomacy.getDiplomacyForecast(state,'player','khar');
      assert.equal(forecast.incomingOffer.status,'pending');assert.equal(forecast.acceptPeace.enabled,true);assert.equal(forecast.peace.enabled,false);
      preaccept={turn:state.turn,warStarted:state.factions.find(f=>f.id==='player').relations.khar.treatyTurn,offerId:forecast.incomingOffer.id,offerStatus:forecast.incomingOffer.status,acceptEnabled:forecast.acceptPeace.enabled,newProposalEnabled:forecast.peace.enabled,newProposalReason:forecast.peace.reason};
    }
    const answer=step.action.type==='endTurn'?game.endTurn(state):game.command(state,step.action);
    assert.ok(answer.ok,`${JSON.stringify(step.action)}: ${answer.message}`);assert.ok(game.validateSave(state));
  }
  assert.deepEqual(state,read('actual-postsettlement29.json'));
  assert.equal(JSON.stringify(state),JSON.stringify(read('actual-postsettlement29.json')));
  assert.equal(hash(JSON.stringify(state)),evidence.postsettlementCanonicalSha256);
  console.log(JSON.stringify({sourceRevision:evidence.sourceRevision,commands:commands.length,fullStateExact:true,serializedStateExact:true,verifiedPreaccept:preaccept},null,2));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
